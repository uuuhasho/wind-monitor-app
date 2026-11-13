# 部署工具

`build_hosting.py` 只重建 `public/`；所有來源都在 `frontend/`。它先驗證每個本機 HTML 與 manifest 資源，完成後才替換既有輸出。

`deploy_hosting.ps1` 預設只建置。需要雲端權限與人工審閱時才使用 `-Deploy`。

`deploy_cloud_run.py` 會在固定 ASCII 父目錄 `C:\Users\hilla\Desktop\newlngship_clean` 下建立唯一的 `backend-stage-*` 子目錄。成功暫存會保留供檢查；失敗時只清除本次建立且通過路徑檢查的子目錄。加上 `--deploy` 才會呼叫 Cloud Run。部署會以 `codex-preflight` tag 建立 revision，並使用 `--no-traffic` 保持現有 revision 的流量設定不變；新版同時設定 `/formal` 及 `MAINTENANCE_MODE=true`，解除維護須另經授權。Tag 網址仍可直接存取，舊 revision 與在途工作不受新版開關保護。

取得解除維護的部署授權後，`--deploy --resume` 建立 `MAINTENANCE_MODE=false` 的無流量 revision，且不設定公開預檢 tag；核對 revision 設定後才經授權切換流量。正式網址的 HTTP 驗證必須在流量切換後進行。若既有 tag 未解除，仍可能指向之前的維護版。

預設維護版部署後，透過 `codex-preflight` tag 檢查新 revision；`--resume` 版不新增 tag，先核對指定 revision 設定。流量切換需另行授權，命令範例見本文末；不可把仍指向維護版的 tag 當成解除維護版的驗證網址。

2026-11-08 已完成 `/test` → `/formal` 授權切換，APP v1.2 已發布，兩端維護已解除，四個 GAS 觸發器與 Scheduler 已恢復；2026-11-12 實船 POB 與夜間歸檔驗收通過後，2026-11-13 已完成驗收後臨時測試清理、Artifact Registry 降載（低於 500 MB 硬上限）以及 RTDB `/test` 節點授權刪除（切換前快照保留於 `backups/rtdb-test-before-formal-20261108-164715.json`）。`/formal` 已有新業務資料，不可重新套用遷移指令或覆寫舊快照。最新驗收結案與交接見 [2026-11-13 驗收結案與清理報告](../plan/2026-11-13/2026-11-13-formal-acceptance-cleanup-report.html) 與 [2026-11-08 切換報告](../plan/2026-11-08/2026-11-08-formal-cutover-report.html)；實際部署前仍須讀回線上狀態。所有雲端變更須事先取得授權。

`deploy/migrate_formal.py` 固定目標為 `newlngship` 的 `/test` 與 `/formal`，保留供歷史流程追溯，不是日常部署步驟。預設只讀取並檢查；目標已存在時會拒絕，這是目前正式環境的預期保護，不是需要刪除目標才能修復的錯誤。`FIREBASE_RTDB_SECRET` 必須由環境安全提供，不放在命令列。工具只備份 `/test` 資料；Rules、現行版本及設定需另外備份。

正式複製須先取得使用者明確授權，並確認所有寫入來源已停止、在途工作已完成。檢查 `/formal` 不存在後，才可使用 `--apply --writers-stopped --confirm-project newlngship --backup <絕對檔案路徑>`。備份路徑必須位於專案根目錄 `backups/` 或專案外的既有目錄，且檔案不可已存在。`backups/` 已排除一般 Git 及部署；禁止強制加入 Git。備份是未加密 JSON；Windows 會繼承目錄 ACL，操作前須由人員確認目錄權限及保管方式，不得存入 Git 或公開位置。

工具在寫入前建立及讀回備份，並對來源與目標使用 ETag；資料寫入後逐節點比較並再次檢查來源。這些檢查不能取代停寫。錯誤、超時、ETag 衝突或來源改變時停止，不自動重試、刪除或回復；保留備份並在停寫狀態下對帳。若 `/formal` 已有新業務資料，必須先備份兩邊及對帳增量，禁止直接覆寫舊資料。備份不包含 Rules、試算表與其他服務狀態，不能單獨視為完整回復方案。

回復順序：先停住所有寫入並確認在途工作結束，再讀回 `/test`、`/formal` 與備份核對。尚未恢復正式寫入時，可在授權後切回切換前版本、設定和 Rules。恢復寫入後，先額外備份兩邊，對帳風速、POB、歸檔收據及試算表，再由使用者核准確切回復方案；不可只切回舊版或自動將備份覆寫回資料庫。

### 本次切換的維護開關

已發布的版本提供 GAS Script Property 及 Cloud Run 環境變數 `MAINTENANCE_MODE`；維護時兩者需分別設為 `true`，其他非空且非 `false` 的值也會阻擋。缺少屬性或值為 `false` 表示不啟用。GAS 在初始化及 RTDB 存取前停止；Cloud Run 的 `/webhook` 與 `/update_forecast` 回應 503，`/health` 維持可用。2026-11-08 已驗證維護阻擋並解除，未來維護仍須重新核對兩端狀態。

舊 GAS Web App deployment、舊 Cloud Run revision 和不經過這些入口的其他寫入者不受新開關保護。正式切換前須逐一確認及停用或隔離所有舊入口，通知所有使用者不要操作，並停用排程；維護開關不會取消已開始的工作。等待 GAS 執行、預報及 LINE 背景作業確實結束，不能只根據鎖過期判定安全。只在能證明全面停寫時複製資料。

GAS Web App v83 的維護錯誤頁已實測回傳 HTTP 200 並含 `System maintenance`；前端使用 `no-cors` 的操作仍可能顯示成功。維護期間不得依靠畫面或 HTTP 狀態推斷資料已寫入。LINE Webhook 503 也不保證重送；未來維護前重新確認船期，若出現臨時訊息須人工記錄及對帳，不得自行模擬 POB。

Cloud Run 環境變數變更會產生新 revision；確認流量、tag 和在途工作後才可切換。GAS HEAD 與現有 Web App deployment 須分別核對。兩端都部署新開關、舊入口完成隔離且在途工作結束後，才進行備份與遷移；兩端資料、Rules 和版本一致並完成唯讀驗證後，才經授權解除維護並恢復排程。失敗時保留停寫狀態並依回復順序處理。

```powershell
gcloud run services update-traffic forecast-api-test --project=newlngship --region=asia-southeast1 --to-revisions=REVISION_NAME=100
```

若需回復，先重新查核並使用本次切換前記錄的 revision；不可依賴歷史 revision 名稱：

```powershell
gcloud run services update-traffic forecast-api-test --project=newlngship --region=asia-southeast1 --to-revisions=PREVIOUS_REVISION=100
```
