"""Build Firebase Hosting assets from the single frontend source directory."""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import sys
import tempfile
import time
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


def _clear_readonly(path: Path) -> None:
    """Clear Windows ReadOnly flag so staging and sync operations can modify or delete paths."""
    try:
        os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
    except OSError:
        pass


def _remove_tree(path: Path) -> None:
    """Remove a directory tree even if Windows ReadOnly attributes are set on nested entries."""
    if not path.exists():
        return

    def _handle_readonly(func, target_path: str, _exc) -> None:
        target = Path(target_path)
        _clear_readonly(target.parent)
        _clear_readonly(target)
        func(target_path)

    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_handle_readonly)
    else:
        shutil.rmtree(path, onerror=lambda func, target_path, exc: _handle_readonly(func, target_path, exc[1]))


def _sync_directory_in_place(source_dir: Path, target_dir: Path) -> None:
    """Replace contents of target_dir with source_dir when Windows locks block directory rename."""
    target_dir.mkdir(parents=True, exist_ok=True)
    _clear_readonly(target_dir)

    for existing in sorted(target_dir.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        _clear_readonly(existing)
        rel = existing.relative_to(target_dir)
        src_match = source_dir / rel
        if existing.is_dir():
            if not src_match.is_dir():
                _remove_tree(existing)
        elif not src_match.is_file():
            existing.unlink()

    for src_item in sorted(source_dir.rglob("*")):
        rel = src_item.relative_to(source_dir)
        dst_item = target_dir / rel
        if src_item.is_dir():
            dst_item.mkdir(parents=True, exist_ok=True)
            _clear_readonly(dst_item)
        else:
            dst_item.parent.mkdir(parents=True, exist_ok=True)
            _clear_readonly(dst_item.parent)
            if dst_item.exists():
                _clear_readonly(dst_item)
            shutil.copy2(src_item, dst_item)
            _clear_readonly(dst_item)


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
        _clear_readonly(site)
        for item in site.rglob("*"):
            _clear_readonly(item)
        shutil.copy2(source / "pwa.png", site / "pwa-192x192.png")
        shutil.copy2(source / "presentation" / "notification_option_C.mp3", site / "notification_option_C.mp3")
        missing = validate_resources(site)
        if missing:
            raise RuntimeError("Hosting build stopped; missing local resources:\n" + "\n".join(missing))

        in_place_fallback = False
        if public.exists():
            replaced_public = False
            for attempt in range(3):
                try:
                    public.replace(backup)
                    replaced_public = True
                    break
                except PermissionError:
                    if attempt < 2:
                        time.sleep(0.2)
            if not replaced_public:
                shutil.copytree(public, backup)
                _clear_readonly(backup)
                for item in backup.rglob("*"):
                    _clear_readonly(item)
                try:
                    _sync_directory_in_place(site, public)
                    missing_after = validate_resources(public)
                    if missing_after:
                        raise RuntimeError(
                            "Hosting build stopped; missing local resources:\n" + "\n".join(missing_after)
                        )
                    in_place_fallback = True
                except Exception:
                    try:
                        _sync_directory_in_place(backup, public)
                    except Exception:
                        pass
                    raise

        if not in_place_fallback:
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
        _remove_tree(stage)


if __name__ == "__main__":
    try:
        build()
    except Exception as exc:
        print(f"Hosting build failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
