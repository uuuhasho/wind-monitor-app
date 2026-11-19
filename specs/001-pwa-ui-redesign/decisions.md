# Decisions · 001-pwa-ui-redesign

- **Date**: 2026-11-19
- **Baseline Revision**: `0f74a1134013aa6d088ce7ad0f0da1c62b65449e` (`feat/pwa-ui-redesign`)

## D1 — 底部導覽列與「齒輪／船期調整／手動設定」入口分工
- **User Decision**: 「A，點齒輪後，也要驗密碼」
- **Adopted Behavior**:
  - Fixed 4-tab bottom navigation bar: `監控` (home view), `預報` (opens existing dark `#forecastModal`; clicking wind speed number also opens it), `船期` (password-verified -> full-screen double-row card schedule editor `#scheduleAdjustModal`), `聊天室` (opens existing v2 `#chatModal`; unread red dot `#chatUnreadBadge` moves onto this tab).
  - The gear icon (`.cpc-btn.pulso-settings`) in the `船期表` card header retains PulsoIcon rotation animation and opens **手動監控設定** (`#manualModal`) **after password verification** (`triggerOpenManualModal()`).
  - Remove legacy `#scheduleHeaderRow` double-click / double-tap trigger to avoid accidental mobile triggers.

## D2 — 船期調整「刪除鍵」與 GAS 後端同步補齊
- **User Decision**: 「(Recommended) 選項 A：前端＋GAS 一併補齊「刪除船期」功能（含 GAS 測試，日後上線同步部署 GAS）」
- **Adopted Behavior**:
  - Frontend double-row card editor displays a delete button (trash icon) per row; clicking prompts confirmation (`confirm`) before removing from `editScheduleList`.
  - Saving emits `is_deleted: true` entries to GAS `update_schedule`.
  - GAS `update_schedule` records `{ d, ship_name, is_deleted: true, created_at }` in `schedule_overrides/${key}`, and `getScheduleList()` filters out `is_deleted === true` entries (including calendar-sourced ships) and auto-cleans expired tombstones.
  - Add unit test coverage in `tests/test_gas_archive.js`. Defer actual `clasp push`/`clasp deploy` and Hosting deploy until explicit post-acceptance authorization.

## D3 — 右上角鈴鐺圖示與可進港音效邏輯
- **User Decision**: 「與現行版邏輯相同，只是鈴鐺圖示換地方而已」
- **Adopted Behavior**:
  - Move `#soundToggle` to top-right header immediately to the left of the circular `i` info link.
  - Replace emoji (`🔔`/`🔕`) with crisp inline SVG icons: muted gray slashed bell (`!isSoundEnabled`), active navy bell (`isSoundEnabled` and not `safe`), and prominent orange ringing bell (`isSoundEnabled && currentStatus === 'safe'`).
  - Keep exact v1.4 behavior: visible only while `isMonitoring === true` (`app_mode === 'start' && !isShipFinished`), default `isSoundEnabled = false`, click unlocks browser audio & toggles playback, loops `notification_option_C.mp3` when `safe` and enabled.

## D4 — 風速卡片內「等待進港」與「無法進港原因」呈現方式
- **User Decision**: 「B，上行 無法進港，下行小字 風速超標 / 浪高2.8 > 2.5m / 能見度1.5 < 2浬」
- **Adopted Behavior**:
  - Move `#dynamicBox` inside the `北堤風速` card to the right of the wind speed readout.
  - `safe`: solid green `#15803D` white-text pill `可進港 •`.
  - `waiting`: solid slate `#475569` white-text pill `等待進港`.
  - `warning`: solid red `#B91C1C` white-text 2-line pill: top line `無法進港 •`, bottom small text line(s) showing `風速超標` (when wind exceeds limit) OR `浪高 X > 2.5m` / `能見度 Y < 2浬` (with white-tinted `/APP_SVG/wave.svg` and `/APP_SVG/eye.svg` icons). Responsive sizing guarantees zero horizontal overflow at `375px` viewport width.

