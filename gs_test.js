// ========================================================================= _test
// 🚢 臺中 LNG 船監控系統(測試版) - By Bill Tsai 
// 更新日期：2026/10/06
// 更新內容：
// 1. 23:00 歸檔 JSON 日誌還原為人類易讀格式 {"08:10": 5.2} 並按時間排序，且 app 船期表剃除已 POB 的船。
// 2. POB 風速: 找出 POB 前10分鐘內的 wind_logs的那筆紀錄。
// 3. 新增手動輸入 POB 時間結束監控。
// 4. POB 30分鐘前判斷是否可進港 + 手動模式密碼驗證
// 5. 04:00 以日曆船期優先監控，即使昨日有預約船，仍會被取消
// 6.修改風力開始判斷時間點，夏季4:30, 冬季5:00
// *7.新增Github指令碼屬性
// *8.新增 17:00 超時防呆警示，同步 Firebase 狀態以控制前端警告 UI。
// *9. 移除 Gmail 監聽機制的信件收件時間限制（只要日期與主旨符合即可)。
// *10. 23:00 歸檔 H, I 欄的 JSON 預報數據，只保留 POB 當天資料，格式改為與 G 欄一致的 {"HH:mm": speed} 格式，並新增手動修正函式 fixLastRowJson。
// *11. 移除預約隔天監控功能，改為無法進港時將船期移至調整清單首位（日期空白），手動儲存調整或重置時清空此暫存（UNFINISHED_SHIP）。
// *12. 歸檔重構為 12 欄 (G:碼頭, H:未進港原因, I:備註, J~L:預報JSON)，並實作改期船隻智慧繼承機制，避免其被歸檔過濾。
// *13.只要包含「台中廠」、「已於」、「POB」及「時間(含未打冒號)」即可擷取LINE訊息。
// *14. 修復 P0 級錯誤：pobTime 重新賦值崩潰 (C1)、同步反向 for 遍歷 (C2)、歸檔 delete 防資料遺失保護 (C3)、預設 FIREBASE_URL 指向 newlngship 專案 (C5)。
// *15. 新增動態 Firebase access_token 傳遞認證機制，供 Python E2E 測試與無密鑰模式免 Database Secret 調用。
// *16. 統一將 GitHub API 請求的 method 轉為大寫，防範 GAS 退化為 GET 請求。
// *17. 建立 ensureTestEnvironment 檢查，優化 doGet 頻繁寫入屬性問題，並於觸發器與定時排程加入環境防護。
// *18. 補齊手動結束監控未填寫原因時的空白分支，使其依然能觸發下一艘船的換班接力。
// *19. 修正 cleanedLogs 下午時間日誌解析，防止無 AM/PM 標識將 13:30 錯誤記為 01:30。
// *20. fetchWindData 引入 35 秒 CacheService 快取，避免定時刷新刷爆 URL Fetch 每日配額。
// *21. 將 POB 訊息格式改為: [船名] 已於 [POB時間] 進港，並移除無用的 speedStr 變數。
// *22. Bug Fix: 延遲進港归檔修復：繼承機制移除 wind_logs 複製（防止風速污染），並於繼承前補寫原日未進港試算表記錄（防止 no_entry_reason 遺失）。
// *23. 日曆 API 增強與熔斷防護：引入 muteHttpExceptions 與 200 狀態檢查，並在 updateFirebaseScheduleList 加入 Fail-Safe 機制，空資料拒絕覆蓋 Firebase。
// =========================================================================




const props = PropertiesService.getScriptProperties();
var dynamicFbToken = ""; // 🌟 用於存放當次 API 請求傳遞的臨時 Firebase Token，不寫入 ScriptProperties 以免過期失效


// --- 基礎屬性讀取 ---
const STATION_NAME = getProp('STATION_NAME', '北堤綠燈塔');
const SHIP_TYPE_MAPPING = getJsonProp('SHIP_TYPE_MAPPING', {}); 
const SEASONS_CONFIG = getJsonProp('SEASONS_CONFIG', {
  "summer_months": [4, 5, 6, 7, 8, 9], 
  "summer_forecast_time": "05:00", 
  "winter_forecast_time": "05:30"
});

// 💡 採用動態 Getter 屬性，避免全域變數在 GAS 當次請求執行中發生生命週期滯後問題
Object.defineProperty(this, 'TARGET_URL', { get: function() { return getProp('TARGET_URL', ''); } });
Object.defineProperty(this, 'SPREADSHEET_ID', { get: function() { return getProp('SPREADSHEET_ID', ''); } });
Object.defineProperty(this, 'SHIP_SCHEDULE_API_URL', { get: function() { return getProp('SHIP_SCHEDULE_API_URL', ''); } });
Object.defineProperty(this, 'FB_URL', { get: function() { return getProp('FIREBASE_URL', ''); } });
Object.defineProperty(this, 'FB_SECRET', { get: function() { return getProp('FIREBASE_SECRET', ''); } });

