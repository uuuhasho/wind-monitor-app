# 🔍 測試版 23:00 未歸檔原因分析

## 歸檔機制概覽

測試版的歸檔依賴 **唯一的一條路徑**：

```
GAS Time Trigger (每天 23:00)
  └─ archiveAndClearFirebase()     ← L435-704
       └─ callFirebase("daily_records/...") 讀取今日資料
       └─ 寫入歸檔總表 / 160K / 180K 分頁
       └─ 刪除 Firebase 當日資料
       └─ 重置 active_status
```

> [!IMPORTANT]
> 前端 `index_test.html` **沒有** 23:00 自動歸檔邏輯，只有「📦 手動歸檔與重置」按鈕 ([L830](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/index_test.html#L830))。  
> 因此 23:00 歸檔 **100% 依賴 GAS 後端觸發器**。

---

## ❌ 可能導致 23:00 未歸檔的原因列表

| # | 原因分類 | 具體問題 | 關鍵代碼位置 | 嚴重度 |
|---|---------|---------|-------------|--------|
| **1** | 🔧 **觸發器未設定** | `setupSystemTriggers()` 需**手動執行一次**才會建立所有 GAS Time Trigger。若從未執行、或曾被清除後未重建，23:00 的 `archiveAndClearFirebase` 觸發器根本不存在 | [L1365-1373](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L1365-L1373) | 🔴 **致命** |
| **2** | ⏱️ **GAS 觸發時間漂移** | `.atHour(23).everyDays(1)` **沒有** `.nearMinute(0)`，GAS 預設在該小時內的**任意分鐘**觸發（可能是 23:00~23:59 之間任何時間）。但更關鍵的是 GAS 本身就允許 **±15 分鐘** 的漂移，極端情況可能在 22:45 或隔天 00:14 才觸發 | [L1371](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L1371) | 🟡 中 |
| **3** | 🛡️ **缺少 `ensureTestEnvironment()` 防護** | `archiveAndClearFirebase()` 被 Trigger **直接調用**時，**不會**呼叫 `ensureTestEnvironment()`。若 `FIREBASE_URL` 的 Script Property 被污染（不含 `/test`），歸檔會讀錯路徑（操作正式環境 或 空資料），導致靜默失敗 | [L435](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L435) vs [L74-105](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L74-L105) | 🔴 **致命** |
| **4** | 📭 **Firebase 無今日監控資料** | 若當天沒有船舶監控（`daily_records/{dateStr}` 為 `null`），`todayData` 為 `null` → `if (todayData && SPREADSHEET_ID)` 為 false → 跳過寫入，但**仍會重置 `active_status`** | [L441-444](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L441-L444), [L690-691](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L690-L691) | 🟢 正常行為 |
| **5** | 📊 **SPREADSHEET_ID 未設定** | 若 Script Property 中 `SPREADSHEET_ID` 為空（因 `ensureTestEnvironment` 未被觸發器呼叫），`SPREADSHEET_ID` 動態 Getter 回傳空字串 → `if (todayData && SPREADSHEET_ID)` 為 false → 跳過歸檔 | [L45](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L45), [L444](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L444) | 🔴 **致命** |
| **6** | 🌐 **GitHub Pages data.json 抓取失敗** | 歸檔過程中抓取 CPC/OM 風速預測 JSON 若失敗，**不會中斷歸檔**（有 try-catch），僅記錄 `fetch_failed`。此項不會導致完全不歸檔 | [L457-484](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L457-L484) | 🟢 不影響 |
| **7** | 🚢 **全部船隻都被判定為「改期」** | 若 `latestSchedule` 中所有船的日期都不是今天 (`scheduleItem.d !== todayM_D`)，所有卡片都會走改期繼承流程 (`continue`) → `archivedShips` 為空 → 看起來像沒有歸檔（但實際上卡片被移轉了） | [L519-568](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L519-L568) | 🟡 中 |
| **8** | 💥 **歸檔函式拋出例外** | `archiveAndClearFirebase` 的頂層 try-catch 中，若 Firebase 連線失敗或 Spreadsheet API 異常，會 `throw e` 中斷整個歸檔 | [L700-702](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L700-L702) | 🟡 中 |
| **9** | 🔑 **Firebase Secret 過期/被污染** | 若 `FIREBASE_SECRET` 被設為過期的 OAuth Token（`ya29.` 開頭），且 `ensureTestEnvironment` 未被調用來清理，`callFirebase` 會用過期 token 發請求 → 401 認證失敗 → 讀不到資料 | [L77-82](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L77-L82), [L112](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L112) | 🔴 **致命** |
| **10** | ⏰ **GAS 每日執行時間超限** | GAS 免費帳戶每日總執行時間上限 90 分鐘。若 `executeMonitor`（每 1 分鐘）+ `checkGmailAndTrigger`（每 15 分鐘）已耗盡配額，23:00 觸發器會因配額不足而被跳過 | [L1370-1372](file:///C:/Users/hilla/Desktop/%E5%A5%B6%E6%98%94code/%E6%B8%AC%E8%A9%A6%E7%89%88/gs_test.js#L1370-L1372) | 🟡 中 |

---

## 🧩 各入口點環境防護對比

| 入口 | 調用 `ensureTestEnvironment`？ | 觸發方式 |
|------|------------------------------|---------|
| `doGet()` | ✅ L710 | 前端 HTTP 請求 |
| `doPost()` | ✅ L163 | LINE Webhook / 前端 POST |
| `checkDailySchedule()` | ✅ L338 | GAS Trigger (每天 04:00) |
| `executeMonitor()` | ✅ L388 | GAS Trigger (每 1 分鐘) |
| `onCalendarOrSheetChange()` | ✅ L1392 | 日曆/試算表變更觸發 |
| **`archiveAndClearFirebase()`** | ❌ **無** | **GAS Trigger (每天 23:00)** |

> [!CAUTION]
> `archiveAndClearFirebase` 是**唯一沒有** `ensureTestEnvironment()` 防護的 Trigger 函式！
> 這代表若 Script Properties 在某個時間點被污染（例如 E2E 測試注入了 OAuth Token 到 `FIREBASE_SECRET`，或 `FIREBASE_URL` 被改為非 `/test` 結尾），23:00 觸發器執行時：
> - 可能讀到空資料 → 靜默跳過歸檔
> - 可能操作到正式環境 Firebase → 資料混亂
> - 可能因 401 認證失敗 → throw 中斷

---

## 🔑 最可能的根本原因排序

1. **🥇 觸發器不存在**（原因 #1）— 最常見：`setupSystemTriggers()` 未被（重新）執行
2. **🥈 缺少環境防護**（原因 #3 + #5 + #9）— `FIREBASE_URL` 或 `SPREADSHEET_ID` 或 `FIREBASE_SECRET` 的 Script Property 不正確，且 23:00 觸發時沒有 `ensureTestEnvironment()` 來修正
3. **🥉 當天無監控資料**（原因 #4）— 如果當天沒有船，`daily_records` 為空，這是正常行為但容易被誤解為「未歸檔」

---

## 📋 診斷建議（不改代碼）

1. 到 GAS 編輯器 → **觸發條件** 頁面 → 確認是否存在 `archiveAndClearFirebase` 的 Time-driven trigger
2. 到 GAS 編輯器 → **執行記錄** → 篩選 23:00 前後的 log，看是否有 `archiveAndClearFirebase` 的執行記錄
3. 到 GAS 編輯器 → **專案設定** → Script Properties → 檢查 `FIREBASE_URL` 是否含 `/test`、`SPREADSHEET_ID` 是否有值
