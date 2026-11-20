# Review request

gate_id: delivery
review_id: delivery-r2
revision: 413047d4fd8b61561b0ade08928a3b25cb237294 (feat/pwa-ui-redesign; working-tree modified frontend/index.html, tests/frontend-isolated.js; rebuilt public/; untracked .codegraph/, docs/2026-11-20/, plan/2026-11-07/, plan/2026-11-08/2026-11-08-formal-rtdb-migration-plan.html, plan/2026-11-14/2026-11-14-每日空軍預測排程與重複更新解析.html, plan/2026-11-20/, specs/002-pwa-ui-redesign-v2/)
isolation_mode: native-fresh
host_instruction_inventory:
  known_files:
    - C:\Users\hilla\Desktop\opencode桌面\奶昔APP\.agents\AGENTS.md
    - Antigravity CLI global user rules
  notes: Neither file instructs agreeing with deliverables under review. No instruction conflict expected.
delta_changes_addressed:
  - D6-Item1: Updated `#chatUnreadBadge` to crisp circular 10px `#EF4444` red dot with cutout border and `isChatRoomVisible()` lifecycle (`#chatUnreadBadge` remains until entering `#chatRoomScreen`).
  - D6-Item2: Restyled `.card.forecast-ship-card` (`#0F1722`) and `#shipForecastSelect` (`#162234`, `#F8FAFC`, `#93C5FD` chevron SVG, `color-scheme: dark`) to match `.forecast-chart-card`.
  - D6-Item4: Removed `#chatSpectatorBar` divider; added inline `.chat-room-header-right` + `#chatSpectatorHint` (`僅供瀏覽`) left of `#chatRoleSwitchBtn` when in spectator mode, hidden when seated.
  - D6-Item5: Fixed `#pwdModal` vs ECharts `.custom-tooltip` z-index overlap (`C:\Users\hilla\Desktop\003.png`) by adding `position: relative; z-index: 1; isolation: isolate;` to `.forecast-chart-card` and `.chart-wrapper`; documented root cause & diff in `docs/2026-11-20/2026-11-20-風速預報切船期密碼框與圖表重疊原因分析.md`.
  - D6-Item6: Removed click-to-forecast handler and pointer cursor/hover affordances from Monitor `#windSpeed` and `.wind-container` (forecast navigation strictly via `#navForecastBtn`) while preserving PulsoIcon `.wind-icon`.
review_scope: >
  Delivery gate review (r2) for 002-pwa-ui-redesign-v2 plus D6 acceptance-feedback delta (Items 1-6,
  mobile focus, ECharts tooltip / #pwdModal stacking isolation, bug resolution doc, updated tests,
  rebuilt public/index.html, and re-captured mobile screenshots).
