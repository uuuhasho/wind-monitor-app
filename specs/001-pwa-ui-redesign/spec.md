# Specification · 001-pwa-ui-redesign

## Summary
Redesign the Taichung LNG Ship Monitoring PWA (`frontend/index.html`, `<title>臺中LNG船監控(v1.5)</title>`) to replace the existing glassmorphism/AI-styled UI with a clean, high-legibility maritime utility layout based on the user's 2026-11-19 mockups and notes, reorganize mobile navigation and thumb-friendly controls (bottom-sheet manual setup drawer, double-row card schedule editor), and implement end-to-end schedule entry deletion across frontend and GAS (`gas/monitor.js`).

## Scope
- `frontend/index.html` (main view layout, header, wind card + inline status pill, POB card, schedule table card, fixed bottom navigation bar, bottom-sheet manual settings drawer, double-row card schedule editor, password modal theme consistency).
- `gas/monitor.js` (`is_deleted` tombstone support in `update_schedule` & `getScheduleList()`, `MM/DD` leading-zero date normalization helper, preserving `terminal` in `UNFINISHED_SHIP`).
- `public/` rebuilt strictly via `python deploy/build_hosting.py`.
- `tests/frontend-isolated.js` and `tests/test_gas_archive.js` updated/expanded to verify all new requirements and retain regression coverage.

## Non-Goals (Explicitly Excluded)
- Do NOT alter `#forecastModal` dark theme or ECharts chart behavior (`天氣預報` remains untouched).
- Do NOT alter `#chatModal` or `#chatPreviewModal` internal UI, seat locking, or attachment logic (`聊天室` v2 remains untouched).
- Do NOT modify `backend/` (Cloud Run) or `frontend/presentation/index.html`.
- Do NOT deploy to Firebase Hosting, deploy GAS (`clasp push`/`clasp deploy`), push to GitHub, or access live `/formal` RTDB.

## Functional & UI Requirements

- **REQ-001 — Clean Utilitarian Visual System (Scheme A: Maritime Blue-Gray-Gold 60-30-10)**
  - Remove `backdrop-filter` glassmorphism, pastel radial gradients, and neon/breathing box-shadow animations from the main view and non-chat/non-forecast modals.
  - Use Scheme A 60-30-10 maritime light palette: cool mist-gray canvas (`#E9EEF4`), full-width `#FFFFFF` cards (`border: 1px solid #D5DFEA`, `border-radius: 16px`), navy primary (`#0B2948`), marine blue icon accent (`#164E8A`), and warm amber-gold 10% accent (`#EAB308` / `#FEF3C7` / `#F59E0B`) inside a max-480px centered mobile shell (`padding: 12px 14px calc(86px + env(safe-area-inset-bottom, 0px))`).
  - Update `<title>` to `臺中LNG船監控(v1.5)` and `<meta name="theme-color">` to `#0B2948`.

- **REQ-002 — Top Header (Navy Bar with Gold Accent, Logo, Info-Only Right Side)**
  - Full-width `.app-header-bar` (`#0B2948` background with `3px solid #EAB308` gold bottom border) containing max-480px centered `.app-header`: left displays `logo.png` inside a circular white badge (`34px`) + white title `臺中LNG船監控` (`h1`).
  - Right side displays ONLY `#infoLink` linking to `presentation/index.html` (`target="_blank"`) with a white circular `i` SVG icon (`#soundToggle` is moved out of `.app-header` to prevent accidental taps).

- **REQ-003 — 北堤風速 Card, Idle Centering & Embedded 2-Line Status Pill**
  - `.wind-card-top` aligns `北堤風速` on the left and `#dataTime` (`最後更新 MM/DD HH:mm`) on the right; remove redundant `風速預報 >` button while keeping `#windSpeed` clickable to open `#forecastModal`.
  - `.wind-icon` (PulsoIcon 3-path SVG with `pulso-wind` animation) sits vertically directly above `.wind-speed-unit` (`m/s`) to the right of `#windSpeed`.
  - When `#dynamicBox` is hidden (`stopped` or `isShipFinished`), `.wind-card` removes `.has-status-pill` and `.wind-main-row` centers `.wind-container` horizontally so no awkward blank void sits on the right.
  - When active (`isMonitoring`), `.wind-card` adds `.has-status-pill`, splitting `.wind-main-row` cleanly (`justify-content: space-between`) with `#dynamicBox` on the right:
    - `safe`: green solid pill (`#15803D`, white text) displaying `可進港 •`.
    - `waiting`: slate solid pill (`#475569`, white text) displaying `等待進港`.
    - `warning`: red solid 2-line pill (`#B91C1C`, white text) with top line `無法進港 •` and bottom compact sub-line(s) showing `風速超標` (when wind exceeds limit) OR `浪高 X > 2.5 m` / `能見度 Y < 2 浬` (preserving `/APP_SVG/wave.svg` and `/APP_SVG/eye.svg` rendered white via CSS filter).
  - At `375px` viewport width, `#windSpeed`, unit/icon, and `#dynamicBox` (including dual wave+visibility warning) must fit without horizontal overflow (`scrollWidth <= clientWidth`) or text clipping.

