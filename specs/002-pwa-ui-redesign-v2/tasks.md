# Tasks · 002-pwa-ui-redesign-v2

## Phase 1 — Preflight, Spec & Design Gate
- [x] **T001** (Setup): Run read-only preflight (`git rev-parse HEAD`, `git status -sb`, `node -v`, `python --version`) and verify clean baseline on `feat/pwa-ui-redesign`.
- [x] **T002** (Spec Kit): Create `specs/002-pwa-ui-redesign-v2/` (`preflight.md`, `decisions.md`, `spec.md`, `plan.md`, `tasks.md`, `workflow/state.json`, `workflow/handoff.md`) capturing D1–D5 and `REQ-001`–`REQ-008` / `AC-001`–`AC-010`.
- [x] **T003** (Design Gate): Compute SHA256 manifest, write `review/design/r0/request.md`, and pass fresh read-only Goldfish Design Gate (`blocking = 0`, `verdict = "pass"`, max 2 repair rounds). (Passed at `design-r1`, `blocking = 0`, 1 minor `DES-R1-001` aligned to `#EBF3FC`).

## Phase 2 — Unified 4-Tab PWA Implementation (`frontend/index.html`)
- [x] **T004** (REQ-001): Implement unified fixed top `#0B2948` header bar (no gold border, `logo.png` + `|` + `臺中 LNG 船監控`, `操作說明` link), ice-blue canvas gradient, and fixed 4-tab `.bottom-nav` (`.bottom-nav-inner` height `66px`) with `#D9ECFF`/`#1877F2` active capsules across all 4 tabs and static red `!` `#chatUnreadBadge`.
- [x] **T005** (REQ-002, REQ-003, REQ-004): Implement centered `.wind-card` (large `#windSpeed`, animated PulsoIcon `.wind-icon`, `#dataTime` `更新時間 ...`, full-width horizontal `#dynamicBox` bar with wrap-safe ship name & `#B91C1C`-tinted `/APP_SVG/wave.svg` + `/APP_SVG/eye.svg` filter, 375px zero-overflow), white `POB 紀錄` card (`#pobList`) with mutual exclusion, `船期表` card (`[船期表] | [#soundToggle] | [.cpc-btn]`, `#E2EEFA` header, `W12` orange / `W13` `#0B2948`), and restyled `#manualModal` bottom sheet.
- [x] **T006** (REQ-005): Convert `#forecastModal` to embedded tab view (yellow `#forecastUpdateBtn`, `#0F1722` chart card with top legend, `m/s` Y-axis, 2-line X-axis formatter, bright-blue slider, bottom `#forecastStatus`, white `選擇船舶` card below) preserving `tests/frontend-echarts.js` & lease/offset logic.
- [x] **T007** (REQ-006): Convert `#scheduleAdjustModal` to embedded tab view (`＋ 新增`, live card title, `MM/DD` input + calendar icon ornament, live `W12`/`W13` pill-decorated terminal select, `12`/`15`/custom speed select, `儲存變更` + `取消`) with `switchMainTab` dirty-leave confirmation, `{ skipGuard: true }` on save/no-op, ownership-guarded `verifyPasswordInBackground`, and lock cleanup.
- [x] **T008** (REQ-007): Convert `#chatModal` to embedded tab view between header & bottom nav (`#chatRoleScreen` light cards, `#chatRoomScreen` with `#chatRoleSwitchBtn` label pill, `.chat-date-divider` `M月D日` pill, white/`#C2E1FF` bubbles, standalone white file download card `EXT · SIZE`, pinned composer without extra bottom-safe padding), hoist `#chatNameSheetBackdrop`/`#chatAttachSheetBackdrop` as `<body>` children (`z-index: 2060`, `.chat-bottom-sheet` `max-width: 480px`), remove desktop `#chatModal` margin click-close handler, add opt-in `options.releaseSeat` in `closeChatModal()`, and enforce off-tab seat retention, background 15-min idle expiry, `renewChatSeatActiveAt()` on resume, and `chatNavSeq` in-flight claim guard.

## Phase 3 — Build, Automated Verification & Delivery Gate
- [x] **T009** (REQ-008, AC-008): Rebuild `public/` via `python deploy/build_hosting.py` and verify zero missing resources.
- [x] **T010** (REQ-008, AC-001–AC-009): Update `tests/frontend-isolated.js` and run `node --test`, `pytest`, Playwright `frontend-isolated.js`, and Playwright `frontend-echarts.js`.
- [x] **T011** (AC-010): Capture and visually inspect mobile (`390x844`, `375x812`) and desktop (`1280x800`) screenshots under `specs/002-pwa-ui-redesign-v2/evidence/screenshots/`.
- [x] **T012** (Delivery Gate): Populate `evidence/verification.md`, write `review/delivery/r0/request.md`, and pass fresh read-only Goldfish Delivery Gate (`blocking = 0`, `verdict = "pass"`, max 2 repair rounds).

## Phase 4 — Acceptance Pack & Delivery Report
- [x] **T013** (Acceptance): Write `acceptance.md` (3–5 concrete user steps), update `workflow/state.json` (`phase = "acceptance"`, `status = "awaiting_acceptance"`) & `workflow/handoff.md`, and generate Light-theme Blueprint HTML report under `plan/2026-11-20/2026-11-20-PWA四分頁整合改版報告.html` without committing/deploying/pushing before user approval.

## Phase 5 — Acceptance Feedback Delta (D6: Items 1–6 & `#pwdModal`/Tooltip Z-Index Fix)
- [x] **T014** (D6 Items 1, 2, 4, 5, 6): Update `frontend/index.html` for clean `#EF4444` unread dot (`isChatRoomVisible()` lifecycle), dark `.forecast-ship-card` & `#shipForecastSelect`, removal of `#chatSpectatorBar` + inline `#chatSpectatorHint` left of `#chatRoleSwitchBtn`, isolated stacking context on `.forecast-chart-card`/`.chart-wrapper`, and removal of clickable `#windSpeed` forecast trigger.
- [x] **T015** (D6 Bug Doc & Verification): Author `docs/2026-11-20/2026-11-20-風速預報切船期密碼框與圖表重疊原因分析.md`, update `tests/frontend-isolated.js`, rebuild `public/`, re-run `node --test`, `pytest`, Playwright `frontend-echarts.js`, Playwright `frontend-isolated.js`, and inspect mobile `390x844` / `375x812` screenshots (with ECharts tooltip + `#pwdModal` overlap check).
- [x] **T016** (Delivery Gate r2 & Integrated Report): Pass fresh `delivery-r2` Goldfish Gate (`blocking = 0`, `verdict = "pass"`), update `acceptance.md` / `state.json` (`awaiting_acceptance`) / `handoff.md`, and integrate delta into `plan/2026-11-20/2026-11-20-PWA四分頁整合改版報告.html`.

## Phase 6 — Schedule Adjust Refinements (D7)
- [x] **T017** (D7 Circular Green-Spin Add & Odd/Even Cards): Restore circular `#adjustAddBtn.add-row-btn` (`＋`, green `#28a745` + `rotate(90deg)` on hover/touch/slide via `bindPulsoIconTriggers`), alternate `.adjust-card` odd (`#FFFFFF`) / even (`#EBEFF4`) backgrounds, rebuild `public/`, re-run all test suites & `05-schedule-tab-390.png` visual verification, and update same-day HTML report.
