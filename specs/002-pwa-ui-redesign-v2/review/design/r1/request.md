# Review request

gate_id: design
review_id: design-r1
revision: 413047d4fd8b61561b0ade08928a3b25cb237294 (feat/pwa-ui-redesign; untracked .codegraph/, plan/2026-11-07/, plan/2026-11-08/2026-11-08-formal-rtdb-migration-plan.html, plan/2026-11-14/2026-11-14-每日空軍預測排程與重複更新解析.html, specs/002-pwa-ui-redesign-v2/)
isolation_mode: native-fresh
host_instruction_inventory:
  known_files:
    - C:\Users\hilla\Desktop\opencode桌面\奶昔APP\.agents\AGENTS.md
    - Antigravity CLI global user rules
  notes: Neither file instructs agreeing with designs under review. No instruction conflict expected.
previous_findings_addressed:
  - DES-001: Hoisted #chatNameSheetBackdrop and #chatAttachSheetBackdrop out of #chatModal to become direct children of <body> (`position: fixed; inset: 0; z-index: 2060;`) with `.chat-bottom-sheet { width: 100%; max-width: 480px; margin: 0 auto; box-sizing: border-box; }` in spec.md, plan.md, and tasks.md.
  - DES-002: Updated plan.md, spec.md, and tasks.md so saveScheduleAdjustments() passes `{ skipGuard: true }`, verifyPasswordInBackground() checks active session/tab ownership before closing with `{ skipGuard: true }`, hasUnsavedScheduleChanges() mirrors saveScheduleAdjustments() normalization, and date/ship inputs sync on `oninput`.
  - DES-003: Updated plan.md, spec.md, and tasks.md to remove the desktop margin `#chatModal` click-close listener in initShipChat() and make seat release in closeChatModal() strictly opt-in via `options.releaseSeat`.
  - DES-004: Updated plan.md, spec.md, and tasks.md with calibrated `#B91C1C` CSS filter for `.condition-warning img`, full-width `#dynamicBox` rules (`width: 100%; max-width: 100%; min-width: 0;`), and wrapping rules for ship names and warning sub-lines at `375x812`.
  - DES-005: Updated plan.md, spec.md, and tasks.md with `#chatRoleSwitchBtn` label population (`mySeat ? (mySeat.roleLabel || mySeat.roleId) : '觀眾'`), `.bottom-nav-inner { height: var(--bottom-nav-h); }` (`66px`), removal of redundant bottom safe-area padding on `#chatComposerFooter`, `.chat-date-divider` (`M月D日`), and `.chat-bubble.is-file-only` standalone white file card (`EXT · SIZE`).
  - DES-006: Updated plan.md, spec.md, and tasks.md with `chatNavSeq !== navToken` guards in selectChatRole() (`Other` rename branch and post-claim checks), `renewChatSeatActiveAt()` on chat resume in openChatModal(), and idempotent `tab === currentActiveTab` check in switchMainTab().
review_scope: >
  Re-review of updated 002-pwa-ui-redesign-v2 design artifacts (spec.md, plan.md, tasks.md) following
  resolution of design-r0 findings DES-001..DES-006.
inputs:
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\spec.md
    sha256: C82DBC2B97B72FAC9D7CC343B392D5139DB641E5AA06399685067C10CA991C68
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\plan.md
    sha256: 491D9236F69F90B92ED4E831CE6FBE5F52B9A8146C81556851C283FCA975C7EE
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\tasks.md
    sha256: EEAFF4219F00F178B744EAAE20AA283FCEBCD4E21201431AD36B52404C47C300
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
  - Verify DES-001 through DES-006 are completely resolved across spec.md, plan.md, and tasks.md without introducing new contradictions or gaps.
  - Verify full compatibility with frontend/index.html contracts, tests/frontend-echarts.js, and deploy/build_hosting.py.
limitations:
  - specify.exe blocked by Windows Application Control; Spec Kit artifacts authored via compatible manual flow
  - Tests use mocked Firebase/GAS in Playwright; live cloud deployment is intentionally out of scope
output: Read-only structured JSON with fields review_id, gate_id, reviewed_revision, sufficient_inputs, verdict (pass/needs_changes/blocked), and findings[]. Do NOT edit any files.
