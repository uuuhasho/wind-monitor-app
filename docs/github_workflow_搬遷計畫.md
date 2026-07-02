# 🚢 GitHub Workflow 搬遷計畫 (測試版)

**建立日期：** 2026-06-23  
**狀態：** 規劃與分析完成，待執行。

## 1. 搬遷動機與目標
將現有風力預測的自動更新工作流（由 GitHub Actions 定時執行 Python 爬蟲並 commit `data.json`）搬遷至 Google Cloud Platform (GCP)。

**🎯 核心目標：徹底廢棄靜態資料檔 (`data.json`) 與 Git 提交流程**
將 Firebase Realtime Database 升級為系統的「單一資料真理 (Single Source of Truth)」，實現乾淨、即時且穩定的前後端分離架構。

---

## 2. 雙軌並行架構 (正式版 vs 測試版)

⚠️ **重要前提**：正式版維持現狀不變，僅有「測試版」進行 GCP 架構搬遷。

### 【正式版：維持 GitHub 工作流】
*   **排程與執行**：維持 GitHub Actions (`update_forecast.yml`) 每日啟動。
*   **資料儲存**：寫入正式版 Firebase，**同時**執行 `git push` 更新 `data.json`，供正式版網頁讀取。

### 【測試版：Google 雲端原生架構 (本次搬遷目標)】
完全獨立運作，不干擾正式版，各服務專心做好一件事：
*   **🖥️ 前端展示 (Firebase Hosting)**：只負責 UI，純粹監聽測試版 Firebase RTDB 獲取最新資料，完全不依賴 `data.json`。
*   **⚡ 資料中樞 (Firebase RTDB)**：「即時熱資料區」，負責資料的高速接收與廣播。
*   **⚙️ 更新引擎 (GCP Cloud Run)**：獨立容器化運行。執行完畢僅更新測試版 Firebase，**絕對不觸碰 Git push 操作**，避免干擾正式版程式碼庫。
*   **⏱️ 定時觸發器 (Cloud Scheduler)**：設定專屬的 HTTP 觸發器，每日 15:15 喚醒 Cloud Run 更新測試資料。
*   **📦 歷史歸檔員 (GAS + Google Sheets)**：維持測試版 GAS 的深夜 23:00 歸檔邏輯。

---

## 3. 搬遷優勢總結

1.  **邏輯極度清晰**：切斷雙重維護，還給 Git 專心做「程式碼版控」的本分，不再被純資料變更洗版。
2.  **執行穩如泰山**：避開 `git push` 的鎖定風險與衝突，Cloud Run 寫入 Firebase 走 Google 內網，速度與穩定度極高。
3.  **完美的歷史保存**：由於已有 GAS 深夜歸檔至 Google Sheets 的機制，廢棄 `data.json` 完全不會導致歷史資料流失，試算表查詢也更為強大。

---

## 4. 💰 費用分析 (GCP Serverless 架構)

此工作流為「低頻率、短時間」的微型任務，搬遷後預估每月維護費用為 **$0 (近乎免費)**，完全落在免費用量範圍內：

| 服務項目 | 功用 | 費用估算與免費額度說明 |
| :--- | :--- | :--- |
| **Cloud Run** | 執行 Python 爬蟲與圖片辨識 | **$0**。免費額度：每月 200 萬次請求、18萬 vCPU-秒。每日執行 1-2 次，耗時約 1 分鐘，極遠低於收費標準。 |
| **Cloud Scheduler** | 定時觸發 Cloud Run | **$0**。免費額度：每個 GCP 帳號前 3 個作業免費。 |
| **Artifact Registry** | 存放 Docker 映像檔 | **$0**。免費額度：每月 0.5 GB，超過後每 GB 約 $0.10，極度便宜。 |
| **Firebase RTDB** | 存放即時預測資料 | **$0**。Spark 方案：每月 10 GB 流量，純文字資料極難超標。 |

---

## 5. 🛠️ 具體搬遷步驟與實作拆解 (Action Items)

為了讓搬遷過程安全且無痛，我們將流程拆解為三大階段：

### 階段一：前端解耦與 GAS 瘦身 (Frontend & GAS Decoupling)
- [x] **1.1 前端全面改接 Firebase**
  * 修改測試版前端 (`index_test.html`)，移除原本對 `data.json` (GitHub Pages) 的 Fetch。
  * 替換為直接監聽 Firebase RTDB 上的專屬預測節點 (例如 `/test/forecast_data`)。確保資料更新時，前端能零延遲瞬間渲染。
- [x] **1.2 調整 GAS 深夜歸檔來源**
  * 修改 `gs_test.js` 在 23:00 的 `archiveAndClearFirebase` 函式。
  * 將原本去 GitHub 抓取 `data.json` 的邏輯，改為直接去 Firebase 讀取今日的 `forecast_data`，將資料轉存至試算表。
- [x] **1.3 清理 GAS 中多餘的 GitHub 代理邏輯**
  * 刪除 GAS 中的 `GITHUB_PAT`、`GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_WORKFLOW_ID` 等屬性。
  * 刪除 GAS 內負責觸發 GitHub Actions 的相關函式 (如 `triggerGithubWorkflow`)，大幅減輕 GAS 代碼負擔。

