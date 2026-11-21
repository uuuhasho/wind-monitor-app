# 2026-11-21 build_hosting Windows 目錄權限與鎖定失敗原因分析

## 1. 錯誤現象

在 Windows 工作區執行 Hosting 建置腳本 `python deploy/build_hosting.py` 時，建置偶發失敗並拋出權限拒絕錯誤，同時於工作區根目錄殘留 `hosting-stage-*` 暫存資料夾：

```text
Hosting build failed: [WinError 5] 存取被拒。: 'C:\Users\hilla\Desktop\opencode桌面\奶昔APP\hosting-stage-w4tzgbjs\site\presentation\icons'
```

## 2. 根因分析

經實測（`attrib`、Windows Restart Manager `rstrtmgr` 檔案鎖檢查與隔離重現測試）確認為兩項 Windows 目錄屬性與檔案鎖交互導致：

1. **只讀目錄屬性遮蔽原錯**：`frontend/presentation/icons` 在 Windows 檔案系統帶有 `ReadOnly (R)` 目錄屬性；`build_hosting.py` 使用 `shutil.copytree(source, stage / "site")` 連帶複製該屬性。只要 `try:` 區塊發生任何例外（例如資源驗證失敗或 `public.replace(backup)` 失敗），`finally:` 執行原生 `shutil.rmtree(stage)` 時即在只讀的 `site/presentation/icons` 目錄拋出 `PermissionError [WinError 5]`，不僅殘留 `hosting-stage-*`，更會掩蓋原本的例外訊息。
2. **Windows 目錄控制代碼阻斷原子更名**：即使 `public/` 內 43 個檔案皆未鎖定（`RmGetList` 回傳 `NEEDED_PROCS: 0`），當系統索引器、檔案總管或背景進程持有 `public/` 目錄控制代碼時，`public.replace(backup)` 仍會拋出 `PermissionError [WinError 5]`，繼而觸發第 1 項 `shutil.rmtree(stage)` 失敗。

## 3. 代碼 diff

### `deploy/build_hosting.py`

```diff
--- a/deploy/build_hosting.py
+++ b/deploy/build_hosting.py
@@ -3,10 +3,13 @@
 from __future__ import annotations
 
 import json
+import os
 import re
 import shutil
+import stat
 import sys
 import tempfile
+import time
 import uuid
 from pathlib import Path
 from urllib.parse import unquote
@@ -58,6 +61,61 @@ def validate_resources(site_dir: Path) -> list[str]:
     return missing
 
 
+def _clear_readonly(path: Path) -> None:
+    """Clear Windows ReadOnly flag so staging and sync operations can modify or delete paths."""
+    try:
+        os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
+    except OSError:
+        pass
+
+
+def _remove_tree(path: Path) -> None:
+    """Remove a directory tree even if Windows ReadOnly attributes are set on nested entries."""
+    if not path.exists():
+        return
+
+    def _handle_readonly(func, target_path: str, _exc) -> None:
+        target = Path(target_path)
+        _clear_readonly(target.parent)
+        _clear_readonly(target)
+        func(target_path)
+
+    if sys.version_info >= (3, 12):
+        shutil.rmtree(path, onexc=_handle_readonly)
+    else:
+        shutil.rmtree(path, onerror=lambda func, target_path, exc: _handle_readonly(func, target_path, exc[1]))
+
+
+def _sync_directory_in_place(source_dir: Path, target_dir: Path) -> None:
+    """Replace contents of target_dir with source_dir when Windows locks block directory rename."""
+    ...
+
+
 def build(project: Path | None = None) -> Path:
     ...
     try:
         shutil.copytree(source, stage / "site", dirs_exist_ok=True)
         site = stage / "site"
+        _clear_readonly(site)
+        for item in site.rglob("*"):
+            _clear_readonly(item)
         ...
+        in_place_fallback = False
         if public.exists():
-            public.replace(backup)
+            replaced_public = False
+            for attempt in range(3):
+                try:
+                    public.replace(backup)
+                    replaced_public = True
+                    break
+                except PermissionError:
+                    if attempt < 2:
+                        time.sleep(0.2)
+            if not replaced_public:
+                shutil.copytree(public, backup)
+                _clear_readonly(backup)
+                for item in backup.rglob("*"):
+                    _clear_readonly(item)
+                try:
+                    _sync_directory_in_place(site, public)
+                    missing_after = validate_resources(public)
+                    if missing_after:
+                        raise RuntimeError(
+                            "Hosting build stopped; missing local resources:\n" + "\n".join(missing_after)
+                        )
+                    in_place_fallback = True
+                except Exception:
+                    try:
+                        _sync_directory_in_place(backup, public)
+                    except Exception:
+                        pass
+                    raise
+
+        if not in_place_fallback:
+            try:
+                site.replace(public)
+            except Exception:
+                if backup.exists():
+                    backup.replace(public)
+                raise
     finally:
-        if stage.exists():
-            shutil.rmtree(stage)
+        _remove_tree(stage)
```

### `tests/test_build_hosting.py`

新增兩項回歸測試：
- `test_missing_asset_cleans_readonly_stage_without_masking_error`：驗證帶有 `stat.S_IREAD` 屬性的 `icons` 目錄不會於清理時掩蓋資源缺失例外，且不殘留 `hosting-stage-*`。
- `test_permission_error_on_public_rename_falls_back_to_in_place_sync`：模擬 `public.replace()` 遭遇 `PermissionError` 時，驗證能保留 `.public-previous-*` 備份並透過 `_sync_directory_in_place` 完成 `public/` 更新且清除舊檔案。

## 4. 驗證結果

- 執行 `python -m unittest tests/test_build_hosting.py tests/test_hosting_deploy.py`：
  - `Ran 23 tests in 4.888s — OK`
- 執行 `node tests/frontend-isolated.js`：
  - 結束碼 `0`
- 執行 `python deploy/build_hosting.py`：
  - 成功產出 `C:\Users\hilla\Desktop\opencode桌面\奶昔APP\public`（保留 `.public-previous-7bfb9730ab064f68bcb9b4acc711ae77` 供回復），`hosting-stage-*` 殘留數量為 `0`。
  - 靜態檢核 `public/presentation/intro.html` 為 `204048` bytes、`emojis: 0`，`public/index.html` 正確指向 `href="presentation/intro.html"`，`public/presentation/index.html` 已不存在。
