# Decisions · 002-pwa-ui-redesign-v2

- **Date**: 2026-11-20
- **Baseline Revision**: `413047d4fd8b61561b0ade08928a3b25cb237294` (`feat/pwa-ui-redesign`)
- **Visual Source Mockups**:
  - `C:\Users\hilla\Desktop\2026-11-20 APP示意圖\監控介面.png`
  - `C:\Users\hilla\Desktop\2026-11-20 APP示意圖\風速預報介面.png`
  - `C:\Users\hilla\Desktop\2026-11-20 APP示意圖\船期調整頁.png`
  - `C:\Users\hilla\Desktop\2026-11-20 APP示意圖\聊天室.png`

## D1 — 監控頁「⚙️ 手動監控設定」與「🔔 進港提醒音效」位置
- **User Decision**: 「(Recommended) 維持在「船期表」卡片標題列（左 船期表、中 🔔鈴鐺、右 ⚙️齒輪）— 操作習慣與 v1.5 一致，不破壞上方風速卡的置中對稱」
- **Adopted Behavior**:
  - Keep `.schedule-header` 3-column grid (`1fr auto 1fr`) containing left `船期表`, center `#soundToggle` (only visible when `isMonitoring === true`), and right `.cpc-btn.pulso-settings` gear icon (`triggerOpenManualModal()`).
  - Preserves exact v1.4/v1.5 audio unlocking, looping alert, muted/armed/ringing SVGs, gear PulsoIcon 180-deg rotation, and pessimistic lock feedback.

## D2 — 作業聊天室入口流程與切分頁席位保留策略
- **User Decision**: 「維持先顯示「選擇角色」頁（改新淺藍白風格），選完進對話；切到其他分頁時暫留席位，點右上角角色膠囊可切換／釋放」
- **Adopted Behavior**:
  - Opening `聊天室` when `mySeat` is `null` shows `#chatRoleScreen` ("選擇角色") restyled in the 2026-11-20 ice-blue/white theme.
  - Once a user claims a speaking role (`mySeat` active), switching to `監控`, `預報`, or `船期` tabs hides `#chatModal` **without** releasing `mySeat`, and increments `chatNavSeq` (if an in-flight seat claim transaction settles *after* the user already navigated off the chat tab before entering `#chatRoomScreen`, it immediately releases `wonSeat` to prevent ghost seats).
  - Returning to `聊天室` while holding a valid `mySeat` resumes directly in `#chatRoomScreen` (unless the seat expired or was taken over remotely).
  - Clicking the top-right role capsule (`#chatRoleSwitchBtn`) inside `#chatRoomScreen` opens `#chatRoleScreen` so the user can switch roles or pick `觀眾` (which releases `mySeat`).
  - The 15-minute idle checker timer keeps running even while viewing other tabs and automatically releases `mySeat` if `Date.now() - lastChatActivityAt >= CHAT_IDLE_MS`; `beforeunload` continues to release `mySeat`.

## D3 — 聊天室訊息送出狀態顯示
- **User Decision**: 「(Recommended) 維持現行「已送出」（純 UI 改版，不新增 RTDB 節點、不動 Firebase Rules、不增資料庫寫入量）」
- **Adopted Behavior**:
  - Outgoing self messages continue displaying `${timeText} · 已送出` beneath the bubble. No `reads` node is added to RTDB and Firebase Rules are untouched.

## D4 — 船期調整頁日期輸入與速限選項
- **User Decision**: 「日期維持現行「MM/DD 文字輸入」（支援 0609 自動補斜線），僅改套 11/20 新卡片排版；速限維持 12 / 15」
- **Adopted Behavior**:
  - Date field inside each `.adjust-card` keeps the `MM/DD` text input (`validateDateInput` 3/4-digit auto-slash, `1–12` / `1–31` bounds check, blank-date `UNFINISHED_SHIP` support), decorated visually with a non-interactive right-aligned calendar SVG icon matching `船期調整頁.png`.
  - Speed limit dropdown keeps `12` / `15` (dynamically preserving any legacy non-12/15 custom numeric value if present).

## D5 — 視覺與功能整合細節（風速卡動態圖示、W13 深藍、純 UI 改版範圍）
- **User Decision**: 「風速大字8.6 m/s，保留動態PulsoIcon，W13深藍色，基本上主要換位置及風格，功能不變」
- **Adopted Behavior**:
  - `.wind-card` centers the wind readout (`#windSpeed`) and **retains the animated PulsoIcon `.wind-icon`** above `m/s` (hover/press runs `pulso-slide-right`; click-to-forecast was subsequently removed per D6 Item 6).
  - `W13` pill badge remains deep navy `#0B2948` with white text (`W12` stays orange `#D97706` with white text) in both the `船期表` and `船期調整` pages.
  - Scope stays strictly within `frontend/index.html`, `public/` (via `deploy/build_hosting.py`), and frontend tests (`tests/frontend-isolated.js`, `tests/frontend-echarts.js`); `<title>` stays `臺中LNG船監控(v1.5)`; mockup watermarks (`介面示意・模擬資料` / `介面示意・模擬對話`) are omitted; all 4 tabs share the unified top header bar and bottom 4-tab navigation bar.

## D6 — 使用者驗收回饋微調（2026-11-20 第二波需求與重疊 Bug 修正）
- **User Requests (1–6)**:
  1. Chat unread badge on bottom navigation tab must display as a crisp red dot (`10px` circle `#EF4444`, white ring cutout) and stay visible until the user actually enters `#chatRoomScreen` (via `isChatRoomVisible()`).
  2. Forecast ship selector card (`.card.forecast-ship-card`) & `#shipForecastSelect` adopt dark slate colors (`#0F1722` / `#162234`) harmonizing visually with the dark `#0F1722` ECharts chart card.
  3. Primary target device is mobile (`390x844` / `375x812`).
  4. Remove `#chatSpectatorBar` (`觀眾模式（僅供瀏覽）` divider line) above messages; move compact `僅供瀏覽` text label (`#chatSpectatorHint`) directly left of `#chatRoleSwitchBtn` in `#chatRoomScreen .chat-sub-header` when in spectator mode.
  5. Fix `#pwdModal` overlapped by ECharts tooltip (`z-index: 9999999`) when tapping bottom-nav `船期` directly from `風速預報` (`C:\Users\hilla\Desktop\003.png`) by creating isolated stacking contexts (`position: relative; z-index: 1; isolation: isolate;`) on `.forecast-chart-card` and `.chart-wrapper`.
  6. Remove click-to-forecast binding & pointer affordance on Monitor `#windSpeed` / `.wind-container`; navigation to `風速預報` is exclusively through the fixed bottom navigation tab (`#navForecastBtn`) while preserving animated PulsoIcon `.wind-icon`.

## D7 — 船期調整圓形新增鈕與奇偶卡片底色區隔（2026-11-20 第三波回饋）
- **User Requests (1.1–1.2)**:
  1. Restore the original circular `＋` add button (`#adjustAddBtn.add-row-btn`, `36px` circle, navy fill `#164E8A`) with 90° clockwise rotation + green highlight (`#28a745`) on hover, touch, or pointer slide (including mobile `touchstart`/`pointerenter`/`pointerdown` `.is-spin-green` trigger).
  2. Differentiate odd vs even `.adjust-card` backgrounds (`#FFFFFF` white for odd cards; `#EBEFF4` cool light gray for even cards via `.adjust-card:nth-child(even)`) so multi-ship lists are immediately distinguishable.