### 階段二：GCP Python 腳本改寫與容器化 (Cloud Run & Python Logic)
- [x] **2.1 建立測試版專屬後端 (`app_test.py`)**
  * 在根目錄建立專用 Python 腳本，引入 Flask，開啟接收 HTTP 觸發的 API 路由 (`/update_forecast`)。
- [x] **2.2 實作「強制更新」與「自動覆蓋」邏輯**
  * **手動模式 (修正防呆)**：前端手動點擊「更新氣象」按鈕時，會發送帶有 `?force=true` 參數的請求給 Cloud Run。腳本偵測到此參數後，將強制重新爬取信件並完全覆蓋 Firebase 節點 (採用 HTTP PUT 方法)。這解決了過往「資料累積或發現錯誤卻無法複寫」的問題，現在只要執行，就會得到全新一份資料。
  * **自動模式 (彈性防呆)**：若是 Cloud Scheduler 觸發，腳本會將重新解析的資料直接 PUT 覆蓋，避免舊資料殘留。
- [x] **2.3 容器化準備 (`Dockerfile` 與 `.dockerignore`)**
  * 撰寫 `Dockerfile`，安裝 Python 環境與圖片辨識所需的套件 (`libreoffice`, `tesseract-ocr`, `fonts-wqy-zenhei` 等)，並透過 `.dockerignore` 排除無關或中文命名的資料夾以確保建置穩定。

### 階段三：GCP 雲端部署與自動排程 (Deployment & Scheduling)
- [x] **3.1 映像檔推播與 Cloud Run 部署**
  * 將打包好的 Docker Image 推播至 GCP Artifact Registry (`asia-southeast1-docker.pkg.dev/newlngship/cloud-run-source-deploy/forecast-api-test:latest`)。
  * 建立 Cloud Run 服務，配置 1GB RAM、PORT 8080 等。
- [x] **3.2 設定前端直連 API**
  * 將測試版前端「手動更新預報」的按鈕，改為直接打給 Cloud Run 的網址 (`https://forecast-api-test-178957932744.asia-southeast1.run.app/update_forecast?force=true`)。
- [x] **3.3 設定 Cloud Scheduler 智慧排程**
  * 設定 Cloud Scheduler 於 15:15 觸發。因現有 API 提供 `force` 網址參數，若當天空軍信件晚到，使用者隨時可以透過前端網頁的「強制更新按鈕」直接觸發 Cloud Run，瞬間完成辨識與推播，不再受限於 Github Action 延遲。

---
---
## ✅ 搬遷完成與資安優化日誌 (2026-06-27)

所有測試版服務皆已成功搬遷至 Google 平台，並在部署後進行了深度的 Code Review 與系統加固，重點紀錄如下：

### 1. 核心解惑與架構確認
* **如何避免空軍晚寄信？** 除了排程觸發外，有了專屬的 Cloud Run URL，網頁端隨時點擊更新按鈕即可帶入 `force=true` 參數觸發重新解析，10 秒內見效，完全不卡。
* **資料是否會累積？** 不會。Cloud Run 使用 HTTP `PUT` 對 Firebase 的 `test/forecast_data` 進行寫入，這會直接「完全覆蓋」該節點。晚上歸檔後，隔天又是全新的一份，沒有歷史累積問題，即使不小心多次點擊手動更新也毫無影響。
* **刪除哪些 GAS 屬性？** `GITHUB_PAT` 等 GitHub 相關金鑰完全不需要了，GAS 已徹底卸下繁重的調度員身分。
* **延遲改善量化？** 原先 Github Actions 啟動 VM (15-30秒) + 執行 (40-60秒) + Git Push 部署 Github Pages (30-60秒)，整體需時 **1~3 分鐘**。現在 Cloud Run 接收請求後直接處理並透過 Google 內網寫入 Firebase RTDB，最快 **5~10 秒內**即可在前端看見數字跳動！延遲降低了 **90%** 以上。

### 2. 深度審查與系統加固 (Code Review Fixes)
在搬遷後，我們進行了一次架構檢視，並完成了以下 3 項重大防護升級，確保正式版與測試版皆穩如泰山：
* **🛡️ 正式版雙重相容性防護 (CRITICAL)**：在改寫共用的資料融合模組 (`data_fusion.py`) 時，我們**嚴格保留了本地 `data.json` 寫出與 Firestore 上傳邏輯**。這確保了明天正式版的 GitHub Actions 依然能完美運作，而測試版的 Cloud Run 則平行寫入 Firebase RTDB，雙軌並行、互不干擾。
* **🛡️ 狀態解鎖路徑動態化 (HIGH)**：修正了 `main.py` 在重置「⏳ 更新中」狀態時的路徑。現在系統會自動判斷環境，測試版精準解鎖 `/test/active_status`，正式版解鎖根目錄，避免網頁按鈕卡死。
* **🛡️ 同步執行與密碼防呆 (MEDIUM)**：將 Cloud Run 的背景執行緒改為「同步執行 (Synchronous)」，防止伺服器在回傳 HTTP 200 後因省電降頻而意外終止爬蟲。同時補上了手動更新的密碼防呆驗證，避免對外暴露的 API 被惡意反覆呼叫。
