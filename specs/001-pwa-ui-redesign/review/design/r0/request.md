# Review request

gate_id: design
review_id: design-r0
revision: 0f74a1134013aa6d088ce7ad0f0da1c62b65449e (clean tracked tree; untracked .codegraph/, plan/2026-11-07/, plan/2026-11-08/, plan/2026-11-14/, specs/001-pwa-ui-redesign/)
isolation_mode: native-fresh
host_instruction_inventory:
  known_files:
    - C:\Users\hilla\Desktop\opencode桌面\奶昔APP\.agents\AGENTS.md
    - Antigravity CLI global user rules
  notes: Neither file instructs agreeing with designs under review. No instruction conflict expected.
review_scope: >
  Pre-implementation design review of 001-pwa-ui-redesign covering PWA UI redesign (frontend/index.html),
  schedule deletion & date normalization in GAS (gas/monitor.js), Hosting build compatibility,
  and isolated test/verification coverage (tests/frontend-isolated.js, tests/test_gas_archive.js).
inputs:
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\001-pwa-ui-redesign\spec.md
    sha256: D58EB40D21960A7E5DE0531EE9052334E7C3494BCFC1B501C0F03CE02B4B1EEE
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\001-pwa-ui-redesign\plan.md
    sha256: 8A2F404D9BB3C9C2BC5D9AD910E6B8F52765B182DEF9B81EA2AD0549F60EAD82
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\001-pwa-ui-redesign\tasks.md
    sha256: 55EE153B753954BC7E05317DDF35D727E6CF7FBE3A24D828E4B3BBFC7C5EED3
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
  - path: C:\Users\hilla\Desktop\20261119-PWA畫面修改\PWA修改討論.md
    note: User original discussion notes (source reference)
criteria:
  - Completeness and internal consistency across decisions.md, spec.md (REQ-001..REQ-010, AC-001..AC-010), plan.md, and tasks.md
  - Compatibility with existing codebase contracts (#forecastModal, #chatModal v2, PulsoIcon animations, GAS update_schedule/getScheduleList/set_mode/checkDailySchedule/tryHandoffToNextShip/archiveAndClearFirebase, build_hosting.py)
  - Edge cases and failure modes:
    - Deleting calendar-sourced ships vs manual-added ships vs UNFINISHED_SHIP
    - Re-adding a deleted ship
    - Schedule fail-safe when updateFirebaseScheduleList gets empty list
    - Date normalization (MM/DD vs M/D) in frontend diffing, GAS getScheduleList, today-POB matching, and expiry cleanup
    - Custom speed limit preservation in schedule editor
    - Pessimistic editing lock (#navScheduleBtn + .cpc-btn) and double-click removal
    - 375px viewport horizontal overflow / clipping when both wave and visibility warnings are active
    - XSS escaping in dynamic card editor inputs
    - LNG ship night navigation restriction (04:00~17:59 POB)
  - Testability of every AC-001..AC-010 in offline/isolated environment without live Firebase/GAS access
limitations:
  - specify.exe blocked by Windows Application Control; Spec Kit artifacts authored via compatible manual flow
  - Tests use mocked Firebase/GAS in Playwright and Node vm in tests/test_gas_archive.js; live cloud deployment is intentionally out of scope
output: Read-only structured JSON with fields review_id, gate_id, reviewed_revision, sufficient_inputs, verdict (pass/needs_changes/blocked), and findings[]. Do NOT edit any files.
