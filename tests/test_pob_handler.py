import importlib.util
import io
import os
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
APP_PATH = BACKEND / "app.py"
sys.path.insert(0, str(BACKEND))
from src.config import get_env


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

    google = types.ModuleType("google")
    google.__path__ = []
    generativeai = types.ModuleType("google.generativeai")
    generativeai.configure = MagicMock()
    google.generativeai = generativeai

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
        "google": google,
        "google.generativeai": generativeai,
        "linebot": linebot,
        "linebot.v3": v3,
        "linebot.v3.exceptions": exceptions,
        "linebot.v3.webhooks": webhooks,
    }


class PobHandlerTests(unittest.TestCase):
    def import_app(self):
        config = types.ModuleType("src.config")
        config.BASE_DIR = tempfile.gettempdir()
        config.load_config = lambda: {"line_bot": {}, "GeminiApiKey": ""}
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
        text = "台中廠已於 04:55 POB"
        event = SimpleNamespace(message=SimpleNamespace(text=text))
        with patch.object(module.threading, "Thread") as thread:
            module.handle_message(event)
        thread.assert_called_once_with(target=module._process_pob_async, args=(text,), daemon=False)
        thread.return_value.start.assert_called_once_with()

    def test_non_matching_message_does_not_start_background_thread(self):
        module = self.import_app()
        event = SimpleNamespace(message=SimpleNamespace(text="天氣正常"))
        with patch.object(module.threading, "Thread") as thread:
            module.handle_message(event)
        thread.assert_not_called()

    def test_pob_delegation_uses_clean_password_in_request_params(self):
        module = self.import_app()
        module.gemini_api_key = "synthetic"
        model = MagicMock()
        model.generate_content.return_value = SimpleNamespace(text='{"status":"SUCCESS","time":"04:55"}')
        module.genai.GenerativeModel = MagicMock(return_value=model)
        response = MagicMock(status_code=200)
        response.json.return_value = {"status": "success"}
        with patch.dict(os.environ, {"APP_PASSWORD": "\ufeff configured-password \n"}), patch.object(
            module.requests, "get", return_value=response
        ) as get, redirect_stdout(io.StringIO()):
            module._process_pob_async("台中廠已於 04:55 POB")
        get.assert_called_once_with(
            "https://script.google.com/macros/s/AKfycbzlLKwqWEWqibSIUYMUYAHamsvT5oxSdVmlSprD6LhaDpCuyUkbXfrjuLB_TequEWF3/exec",
            params={"action": "set_mode", "mode": "reset", "pob_time": "04:55", "pwd": "configured-password"},
            timeout=30,
            allow_redirects=True,
        )
        response.raise_for_status.assert_called_once_with()

    def test_pob_delegation_stops_without_password_and_hides_request_details_on_failure(self):
        module = self.import_app()
        module.gemini_api_key = "synthetic"
        model = MagicMock()
        model.generate_content.return_value = SimpleNamespace(text='{"status":"SUCCESS","time":"04:55"}')
        module.genai.GenerativeModel = MagicMock(return_value=model)
        with patch.dict(os.environ, {"APP_PASSWORD": ""}), patch.object(module.requests, "get") as get, redirect_stdout(io.StringIO()):
            module._process_pob_async("台中廠已於 04:55 POB")
        get.assert_not_called()

        error = module.requests.HTTPError("unsafe request detail")
        error.response = SimpleNamespace(status_code=502)
        response = MagicMock(status_code=502)
        response.raise_for_status.side_effect = error
        with patch.dict(os.environ, {"APP_PASSWORD": "configured-password"}), patch.object(
            module.requests, "get", return_value=response
        ), redirect_stdout(io.StringIO()) as output:
            module._process_pob_async("台中廠已於 04:55 POB")
        self.assertIn("HTTPError", output.getvalue())
        self.assertIn("HTTP 502", output.getvalue())
        self.assertNotIn("unsafe request detail", output.getvalue())

    def test_invalid_pob_times_do_not_delegate_to_gas(self):
        module = self.import_app()
        module.gemini_api_key = "synthetic"
        model = MagicMock()
        module.genai.GenerativeModel = MagicMock(return_value=model)
        invalid_responses = (
            '{"status":"SUCCESS"}',
            '{"status":"SUCCESS","time":null}',
            '{"status":"SUCCESS","time":123}',
            '{"status":"SUCCESS","time":"25:99"}',
            '{"status":"SUCCESS","time":"03:59"}',
            '{"status":"SUCCESS","time":"17:01"}',
        )
        with patch.dict(os.environ, {"APP_PASSWORD": "configured-password"}), patch.object(module.requests, "get") as get:
            for response_text in invalid_responses:
                model.generate_content.return_value = SimpleNamespace(text=response_text)
                with redirect_stdout(io.StringIO()):
                    module._process_pob_async("台中廠已於 04:55 POB")
        get.assert_not_called()

    def test_gas_business_error_is_not_reported_as_success(self):
        module = self.import_app()
        module.gemini_api_key = "synthetic"
        model = MagicMock()
        model.generate_content.return_value = SimpleNamespace(text='{"status":"SUCCESS","time":"04:55"}')
        module.genai.GenerativeModel = MagicMock(return_value=model)
        response = MagicMock(status_code=200)
        response.json.return_value = {"status": "error"}
        with patch.dict(os.environ, {"APP_PASSWORD": "configured-password"}), patch.object(
            module.requests, "get", return_value=response
        ), redirect_stdout(io.StringIO()) as output:
            module._process_pob_async("台中廠已於 04:55 POB")
        self.assertIn("rejected", output.getvalue())
        self.assertNotIn("委託完成", output.getvalue())

    def test_pob_time_boundaries_delegate_to_gas(self):
        module = self.import_app()
        module.gemini_api_key = "synthetic"
        model = MagicMock()
        module.genai.GenerativeModel = MagicMock(return_value=model)
        response = MagicMock(status_code=200)
        response.json.return_value = {"status": "success"}
        with patch.dict(os.environ, {"APP_PASSWORD": "configured-password"}), patch.object(
            module.requests, "get", return_value=response
        ) as get:
            for pob_time in ("04:00", "17:00"):
                model.generate_content.return_value = SimpleNamespace(text=f'{{"status":"SUCCESS","time":"{pob_time}"}}')
                with redirect_stdout(io.StringIO()):
                    module._process_pob_async("台中廠已於 POB")
        self.assertEqual([call.kwargs["params"]["pob_time"] for call in get.call_args_list], ["04:00", "17:00"])


if __name__ == "__main__":
    unittest.main()
