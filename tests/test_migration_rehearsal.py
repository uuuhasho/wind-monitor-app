import unittest
from copy import deepcopy
from unittest.mock import Mock

import requests

from migration_rehearsal import copy_once, validate_source


class Response:
    def __init__(self, value, etag="etag", status=200):
        self.value = value
        self.headers = {"ETag": etag} if etag else {}
        self.status = status

    def json(self):
        return deepcopy(self.value)

    def raise_for_status(self):
        if self.status >= 400:
            raise requests.HTTPError(str(self.status))


class MigrationRehearsalTests(unittest.TestCase):
    def test_known_nodes_are_preserved_without_mutation(self):
        source = {"daily_records": {"day": {"ship": {"wind_logs": {"time": 4}}}},
                  "archive_receipts": {"day": {"ship": {"archive_id": "id"}}},
                  "editing_lock": {"locked": False}, "active_status": {"forecast_updating": False}}
        result = validate_source(source)
        self.assertEqual(result, source)
        result["daily_records"]["day"].clear()
        self.assertTrue(source["daily_records"]["day"])

    def test_invalid_source_unknown_nodes_and_live_locks_stop(self):
        for source in (None, {}, [], {"unknown": 1}, {"forecast_update_lock": {"owner": "job"}},
                       {"active_status": {"forecast_updating": True}},
                       {"editing_lock": {"locked": True}}, {"editing_lock": "invalid"}):
            with self.subTest(source=source), self.assertRaises(ValueError):
                validate_source(source)

    def test_existing_target_stops_before_put(self):
        request = Mock(side_effect=[Response({"active_status": {"current_wind": 1}}), Response({"existing": True})])
        with self.assertRaisesRegex(ValueError, "target already exists"):
            copy_once(request)
        self.assertEqual(request.call_count, 2)

    def test_source_change_stops_before_put(self):
        request = Mock(side_effect=[Response({"schedule_source": "a"}, "old"), Response(None, "empty"),
                                    Response({"schedule_source": "b"}, "new")])
        with self.assertRaisesRegex(ValueError, "source changed"):
            copy_once(request)
        self.assertEqual(request.call_count, 3)

    def test_missing_etag_stops_before_put(self):
        request = Mock(side_effect=[Response({"schedule_source": "a"}), Response(None, None)])
        with self.assertRaisesRegex(ValueError, "target ETag missing"):
            copy_once(request)
        self.assertEqual(request.call_count, 2)

    def test_timeout_and_collision_stop_without_retry_or_cleanup(self):
        for failure in (requests.Timeout("unknown outcome"), requests.HTTPError("412")):
            request = Mock(side_effect=[Response({"schedule_source": "a"}, "source"), Response(None, "empty"),
                                        Response({"schedule_source": "a"}, "source"), failure])
            with self.subTest(failure=failure), self.assertRaises(type(failure)):
                copy_once(request)
            self.assertEqual(request.call_count, 4)
            self.assertEqual(request.call_args_list[-1].args[:2], ("PUT", "formal"))

    def test_verification_mismatch_stops_without_cleanup(self):
        request = Mock(side_effect=[Response({"schedule_source": "a"}, "source"), Response(None, "empty"),
                                    Response({"schedule_source": "a"}, "source"), Response(None),
                                    Response({"schedule_source": "different"})])
        with self.assertRaisesRegex(ValueError, "verification failed"):
            copy_once(request)
        self.assertEqual(request.call_count, 5)


if __name__ == "__main__":
    unittest.main()
