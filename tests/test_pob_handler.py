import importlib.util
import io
import os
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
APP_PATH = BACKEND / "app.py"
sys.path.insert(0, str(BACKEND))
from src import cv2_parser
from src.config import get_env, load_config
from src.pob_parser import TAIWAN_TZ, parse_pob_message


def taiwan_ms(year: int, month: int, day: int, hour: int, minute: int) -> int:
    return int(datetime(year, month, day, hour, minute, tzinfo=TAIWAN_TZ).timestamp() * 1000)


def fake_sdk_modules():
    flask = types.ModuleType("flask")

    class Flask:
        def __init__(self, _name):
            pass

        def route(self, *_args, **_kwargs):
            return lambda function: function

    flask.Flask = Flask
    flask.request = SimpleNamespace()
    flask.jsonify = lambda value: value
    flask.abort = lambda status: (_ for _ in ()).throw(RuntimeError(status))
    flask_cors = types.ModuleType("flask_cors")
    flask_cors.CORS = lambda _app: None
    main = types.ModuleType("main")
    main.run_pipeline = lambda _target_date: True
    rtdb = types.ModuleType("src.rtdb")
    rtdb.PipelineBusyError = type("PipelineBusyError", (Exception,), {})

    linebot = types.ModuleType("linebot")
    linebot.__path__ = []
    v3 = types.ModuleType("linebot.v3")

    class WebhookHandler:
        def __init__(self, _secret):
            pass

        def add(self, *_args, **_kwargs):
            return lambda function: function

    v3.WebhookHandler = WebhookHandler
    exceptions = types.ModuleType("linebot.v3.exceptions")
    exceptions.InvalidSignatureError = type("InvalidSignatureError", (Exception,), {})
    webhooks = types.ModuleType("linebot.v3.webhooks")
    webhooks.MessageEvent = type("MessageEvent", (), {})
    webhooks.TextMessageContent = type("TextMessageContent", (), {})
    linebot.v3 = v3
    return {
        "flask": flask,
        "flask_cors": flask_cors,
        "main": main,
        "src.rtdb": rtdb,
        "linebot": linebot,
        "linebot.v3": v3,
        "linebot.v3.exceptions": exceptions,
        "linebot.v3.webhooks": webhooks,
    }


class PobParserTests(unittest.TestCase):
    EVENT_TS = taiwan_ms(2026, 11, 6, 5, 58)

    def test_standard_message_matches_ac01(self):
        msg = "台中廠: LNG船 Orion Sea 已於115/11/06(五)05:45POB，準備進行卸收作業。"
        parsed = parse_pob_message(msg, event_timestamp_ms=self.EVENT_TS)
        self.assertEqual(
            parsed,
            {
                "ship_name": "Orion Sea",
                "date": "2026-11-06",
                "time": "05:45",
                "date_source": "message",
            },
        )

    def test_variants_table_ac02(self):
        cases = (
            ("臺中廠：Orion Sea 已於 05：45 pob", "Orion Sea", "05:45", "event"),
            ("【通報】台中廠 LNG 船 「Seri Dayang」已於 2026/11/06 05:45 POB", "Seri Dayang", "05:45", "message"),
            ("台中廠 Orion Sea 已於 11/6 (週五) 5:45 POB", "Orion Sea", "05:45", "message"),
            ("台中廠: LNG船 Orion Sea 已於 115.11.06（星期五）0545pob", "Orion Sea", "05:45", "message"),
            ("台中廠: LNG船 Orion Sea 已於\n115年11月6日\u30005點45分 POB", "Orion Sea", "05:45", "message"),
            ("台中廠: LNG船 Orion Sea 已於 ０５：４５ POB", "Orion Sea", "05:45", "event"),
        )
        for text, expected_ship, expected_time, expected_source in cases:
            with self.subTest(text=text):
                parsed = parse_pob_message(text, event_timestamp_ms=self.EVENT_TS)
                self.assertIsNotNone(parsed)
                self.assertEqual(parsed["ship_name"], expected_ship)
                self.assertEqual(parsed["time"], expected_time)
                self.assertEqual(parsed["date_source"], expected_source)

    def test_invalid_and_negative_cases_ac03(self):
        invalid_cases = (
            "台中廠: LNG船 Orion Sea 已於115/02/30(五)05:45POB",
            "台中廠: LNG船 Orion Sea 已於115/11/05(四)05:45POB",
            "台中廠: LNG船 Orion Sea 已於115/11/07(六)05:45POB",
            "台中廠: LNG船 Orion Sea 已於03:59POB",
            "台中廠: LNG船 Orion Sea 已於17:01POB",
            "台中廠: LNG船 Orion Sea 已於25:99POB",
            "台中廠: LNG船 Orion Sea 已於06:10POB",
            "台中廠: LNG船 Orion Sea 已於05:45POBX",
            "台中廠: LNG船  已於05:45POB",
            "台中廠: 測試。Orion 已於05:45POB",
            "永安廠: LNG船 Orion Sea 已於05:45POB",
        )
        for text in invalid_cases:
            with self.subTest(text=text):
                self.assertIsNone(parse_pob_message(text, event_timestamp_ms=self.EVENT_TS))


