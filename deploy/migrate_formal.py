"""Explicitly authorized migration of the production RTDB namespace."""

import argparse
import json
import os
import sys
from pathlib import Path

import requests


DATABASE_URL = "https://newlngship-default-rtdb.asia-southeast1.firebasedatabase.app"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
KNOWN_NODES = {
    "active_status", "archive_receipts", "daily_records", "editing_lock",
    "forecast_data", "forecast_metadata", "forecast_update_lock",
    "schedule_list", "schedule_overrides", "schedule_source",
}


def validate_source(source):
    if not isinstance(source, dict) or not source:
        raise ValueError("source is empty or invalid")
    unknown = set(source) - KNOWN_NODES
    if unknown:
        raise ValueError("source contains unknown nodes: " + ", ".join(sorted(unknown)))
    status, editing = source.get("active_status"), source.get("editing_lock")
    if status is not None and not isinstance(status, dict):
        raise ValueError("invalid active status")
    if editing is not None and not isinstance(editing, dict):
        raise ValueError("invalid editing lock")
    if (status or {}).get("forecast_updating") not in (None, True, False):
        raise ValueError("invalid forecast status")
    if (editing or {}).get("locked") not in (None, True, False):
        raise ValueError("invalid editing lock status")
    if source.get("forecast_update_lock") is not None or (status or {}).get("forecast_updating") is True:
        raise ValueError("forecast work may be active")
    if (editing or {}).get("locked") is True:
        raise ValueError("editing lock is active")


def read_with_etag(request, path):
    response = request("GET", path, headers={"X-Firebase-ETag": "true"})
    response.raise_for_status()
    etag = response.headers.get("ETag")
    if not etag:
        raise ValueError(f"{path} ETag missing")
    return response.json(), etag


def write_backup(path, snapshot):
    path = Path(path)
    if not path.is_absolute() or not path.parent.is_dir():
        raise ValueError("backup must be an absolute path in an existing directory")
    if path.resolve().is_relative_to(PROJECT_ROOT.resolve()):
        raise ValueError("backup must be stored outside the project")
    data = json.dumps(snapshot, ensure_ascii=False, sort_keys=True).encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    if json.loads(path.read_text(encoding="utf-8")) != snapshot:
        raise ValueError("backup verification failed")


def migrate(request, *, apply=False, backup_path=None):
    source, source_etag = read_with_etag(request, "test")
    validate_source(source)
    target, target_etag = read_with_etag(request, "formal")
    if target is not None:
        raise ValueError("target already exists; no data was overwritten")
    if not apply:
        return sorted(source)
    if backup_path is None:
        raise ValueError("a backup path is required before writing")
    write_backup(backup_path, source)
    _, confirmed_etag = read_with_etag(request, "test")
    if confirmed_etag != source_etag:
        raise ValueError("source changed before copy; backup retained")
    response = request("PUT", "formal", headers={"if-match": target_etag}, json=source)
    response.raise_for_status()
    copied, _ = read_with_etag(request, "formal")
    if copied != source:
        raise ValueError("target verification failed; backup retained")
    _, final_etag = read_with_etag(request, "test")
    if final_etag != source_etag:
        raise ValueError("source changed during copy; stop and reconcile both namespaces")
    return sorted(source)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write to /formal after explicit approval")
    parser.add_argument("--writers-stopped", action="store_true", help="confirm all writers are stopped")
    parser.add_argument("--confirm-project", choices=["newlngship"])
    parser.add_argument("--backup", help="new absolute backup file outside the repository")
    args = parser.parse_args()
    if args.apply and (not args.writers_stopped or args.confirm_project != "newlngship" or not args.backup):
        parser.error("--apply requires --writers-stopped, --confirm-project newlngship and --backup")
    if not args.apply and (args.writers_stopped or args.confirm_project or args.backup):
        parser.error("write confirmations and --backup require --apply")
    secret = os.environ.get("FIREBASE_RTDB_SECRET", "").strip().strip("\ufeff").strip()
    if not secret:
        parser.error("FIREBASE_RTDB_SECRET must be supplied in the environment")
    session = requests.Session()
    session.trust_env = False

    def request(method, path, **kwargs):
        return session.request(method, f"{DATABASE_URL}/{path}.json", params={"auth": secret}, timeout=15, **kwargs)

    try:
        nodes = migrate(request, apply=args.apply, backup_path=args.backup)
    except requests.RequestException as error:
        status = getattr(getattr(error, "response", None), "status_code", None)
        print(f"RTDB request failed{f' (HTTP {status})' if status else ''}; stop and inspect before retrying.", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        print(f"Migration stopped: {error}", file=sys.stderr)
        return 1
    print(("Copied and verified" if args.apply else "Read-only preflight passed") + ": " + ", ".join(nodes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