## D5 — 分支策略、視覺基準、不改動範圍與低風險預設
- **User Decision**: 「(Recommended) 選項 A：先在本機將 feat/ship-chat-room 併回 main（暫不推 GitHub），再從 main 切 feat/pwa-ui-redesign，其餘預設皆同意」
- **Adopted Behavior**:
  - Local fast-forward merge `feat/ship-chat-room` -> `main`, branch `feat/pwa-ui-redesign` from `main` (no GitHub push).
  - Visual baseline: Remove glassmorphism (`backdrop-filter`), pastel gradients, and breathing glow animations; adopt crisp utilitarian light maritime UI (`#EEF3F7` background, full-width `#FFFFFF` rounded cards) matching the 2026-11-19 reference mockups (`C:\Users\hilla\Desktop\20261119-PWA畫面修改\*.jpg`).
  - Top bar: existing `logo.png` + `臺中LNG船監控` on left; `[Bell SVG]` + `[Circular i SVG -> presentation/index.html]` on right. `<title>` becomes `臺中LNG船監控(v1.5)`.
  - Non-goals (untouched): `#forecastModal` internal dark chart styling & ECharts logic, `#chatModal` / `#chatPreviewModal` internal UI & Firebase logic, `backend/`, `frontend/presentation/index.html`.
  - Manual drawer defaults: Bottom-sheet drawer (`#manualModal`); speed segmented control `12` | `15` | `自訂` (default `15`; clicking `自訂` reveals `#limitSpeed` number input); terminal segmented control `W12` | `W13` (default `W13`; active state changes color); stop-monitoring mode preserves POB time / no-entry reason + solid red `#DC2626` `#resetBtn` (removing legacy `#FF69B4` pink).
  - Schedule adjust defaults: Full-screen double-row card list (`#scheduleAdjustModal`); Row 1 = date (`MM/DD` or `M/D`, normalized `06/09` -> `6/9` on save and in GAS) + `W12`/`W13` select + delete icon button; Row 2 = ship name input + `12`/`15` speed limit select (preserving any non-12/15 custom speed value dynamically). Preserve `UNFINISHED_SHIP` at top with blank date.

## D6 — 第二輪畫面配色（方案 A 港務藍灰金）與 6 項操作／版面調整
- **User Decision**: 選定「**A**」（方案 A：港務藍灰金「60-30-10 海事儀表風」），並執行第 1–6 項調整要求。
- **Adopted Behavior**:
  1. **手動設定（`#manualModal`）**：限制風速分段按鈕僅保留 **`12` | `15`**（2 欄 `cols-2`，按鈕文字不加 `m/s` 後綴，取消「自訂」選項與 `#customLimitSpeedWrap`），保留 `<input type="hidden" id="limitSpeed" value="15">` 與 `12`/`15` 正規化切換邏輯以維持 `setMode('start')` 與隔離測試相容。
  2. **船期調整畫面（`#scheduleAdjustModal`）**：
     - 左上角 `#adjustBackBtn` 僅保留向左箭頭 SVG（`aria-label="返回監控"`），移除「監控」二字。
     - 右上角 `#adjustAddBtn` 刪除「＋ 新增」文字按鈕，改回原有 `.add-row-btn` 圓形「＋」按鈕（藍色圓底白字，hover 時旋轉 `90deg`、放大 `1.1` 並變成綠色 `#28a745`）。
     - 統一上下固定條與中間卡片欄位水平邊界：`.adjust-topbar-inner`、`.adjust-card-list` 與 `.adjust-footer-inner` 皆置中套用 `max-width: 480px` 與一致的左右內距（`14px`），卡片內 2 行以 CSS Grid 切齊，消除手機與桌機寬度不協調問題。
  3. **監控畫面（`.wind-card` 與 `船期表`）**：
     - `.wind-card` 頂列將「北堤風速」與 `#dataTime` 左右並排；當 `#dynamicBox` 隱藏（非監控／已完成）時，`.wind-main-row` 置中顯示風速讀數，避免左側貼邊造成右側大塊空白；進入監控顯示 `#dynamicBox` 時切換 `.has-status-pill`，自動改為左右平衡排列（左側風速讀數＋右側狀態膠囊）。
     - `船期表` 標題列 `#scheduleHeaderRow th` 加入霧藍灰不透明底色（`#DCE5F0`，文字 `#1E3A5F`）與外框圓角分隔，黏性捲動時完整遮罩下方資料列。
  4. **下方固定四選項（`.bottom-nav`）**：選中分頁（`.bottom-nav-item.is-active`）於圖示外框 `.bottom-nav-icon-wrap` 顯示暖琥珀金黃膠囊底色（`#FEF3C7`）＋金色邊框（`#F59E0B`），並加深海軍藍圖示線條與微幅放大（`stroke-width: 2.35; transform: scale(1.05)`）。
  5. **監控鈴鐺（`#soundToggle`）移回原位置**：將 `#soundToggle` 移出 `.app-header`（右上角只留 `#infoLink` 說明圖示，避免誤觸），恢復置於 `.schedule-header` 標題列中央（`grid-template-columns: 1fr auto 1fr`：`[船期表]` ｜ `[🔔]` ｜ `[⚙️]`），保留既有 `muted` / `armed` / 亮橘 `ringing` 三態 SVG 與 v1.4 顯示／音效邏輯。
  6. **方案 A「港務藍灰金 60-30-10」整體配色系統**：
     - `.app-header-bar`（`#0B2948` 配圓形白底 `logo.png` 徽章與 `3px solid #EAB308` 琥珀金下緣邊線）、純白卡片 `#FFFFFF`（邊框 `#D5DFEA`）、海洋藍圖示強調色 `#164E8A`、霧藍船期表頭 `#DCE5F0`、暖金選中導覽膠囊 `#FEF3C7`/`#F59E0B`、`W12` 橘色 `#D97706`／`W13` 海軍藍 `#0B2948` 碼頭標籤與 `#0B2948` 主要確認按鈕；`#forecastModal` 與 `#chatModal` 內部樣式維持不變。

