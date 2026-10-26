"""Small conditional-write client for the forecast RTDB namespace."""

import os
import time
from urllib.parse import urlsplit, urlunsplit

import requests


class RtdbError(RuntimeError):
    pass


class PipelineBusyError(RtdbError):
    pass


class ForecastRtdb:
    def __init__(self, settings, now=time.time, request_session=requests):
        prefix = os.environ.get("FIREBASE_RTDB_PREFIX", "/test").strip().strip("/")
        raw_url = (os.environ.get("FIREBASE_RTDB_URL") or settings.get("DbUrl") or "").strip().strip("\ufeff")
        parsed_url = urlsplit(raw_url)
        path = parsed_url.path.rstrip("/")
        if prefix and path.endswith(f"/{prefix}"):
            path = path[: -len(prefix) - 1]
        self.base_url = urlunsplit((parsed_url.scheme, parsed_url.netloc, path, "", ""))
        self.secret = (os.environ.get("FIREBASE_RTDB_SECRET") or settings.get("DbSecret") or "").strip().strip("\ufeff")
        self.prefix = prefix
        self.now = now
        self.requests = request_session
        if not self.base_url or not self.secret:
            raise RtdbError("Firebase RTDB settings are missing.")

    @property
    def root_url(self):
        return f"{self.base_url}/{self.prefix}.json" if self.prefix else f"{self.base_url}/.json"

    @property
    def params(self):
        return {"auth": self.secret}

    def _read(self):
        try:
            response = self.requests.get(
                self.root_url,
                params=self.params,
                headers={"X-Firebase-ETag": "true"},
                timeout=15,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            detail = f" HTTP {status}" if status else ""
            raise RtdbError(f"RTDB read failed.{detail}") from None
        return response.json() or {}, response.headers.get("ETag")

    def _replace(self, root, etag):
        try:
            response = self.requests.put(
                self.root_url,
                params=self.params,
                headers={"if-match": etag or "null_etag"},
                json=root,
                timeout=15,
            )
        except requests.RequestException as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            detail = f" HTTP {status}" if status else ""
            raise RtdbError(f"RTDB write failed.{detail}") from None
        if response.status_code == 412:
            return False
        try:
            response.raise_for_status()
        except requests.RequestException as error:
            raise RtdbError(f"RTDB write failed. HTTP {response.status_code}") from None
        return True

    def _change(self, mutate):
        for _ in range(3):
            root, etag = self._read()
            if not mutate(root):
                return False
            if self._replace(root, etag):
                return True
        raise RtdbError("RTDB changed concurrently; update was not published.")

    def acquire_lock(self, owner, ttl_seconds):
        def acquire(root):
            current = root.get("forecast_update_lock") or {}
            if current.get("expiresAt", 0) > self.now():
                return False
            root["forecast_update_lock"] = {
                "owner": owner,
                "expiresAt": self.now() + ttl_seconds,
            }
            active_status = dict(root.get("active_status") or {})
            active_status["forecast_updating"] = True
            root["active_status"] = active_status
            return True

        if not self._change(acquire):
            raise PipelineBusyError("A forecast update is already running.")

    def publish(self, owner, data, updated_at):
        def publish(root):
            current = root.get("forecast_update_lock") or {}
            if current.get("owner") != owner or current.get("expiresAt", 0) <= self.now():
                raise RtdbError("Forecast update lock was lost before publishing.")
            root["forecast_data"] = data
            metadata = dict(root.get("forecast_metadata") or {})
            metadata["updatedAt"] = updated_at
            root["forecast_metadata"] = metadata
            active_status = dict(root.get("active_status") or {})
            active_status["forecast_auto_failed"] = False
            root["active_status"] = active_status
            return True

        self._change(publish)

    def release_lock(self, owner):
        def release(root):
            current = root.get("forecast_update_lock") or {}
            if current.get("owner") != owner:
                return False
            root.pop("forecast_update_lock", None)
            active_status = dict(root.get("active_status") or {})
            active_status["forecast_updating"] = False
            root["active_status"] = active_status
            return True

        self._change(release)
