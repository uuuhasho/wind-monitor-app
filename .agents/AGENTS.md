# Antigravity CLI - 專案規範 

## 專案定位與架構演進 (Architecture Direction)
* **主力生產環境地位**：本版（架設於 Google 平台、使用 Python/GCP/Firebase）為**未來主力生產環境**。
* **測試環境隔離**：測試版 Firebase 專案 ID 為 **`newlngship`**（Realtime Database URL 為 `https://newlngship-default-rtdb.asia-southeast1.firebasedatabase.app/`）。在開發測試版後端、前端或配置環境時，均必須與此專案保持對接，且測試版之 `FIREBASE_URL` 必須嚴格配置為帶有 `/test` 後綴的網址，以對接測試版前端的 `test/` 前綴。

## GCP / Cloud Run / Secret Manager 部署與安全規範
* **雲端金鑰安全管理 (Secrets Management)**：部署 GCP Cloud Run 或 Google 雲端服務時，所有敏感密鑰（如 Firebase RTDB DbSecret、Service Account 金鑰等）必須全面改用 **GCP Secret Manager** 存放或設定為 Cloud Run 環境變數。絕對不可將 `config.json` 或 `service_account.json` 等實體設定檔隨容器映像檔打包上傳，必須確實將它們加入 `.gcloudignore` 中。
* **Secret Manager BOM 防護**：程式碼中讀取 Secret Manager 注入的環境變數時，必須一律加上 `.strip().strip("\ufeff")` 防護，避免 Windows UTF-8 BOM 導致 gRPC 層拒絕 API 請求 (503 Error)。
* **Windows 中文路徑安全部署 (Clean Workspace Deployment)**：因 Windows 環境下工作區目錄名稱可能含有中文（例如 `opencode桌面\奶昔APP`），直接執行 `gcloud run deploy` 會因字符編碼問題導致 `ContainerImageImportFailed` 錯誤。進行 Cloud Run 部署時，必須統一執行根目錄的 `python deploy_clean.py` 腳本，將無中文路徑之乾淨工作區複製至 `C:\Users\hilla\Desktop\newlngship_clean` 後執行部署。
* **Artifact Registry 空間維持與自動清理**：Artifact Registry 儲存空間必須嚴格維持在 **500MB** 的免費額度內。當執行 Cloud Run 部署時，`deploy_clean.py` 會自動執行根目錄之 `cleanup_registry.py`，自動檢測並刪除舊的 Docker 映像檔版本，僅保留當前 active 運作的版本。
* **單一權威部署源 (Single Source of Truth)**：後端程式碼已全面解耦整合於專案根目錄（包含 `app.py`、`main.py`、`deploy_clean.py` 與 `src/` 目錄）。開發與修復時以根目錄檔案為唯一權威來源。
* **Cloud Run POB Webhook 架構分工**：LINE Webhook 指向 Cloud Run `/webhook`，Cloud Run 僅負責用 Gemini 解析 POB 時間，解析成功後委託 GAS `set_mode?pob_time=HH:MM` 完成後續全流程（風速查找、`pob_info` 寫入、船期更新、換班接力）。Cloud Run 不直接寫入 `daily_records`。

## Google Apps Script (GAS) 部署標準規範 (GAS Deployment SOP)
* **雙重部署標準 (clasp push + clasp deploy)**：
  1. `clasp push` 僅將代碼推送到 GAS 專案的 `HEAD`（僅對「內部定時觸發器」與「日曆事件觸發器」即刻生效）。
  2. 若系統有發布 Web App 供外部或 Cloud Run 呼叫（如 `app.py` 引用的 `AKfycbzl...`），**改動 GAS 後必須自動檢查並執行 `clasp deploy -i <deploymentId>` 升級部署版本**，嚴禁遺漏 deploy 導致外部端點繼續執行舊版本。
* **路徑配置防護**：`.clasp.json` 中的 `rootDir` 必須設為 `.`（相對目錄），避免 Windows 絕對路徑觸發 clasp 的跨目錄安全異常。

## 審閱文件與 Bug 修復文件規範 (Documentation & Review Rules)
* **日期目錄分層管理 (Date-Based Folder Organization)**：`./docs/` 與 `./plan/` 下的所有產出檔案，**必須嚴格依照日期分層歸檔**，每個日期建立獨立資料夾（格式為 `YYYY-MM-DD/`，例如 `./docs/2026-09-19/` 與 `./plan/2026-09-19/`）。**嚴禁直接將檔案散落於 `./docs/` 或 `./plan/` 的根目錄下**。
* **計畫與審閱文件 (Plan & Review Docs)**：所有需使用者查看、審閱或同意的文件（包括 Implementation Plan、Design Docs、Walkthrough 等），必須儲存於 `./plan/YYYY-MM-DD/` 目錄，並且**必須採用 HTML 檔案格式 (.html)**，**嚴禁使用 Markdown (.md)**。主題樣式**必須採用「淺色底 (Light Theme)」**（如白色/淺灰色背景 `#ffffff` / `#f8fafc` 配深色文字），提供快適清爽的閱讀體驗。
* **Bug 診斷與修復紀錄 (Bug Resolution Docs)**：每次診斷並修復 bug，必須自動於 `./docs/YYYY-MM-DD/` 目錄輸出一份 Markdown 文件，檔名格式為 `YYYY-MM-DD-簡短問題描述原因分析.md`，內容須涵蓋錯誤現象、根因分析、代碼 diff 與驗證結果。
* **敏感資訊保護 (Security & Credentials)**：嚴禁將 API Key、Token、密碼或敏感憑證明文寫入程式碼，必須透過環境變數安全讀取。

## 測試密碼與驗證配置
* **預設測試密碼**：專案測試版網頁的前端操作密碼（GAS 端 `OP_PASSWORD`）與雲端強制氣象更新密碼（GCP 端 `APP_PASSWORD`）已統一配置為 `502020`。自動化測試或串接測試時應直接使用 `502020`。

## 領域知識與限制 (Domain Knowledge)
* **LNG 船夜航限制**：LNG 船禁止夜航，因此船舶進港 (POB) 時間只會落在 **04:00 ~ 17:00** 之間。在進行系統排程、時間推算或邏輯防呆時，應將此物理限制考慮在內。




