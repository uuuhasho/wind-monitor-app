# Review request

gate_id: design
review_id: design-r1
revision: 0f74a1134013aa6d088ce7ad0f0da1c62b65449e (updated spec.md, plan.md, tasks.md after design-r0)
isolation_mode: native-fresh
host_instruction_inventory:
  known_files:
    - C:\Users\hilla\Desktop\opencode桌面\奶昔APP\.agents\AGENTS.md
    - Antigravity CLI global user rules
  notes: Neither file instructs agreeing with designs under review. No instruction conflict expected.
prior_findings_addressed:
  - DESIGN-F001: Updated spec.md (REQ-009, AC-008), plan.md (updateFirebaseScheduleList(allowEmptyOnVerifiedApi)), and tasks.md (T004, T005) to specify verified-API empty write (`[]`) on last-ship deletion vs API-outage fail-safe retention.
  - DESIGN-F002: Updated spec.md (AC-006), plan.md, and tasks.md (T009) to specify openManualModal() start/stop branching and startFirebaseListeners() open-modal guard (`lastObservedAppMode` + `#manualModal` closed check).
  - DESIGN-F003: Updated spec.md (REQ-008, AC-007), plan.md, and tasks.md (T010) with `1<=m<=12 && 1<=d<=31` date validation, trimmed `ship_name` matching, symmetric date/terminal normalization during diffing, and tombstone-first (`is_deleted: true` before `false`) ordering.
  - DESIGN-F004: Updated spec.md (REQ-006, AC-005), plan.md, and tasks.md (T008) to preserve `!` inside `#chatUnreadBadge` styled as a compact solid `#dc2626` circular dot (`color: #dc2626`, `animation: none`), compatible with existing `tests/frontend-isolated.js` assertions.
  - DESIGN-F005: Standardized `浪高 X > 2.5 m` / `能見度 Y < 2 浬` across spec.md (REQ-003, AC-003) and plan.md, and added `addEditItem()` scroll update (`#adjustCardList`, default terminal `W13`) to plan.md and tasks.md (T010).
  - DESIGN-F006: Updated spec.md (REQ-009), plan.md, and tasks.md (T004) to normalize `item.d` in `getScheduleList()` Step 1 and `archiveAndClearFirebase()` line 771.
  - DESIGN-F007: Added `tests/test_gas_archive.js` `createHarness()` extension notes (`Utilities.formatDate` `'yyyy/MM/dd'`/`'M/d'`, optional real schedule execution) to plan.md Section 3 and tasks.md (T005).
  - DESIGN-F008: Documented undated `UNFINISHED_SHIP` tombstone next-day expiry behavior in spec.md (REQ-009) and plan.md; retained v1.4 `04:00~17:59` POB validation in plan.md.
review_scope: >
  Re-review of updated design packet (spec.md, plan.md, tasks.md, decisions.md) against codebase files
  (frontend/index.html, gas/monitor.js, tests/frontend-isolated.js, tests/test_gas_archive.js, deploy/build_hosting.py)
  focusing on whether prior DESIGN-F001..DESIGN-F008 findings are resolved and no new blocking design gaps remain.
inputs:
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\001-pwa-ui-redesign\spec.md
    sha256: 711E9D09F8635049508882A7DA806A99699DD7C1779E38FC59D191CC5BD06E98
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\001-pwa-ui-redesign\plan.md
    sha256: A4232946EBB5F2C98ED4C0F25922F8B2F53DD6F36FE14381AE4596BDCEE55B54
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\001-pwa-ui-redesign\tasks.md
    sha256: 35AC8619B653B70855DD69232AA17C81FC85EF3F3C8DBA26AEE269CF04FB6BEA
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\001-pwa-ui-redesign\decisions.md
    sha256: 3D8B77F2C5AB23C1541CFF6563933429C4BF3769A57A260705FCAE2F4B0AB7D0
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\frontend\index.html
    sha256: 929EE89A22B2F054FD08EADCC259F0D04F93C2B613DAD632DD5E47288A3D6247
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\gas\monitor.js
    sha256: 243BA4CCBC73BAFDB814DF8FD73412A29F6C066EA67D8CD8414768F71A737E1D
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\tests\frontend-isolated.js
    sha256: 528D634483618A975A9832513A052BE4500073DF5F0D5C097649575FC10A6044
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\tests\test_gas_archive.js
    sha256: 61C7E4AF9FDE1B2E660DB31186D27B7F28164CA904815F4FDC2AD7719514C8F3
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\deploy\build_hosting.py
    note: Hosting build and local resource validator
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\001-pwa-ui-redesign\review\design\r0\findings.json
    note: Prior round findings
criteria:
  - Verify prior DESIGN-F001..DESIGN-F008 items against updated spec.md, plan.md, tasks.md, and source files
  - Check for any remaining gaps, contradictions, failure modes, or untestable AC items
limitations:
  - specify.exe blocked by Windows Application Control; Spec Kit artifacts authored via compatible manual flow
  - Tests use mocked Firebase/GAS in Playwright and Node vm in tests/test_gas_archive.js; live cloud deployment is intentionally out of scope
output: Read-only structured JSON with fields review_id, gate_id, reviewed_revision, sufficient_inputs, verdict (pass/needs_changes/blocked), and findings[]. Do NOT edit any files.
