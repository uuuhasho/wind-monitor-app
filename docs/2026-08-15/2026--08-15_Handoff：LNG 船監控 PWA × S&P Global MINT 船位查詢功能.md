# Handoff：LNG 船監控 PWA × S&P Global MINT 船位查詢功能

## 1. 專案背景

我目前已有一套簡單的 **LNG 船舶動態監控 PWA App**，主要在手機使用。

App 本身已經有：

- LNG 船名資料
- LNG 船舶相關動態監控功能
- 船名表／船舶清單
- 既有的 React / PWA 程式與資料流程

目前想新增：

> **從既有 App 的船名，快速查詢該船目前位置。**

這次功能不是要重新建立 AIS 船位系統，也不是要建立全球 LNG 船隊資料庫。

---

# 2. 真正需求

使用情境通常發生在：

- 天候不佳
- 需要判斷 LNG 船目前距離或位置
- 臨時需要知道船舶目前在哪裡

查詢頻率很低，例如：

- 約 1 小時查一次
- 有時可能 4 小時才查一次
- 不需要即時持續追蹤
- 不需要歷史航跡

App 已經知道正確的 LNG 船名。

例如：

```text
SERI ALAM
```

希望未來可以：

```text
App 船名
   ↓
使用者點擊 / 滑動 / 長按
   ↓
查詢船位
   ↓
S&P Global MINT
   ↓
顯示該船目前位置
```

---

# 3. 現有船位資料來源

目前公司已有 **S&P Global MINT** 使用權。

實測網址：

```text
https://marketintelligencenetwork.com/mint/dashboard
```

MINT 可以：

- 輸入船名搜尋
- 顯示船舶位置
- 顯示 LNG Tanker 類型
- IMO
- MMSI
- Callsign
- Last Seen
- Speed / Heading
- Draught
- Destination
- ETA
- Last Observed Port

範例實測：

```text
SERI ALAM

Type: LNG Tanker
IMO: 9293832
MMSI: 533925000
Callsign: 9MGL7
```

因此目前**沒有必要自行建立 AISStream、MarineTraffic、Spire 等替代船位資料系統**。

---

# 4. 已排除的方向

目前不要優先做以下功能：

```text
× 全球 LNG Vessel Registry
× GIIGNL 全船隊資料庫
× 自建 MMSI database
× AISStream 全球 AIS 接收
× 自建 Leaflet 船位系統
× 船位歷史資料庫
× WebSocket 即時追蹤
```

原因：

App 已有船名，而 MINT 已可以查船及顯示位置。

真正需要解決的是：

> **如何讓 App 裡的船名快速帶到 MINT。**

---

# 5. MINT 實測結果

## 5.1 船名搜尋

在 MINT：

```text
輸入 SERI ALAM
→ 選擇船舶
→ MINT 地圖定位
→ 顯示船舶詳細資訊
```

可以正常使用。

---

## 5.2 MINT URL 不會隨船舶改變

這是非常重要的限制。

搜尋 SERI ALAM 並顯示船位之後：

```text
https://marketintelligencenetwork.com/mint/dashboard
```

網址仍然沒有改變。

也就是目前沒有發現類似：

```text
/mint/dashboard?vessel=SERI%20ALAM
```

或：

```text
/vessel/9293832
```

這種可直接使用的 Deep Link。

因此目前不能單純從 App：

```javascript
window.open(
  "https://.../mint/dashboard?vessel=SERI%20ALAM"
)
```

就完成船舶定位。

---

# 6. MINT 登入限制

不能假設 MINT 已登入。

MINT Session 有時間限制，因此可能發生：

```text
App 點「查船位」
      ↓
開 MINT
      ↓
Session expired
      ↓
MINT Login
      ↓
登入
      ↓
Dashboard
```

因此設計時必須同時考慮：

### 情況 A

```text
MINT Session 有效
```

### 情況 B

```text
MINT Session 已失效
需要重新登入
```

另外：

