# Verification Evidence · 001-pwa-ui-redesign

- **Feature**: `001-pwa-ui-redesign`
- **Branch**: `feat/pwa-ui-redesign` (branched from local `main` at `0f74a1134013aa6d088ce7ad0f0da1c62b65449e`)
- **Last Verified After Final Code Edits**: `frontend/index.html` (`z-index: 900` on `.bottom-nav`, verified by Playwright after edit); `gas/monitor.js` & `tests/test_gas_archive.js` (`DEL-001` `UNFINISHED_SHIP` diff preservation fix, verified by `node --test`, `build_hosting.py`, and `pytest` after edit).
- **Environment Scope**: Local isolated mocks & synthesized credentials only; no live `/formal` RTDB access, no cloud deployment, no GitHub push.

## Acceptance Criteria Verification Matrix

| AC ID | 操作／命令 | 預期 | 實際 | 證據 | 版本 | 結果 |
|---|---|---|---|---|---|---|
| AC-001 | `playwright tests/frontend-isolated.js` | `<title>` 為 `臺中LNG船監控(v1.5)`、移除毛玻璃、`logo.png` + `臺中LNG船監控` + SVG 鈴鐺 (`muted`/`armed`/`ringing`) + `i` 連結 `presentation/index.html` | 全部斷言通過 (`title: 臺中LNG船監控(v1.5)`, `backdropFilter: none`, `bellStates: muted/ringing(rgb(234,140,30))/armed`, `errors: []`) | `tests/frontend-isolated.js`, `screenshots/01-monitor-safe-390.png`, `02-monitor-warning-wind-390.png` | working tree (feat/pwa-ui-redesign) | pass |
| AC-002 | `playwright tests/frontend-isolated.js` | 風速卡標題 `北堤風速`、無卡內 `風速預報` 按鈕、PulsoIcon 風圖示在 `m/s` 上方且具動畫、點 `#windSpeed` 開預報 | 全部斷言通過 (`windTitle: 北堤風速`, `hasWindForecastBtn: false`, `aboveUnit`, `windPaths: 3`, `pulso-slide-right`) | `tests/frontend-isolated.js`, `screenshots/01-monitor-safe-390.png` | working tree (feat/pwa-ui-redesign) | pass |
| AC-003 | `playwright tests/frontend-isolated.js` + `375x812` 視窗截圖 | `#dynamicBox` 位於風速右側並依狀態切換 `可進港` / `等待進港` / 雙行 `無法進港`（`風速超標`、`浪高 X > 2.5 m`、`能見度 Y < 2 浬`）、`375x812` 無水平溢位、POB 單船互斥與同日雙船並存正常 | 11 項條件矩陣、`375x812` `noOverflow375: true` (`overflow375: false`)、單船 POB 互斥與同日雙船並存全部通過 | `tests/frontend-isolated.js`, `screenshots/03-monitor-warning-dual-375.png`, `04-monitor-pob-390.png` | working tree (feat/pwa-ui-redesign) | pass |
| AC-004 | `playwright tests/frontend-isolated.js` | `船期表` 三欄 (`日期`、`船名`、`速限 m/s`)、`W12`/`W13` 膠囊、純數字速限、齒輪保留旋轉與鎖定邏輯、雙擊/雙點 `#scheduleHeaderRow` 不再觸發彈窗 | 全部斷言通過 (`[日期, 船名, 速限 m/s]`, `W12: rgb(217,130,0)`, `W13: rgb(13,53,89)`, `speedCell: 12/15`, 雙擊表頭不觸發) | `tests/frontend-isolated.js`, `screenshots/01-monitor-safe-390.png` | working tree (feat/pwa-ui-redesign) | pass |
| AC-005 | `playwright tests/frontend-isolated.js` | 固定底部 4 鍵導覽列 (`監控`、`預報`、`船期`、`聊天室`)、`預報` 開 `#forecastModal`、`船期` 反映 `.locked-btn` 並經密碼驗證開 `#scheduleAdjustModal`、`聊天室` 靜態紅點 `#chatUnreadBadge` (`!`, `rgb(220,38,38)`) 正常 | 全部斷言通過 (`forecastZ: 1001 > bottomNavZ: 900`, `navLocked: true`, `chatVerified: true`) | `tests/frontend-isolated.js`, `screenshots/01-monitor-safe-390.png`, `08-forecast-modal-390.png` | working tree (feat/pwa-ui-redesign) | pass |
| AC-006 | `playwright tests/frontend-isolated.js` | `#manualModal` 為底部滑出抽屜、啟動模式預設 `15` 與 `W13`、`自訂` 展開 `#limitSpeed`、即時風速推播不覆蓋抽屜內選擇、結束模式 `#resetBtn` 為紅色 `rgb(220, 38, 38)` | 全部斷言通過 (`bottomDiff <= 2`, `defaultSpeed: 15`, `defaultTerm: W13`, open-modal wind-tick guard passed, `resetBg: rgb(220, 38, 38)`) | `tests/frontend-isolated.js`, `screenshots/05-manual-drawer-start-390.png`, `06-manual-drawer-stop-390.png` | working tree (feat/pwa-ui-redesign) | pass |
| AC-007 | `playwright tests/frontend-isolated.js` | `#scheduleAdjustModal` 雙行卡片清單、置頂空白日期 `UNFINISHED_SHIP`、支援 `0609 -> 06/09` 與 `99/99` 攔截、保留非 12/15 速限、刪除確認後送出 `is_deleted: true` 先於 `is_deleted: false` 並正規化 `06/10 -> 6/10` | 全部斷言通過 (`count: 4`, `firstHasUnfinishedTag: true`, `customSpeedPreserved: 13.8`, `savedDiff` 含 `is_deleted: true` 與正規化日期) | `tests/frontend-isolated.js`, `screenshots/07-schedule-adjust-390.png` | working tree (feat/pwa-ui-redesign) | pass |
| AC-008 | `node --test tests/test_gas_conditions.js tests/test_gas_triggers.js tests/test_gas_archive.js` | 既有用例與新增 `is_deleted` tombstone 隱藏、全刪最後一筆寫入 `[]`、API 失敗保護保留、重加恢復、`06/09 <-> 6/9` 正規化、過期 tombstone 清理、`UNFINISHED_SHIP.terminal` 保留、以及調整他船時保留未異動 `UNFINISHED_SHIP` 全部通過 | 3 suites passed (`test_gas_archive`: 32 scenarios passed including DEL-001 regression, `test_gas_conditions`: 8 scenarios passed, `test_gas_triggers`: 5 scenarios passed; exit 0) | `tests/test_gas_archive.js`, `gas/monitor.js` | working tree (feat/pwa-ui-redesign) | pass |
| AC-009 | `python deploy/build_hosting.py` & `python -m pytest` & `playwright tests/frontend-echarts.js` | Hosting 建置無缺漏資源、Python 測試全部通過、ECharts 5.5.0 回歸測試無修改通過 | `Hosting build complete`; `pytest`: 52 passed (6.22s, exit 0); `frontend-echarts.js`: `errors: []`, `version: 5.5.0` | `deploy/build_hosting.py`, `tests/frontend-echarts.js` | working tree (feat/pwa-ui-redesign) | pass |
| AC-010 | Playwright 手機截圖目視檢查 (`390x844` / `375x812` 共 8 張) | 無文字重疊、無裁切或溢位、天氣預報與聊天室內部樣式未破壞 | 8 張截圖目視檢查通過 (`overflow375: false`; 已修正 `.bottom-nav` z-index 至 `900` 讓 `#forecastModal` 完整遮罩導覽列並重跑全套測試驗證) | `specs/001-pwa-ui-redesign/evidence/screenshots/01~08.png` | working tree (feat/pwa-ui-redesign) | pass |

