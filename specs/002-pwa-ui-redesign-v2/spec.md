# Specification · 002-pwa-ui-redesign-v2

## Summary
Upgrade the Taichung LNG Ship Monitoring PWA (`frontend/index.html`, `<title>臺中LNG船監控(v1.5)</title>`) to the 2026-11-20 unified 4-tab layout (`監控`, `預報`, `船期`, `聊天室`) based on the 4 desktop mockups (`C:\Users\hilla\Desktop\2026-11-20 APP示意圖\*.png`) and user consensus (`D1`–`D5`), converting `預報`, `船期`, and `聊天室` from standalone modal overlays into unified tabs sharing a single top navy header bar and bottom navigation bar while preserving all existing business logic, ECharts forecast behavior, GAS backend API contracts, and v2 chat security/seat mechanics.

## Scope
- `frontend/index.html`: unified 4-tab App Shell, ice-blue/white design tokens, centered wind card with full-width status bar, `POB 紀錄` card, `船期表` card + light manual bottom sheet, embedded `風速預報` tab, embedded `船期調整` tab with dirty-leave protection, embedded `作業聊天室` tab with off-tab seat retention, and updated JS tab router.
- `public/`: rebuilt strictly via `python deploy/build_hosting.py`.
- `tests/frontend-isolated.js`: updated and expanded to verify `AC-001`–`AC-010`.
- `tests/frontend-echarts.js`: run unchanged to guarantee full ECharts forecast compatibility.

## Non-Goals (Explicitly Excluded)
- Do NOT modify `gas/monitor.js`, `backend/`, or `frontend/presentation/index.html`.
- Do NOT add new RTDB paths (`reads`, etc.) or alter Firebase Security Rules.
- Do NOT alter POB time validation (`04:00`–`17:59`), schedule `diffList` payload contract, or chat attachment security limits/filters.
- Do NOT merge to `main`, push to GitHub, deploy Firebase Hosting, or run `clasp` without post-acceptance authorization.

## Functional & UI Requirements

- **REQ-001 — Unified 4-Tab App Shell & Ice-Blue/White Visual System**
  - Top header bar `.app-header-bar` is fixed at viewport top (`height: 56px`, `#0B2948` solid navy background, NO yellow/gold bottom border): left shows circular white badge with `logo.png` + vertical divider (`1px`, `rgba(255,255,255,0.35)`) + white title `臺中 LNG 船監控`; right shows `#infoLink` (`href="presentation/index.html"`, `target="_blank"`, `rel="noopener"`) displaying circular exclamation/info SVG icon + `操作說明` text.
  - Canvas background uses soft ice-blue gradient (`linear-gradient(180deg, #E8F1FA 0%, #EEF5FC 55%, #E3EEF9 100%)`), cards use `#FFFFFF` (`border: 1px solid #DCE6F2`, `border-radius: 16px`, subtle shadow).
  - Fixed bottom 4-tab `.bottom-nav` (`height: 66px + safe-area-inset-bottom`, `#FFFFFF`, top border `#DCE6F2`) contains 4 equal tabs:
    1. `監控` (`#navMonitorBtn`, gauge icon)
    2. `預報` (`#navForecastBtn`, line-chart icon)
    3. `船期` (`#navScheduleBtn`, calendar-pencil icon, reflects `.locked-btn` when editing lock held by others)
    4. `聊天室` (`#chatOpenBtn`, double-chat icon, hosts static circular red unread dot `#chatUnreadBadge`, `10px` `#EF4444` with cutout ring, `animation: none`; cleared only when entering `#chatRoomScreen`)
  - All 4 tabs (including `監控`) uniformly style `.bottom-nav-item.is-active` with light sky-blue rounded capsule background (`#D9ECFF`) on `.bottom-nav-icon-wrap`, vivid blue icon & label (`#1877F2`).
  - Omit mockup watermarks (`介面示意・模擬資料` / `介面示意・模擬對話`).