- **REQ-004 — POB Record Mutual Exclusion & Styling**
  - `#pobList` spans full card width between `.wind-card` and `.schedule-section`.
  - Maintains exact mutual exclusion logic: for a single monitored ship, once `daily_records/{date}/{card}/pob_info` exists, `#dynamicBox` disappears (`isShipFinished = true`) and `#pobList` appears; when a second ship is monitored on the same day, both `#dynamicBox` (for the active second ship) and `#pobList` (for the finished first ship) can appear simultaneously.
  - Styled as crisp solid-tinted alert card (green `#DCFCE7` / `#166534` for POB entry; red `#FEE2E2` / `#B91C1C` when no-entry reason only).

- **REQ-005 — 船期表 Card, Restored Center Bell & Tinted Table Header**
  - `.schedule-header` uses 3-column grid (`1fr auto 1fr`): left `船期表` (`h2`), center `#soundToggle` alert bell button (restored to legacy v1.4 location inside `.schedule-header` to avoid mis-tapping top-right `#infoLink`, retaining exact v1.4 visibility/audio logic and `muted`/`armed`/`ringing` SVG icons), right gear button `.cpc-btn.pulso-icon.pulso-settings` (keeping `pulso-spin-180` animation and `.locked-btn` pessimistic lock feedback; clicking gear verifies password via `triggerOpenManualModal()`).
  - Table header `#scheduleHeaderRow th` has opaque mist-blue background fill (`#DCE5F0`, `#1E3A5F` bold text, `#C8D6E5` bottom border) clearly distinct from white rows. Columns: `日期`, `船名`, `速限 m/s`.
  - Date cell shows `${item.d}` with terminal pill badge underneath (`W12` orange `#D97706` white text; `W13` deep navy `#0B2948` white text).
  - Speed limit cell displays numeric value only (e.g. `12`, `15`, no `m/s` suffix).
  - Active monitored ship row highlights in green (`safe`), red (`warning`), or slate (`waiting`), matching `#dynamicBox`.
  - Remove legacy `#scheduleHeaderRow` `dblclick` and double-tap event triggers completely.

- **REQ-006 — Fixed 4-Tab Bottom Navigation Bar with Active Icon Capsule**
  - Fixed bottom bar with 4 equal tabs:
    1. `監控` (`#navMonitorBtn`, active state when on home view)
    2. `預報` (`#navForecastBtn`, opens `#forecastModal`)
    3. `船期` (`#navScheduleBtn`, displays `.locked-btn` when editing lock held by others; calls `triggerOpenScheduleAdjustModal()` requiring password)
    4. `聊天室` (`#chatOpenBtn`, opens `#chatModal`, hosts static red unread indicator `#chatUnreadBadge` containing `!` styled as a compact red circular dot `#dc2626` with `color: #dc2626` and `animation: none`, preserving v2 test compatibility)
  - When a tab is active (`.is-active`), `.bottom-nav-icon-wrap` changes visibly with warm amber-gold capsule background (`#FEF3C7`), gold border (`#F59E0B`), and thicker dark navy icon (`#0B2948`, `stroke-width: 2.35`).

- **REQ-007 — Bottom-Sheet Manual Monitoring Drawer (`#manualModal`)**
  - Renders as a bottom-sliding drawer anchored to bottom of viewport (`max-width: 480px`, top rounded corners, drag handle, `×` close button, backdrop dismiss).
  - Start mode (`app_mode !== 'start'`):
    - `#shipName` text input.
    - `#speedSegmentGroup` 2-column segmented buttons (`cols-2`): **`12`** | **`15`** (default active `15`; NO `m/s` suffix, NO custom speed button or input); hidden `<input type="hidden" id="limitSpeed" value="15">` stores the selected limit for `setMode('start')`.
    - `#terminalSegmentGroup` segmented buttons: `W12` (`#D97706` active), `W13` (`#0B2948` default active); syncs `#terminal` input.
    - `#startBtn` submits start command (`開始監控`).
  - Stop mode (`app_mode === 'start'`):
    - Shows active ship summary banner + existing `#pobTime` (`04:00`–`17:59` validation) and `#noEntryReason` / `#customReasonGroup`.
    - `#resetBtn` is solid red (`#DC2626`, overriding/removing legacy `#FF69B4` pink).