## Raw Command Outputs (Post Final Edit)

1. **`python deploy/build_hosting.py`**
   - Output: `Hosting build complete: C:\Users\hilla\Desktop\opencode桌面\奶昔APP\public` (exit 0, post DEL-001)
2. **`node --test tests/test_gas_conditions.js tests/test_gas_triggers.js tests/test_gas_archive.js`**
   - Output: `GAS archive and operations: 32 scenarios passed`, `GAS conditions: 8 scenarios passed`, `GAS trigger setup/pause: 5 scenarios passed`, `ℹ tests 3 / pass 3 / fail 0` (exit 0, post DEL-001)
3. **`python -m pytest tests/test_build_hosting.py tests/test_hosting_deploy.py tests/test_backend_safety.py tests/test_pob_handler.py`**
   - Output: `52 passed in 6.62s` (exit 0, post DEL-001)
4. **`playwright-google` -> `tests/frontend-isolated.js`** (against `public/` served on `http://127.0.0.1:4177/`)
   - Output: `{"externalServices":"mocked","initial":{"title":"臺中LNG船監控(v1.5)","wind":"4","schedule":true,"hasLegacyPresLink":false,"windTitle":"北堤風速","hasWindForecastBtn":false,"scheduleTitle":"船期表","infoHref":"presentation/index.html","soundDisplay":"none","backdropFilter":"none"},"forecast":{"drawn":true,"status":"11/19 10:00 數據已更新"},"operations":{"monitor":true,"pob":true},...,"chatVerified":true,"expiredLeaseRecovered":true,"errors":[]}`
5. **`playwright-google` -> `tests/frontend-echarts.js`** (against `public/` served on `http://127.0.0.1:4177/`)
   - Output: `{"errors":[],"version":"5.5.0","selected":"11/19 ONE","singleSwitchTooltip":"TWO","rapidSwitchTooltip":"TWO",...,"shortData":{"axis":24,"series":[24,24]},"reopenTooltip":"ONE"}`
6. **Visual Screenshot Inspection (`390x844` & `375x812`)**
   - `specs/001-pwa-ui-redesign/evidence/screenshots/01-monitor-safe-390.png` .. `08-forecast-modal-390.png` inspected directly; `overflow375: false`, `forecastZ: 1001 > bottomNavZ: 900`.
