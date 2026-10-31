import os
import ast
import sys
import tempfile
import subprocess
import unittest
from copy import deepcopy
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from src import data_fusion
from src.config import get_env
from src.rtdb import ForecastRtdb, PipelineBusyError, RtdbError
import main


class Response:
    def __init__(self, payload=None, etag="etag", status=200):
        self.payload = payload
        self.headers = {"ETag": etag}
        self.status_code = status

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.status_code >= 400:
            error = requests.HTTPError("untrusted URL text")
            error.response = self
            raise error


class MemoryRtdb:
    def __init__(self, root, before_put=None):
        self.root = deepcopy(root)
        self.version = 0
        self.before_put = before_put
        self.writes = []

    def get(self, *_args, **_kwargs):
        return Response(deepcopy(self.root), etag=str(self.version))

    def put(self, _url, **kwargs):
        if self.before_put:
            callback, self.before_put = self.before_put, None
            callback(self)
        if kwargs["headers"]["if-match"] != str(self.version):
            return Response(status=412)
        self.root = deepcopy(kwargs["json"])
        self.version += 1
        self.writes.append(deepcopy(self.root))
        return Response(deepcopy(self.root), etag=str(self.version))


class ForecastRtdbTests(unittest.TestCase):
    def make_client(self, root, now=100):
        memory = MemoryRtdb(root)
        return ForecastRtdb(
            {"DbUrl": "https://db.example", "DbSecret": "test-token"},
            now=lambda: now,
            request_session=memory,
        ), memory

    def test_url_normalizes_root_and_test_prefix(self):
        client, _ = self.make_client({})
        self.assertEqual(client.root_url, "https://db.example/test.json")
        embedded = ForecastRtdb({"DbUrl": "https://db.example/test/", "DbSecret": "test-token"})
        self.assertEqual(embedded.root_url, "https://db.example/test.json")
        with patch.dict(os.environ, {"FIREBASE_RTDB_PREFIX": ""}, clear=False):
            self.assertEqual(self.make_client({})[0].root_url, "https://db.example/.json")

    def test_publish_preserves_other_namespace_data_and_metadata(self):
        root = {
            "daily_records": {"today": {"ship": "kept"}},
            "forecast_metadata": {"source": "CPC"},
            "forecast_update_lock": {"owner": "job-1", "expiresAt": 200},
        }
        client, memory = self.make_client(root)
        client.publish("job-1", [{"timestamp": "2026-01-01T08:00:00+08:00"}], "2026-01-01T00:00:00Z")
        self.assertEqual(memory.root["daily_records"]["today"]["ship"], "kept")
        self.assertEqual(memory.root["forecast_metadata"], {"source": "CPC", "updatedAt": "2026-01-01T00:00:00Z"})
        self.assertFalse(memory.root["active_status"]["forecast_auto_failed"])

    def test_expired_or_replaced_owner_cannot_publish_or_release(self):
        root = {"forecast_update_lock": {"owner": "new-job", "expiresAt": 200}}
        client, memory = self.make_client(root)
        with self.assertRaises(RtdbError):
            client.publish("old-job", [], "2026-01-01T00:00:00Z")
        self.assertFalse(client.release_lock("old-job"))
        self.assertEqual(memory.root["forecast_update_lock"]["owner"], "new-job")

    def test_expired_lock_can_be_recovered_by_one_owner(self):
        root = {"forecast_update_lock": {"owner": "old-job", "expiresAt": 99}}
        client, memory = self.make_client(root)
        client.acquire_lock("new-job", 300)
        self.assertEqual(memory.root["forecast_update_lock"], {"owner": "new-job", "expiresAt": 400})
        self.assertTrue(memory.root["active_status"]["forecast_updating"])
        client.release_lock("new-job")
        self.assertFalse(memory.root["active_status"]["forecast_updating"])

    def test_request_errors_do_not_include_secret_or_url(self):
        class FailingRequests:
            def get(self, *_args, **_kwargs):
                raise requests.ConnectionError("https://db.example/.json?auth=test-token")

        client = ForecastRtdb(
            {"DbUrl": "https://db.example", "DbSecret": "test-token"},
            request_session=FailingRequests(),
        )
        with self.assertRaises(RtdbError) as result:
            client.acquire_lock("job", 300)
        self.assertNotIn("test-token", str(result.exception))
        self.assertNotIn("https://", str(result.exception))

    def test_expired_owner_cannot_publish(self):
        client, memory = self.make_client({"forecast_update_lock": {"owner": "job", "expiresAt": 100}})
        with self.assertRaises(RtdbError):
            client.publish("job", [{"timestamp": "new"}], "new")
        self.assertEqual(memory.writes, [])

    def test_concurrent_owner_wins_and_previous_owner_cannot_release(self):
        client, memory = self.make_client({})
        def competing_job(store):
            store.root["forecast_update_lock"] = {"owner": "winner", "expiresAt": 400}
            store.version += 1
        memory.before_put = competing_job
        with self.assertRaises(PipelineBusyError):
            client.acquire_lock("loser", 300)
        client.release_lock("loser")
        self.assertEqual(memory.root["forecast_update_lock"]["owner"], "winner")
        self.assertEqual(memory.writes, [])

    def test_publish_preserves_concurrent_monitor_update(self):
        client, memory = self.make_client({"forecast_update_lock": {"owner": "job", "expiresAt": 400}})
        def monitoring_update(store):
            store.root["daily_records"] = {"concurrent": "kept"}
            store.version += 1
        memory.before_put = monitoring_update
        client.publish("job", [{"timestamp": "new"}], "new")
        self.assertEqual(memory.root["daily_records"], {"concurrent": "kept"})
        self.assertEqual(memory.root["forecast_metadata"]["updatedAt"], "new")

    def test_failed_publish_leaves_previous_forecast_unchanged(self):
        previous = {
            "forecast_data": [{"timestamp": "old"}],
            "forecast_metadata": {"updatedAt": "old"},
            "forecast_update_lock": {"owner": "job", "expiresAt": 200},
        }

        class FailingWrite:
            def get(self, *_args, **_kwargs):
                return Response(deepcopy(previous))

            def put(self, *_args, **_kwargs):
                return Response(status=500)

        client = ForecastRtdb(
            {"DbUrl": "https://db.example", "DbSecret": "test-token"},
            now=lambda: 100,
            request_session=FailingWrite(),
        )
        with self.assertRaises(RtdbError):
            client.publish("job", [{"timestamp": "new"}], "new")
        self.assertEqual(previous["forecast_data"], [{"timestamp": "old"}])
        self.assertEqual(previous["forecast_metadata"]["updatedAt"], "old")


