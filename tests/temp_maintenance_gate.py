"""Temporary cutover checks; remove after production acceptance as requested."""

import os
import importlib.util
import sys
import tempfile
import types
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import test_pob_handler


class MaintenanceTests(unittest.TestCase):
    def test_webhook_and_forecast_reject_without_starting_work(self):
        module = test_pob_handler.PobHandlerTests().import_app()
        handler = MagicMock()
        pipeline = MagicMock()
        with patch.object(module, 'handler', handler), patch.object(module, 'run_pipeline', pipeline):
            for value in ('true', 'unexpected', '\ufeff true '):
                with self.subTest(value=value), patch.dict(os.environ, {'MAINTENANCE_MODE': value}):
                    self.assertEqual(module.webhook()[1], 503)
                    self.assertEqual(module.update_forecast()[1], 503)
            handler.handle.assert_not_called()
            pipeline.assert_not_called()

    def test_disabled_forecast_uses_existing_flow(self):
        module = test_pob_handler.PobHandlerTests().import_app()
        module.request = SimpleNamespace(args={'force': 'false'})
        module.run_pipeline = MagicMock(return_value=True)
        with patch.dict(os.environ, {'MAINTENANCE_MODE': 'false'}):
            self.assertEqual(module.update_forecast()[1], 200)
        module.run_pipeline.assert_called_once_with(None)


@unittest.skipUnless(os.environ.get('RUN_REAL_FLASK') == '1', 'requires isolated Flask install')
class RealFlaskMaintenanceTests(unittest.TestCase):
    def test_real_http_responses_without_external_services(self):
        import flask

        fake_modules = test_pob_handler.fake_sdk_modules()
        fake_modules.pop('flask')
        config = types.ModuleType('src.config')
        config.BASE_DIR = tempfile.gettempdir()
        config.load_config = lambda: {'line_bot': {}, 'GeminiApiKey': ''}
        config.get_env = test_pob_handler.get_env
        name = 'maintenance_real_flask_test'
        spec = importlib.util.spec_from_file_location(name, test_pob_handler.APP_PATH)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'flask': flask, 'src.config': config, name: module, **fake_modules}):
            spec.loader.exec_module(module)
            module.handler = MagicMock()
            module.run_pipeline = MagicMock(return_value=True)
            client = module.app.test_client()
            with patch.dict(os.environ, {'MAINTENANCE_MODE': 'true'}):
                self.assertEqual(client.post('/webhook', data='{}').status_code, 503)
                self.assertEqual(client.get('/update_forecast').status_code, 503)
                self.assertEqual(client.post('/update_forecast').status_code, 503)
                self.assertEqual(client.get('/health').status_code, 200)
            module.handler.handle.assert_not_called()
            module.run_pipeline.assert_not_called()
            with patch.dict(os.environ, {'MAINTENANCE_MODE': 'false'}):
                self.assertEqual(client.get('/update_forecast').status_code, 200)
            module.run_pipeline.assert_called_once_with(None)


if __name__ == '__main__':
    unittest.main()
