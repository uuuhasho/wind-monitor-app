# Antigravity CLI - Project Preferences

## Google Apps Script (GAS) 部署與版控規則
* **避免上傳至 GitHub**：專案內的 `gs_*.js` 檔案絕對**不可以**被上傳或推送到 GitHub 儲存庫，必須維持在 `.gitignore` 名單中。
* **直接透過 Clasp 部署**：此專案的 GAS 網址為 [1on-oG64WYR5K3F9hal8cg1yO5yUhDlaiyUGpl2Vk_hcCvs7eiEz6FQUf](https://script.google.com/home/projects/1on-oG64WYR5K3F9hal8cg1yO5yUhDlaiyUGpl2Vk_hcCvs7eiEz6FQUf/edit)。
* **GAS 部署檔案內容**：GAS 雲端專案上部署的 `index.html` 必須與 GitHub 專案中的 [index.html](file:///C:/Users/hilla/Desktop/奶昔code/index.html) 保持完全一致。
* **自動更新流程**：未來若有修改 `gs_*.js` 檔案或 `index.html` 檔案，必須自動使用 `clasp` 工具進行部署。流程為：在 `.gas` 目錄中放置與專案根目錄相同的 `index.html` 以及對應的 `gs_*.js`，確認內容無誤後，依序執行 `clasp push` 與 `clasp deploy` 進行雲端代碼更新與版本發布。

## 其他注意事項
* 除非使用者主動提出變更，否則請嚴格遵守上述 GAS 版控與自動部署原則。

