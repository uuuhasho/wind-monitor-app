// =========================================================================
// 🚢 臺中 LNG 船監控系統(奶昔) - By Bill Tsai - NV4.7.5
// 更新日期：2026/06/07
// 更新內容：
// 1. 23:00 歸檔 JSON 日誌還原為人類易讀格式 {"08:10": 5.2} 並按時間排序，且 app 船期表剃除已 POB 的船。
// 2. POB 風速: 找出 POB 前10分鐘內的 wind_logs的那筆紀錄。
// 3. 新增手動輸入 POB 時間結束監控。
// 4. POB 30分鐘前判斷是否可進港 + 手動模式密碼驗證
// 5. 04:00 以日曆船期優先監控，即使昨日有預約船，仍會被取消
// 6.修改風力開始判斷時間點，夏季4:30, 冬季5:00
// *7.新增Github指令碼屬性
// =========================================================================



const props = PropertiesService.getScriptProperties();

// --- 基礎屬性讀取 ---
const SPREADSHEET_ID = getProp('SPREADSHEET_ID', ''); 
const TARGET_URL = getProp('TARGET_URL', '');         
const STATION_NAME = getProp('STATION_NAME', '北堤綠燈塔');
const SHIP_SCHEDULE_API_URL = getProp('SHIP_SCHEDULE_API_URL', '');
const SHIP_TYPE_MAPPING = getJsonProp('SHIP_TYPE_MAPPING', {}); 
const SEASONS_CONFIG = getJsonProp('SEASONS_CONFIG', {
  "summer_months": [4, 5, 6, 7, 8, 9], 
  "summer_forecast_time": "05:00", 
  "winter_forecast_time": "05:30"
});

// --- Firebase 屬性讀取 ---
const FB_URL = getProp('FIREBASE_URL', ''); 
const FB_SECRET = getProp('FIREBASE_SECRET', '');

