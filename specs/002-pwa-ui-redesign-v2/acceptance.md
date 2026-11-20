# Acceptance Guide · 002-pwa-ui-redesign-v2

- **Branch**: `feat/pwa-ui-redesign` (local working tree; **uncommitted, unpushed, undeployed**)
- **Primary Target**: Mobile viewport (`390x844` / `375x812`) with responsive `480px` desktop centering
- **Automated Verification Evidence**: [`evidence/verification.md`](evidence/verification.md)

## 1. User Acceptance Walkthrough (5 Mobile Verification Steps)

> 可於手機版視口檢視本機預覽（或授權部署 Firebase Hosting 後實機測試）依序確認以下 5 項體驗：

1. **監控主頁與未讀小紅點（`監控` 分頁）**
   - 確認頂部深藍導覽列無金邊、風速大字置中搭配動態 `.wind-icon`、`船期表` 維持 `[船期表] | [🔔] | [⚙️]` 且 `W13` 為深藍白字；**點擊大字風速不會跳轉預報頁**，須透過下方固定導覽列「預報」切換。
   - 若當日聊天室有新訊息且尚未進入對話畫面，下方固定導覽列「聊天室」圖示右上角會出現明顯 **10px 紅色圓點**提醒未讀（點入選角頁時仍保留紅點，實際進入對話室後才消除）。

2. **風速預報暗色配色與防重疊密碼驗證（`預報` → `船期`）**
   - 切至 `預報` 分頁，確認下方「選擇船舶」卡片與下拉選單採用與曲線圖協調的深石板配色（`#0F1722` / `#162234` 搭淺藍下拉箭頭）。
   - 於圖表 Tooltip 顯示時直接點擊下方「船期」分頁，確認彈出的 `🔒 安全驗證` 密碼框完整浮於圖表與 Tooltip 之上，不再被遮擋。

3. **船期調整圓形新增鈕與奇偶卡片底色（`船期` 分頁）**
   - 驗密進入 `船期` 分頁後，確認右上角「新增」已改回原版 **深藍圓形 `＋` 圖示**，手指觸碰/滑過會**順時針旋轉 90° 並變成綠色**（`#28a745`）。
   - 確認多張船期卡片呈現 **奇數張純白 `#FFFFFF`／偶數張淺灰 `#EBEFF4`** 交錯區分，搭配 `碼頭` / `速限` 右側下拉箭頭與離開未儲存攔截。

4. **作業聊天室簡潔標題列與觀眾提示（`聊天室` 分頁）**
   - 選「觀眾」入室後，確認訊息串上方無分隔橫線，改於右上角 `觀眾` 膠囊左側顯示「僅供瀏覽」提示；取得發言席位後自動隱藏「僅供瀏覽」。
   - 切至其他分頁時席位仍保留（15 分鐘無操作自動釋放），切回即回到對話畫面。

5. **手動抽屜與照片預覽檢查**
   - 點擊 `船期表` 右上角 `⚙️` 開啟淺色 `#manualModal` 抽屜；點開聊天室照片預覽時確認右上角 `×` 為白色透明關閉鈕。

## 2. Explicit Post-Acceptance Authorization Items

驗收通過前不會執行以下異動操作；請於回覆中明確告知是否授權：
- [ ] **Git 本機提交（`feat/pwa-ui-redesign`）**
- [ ] **推送 GitHub 遠端（`uuuhasho/wind-monitor-app` / `feat/pwa-ui-redesign`；或是否同步合併 `main`）**
- [ ] **Firebase Hosting 部署（`deploy/deploy_hosting.ps1 -Deploy`）**