> **手機目前尚未完成 MINT 的整合與實測流程。**

不能假設手機瀏覽器一定已有 MINT Session。

---

# 7. 安全原則

不要在 LNG PWA 裡：

```text
× 保存 S&P Global 帳號
× 保存 S&P Global 密碼
× 自動填寫 MINT password
× 讀取或複製 MINT Cookie
× 儲存 MINT Session token
```

登入應由：

```text
S&P Global / MINT
```

自己的正常登入機制處理。

---

# 8. Browser 技術限制

PWA 與 MINT 是不同 Origin。

例如：

```text
https://our-app.example.com
```

與：

```text
https://marketintelligencenetwork.com
```

因此一般瀏覽器的 Same-Origin Policy 不允許：

```javascript
const mint = window.open(mintUrl);

mint.document
  .querySelector(...)
  .value = shipName;
```

也就是：

> **PWA 無法直接開 MINT 後再操作 MINT 的搜尋框 DOM。**

---

# 9. Chrome Extension 目前不是主要方案

曾討論過：

```text
PWA
→ MINT
→ Chrome Extension
→ 自動填入船名
```

但本 App 主要使用環境是：

> **手機 PWA**

因此 Chrome Extension 不適合作為核心方案。

桌面版本未來若有需求，可以另外評估。

---

# 10. MINT Vessel List 實測

MINT 可以依 Vessel Type 篩選：

```text
LNG
 └─ LNG Carriers
      ├─ Small Gas Carrier
      ├─ Conventional Gas Carrier
      ├─ New Panamax
      ├─ Q Flex
      └─ Q Max
```

但目前帳號中的 Vessel List：

> **沒有 Export / Excel / CSV 功能。**

不過這件事目前已不是主要需求，因為 App 本身已經有需要查詢的船名。

---

# 11. 理想 UX

目前希望討論適合手機 PWA 的操作方式。

候選：

### 方案 A：船名旁位置按鈕

```text
SERI ALAM       [船位]
```

點擊：

```text
→ 查詢 MINT
```

優點：

- 容易發現
- 手機操作直覺

---

### 方案 B：左滑

```text
SERI ALAM
← swipe

[查看 MINT 船位]
```

類似手機 Mail App。

---

### 方案 C：長按船名

```text
長按 SERI ALAM

→ 查看船位
→ 其他功能
```

---

目前不要先決定 UX。

應先讀現有 App code，確認：

- 船名 component
- 現有 touch gesture
- 行動版 layout
- 船舶 row / card 結構

再決定。

---

# 12. 最低可行版本 V1

如果沒有 S&P API，也找不到 MINT Deep Link：

App 可以先做到：

```text
App
 │
 │ 點 SERI ALAM
 ▼
將「SERI ALAM」複製到 Clipboard
 │
 ▼
開啟 MINT Dashboard
```

接著：

### MINT 已登入

```text
搜尋框
→ Paste
→ Enter
```

### MINT Session expired

```text
Login
→ 登入
→ Dashboard
→ Paste
→ Enter
```

這不是最理想版本，但：

- 不需要新的資料 API
- 不需 AISStream
- 不需要後端
- 不需保存 MINT 帳密
- 不碰 undocumented MINT API

可作為 fallback。

---

# 13. 理想版本

理想目標：

```text
SERI ALAM
   ↓
一個操作
   ↓
如果需要 → MINT Login
   ↓
自動接續 SERI ALAM 搜尋
   ↓
直接看到該船位置
```

目前最大技術問題就是：

> **MINT Login 完成後，要如何保留／傳遞原本 App 的 shipName，並讓 MINT 自動執行搜尋？**

因為：

1. MINT URL 不包含 vessel
2. PWA 無法跨 origin 操作 DOM
3. 手機 extension 不適合作為主要方案

---

# 14. 後續值得研究的方向

Codex 先不要直接 implementation。

請先協助分析以下方案。

## 方向 1：MINT 是否存在未發現的官方 Deep Link

研究：

