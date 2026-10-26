import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hosting = load_module("build_hosting", ROOT / "deploy" / "build_hosting.py")
cloud_run = load_module("deploy_cloud_run", ROOT / "deploy" / "deploy_cloud_run.py")


class HostingBuildTests(unittest.TestCase):
    def make_project(self, root):
        frontend = root / "frontend"
        frontend.mkdir()
        (frontend / "index.html").write_text('<img src="logo.png"><link href="manifest.json">', encoding="utf-8")
        (frontend / "logo.png").write_bytes(b"logo")
        (frontend / "pwa.png").write_bytes(b"icon")
        (frontend / "manifest.json").write_text('{"icons":[{"src":"pwa.png"}]}', encoding="utf-8")
        presentation = frontend / "presentation"
        presentation.mkdir()
        (presentation / "notification_option_C.mp3").write_bytes(b"sound")

    def test_build_replaces_output_after_resource_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_project(root)
            (root / "public").mkdir()
            (root / "public" / "old.txt").write_text("old", encoding="utf-8")
            hosting.build(root)
            self.assertTrue((root / "public" / "index.html").is_file())
            self.assertTrue((root / "public" / "pwa-192x192.png").is_file())
            self.assertEqual((root / "public" / "notification_option_C.mp3").read_bytes(),
                             (root / "public" / "presentation" / "notification_option_C.mp3").read_bytes())
            self.assertFalse((root / "public" / "old.txt").exists())

    def test_missing_asset_keeps_existing_public_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_project(root)
            (root / "frontend" / "index.html").write_text('<img src="missing.png">', encoding="utf-8")
            (root / "public").mkdir()
            sentinel = root / "public" / "keep.txt"
            sentinel.write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "missing local resources"):
                hosting.build(root)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")


class CloudRunStagingTests(unittest.TestCase):
    def test_source_overlap_is_rejected_without_deletion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "backend" / "src").mkdir(parents=True)
            for name in ("app.py", "main.py", "requirements.txt"):
                (root / "backend" / name).write_text("pass", encoding="utf-8")
            (root / "deploy").mkdir()
            (root / "deploy" / "Dockerfile").write_text("FROM scratch", encoding="utf-8")
            with self.assertRaises(ValueError):
                cloud_run.stage_backend(root, root)
            self.assertTrue((root / "backend" / "main.py").exists())

    def test_staging_copies_only_backend_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backend = root / "backend"
            (backend / "src").mkdir(parents=True)
            for name in ("app.py", "main.py", "requirements.txt"):
                (backend / name).write_text(name, encoding="utf-8")
            (backend / "src" / "module.py").write_text("pass", encoding="utf-8")
            (backend / "config.json").write_text("secret", encoding="utf-8")
            (backend / "src" / "service_account.json").write_text("synthetic-secret", encoding="utf-8")
            deploy = root / "deploy"
            deploy.mkdir()
            (deploy / "Dockerfile").write_text("FROM scratch", encoding="utf-8")
            clean = root / "runtime" / "clean"
            cloud_run.stage_backend(root, clean)
            self.assertTrue((clean / "app.py").is_file())
            self.assertTrue((clean / "src" / "module.py").is_file())
            self.assertFalse((clean / "config.json").exists())
            self.assertFalse((clean / "src" / "service_account.json").exists())
            self.assertIn("config.json", (clean / ".gcloudignore").read_text(encoding="ascii"))

    def test_deploy_pins_project_and_reports_target(self):
        with patch.object(sys, "argv", ["deploy_cloud_run.py", "--deploy"]), patch.object(
            cloud_run, "stage_backend"
        ) as stage, patch.object(cloud_run.shutil, "which", return_value="C:/synthetic/gcloud.cmd"), patch.object(
            cloud_run.subprocess, "run"
        ) as run, patch("builtins.print") as output:
            self.assertEqual(cloud_run.main(), 0)
        stage.assert_called_once()
        run.assert_called_once_with(
            ["C:/synthetic/gcloud.cmd", "run", "deploy", "forecast-api-test", "--project", "newlngship", "--source", ".",
             "--region", "asia-southeast1", "--allow-unauthenticated", "--execution-environment", "gen2",
             "--update-env-vars=FIREBASE_RTDB_PREFIX=/test"],
            cwd=Path(r"C:\Users\hilla\Desktop\newlngship_clean"),
            check=True,
        )
        output.assert_any_call("Deploying forecast-api-test to project newlngship, region asia-southeast1.")

    def test_missing_gcloud_stops_before_staging_or_deploy(self):
        with patch.object(sys, "argv", ["deploy_cloud_run.py", "--deploy"]), patch.object(
            cloud_run.shutil, "which", return_value=None
        ), patch.object(cloud_run, "stage_backend") as stage, patch.object(cloud_run.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "gcloud CLI is required"):
                cloud_run.main()
        stage.assert_not_called()
        run.assert_not_called()

    def test_default_build_does_not_invoke_gcloud(self):
        with patch.object(sys, "argv", ["deploy_cloud_run.py"]), patch.object(
            cloud_run, "stage_backend"
        ), patch.object(cloud_run.subprocess, "run") as run:
            self.assertEqual(cloud_run.main(), 0)
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
