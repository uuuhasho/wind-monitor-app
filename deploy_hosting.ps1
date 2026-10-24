# 🚢 Firebase Hosting 一鍵部署指令檔 (測試版)
# 確保在 "測試版" 目錄下執行

# 1. 建立或清空 public 目錄
if (!(Test-Path -Path "public")) {
    New-Item -ItemType Directory -Path "public" | Out-Null
} else {
    Remove-Item -Path "public\*" -Recurse -Force -ErrorAction SilentlyContinue
}

# 2. 複製前端靜態資源至 public 目錄
Copy-Item -Path "index_test.html" -Destination "public\index.html" -Force
Copy-Item -Path "logo.png" -Destination "public\logo.png" -Force
Copy-Item -Path "pwa.png" -Destination "public\pwa.png" -Force
Copy-Item -Path "pwa.png" -Destination "public\pwa-192x192.png" -Force
Copy-Item -Path "manifest.json" -Destination "public\manifest.json" -Force
Copy-Item -Path "fast-forward.png" -Destination "public\fast-forward.png" -Force
Copy-Item -Path "notification_option_C.mp3" -Destination "public\notification_option_C.mp3" -Force
Copy-Item -Path "presentation" -Destination "public\presentation" -Recurse -Force

Write-Host "[*] 前端靜態資源複製完成，準備部署到 Firebase Hosting..." -ForegroundColor Cyan

# 3. 執行 Firebase 部署
firebase deploy --only hosting
