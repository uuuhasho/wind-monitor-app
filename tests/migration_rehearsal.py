"""Rehearsal logic only: caller must provide a synthetic local transport."""

from copy import deepcopy


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
    status = source.get("active_status") or {}
    editing = source.get("editing_lock") or {}
    if not isinstance(status, dict) or not isinstance(editing, dict):
        raise ValueError("invalid status or editing lock")
    if source.get("forecast_update_lock") is not None or status.get("forecast_updating") is True:
        raise ValueError("forecast work may be active")
    if editing.get("locked") is True:
        raise ValueError("editing lock is active")
    return deepcopy(source)


def copy_once(request):
    source = request("GET", "test", admin=True, headers={"X-Firebase-ETag": "true"})
    source.raise_for_status()
    snapshot = validate_source(source.json())
    source_etag = source.headers.get("ETag")
    if not source_etag:
        raise ValueError("source ETag missing")
    target = request("GET", "formal", admin=True, headers={"X-Firebase-ETag": "true"})
    target.raise_for_status()
    if target.json() is not None:
        raise ValueError("target already exists")
    target_etag = target.headers.get("ETag")
    if not target_etag:
        raise ValueError("target ETag missing")
    confirm = request("GET", "test", admin=True, headers={"X-Firebase-ETag": "true"})
    confirm.raise_for_status()
    if confirm.headers.get("ETag") != source_etag:
        raise ValueError("source changed before copy")
    result = request("PUT", "formal", admin=True, headers={"if-match": target_etag}, json=snapshot)
    result.raise_for_status()
    actual = request("GET", "formal", admin=True)
    actual.raise_for_status()
    if actual.json() != snapshot:
        raise ValueError("target verification failed")
    return snapshot