class PobHandlerTests(unittest.TestCase):
    EVENT_TS_MORNING = taiwan_ms(2026, 11, 6, 5, 58)
    EVENT_TS_EVENING = taiwan_ms(2026, 11, 6, 17, 0)

    def import_app(self):
        config = types.ModuleType("src.config")
        config.BASE_DIR = tempfile.gettempdir()
        config.load_config = lambda: {"line_bot": {}}
        config.get_env = get_env
        module_name = "pob_app_under_test"
        sys.modules.pop(module_name, None)
        with patch.dict(sys.modules, {"src.config": config, **fake_sdk_modules()}):
            spec = importlib.util.spec_from_file_location(module_name, APP_PATH)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        return module

    def test_matching_message_starts_background_thread(self):
        module = self.import_app()
        for text in ("台中廠: LNG船 Orion Sea 已於 04:55 POB", "臺中廠 Orion Sea 已於 04:55 POB"):
            with self.subTest(text=text):
                event = SimpleNamespace(message=SimpleNamespace(text=text), timestamp=self.EVENT_TS_MORNING)
                with patch.object(module.threading, "Thread") as thread:
                    module.handle_message(event)
                thread.assert_called_once_with(
                    target=module._process_pob_async,
                    args=(text, self.EVENT_TS_MORNING),
                    daemon=False,
                )
                thread.return_value.start.assert_called_once_with()

    def test_non_matching_message_does_not_start_background_thread(self):
        module = self.import_app()
        for text in ("天氣正常", "永安廠: LNG船 Orion Sea 已於 04:55 POB", "台中廠 Orion Sea 04:55 POB"):
            with self.subTest(text=text):
                event = SimpleNamespace(message=SimpleNamespace(text=text), timestamp=self.EVENT_TS_MORNING)
                with patch.object(module.threading, "Thread") as thread:
                    module.handle_message(event)
                thread.assert_not_called()

    def test_pob_delegation_uses_clean_password_in_request_params(self):
        module = self.import_app()
        response = MagicMock(status_code=200)
        response.json.return_value = {"status": "success"}
        with patch.dict(os.environ, {"APP_PASSWORD": "\ufeff configured-password \n"}), patch.object(
            module.requests, "get", return_value=response
        ) as get, redirect_stdout(io.StringIO()):
            module._process_pob_async("台中廠: LNG船 Orion Sea 已於 04:55 POB", self.EVENT_TS_MORNING)
        get.assert_called_once_with(
            "https://script.google.com/macros/s/AKfycbzlLKwqWEWqibSIUYMUYAHamsvT5oxSdVmlSprD6LhaDpCuyUkbXfrjuLB_TequEWF3/exec",
            params={"action": "set_mode", "mode": "reset", "pob_time": "04:55", "pwd": "configured-password"},
            timeout=30,
            allow_redirects=True,
        )
        response.raise_for_status.assert_called_once_with()

    def test_pob_delegation_stops_without_password_and_hides_request_details_on_failure(self):
        module = self.import_app()
        with patch.dict(os.environ, {"APP_PASSWORD": ""}), patch.object(module.requests, "get") as get, redirect_stdout(
            io.StringIO()
        ):
            module._process_pob_async("台中廠: LNG船 Orion Sea 已於 04:55 POB", self.EVENT_TS_MORNING)
        get.assert_not_called()

        error = module.requests.HTTPError("unsafe request detail")
        error.response = SimpleNamespace(status_code=502)
        response = MagicMock(status_code=502)
        response.raise_for_status.side_effect = error
        with patch.dict(os.environ, {"APP_PASSWORD": "configured-password"}), patch.object(
            module.requests, "get", return_value=response
        ), redirect_stdout(io.StringIO()) as output:
            module._process_pob_async("台中廠: LNG船 Orion Sea 已於 04:55 POB", self.EVENT_TS_MORNING)
        self.assertIn("HTTPError", output.getvalue())
        self.assertIn("HTTP 502", output.getvalue())
        self.assertNotIn("unsafe request detail", output.getvalue())

    def test_invalid_pob_times_do_not_delegate_to_gas(self):
        module = self.import_app()
        invalid_messages = (
            "台中廠: LNG船 Orion Sea 已於 POB",
            "台中廠: LNG船 Orion Sea 已於 25:99 POB",
            "台中廠: LNG船 Orion Sea 已於 03:59 POB",
            "台中廠: LNG船 Orion Sea 已於 17:01 POB",
            "台中廠: LNG船 Orion Sea 已於 115/02/30 04:55 POB",
            "台中廠: LNG船 Orion Sea 已於 06:10 POB",
        )
        with patch.dict(os.environ, {"APP_PASSWORD": "configured-password"}), patch.object(module.requests, "get") as get:
            for msg in invalid_messages:
                with redirect_stdout(io.StringIO()):
                    module._process_pob_async(msg, self.EVENT_TS_MORNING)
        get.assert_not_called()

    def test_gas_business_error_is_not_reported_as_success(self):
        module = self.import_app()
        response = MagicMock(status_code=200)
        response.json.return_value = {"status": "error"}
        with patch.dict(os.environ, {"APP_PASSWORD": "configured-password"}), patch.object(
            module.requests, "get", return_value=response
        ), redirect_stdout(io.StringIO()) as output:
            module._process_pob_async("台中廠: LNG船 Orion Sea 已於 04:55 POB", self.EVENT_TS_MORNING)
        self.assertIn("rejected", output.getvalue())
        self.assertNotIn("委託完成", output.getvalue())

    def test_pob_time_boundaries_delegate_to_gas(self):
        module = self.import_app()
        response = MagicMock(status_code=200)
        response.json.return_value = {"status": "success"}
        with patch.dict(os.environ, {"APP_PASSWORD": "configured-password"}), patch.object(
            module.requests, "get", return_value=response
        ) as get:
            for pob_time in ("04:00", "17:00"):
                with redirect_stdout(io.StringIO()):
                    module._process_pob_async(
                        f"台中廠: LNG船 Orion Sea 已於 {pob_time} POB",
                        self.EVENT_TS_EVENING,
                    )
        self.assertEqual([call.kwargs["params"]["pob_time"] for call in get.call_args_list], ["04:00", "17:00"])


