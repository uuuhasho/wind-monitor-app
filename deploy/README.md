# 部署工具

`build_hosting.py` 只重建 `public/`；所有來源都在 `frontend/`。它先驗證每個本機 HTML 與 manifest 資源，完成後才替換既有輸出。

`deploy_hosting.ps1` 預設只建置。需要雲端權限與人工審閱時才使用 `-Deploy`。

`deploy_cloud_run.py` 將 `backend/` 複製到英文路徑 `C:\Users\hilla\Desktop\newlngship_clean`。預設只暫存；`--deploy` 才會呼叫 Cloud Run。映像清理是人工維護工作，未由部署腳本自動執行，避免刪除回復版本。
