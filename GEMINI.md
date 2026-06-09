# Antigravity CLI - Project Preferences

## Google Apps Script (GAS) 部署與版控規則
* **避免上傳至 GitHub**：專案內的 `gs_*.js` 檔案絕對**不可以**被上傳或推送到 GitHub 儲存庫，必須維持在 `.gitignore` 名單中。
* **直接透過 Clasp 部署**：此專案的 GAS 網址為 [1on-oG64WYR5K3F9hal8cg1yO5yUhDlaiyUGpl2Vk_hcCvs7eiEz6FQUf](https://script.google.com/home/projects/1on-oG64WYR5K3F9hal8cg1yO5yUhDlaiyUGpl2Vk_hcCvs7eiEz6FQUf/edit)。
* **自動更新流程**：未來若有修改 `gs_*.js` 檔案，必須自動使用 `clasp` 工具進行部署。流程為：建立隱藏目錄（如 `.gas`），執行 `clasp clone 1on-oG64WYR5K3F9hal8cg1yO5yUhDlaiyUGpl2Vk_hcCvs7eiEz6FQUf`，將修改好的 `.js` 覆蓋過去後，依序執行 `clasp push` 與 `clasp deploy` 進行雲端代碼更新與版本發布。

## 其他注意事項
* 除非使用者主動提出變更，否則請嚴格遵守上述 GAS 版控與自動部署原則。
