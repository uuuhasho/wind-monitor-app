# Gemini 2.5 Flash 精準 OCR 輔助方案 實作規劃書  2026-7-2 19:30

本規劃書記錄了將免費版 **Gemini 2.5 Flash** 整合至中油風力預估管線測試版中，解決 Tesseract OCR 在雲端（Cloud Run 等環境）識別率低、退化至 Fallback 導致時間軸偏移 12 小時的實作方案。

---

## 🎯 1. 核心設計決策與架構

### 1.1 職責劃分 (精準輔助模式)
* **OpenCV (主解析)**：保留現有 [cv2_parser.py](C:/Users/hilla/Desktop/奶昔code/src/cv2_parser.py) 對於風速折線圖的像素座標提取與風速 (KT) 數學轉換。
* **Gemini 2.5 Flash (時間標記 OCR)**：僅負責讀取圖表右上角辨識起算時間（例如辨識出 `"00Z01JUL"` 或 `"12Z02JUL"`）。當辨識成功後，由 Python 管線對齊 X 軸時間點。

### 1.2 技術實作：輕量級 REST API
* 為了保持代碼輕量，**不引入** `google-generativeai` 官方 SDK。
* 直接使用 Python 原生的 `base64` 將圖片轉為 Base64 字串，並透過 `requests` 以 HTTP POST 呼叫 Google Gemini 官方端點。

### 1.3 密鑰管理與安全性 (config.json)
* API Key 將儲存於 [config.json](C:/Users/hilla/Desktop/奶昔code/config.json) 的新設定節點 `"GeminiApiKey"`。
* 由於 `config.json` 已經在 [.gitignore](C:/Users/hilla/Desktop/奶昔code/.gitignore) 檔案中被宣告忽略，因此**絕對不會**被 Git 提交或上傳至 GitHub，確保 Key 的安全性。
* 不使用多源並行讀取，減少系統複雜度。

### 1.4 錯誤邊界處理
* 當 Gemini API Key 無效、請求超限（Rate Limit）或網路連線失敗時，程式直接拋出 Exception（`raise`）中斷 Pipeline 執行。
* **不接受任何 Fallback 猜時間的容錯邏輯**，防止錯誤數據寫入資料庫。

### 1.5 預估數據不符修復
* 在 [data_fusion.py](C:/Users/hilla/Desktop/奶昔code/src/data_fusion.py) 中，將 Open-Meteo 的預估模型 `"models"` 參數從 `"ecmwf_ifs"` 修改為 `"best_match"`，使測試版所融合的陣風預測數據與實際相符。

---

## 🛠️ 2. 修改檔案與實作細節

### 2.1 停留點與回滾機制 (Rollback Plan)
在開始修改程式碼前，已在本地 Windows 下建立實體檔案備份：
* [cv2_parser.py](C:/Users/hilla/Desktop/奶昔code/src/cv2_parser.py) ➔ `src/cv2_parser.py.bak`
* [data_fusion.py](C:/Users/hilla/Desktop/奶昔code/src/data_fusion.py) ➔ `src/data_fusion.py.bak`
* [config.json](C:/Users/hilla/Desktop/奶昔code/config.json) ➔ `config.json.bak`

如實作過程中發生任何問題，只需在 PowerShell 執行以下還原命令即可恢復到目前版本：
```powershell
Copy-Item 'src\cv2_parser.py.bak' 'src\cv2_parser.py' -Force
Copy-Item 'src\data_fusion.py.bak' 'src\data_fusion.py' -Force
Copy-Item 'config.json.bak' 'config.json' -Force
```

### 2.2 寫入設定檔 [config.json](C:/Users/hilla/Desktop/奶昔code/config.json)
在新欄位注入 Gemini API Key：
```json
{
  "Gmail_IMAP_Settings": { ... },
  "Algorithm": {
    "Limit180K": 12.0,
    "LimitDefault": 15.0,
    "WindRatio": 1.5333,
    "GeminiApiKey": "<YOUR_GEMINI_API_KEY>"
  },
  "Firebase_RTDB_Settings": { ... }
}
```

### 2.3 修改 [cv2_parser.py](C:/Users/hilla/Desktop/奶昔code/src/cv2_parser.py) 中的 OCR 邏輯
* 實作 `get_initial_time_via_gemini(image_path, api_key)` 函數。
* 重構 `parse_chart_with_cv2` 中的 Step 3 部分，呼叫該函數進行圖片右上角 OCR。

### 2.4 修改 [data_fusion.py](C:/Users/hilla/Desktop/奶昔code/src/data_fusion.py)
* 將 `fetch_open_meteo_data` 中的 `"models": "ecmwf_ifs"` 修改為 `"best_match"`，使預報數據和比對版一致。

---

## 🔬 3. 測試與驗證

1. **API Key 驗證**：已於 2026-07-02 19:34 執行本地測試腳本，回傳 `00Z01JUL` 狀態碼 200，API Key 檢測可用。
2. **本地 Pipeline 整合測試**：修改完畢後，執行：
   ```powershell
   python main.py --date 0702
   ```
   驗證新 OCR 與資料庫寫入流程 100% 成功。