class ForecastDateAndFusionTests(unittest.TestCase):
    def test_fusion_matches_pre_refactor_output_without_external_writes(self):
        source = subprocess.run(
            ["git", "show", "5233f9d:src/data_fusion.py"],
            cwd=Path(__file__).resolve().parents[1], check=True, capture_output=True, text=True, encoding="utf-8",
        ).stdout.replace(
            "from src.config import load_config, get_service_account_path",
            "from src.config import load_config\nget_service_account_path = lambda: None",
        )
        legacy = ModuleType("legacy_data_fusion")
        exec(compile(source, "legacy_data_fusion.py", "exec"), legacy.__dict__)
        settings = {"Algorithm": {"WindRatio": 1.5333}}
        payload = {"initial_date": "12Z30OCT", "points": [
            {"date_day": 30, "hour": 12, "wind_speed_kt": 15.333},
            {"date_day": 31, "hour": 0, "wind_speed_kt": 30.666},
        ]}
        from src import config as backend_config
        with tempfile.TemporaryDirectory() as directory, patch.object(backend_config, "BASE_DIR", directory), patch.object(
            legacy, "load_config", return_value=settings
        ), patch.object(legacy, "fetch_open_meteo_data", return_value={}), patch.object(
            data_fusion, "load_config", return_value=settings
        ), patch.object(data_fusion, "fetch_open_meteo_data", return_value={}), patch.object(data_fusion, "ForecastRtdb"):
            self.assertEqual(legacy.fuse_and_save_data(payload), data_fusion.fuse_and_save_data(payload, directory, "job"))

    def test_utc_to_taiwan_and_year_rollover_are_preserved(self):
        class FixedDatetime(data_fusion.datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 12, 30, tzinfo=tz)

        points = [
            {"date_day": 31, "hour": 12, "wind_speed_kt": 10},
            {"date_day": 1, "hour": 0, "wind_speed_kt": 20},
        ]
        with patch.object(data_fusion, "datetime", FixedDatetime):
            parsed = data_fusion.parse_forecast_dates("12Z31DEC", points)
        self.assertEqual(parsed[0]["timestamp_cst"], "2026-12-31T20:00:00+08:00")
        self.assertEqual(parsed[1]["timestamp_cst"], "2027-01-01T08:00:00+08:00")

    def test_00z_and_interpolation_output_remain_stable(self):
        published = []

        class FakeRtdb:
            def __init__(self, _settings):
                pass

            def publish(self, owner, records, updated_at):
                published.append((owner, records, updated_at))

        payload = {
            "initial_date": "00Z01JAN",
            "points": [
                {"date_day": 1, "hour": 0, "wind_speed_kt": 15.333},
                {"date_day": 1, "hour": 2, "wind_speed_kt": 30.666},
            ],
        }
        class FixedDatetime(data_fusion.datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 1, 1, tzinfo=tz)

        with patch.object(data_fusion, "datetime", FixedDatetime), tempfile.TemporaryDirectory() as runtime_dir, patch.object(
            data_fusion, "load_config", return_value={"Algorithm": {"WindRatio": 1.5333}, "Firebase_RTDB_Settings": {}}
        ), patch.object(data_fusion, "fetch_open_meteo_data", return_value={}), patch.object(
            data_fusion, "ForecastRtdb", FakeRtdb
        ):
            records = data_fusion.fuse_and_save_data(payload, runtime_dir, "job")

        self.assertEqual([row["timestamp"] for row in records], [
            "2026-01-01T08:00:00+08:00",
            "2026-01-01T09:00:00+08:00",
            "2026-01-01T10:00:00+08:00",
        ])
        self.assertEqual([row["cpc_wind_speed"] for row in records], [10.0, 15.0, 20.0])
        self.assertEqual(published[0][0], "job")