inputs:
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\spec.md
    sha256: 0C4BE3DD602C6DFC90EC896C2FFA9FD2E30A5B23CC0CFBE56A07242AF456626F
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\decisions.md
    sha256: D3E85C693D0152DDA0A09A241137F68BFCA32B566506874AFD2819D36723C766
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\plan.md
    sha256: 44FD16FFB7B0F7139A5DC5526FE5CAE7EA37AC06EC2539F975A47B12ABD54685
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\tasks.md
    sha256: BF77B7E05C82C8E6C015A1B3DAEDE5333DB8B3B7B62C85A330FDBDC80E27BA41
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\verification.md
    sha256: 771C0C8FBBF95A583CB305358D6807A347E38192B52E920811DF8346DFC84F34
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\docs\2026-11-20\2026-11-20-風速預報切船期密碼框與圖表重疊原因分析.md
    sha256: 582D89B46B4DECE07575EC830C341C533A6385D08E7D792178D380C7F848F186
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\frontend\index.html
    sha256: AA1538142CCC7A6B706152ADACC9DAD58D3BFD1E59FEC61A6071E07E7107E54E
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\public\index.html
    sha256: AA1538142CCC7A6B706152ADACC9DAD58D3BFD1E59FEC61A6071E07E7107E54E
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\tests\frontend-isolated.js
    sha256: 446DECF02907C58438C599F0B583FC7CF16582285B86CA98D9356A7CAAB606E8
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\tests\frontend-echarts.js
    sha256: 3E4E7D8D24C42FC76B559D43522395DCFEBCB30096FEFD26C345BE73821924A3
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\deploy\build_hosting.py
    sha256: 036CB2D17FB0102181330B13E39D6FA00A7F86C2C3C865A2B561F956ADE3D6B7
  - path: C:\Users\hilla\Desktop\003.png
    note: User-reported bug screenshot showing ECharts tooltip overlapping #pwdModal before fix
  - path: C:\Users\hilla\Desktop\2026-11-20 APP示意圖\監控介面.png
    note: User desktop mockup 1 (Monitor)
  - path: C:\Users\hilla\Desktop\2026-11-20 APP示意圖\風速預報介面.png
    note: User desktop mockup 2 (Forecast)
  - path: C:\Users\hilla\Desktop\2026-11-20 APP示意圖\船期調整頁.png
    note: User desktop mockup 3 (Schedule Adjust)
  - path: C:\Users\hilla\Desktop\2026-11-20 APP示意圖\聊天室.png
    note: User desktop mockup 4 (Ship Chat Room)
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\01-monitor-idle-390.png
    note: Re-captured 390x844 Monitor idle view (non-clickable #windSpeed)
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\02-monitor-safe-pob-390.png
    note: 390x844 Monitor safe entry banner & POB card
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\03-monitor-warning-dual-375.png
    note: 375x812 Monitor multi-reason warning & dual-ship POB
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\04-forecast-tab-390.png
    note: Re-captured 390x844 Embedded Forecast tab (dark chart + harmonized dark ship card)
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\05-schedule-tab-390.png
    note: 390x844 Embedded Schedule Adjust tab
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\06-chat-roles-390.png
    note: 390x844 Chat Role Selection screen
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\07-chat-room-390.png
    note: Re-captured 390x844 Active seated Chat Room screen (#chatSpectatorHint hidden)
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\08-manual-drawer-390.png
    note: 390x844 Manual Control bottom sheet
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\09-desktop-1280.png
    note: 1280x800 Desktop centered shell
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\10-forecast-pwd-modal-390.png
    note: 390x844 Real ECharts 5.5.0 tooltip active behind #pwdModal (zero overlap verified)
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\11-monitor-unread-dot-390.png
    note: 390x844 Crisp 10px #EF4444 unread red dot on bottom nav 聊天室
  - path: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\specs\002-pwa-ui-redesign-v2\evidence\screenshots\12-chat-spectator-390.png
    note: 390x844 Spectator chat room without divider bar, showing 「僅供瀏覽」 left of 「觀眾」 pill
criteria:
  - Verify D6 Items 1-6 cleanly satisfy user feedback without regressions across frontend/index.html, public/index.html, tests/frontend-isolated.js, tests/frontend-echarts.js, and mobile screenshots (390x844).
  - Verify bug fix for #pwdModal vs ECharts .custom-tooltip stacking overlap (`C:\Users\hilla\Desktop\003.png`) and mandatory bug resolution doc in `docs/2026-11-20/`.
  - Verify non-goal boundaries (`gas/monitor.js`, `backend/`, `frontend/presentation/index.html`, Firebase Rules) remain untouched and no regressions exist across REQ-001..REQ-008 / D1..D6.
limitations:
  - specify.exe blocked by Windows Application Control; Spec Kit artifacts authored via compatible manual flow.
  - All automated browser/unit suites use mocked Firebase RTDB / GAS / clock endpoints and synthetic credentials; live `/formal` RTDB and cloud deployment remain untouched pending user acceptance.
output: Read-only structured JSON with fields review_id, gate_id, reviewed_revision, sufficient_inputs, instruction_conflict, verdict (pass/needs_changes/blocked), and findings[]. Do NOT edit any files.
