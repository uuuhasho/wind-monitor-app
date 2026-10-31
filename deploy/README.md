# 部署工具

`build_hosting.py` 只重建 `public/`；所有來源都在 `frontend/`。它先驗證每個本機 HTML 與 manifest 資源，完成後才替換既有輸出。

`deploy_hosting.ps1` 預設只建置。需要雲端權限與人工審閱時才使用 `-Deploy`。

`deploy_cloud_run.py` 會在固定 ASCII 父目錄 `C:\Users\hilla\Desktop\newlngship_clean` 下建立唯一的 `backend-stage-*` 子目錄。成功暫存會保留供檢查；失敗時只清除本次建立且通過路徑檢查的子目錄。加上 `--deploy` 才會呼叫 Cloud Run。部署會以 `codex-preflight` tag 建立 revision，並使用 `--no-traffic` 保持現有 revision 的流量設定不變。

部署後先透過 `codex-preflight` tag 檢查新 revision。只有檢查通過後，才另外執行下列命令，把流量切到該 revision（將 `REVISION_NAME` 換成部署產生的 revision 名稱）：

```powershell
gcloud run services update-traffic forecast-api-test --project=newlngship --region=asia-southeast1 --to-revisions=REVISION_NAME=100
```

若需回復，將流量切回原本的 `forecast-api-test-00057-4tc`：

```powershell
gcloud run services update-traffic forecast-api-test --project=newlngship --region=asia-southeast1 --to-revisions=forecast-api-test-00057-4tc=100
```
