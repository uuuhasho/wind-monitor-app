"""Synthetic data only; all requests are pinned to the local emulator."""

from copy import deepcopy
import sys
import tempfile
from pathlib import Path

import requests
from migration_rehearsal import copy_once

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deploy.migrate_formal import migrate


BASE = "http://127.0.0.1:19090"
NAMESPACE = "demo-formal-rtdb-default-rtdb"
SESSION = requests.Session()
SESSION.trust_env = False


def request(method, path, *, admin=False, **kwargs):
    params = {"ns": NAMESPACE}
    if admin:
        params["access_token"] = "owner"
    return SESSION.request(method, f"{BASE}/{path}.json", params=params, timeout=10, **kwargs)


def main():
    source = {
        "active_status": {"current_wind": 4},
        "archive_receipts": {"2026-01-01": {"ship": {"archive_id": "synthetic"}}},
        "forecast_data": [{"timestamp": "2026-01-01T08:00:00+08:00"}],
        "schedule_list": [{"ship_name": "SYNTHETIC"}],
        "schedule_source": "synthetic",
    }
    root = {"test": source, "active_status": {"unrelated": True}}
    setup = request("PUT", "", admin=True, json=root)
    assert setup.status_code == 200, f"emulator setup returned HTTP {setup.status_code}: {setup.text}"

    assert request("GET", "").status_code in (401, 403)
    assert request("GET", "test").json() == source
    assert request("GET", "formal").status_code == 200
    assert request("GET", "active_status").json() == root["active_status"]
    assert request("GET", "unknown").status_code in (401, 403)
    assert request("PUT", "test", json={"unauthorized": True}).status_code in (401, 403)
    assert request("PUT", "formal", json={"unauthorized": True}).status_code in (401, 403)
    assert request("GET", "active_status", admin=True).json() == root["active_status"]

    before = request("GET", "formal", admin=True, headers={"X-Firebase-ETag": "true"})
    assert before.status_code == 200 and before.json() is None
    etag = before.headers.get("ETag")
    assert etag
    assert copy_once(request) == source
    assert request("GET", "formal", admin=True).json() == source
    assert request("GET", "test", admin=True).json() == source
    assert request("GET", "active_status", admin=True).json() == root["active_status"]

    conflict = request("PUT", "formal", admin=True, headers={"if-match": etag}, json={"wrong": True})
    assert conflict.status_code == 412
    assert request("GET", "formal", admin=True).json() == source
    changed = deepcopy(source)
    changed["active_status"]["current_wind"] = 9
    current = request("GET", "formal", admin=True, headers={"X-Firebase-ETag": "true"})
    assert request("PATCH", "formal/active_status", admin=True, json={"current_wind": 9}).status_code == 200
    stale = request("PUT", "formal", admin=True, headers={"if-match": current.headers["ETag"]}, json=source)
    assert stale.status_code == 412
    assert request("GET", "formal", admin=True).json() == changed
    assert request("GET", "test", admin=True).json() == source

    assert request("PUT", "", admin=True, json=root).status_code == 200
    writes = []
    def interrupted(method, path, **kwargs):
        response = request(method, path, **kwargs)
        if method == "PUT":
            writes.append(path)
            raise requests.Timeout("synthetic response loss")
        return response

    try:
        copy_once(interrupted)
        raise AssertionError("timeout must stop the copy")
    except requests.Timeout:
        pass
    assert writes == ["formal"]
    assert request("GET", "formal", admin=True).json() == source
    assert request("GET", "test", admin=True).json() == source
    try:
        copy_once(request)
        raise AssertionError("existing target must stop retry")
    except ValueError as error:
        assert "target already exists" in str(error)
    assert request("PUT", "", admin=True, json=root).status_code == 200
    def admin_request(method, path, **kwargs):
        return request(method, path, admin=True, **kwargs)
    with tempfile.TemporaryDirectory() as directory:
        backup = Path(directory) / "synthetic-backup.json"
        assert migrate(admin_request) == sorted(source)
        assert request("GET", "formal", admin=True).json() is None
        assert migrate(admin_request, apply=True, backup_path=backup) == sorted(source)
        assert backup.is_file()
        assert request("GET", "formal", admin=True).json() == source
        assert request("GET", "test", admin=True).json() == source
        assert request("GET", "active_status", admin=True).json() == root["active_status"]
    assert request("PUT", "", admin=True, json=root).status_code == 200
    with tempfile.TemporaryDirectory() as directory:
        backup = Path(directory) / "interrupted-backup.json"
        def interrupted_production(method, path, **kwargs):
            response = admin_request(method, path, **kwargs)
            if method == "PUT":
                raise requests.Timeout("synthetic response loss")
            return response
        try:
            migrate(interrupted_production, apply=True, backup_path=backup)
            raise AssertionError("timeout must stop the production migration")
        except requests.Timeout:
            pass
        assert backup.is_file()
        assert request("GET", "formal", admin=True).json() == source
        assert request("GET", "test", admin=True).json() == source
        try:
            migrate(admin_request, apply=True, backup_path=Path(directory) / "retry.json")
            raise AssertionError("existing target must stop the production retry")
        except ValueError as error:
            assert "target already exists" in str(error)
        assert not (Path(directory) / "retry.json").exists()
    print("RTDB emulator: rules, copy, collisions, ETag and interrupted-write checks passed")


if __name__ == "__main__":
    main()
