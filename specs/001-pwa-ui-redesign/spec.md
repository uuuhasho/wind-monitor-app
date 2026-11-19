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

- **REQ-001 — Clean Utilitarian Visual System & Full-Width Cards**
  - Remove `backdrop-filter` glassmorphism, pastel radial gradients, and neon/breathing box-shadow animations from the main view and non-chat/non-forecast modals.
  - Use a clean light maritime background (`#EEF3F7`), full-width white cards (`#FFFFFF`, `border: 1px solid #E2E8F0`, `border-radius: 16px`) inside a max-480px centered mobile shell with compact side padding (`12px`) and bottom nav clearance (`84px + env(safe-area-inset-bottom)`).
  - Update `<title>` to `臺中LNG船監控(v1.5)` and `<meta name="theme-color">` to `#EEF3F7`.

- **REQ-002 — Top Header (Logo, Title, Conditional Bell SVG, Info Icon)**
  - Left side displays existing `logo.png` and title `臺中LNG船監控` (`h1`).
  - Right side displays `[#soundToggle button]` immediately left of `[#infoLink anchor]` linking to `presentation/index.html` (`target="_blank"`) with a circular `i` SVG icon (removing the old text `操作說明` block below the title).
  - `#soundToggle` keeps exact v1.4 visibility and playback rules: shown only when `isMonitoring` (`app_mode === 'start' && !isShipFinished`), default `isSoundEnabled = false`, click unlocks audio and toggles sound. Renders inline SVG reflecting state (`data-sound-state="muted"` gray slashed bell, `"armed"` navy bell, `"ringing"` prominent `#EA8C1E` orange bell with sound waves when `safe` and sound enabled).

- **REQ-003 — 北堤風速 Card & Embedded 2-Line Status Pill**
  - Card title reads `北堤風速` (replacing `風速風農數`); remove the redundant `風速預報 >` button inside this card while keeping `#windSpeed` clickable to open `#forecastModal`.
  - `.wind-icon` (PulsoIcon 3-path SVG with `pulso-wind` animation) remains positioned vertically directly above `.wind-speed-unit` (`m/s`) to the right of `#windSpeed`.
  - `#dynamicBox` sits inside `.wind-card` to the right of `.wind-container` (hidden when `stopped` or `isShipFinished`):
    - `safe`: green solid pill (`#15803D`, white text) displaying `可進港 •`.
    - `waiting`: slate solid pill (`#475569`, white text) displaying `等待進港`.
    - `warning`: red solid 2-line pill (`#B91C1C`, white text) with top line `無法進港 •` and bottom compact sub-line(s) showing `風速超標` (when wind exceeds limit) OR `浪高 X > 2.5 m` / `能見度 Y < 2 浬` (preserving `/APP_SVG/wave.svg` and `/APP_SVG/eye.svg` rendered white via CSS filter).
  - At `375px` viewport width, `#windSpeed`, unit/icon, and `#dynamicBox` (including dual wave+visibility warning) must fit without horizontal overflow (`scrollWidth <= clientWidth`) or text clipping.
  - `#dataTime` displays `最後更新 MM/DD HH:mm` (converting `YYYY/MM/DD 上午/下午 H:mm` cleanly).

- **REQ-004 — POB Record Mutual Exclusion & Styling**
  - `#pobList` spans full card width between `.wind-card` and `.schedule-section`.
  - Maintains exact mutual exclusion logic: for a single monitored ship, once `daily_records/{date}/{card}/pob_info` exists, `#dynamicBox` disappears (`isShipFinished = true`) and `#pobList` appears; when a second ship is monitored on the same day, both `#dynamicBox` (for the active second ship) and `#pobList` (for the finished first ship) can appear simultaneously.
  - Styled as crisp solid-tinted alert card (green `#DCFCE7` / `#166534` for POB entry; red `#FEE2E2` / `#B91C1C` when no-entry reason only).

- **REQ-005 — 船期表 Card & Row Highlighting**
  - Header left shows `船期表` (`h2`), right shows gear button `.cpc-btn.pulso-icon.pulso-settings` (keeping `pulso-spin-180` hover/focus/touch animation and `.locked-btn` pessimistic lock feedback). Clicking gear verifies password via `triggerOpenManualModal()`.
  - Table columns: `日期`, `船名`, `速限 m/s`.
  - Date cell shows `${item.d}` with terminal pill badge underneath (`W12` orange `#D98200` white text; `W13` deep navy `#0D3559` white text).
  - Speed limit cell displays numeric value only (e.g. `12`, `15`, no `m/s` suffix).
  - Active monitored ship row highlights in green (`safe`), red (`warning`), or slate (`waiting`), matching `#dynamicBox`.
  - Remove legacy `#scheduleHeaderRow` `dblclick` and double-tap event triggers completely.

- **REQ-006 — Fixed 4-Tab Bottom Navigation Bar**
  - Fixed bottom bar with 4 equal tabs:
    1. `監控` (`#navMonitorBtn`, active state when on home view)
    2. `預報` (`#navForecastBtn`, opens `#forecastModal`)
    3. `船期` (`#navScheduleBtn`, displays `.locked-btn` when editing lock held by others; calls `triggerOpenScheduleAdjustModal()` requiring password)
    4. `聊天室` (`#chatOpenBtn`, opens `#chatModal`, hosts static red unread indicator `#chatUnreadBadge` containing `!` styled as a compact red circular dot `#dc2626` with `color: #dc2626` and `animation: none`, preserving v2 test compatibility)