- **REQ-002 — Monitor Tab (`#monitorView`): Centered Wind Card & Full-Width Horizontal Status Bar**
  - `.wind-card` centers `.wind-card-label` (`北堤風速`, bold navy), centers `.wind-main-row` containing `#windSpeed` (large bold numeric readout, non-clickable with `cursor: default`) and `.wind-detail` (**retaining animated PulsoIcon `.wind-icon.pulso-icon.pulso-wind`** directly above `.wind-speed-unit` `m/s`), and centers `#dataTime` (`更新時間 M/D HH:mm`) beneath `.wind-main-row`. Navigation to `預報` is strictly via `#navForecastBtn` in `.bottom-nav` (D6).
  - When `isMonitoring` (`app_mode === 'start' && !isShipFinished`), `.wind-status-divider` (`1px solid #E2EAF2`) and full-width horizontal `#dynamicBox` render inside the bottom of `.wind-card`:
    - `safe`: soft green bar (`#DCFCE7`, `#15803D` text) showing circle-check SVG + vertical divider + bold `可進港` + active ship name.
    - `waiting`: soft slate bar (`#E2E8F0`, `#475569` text) showing clock SVG + vertical divider + bold `等待進港` + active ship name.
    - `warning`: soft red bar (`#FEE2E2`, `#B91C1C` text) showing circle-`!` SVG + vertical divider + bold `無法進港` + active ship name, plus compact sub-line(s) showing `風速超標` OR `浪高 X > 2.5 m` / `能見度 Y < 2 浬` (preserving `/APP_SVG/wave.svg` and `/APP_SVG/eye.svg` tinted `#B91C1C` via CSS filter).
  - When stopped or finished (`!data || data.app_mode !== 'start' || isShipFinished`), both `.wind-status-divider` and `#dynamicBox` hide cleanly. Zero horizontal overflow (`scrollWidth <= clientWidth`) at `375x812`.

- **REQ-003 — `POB 紀錄` Card & Mutual Exclusion**
  - `#pobList` renders as a full-width white `.card.pob-card` between `.wind-card` and `.schedule-section` when today's records contain at least one `pob_info.formatted_msg`, hidden otherwise.
  - Inside `.pob-card`: header `POB 紀錄`, followed by `.pob-item-row` rounded inner rows (`#F8FAFC`, `border: 1px solid #E2EAF2`) showing ship name on left and bold `HH:mm` on right for normal POB entries, or red-tinted `.pob-item-row.is-no-entry` (`#FEF2F2` / `#FECACA` / `#B91C1C`) for `no_entry_reason` records.
  - Exact single-ship mutual exclusion and same-day dual-ship coexistence with `#dynamicBox` remain unchanged.

- **REQ-004 — `船期表` Card, Center Bell, Navy `W13` & Light Manual Drawer**
  - `.schedule-header` keeps 3-column grid (`1fr auto 1fr`): left `船期表` (`h2`), center `#soundToggle` alert bell (hidden when `!isMonitoring`, exact `muted` / `armed` / `ringing` SVG and audio logic), right `.cpc-btn.pulso-icon.pulso-settings` gear icon (PulsoIcon 180-deg rotation, pessimistic lock `.locked-btn`, password-gated `triggerOpenManualModal()`).
  - `#scheduleHeaderRow th` uses soft ice-blue `#E2EEFA` background (`#1E3A5F` text) with columns `日期`, `船名`, `速限`; NO `dblclick`/double-tap trigger.
  - Date cell shows `${item.d}` with badge below: `W12` orange (`#D97706`, white text), `W13` **deep navy (`#0B2948`, white text)** per D5; speed limit column renders numeric value only. Active monitored ship row highlights (`schedule-row-safe` / `schedule-row-warning` / `schedule-row-waiting`).
  - `#manualModal` remains a bottom-sheet overlay (`z-index: 2000`, covering bottom nav) restyled to match the 11/20 clean light blue/white theme: `12` | `15` speed buttons, `W12` (`#D97706`) | `W13` (`#0B2948`) terminal buttons, live `active_status` wind-tick guard, vivid blue `#0066E6` `#startBtn`, and solid red `#DC2626` `#resetBtn` (with `04:00`–`17:59` POB validation).