## D7 — 上線前兩項細節微調與分階段實船觀察／上線授權
- **User Decision**:
  1. 下方 `監控` 圖示不需要顯示黃色標記。
  2. 北堤風速卡片：更新時間 `#dataTime` 位置改到風速數字下方，`北堤風速` 字體再放大加粗。
  3. 明確授權執行 GitHub 推送（**僅推功能分支 `feat/pwa-ui-redesign`，不要併回 `main` 主線**）、部署 Firebase Hosting，以及更新 GAS Web App；待 11/24–11/26 實船進港觀察穩定後再併回 `main`。
- **Adopted Behavior**:
  - `#navMonitorBtn.is-active .bottom-nav-icon-wrap` 維持透明無底色／無黃框（僅保留海軍藍粗體字與加粗圖示線條）；`預報`、`船期`、`聊天室` 選中時維持 `#FEF3C7`／`#F59E0B` 膠囊標記。
  - `.wind-card-label` 放大加粗為 `1.2rem` / `font-weight: 800` / `#0B2948`；`#dataTime` 移回風速主列下方，非監控置中（對齊置中風速）、監控中隨 `.has-status-pill` 靠左對齊（對齊左側風速）。
  - 本輪維持在 `feat/pwa-ui-redesign` 上推送 GitHub 並部署 Hosting 與 GAS；`main` 維持在 `0f74a11`（遠端 `origin/main` `5408cad`），待 11/24–11/26 觀察無誤後再另行確認合併主線。

## D8 — 風速數字再放大並與更新時間一同微調靠左
- **User Decision**: 「風速數字再放大，數字與更新時間位置往左靠一點」。
- **Adopted Behavior**:
  - `.wind-speed-num` 放大為 `clamp(3.35rem, 14vw, 4.25rem)`（監控中 `.has-status-pill` 採用 `clamp(3.05rem, 12.2vw, 3.85rem)` 兼顧 `375px` 雙行警告不溢位），`.wind-icon` 調整為 `26px`、`.wind-speed-unit` 調整為 `1.08rem`。
  - 未監控時 `.wind-main-row` 與 `#dataTime` 統一以 `padding-left: clamp(24px, 12%, 48px)`、`justify-content: flex-start` / `text-align: left` 呈現微靠左而不貼邊的平衡對齊；進入監控顯示 `.has-status-pill` 時回復 `padding-left: 2px` 與左右分散。