class PipelineLifecycleTests(unittest.TestCase):
    def test_update_handler_force_obeys_busy_lock_and_failure_status(self):
        module = ast.parse((Path(__file__).resolve().parents[1] / "backend" / "app.py").read_text(encoding="utf-8"))
        function = next(item for item in module.body if isinstance(item, ast.FunctionDef) and item.name == "update_forecast")
        function.decorator_list = []
        handler = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))
        for force in ("true", "false"):
            namespace = {"os": os, "get_env": get_env, "request": SimpleNamespace(args={"force": force, "pwd": "synthetic"}),
                         "jsonify": lambda payload: payload, "PipelineBusyError": PipelineBusyError}
            with patch.dict(os.environ, {"APP_PASSWORD": "synthetic"}):
                exec(compile(handler, "isolated_update_handler", "exec"), namespace)
                with patch.dict(namespace, {"run_pipeline": unittest.mock.Mock(side_effect=PipelineBusyError("busy"))}):
                    self.assertEqual(namespace["update_forecast"]()[1], 429)
                with patch.dict(namespace, {"run_pipeline": lambda date: False}):
                    self.assertEqual(namespace["update_forecast"]()[1], 500)

    def test_forced_update_requires_cleanly_configured_password(self):
        module = ast.parse((Path(__file__).resolve().parents[1] / "backend" / "app.py").read_text(encoding="utf-8"))
        function = next(item for item in module.body if isinstance(item, ast.FunctionDef) and item.name == "update_forecast")
        function.decorator_list = []
        request = SimpleNamespace(args={})
        run_pipeline = unittest.mock.Mock(return_value=True)
        namespace = {"os": os, "get_env": get_env, "request": request, "run_pipeline": run_pipeline,
                     "jsonify": lambda payload: payload, "PipelineBusyError": PipelineBusyError}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[])), "isolated_update_handler", "exec"), namespace)

        request.args = {"force": "true", "pwd": "configured-password"}
        with patch.dict(os.environ, {"APP_PASSWORD": ""}):
            self.assertEqual(namespace["update_forecast"]()[1], 503)
        run_pipeline.assert_not_called()

        with patch.dict(os.environ, {"APP_PASSWORD": "configured-password"}):
            request.args["pwd"] = "wrong-password"
            self.assertEqual(namespace["update_forecast"]()[1], 403)
        run_pipeline.assert_not_called()

        with patch.dict(os.environ, {"APP_PASSWORD": "\ufeff configured-password \n"}):
            request.args["pwd"] = "configured-password"
            self.assertEqual(namespace["update_forecast"]()[1], 200)
        run_pipeline.assert_called_once_with(None)

    def test_publish_failure_makes_pipeline_fail(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(main, "download_forecast_attachment", return_value="mock.doc"), patch.object(
            main, "convert_doc_to_docx"
        ), patch.object(main, "extract_image_from_docx"), patch.object(main, "parse_chart_with_cv2", return_value={"points": [1]}), patch.object(
            main, "fuse_and_save_data", side_effect=RtdbError("publication failed")
        ):
            self.assertFalse(main._run_pipeline_impl("0101", directory, "job"))

    def test_busy_lock_stops_pipeline_before_any_work(self):
        class BusyRtdb:
            def __init__(self, _settings):
                pass

            def acquire_lock(self, *_args):
                raise PipelineBusyError("busy")

        with patch.object(main, "load_config", return_value={}), patch.object(main, "ForecastRtdb", BusyRtdb), patch.object(
            main, "_run_pipeline_impl"
        ) as run:
            with self.assertRaises(PipelineBusyError):
                main.run_pipeline("0101")
        run.assert_not_called()

    def test_run_releases_lock_and_removes_only_its_runtime_directory(self):
        calls = []

        class FakeRtdb:
            def __init__(self, _settings):
                pass

            def acquire_lock(self, owner, ttl):
                calls.append(("acquire", owner, ttl))

            def release_lock(self, owner):
                calls.append(("release", owner))

        with tempfile.TemporaryDirectory() as base_dir, patch.object(main, "BASE_DIR", base_dir), patch.object(
            main, "ForecastRtdb", FakeRtdb
        ), patch.object(main, "load_config", return_value={}), patch.object(
            main, "_run_pipeline_impl", return_value=True
        ) as run:
            self.assertTrue(main.run_pipeline("0101"))
            runtime_dir = run.call_args.args[1]
            self.assertFalse(os.path.exists(runtime_dir))
        self.assertEqual(calls[0][0], "acquire")
        self.assertEqual(calls[-1][0], "release")


if __name__ == "__main__":
    unittest.main()
