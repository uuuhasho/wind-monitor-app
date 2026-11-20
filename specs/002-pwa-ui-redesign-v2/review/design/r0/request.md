# Review request

gate_id: design
review_id: design-r0
revision: 413047d4fd8b61561b0ade08928a3b25cb237294 (feat/pwa-ui-redesign; untracked .codegraph/, plan/2026-11-07/, plan/2026-11-08/2026-11-08-formal-rtdb-migration-plan.html, plan/2026-11-14/2026-11-14-每日空軍預測排程與重複更新解析.html, specs/002-pwa-ui-redesign-v2/)
isolation_mode: native-fresh
host_instruction_inventory:
  known_files:
    - C:\Users\hilla\Desktop\opencode桌面\奶昔APP\.agents\AGENTS.md
    - Antigravity CLI global user rules
  notes: Neither file instructs agreeing with designs under review. No instruction conflict expected.
review_scope: >
  Pre-implementation design review of 002-pwa-ui-redesign-v2 covering unified 4-tab PWA UI shell
  redesign in frontend/index.html (Monitor, Forecast, Schedule Adjust, Ship Chat Room), Hosting build
  compatibility, and isolated test/verification coverage (tests/frontend-isolated.js, tests/frontend-echarts.js).
  Backend/GAS/RTDB rules are explicitly out of scope and unchanged.
inputs:
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\spec.md
    sha256: E7E121B4399BE4ECB446B57E0ACED3B538FE331624BF795E38DFE4F8B7BD71E4
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\plan.md
    sha256: A488E43C30371A4CFDC839D411423C0685D6A2E14EB8A3A091D9EFC559A94BF9
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\tasks.md
    sha256: 1DA4E410F70A2481271F678FECA60F952E0F6D28B5525247E836034246008FFB
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\decisions.md
    sha256: ECE1FD2ED259E0385B55C95FA75ED70CBD7958D48E2011A13CC168BDAFC4CD73
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\frontend\index.html
    sha256: 5EFB8AF69D5CD7CFE8BAC9963FB7A7E4C89DB53E2DE48DEF6FC524EB4D6014E9
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\tests\frontend-isolated.js
    sha256: CA0CD5082ABA1750964AB952C51ED5FEB47339CECFEA668B590D518B4AC9BD9C
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\tests\frontend-echarts.js
    sha256: 3E4E7D8D24C42FC76B559D43522395DCFEBCB30096FEFD26C345BE73821924A3
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\deploy\build_hosting.py
    sha256: 036CB2D17FB0102181330B13E39D6FA00A7F86C2C3C865A2B561F956ADE3D6B7
  - path: C:\Users\hilla\Desktop\2026-11-20 APP示意圖\監控介面.png
    note: User desktop mockup 1 (Monitor)
  - path: C:\Users\hilla\Desktop\2026-11-20 APP示意圖\風速預報介面.png
    note: User desktop mockup 2 (Forecast)
  - path: C:\Users\hilla\Desktop\2026-11-20 APP示意圖\船期調整頁.png
    note: User desktop mockup 3 (Schedule Adjust)
  - path: C:\Users\hilla\Desktop\2026-11-20 APP示意圖\聊天室.png
    note: User desktop mockup 4 (Ship Chat Room)
criteria:
  - Completeness and internal consistency across decisions.md (D1-D5), spec.md (REQ-001..REQ-008, AC-001..AC-010), plan.md, and tasks.md
  - Compatibility with existing codebase contracts:
    - tests/frontend-echarts.js (unchanged test assertions: openForecastModal(), loadForecastData(), #shipForecastSelect, #forecastChart dataZoom drag at chart.height - 8, 05:00/06:00 tooltip labels, closeForecastModal())
    - GAS update_schedule / set_mode / editing_lock / verify_password API payloads and POB 04:00~17:59 validation
    - v2 chat room security (XSS escaping, MIME/extension blocks, image compression, cancel upload, mobile picker reclaim) and seat locking
    - deploy/build_hosting.py local asset checks (no missing local files)
  - Edge cases and failure modes:
    - Tab switching router (switchMainTab) interacting with dirty schedule adjustments, pessimistic editing_lock, cachedSessionPassword, and beforeunload
    - Password verification failure in background while already switched or switching tabs
    - Off-tab chat seat persistence (D2): background 15-min idle expiration while on another tab, in-flight claim race during tab switch, remote takeover while on another tab, midnight date rollover while off-tab, #chatBackToRolesBtn vs #chatRoleSwitchBtn selector consistency, backdrop click on desktop #chatModal margin not closing tab
    - #chatNameSheetBackdrop and #chatAttachSheetBackdrop z-index overlaying fixed .app-header-bar and .bottom-nav
    - 375x812 viewport horizontal overflow / clipping when both wave and visibility warnings are active inside full-width #dynamicBox
    - CSS icon tinting for /APP_SVG/wave.svg and /APP_SVG/eye.svg inside light red #FEE2E2 warning bar
  - Testability of every AC-001..AC-010 in isolated Playwright environment without live Firebase/GAS access
limitations:
  - specify.exe blocked by Windows Application Control; Spec Kit artifacts authored via compatible manual flow
  - Tests use mocked Firebase/GAS in Playwright; live cloud deployment is intentionally out of scope
output: Read-only structured JSON with fields review_id, gate_id, reviewed_revision, sufficient_inputs, verdict (pass/needs_changes/blocked), and findings[]. Do NOT edit any files.