// --- 輔助函式區 ---
function getProp(key, defaultVal) { return props.getProperty(key) || defaultVal; }
function getJsonProp(key, defaultVal) {
  const val = props.getProperty(key);
  return val ? safeJsonParse(val, defaultVal) : defaultVal;
}
function sanitizeKey(str) { return str.replace(/[\.\s\#\$\[\]\/]/g, "_"); }
function releaseEditingLock() {
  callFirebase("editing_lock", { locked: false, locked_at: 0 }, "put");
}
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

// 🌟 確保測試環境設定正確 (避免 Script Properties 頻繁寫入且提供 Trigger 環境防護)
function ensureTestEnvironment() {
  const props = PropertiesService.getScriptProperties();
  
  // 🧹 自動清除殘留的過期臨時 Token，避免影響後續 callFirebase 運作
  const currentSecret = props.getProperty("FIREBASE_SECRET");
  if (currentSecret && currentSecret.indexOf("ya29.") === 0) {
    console.log("🧹 偵測到過期的臨時 OAuth Token，自動清除重置為空，以利公共規則存取...");
    props.setProperty("FIREBASE_SECRET", "");
  }

  const fbUrl = props.getProperty("FIREBASE_URL");
  if (!fbUrl || !fbUrl.includes("/test")) {
    props.setProperty("FIREBASE_URL", "https://newlngship-default-rtdb.asia-southeast1.firebasedatabase.app/test");
  }
  
  const targetUrl = props.getProperty("TARGET_URL");
  if (!targetUrl || !targetUrl.includes("Realtime_Panel_Port_GatData")) {
    props.setProperty("TARGET_URL", "https://wwtf.twport.com.tw/twport/display/Realtime_Panel_Port_GatData_2024.aspx?3");
  }
  
  if (!props.getProperty('FIREBASE_SECRET')) {
    props.setProperties({
      "FIREBASE_URL": "https://newlngship-default-rtdb.asia-southeast1.firebasedatabase.app/test",
      "FIREBASE_SECRET": "", 
      "SPREADSHEET_ID": "1829HCrinCxHYOUcgvlAGrsv2mH-bKwp3Rst90pzV3po",
      "OP_PASSWORD": "1234",
      "TARGET_URL": "https://wwtf.twport.com.tw/twport/display/Realtime_Panel_Port_GatData_2024.aspx?3",
      "STATION_NAME": "北堤綠燈塔",
      "SHIP_SCHEDULE_API_URL": "https://script.google.com/macros/s/AKfycbz55eDn5hQaRsYqGu0VPSQbvlTgVY6WPEc0hKe9OMeLNtzNhxtzwJbN_IAgk46-B7rh/exec?mode=api&port=%E5%8F%B0%E4%B8%AD"
    });
  }
}

// ==========================================
// 1. Firebase 核心通訊模組 (加入錯誤回報與防護機制) 
// ==========================================
function callFirebase(path, data, method = "patch") {
  const fbUrl = getProp('FIREBASE_URL', '');
  const fbSecret = dynamicFbToken || getProp('FIREBASE_SECRET', '');
  const baseUrl = fbUrl.endsWith('/') ? fbUrl : `${fbUrl}/`;
  
  // 🌟 自適應識別驗證金鑰類型：OAuth Token 使用 access_token 參數，傳統 Secret 使用 auth 參數；若金鑰為空則不附加，避免 Firebase 401 錯誤
  let authQuery = "";
  if (fbSecret) {
    if (fbSecret.indexOf("ya29.") === 0) {
      authQuery = `access_token=${fbSecret}`;
    } else {
      authQuery = `auth=${fbSecret}`;
    }
  }
  
  const url = authQuery ? `${baseUrl}${path}.json?${authQuery}` : `${baseUrl}${path}.json`;
  const options = {
    method: method.toUpperCase(),
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
  ensureTestEnvironment();
  if (e && e.parameter && e.parameter.fb_token) {
    dynamicFbToken = e.parameter.fb_token;
  }
  
  // 🌟 處理所有來自前端的 POST action (避免 GET URL 長度與 CORS 攔截)
  if (e.parameter && e.parameter.action) {
    return doGet(e);
  }
  
  try {
    const eventData = safeJsonParse(e.postData.contents);
    const events = eventData.events || [];
    
    for (let event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;

        //**瞬間解析：高度容錯，只要包含「台中廠」、「已於」、「POB」及「時間(含未打冒號)」即可擷取
        const match = userMessage.match(/台中廠[^\w\u4e00-\u9fa5]*(.*?)\s*已於.*?(\d{2}[:：]?\d{2}).*?POB/i);
        if (match) {
          const shipName = match[1].replace(/LNG船/g, "").trim();
          let pobTime = match[2].replace("：", ":").trim();

        // 如果時間格式只有 4 個數字且沒有冒號 (例如 "0722")，自動在中間補上冒號
          if (pobTime.length === 4 && !pobTime.includes(":")) {
            pobTime = pobTime.substring(0, 2) + ":" + pobTime.substring(2, 4);
          }

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
        } else if (!ampm) {
          // 如果沒有上午/下午，根據 POB 小時 (已知是 24 小時制) 判斷這筆紀錄是不是下午
          // 🔴 修正：加入假設驗證，避免 pobH - rowH == 12 時將清晨 AM 日誌誤轉為 PM
          if (pobH >= 12 && rowH < 12 && (pobH - rowH >= 12)) {
            const hypotheticalRowMins = (rowH + 12) * 60 + rowM;
            const hypotheticalDiff = pobMins - hypotheticalRowMins;
            // 只有在轉換後的時間確實接近 POB（±60 分鐘內）才視為 PM 並轉換
            if (hypotheticalDiff >= -60 && hypotheticalDiff <= 60) {
              rowH += 12;
            }
            // 否則維持原 rowH，視為 AM 時間，交由後續 diff 計算自然過濾
          }
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

    const formattedMsg = `${shipName} 已於 ${pobTime} 進港`;
    
    // 瞬間寫入 Firebase 看板 (第一筆連線)
    callFirebase(`daily_records/${dateStr}/${targetKey}/pob_info`, {
      "pob_time": pobTime, "pob_wind_speed": historySpeed, "formatted_msg": formattedMsg
    }, "patch");
    
// 💡 新增：強制暫停 1000 毫秒，等待底層 TCP 連線釋放與資源回收
    Utilities.sleep(1000);

    // 🌟 更新 Firebase 上的船期表 (把已經進港的這艘船剔除)
    updateFirebaseScheduleList();
    
    // 🌟 換班接力檢查：今日是否還有其他未進港的船
    if (!tryHandoffToNextShip("順利進港")) {
      callFirebase("active_status", { "app_mode": "stop" }, "patch");
    }
  } catch (e) { 
    console.error(`❌ POB 直連推播失敗: ${e}`); 
  }
}


// ==========================================
// 4. 🌅 04:00 自動排程：建立今日卡片
// ==========================================
function startMonitoring(shipName, limitSpeed, isAutoRun = "true", terminal = "") {
  const now = new Date();
  const dateStr = getTwDateStr(now);
  const cardKey = `${dateStr}_${sanitizeKey(shipName)}`;
  const seasonTime = getTodaySeasonTime();
  
  // 檢查是否已有繼承的卡片存在
  let existingCard = null;
  try {
    const res = callFirebase(`daily_records/${dateStr}/${cardKey}`, null, "get").getContentText();
    existingCard = safeJsonParse(res, null);
  } catch(e) {}
  
  if (existingCard && existingCard.config) {
    // 發現繼承卡片，使用 patch 更新必要屬性，避免覆寫 original_date 與 delay_reasons
    const updatedConfig = existingCard.config;
    updatedConfig.limit_speed = limitSpeed;
    updatedConfig.season_time = seasonTime;
    updatedConfig.terminal = terminal || updatedConfig.terminal || "";
    
    callFirebase(`daily_records/${dateStr}/${cardKey}/config`, updatedConfig, "patch");
    console.log(`🚢 繼承已存在的卡片設定 [${shipName}]，使用 patch 更新必要欄位。`);
  } else {
    // 建立全新卡片，使用 put
    callFirebase(`daily_records/${dateStr}/${cardKey}`, {
      "config": { 
        "ship_name": shipName, 
        "limit_speed": limitSpeed, 
        "season_time": seasonTime, 
        "create_at": now.getTime(),
        "terminal": terminal
      }
    }, "put");
    console.log(`🚢 建立全新卡片 [${shipName}]。`);
  }
  
  callFirebase("active_status", {
    "target_key": cardKey, 
    "app_mode": "start", 
    "ship_name": shipName, 
    "limit_speed": limitSpeed, 
    "is_auto_run": isAutoRun,
    "season_time": seasonTime,
    "terminal": terminal
  }, "patch");
  
  props.deleteProperty('LAST_WIND_DATA_TIME');
  
  // 🌟 更新 Firebase 上的船期表
  updateFirebaseScheduleList();
}

function checkDailySchedule() {
  ensureTestEnvironment();
  props.deleteProperty('ARCHIVED_SHIPS_TODAY');
  const now = new Date();
  const dateStr = getTwDateStr(now);

  const todayM_D = Utilities.formatDate(now, "GMT+8", "M/d");
  let hasApiShipToday = false;
  let apiShipName = "";
  let apiLimitSpeed = 15.0;
  let apiTerminal = "";
  
  // 💡 讀取最新合併船期表 (已包含手動調整覆蓋與日曆)
  try {
    const list = getScheduleList();
    const todayShip = list.find(item => item.d === todayM_D);
    if (todayShip) {
      apiShipName = todayShip.ship_name;
      apiLimitSpeed = Number(todayShip.limit_speed) || 15.0;
      apiTerminal = todayShip.terminal || "";
      hasApiShipToday = true;
    }
  } catch(e) {
    console.error(`04:00 排程讀取船期失敗: ${e}`);
  }

  // 2. 根據 API 檢查結果決定後續動作
  if (hasApiShipToday) {
    // 狀況 2: 發現今天有其他船 (臨時插隊)，新船優先
    startMonitoring(apiShipName, apiLimitSpeed, "true", apiTerminal);
    if (props.getProperty('RESERVED_MISSION')) props.deleteProperty('RESERVED_MISSION');
  } else {
    // 狀況 1: 今天無船，檢查是否有預約任務
    const reserved = props.getProperty('RESERVED_MISSION');
    if (reserved) {
      const mission = safeJsonParse(reserved, null);
      if (mission) {
        startMonitoring(mission.ship_name, mission.limit_speed, "true", mission.terminal || "");
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
  ensureTestEnvironment();
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
function archiveAndClearFirebase(simDate = null) {
  // 🌟 防止 GAS 時間觸發器預設傳入 Event Object 導致誤判
  if (typeof simDate !== 'string') {
    simDate = null;
  }
  
  // 🌟 確保 23:00 自動觸發時有載入正確的環境防護 (防止污染正式機)
  ensureTestEnvironment();

  const now = new Date();
  const dateStr = simDate || getTwDateStr(now);
  const todayM_D = simDate ? (parseInt(simDate.substring(5, 7), 10) + "/" + parseInt(simDate.substring(8, 10), 10)) : `${now.getMonth() + 1}/${now.getDate()}`;
  
  try {
    const todayDataRes = callFirebase(`daily_records/${dateStr}`, null, "get").getContentText();
    const todayData = safeJsonParse(todayDataRes, null);
    
    if (todayData && SPREADSHEET_ID) {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      
      // 取得或建立歸檔總表
      const sheet = ss.getSheetByName("歸檔總表") || ss.insertSheet("歸檔總表", 0);
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["日期", "船名", "限制風速", "POB時間", "POB風速", "POB訊息", "碼頭", "未進港原因", "備註", "北堤實際風力", "空軍預測值", "陣風預測值"]);
      }
      
      // 抓取 Firebase RTDB 上的風速預測資料
      let cpcJsonStr = "";
      let omJsonStr = "";
      let fetchSuccess = false;
      try {
        const response = callFirebase("forecast_data", null, "get");
        const dataObj = JSON.parse(response.getContentText());
        const dataArr = Array.isArray(dataObj) ? dataObj.filter(i => i) : Object.values(dataObj || {});
        
        const cpcLogs = {};
        const omLogs = {};
        
        dataArr.forEach(d => {
          if (d.timestamp && d.timestamp.indexOf(dateStr) === 0) {
            const timeKey = d.timestamp.substring(11, 16); // 提取 "HH:mm"
            if (d.cpc_wind_speed !== null && d.cpc_wind_speed !== undefined) {
              cpcLogs[timeKey] = d.cpc_wind_speed;
            }
            if (d.open_meteo_wind_speed !== null && d.open_meteo_wind_speed !== undefined) {
              omLogs[timeKey] = d.open_meteo_wind_speed;
            }
          }
        });
        
        cpcJsonStr = JSON.stringify(cpcLogs);
        omJsonStr = JSON.stringify(omLogs);
        fetchSuccess = true;
      } catch (e) {
        console.error("❌ 歸檔時抓取 Firebase forecast_data 失敗: " + e);
        cpcJsonStr = "fetch_failed: " + e.message;
        omJsonStr = "fetch_failed: " + e.message;
      }

      // 取得最新船期表，用以判斷今日未進港的船隻是否已改期到明天或未來
      let latestSchedule = [];
      try {
        latestSchedule = getScheduleList();
      } catch(e) {
        console.error("無法取得最新船期表: " + e);
      }

      // 預先取得或建立 160K 與 180K 分頁
      const sheet160K = ss.getSheetByName("160K") || ss.insertSheet("160K");
      if (sheet160K.getLastRow() === 0) sheet160K.appendRow(["序號", "時間", "船名", "POB風速"]);
      
      const sheet180K = ss.getSheetByName("180K") || ss.insertSheet("180K");
      if (sheet180K.getLastRow() === 0) sheet180K.appendRow(["序號", "時間", "船名", "POB風速"]);

      const archivedShips = [];
      let allSuccess = true;

      for (const cardKey in todayData) {
        const card = todayData[cardKey];
        const config = card.config || {};
        const pob = card.pob_info || {};
        const rawLogs = card.wind_logs || {};
        const shipName = config.ship_name;
        
        if (!shipName) continue;
        
        const hasPob = !!pob.pob_time;
        
        // 智慧檢查該未進港船隻是否被改期到了明天或未來
        let isRescheduled = false;
        let targetMD = "";
        
        if (!hasPob) {
          const scheduleItem = latestSchedule.find(item => item.ship_name === shipName);
          if (scheduleItem && scheduleItem.d && scheduleItem.d !== todayM_D && scheduleItem.d !== "") {
            isRescheduled = true;
            targetMD = scheduleItem.d;
          }
        }
        
        if (isRescheduled) {
          // 🚢 改期船隻繼承機制：先將原定日「未進港」記錄寫入試算表，再將卡片（不含 wind_logs）移轉至未來日期
          try {
            const parts = targetMD.split('/');
            const m = parseInt(parts[0], 10);
            const d = parseInt(parts[1], 10);
            let targetYear = now.getFullYear();
            if (now.getMonth() > 8 && m < 3) targetYear += 1;
            if (now.getMonth() < 3 && m > 8) targetYear -= 1;
            
            const targetDate = new Date(targetYear, m - 1, d);
            const targetDateStr = Utilities.formatDate(targetDate, "GMT+8", "yyyy-MM-dd");
            const targetCardKey = `${targetDateStr}_${sanitizeKey(shipName)}`;
            
            // 寫入/繼承 original_date，保留最原始的預定日
            config.original_date = config.original_date || dateStr;
            
            // 將無法進港的最新原因記錄下來（累積記錄，但不寫入試算表）
            const currentReason = pob.no_entry_reason || "未進港";
            const delayReasons = config.delay_reasons || [];
            delayReasons.push(`${dateStr}: ${currentReason}`);
            config.delay_reasons = delayReasons;
            
            // 改期後新的一天需要重新監控，清空 POB 資訊
            const newPobInfo = {};
            
            // ✅ Bug 1 Fix: 不繼承 wind_logs，讓改期後的新一天從空白卡片重新記錄實際風速
            const inheritedCard = {
              config: config,
              pob_info: newPobInfo
            };
            
            // ✅ Bug 2 Fix: 先將原日期的「未進港」記錄寫入試算表，保留完整的無法進港原因
            const cleanedLogsForArchive = {};
            Object.keys(rawLogs).sort().forEach(k => {
              const match = k.match(/(上午|下午)?.*?(\d{1,2}):(\d{2})/);
              if (match) {
                let h = Number(match[2]);
                if (match[1] === "下午" && h < 12) h += 12;
                else if (match[1] === "上午" && h === 12) h = 0;
                cleanedLogsForArchive[String(h).padStart(2, '0') + ":" + match[3]] = rawLogs[k];
              } else {
                cleanedLogsForArchive[k] = rawLogs[k];
              }
            });
            sheet.appendRow([
              dateStr,                                 // A: 日期（原定日）
              config.ship_name || "未知",              // B: 船名
              config.limit_speed || "-",               // C: 限制風速
              "未進港",                                 // D: POB 時間
              "-",                                     // E: POB 風速（無）
              pob.formatted_msg || "無訊息",            // F: POB 訊息
              config.terminal || "-",                  // G: 碼頭
              pob.no_entry_reason || "-",              // H: 未進港原因
              "-",                                     // I: 備註（原定日無延遲備註）
              JSON.stringify(cleanedLogsForArchive),   // J: 北堤實際風力
              cpcJsonStr,                              // K: 空軍預測值
              omJsonStr                                // L: 陣風預測值
            ]);
            archivedShips.push(config.ship_name);
            callFirebase(`daily_records/${targetDateStr}/${targetCardKey}`, inheritedCard, "put");
            console.log(`✅ [${shipName}] 監控卡片已順利繼承並移轉至 ${targetDateStr}`);
            // 改期成功視為處理完成
            callFirebase(`daily_records/${dateStr}/${cardKey}`, null, "delete");
          } catch(err) {
            console.error(`❌ 移轉改期船隻 [${shipName}] 失敗: ${err}`);
            allSuccess = false;
          }
          continue; // 跳過當天歸檔程序，不寫入試算表
        }
        
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
          
          try {
            targetSheet.appendRow([
              serialNum,
              formattedDate,
              config.ship_name || "未知",
              pob.pob_wind_speed || "-"
            ]);
          } catch (rowErr) {
            console.error(`❌ 寫入 ${limitSpeedNum}K 分頁失敗:`, rowErr);
          }
        }
        // =========================================================

        // 整理全天風速日誌
        const timeKeys = Object.keys(rawLogs).sort();
        const cleanedLogs = {};
        
        // 💡 優化：萃取乾淨的 24H 時間格式 (例如 "17:30") 寫入試算表
        let isPm = false;
        let lastHour = -1;
        timeKeys.forEach(k => {
          const match = k.match(/(上午|下午)?.*?(\d{1,2}):(\d{2})/);
          if (match) {
            let ampm = match[1];
            let h = Number(match[2]);
            let m = match[3];
            
            if (ampm === "下午") {
              isPm = true;
              if (h < 12) h += 12;
            } else if (ampm === "上午") {
              isPm = false;
              if (h === 12) h = 0;
            } else {
              // 無 AM/PM 標識
              if (h >= 12) {
                isPm = true;
              } else {
                // 若已標記為下午、或小時小於4 (代表不可能凌晨，只可能13, 14, 15點)、或小時出現倒退 (從 12 變 1)
                if (isPm || h < 4 || (lastHour >= 11 && h < lastHour)) {
                  isPm = true;
                  h += 12;
                }
              }
            }
            
            lastHour = h;
            let timeStr = String(h).padStart(2, '0') + ":" + m; // 補零變成 HH:mm
            cleanedLogs[timeStr] = rawLogs[k];
          } else {
            cleanedLogs[k] = rawLogs[k]; 
          }
        });
        
        // 💡 判斷未進港的備註文字
        let pobTimeDisplay = pob.pob_time;
        if (!pobTimeDisplay) {
          pobTimeDisplay = "未進港";
        }

        // 計算延遲備註 (精簡版：原定:MM-DD 延遲:N天)
        let delayNote = "-";
        if (config.original_date && config.original_date !== dateStr) {
          try {
            const d1 = new Date(config.original_date);
            const d2 = new Date(dateStr);
            const diffTime = Math.abs(d2 - d1);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            delayNote = `原定:${config.original_date.substring(5)} 延遲:${diffDays}天`;
          } catch(e) {}
        }

        // 執行寫入歸檔總表
        sheet.appendRow([
          dateStr,                                 // A: 日期
          config.ship_name || "未知",              // B: 船名
          config.limit_speed || "-",               // C: 限制風速
          pobTimeDisplay,                          // D: POB 時間
          pob.pob_wind_speed || "-",               // E: POB 風速
          pob.formatted_msg || "無訊息",           // F: POB 訊息
          config.terminal || "-",                  // G: 碼頭
          pob.no_entry_reason || "-",              // H: 未進港原因
          delayNote,                               // I: 備註
          JSON.stringify(cleanedLogs),             // J: 北堤實際風力 (JSON)
          cpcJsonStr,                              // K: 空軍預測值 (JSON)
          omJsonStr                                // L: 陣風預測值 (JSON)
        ]);

        // 只有真正被歸檔的船隻才加入今日歸檔快取，避免重複顯示
        archivedShips.push(config.ship_name);
      }

      if (archivedShips.length > 0) {
        props.setProperty('ARCHIVED_SHIPS_TODAY', JSON.stringify({
          date: dateStr,
          ships: archivedShips
        }));
      }

      // 🌟 只有在歸檔試算表成功寫入後，才清除 Firebase 當日卡片資料
      callFirebase(`daily_records/${dateStr}`, null, "delete");
      console.log("✅ 歸檔成功，已清除 Firebase 當日監控卡片");
    } else {
      console.log("⚠️ 今日無監控資料或未設定 SPREADSHEET_ID，跳過試算表寫入與資料清除");
    }
    
    // 🌟 不論是否有歸檔，深夜都應重置監控狀態與定時器狀態，確保隔日乾淨運作
    callFirebase("active_status", { "app_mode": "stop", "target_key": "", "ship_name": "", "limit_speed": "", "forecast_auto_failed": null }, "patch");
    props.deleteProperty('LAST_WIND_DATA_TIME');
    
    // 🌟 更新 Firebase 上的船期表
    updateFirebaseScheduleList();
  } catch (e) {
    console.error(`歸檔失敗: ${e}`);
    throw e;
  }
}

// ==========================================
// 7. 🌐 App 端 API 接口 (雙效合一版)
// ==========================================
function doGet(e) {
  ensureTestEnvironment();
  if (e && e.parameter && e.parameter.fb_token) {
    dynamicFbToken = e.parameter.fb_token;
  }
  const action = e.parameter.action || 'display';
  
  // 🔒 1. 權限驗證 (適用於寫入指令)
  const isWriteAction = ['set_mode', 'reserve_next', 'trigger_update', 'archive_test', 'update_schedule', 'execute_monitor', 'check_daily_schedule', 'get_last_sheet_row', 'release_lock', 'verify_password'].includes(action);
  if (isWriteAction) {
    const inputPwd = e.parameter.pwd || "";
    const correctPwd = props.getProperty('OP_PASSWORD') || '1234'; 
    
    // 🛡️ I6: 密碼防暴力破解 (失敗 5 次鎖定 5 分鐘)
    const lockKey = 'TEST_LOGIN_LOCK_TIME';
    const failsKey = 'TEST_LOGIN_FAILS';
    const lockTime = parseInt(props.getProperty(lockKey) || "0", 10);
    const nowTime = new Date().getTime();
    if (nowTime < lockTime) {
      return ContentService.createTextOutput(JSON.stringify({status: "error", msg: "密碼錯誤次數過多，已鎖定，請 5 分鐘後再試。"})).setMimeType(ContentService.MimeType.JSON);
    }

    if (inputPwd !== correctPwd) {
      let fails = parseInt(props.getProperty(failsKey) || "0", 10) + 1;
      if (fails >= 5) {
        props.setProperty(lockKey, (nowTime + 5 * 60 * 1000).toString());
        props.setProperty(failsKey, "0");
      } else {
        props.setProperty(failsKey, fails.toString());
      }
      return ContentService.createTextOutput(JSON.stringify({status: "error", msg: "密碼錯誤，您沒有權限進行此操作！"})).setMimeType(ContentService.MimeType.JSON);
    } else {
      props.setProperty(failsKey, "0"); // 登入成功重置
    }
  }

  // 🔒 1.5 密碼快速驗證 ( action = verify_password ) 並自動佔用編輯鎖
  if (action === 'verify_password') {
      const modalType = e.parameter.modal_type || "";
      
      // 🌟 新增：伺服端鎖超時強制檢查 (3 分鐘 = 180000ms)
      const existingLockStr = callFirebase("editing_lock", null, "get").getContentText();
      const existingLock = safeJsonParse(existingLockStr, null);
      if (existingLock && existingLock.locked && (new Date().getTime() - existingLock.locked_at <= 180000)) {
        return ContentService.createTextOutput(JSON.stringify({status: "error", msg: "其他人正在編輯中，請稍後再試。"})).setMimeType(ContentService.MimeType.JSON);
      }

      callFirebase("editing_lock", {
        locked: true,
        locked_at: new Date().getTime(),
        modal_type: modalType
      }, "put");
      return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
  }

  // 🔒 新增：釋放編輯鎖 ( action = release_lock )
  if (action === 'release_lock') {
    callFirebase("editing_lock", {
      locked: false,
      locked_at: 0
    }, "put");
    return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
  }

  // 📝 1.6 船期手動更新與重置 ( action = update_schedule )
  if (action === 'update_schedule') {
    const reset = e.parameter.reset || "";
    if (reset === "true") {
      // 🌟 刪除整個 schedule_overrides 節點
      callFirebase("schedule_overrides", null, "delete");
      // 清空 UNFINISHED_SHIP 暫存
      props.deleteProperty('UNFINISHED_SHIP');
      props.deleteProperty('RESERVED_MISSION');
      updateFirebaseScheduleList();
      return ContentService.createTextOutput(JSON.stringify({status: "success", msg: "已成功重置為日曆預設船期！"})).setMimeType(ContentService.MimeType.JSON);
    }

    const scheduleDataStr = e.parameter.schedule;
    if (!scheduleDataStr) {
      return ContentService.createTextOutput(JSON.stringify({status: "error", msg: "缺少 schedule 參數"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    let list = [];
    try {
      list = JSON.parse(scheduleDataStr);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({status: "error", msg: "解析 schedule JSON 失敗: " + err.message})).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (!Array.isArray(list)) {
      return ContentService.createTextOutput(JSON.stringify({status: "error", msg: "schedule 必須是陣列"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 逐筆更新 overrides
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const shipName = (item.ship_name || "").trim();
      if (!shipName) continue;
      const key = sanitizeKey(shipName);
      
      // 新增或修改
      callFirebase(`schedule_overrides/${key}`, {
        d: item.d || "",
        ship_name: shipName,
        limit_speed: item.limit_speed ? Number(item.limit_speed) : 15.0,
        terminal: item.terminal || "",
        created_at: getTwDateStr(new Date(), "yyyy-MM-dd")
      }, "put");
    }
    
    // 🌟 需求 1.5: 儲存調整時，自動清空 UNFINISHED_SHIP 暫存
    props.deleteProperty('UNFINISHED_SHIP');
    
    // 🌟 新增：手動更新儲存後，主動執行 updateFirebaseScheduleList() 來進行排序並再次同步
    updateFirebaseScheduleList();
    
    // 🌟 核心修復：在 GAS 端自動釋放鎖定
    releaseEditingLock();
    
    return ContentService.createTextOutput(JSON.stringify({status: "success", msg: "船期調整已成功儲存！"})).setMimeType(ContentService.MimeType.JSON);
  }

  // 📡 1.7 手動執行監控爬軌 ( action = execute_monitor )
  if (action === 'execute_monitor') {
    executeMonitor();
    return ContentService.createTextOutput(JSON.stringify({status: "success", msg: "已成功手動執行 executeMonitor 爬軌任務！"})).setMimeType(ContentService.MimeType.JSON);
  }

  // 🌅 1.8 手動執行自動排程 ( action = check_daily_schedule )
  if (action === 'check_daily_schedule') {
    checkDailySchedule();
    return ContentService.createTextOutput(JSON.stringify({status: "success", msg: "已成功手動執行 checkDailySchedule 自動排程！"})).setMimeType(ContentService.MimeType.JSON);
  }

  // 📝 新增：手動觸發測試歸檔 (ToDo #9 測試工具，支援 sim_date 模擬日期)
  if (action === 'archive_test') {
    // 🌟 強制將測試環境的 FIREBASE_URL 指向 /test，並設置 SHIP_SCHEDULE_API_URL，防止污染正式環境並能正確下載船期
    props.setProperties({
      "FIREBASE_URL": "https://newlngship-default-rtdb.asia-southeast1.firebasedatabase.app/test",
      "SHIP_SCHEDULE_API_URL": "https://script.google.com/macros/s/AKfycbz55eDn5hQaRsYqGu0VPSQbvlTgVY6WPEc0hKe9OMeLNtzNhxtzwJbN_IAgk46-B7rh/exec?mode=api&port=%E5%8F%B0%E4%B8%AD",
      "SPREADSHEET_ID": "1829HCrinCxHYOUcgvlAGrsv2mH-bKwp3Rst90pzV3po"
    });
    
    // 🌟 動態設定/更新臨時的 Firebase 認證 Token，供當次及後續的 callFirebase 調用 (改用記憶體全域變數，防寫入 properties 過期)
    if (e.parameter.fb_token) {
      dynamicFbToken = e.parameter.fb_token;
    }
    
    try {
      const simDate = e.parameter.sim_date || null;
      archiveAndClearFirebase(simDate);
      props.deleteProperty('ARCHIVED_SHIPS_TODAY'); // 🌟 核心修正：清除今日已歸檔船隻快取，避免重複測試時船隻被過濾
      props.deleteProperty('UNFINISHED_SHIP'); // 🌟 清除無法進港暫存，防止歸檔後殘留
      
      // 🌟 新增：測試重置時，一併強制解除殘留的編輯鎖
      callFirebase("editing_lock", {
        locked: false,
        locked_at: 0
      }, "put");
      return ContentService.createTextOutput(JSON.stringify({
        status: "success", 
        msg: "歸檔已成功手動觸發，請前往測試紀錄表 (歸檔總表) 驗收 J 欄與 K 欄！"
      })).setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        msg: "測試歸檔執行失敗: " + err.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 📝 新增：讀取試算表最後一列數據 (自動測試驗證智慧延遲繼承機制用)
  if (action === 'get_last_sheet_row') {
    try {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName("歸檔總表");
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({status: "error", msg: "找不到歸檔總表分頁"})).setMimeType(ContentService.MimeType.JSON);
      }
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        return ContentService.createTextOutput(JSON.stringify({status: "success", row: []})).setMimeType(ContentService.MimeType.JSON);
      }
      
      // 讀取 A~L 欄 (1~12) 的值
      const values = sheet.getRange(lastRow, 1, 1, 12).getValues()[0];
      
      // 格式化 Date 為字串
      if (values[0] instanceof Date) {
        values[0] = Utilities.formatDate(values[0], "GMT+8", "yyyy-MM-dd");
      }
      if (values[3] instanceof Date) {
        values[3] = Utilities.formatDate(values[3], "GMT+8", "HH:mm");
      }
      
      return ContentService.createTextOutput(JSON.stringify({status: "success", row: values})).setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService.createTextOutput(JSON.stringify({status: "error", msg: err.toString()})).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 📝 2. 處理預約隔天監控
  if (action === 'reserve_next') {
    const mission = {
      ship_name: e.parameter.ship_name,
      limit_speed: e.parameter.limit_speed,
      terminal: e.parameter.terminal || "",
      reserved_at: new Date().getTime()
    };
    props.setProperty('RESERVED_MISSION', JSON.stringify(mission));
    
    // 🌟 更新 Firebase 上的船期表
    updateFirebaseScheduleList();
    
    return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
  }


  
  if (action === 'set_mode') {

    if (e.parameter.mode === 'start') {
      // 🟢 密碼正確，使用統一函式啟動
      const terminal = e.parameter.terminal || "";
      startMonitoring(e.parameter.ship_name, e.parameter.limit_speed, "false", terminal);
    } else { 
      // 🔴 手動結束監控邏輯
      const activeStatusRes = callFirebase("active_status", null, "get").getContentText();
      const activeStatus = safeJsonParse(activeStatusRes);
      const lastShipName = activeStatus.ship_name || "";
      const lastLimitSpeed = activeStatus.limit_speed || "";

      const manualPobTime = e.parameter.pob_time;
      const noEntryReason = e.parameter.no_entry_reason || "";
      
      if (manualPobTime && lastShipName) {
        processPobDirect(lastShipName, manualPobTime);
      } else if (noEntryReason && lastShipName) {
        const dateStr = getTwDateStr();
        const cardKey = `${dateStr}_${sanitizeKey(lastShipName)}`;
        const formattedMsg = `${lastShipName}無法進港，原因:${noEntryReason}`;
        
        // 瞬間寫入 Firebase 當日卡片的 pob_info
        callFirebase(`daily_records/${dateStr}/${cardKey}/pob_info`, {
          "no_entry_reason": noEntryReason,
          "formatted_msg": formattedMsg
        }, "patch");
        
        // 🌟 需求 1: 寫入 UNFINISHED_SHIP 指令碼屬性，以便出現在調整頁面第一列
        props.setProperty('UNFINISHED_SHIP', JSON.stringify({
          ship_name: lastShipName,
          limit_speed: lastLimitSpeed
        }));
        
        Utilities.sleep(1000);
        
        // 更新 Firebase 上的船期表
        updateFirebaseScheduleList();
        
        // 換班接力檢查
        if (!tryHandoffToNextShip("異常未進港")) {
          callFirebase("active_status", { "app_mode": "stop" }, "patch");
        }
      } else {
        callFirebase("active_status", { "app_mode": "stop" }, "patch"); 
        updateFirebaseScheduleList();
        
        // 🌟 換班接力檢查 (手動結束未填原因)
        tryHandoffToNextShip("手動無原因結束");
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
      
      // 🌟 核心修復：在 GAS 端自動釋放鎖定，避免前端 concurrent fetch 被丟棄
      releaseEditingLock();

      return ContentService.createTextOutput(JSON.stringify({
        status: "success", 
        has_tomorrow_ship: hasTomorrowShip,
        last_ship_name: lastShipName,
        last_limit_speed: lastLimitSpeed
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 回傳成功訊息 (給啟動模式)
    
    // 🌟 核心修復：在 GAS 端自動釋放鎖定，避免前端 concurrent fetch 被丟棄
    releaseEditingLock();
    
    return ContentService.createTextOutput(JSON.stringify({status: "success"})).setMimeType(ContentService.MimeType.JSON);
  }

  // 🟢 顯示畫面邏輯 (不變)
  // 💡 自動冷卻同步機制：如果距離上一次從日曆 API 同步船期超過 5 分鐘，則自動觸發一次同步
  const nowTime = new Date().getTime();
  const lastSyncStr = props.getProperty('LAST_SCHEDULE_SYNC_TIME') || "0";
  const lastSync = parseInt(lastSyncStr, 10);
  if (nowTime - lastSync > 300000) { // 5 分鐘冷卻 (300,000 毫秒)
    try {
      updateFirebaseScheduleList();
      props.setProperty('LAST_SCHEDULE_SYNC_TIME', nowTime.toString());
      console.log("📅 已自動觸發日曆船期表背景同步！");
    } catch(e) {
      console.error("📅 背景自動同步日曆船期失敗: " + e.message);
    }
  }

  const activeStatusRes = callFirebase("active_status", null, "get").getContentText();
  const activeStatus = safeJsonParse(activeStatusRes);
  activeStatus.seasonTime = getTodaySeasonTime();
  const scheduleRes = callFirebase("schedule_list", null, "get").getContentText();
  activeStatus.schedule_list = safeJsonParse(scheduleRes, []);
  return ContentService.createTextOutput(JSON.stringify(activeStatus)).setMimeType(ContentService.MimeType.JSON);
}

function fetchWindData() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("cached_wind_data");
  if (cached) {
    console.log("💨 使用快取之風速資料");
    return safeJsonParse(cached, { valid: false });
  }

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
      const result = { valid: true, speed: Math.round(parseFloat(speedMatch[1]) * 10) / 10, time: cells[20] };
      cache.put("cached_wind_data", JSON.stringify(result), 35); // 快取 35 秒
      return result;
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
  const twDateStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd");
  const twParts = twDateStr.split('/');
  const today = new Date(parseInt(twParts[0], 10), parseInt(twParts[1], 10) - 1, parseInt(twParts[2], 10));
  
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const todayM_D = Utilities.formatDate(now, "GMT+8", "M/d");
  const tomorrowM_D = Utilities.formatDate(tomorrow, "GMT+8", "M/d");
  const dateStr = getTwDateStr(now);
  
  let mappedList = [];
  
  // 1. 抓取日曆 API 基礎船期 (移除 5 分鐘快取限制，因為只在狀態改變或觸發器執行時才會抓取)
  let apiDataRaw = "";
  if (SHIP_SCHEDULE_API_URL) {
    try {
      const resp = UrlFetchApp.fetch(SHIP_SCHEDULE_API_URL, { muteHttpExceptions: true });
      if (resp.getResponseCode() === 200) {
        apiDataRaw = resp.getContentText();
      } else {
        console.warn("抓取日曆 API 非 200 狀態: " + resp.getResponseCode());
      }
    } catch (e) {
      console.error("抓取日曆 API 失敗: " + e);
    }
  }
  
  if (apiDataRaw) {
    const apiData = safeJsonParse(apiDataRaw, { data: [] }).data || [];
    
    // 過濾出「今天起」未來的船期
    let futureApiData = apiData.filter(item => {
       const parts = item.d.split('/');
       if (parts.length < 2) return false;
       let m = parseInt(parts[0], 10);
       let d = parseInt(parts[1], 10);
       let itemDate = new Date(today.getFullYear(), m - 1, d);
       // 跨年處理
       if (today.getMonth() > 8 && m < 3) itemDate.setFullYear(today.getFullYear() + 1);
       if (today.getMonth() < 3 && m > 8) itemDate.setFullYear(today.getFullYear() - 1);
       return itemDate >= today;
    });

    mappedList = futureApiData.map(item => {
      const nameMatch = item.n.match(/^(.*?)\((.*?)\)/);
      const shipName = nameMatch ? nameMatch[1].trim() : item.n.trim();
      const limitSpeed = SHIP_TYPE_MAPPING[nameMatch ? nameMatch[2].trim() : ""] || 15.0; 
      return { d: item.d, ship_name: shipName, limit_speed: limitSpeed, terminal: item.t || "" };
    });
  }

  // 2. 讀取手動覆蓋層 (schedule_overrides)
  let overridesMap = {};
  try {
    const overridesRes = callFirebase("schedule_overrides", null, "get").getContentText();
    overridesMap = safeJsonParse(overridesRes, {});
    if (!overridesMap || typeof overridesMap !== 'object') overridesMap = {};
  } catch(e) {
    console.error("讀取 schedule_overrides 失敗: " + e);
  }

  // 3. 自動清除過期覆蓋，並將有效的 override 套用到 mappedList 中
  for (const key of Object.keys(overridesMap)) {
    const ov = overridesMap[key];
    if (ov && ov.d) {
      const parts = ov.d.split('/');
      if (parts.length >= 2) {
        let m = parseInt(parts[0], 10);
        let d = parseInt(parts[1], 10);
        let ovDate = new Date(today.getFullYear(), m - 1, d);
        // 跨年處理
        if (today.getMonth() > 8 && m < 3) ovDate.setFullYear(today.getFullYear() + 1);
        if (today.getMonth() < 3 && m > 8) ovDate.setFullYear(today.getFullYear() - 1);
        
        if (ovDate < today) {
          // 已過期，自 Firebase 與本機變數中刪除
          delete overridesMap[key];
          try {
            callFirebase(`schedule_overrides/${key}`, null, "delete");
          } catch(err) {
            console.error(`刪除過期 override 失敗 [${key}]: ` + err.message);
          }
        }
      }
    }
  }

  // 4. 合併：將剩餘有效的 overrides 疊加到 mappedList
  let filteredList = [...mappedList];
  for (const [key, ov] of Object.entries(overridesMap)) {
    if (!ov) continue;
    const targetIdx = filteredList.findIndex(item => sanitizeKey(item.ship_name) === key);
    const cleanedOv = {
      d: ov.d || "",
      ship_name: ov.ship_name || "",
      limit_speed: ov.limit_speed ? Number(ov.limit_speed) : 15.0,
      terminal: ov.terminal || ""
    };
    if (targetIdx >= 0) {
      // 覆蓋已有項目
      filteredList[targetIdx] = { ...filteredList[targetIdx], ...cleanedOv };
    } else {
      // 手動新增船
      filteredList.push(cleanedOv);
    }
  }
  mappedList = filteredList;

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
  // 先取得今日所有記錄的 key
  let todayKeys = [];
  let records = null;
  try {
     const recordsRes = callFirebase(`daily_records/${dateStr}`, null, "get").getContentText();
     records = safeJsonParse(recordsRes, null);
     if (records) todayKeys = Object.keys(records);
  } catch(e) {}

  // 🔄 改為從後往前遍歷，避免 splice 影響索引，且無懼排序是否正確
  for (let i = mappedList.length - 1; i >= 0; i--) {
     const ship = mappedList[i];
     
     // 只要日期是今天，就檢查是否 POB
     if (ship.d === todayM_D) {
         // 若該船今日已歸檔，直接剔除
         if (archivedShips.includes(ship.ship_name)) {
            mappedList.splice(i, 1);
            continue;
         }

         const sanitizedShip = sanitizeKey(ship.ship_name);
         const actualCardKey = todayKeys.find(k => {
             const firstUnderscore = k.indexOf('_');
             return firstUnderscore > -1 && k.substring(firstUnderscore + 1) === sanitizedShip;
         }) || `${dateStr}_${sanitizedShip}`;

         try {
            const pobInfo = records && records[actualCardKey] ? records[actualCardKey].pob_info : null;
            // 若找到 pob_time 代表已進港，將其從清單中移除
            if (pobInfo && pobInfo.pob_time) {
                mappedList.splice(i, 1);
            }
         } catch(e) {}
     }
  }

  // 3. 處理 UNFINISHED_SHIP (無法進港且日期空白的船，預約 RESERVED_MISSION 功能取消)
  const unfinishedRaw = props.getProperty('UNFINISHED_SHIP');
  if (unfinishedRaw) {
     const unfinished = safeJsonParse(unfinishedRaw, null);
     if (unfinished) {
        // 若清單已有該船名(可能為舊資料)，先篩選掉防重複
        mappedList = mappedList.filter(item => item.ship_name !== unfinished.ship_name);
        // 將無法進港任務強制塞入且日期為空 (d: "")
        mappedList.unshift({ d: "", ship_name: unfinished.ship_name, limit_speed: Number(unfinished.limit_speed) });
     }
  }
  
  // 💡 4. 排序邏輯：優先依日期升序，同日期 W12 碼頭船隻優先
  mappedList.sort((a, b) => {
    // 讓日期為空的 (如 UNFINISHED_SHIP) 永遠排在最前面
    if (a.d === "" && b.d !== "") return -1;
    if (b.d === "" && a.d !== "") return 1;
    if (a.d === "" && b.d === "") return 0;
    
    // 解析 M/D 格式的日期
    function parseDateMD(dStr) {
      const parts = dStr.split('/');
      const m = parseInt(parts[0], 10);
      const d = parseInt(parts[1], 10);
      const year = new Date().getFullYear();
      return new Date(year, m - 1, d);
    }
    
    const dateA = parseDateMD(a.d);
    const dateB = parseDateMD(b.d);
    const timeDiff = dateA.getTime() - dateB.getTime();
    if (timeDiff !== 0) return timeDiff;
    
    // 同日期多船時，W12 優先
    const aIsW12 = (a.terminal === "W12");
    const bIsW12 = (b.terminal === "W12");
    if (aIsW12 && !bIsW12) return -1;
    if (!aIsW12 && bIsW12) return 1;
    return 0;
  });
  
  // 回傳前 10 筆給前端
  return mappedList.slice(0, 10);
}

// ==========================================
// 8. 🌐 App 端 POST 接口 (處理超長表單資料)
// ==========================================

// ==========================================
// 9. 🔄 換班接力共用函式 (I3)
// ==========================================
function tryHandoffToNextShip(reasonContext) {
  const currentList = getScheduleList();
  const todayM_D = `${new Date().getMonth() + 1}/${new Date().getDate()}`;
  const todayShips = currentList.filter(item => item.d === todayM_D);
  
  todayShips.sort((a, b) => {
    const aIsW12 = (a.terminal === "W12");
    const bIsW12 = (b.terminal === "W12");
    if (aIsW12 && !bIsW12) return -1;
    if (!aIsW12 && bIsW12) return 1;
    return 0;
  });
  
  if (todayShips.length > 0) {
    const nextShip = todayShips[0];
    console.log(`🔄 換班接力(${reasonContext})：今日還有下一艘船 [${nextShip.ship_name}]，自動啟動監控。`);
    startMonitoring(nextShip.ship_name, nextShip.limit_speed, "true", nextShip.terminal || "");
    return true;
  } else {
    console.log("⏹️ 今日所有船隻皆已監控/處理完畢。");
    return false;
  }
}

// 系統初始化觸發器
function setupSystemTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  
  ScriptApp.newTrigger("checkDailySchedule").timeBased().atHour(4).everyDays(1).create();
  ScriptApp.newTrigger("executeMonitor").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("archiveAndClearFirebase").timeBased().atHour(23).everyDays(1).create();
}

function updateFirebaseScheduleList() {
  try {
    const list = getScheduleList();
    if (!list || list.length === 0) {
      console.warn("⚠️ [Fail-Safe] 取得之船期表為空，放棄覆蓋 Firebase schedule_list，保護既有資料！");
      return;
    }
    const res = callFirebase("schedule_list", list, "put");
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(`Firebase write failed with status ${code}: ${res.getContentText()}`);
    }
    console.log("✅ 成功更新 Firebase 船期表資料，筆數: " + list.length);
  } catch (e) {
    console.error("❌ 更新 Firebase 船期表資料失敗: " + e.message);
    throw e;
  }
}

// 🌟 新增：日曆變更時的觸發器
function onCalendarOrSheetChange() {
  ensureTestEnvironment(); // 🌟 確保觸發時先載入/校正測試環境屬性，並清除殘留過期 Token
  console.log("📅 偵測到內容變更，啟動同步...");
  updateFirebaseScheduleList();
}



// ==========================================
// 7. 🛠️ 手動修正最後一列 H, I 欄 JSON 資料
// ==========================================
function fixLastRowJson() {
  if (!SPREADSHEET_ID) {
    console.error("❌ 未設定 SPREADSHEET_ID");
    return;
  }
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("歸檔總表");
    if (!sheet) {
      console.error("❌ 找不到 歸檔總表 分頁");
      return;
    }
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      console.log("⚠️ 歸檔總表為空或僅包含標題列");
      return;
    }
    
    // 取得最後一列的日期 (欄 A)
    const dateVal = sheet.getRange(lastRow, 1).getValue();
    let dateStr = "";
    if (dateVal instanceof Date) {
      dateStr = Utilities.formatDate(dateVal, "GMT+8", "yyyy-MM-dd");
    } else {
      dateStr = String(dateVal).trim().replace(/\//g, "-");
    }
    
    console.log(`🔍 正在修正最後一列 (Row ${lastRow})，日期: ${dateStr}`);
    
    // 抓取 GitHub Pages 上的風速預測資料
    const url = "https://uuuhasho.github.io/wind-monitor-app/data.json?t=" + new Date().getTime();
    const response = UrlFetchApp.fetch(url);
    const dataArr = JSON.parse(response.getContentText());
    
    const cpcLogs = {};
    const omLogs = {};
    
    dataArr.forEach(d => {
      if (d.timestamp && d.timestamp.indexOf(dateStr) === 0) {
        const timeKey = d.timestamp.substring(11, 16); // 提取 "HH:mm"
        if (d.cpc_wind_speed !== null && d.cpc_wind_speed !== undefined) {
          cpcLogs[timeKey] = d.cpc_wind_speed;
        }
        if (d.open_meteo_wind_speed !== null && d.open_meteo_wind_speed !== undefined) {
          omLogs[timeKey] = d.open_meteo_wind_speed;
        }
      }
    });
    
    const cpcJsonStr = JSON.stringify(cpcLogs);
    const omJsonStr = JSON.stringify(omLogs);
    
    // 寫入 K 欄 (11) 與 L 欄 (12)
    sheet.getRange(lastRow, 11).setValue(cpcJsonStr);
    sheet.getRange(lastRow, 12).setValue(omJsonStr);
    
    console.log("✅ 成功修正 K 欄 (空軍預測風力): " + cpcJsonStr);
    console.log("✅ 成功修正 L 欄 (ECMWF預測陣風): " + omJsonStr);
  } catch (e) {
    console.error("❌ 執行手動修正失敗: " + e);
  }
}

function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    "FIREBASE_URL": "https://newlngship-default-rtdb.asia-southeast1.firebasedatabase.app/test",
    "FIREBASE_SECRET": "",
    "SPREADSHEET_ID": "1829HCrinCxHYOUcgvlAGrsv2mH-bKwp3Rst90pzV3po",
    "OP_PASSWORD": "",
    "TARGET_URL": "https://wwtf.twport.com.tw/twport/display/Realtime_Panel_Port_GatData_2024.aspx?3",
    "STATION_NAME": "北堤綠燈塔"
  });
  
  // 💡 為了強迫 Google Apps Script 偵測到本專案需要「讀寫 Google Sheets」與「發送網路請求」權限，
  // 並在使用者手動執行 setupProperties 時彈出授權視窗，我們加入此主動存取測試代碼：
  try {
    const ss = SpreadsheetApp.openById("1829HCrinCxHYOUcgvlAGrsv2mH-bKwp3Rst90pzV3po");
    console.log("📊 成功連結測試試算表，標題為：" + ss.getName());
    const testFetch = UrlFetchApp.fetch("https://www.google.com", {muteHttpExceptions: true});
    console.log("🌐 成功驗證網路請求權限，狀態碼：" + testFetch.getResponseCode());
  } catch (e) {
    console.warn("ℹ️ 授權初始化提示: " + e.message);
  }
}