- **REQ-008 — Full-Screen Double-Row Card Schedule Editor (`#scheduleAdjustModal`)**
  - Full-screen sheet with uniformly aligned `max-width: 480px` horizontal column containers (`.adjust-topbar-inner`, `.adjust-card-list`, `.adjust-footer-inner`, matching `14px` left/right gutters so header controls, middle cards, and bottom `儲存調整` button align vertically across mobile and desktop viewports):
    - Top bar left `#adjustBackBtn`: left-arrow SVG icon ONLY (`aria-label="返回監控"`, without `"監控"` text).
    - Top bar center: `船期調整`.
    - Top bar right `#adjustAddBtn`: legacy `.add-row-btn` circular `+` button (`30px`, marine blue `#164E8A` white `+`; hover rotates `90deg`, scales `1.1`, and turns `#28a745` green).
  - Each `.adjust-card` has 2 CSS-grid-aligned rows:
    - Row 1: Date text input (`placeholder="MM/DD"`, supports `M/D`, `MM/DD`, and 3–4 digit auto-format like `0609 -> 06/09`, `614 -> 6/14`) + `W12`/`W13` `<select>` + delete icon button (`deleteEditItem(index)`).
    - Row 2: Ship name text input + `12`/`15` speed limit `<select>` (dynamically preserving any non-12/15 custom numeric limit as a selected option).
  - Blank-date rows (e.g. `UNFINISHED_SHIP` injected by GAS after `no_entry_reason` stop) appear at the top with a visual indicator badge and empty date input (`""`), and save cleanly with `d: ""` or user-entered date.
  - Clicking delete prompts `confirm()`, removes the row from `editScheduleList`, and when saved includes `{ ship_name, d, is_deleted: true }` in the `diffList` sent to GAS `update_schedule`.
  - Validates non-empty ship names, rejects duplicate ship names (case-insensitive trimmed), validates non-empty date syntax/calendar range (`1–12` month, `1–31` day), escapes HTML attributes (`escapeHtml`) against XSS, normalizes leading zeros (`06/09` -> `6/9`) and terminals (`""` -> `W13`) symmetrically before diffing, and emits `is_deleted: true` entries before `is_deleted: false` entries.

- **REQ-009 — GAS Backend Deletion & Date Normalization (`gas/monitor.js`)**
  - Add `normalizeScheduleDateMD(dStr)` to strip leading zeros (`"06/09"` -> `"6/9"`, preserving `""`).
  - `update_schedule` handles `item.is_deleted === true` by writing tombstone `{ d: normalizeScheduleDateMD(item.d || ""), ship_name, is_deleted: true, created_at }` to `schedule_overrides/${key}`; non-deleted items write `is_deleted: false` and normalized `d`.
  - `getScheduleList(strict)` normalizes Calendar API dates in Step 1, filters out any ship matched by `ov.is_deleted === true` (and skips pushing deleted overrides), auto-cleans expired tombstones (past-date, or undated with `created_at < today`), normalizes dates during today-POB checks, and preserves `terminal` in `UNFINISHED_SHIP`. Note: undated `UNFINISHED_SHIP` deletion tombstones expire the following day (`created_at < dateStr`) as documented behavior.
  - `updateFirebaseScheduleList(allowEmptyOnVerifiedApi = false)`: when called from `update_schedule` with `true`, calls `getScheduleList(true)` and writes `[]` to Firebase `schedule_list` if all ships were legitimately deleted (when Calendar API succeeded or `SHIP_SCHEDULE_API_URL` is unset), while aborting if `getScheduleList(true)` throws due to Calendar API or `schedule_overrides` read failure (still preserving `releaseEditingLock()`). Background callers keep `allowEmptyOnVerifiedApi = false` fail-safe so unexpected empty lists do not overwrite Firebase `schedule_list`.
  - `set_mode` reset stores `terminal` in `UNFINISHED_SHIP`; `checkDailySchedule()`, `tryHandoffToNextShip()`, and `archiveAndClearFirebase()` normalize `item.d` when matching `todayM_D`.

- **REQ-010 — Regression Protection & Automated Verification**
  - All existing forecast chart/lease behavior, POB behavior, v2 ship chat room behavior (`AC-001`~`AC-004`, `F-001`~`F-004`, mobile picker reclaim), and GAS trigger/condition/archive behavior continue passing.

