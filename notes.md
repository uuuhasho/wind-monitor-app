# 專案筆記 (Project Notes)

## 📝 靈感沙盒與草稿區 (Sandbox / Drafts)

---

## 🚀 準備執行區 (Ready to Run)

### 🕒 2026-06-13 17:35 (代碼審查與 GitHub 同步更新)
- [x] 1. 仔細檢查 OCR 重構與跨平台修補代碼，確認無邏輯衝突與 Bug。
- [x] 2. 將「部署前須仔細檢查 bug 與邏輯衝突」的規則紀錄於全域 `GEMINI.md`。
- [x] 3. 將包含 OCR 改版的所有安全代碼 commit 並 push 到 GitHub。

**變更記錄 (Code Review and GitHub Sync)**：
* **實作變更**：
  * 重新檢視 `src/cv2_parser.py` 與 `.github/workflows/update_forecast.yml`，確認 fallback 邏輯與跨平台判斷皆正確無誤。
  * 於 `GEMINI.md` 中新增「部署前檢查」的開發偏好規則。
  * 將今日的變更（包含 `data.json`）進行 commit (`feat: integrate OCR and dynamic points calculation for chart parsing`)，並成功推送到 GitHub Repo，確保無縫對接自動化流程。

### 🕒 2026-06-13 17:28 (GitHub Actions 跨平台 OCR 設定)
- [x] 1. 解釋 `CONFIG_JSON` 與 `SERVICE_ACCOUNT_JSON` Secrets 需求。
- [x] 2. 修正 `src/cv2_parser.py` 加入 `os.name == 'nt'` 跨平台判斷，避免 GitHub Actions (Ubuntu) 崩潰。
- [x] 3. 修正 `.github/workflows/update_forecast.yml`，補上 `tesseract-ocr` 系統套件與 `pytesseract` Python 套件。

**變更記錄 (GitHub Actions Cross-Platform OCR)**：
* **實作變更**：
  * **Python 代碼**：修改了 `src/cv2_parser.py` 中的 Tesseract 執行檔路徑設定，將其包裝在 `if os.name == 'nt':` 條件判斷內，確保只在 Windows 本地端強制套用絕對路徑，Ubuntu 雲端則交由系統 PATH 處理。
  * **GitHub Workflows**：更新了 `.github/workflows/update_forecast.yml`。在 System Dependencies 步驟中加入了 `tesseract-ocr` 的 apt-get 安裝指令；在 Python Dependencies 步驟加入了 `pytesseract` 的 pip 安裝指令，確保自動化排程有完整的 OCR 運行環境。
