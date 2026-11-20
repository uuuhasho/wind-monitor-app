# Verification Evidence · 002-pwa-ui-redesign-v2

- **Feature**: Unified 4-Tab PWA UI Redesign (`feat/pwa-ui-redesign`) + Acceptance Feedback Delta (`D6`, `D7`)
- **Verified Date**: 2026-11-20 (updated after `D7` circular green-spin add button & odd/even schedule cards)
- **Source Files Verified**: `frontend/index.html` (SHA256 `8C2C2F7F7A570B5259F8C2A7934C43B91001C66E3B975972C5BA0BC2B71106CF`), `public/index.html` (identical SHA256)
- **Isolation Notice**: All frontend browser suites and Python/Node unit tests ran offline with mocked Firebase RTDB / GAS / clock endpoints and synthetic credentials (`pwd=synthetic`), never touching live `/formal` RTDB or deploying to Firebase Hosting / GAS / Cloud Run. Temporary local HTTP server on `127.0.0.1:4177` was stopped (`PORT_4177_CLOSED`) immediately after Playwright verification.

## 1. Command Execution Summary (All Re-run After Final `D7` `frontend/index.html` & `tests/frontend-isolated.js` Edits)

| Check | Command | Scope & Conditions | Outcome | Observed Evidence |
| :--- | :--- | :--- | :--- | :--- |
| Hosting Build | `python deploy/build_hosting.py` | Copies `frontend/` -> `public/` and validates all local assets | Pass (exit `0`) | `Hosting build complete: ...\public`; `0` missing resources; `public/index.html` SHA256 matches `frontend/index.html` |
| GAS Unit Tests | `node --test tests/test_gas_conditions.js tests/test_gas_triggers.js tests/test_gas_archive.js` | Mocked Firebase REST / GAS triggers | Pass (exit `0`) | `tests 3, pass 3, fail 0, skipped 0` (`32 + 8 + 5 = 45` scenarios passed) |
| Python Test Suite | `python -m pytest tests/test_build_hosting.py tests/test_hosting_deploy.py tests/test_backend_safety.py tests/test_pob_handler.py` | Local build, deploy safety, backend safety, POB handler | Pass (exit `0`) | `collected 52 items`, `52 passed in 7.25s`, `0` skipped |
| ECharts Forecast Suite | Playwright MCP `browser_run_code_unsafe` (`tests/frontend-echarts.js`) against `http://127.0.0.1:4177/index.html` | Real `runtime/echarts-5.5.0.min.js`; mocked RTDB/Audio/fetch | Pass (`errors: []`) | `version: "5.5.0"`, `selected: "11/20 ONE"`, `singleSwitchTooltip: "TWO"`, `rapidSwitchTooltip: "TWO"`, `zoomBefore: 0 -> zoomAfter: 38.8099...`, `shortData: {axis:24, series:[24,24]}`, `reopenTooltip: "ONE"` |
| Full PWA Isolated Suite | Playwright MCP `browser_run_code_unsafe` (`tests/frontend-isolated.js`) against `http://127.0.0.1:4177/index.html` | Mocked Firebase/GAS/ECharts/`page.clock`; covers `AC-001`–`AC-007` + `D6` + `D7` | Pass (`errors: []`) | `externalServices: "mocked"`, `chatVerified: true`, `expiredLeaseRecovered: true`, circular `#adjustAddBtn.add-row-btn` (`36x36`, `50%`, `.is-spin-green` `rgb(40, 167, 69)` & rotated), odd/even `.adjust-card` fills (`rgb(255, 255, 255)` / `rgb(235, 239, 244)`) |
| Real-Clock Hover & Schedule Screenshot (`390x844`) | Playwright MCP screenshot & genuine transition probe without fake clock | Mocked RTDB (`11/20 PACIFIC PRIDE` + `11/21 LNG PHUKET`) & GAS auth | Pass | `cardBgs: ["rgb(255, 255, 255)", "rgb(235, 239, 244)"]`, `fitsWithoutScroll: true` (`scrollHeight: 844`), genuine hover `bg: "rgb(40, 167, 69)"`, `transform: "matrix(0, 1.1, -1.1, 0, 0, 0)"`, `radius: "50%"` |

