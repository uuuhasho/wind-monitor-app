"""Stage the backend in an ASCII path; deploy only with --deploy after review."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path


REQUIRED = ("app.py", "main.py", "requirements.txt", "src")
PROJECT_ID = "newlngship"
SERVICE_NAME = "forecast-api-test"
REGION = "asia-southeast1"
DEFAULT_STAGING_PARENT = Path(r"C:\Users\hilla\Desktop\newlngship_clean")


def stage_backend(project: Path, staging_parent: Path) -> Path:
    project, staging_parent = project.resolve(), staging_parent.resolve()
    backend = project / "backend"
    missing = [name for name in REQUIRED if not (backend / name).exists()]
    if not (project / "deploy" / "Dockerfile").is_file():
        missing.append("deploy/Dockerfile")
    if missing:
        raise FileNotFoundError(f"backend is incomplete: {', '.join(missing)}")
    if staging_parent == project or staging_parent in project.parents or any(
        staging_parent == project / directory or (project / directory) in staging_parent.parents
        for directory in ("backend", "frontend", "gas", "deploy", "tests", ".git")
    ):
        raise ValueError("Clean staging target overlaps project sources")
    if staging_parent != DEFAULT_STAGING_PARENT.resolve() and staging_parent != (project / "runtime").resolve():
        raise ValueError("Staging target must be the named clean workspace or an isolated runtime directory")
    sources = list((backend / "src").rglob("*.py"))
    if not sources or any(
        path.is_symlink()
        for path in [backend, project / "deploy" / "Dockerfile"]
        + [backend / name for name in REQUIRED]
        + sources
    ):
        raise ValueError("Backend source must contain regular Python files")
    staging_parent.mkdir(parents=True, exist_ok=True)
    stage_dir = Path(tempfile.mkdtemp(prefix="backend-stage-", dir=staging_parent)).resolve()
    if stage_dir.parent != staging_parent or not stage_dir.is_dir():
        raise ValueError("Staging directory failed its parent guard")
    try:
        for name in REQUIRED:
            source = backend / name
            destination = stage_dir / name
            if source.is_dir():
                for module in sources:
                    target = destination / module.relative_to(source)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(module, target)
            else:
                shutil.copy2(source, destination)
        shutil.copy2(project / "deploy" / "Dockerfile", stage_dir / "Dockerfile")
        (stage_dir / ".gcloudignore").write_text(
            "config.json\nservice_account.json\n.env*\nenv.json\nruntime/\ndata.json\n**/__pycache__/\n",
            encoding="ascii",
        )
        (stage_dir / ".dockerignore").write_text(
            "**/config.json\n**/service_account.json\n**/.env*\n**/env.json\n**/__pycache__/\n",
            encoding="ascii",
        )
        sensitive = ("config.json", "service_account.json", "env.json", "data.json")
        if any(
            path.name.lower() in sensitive
            or path.name.lower().startswith(".env")
            or path.name.lower() in {"__pycache__", "runtime"}
            or path.is_symlink()
            for path in stage_dir.rglob("*")
        ):
            raise ValueError("Staged backend contains sensitive files")
    except Exception:
        if (
            stage_dir.resolve() == stage_dir
            and stage_dir.parent == staging_parent
            and stage_dir.name.startswith("backend-stage-")
        ):
            shutil.rmtree(stage_dir)
        raise
    print(f"Cloud Run source staged: {stage_dir}")
    return stage_dir


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deploy", action="store_true")
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    staging_parent = DEFAULT_STAGING_PARENT
    gcloud = shutil.which("gcloud") if args.deploy else None
    if args.deploy and not gcloud:
        raise RuntimeError("gcloud CLI is required for Cloud Run deployment.")
    clean_dir = stage_backend(project, staging_parent)
    if args.deploy:
        print(f"Deploying {SERVICE_NAME} to project {PROJECT_ID}, region {REGION}.")
        subprocess.run(
            [gcloud, "run", "deploy", SERVICE_NAME, "--project", PROJECT_ID, "--source", ".", "--region", REGION, "--allow-unauthenticated", "--execution-environment", "gen2", "--update-env-vars=FIREBASE_RTDB_PREFIX=/test"],
            cwd=clean_dir,
            check=True,
        )
    else:
        print("Build only. Re-run with --deploy after reviewing the staged source and rollback plan.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
