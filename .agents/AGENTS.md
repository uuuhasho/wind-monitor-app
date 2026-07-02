# Antigravity CLI - Project Preferences

## Google Apps Script (GAS) 部署與版控規則
* **避免上傳至 GitHub**：專案內的 `gs_*.js` 檔案絕對**不可以**被上傳或推送到 GitHub 儲存庫，必須維持在 `.gitignore` 名單中。
* **直接透過 Clasp 部署**：此專案的 GAS 網址為 [1on-oG64WYR5K3F9hal8cg1yO5yUhDlaiyUGpl2Vk_hcCvs7eiEz6FQUf](https://script.google.com/home/projects/1on-oG64WYR5K3F9hal8cg1yO5yUhDlaiyUGpl2Vk_hcCvs7eiEz6FQUf/edit)。
* **GAS 部署檔案內容**：GAS 雲端專案上部署的 `index.html` 必須與 GitHub 專案中的 [index.html](file:///C:/Users/hilla/Desktop/奶昔code/index.html) 保持完全一致。
* **自動更新流程**：未來若有修改 `gs_*.js` 檔案或 `index.html` 檔案，必須自動使用 `clasp` 工具進行部署。流程為：在 `.gas` 目錄中放置與專案根目錄相同的 `index.html` 以及對應的 `gs_*.js`，確認內容無誤後，依序執行 `clasp push` 與 `clasp deploy` 進行雲端代碼更新與版本發布。
* **GAS 標頭變更紀錄**：之後若有修改 `gs_*.js`，必須同步更新代碼最上方的註解。請加上日期及內容，舊的內容不要刪除，新增修改後的重點，並在數字項目前方加上 `*`。

## 船期日曆 GAS 專案部署規則
* **專案 ID**：`1R-ylIx7ZAKbaUIYrA-StMnMSwdIca632mOFrgfvoNF_P_UxxjD-ljjSI`，本機目錄為 `船期日曆更新/`，透過該目錄下的 `.clasp.json` 進行 clasp 操作。
* **嚴禁更改雲端檔案名稱**：雲端上的檔案名稱為 `程式碼.js` 與 `Index.html`，clasp push 時必須保持這兩個原始檔名，**不可改名**。若擅自更改檔名（例如改為 `日曆更新gs.js`），會導致 GAS 要求重新授權，造成 Web App 卡住無法運作。
* **模板引用一致性**：`doGet` 中的 `createTemplateFromFile('Index')` 必須與雲端 HTML 檔案名稱 `Index.html` 完全對應，不可修改。

## 領域知識與限制 (Domain Knowledge)
* **LNG 船夜航限制**：LNG 船禁止夜航，因此船舶進港 (POB) 時間只會落在 **04:00 ~ 17:00** 之間。在進行系統排程、時間推算或邏輯防呆時，應將此物理限制考慮在內（例如跨夜 POB 在實務上不可能發生）。

## 其他注意事項
* 除非使用者主動提出變更，否則請嚴格遵守上述 GAS 版控與自動部署原則。
* **部署前檢查**：如要更新或部署代碼到 GitHub 或 GAS 等平台前，AI 務必仔細檢查代碼是否有 bug 或存在邏輯衝突，確保系統穩定運作。

## 專案移轉與架構演進規則 (Project Migration & Evolution Rules)
* **參考移轉規劃書**：在進行專案向 Google 平台（Firebase / GCP）的移轉、重構、部署或相關討論時，必須嚴格參考並遵守 [移轉規劃書.md](C:/Users/hilla/Desktop/奶昔code/docs/移轉規劃書.md) 的五大步驟與技術決策。


## 對話與討論環境確認規則 (Conversation & Environment Confirmation Rules)
* **對話確認模式**：在每次開啟新對話或執行任務前，AI 必須主動向使用者詢問：**「今天是要進行測試版還是正式版的討論與修改？」**。若使用者回覆為「測試版」，則所有程式碼變更與部署動作一律限制在 `測試版/` 目錄內，絕對不得觸碰或修改 `正式版/` 目錄下的任何檔案，以防止測試中的 bug 意外污染正式環境。

## 專案開發與筆記本隔離工作流偏好 (Project Development & Notebook Separation Workflow Preferences)
* **自動回報與狀態同步**：任務執行完畢並通過測試後，AI 必須自動將對應任務在 `notes.md` 或 `todo.md` 中勾選為已完成 (`- [x]`)。為了保持版面整潔，**不要在每個待辦項目加上日期前綴**，而是應以「時間區塊標題」來分組（例如 `### 🕒 2026-06-11 14:30 (討論批次)`），將同一批次的任務歸類在該標題下。同時，必須在該區塊下方自動詳細記錄實作變更與測試結果，絕對不可遺漏。
* **草稿轉換與討論流程**：使用者會先在 `notes.md` 的「📝 靈感沙盒與草稿區 (Sandbox / Drafts)」中提出想法與初步規劃。若草稿內容以 "---" 分隔，AI 必須僅讀取最後一個 "---" 分隔符號之後的內容，整理並轉換為「🚀 準備執行區 (Ready to Run)」的待執行項目，且在正式執行前與使用者進行討論、確認執行方向。
* **筆記本結構與清理偏好**：
  * 「📝 靈感沙盒與草稿區 (Sandbox / Drafts)」應放置於 `notes.md` 的最上方（主標題之下）。
  * `notes.md` 中的「🚀 準備執行區 (Ready to Run)」僅保留前一次（最新完成的一批）的 ToDo 列表及變更記錄，更早之前的歷史舊記錄需予以清理移除，以維持檔案清爽。

## ⚠️ 研發教訓與防範規則 (Lessons Learned & Anti-Regression Rules)
* **測試環境與正式環境獨立隔離**：
  * **測試版 Firebase 專案**：專案 ID 為 **`newlngship`**（Realtime Database URL 為 `https://newlngship-default-rtdb.asia-southeast1.firebasedatabase.app/`）。在開發測試版後端、前端或是配置環境時，均必須與此專案保持對接，且測試版之 `FIREBASE_URL` 必須嚴格配置為帶有 `/test` 後綴的網址，以對接測試版前端的 `test/` 前綴。
  * **正式版 Firebase 專案**：專案 ID 為 **`wind-monitor-app`**（Realtime Database URL 為 `https://milkshake-monitor-default-rtdb.asia-southeast1.firebasedatabase.app/`）。
  任何在測試環境中的資料庫重置、編輯與刪除，皆不可觸碰正式版（生產環境）資料庫以防數據污染。
* **解決 GAS 全域常數生命週期滯後**：在 GAS 中以 `const` 定義之全域變數，於當次 API 請求內呼叫 `props.setProperties` 變更屬性時無法即時更新。為此，重要的環境變數（如 `SPREADSHEET_ID`、`FIREBASE_URL`、`SHIP_SCHEDULE_API_URL`、`TARGET_URL`）一律必須使用動態 Getter（`Object.defineProperty`）進行動態獲取，以防連線網址或 ID 滯後。
* **UrlFetchApp 外部 API 中文編碼**：當使用 `UrlFetchApp.fetch` 發送請求時，URL 參數若包含中文字元（如 `port=台中`），必須嚴格進行 URL 編碼（如 `port=%E5%8F%B0%E4%B8%AD`），以防 GAS 引擎拋出 `Invalid argument` 錯誤而崩潰。
* **HTTP 方法大小寫限制**：在 `UrlFetchApp` 傳送請求時，`options.method` 必須在呼叫前進行 `.toUpperCase()` 強制轉大寫（如 `DELETE`, `PATCH`）。若使用小寫，GAS 會因無法辨識而自動退化為 `GET` 請求，造成刪除或修改動作失效。


## 程式碼編寫與審查偏好 (Coding & Review Preferences)
* **異質模型交叉審查規則 (A/B Model Review)**：在進行代碼審查 (Code Review) 時，必須嚴格遵守「A model 寫代碼，B model 審查」的防盲點原則（避免自己改自己的考卷）。因應系統限制，必須利用 Antigravity 內建的不同模型進行高低搭配或平行交叉審查：
  * **若當前主代理為 Gemini 3.5 Flash**：審查代碼的子代理必須指定切換為 **Gemini 3.1 Pro** 或其他等量級之異質模型。
  * **若當前主代理為 Gemini 3.1 Pro**：審查代碼的子代理必須指定切換為 **Gemini 3.5 Flash** 或其他等量級之異質模型，並在 Prompt 中嚴格要求以「第三方審查員 (Third-Party Reviewer)」的挑剔視角進行靜態分析。