- **REQ-005 — Embedded `風速預報` Tab (`#forecastModal`)**
  - Renders inside the shared App Shell (`#monitorView` hidden when active; top header & bottom nav visible).
  - Top row displays `風速預報` title on left and yellow pill `#forecastUpdateBtn` (with crisp circular refresh SVG + `手動更新` / lease states `更新中...` / `請手動更新`) on right.
  - Central `.forecast-chart-card` (`position: relative; z-index: 1; isolation: isolate; #0F1722` background, `border-radius: 18px`) contains: top centered legend (`空軍預測` orange solid line, `ECMWF陣風` cyan dashed line), `#forecastChart` inside isolated `.chart-wrapper` (`z-index: 1; isolation: isolate;` so ECharts tooltips never overlay `#pwdModal` or fixed chrome), `yAxis.name: 'm/s'`, `xAxis.axisLabel.formatter` displaying 2-line `MM/DD\nHH:00` while retaining `${mm}/${dd} ${hh}:00` in `xAxis.data`, bright-blue `#4BA3FF` `dataZoom` slider at `bottom: '1%'`, `height: 14`, and right-aligned `#forecastStatus` below `.chart-wrapper`.
  - Below chart card: dark-slate `.card.forecast-ship-card` (`#0F1722`, subtle cool border) matching the chart card with `選擇船舶` label (`#CBD5E1`) and dark `#shipForecastSelect` dropdown (`#162234`, `#F8FAFC` text, `#93C5FD` chevron SVG), plus footer text `本預報僅用於判斷 LNG 船進出港`.
  - Preserves `forecast_update_lock` lease + `serverTimeOffset`, ship auto-focus (`05:00` summer / `06:00` winter), and `tests/frontend-echarts.js` compatibility.

- **REQ-006 — Embedded `船期調整` Tab (`#scheduleAdjustModal`) with Dirty-Leave Guard**
  - Password-gated (`triggerOpenScheduleAdjustModal()`) + pessimistic lock; renders inside the shared App Shell (`top header` & `bottom nav` visible).
  - Top row displays left `船期調整` + subtitle `修改後請儲存。`, right original circular `#adjustAddBtn.add-row-btn` (`＋`, `36px` circle, navy `#164E8A`, turns green `#28a745` and rotates `90deg` on hover/touch/slide via `.is-spin-green`).
  - `.adjust-card` alternates crisp `#FFFFFF` (odd cards) and cool light gray `#EBEFF4` (even cards, `.adjust-card:nth-child(even)`) for visual separation; each card displays: card header (live `.adjust-card-title` synced with ship name, optional `未進港待排期` badge, right trash button `.adjust-delete-btn`) + thin divider; full-width `日期` row (`MM/DD` input supporting `0609 -> 06/09` auto-slash and `1–12`/`1–31` validation + decorative right calendar SVG icon + `.date-error`); 2-column row (`碼頭` pill-decorated `#W12`/`#W13` `<select>` wrapper syncing `.badge-w12` orange / `.badge-w13` `#0B2948` on change + `速限` `<select>` `12`/`15` + custom numeric fallback); full-width `船名` input (`oninput` updates header title live).
  - Bottom action bar `.adjust-actions-row`: primary vivid blue `#saveScheduleBtn` (`#0066E6`, circle-check SVG + `儲存變更`) and secondary white outlined `#cancelScheduleBtn` (`取消`).
  - Leaving the `船期` tab via `#cancelScheduleBtn` OR clicking another bottom nav tab (`switchMainTab`) runs `hasUnsavedScheduleChanges()`: if dirty, prompts `confirm('尚有未儲存的船期修改，確定要離開並捨棄變更嗎？')`; returning `false` cancels the tab switch and preserves edits/lock; returning `true` (or when clean) hides `#scheduleAdjustModal`, calls `releaseLock()`, and clears `cachedSessionPassword`. Preserves XSS escaping, symmetric normalization, trimmed ship matching, tombstone-first `diffList`, and `beforeunload` lock release.