class GeminiModelConfigAndFallbackTests(unittest.TestCase):
    def setUp(self):
        cv2_parser.clear_gemini_model_cache()

    def test_gemini_model_name_env_override_and_default(self):
        with patch("src.config.os.path.exists", return_value=False):
            with patch.dict(os.environ, {}, clear=True):
                cfg = load_config()
                self.assertEqual(cfg["Algorithm"]["GeminiModelName"], "gemini-4-hydrogen")
            with patch.dict(os.environ, {"GEMINI_MODEL_NAME": "\ufeff gemini-4-argon \n"}, clear=True):
                cfg = load_config()
                self.assertEqual(cfg["Algorithm"]["GeminiModelName"], "gemini-4-argon")

    def test_cv2_parser_falls_back_to_list_models_on_404(self):
        dummy_img = np.zeros((10, 10, 3), dtype=np.uint8)
        post_404 = MagicMock(status_code=404, text="model not found")
        post_ok = MagicMock(status_code=200)
        post_ok.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": "00Z25SEP"}]}}]
        }
        list_ok = MagicMock(status_code=200)
        list_ok.json.return_value = {
            "models": [
                {"name": "models/gemini-4-carbon", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-4-hydrogen-tts", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-embedding-001", "supportedGenerationMethods": ["embedContent"]},
                {"name": "models/gemini-4-hydrogen", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent"]},
            ]
        }

        with patch("src.config.load_config", return_value={
            "GeminiApiKey": "synthetic-key",
            "Algorithm": {"GeminiModelName": "gemini-2.5-flash"},
        }), patch.object(cv2_parser.requests, "post", side_effect=[post_404, post_ok]) as post_mock, patch.object(
            cv2_parser.requests, "get", return_value=list_ok
        ) as get_mock, redirect_stdout(io.StringIO()):
            tag = cv2_parser.get_initial_time_via_gemini_vision(dummy_img)

        self.assertEqual(tag, "00Z25SEP")
        self.assertEqual(post_mock.call_count, 2)
        self.assertIn("models/gemini-2.5-flash:generateContent", post_mock.call_args_list[0].args[0])
        self.assertIn("models/gemini-4-hydrogen:generateContent", post_mock.call_args_list[1].args[0])
        get_mock.assert_called_once()

    def test_list_models_failure_is_not_cached(self):
        dummy_img = np.zeros((10, 10, 3), dtype=np.uint8)
        post_404 = MagicMock(status_code=404, text="model not found")
        list_503 = MagicMock(status_code=503, text="unavailable")
        list_ok = MagicMock(status_code=200)
        list_ok.json.return_value = {
            "models": [{"name": "models/gemini-4-hydrogen", "supportedGenerationMethods": ["generateContent"]}]
        }
        post_ok = MagicMock(status_code=200)
        post_ok.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": "12Z24SEP"}]}}]
        }

        with patch("src.config.load_config", return_value={
            "GeminiApiKey": "synthetic-key-2",
            "Algorithm": {"GeminiModelName": "gemini-retired"},
        }), patch.object(cv2_parser.requests, "post", side_effect=[post_404, post_404, post_ok]), patch.object(
            cv2_parser.requests, "get", side_effect=[list_503, list_ok]
        ) as get_mock, redirect_stdout(io.StringIO()):
            first = cv2_parser.get_initial_time_via_gemini_vision(dummy_img)
            second = cv2_parser.get_initial_time_via_gemini_vision(dummy_img)

        self.assertIsNone(first)
        self.assertEqual(second, "12Z24SEP")
        self.assertEqual(get_mock.call_count, 2)


if __name__ == "__main__":
    unittest.main()
