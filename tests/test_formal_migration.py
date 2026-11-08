import json
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock

import requests

from deploy.migrate_formal import migrate, validate_source, write_backup


class Response:
    def __init__(self, value, etag="etag", status=200):
        self.value = value
        self.headers = {"ETag": etag} if etag else {}
        self.status_code = status

    def json(self):
        return deepcopy(self.value)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(response=self)


class FormalMigrationTests(unittest.TestCase):
    def setUp(self):
        self.source = {"active_status": {"current_wind": 4}, "archive_receipts": {"date": {"id": "kept"}}}

    def test_default_preflight_never_writes(self):
        request = Mock(side_effect=[Response(self.source, "source"), Response(None, "empty")])
        self.assertEqual(migrate(request), sorted(self.source))
        self.assertEqual([call.args[0] for call in request.call_args_list], ["GET", "GET"])

    def test_apply_requires_explicit_confirmations_before_connecting(self):
        script = Path(__file__).resolve().parents[1] / "deploy" / "migrate_formal.py"
        result = subprocess.run([sys.executable, "-B", str(script), "--apply"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires --writers-stopped", result.stderr)

    def test_invalid_sources_fail_closed(self):
        for source in (None, {}, [], {"unexpected": 1}, {"forecast_update_lock": {}},
                       {"active_status": {"forecast_updating": True}}, {"editing_lock": {"locked": True}},
                       {"editing_lock": []}, {"active_status": []},
                       {"editing_lock": {"locked": "true"}}, {"active_status": {"forecast_updating": "true"}}):
            with self.subTest(source=source), self.assertRaises(ValueError):
                validate_source(source)

    def test_existing_target_and_missing_etag_stop_before_backup(self):
        for replies in ([Response(self.source), Response({"existing": True})],
                        [Response(self.source), Response(None, None)]):
            with tempfile.TemporaryDirectory() as folder:
                backup = Path(folder) / "backup.json"
                request = Mock(side_effect=replies)
                with self.assertRaises(ValueError):
                    migrate(request, apply=True, backup_path=backup)
                self.assertFalse(backup.exists())

    def test_backup_is_exclusive_and_never_inside_repository(self):
        with tempfile.TemporaryDirectory() as folder:
            backup = Path(folder) / "backup.json"
            write_backup(backup, self.source)
            self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), self.source)
            with self.assertRaises(FileExistsError):
                write_backup(backup, {"changed": True})
            self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), self.source)
        with self.assertRaises(ValueError):
            write_backup(Path(__file__).resolve().parent / "backup.json", self.source)

    def test_source_change_and_timeout_retain_backup_without_retry(self):
        for last in (Response(self.source, "changed"), requests.Timeout("unknown")):
            with self.subTest(last=last), tempfile.TemporaryDirectory() as folder:
                backup = Path(folder) / "backup.json"
                replies = [Response(self.source, "original"), Response(None, "empty")]
                if isinstance(last, requests.Timeout):
                    replies.extend([Response(self.source, "original"), last])
                else:
                    replies.append(last)
                request = Mock(side_effect=replies)
                with self.assertRaises((ValueError, requests.Timeout)):
                    migrate(request, apply=True, backup_path=backup)
                self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), self.source)
                self.assertLessEqual(sum(call.args[0] == "PUT" for call in request.call_args_list), 1)

    def test_source_change_after_copy_is_not_reported_success(self):
        request = Mock(side_effect=[Response(self.source, "original"), Response(None, "empty"),
                                    Response(self.source, "original"), Response(self.source),
                                    Response(self.source), Response(self.source, "changed")])
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, "during copy"):
                migrate(request, apply=True, backup_path=Path(folder) / "backup.json")

    def test_target_collision_retains_backup_and_does_not_retry(self):
        request = Mock(side_effect=[Response(self.source, "original"), Response(None, "empty"),
                                    Response(self.source, "original"), Response(None, status=412)])
        with tempfile.TemporaryDirectory() as folder:
            backup = Path(folder) / "backup.json"
            with self.assertRaises(requests.HTTPError):
                migrate(request, apply=True, backup_path=backup)
            self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), self.source)
            self.assertEqual(len(request.call_args_list), 4)

    def test_target_mismatch_stops_without_cleanup(self):
        request = Mock(side_effect=[Response(self.source, "original"), Response(None, "empty"),
                                    Response(self.source, "original"), Response(self.source),
                                    Response({"different": True}, "new")])
        with tempfile.TemporaryDirectory() as folder:
            backup = Path(folder) / "backup.json"
            with self.assertRaisesRegex(ValueError, "target verification failed"):
                migrate(request, apply=True, backup_path=backup)
            self.assertTrue(backup.exists())
            self.assertEqual(len(request.call_args_list), 5)

    def test_success_uses_target_etag_and_preserves_source_backup(self):
        request = Mock(side_effect=[Response(self.source, "original"), Response(None, "empty"),
                                    Response(self.source, "original"), Response(self.source),
                                    Response(self.source, "new"), Response(self.source, "original")])
        with tempfile.TemporaryDirectory() as folder:
            backup = Path(folder) / "backup.json"
            self.assertEqual(migrate(request, apply=True, backup_path=backup), sorted(self.source))
            self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), self.source)
        write = request.call_args_list[3]
        self.assertEqual(write.args, ("PUT", "formal"))
        self.assertEqual(write.kwargs["headers"], {"if-match": "empty"})


if __name__ == "__main__":
    unittest.main()