// --- 輔助函式區 ---
function getProp(key, defaultVal) { return props.getProperty(key) || defaultVal; }
function getJsonProp(key, defaultVal) {
  const val = props.getProperty(key);
  return val ? safeJsonParse(val, defaultVal) : defaultVal;
}
function sanitizeKey(str) { return str.replace(/[\.\s\#\$\[\]\/]/g, "_"); }
// 新增：安全解析 JSON，避免程式 Crash
function safeJsonParse(str, fallback = {}) {
  try { return JSON.parse(str) || fallback; } catch (e) { return fallback; }
}
// 新增：統一的台灣時間產生器
function getTwDateStr(date = new Date(), format = "yyyy-MM-dd") {
  return Utilities.formatDate(date, "GMT+8", format);
}
function getTodaySeasonTime() {
  const m = new Date().getMonth() + 1; 
  return (SEASONS_CONFIG.summer_months.includes(m)) ? SEASONS_CONFIG.summer_forecast_time : SEASONS_CONFIG.winter_forecast_time;
}

// ==========================================
// 1. Firebase 核心通訊模組 (加入錯誤回報與防護機制) 
// ==========================================
function callFirebase(path, data, method = "patch") {
  const baseUrl = FB_URL.endsWith('/') ? FB_URL : `${FB_URL}/`;
  const url = `${baseUrl}${path}.json?auth=${FB_SECRET}`;
  const options = {
    method: method,
    contentType: "application/json",
    payload: data ? JSON.stringify(data) : null,
    muteHttpExceptions: true // 保持 true，避免非 2xx 狀態碼引發程式中斷
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    
    // 攔截並紀錄非 2xx (成功) 的異常狀態碼
    if (statusCode < 200 || statusCode >= 300) {
      const errorText = response.getContentText();
      console.error(`❌ Firebase API 錯誤 [${method.toUpperCase()}] /${path}`);
      console.error(`👉 狀態碼: ${statusCode}, 回傳訊息: ${errorText}`);
      if (data) console.error(`👉 傳送的 Payload: ${options.payload}`);
    }
    
    return response; // 必須原封不動回傳，確保其他函式呼叫 .getContentText() 正常
    
  } catch (e) {
    // 捕捉更底層的網路斷線或 DNS 解析失敗 (這種情況連 HTTP 狀態碼都沒有)
    console.error(`🚨 Firebase 底層連線嚴重異常 [${method.toUpperCase()}] /${path}: ${e.message}`);
    
    // 回傳一個安全的 Mock 物件，防止下游邏輯因為找不到 .getContentText() 而引發二次 Crash
    return {
      getContentText: () => "{}",
      getResponseCode: () => 500
    };
  }
}

// ==========================================
// 2. 💬 LINE Bot Webhook 接收端 (零延遲核心)
// ==========================================
function doPost(e) {
  try {
    const eventData = safeJsonParse(e.postData.contents);
    const events = eventData.events || [];
    
    for (let event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;

        // 瞬間解析：若是 POB 訊息，直接觸發 Firebase 直連引擎
        const match = userMessage.match(/台中廠:\s*(.*?)\s*已於.*?(\d{2}[:：]\d{2})\s*POB/i);
        if (match) {
          const shipName = match[1].replace(/LNG船/g, "").trim();
          const pobTime = match[2].replace("：", ":").trim();
          processPobDirect(shipName, pobTime);
        }
      }
    }
  } catch (err) { 
    console.error(`LINE Webhook 處理失敗: ${err}`); 
  }
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

// ==========================================
// 3. ⚡ Firebase POB 時光機與直連推播引擎 (正式版)
// ==========================================
function processPobDirect(shipName, pobTime) {
  const dateStr = getTwDateStr();
  try {
    const statusRes = callFirebase("active_status", null, "get").getContentText();
    const status = safeJsonParse(statusRes);
    const targetKey = status.target_key || `${dateStr}_${sanitizeKey(shipName)}`;
    
    // 取得真實的 Firebase 風速紀錄
    const logsRes = callFirebase(`daily_records/${dateStr}/${targetKey}/wind_logs`, null, "get").getContentText();
    const logs = safeJsonParse(logsRes);
    
    let historySpeed = "未知";
    let bestDiff = 9999; // 儲存最小的時間差，用來尋找「最接近」的一筆
    
    if (logs && Object.keys(logs).length > 0) {
      const [pobH, pobM] = pobTime.split(':').map(Number);
      const pobMins = pobH * 60 + pobM;
      
      for (const timeKey in logs) {
        // 💡 使用 Regex 抓取 上午/下午，以及 HH:mm
        const timeMatch = timeKey.match(/(上午|下午)?.*?(\d{1,2}):(\d{2})/);
        if (!timeMatch) continue; 
        
        let ampm = timeMatch[1];
        let rowH = Number(timeMatch[2]);
        let rowM = Number(timeMatch[3]);

        // 💡 處理 12 小時制轉 24 小時制 (確保下午的 POB 也能對應)
        if (ampm === "下午" && rowH < 12) {
          rowH += 12; 
        } else if (ampm === "上午" && rowH === 12) {
          rowH = 0;   
        }
        
        const rowMins = rowH * 60 + rowM;
        let diff = pobMins - rowMins;
        
        // 💡 跨夜處理
        if (diff < -720) diff += 1440; 
        else if (diff > 720) diff -= 1440;
        
        // 尋找 POB 前 10 分鐘內，最接近 POB 的時間 (diff >= 0 代表記錄在 POB 之前)
        if (diff >= 0 && diff <= 10) { 
          if (diff < bestDiff) {
            bestDiff = diff;
            historySpeed = logs[timeKey];
          }
        }
      }
    }

    const formattedMsg = `${shipName}已於 ${pobTime} POB，風速:${historySpeed}m/s。`;
    
    // 瞬間寫入 Firebase 看板 (第一筆連線)
    callFirebase(`daily_records/${dateStr}/${targetKey}/pob_info`, {
      "pob_time": pobTime, "pob_wind_speed": historySpeed, "formatted_msg": formattedMsg
    }, "patch");
    
// 💡 新增：強制暫停 1000 毫秒，等待底層 TCP 連線釋放與資源回收
    Utilities.sleep(1000);

    // 停止監控，App 切換 (第二筆連線)
    callFirebase("active_status", { "app_mode": "stop" }, "patch");
    console.log(`✅ POB 直連推播成功: ${formattedMsg}`);
    
    // 🌟 更新 Firebase 上的船期表
    updateFirebaseScheduleList();
  } catch (e) { 
    console.error(`❌ POB 直連推播失敗: ${e}`); 
  }
}


// ==========================================
// 4. 🌅 04:00 自動排程：建立今日卡片
// ==========================================
function startMonitoring(shipName, limitSpeed, isAutoRun = "true") {
  const now = new Date();
  const dateStr = getTwDateStr(now);
  const cardKey = `${dateStr}_${sanitizeKey(shipName)}`;
  const seasonTime = getTodaySeasonTime();
  
  callFirebase(`daily_records/${dateStr}/${cardKey}`, {
    "config": { 
      "ship_name": shipName, 
      "limit_speed": limitSpeed, 
      "season_time": seasonTime, 
      "create_at": now.getTime() 
    }
  }, "put");
  
  callFirebase("active_status", {
    "target_key": cardKey, 
    "app_mode": "start", 
    "ship_name": shipName, 
    "limit_speed": limitSpeed, 
    "is_auto_run": isAutoRun,
    "season_time": seasonTime
  }, "patch");
  
  props.deleteProperty('LAST_WIND_DATA_TIME');
  
  // 🌟 更新 Firebase 上的船期表
  updateFirebaseScheduleList();
}

function checkDailySchedule() {
  props.deleteProperty('ARCHIVED_SHIPS_TODAY');
  const now = new Date();
  const dateStr = getTwDateStr(now);

  const todayM_D = `${now.getMonth() + 1}/${now.getDate()}`;
  let hasApiShipToday = false;
  let apiShipName = "";
  let apiLimitSpeed = 15.0;
  
  // 1. 優先檢查 API 船期
  if (SHIP_SCHEDULE_API_URL) {
    try {
      const apiData = safeJsonParse(UrlFetchApp.fetch(SHIP_SCHEDULE_API_URL).getContentText());
      if (apiData.data) {
        const todayShip = apiData.data.find(item => item.d === todayM_D);
        if (todayShip) {
          const nameMatch = todayShip.n.match(/^(.*?)\((.*?)\)/);
          apiShipName = nameMatch ? nameMatch[1].trim() : todayShip.n.trim();
          apiLimitSpeed = SHIP_TYPE_MAPPING[nameMatch ? nameMatch[2].trim() : ""] || 15.0; 
          hasApiShipToday = true;
        }
      }
    } catch (e) { console.error(`04:00 排程失敗: ${e}`); }
  }

  // 2. 根據 API 檢查結果決定後續動作
  if (hasApiShipToday) {
    // 狀況 2: 發現今天有其他船 (臨時插隊)，新船優先
    startMonitoring(apiShipName, apiLimitSpeed, "true");
    if (props.getProperty('RESERVED_MISSION')) props.deleteProperty('RESERVED_MISSION');
  } else {
    // 狀況 1: 今天無船，檢查是否有預約任務
    const reserved = props.getProperty('RESERVED_MISSION');
    if (reserved) {
      const mission = safeJsonParse(reserved, null);
      if (mission) {
        startMonitoring(mission.ship_name, mission.limit_speed, "true");
        props.deleteProperty('RESERVED_MISSION');
      }
    }
  }
  
  // 🌟 新增：確保每天清晨排程執行後，即使沒船也更新 Firebase 船期表（剔除昨日船隻）
  updateFirebaseScheduleList();
}

// ==========================================
// 5. ⏱️ 核心監控：每分鐘抓取風速與智慧採樣
// ==========================================
function executeMonitor() {
  const now = new Date();
  const dateStr = getTwDateStr(now);
  const data = fetchWindData();
  if (!data.valid) return;

  // 優化：先取得狀態，再決定後續更新，減少重複讀取
  const activeStatusRes = callFirebase("active_status", null, "get").getContentText();
  const activeStatus = safeJsonParse(activeStatusRes);
  
  // 準備要更新的狀態物件
  const statusUpdate = { 
    "current_wind": data.speed, 
    "last_update": data.time, 
    "last_check_time": getTwDateStr(now, "HH:mm:ss")
  };

  const targetKey = activeStatus.target_key || (activeStatus.ship_name ? `${dateStr}_${sanitizeKey(activeStatus.ship_name)}` : null);

  // 判斷是否需要停止 (超過 17:30 且為自動運行)
  const currentHm = parseInt(getTwDateStr(now, "HHmm"), 10);
  if (activeStatus.app_mode === "start" && currentHm >= 1730 && activeStatus.is_auto_run === "true") {
    statusUpdate.app_mode = "stop";
    callFirebase("active_status", statusUpdate, "patch");
    return;
  }

  // 更新主要狀態
  callFirebase("active_status", statusUpdate, "patch");

  // 若為啟動狀態且有指定目標，則記錄風速
  if (activeStatus.app_mode === "start" && targetKey) {
    const lastSavedTime = props.getProperty('LAST_WIND_DATA_TIME');
    if (data.time !== lastSavedTime || !lastSavedTime) {
      const logPath = `daily_records/${dateStr}/${targetKey}/wind_logs`;
      const newLog = { [sanitizeKey(data.time)]: data.speed };
      
      if (callFirebase(logPath, newLog, "patch").getResponseCode() === 200) {
        props.setProperty('LAST_WIND_DATA_TIME', data.time);
      }
    }
  }
}

// ==========================================
// 6. 🌙 深夜 23:00 自動歸檔與大掃除
// ==========================================
function archiveAndClearFirebase() {
  const dateStr = getTwDateStr();
  try {
    const todayDataRes = callFirebase(`daily_records/${dateStr}`, null, "get").getContentText();
    const todayData = safeJsonParse(todayDataRes, null);
    
    if (todayData && SPREADSHEET_ID) {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      
      // 取得或建立歸檔總表
      const sheet = ss.getSheetByName("歸檔總表") || ss.insertSheet("歸檔總表", 0);
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["日期", "船名", "限制風速", "POB時間", "POB風速", "POB訊息", "北堤風力", "空軍預測風力", "ECMWF預測陣風"]);
      }
      
      // 抓取 GitHub Pages 上的風速預測資料
      let cpcJsonStr = "{}";
      let omJsonStr = "{}";
      try {
        const url = "https://uuuhasho.github.io/wind-monitor-app/data.json?t=" + new Date().getTime();
        const response = UrlFetchApp.fetch(url);
        const dataArr = JSON.parse(response.getContentText());
        const cpcData = dataArr.map(d => ({ timestamp: d.timestamp, speed: d.cpc_wind_speed }));
        const omData = dataArr.map(d => ({ timestamp: d.timestamp, speed: d.open_meteo_wind_speed }));
        cpcJsonStr = JSON.stringify(cpcData);
        omJsonStr = JSON.stringify(omData);
      } catch (e) {
        console.error("Failed to fetch wind forecast json: " + e);
      }

      // 預先取得或建立 160K 與 180K 分頁
      const sheet160K = ss.getSheetByName("160K") || ss.insertSheet("160K");
      if (sheet160K.getLastRow() === 0) sheet160K.appendRow(["序號", "時間", "船名", "POB風速"]);
      
      const sheet180K = ss.getSheetByName("180K") || ss.insertSheet("180K");
      if (sheet180K.getLastRow() === 0) sheet180K.appendRow(["序號", "時間", "船名", "POB風速"]);

      for (const cardKey in todayData) {
        const card = todayData[cardKey];
        const config = card.config || {};
        const pob = card.pob_info || {};
        const rawLogs = card.wind_logs || {};
        
        // =========================================================
        // ⭐ 新增功能：判斷 limit_speed 並寫入 160K 或 180K 分頁
        // =========================================================
        const limitSpeedNum = Number(config.limit_speed);
        let targetSheet = null;
        
        // 判斷該船屬於哪一個分類
        if (limitSpeedNum === 13.8) {
          targetSheet = sheet160K;
        } else if (limitSpeedNum === 12.0) {
          targetSheet = sheet180K;
        }

        // 如果有對應的分頁，而且有 POB 時間，就進行寫入
        if (targetSheet && pob.pob_time) {
          const serialNum = targetSheet.getLastRow(); // 總列數剛好可以當作序號 (標題列為1 -> 序號1)
          const formattedDate = dateStr.replace(/-/g, '/') + " " + pob.pob_time; // 轉換為 YYYY/MM/DD HH:mm
          
          targetSheet.appendRow([
            serialNum,
            formattedDate,
            config.ship_name || "未知",
            pob.pob_wind_speed || "-"
          ]);
        }
        // =========================================================

        // 整理全天風速日誌
        const timeKeys = Object.keys(rawLogs).sort();
        const cleanedLogs = {};
        
        // 💡 優化：萃取乾淨的 24H 時間格式 (例如 "17:30") 寫入試算表
        timeKeys.forEach(k => {
          const match = k.match(/(上午|下午)?.*?(\d{1,2}):(\d{2})/);
          if (match) {
            let ampm = match[1];
            let h = Number(match[2]);
            let m = match[3];
            if (ampm === "下午" && h < 12) h += 12;
            else if (ampm === "上午" && h === 12) h = 0;
            
            let timeStr = String(h).padStart(2, '0') + ":" + m; // 補零變成 HH:mm
            cleanedLogs[timeStr] = rawLogs[k];
          } else {
            cleanedLogs[k] = rawLogs[k]; 
          }
        });
        
        // 💡 判斷未進港的備註文字：檢查是否有被預約延遲
        let pobTimeDisplay = pob.pob_time;
        if (!pobTimeDisplay) {
          const reservedData = props.getProperty('RESERVED_MISSION');
          const reservedMission = reservedData ? safeJsonParse(reservedData, null) : null;
          if (reservedMission && reservedMission.ship_name === config.ship_name) {
            pobTimeDisplay = "延遲至明日";
          } else {
            pobTimeDisplay = "未進港"; // 若希望無條件一律標記，可將此處也改為 "延遲至明日"
          }
        }

        // 執行原本寫入歸檔總表的程序
        sheet.appendRow([
          dateStr,
          config.ship_name || "未知", 
          config.limit_speed || "-", 
          pobTimeDisplay,
          pob.pob_wind_speed || "-", 
          pob.formatted_msg || "無訊息", 
          JSON.stringify(cleanedLogs),
          cpcJsonStr,
          omJsonStr
        ]);
      }
    }
    
    // 記錄今日已歸檔的船隻名稱，避免 23:00 歸檔後因 Firebase 資料刪除而在 00:00 前重新出現在船期表上
    if (todayData) {
      const archivedShips = Object.keys(todayData).map(cardKey => {
        return (todayData[cardKey] && todayData[cardKey].config) ? todayData[cardKey].config.ship_name : null;
      }).filter(Boolean);
      
      if (archivedShips.length > 0) {
        props.setProperty('ARCHIVED_SHIPS_TODAY', JSON.stringify({
          date: dateStr,
          ships: archivedShips
        }));
      }
    }
    
    callFirebase(`daily_records/${dateStr}`, null, "delete");
    callFirebase("active_status", { "app_mode": "stop", "target_key": "", "ship_name": "", "limit_speed": "" }, "patch");
    props.deleteProperty('LAST_WIND_DATA_TIME');
    console.log("✅ 歸檔成功");
    
    // 🌟 更新 Firebase 上的船期表
    updateFirebaseScheduleList();
  } catch (e) { console.error(`歸檔失敗: ${e}`); }
}

// ==========================================
// 7. 🌐 App 端 API 接口 (雙效合一版)
// ==========================================
function doGet(e) {
  const action = e.parameter.action || 'display';
  
  // 🔒 1. 權限驗證 (適用於寫入指令)
  const isWriteAction = ['set_mode', 'reserve_next', 'trigger_update'].includes(action);
  if (isWriteAction) {
    const inputPwd = e.parameter.pwd || "";
    const correctPwd = props.getProperty('OP_PASSWORD') || '1234'; 
    if (inputPwd !== correctPwd) {
      return ContentService.createTextOutput(JSON.stringify({status: "error", msg: "密碼錯誤，您沒有權限進行此操作！"})).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 📝 2. 處理預約隔天監控
  if (action === 'reserve_next') {
    const mission = {
      ship_name: e.parameter.ship_name,
      limit_speed: e.parameter.limit_speed,
      reserved_at: new Date().getTime()
    };
    props.setProperty('RESERVED_MISSION', JSON.stringify(mission));
    
    // 🌟 更新 Firebase 上的船期表
    updateFirebaseScheduleList();
    
    return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
  }

  // 📝 3. 處理手動更新氣象預報 (安全中繼代理 GitHub Actions)
  if (action === 'trigger_update') {
    // 1. 將 Firebase 上的更新中狀態設為 true (鎖定前端按鈕)
    callFirebase("active_status", { "forecast_updating": true }, "patch");
    
    // 2. 取得儲存在 GAS 指令碼屬性中的安全金鑰與儲存庫資訊
    const githubToken = props.getProperty('GITHUB_PAT') || '';
    const repoOwner = props.getProperty('GITHUB_OWNER') || 'hilla'; // 預設擁有者
    const repoName = props.getProperty('GITHUB_REPO') || 'milkshake-monitor'; // 預設儲存庫
    const workflowId = props.getProperty('GITHUB_WORKFLOW_ID') || 'update_forecast.yml'; // 預設工作流
    
    if (!githubToken) {
      callFirebase("active_status", { "forecast_updating": false }, "patch");
      return ContentService.createTextOutput(JSON.stringify({
        status: "error", 
        msg: "尚未設定 GITHUB_PAT 金鑰！請至 GAS 屬性中新增 [GITHUB_PAT]。"
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/actions/workflows/${workflowId}/dispatches`;
    const options = {
      method: "post",
      contentType: "application/json",
      headers: {
        "Authorization": "Bearer " + githubToken,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Google-Apps-Script-Trigger"
      },
      payload: JSON.stringify({
        ref: "main" // 觸發的工作流分支
      }),
      muteHttpExceptions: true
    };
    
    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      
      if (code === 204) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "success", 
          msg: "雲端更新流程已順利啟動！"
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        // 觸發失敗，將 Firebase 狀態復原
        callFirebase("active_status", { "forecast_updating": false }, "patch");
        return ContentService.createTextOutput(JSON.stringify({
          status: "error", 
          msg: `GitHub Actions 啟動失敗 [狀態碼:${code}]: ` + response.getContentText()
        })).setMimeType(ContentService.MimeType.JSON);
      }
    } catch (err) {
      // 網路連線失敗，將 Firebase 狀態復原
      callFirebase("active_status", { "forecast_updating": false }, "patch");
      return ContentService.createTextOutput(JSON.stringify({
        status: "error", 
        msg: "連線至 GitHub 失敗: " + err.message
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  if (action === 'set_mode') {

    if (e.parameter.mode === 'start') {
      // 🟢 密碼正確，使用統一函式啟動
      startMonitoring(e.parameter.ship_name, e.parameter.limit_speed, "false");
    } else { 
      // 🔴 手動結束監控邏輯
      const activeStatusRes = callFirebase("active_status", null, "get").getContentText();
      const activeStatus = safeJsonParse(activeStatusRes);
      const lastShipName = activeStatus.ship_name || "";
      const lastLimitSpeed = activeStatus.limit_speed || "";

      const manualPobTime = e.parameter.pob_time;
      if (manualPobTime && lastShipName) {
        processPobDirect(lastShipName, manualPobTime);
      } else {
        callFirebase("active_status", { "app_mode": "stop" }, "patch"); 
        
        // 🌟 更新 Firebase 上的船期表
        updateFirebaseScheduleList();
      }

      // 🔍 檢查隔天是否有船 (回傳給前端判斷是否詢問預約)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowM_D = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`;
      let hasTomorrowShip = true;
      try {
        const apiData = safeJsonParse(UrlFetchApp.fetch(SHIP_SCHEDULE_API_URL).getContentText());
        if (apiData.data) {
          hasTomorrowShip = apiData.data.some(item => item.d === tomorrowM_D);
        }
      } catch(e) { hasTomorrowShip = true; } 

      return ContentService.createTextOutput(JSON.stringify({
        status: "success", 
        has_tomorrow_ship: hasTomorrowShip,
        last_ship_name: lastShipName,
        last_limit_speed: lastLimitSpeed
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 回傳成功訊息 (給啟動模式)
    return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
  }
  
  // 🟢 顯示畫面邏輯 (不變)
  const activeStatusRes = callFirebase("active_status", null, "get").getContentText();
  const activeStatus = safeJsonParse(activeStatusRes);
  activeStatus.seasonTime = getTodaySeasonTime();
  // 🌟 修改：改為直接從 Firebase 取得船期表，避免每次 doGet 都要呼叫 API 消耗配額
  const scheduleRes = callFirebase("schedule_list", null, "get").getContentText();
  activeStatus.schedule_list = safeJsonParse(scheduleRes, []);
  return ContentService.createTextOutput(JSON.stringify(activeStatus)).setMimeType(ContentService.MimeType.JSON);
}

function fetchWindData() {
  try {
    const rawHtml = UrlFetchApp.fetch(TARGET_URL, { "muteHttpExceptions": true }).getContentText();
    const match = rawHtml.match(/id="Txt_Station_Data"[^>]*value=["']([^"']*)["']/);
    const realHtml = (match && match[1]) 
      ? match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ') 
      : rawHtml;
      
    const index = realHtml.indexOf(STATION_NAME);
    if (index === -1) return { valid: false };
    
    const rowHtml = realHtml.substring(realHtml.lastIndexOf('<tr', index), realHtml.indexOf('</tr>', index) + 5);
    const cells = [];
    const cellRegex = /<td[\s\S]*?>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
    }
    
    const speedMatch = cells[21] ? cells[21].match(/WS_AVG=([\d\.]+)/i) : null;
    if (speedMatch) {
      return { valid: true, speed: Math.round(parseFloat(speedMatch[1]) * 10) / 10, time: cells[20] };
    }
    return { valid: false };
  } catch (e) { 
    return { valid: false }; 
  }
}

// ==========================================
// 8. 🚢 產生未來 10 筆船期表 (供前端顯示)
// ==========================================
function getScheduleList() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const todayM_D = `${now.getMonth() + 1}/${now.getDate()}`;
  const tomorrowM_D = `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`;
  const dateStr = getTwDateStr(now);
  
  let mappedList = [];
  
  // 1. 抓取日曆 API (移除 5 分鐘快取限制，因為只在狀態改變或觸發器執行時才會抓取)
  let apiDataRaw = "";
  if (SHIP_SCHEDULE_API_URL) {
    try {
      apiDataRaw = UrlFetchApp.fetch(SHIP_SCHEDULE_API_URL).getContentText();
    } catch (e) { console.error(e); }
  }
  
  if (apiDataRaw) {
    const apiData = safeJsonParse(apiDataRaw, { data: [] }).data || [];
    
    // 過濾出「今天起」未來的船期
    let futureApiData = apiData.filter(item => {
       const parts = item.d.split('/');
       if (parts.length < 2) return false;
       let m = parseInt(parts[0], 10);
       let d = parseInt(parts[1], 10);
       let itemDate = new Date(now.getFullYear(), m - 1, d);
       // 跨年處理
       if (now.getMonth() > 8 && m < 3) itemDate.setFullYear(now.getFullYear() + 1);
       if (now.getMonth() < 3 && m > 8) itemDate.setFullYear(now.getFullYear() - 1);
       return itemDate >= today;
    });

    mappedList = futureApiData.map(item => {
      const nameMatch = item.n.match(/^(.*?)\((.*?)\)/);
      const shipName = nameMatch ? nameMatch[1].trim() : item.n.trim();
      const limitSpeed = SHIP_TYPE_MAPPING[nameMatch ? nameMatch[2].trim() : ""] || 15.0; 
      return { d: item.d, ship_name: shipName, limit_speed: limitSpeed };
    });
  }

  // 取得今日已歸檔的船隻列表
  const archivedRaw = props.getProperty('ARCHIVED_SHIPS_TODAY');
  let archivedShips = [];
  if (archivedRaw) {
    const archivedInfo = safeJsonParse(archivedRaw, null);
    if (archivedInfo && archivedInfo.date === dateStr) {
      archivedShips = archivedInfo.ships || [];
    }
  }

  // 2. 檢查今天船是否已 POB (剔除已完成船隻)
  let i = 0;
  while (i < mappedList.length && mappedList[i].d === todayM_D) {
     const ship = mappedList[i];
     
     // 若該船今日已歸檔，直接剔除，不需再查 Firebase
     if (archivedShips.includes(ship.ship_name)) {
        mappedList.splice(i, 1);
        continue;
     }

     const cardKey = `${dateStr}_${sanitizeKey(ship.ship_name)}`;
     try {
        const pobRes = callFirebase(`daily_records/${dateStr}/${cardKey}/pob_info`, null, "get").getContentText();
        const pobInfo = safeJsonParse(pobRes, null);
        // 若找到 pob_time 代表已進港，將其從清單中移除
        if (pobInfo && pobInfo.pob_time) mappedList.splice(i, 1);
        else i++;
     } catch(e) { i++; }
  }

  // 3. 處理 RESERVED_MISSION (延遞至明日的船)
  const reservedRaw = props.getProperty('RESERVED_MISSION');
  if (reservedRaw) {
     const reservedMission = safeJsonParse(reservedRaw, null);
     if (reservedMission) {
        // 若清單已有該船名(可能為舊資料)，先剔除防重複
        mappedList = mappedList.filter(item => item.ship_name !== reservedMission.ship_name);
        // 將預約任務強制塞入並設定為明天
        mappedList.unshift({ d: tomorrowM_D, ship_name: reservedMission.ship_name, limit_speed: reservedMission.limit_speed, is_reserved: true });
     }
  }
  
  // 回傳前 10 筆給前端
  return mappedList.slice(0, 10);
}

// 系統初始化觸發器
function setupSystemTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  
  ScriptApp.newTrigger("checkDailySchedule").timeBased().atHour(4).everyDays(1).create();
  ScriptApp.newTrigger("executeMonitor").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("archiveAndClearFirebase").timeBased().atHour(23).everyDays(1).create();
}

// 🌟 新增：更新 Firebase 上的船期表資料
function updateFirebaseScheduleList() {
  try {
    const list = getScheduleList();
    const res = callFirebase("schedule_list", list, "put");
    if (res.getResponseCode() === 200) {
      console.log("✅ 成功更新 Firebase 船期表資料");
    }
  } catch (e) {
    console.error("❌ 更新 Firebase 船期表資料失敗: " + e.message);
  }
}

// 🌟 新增：日曆或試算表變更時的觸發器入口
function onCalendarOrSheetChange() {
  console.log("📅 偵測到日曆/試算表內容變更，啟動同步...");
  updateFirebaseScheduleList();
}