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
    def make_backend_project(self, root):
        backend = root / "backend"
        (backend / "src").mkdir(parents=True)
        for name in ("app.py", "main.py", "requirements.txt"):
            (backend / name).write_text(name, encoding="utf-8")
        (backend / "src" / "module.py").write_text("pass", encoding="utf-8")
        deploy = root / "deploy"
        deploy.mkdir()
        (deploy / "Dockerfile").write_text("FROM scratch", encoding="utf-8")

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
            self.make_backend_project(root)
            backend = root / "backend"
            (backend / "config.json").write_text("secret", encoding="utf-8")
            (backend / "src" / "service_account.json").write_text("synthetic-secret", encoding="utf-8")
            staging_parent = root / "runtime"
            clean = cloud_run.stage_backend(root, staging_parent)
            self.assertEqual(clean.parent, staging_parent)
            self.assertTrue(clean.name.startswith("backend-stage-"))
            self.assertTrue((clean / "app.py").is_file())
            self.assertTrue((clean / "src" / "module.py").is_file())
            self.assertFalse((clean / "config.json").exists())
            self.assertFalse((clean / "src" / "service_account.json").exists())
            self.assertIn("config.json", (clean / ".gcloudignore").read_text(encoding="ascii"))

    def test_existing_staging_parent_and_siblings_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_backend_project(root)
            staging_parent = root / "newlngship_clean"
            staging_parent.mkdir()
            old_files = ("old.txt", "old.bak", "__pycache__")
            for name in old_files:
                path = staging_parent / name
                if name == "__pycache__":
                    path.mkdir()
                    (path / "old.pyc").write_bytes(b"old")
                else:
                    path.write_text("preserve", encoding="utf-8")

            with patch.object(cloud_run, "DEFAULT_STAGING_PARENT", staging_parent):
                staged = cloud_run.stage_backend(root, staging_parent)

            self.assertEqual(staged.parent, staging_parent)
            for name in old_files:
                self.assertTrue((staging_parent / name).exists())
            self.assertTrue((staged / "app.py").is_file())

    def test_staging_failure_cleans_only_new_stage_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_backend_project(root)
            staging_parent = root / "runtime"
            staging_parent.mkdir()
            sibling = staging_parent / "keep"
            sibling.mkdir()
            (sibling / "old.txt").write_text("preserve", encoding="utf-8")

            with patch.object(cloud_run.shutil, "copy2", side_effect=OSError("synthetic copy failure")):
                with self.assertRaisesRegex(OSError, "synthetic copy failure"):
                    cloud_run.stage_backend(root, staging_parent)

            self.assertEqual(list(staging_parent.iterdir()), [sibling])
            self.assertEqual((sibling / "old.txt").read_text(encoding="utf-8"), "preserve")

    def test_missing_source_fails_without_touching_staging_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "backend" / "src").mkdir(parents=True)
            deploy = root / "deploy"
            deploy.mkdir()
            (deploy / "Dockerfile").write_text("FROM scratch", encoding="utf-8")
            staging_parent = root / "runtime"
            staging_parent.mkdir()
            sibling = staging_parent / "keep.txt"
            sibling.write_text("preserve", encoding="utf-8")

            with self.assertRaisesRegex(FileNotFoundError, "backend is incomplete"):
                cloud_run.stage_backend(root, staging_parent)

            self.assertEqual(list(staging_parent.iterdir()), [sibling])
            self.assertEqual(sibling.read_text(encoding="utf-8"), "preserve")

    def test_dockerfile_symlink_is_rejected_before_staging(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_backend_project(root)
            dockerfile = root / "deploy" / "Dockerfile"
            original_is_symlink = Path.is_symlink

            def mark_dockerfile_symlink(path):
                return path == dockerfile or original_is_symlink(path)

            with patch.object(Path, "is_symlink", mark_dockerfile_symlink):
                with self.assertRaisesRegex(ValueError, "regular Python files"):
                    cloud_run.stage_backend(root, root / "runtime")

            self.assertFalse((root / "runtime").exists())

    def test_sensitive_file_in_stage_fails_closed_and_preserves_siblings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.make_backend_project(root)
            staging_parent = root / "runtime"
            staging_parent.mkdir()
            sibling = staging_parent / "keep"
            sibling.mkdir()
            (sibling / "old.txt").write_text("preserve", encoding="utf-8")
            copy2 = cloud_run.shutil.copy2

            def copy_with_sensitive_file(source, target):
                result = copy2(source, target)
                (Path(target).parent / ".env.injected").write_text("synthetic", encoding="utf-8")
                return result

            with patch.object(cloud_run.shutil, "copy2", side_effect=copy_with_sensitive_file):
                with self.assertRaisesRegex(ValueError, "contains sensitive files"):
                    cloud_run.stage_backend(root, staging_parent)

            self.assertEqual(list(staging_parent.iterdir()), [sibling])
            self.assertEqual((sibling / "old.txt").read_text(encoding="utf-8"), "preserve")

    def test_deploy_pins_project_and_reports_target(self):
        with patch.object(sys, "argv", ["deploy_cloud_run.py", "--deploy"]), patch.object(
            cloud_run, "stage_backend"
        ) as stage, patch.object(cloud_run.shutil, "which", return_value="C:/synthetic/gcloud.cmd"), patch.object(
            cloud_run.subprocess, "run"
        ) as run, patch("builtins.print") as output:
            self.assertEqual(cloud_run.main(), 0)
        stage.assert_called_once_with(
            Path(__file__).resolve().parents[1], cloud_run.DEFAULT_STAGING_PARENT
        )
        run.assert_called_once_with(
            ["C:/synthetic/gcloud.cmd", "run", "deploy", "forecast-api-test", "--project", "newlngship", "--source", ".",
             "--region", "asia-southeast1", "--allow-unauthenticated", "--execution-environment", "gen2",
             "--update-env-vars=FIREBASE_RTDB_PREFIX=/test"],
            cwd=stage.return_value,
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

    def test_stage_failure_does_not_deploy(self):
        with patch.object(sys, "argv", ["deploy_cloud_run.py", "--deploy"]), patch.object(
            cloud_run.shutil, "which", return_value="C:/synthetic/gcloud.cmd"
        ), patch.object(cloud_run, "stage_backend", side_effect=ValueError("stage failed")) as stage, patch.object(
            cloud_run.subprocess, "run"
        ) as run:
            with self.assertRaisesRegex(ValueError, "stage failed"):
                cloud_run.main()

        stage.assert_called_once()
        run.assert_not_called()

    def test_default_build_does_not_invoke_gcloud(self):
        with patch.object(sys, "argv", ["deploy_cloud_run.py"]), patch.object(
            cloud_run, "stage_backend"
        ) as stage, patch.object(cloud_run.shutil, "which") as which, patch.object(
            cloud_run.subprocess, "run"
        ) as run:
            self.assertEqual(cloud_run.main(), 0)
        stage.assert_called_once()
        which.assert_not_called()
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