- **REQ-007 — Embedded `作業聊天室` Tab (`#chatModal`) with Off-Tab Seat Persistence**
  - Renders inside the shared App Shell fixed between header (`top: 56px`) and bottom nav (`bottom: calc(66px + safe-area-inset-bottom)`), keeping `作業聊天室` / `選擇角色` sub-header and composer pinned while message list / role list scrolls independently.
  - `#chatRoleScreen`: white sub-header (`選擇角色` + `#chatDateBadge` light pill), white role cards (`CPC_LM` `中油LNG`, `Pilot`, `Other` `其他`, `Spectator` `觀眾`) with `pic/` icons and `pic/lock.png`, and light bottom sheet `#chatNameSheetBackdrop` hoisted as a direct child of `<body>` (`position: fixed; inset: 0; z-index: 2060`, `.chat-bottom-sheet` constrained to `max-width: 480px; margin: 0 auto`).
  - `#chatRoomScreen`: white sub-header (`#chatModalTitle` `作業聊天室` + right `.chat-room-header-right` containing `#chatSpectatorHint` `僅供瀏覽` [visible only in spectator mode, no top message-area spectator divider bar] and clickable `#chatRoleSwitchBtn` role pill showing active role or `觀眾` to jump back to `#chatRoleScreen`), ice-blue `#chatMessagesContainer` (`#EBF3FC`) with centered date pill (`M月D日`), white other bubbles (`#FFFFFF`), soft sky-blue self bubbles (`#C2E1FF`), `${timeText} · 已送出` (D3), clean standalone white file attachment card (file-only bubbles omit colored outer `.chat-bubble` background/padding; shows blue file SVG badge, bold filename, `EXT · SIZE`, blue download SVG icon button `.chat-att-file-btn`), pinned white `#chatComposerFooter` (paper-clip SVG `#chatAttachBtn`, rounded `#chatTextInput` `輸入訊息...`, vivid blue `#chatSendBtn` `#0066E6` `送出`).
  - Off-tab seat persistence (D2):
    - Opening `聊天室` checks `mySeat && mySeat.dateStr === currentChatDateStr`: if true, opens `#chatRoomScreen` and refreshes RTDB heartbeat via `renewChatSeatActiveAt()`; if false, opens `#chatRoleScreen`.
    - Switching to another bottom tab (`監控`/`預報`/`船期`) hides `#chatModal` **without** calling `leaveChatRole()`, updates unread badge, and increments `chatNavSeq`. Clicking outside `.chat-modal-box` on desktop margins must NOT exit the `聊天室` tab.
    - In `selectChatRole()`, if the user navigated away from `聊天室` (`!isChatModalOpen()` or `chatNavSeq` changed) *while* the seat claim transaction was still in-flight (before entering `#chatRoomScreen`), `wonSeat` is immediately released so no ghost seat remains.
    - Background timer keeps checking `Date.now() - lastChatActivityAt >= CHAT_IDLE_MS` whenever `mySeat` is non-null (even while viewing another tab) and calls `leaveChatRole(...)` if idle for 15 minutes; `beforeunload` releases `mySeat`.
    - Keep `#chatAttachSheetBackdrop` hoisted as a direct child of `<body>` (`position: fixed; inset: 0; z-index: 2060`, `.chat-bottom-sheet` `max-width: 480px; margin: 0 auto`), `#chatPreviewModal` (`z-index: 2100`), image compression, cancel upload, security checks, and mobile picker reclaim intact.

- **REQ-008 — Regression Protection & Automated Verification**
  - `tests/frontend-isolated.js` verifies all new `AC-001`–`AC-010` contracts, tab switching, dirty-leave guard, off-tab seat retention & idle expiry, plus existing forecast lease & chat v2 security/upload/reclaim tests.
  - `tests/frontend-echarts.js`, `python deploy/build_hosting.py`, `node --test`, and `pytest` all pass with zero failures.