```text
MINT vessel page
MINT map state
MINT share URL
MINT vessel permalink
IMO deep link
MMSI deep link
```

目前人工測試只知道 URL 不變。

---

## 方向 2：MINT 官方 API

S&P Global 有 Maritime / MINT API 或 Data Feed 產品。

需確認目前公司 entitlement 是否包含：

```text
Vessel search by name
Latest position
IMO
MMSI
Last Seen
Speed
Heading
```

如果已有 API entitlement，理想架構可能改成：

```text
PWA
 ↓
Backend
 ↓
S&P API
 ↓
船位資料
 ↓
PWA 顯示
```

但不要先假設 API 已授權。

---

## 方向 3：MINT 登入流程與 return URL

需要研究：

```text
登入前：
App → MINT

登入後：
是否支援 returnUrl / redirect_uri / state？
```

例如若 MINT login 支援：

```text
/login?returnUrl=...
```

可能有機會建立較好的流程。

需要以實際登入 Network / URL 行為確認。

---

## 方向 4：手機 Web Share / Clipboard

如果最後只能使用 fallback：

```text
Clipboard + open MINT
```

需要設計成最少操作步驟。

---

# 15. 不建議直接做的事情

除非確認 S&P 授權允許，否則不要直接把以下方式當 production solution：

```text
× Selenium 自動登入 MINT
× Playwright 自動登入 MINT
× Web scraping
× 直接調用 undocumented internal endpoint
× 偷取瀏覽器 cookie
× Replay MINT private API
```

可以使用 DevTools / Network **研究 MINT 如何運作**，但不能先假設 private API 可以正式整合。

---

# 16. 現有 App 還沒有完成架構盤點

目前 ChatGPT 尚未完整讀過最新 Repo。

因此進入實作前，Codex 應先閱讀現有專案：

```text
package.json
src/
components/
pages/
services/
hooks/
Firebase config
PWA config
router
authentication
ship data flow
```

特別需要找出：

```text
1. 船名資料從哪裡來
2. 船名在哪些頁面出現
3. 船名使用哪一個 component
4. mobile card / row 結構
5. 現有 swipe / touch handler
6. router 架構
7. 是否已有 external-link helper
8. 是否已有 clipboard helper
9. PWA standalone mode 行為
10. App 是否有 backend
```

---

# 17. Codex 第一階段任務

目前請：

> **只做架構理解與方案討論，不要修改 code。**

請完成：

```text
A. 閱讀整個現有 App
B. 描述 App 架構
C. 找出船名的 source of truth
D. 找出適合加入「查船位」功能的 component
E. 分析手機 UX
F. 分析 PWA → MINT 的技術限制
G. 提出 2～3 個可行方案
H. 比較各方案：
   - 使用步驟
   - 技術難度
   - 安全性
   - S&P 授權風險
   - 手機支援
   - 維護成本
```

完成分析後，再討論 implementation。

---

# 18. Codex 需要遵守的核心原則

```text
1. 不要重新建立全球 LNG 船隊資料庫。
2. 不要自行重做 MINT 的船位系統。
3. App 已經有船名，以該船名作為查詢起點。
4. MINT 是目前主要船位來源。
5. MINT Session 有時效，不能假設已登入。
6. 不在 App 儲存 MINT 帳密。
7. 手機 PWA 是主要使用環境。
8. MINT 搜尋船舶後 URL 不會改變。
9. 目前沒有確認可用的 Deep Link。
10. 不要在沒有授權確認前使用 undocumented MINT API。
11. 先理解現有 App，再提出修改方案。
12. 未取得使用者確認前，不要修改 unrelated logic。
```

---

# 19. 最終目標

不是：

```text
做一套船位系統
```

而是：

```text
既有 LNG 船監控 PWA
        ↓
利用已存在的船名
        ↓
以最少操作
        ↓
透過 S&P Global MINT
        ↓
查看該 LNG 船目前位置
```

目前請以這個目標繼續分析與討論。