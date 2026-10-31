"""Build Firebase Hosting assets from the single frontend source directory."""

from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
import uuid
from pathlib import Path
from urllib.parse import unquote


RESOURCE_RE = re.compile(
    r"(?:src|href)\s*=\s*['\"]([^'\"]+)['\"]|new\s+Audio\(\s*['\"]([^'\"]+)['\"]\s*\)",
    re.IGNORECASE,
)
CSS_URL_RE = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", re.IGNORECASE)


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def local_resource(value: str) -> str | None:
    value = value.strip()
    if not value or value.startswith(("#", "//", "http:", "https:", "data:", "mailto:", "javascript:")):
        return None
    return unquote(value.split("?", 1)[0].split("#", 1)[0])


def validate_resources(site_dir: Path) -> list[str]:
    missing: list[str] = []
    for source_file in list(site_dir.rglob("*.html")) + list(site_dir.rglob("*.css")):
        text = source_file.read_text(encoding="utf-8")
        values = [next(value for value in match.groups() if value is not None) for match in RESOURCE_RE.finditer(text)]
        values.extend(match.group(1) for match in CSS_URL_RE.finditer(text))
        for value in values:
            resource = local_resource(value)
            if resource is None:
                continue
            target = site_dir / resource.lstrip("/") if resource.startswith("/") else source_file.parent / resource
            if not target.resolve().is_relative_to(site_dir.resolve()) or not target.is_file():
                missing.append(f"{source_file.relative_to(site_dir)} -> {resource}")

    for manifest in site_dir.rglob("*.json"):
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid JSON resource: {manifest.relative_to(site_dir)}") from error
        for icon in data.get("icons", []) if isinstance(data, dict) else []:
            resource = local_resource(str(icon.get("src", ""))) if isinstance(icon, dict) else None
            if resource:
                target = site_dir / resource.lstrip("/") if resource.startswith("/") else manifest.parent / resource
                if not target.resolve().is_relative_to(site_dir.resolve()) or not target.is_file():
                    missing.append(f"{manifest.relative_to(site_dir)} -> {resource}")
    return missing


def build(project: Path | None = None) -> Path:
    root = project or project_root()
    source = root / "frontend"
    public = root / "public"
    if not source.is_dir() or not (source / "index.html").is_file():
        raise FileNotFoundError("frontend/index.html is required before building Hosting output")
    if any(path.is_symlink() for path in source.rglob("*")):
        raise ValueError("Hosting sources must not contain symbolic links")

    stage = Path(tempfile.mkdtemp(prefix="hosting-stage-", dir=root))
    backup = root / f".public-previous-{uuid.uuid4().hex}"
    try:
        shutil.copytree(source, stage / "site", dirs_exist_ok=True)
        site = stage / "site"
        shutil.copy2(source / "pwa.png", site / "pwa-192x192.png")
        shutil.copy2(source / "presentation" / "notification_option_C.mp3", site / "notification_option_C.mp3")
        missing = validate_resources(site)
        if missing:
            raise RuntimeError("Hosting build stopped; missing local resources:\n" + "\n".join(missing))

        if public.exists():
            public.replace(backup)
        try:
            site.replace(public)
        except Exception:
            if backup.exists():
                backup.replace(public)
            raise
        if backup.exists():
            print(f"Previous Hosting output retained for rollback: {backup}")
        print(f"Hosting build complete: {public}")
        return public
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    try:
        build()
    except Exception as exc:
        print(f"Hosting build failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
