"""Synthetic data only; all requests are pinned to the local emulator."""

from copy import deepcopy

import requests


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
    copied = request("PUT", "formal", admin=True, headers={"if-match": etag}, json=source)
    assert copied.status_code == 200
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
    print("RTDB emulator: rules, migration copy, collision and ETag checks passed")


if __name__ == "__main__":
    main()