## Acceptance Criteria
- **AC-001**: `<title>` is `臺中LNG船監控(v1.5)`; `.app-header-bar` uses `#0B2948` navy with `#EAB308` gold bottom accent, white-circle `logo.png`, white `臺中LNG船監控`, and ONLY `#infoLink` (`presentation/index.html`) on right; page uses `#E9EEF4` canvas / `#FFFFFF` cards without `backdrop-filter`; `#soundToggle` is inside `.schedule-header` center (hidden when stopped, SVG transitions `muted` -> `armed` -> `ringing` on `safe` -> `muted`); old `.presentation-link` block is absent.
- **AC-002**: Wind card top bar pairs `北堤風速` and `#dataTime`; old `風速預報` button inside card is absent; `.wind-icon` sits above `m/s` and keeps PulsoIcon animation; clicking `#windSpeed` opens `#forecastModal`; idle `.wind-main-row` centers `.wind-container` without `.has-status-pill`.
- **AC-003**: When monitoring, `.wind-card` gains `.has-status-pill` and `#dynamicBox` renders on the right of `.wind-container` (`justify-content: space-between`) with `可進港`, `等待進港`, and 2-line `無法進港` (`風速超標`, `浪高 X > 2.5 m`, `能見度 Y < 2 浬`), with zero horizontal overflow at `375x812`; when a single active ship gets `pob_info`, `#dynamicBox` hides and `#pobList` displays; when a second ship is monitored, both show simultaneously.
- **AC-004**: `船期表` card has opaque tinted header `#scheduleHeaderRow th` (`rgb(220, 229, 240)`), `日期 | 船名 | 速限 m/s`, `W12` (`rgb(217, 119, 6)`) / `W13` (`rgb(11, 41, 72)`) badges under date, numeric-only speed limit, active row highlight (`safe`/`warning`/`waiting`), centered `#soundToggle`, and gear button (PulsoIcon spin, password-gated bottom-sheet `#manualModal`). Double-clicking/double-tapping `#scheduleHeaderRow` does NOT open `#pwdModal` or `#scheduleAdjustModal`.
- **AC-005**: Fixed 4-tab bottom nav renders `監控`, `預報`, `船期`, `聊天室` with warm amber-gold active icon pill (`#FEF3C7` bg / `#F59E0B` border); `預報` opens `#forecastModal`; `船期` reflects `.locked-btn` and opens password-gated `#scheduleAdjustModal`; `聊天室` hosts `#chatUnreadBadge` (static `!` styled as solid red dot `#dc2626`) and opens `#chatModal`.
- **AC-006**: `#manualModal` opens anchored at bottom (`bottom === viewportHeight`), start mode has ONLY `12` | `15` speed segmented buttons (no `m/s`, no `自訂` button or `#customLimitSpeedWrap`, default `15`) and `W12`/`W13` terminal segmented buttons (default `W13`, active color changes), live background `active_status` wind ticks while `#manualModal` is open do NOT reset user's in-progress segmented selections, and stop mode renders red (`rgb(220, 38, 38)`) `#resetBtn` and preserves POB / no-entry submission.
- **AC-007**: `#scheduleAdjustModal` has left-arrow-only `#adjustBackBtn` (no `"監控"` text), circular rotating-green `#adjustAddBtn.add-row-btn`, and uniformly aligned `.adjust-topbar-inner`, `.adjust-card`, and `#saveScheduleBtn` edges (`<= 1px` diff at both `390x844` and `1280x800`), keeps blank-date `UNFINISHED_SHIP` on top, accepts `MM/DD` (`06/09` -> `6/9` in diff payload) while rejecting out-of-range dates (`99/99`), trims `ship_name` when diffing and rejects duplicate/empty ship names, and emits `is_deleted: true` before `is_deleted: false` on delete + save.
- **AC-008**: `tests/test_gas_archive.js` passes all existing 29 scenarios plus new `update_schedule` `is_deleted: true` tombstone filtering, deleting the last remaining ship (`schedule_list` becomes empty), Calendar API failure fail-safe retention (does not wipe `schedule_list`), re-add override, expired tombstone cleanup, `UNFINISHED_SHIP` terminal retention, and `06/09` -> `6/9` normalization scenarios.
- **AC-009**: `python deploy/build_hosting.py`, `pytest`, `tests/frontend-echarts.js`, and `tests/frontend-isolated.js` (including all v2 chat room checks) pass with exit code 0 against `public/` served on `127.0.0.1:4177`.
- **AC-010**: Mobile screenshots (`390x844` and `375x812`) across monitor states, manual drawer, schedule adjust cards, and forecast modal pass visual inspection without overlap, clipping, or unintended visual regressions in forecast/chat modals.
