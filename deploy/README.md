# 部署工具

`build_hosting.py` 只重建 `public/`；所有來源都在 `frontend/`。它先驗證每個本機 HTML 與 manifest 資源，完成後才替換既有輸出。

`deploy_hosting.ps1` 預設只建置。需要雲端權限與人工審閱時才使用 `-Deploy`。

`deploy_cloud_run.py` 會在固定 ASCII 父目錄 `C:\Users\hilla\Desktop\newlngship_clean` 下建立唯一的 `backend-stage-*` 子目錄。成功暫存會保留供檢查；失敗時只清除本次建立且通過路徑檢查的子目錄。加上 `--deploy` 才會呼叫 Cloud Run。部署會以 `codex-preflight` tag 建立 revision，並使用 `--no-traffic` 保持現有 revision 的流量設定不變。

部署後先透過 `codex-preflight` tag 檢查新 revision。只有檢查通過後，才另外執行下列命令，把流量切到該 revision（將 `REVISION_NAME` 換成部署產生的 revision 名稱）：

本機來源預定使用 `/formal`；正式遷移前線上仍使用 `/test`。GAS 的 `FIREBASE_URL` 必須先於恢復觸發器前明確設為 `/formal`，並核對 HEAD 與既有 Web App deployment；所有雲端變更須事先取得授權。

`python -B tests/run_formal_emulator.py` 使用 `demo-formal-rtdb`、本機 19090 埠及合成資料執行 Rules、複製和 ETag 測試；需 Firebase CLI 與 JDK。測試使用臨時規則，不會發布或代表已檢查正式 Rules。可用 `JAVA_HOME` 指定 JDK，未指定時使用專案內的 portable JDK。

`tests/migration_rehearsal.py` 僅供隔離演練，不是正式遷移工具。複製前必須確保所有寫入者已停止：讀取來源 ETag 後再次比對仍無法防止最後檢查與寫入之間發生更新。寫入逾時時須停止、讀回兩邊並對帳，不可自動覆蓋或刪除。

`deploy/migrate_formal.py` 固定目標為 `newlngship` 的 `/test` 與 `/formal`。預設只讀取並檢查；`FIREBASE_RTDB_SECRET` 必須由環境安全提供，不放在命令列。執行 `python -B deploy/migrate_formal.py` 不會寫入資料庫。部署前應另行備份 Rules、現行版本及設定，本工具只備份 `/test` 資料。

正式複製須先取得使用者明確授權，並確認所有寫入來源已停止、在途工作已完成。檢查 `/formal` 不存在後，才可使用 `--apply --writers-stopped --confirm-project newlngship --backup <絕對檔案路徑>`。備份路徑必須位於專案外的既有目錄，且檔案不可已存在。備份是未加密 JSON；Windows 會繼承目錄 ACL，操作前須由人員確認目錄權限及保管方式，不得存入 Git 或公開位置。

工具在寫入前建立及讀回備份，並對來源與目標使用 ETag；資料寫入後逐節點比較並再次檢查來源。這些檢查不能取代停寫。錯誤、超時、ETag 衝突或來源改變時停止，不自動重試、刪除或回復；保留備份並在停寫狀態下對帳。若 `/formal` 已有新業務資料，必須先備份兩邊及對帳增量，禁止直接覆寫舊資料。備份不包含 Rules、試算表與其他服務狀態，不能單獨視為完整回復方案。

回復順序：先停住所有寫入並確認在途工作結束，再讀回 `/test`、`/formal` 與備份核對。尚未恢復正式寫入時，可在授權後切回切換前版本、設定和 Rules。恢復寫入後，先額外備份兩邊，對帳風速、POB、歸檔收據及試算表，再由使用者核准確切回復方案；不可只切回舊版或自動將備份覆寫回資料庫。

```powershell
gcloud run services update-traffic forecast-api-test --project=newlngship --region=asia-southeast1 --to-revisions=REVISION_NAME=100
```

若需回復，先重新查核並使用本次切換前記錄的 revision；不可依賴歷史 revision 名稱：

```powershell
gcloud run services update-traffic forecast-api-test --project=newlngship --region=asia-southeast1 --to-revisions=PREVIOUS_REVISION=100
```
