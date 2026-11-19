# Tasks · 001-pwa-ui-redesign

## Phase 1 — Setup & Design Gate
- [x] **T001** (D5): Fast-forward local `main` to `feat/ship-chat-room` and branch `feat/pwa-ui-redesign`.
- [x] **T002** (Workflow): Create `specs/001-pwa-ui-redesign/` (`preflight.md`, `decisions.md`, `spec.md`, `plan.md`, `tasks.md`, `state.json`, `handoff.md`).
- [x] **T003** (Gate): Prepare `review/design/r0/request.md` and pass fresh read-only Goldfish design review (`egm-implementation-readiness`, `blocking = 0`). (Passed at `design-r1`, `findings = []`).

## Phase 2 — GAS Backend & Unit Tests (`REQ-009`, `AC-008`)
- [x] **T004** (REQ-009): Add `normalizeScheduleDateMD()`, implement `is_deleted` tombstone write/filter/expiry cleanup, `UNFINISHED_SHIP` terminal retention, and `updateFirebaseScheduleList(allowEmptyOnVerifiedApi)` strict vs fail-safe behavior in `gas/monitor.js` (including Step 1 API date normalization & `archiveAndClearFirebase` line 771).
- [x] **T005** (AC-008): Extend `createHarness()` (`Utilities.formatDate` `'yyyy/MM/dd'`/`'M/d'` + optional real schedule calls) and add GAS unit tests for schedule deletion, last-ship deletion (`[]`), Calendar API failure fail-safe retention, re-add, date normalization, and tombstone cleanup in `tests/test_gas_archive.js`, verifying `node --test` passes.

## Phase 3 — PWA Frontend Redesign (`REQ-001`–`REQ-008`)
- [x] **T006** (REQ-001, REQ-002): Update `<title>` (`v1.5`), clean light visual CSS, `.app-shell`, `.app-header` (`logo.png`, `臺中LNG船監控`, SVG `#soundToggle`, `#infoLink`).
- [x] **T007** (REQ-003, REQ-004): Implement `北堤風速` card with PulsoIcon wind SVG above `m/s`, right-aligned `#dynamicBox` pill (`可進港` / `等待進港` / 2-line `無法進港` with wave/eye icons, 375px overflow-safe), and `#pobList` mutual exclusion card.
- [x] **T008** (REQ-005, REQ-006): Implement `船期表` card (gear SVG opening password-gated manual drawer, 3 columns `日期` + badge / `船名` / numeric `速限 m/s`, no header double-click) and fixed 4-tab `.bottom-nav` (`監控` / `預報` / `船期` / `聊天室` with `#chatUnreadBadge` static `!` styled as red dot and lock sync).
- [x] **T009** (REQ-007): Convert `#manualModal` to bottom-sheet drawer with `12`/`15`/`自訂` speed segmented buttons, `W12`/`W13` terminal segmented buttons, open-modal live `active_status` reset guard, and red `#DC2626` `#resetBtn`.
- [x] **T010** (REQ-008): Convert `#scheduleAdjustModal` to full-screen double-row card editor with `addEditItem()`/`#adjustCardList` scroll update, `1–12/1–31` date validation, `MM/DD` & terminal symmetric normalization, trimmed `ship_name` matching, `12`/`15` (plus custom speed fallback) dropdowns, delete confirmation & tombstone-first `is_deleted: true` diffing, and XSS escaping.

## Phase 4 — Build, Verification & Delivery Gate (`REQ-010`, `AC-001`–`AC-010`)
- [x] **T011** (AC-009): Run `python deploy/build_hosting.py` and `pytest`.
- [x] **T012** (AC-001–AC-007, AC-010): Update `tests/frontend-isolated.js`, run `frontend-isolated.js` & `frontend-echarts.js` via Playwright against `public/`, and capture & inspect `390x844` / `375x812` screenshots.
- [x] **T013** (Gate): Write `evidence/verification.md` & `acceptance.md`, prepare `review/delivery/r0/request.md`, and pass fresh read-only Goldfish delivery review (`egm-codebase-details`, `blocking = 0`). (Resolved `DEL-001`, passed at `delivery-r1`, `findings = []`).
- [x] **T014** (Handoff): Commit local changes on `feat/pwa-ui-redesign`, generate Light-theme Blueprint HTML report under `plan/2026-11-19/`, set status `awaiting_acceptance`, and request user acceptance + deployment/push authorization.

## Phase 5 — Round-2 Refinement (Scheme A Maritime Blue-Gray-Gold + 6 UI/UX Fixes)
- [x] **T015** (D6): Document Scheme A palette decision + 6 refinements in `decisions.md`, `spec.md`, `plan.md`, and `tasks.md`.
- [x] **T016** (REQ-001–REQ-006): Apply Scheme A (`#0B2948` navy bar + `#EAB308` gold trim, `#E9EEF4` canvas, `#DCE5F0` table header, `#FEF3C7`/`#F59E0B` active nav pill) in `frontend/index.html`, center idle `.wind-card`, add tinted `#scheduleHeaderRow th`, move `#soundToggle` back to `.schedule-header` center, and add amber active capsule styling on `.bottom-nav`.
- [x] **T017** (REQ-007, REQ-008): Restrict `#manualModal` speed selector to `12` | `15` (removing `m/s` and `自訂` option/wrap while keeping hidden `#limitSpeed`), update `#scheduleAdjustModal` to arrow-only `#adjustBackBtn`, circular `.add-row-btn` with green hover spin, and uniform 480px inner column alignment across topbar/cards/footer.
- [x] **T018** (AC-001–AC-007, AC-009, AC-010): Update `tests/frontend-isolated.js`, rebuild `public/` via `deploy/build_hosting.py`, run GAS/pytest/Playwright suites, and capture & inspect updated mobile + desktop screenshots (`00`–`09`).
- [x] **T019** (Gate & Report): Run fresh read-only `egm-codebase-details` delivery review (`r2`), consolidate Round-2 updates into `plan/2026-11-19/2026-11-19-PWA畫面風格與操作改版報告.html`, and commit locally on `feat/pwa-ui-redesign`.
