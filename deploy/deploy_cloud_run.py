"""Stage the backend in an ASCII path; deploy only with --deploy after review."""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


REQUIRED = ("app.py", "main.py", "requirements.txt", "src")


def stage_backend(project: Path, clean_dir: Path) -> Path:
    project, clean_dir = project.resolve(), clean_dir.resolve()
    backend = project / "backend"
    missing = [name for name in REQUIRED if not (backend / name).exists()]
    if not (project / "deploy" / "Dockerfile").is_file():
        missing.append("deploy/Dockerfile")
    if missing:
        raise FileNotFoundError(f"backend is incomplete: {', '.join(missing)}")
    if clean_dir == project or clean_dir in project.parents or any(
        clean_dir == project / directory or (project / directory) in clean_dir.parents
        for directory in ("backend", "frontend", "gas", "deploy", "tests", ".git")
    ):
        raise ValueError("Clean staging target overlaps project sources")
    if clean_dir != Path(r"C:\Users\hilla\Desktop\newlngship_clean") and clean_dir.parent != (project / "runtime").resolve():
        raise ValueError("Staging target must be the named clean workspace or an isolated runtime directory")
    sources = list((backend / "src").rglob("*.py"))
    if not sources or any(path.is_symlink() for path in [backend / name for name in REQUIRED] + sources):
        raise ValueError("Backend source must contain regular Python files")
    if clean_dir.exists():
        shutil.rmtree(clean_dir)
    clean_dir.mkdir(parents=True)
    for name in REQUIRED:
        source = backend / name
        destination = clean_dir / name
        if source.is_dir():
            for module in sources:
                target = destination / module.relative_to(source)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(module, target)
        else:
            shutil.copy2(source, destination)
    shutil.copy2(project / "deploy" / "Dockerfile", clean_dir / "Dockerfile")
    (clean_dir / ".gcloudignore").write_text(
        "config.json\nservice_account.json\n.env*\nenv.json\nruntime/\ndata.json\n**/__pycache__/\n",
        encoding="ascii",
    )
    (clean_dir / ".dockerignore").write_text(
        "**/config.json\n**/service_account.json\n**/.env*\n**/env.json\n**/__pycache__/\n",
        encoding="ascii",
    )
    print(f"Cloud Run source staged: {clean_dir}")
    return clean_dir


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deploy", action="store_true")
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    clean_dir = Path(r"C:\Users\hilla\Desktop\newlngship_clean")
    stage_backend(project, clean_dir)
    if args.deploy:
        subprocess.run(
            ["gcloud", "run", "deploy", "forecast-api-test", "--source", ".", "--region", "asia-southeast1", "--allow-unauthenticated", "--execution-environment", "gen2", "--update-env-vars=FIREBASE_RTDB_PREFIX=/test"],
            cwd=clean_dir,
            check=True,
        )
    else:
        print("Build only. Re-run with --deploy after reviewing the staged source and rollback plan.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