- **REQ-007 — Bottom-Sheet Manual Monitoring Drawer (`#manualModal`)**
  - Renders as a bottom-sliding drawer anchored to bottom of viewport (`max-width: 480px`, top rounded corners, drag handle, `×` close button, backdrop dismiss).
  - Start mode (`app_mode !== 'start'`):
    - `#shipName` text input.
    - `#speedSegmentGroup` segmented buttons: `12`, `15` (default active), `自訂`. Clicking `12` or `15` sets `#limitSpeed` value and hides custom input; clicking `自訂` expands `#customLimitSpeedWrap` and clears/focuses `#limitSpeed` numeric input.
    - `#terminalSegmentGroup` segmented buttons: `W12`, `W13` (default active); active button changes background/text color distinctly; syncs `#terminal` input.
    - `#startBtn` submits start command (`開始監控`).
  - Stop mode (`app_mode === 'start'`):
    - Shows active ship summary banner + existing `#pobTime` (`04:00`–`17:59` validation) and `#noEntryReason` / `#customReasonGroup`.
    - `#resetBtn` is solid red (`#DC2626`, overriding/removing legacy `#FF69B4` pink).

- **REQ-008 — Full-Screen Double-Row Card Schedule Editor (`#scheduleAdjustModal`)**
  - Full-screen sheet with top bar (`< 監控`, `船期調整`, `+ 新增`), scrollable card list `#adjustCardList`, and sticky bottom `儲存調整` button.
  - Each `.adjust-card` has 2 rows:
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
- **AC-001**: `<title>` is `臺中LNG船監控(v1.5)`; `.container` / `.card` uses clean `#EEF3F7` / `#FFFFFF` palette without `backdrop-filter`; header contains `logo.png`, `臺中LNG船監控`, `#soundToggle` (hidden when stopped, SVG transitions `muted` -> `armed` -> `ringing` on `safe` -> `muted`), and `#infoLink` -> `presentation/index.html`; old `.presentation-link` block is absent.
- **AC-002**: Wind card title is `北堤風速`, old `風速預報` button inside card is absent, `.wind-icon` sits above `m/s` and keeps PulsoIcon animation, clicking `#windSpeed` opens `#forecastModal`.
- **AC-003**: `#dynamicBox` renders inside `.wind-card` to the right of `.wind-container` with `可進港`, `等待進港`, and 2-line `無法進港` (`風速超標`, `浪高 X > 2.5 m`, `能見度 Y < 2 浬`), with zero horizontal overflow at `375x812`; when a single active ship gets `pob_info`, `#dynamicBox` hides and `#pobList` displays; when a second ship is monitored, both show simultaneously.
- **AC-004**: `船期表` card has `日期 | 船名 | 速限 m/s`, `W12`/`W13` badges under date, numeric-only speed limit, active row highlight (`safe`/`warning`/`waiting`), and gear button (PulsoIcon spin, password-gated bottom-sheet `#manualModal`). Double-clicking/double-tapping `#scheduleHeaderRow` does NOT open `#pwdModal` or `#scheduleAdjustModal`.
- **AC-005**: Fixed 4-tab bottom nav renders `監控`, `預報`, `船期`, `聊天室`; `預報` opens `#forecastModal`; `船期` reflects `.locked-btn` and opens password-gated `#scheduleAdjustModal`; `聊天室` hosts `#chatUnreadBadge` (static `!` styled as solid red dot `#dc2626`) and opens `#chatModal`.
- **AC-006**: `#manualModal` opens anchored at bottom (`bottom === viewportHeight`), start mode has `12`/`15`/`自訂` speed segmented buttons (default `15`, `自訂` reveals `#limitSpeed`) and `W12`/`W13` terminal segmented buttons (default `W13`, active color changes), live background `active_status` wind ticks while `#manualModal` is open do NOT reset user's in-progress segmented selections, and stop mode renders red (`rgb(220, 38, 38)`) `#resetBtn` and preserves POB / no-entry submission.
- **AC-007**: `#scheduleAdjustModal` renders 2-row `.adjust-card` items (Row 1: date + `W12`/`W13` + delete button; Row 2: ship name + `12`/`15` speed limit), keeps blank-date `UNFINISHED_SHIP` on top, accepts `MM/DD` (`06/09` -> `6/9` in diff payload) while rejecting out-of-range dates (`99/99`), trims `ship_name` when diffing and rejects duplicate/empty ship names, and emits `is_deleted: true` before `is_deleted: false` on delete + save.
- **AC-008**: `tests/test_gas_archive.js` passes all existing 29 scenarios plus new `update_schedule` `is_deleted: true` tombstone filtering, deleting the last remaining ship (`schedule_list` becomes empty), Calendar API failure fail-safe retention (does not wipe `schedule_list`), re-add override, expired tombstone cleanup, `UNFINISHED_SHIP` terminal retention, and `06/09` -> `6/9` normalization scenarios.
- **AC-009**: `python deploy/build_hosting.py`, `pytest`, `tests/frontend-echarts.js`, and `tests/frontend-isolated.js` (including all v2 chat room checks) pass with exit code 0 against `public/` served on `127.0.0.1:4177`.
- **AC-010**: Mobile screenshots (`390x844` and `375x812`) across monitor states, manual drawer, schedule adjust cards, and forecast modal pass visual inspection without overlap, clipping, or unintended visual regressions in forecast/chat modals.