## 2. Acceptance Criteria Mapping (`AC-001` – `AC-010` + `D6` & `D7`)

| Criterion | Verified Scope | Evidence & Result |
| :--- | :--- | :--- |
| **AC-001 / D6-1** | Unified `#0B2948` top bar, ice-blue gradient, 4-tab `.bottom-nav`, crisp `10px` `#EF4444` unread red dot `#chatUnreadBadge` (no `!`, clears only when `#chatRoomScreen` is visible) | Verified by `tests/frontend-isolated.js` and `11-monitor-unread-dot-390.png`. |
| **AC-002 / D6-6** | Centered `.wind-card`, animated `.wind-icon`, non-pointer & non-clickable `#windSpeed`, full-width `#dynamicBox`, `375x812` zero overflow | Verified by `tests/frontend-isolated.js` and `01-monitor-idle-390.png`. |
| **AC-003** | White `POB 紀錄` card (`#pobList`), `.is-no-entry` red rows, mutual exclusion & same-day dual-ship coexistence | Verified by `tests/frontend-isolated.js` (`AC-003`) & `02`/`03` screenshots. |
| **AC-004** | `船期表` header `[船期表 \| 🔔 \| ⚙️]`, `#E2EEFA` header, `W12`/`W13` badges, bottom-sheet `#manualModal` | Verified by `tests/frontend-isolated.js` (`AC-004`) & `08-manual-drawer-390.png`. |
| **AC-005 / D6-2,5** | Embedded `預報` tab via `#navForecastBtn`, dark `#0F1722` chart card + matching dark `.card.forecast-ship-card` (`#0F1722` / `#162234`), isolated stacking trapping ECharts tooltips below `#pwdModal` | Verified by `tests/frontend-isolated.js`, `tests/frontend-echarts.js`, `04-forecast-tab-390.png`, and `10-forecast-pwd-modal-390.png`. |
| **AC-006 / D7-1,2** | Password-gated embedded `船期調整` tab: original circular `#adjustAddBtn.add-row-btn` (`＋`, `36px` `#164E8A`, turns green `#28a745` + `rotate(90deg) scale(1.1)` on hover/touch/slide), alternating `.adjust-card` backgrounds (odd `#FFFFFF` / even `#EBEFF4`), `MM/DD`, `W12`/`W13`, `12`/`15` chevrons, dirty-leave guard, save zero false prompt, auth guard, tombstone `diffList` | Verified by `tests/frontend-isolated.js` (`AC-006` + `D7` assertions), real-clock hover transition probe, and re-captured `05-schedule-tab-390.png`. |
| **AC-007 / D6-4** | Embedded `作業聊天室`: `#chatSpectatorBar` removed, `#chatSpectatorHint` (`僅供瀏覽`) shown left of `#chatRoleSwitchBtn` in spectator mode and hidden when seated; hoisted sheets, desktop margin safety, off-tab seat retention & 15-min idle expiry, white file cards, styled `#chatPreviewCloseBtn`, XSS/upload/zoom/reclaim safety | Verified by `tests/frontend-isolated.js` and screenshots `12-chat-spectator-390.png`, `07-chat-room-390.png`. |
| **AC-008** | Clean `python deploy/build_hosting.py` build with zero missing local resources | Verified (`Hosting build complete`, exit code `0`). |
| **AC-009** | `node --test`, `pytest`, `tests/frontend-isolated.js`, and `tests/frontend-echarts.js` all pass after final `D7` edits | All 4 suites run after final edits (`frontend/index.html` & `tests/frontend-isolated.js`) and passed cleanly. |
| **AC-010 / D6-3, D7** | Mobile-first screenshot inspection (`390x844`, `375x812`) plus `1280x800` | Visual inspection via `read_file` of re-captured `05-schedule-tab-390.png` (showing circular `＋` button & odd white / even `#EBEFF4` cards above `.bottom-nav`) alongside `01`–`04` and `06`–`12`. |
