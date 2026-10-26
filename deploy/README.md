# 部署工具

`build_hosting.py` 只重建 `public/`；所有來源都在 `frontend/`。它先驗證每個本機 HTML 與 manifest 資源，完成後才替換既有輸出。

`deploy_hosting.ps1` 預設只建置。需要雲端權限與人工審閱時才使用 `-Deploy`。

`deploy_cloud_run.py` 會在固定 ASCII 父目錄 `C:\Users\hilla\Desktop\newlngship_clean` 下建立唯一的 `backend-stage-*` 子目錄。成功暫存會保留供檢查；失敗時只清除本次建立且通過路徑檢查的子目錄。加上 `--deploy` 才會呼叫 Cloud Run。