## Acceptance Criteria
- **AC-001**: Unified top navy header (`#0B2948`, no gold bottom border, `logo.png` + `|` + `臺中 LNG 船監控` + `操作說明` link) and fixed 4-tab bottom nav (`.bottom-nav-inner` height `66px`) stay visible across all 4 tabs; all 4 tabs show `#D9ECFF` / `#1877F2` active capsule when selected; `#chatUnreadBadge` renders static red dot (`#EF4444`, `10px`, `border-radius: 999px`, `animationName === 'none'`) and clears only when `#chatRoomScreen` is open.
- **AC-002**: Monitor tab centers `.wind-card` (`北堤風速`, `#windSpeed`, animated `.wind-icon` PulsoIcon above `m/s`, `#dataTime` `更新時間 ...`); `#windSpeed` has non-pointer cursor and clicking `#windSpeed` does NOT open `預報` tab (`#navForecastBtn` only); `.wind-status-divider` + full-width `#dynamicBox` render inside `.wind-card` for `safe` (`可進港`), `waiting` (`等待進港`), and `warning` (`無法進港` + `風速超標` / `浪高 X > 2.5 m` / `能見度 Y < 2 浬` with `#B91C1C`-tinted wave/eye SVGs) with zero horizontal overflow at `375x812` even with long ship names and dual warnings.
- **AC-003**: `#pobList` renders as white card `POB 紀錄` with left ship name / right bold `HH:mm` (red inner row for `no_entry_reason`), preserving single-ship mutual exclusion and same-day dual-ship coexistence.
- **AC-004**: `船期表` retains `[船期表] | [#soundToggle] | [.cpc-btn]`, light-blue `#E2EEFA` header (`日期 | 船名 | 速限`), `W12` orange (`rgb(217, 119, 6)`), `W13` deep navy (`rgb(11, 41, 72)`), numeric speed, no header dblclick/double-tap, and bottom-sheet `#manualModal` (`12`/`15`, `W12`/`W13`, live tick guard, solid red `#resetBtn`).
- **AC-005**: `風速預報` opens via `#navForecastBtn` as an embedded tab with visible header/bottom nav, dark `#0F1722` chart card & dark `.card.forecast-ship-card` (`#0F1722` / `#162234` `#shipForecastSelect`), yellow `#forecastUpdateBtn`, 2-line X-axis labels, isolated ECharts stacking (`#pwdModal` opens cleanly above tooltips), and passes `tests/frontend-echarts.js` + lease/offset tests unchanged.
- **AC-006**: `船期調整` opens as a password-gated embedded tab with visible header/bottom nav, circular `#adjustAddBtn.add-row-btn` (`＋`, `36x36`, rotates `90deg` & turns green `#28a745` on hover/touch/slide), alternating `#FFFFFF` (odd) / `#EBEFF4` (even) `.adjust-card` backgrounds, `MM/DD` input (`0609 -> 06/09`, `99/99` error), live `W12`/`W13` pill sync, `12`/`15`/custom speed, `儲存變更` + `取消` (0 false dirty-leave prompts on save), dirty-leave guard (Cancel keeps edits & lock; Confirm/clean releases lock & clears password), delayed auth failure session/tab guard, and tombstone-first `diffList`.
- **AC-007**: `作業聊天室` opens as an embedded tab with visible header/bottom nav: `#chatRoleScreen` displays first when unseated (unread badge remains until `#chatRoomScreen` is entered); hoisted `#chatNameSheetBackdrop`/`#chatAttachSheetBackdrop` cover full viewport above header/bottom-nav (`max-width: 480px` sheet); clicking desktop horizontal margins does NOT close `#chatModal`; spectator mode renders `#chatSpectatorHint` (`僅供瀏覽`) left of `#chatRoleSwitchBtn` without `#chatSpectatorBar` divider; claiming a seat hides `#chatSpectatorHint` and enters `#chatRoomScreen` with `#chatRoleSwitchBtn` pill showing role label; switching to `監控` retains `mySeat` and returning resumes `#chatRoomScreen`; clicking `#chatRoleSwitchBtn` opens `#chatRoleScreen` and selecting `觀眾` releases `mySeat`; 15-min idle auto-releases `mySeat` even off-tab; in-flight claim during tab switch leaves no ghost seat; `.chat-date-divider` renders `M月D日`, self bubbles show `#C2E1FF` + `已送出`, standalone white file cards display `EXT · SIZE` + blue download SVG, styled `#chatPreviewCloseBtn`, and all XSS/security/upload/zoom/reclaim checks pass.
- **AC-008**: `python deploy/build_hosting.py` builds `public/` cleanly with zero missing resources.
- **AC-009**: `node --test`, `pytest`, `tests/frontend-isolated.js`, and `tests/frontend-echarts.js` all pass with exit code 0 after final edits.
- **AC-010**: Screenshots across `390x844`, `375x812`, and `1280x800` covering all 4 tabs, `#manualModal`, `#chatRoleScreen`, and `#chatRoomScreen` pass visual inspection without overlap, clipping, or horizontal scroll.
