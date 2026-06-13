// =================================================================
// 2026-05-06 v1.5版 by Bill-Tsai
// *1.可上傳跨月船期表，如4/29~5/30，不受限於當月1號~月底
// 2.新增船名對應的備註在雲端硬碟試算表，會自動顯示在app上，不用每次都輸入
// 3.C#直接抓取日曆上的船期，UI+API雙模式
// =================================================================
// ==============================================
// ⚙️ 設定區
// ==============================================
const SCRIPT_PROPS = PropertiesService.getScriptProperties();

const PORT_CONFIG = {
  '台中': SCRIPT_PROPS.getProperty('CALENDAR_ID_TAICHUNG'), 
  '觀塘': SCRIPT_PROPS.getProperty('CALENDAR_ID_KWUN_TONG'),
  '永安': SCRIPT_PROPS.getProperty('CALENDAR_ID_YUNGAN')
};

const DB_SHEET_ID = SCRIPT_PROPS.getProperty('DB_SHEET_ID'); 

const GLOBAL_CONFIG = {
  EVENT_COLOR: '7', // 青色
  EVENT_MARK: 'GAS自動建立', // 識別證
  LOCK_TIMEOUT: 30000 // 鎖定等待時間 (30秒)
};

// ==========================================
// Web App 進入點
// ==========================================
function doGet(e) {
  // 判斷是否為 API 模式
  if (e.parameter && e.parameter.mode === 'api') {
    return handleApiRequest(e);
  }

  // 否則回傳網頁介面
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('🛳️ 船期日曆更新工具')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ==========================================
// ★ API 處理核心 (V3: 優先使用 "-" 切割，相容舊格式)
// ==========================================
function handleApiRequest(e) {
  try {
    const port = e.parameter.port; 
    
    // 1. 驗證參數
    if (!port || !PORT_CONFIG[port]) {
      return createJsonResponse({ error: '無效的港口名稱' });
    }

    const calendarId = PORT_CONFIG[port];
    const calendar = CalendarApp.getCalendarById(calendarId);
    
    // 2. 設定搜尋範圍：115/3/15 修改，起始日為今日往前15天，結束日為今日往後15天
    const now = new Date();
    //const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    //const endDate = new Date(now);
    //endDate.setDate(now.getDate() + 90); 
    
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 15);
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 15);
    
    const events = calendar.getEvents(startDate, endDate);
    const resultList = [];
    
    // 3. 過濾與格式化
    events.forEach(evt => {
      if (!evt.isAllDayEvent()) return;
      
      const desc = evt.getDescription() || "";
      const title = evt.getTitle() || ""; 
      
      // 條件：說明有 "GAS"
      if (desc.includes("GAS")) {
        
        let shipNameOnly = title;

        // ★ 切割邏輯：優先找「減號 -」
        const hyphenIndex = title.lastIndexOf('-');
        
        if (hyphenIndex > 0) {
           // 有減號 (新格式) -> 取 "-" 前面的部分
           shipNameOnly = title.substring(0, hyphenIndex).trim();
        } 
        else {
           // 沒減號 (舊格式相容) -> 找括號
           let closeParenIndex = title.lastIndexOf(')');
           if (closeParenIndex === -1) closeParenIndex = title.lastIndexOf('）');

           if (closeParenIndex > 0) {
              shipNameOnly = title.substring(0, closeParenIndex + 1).trim();
           } else {
              // 沒減號也沒括號 -> 保留全名
              shipNameOnly = title.trim();
           }
        }

        // 格式化日期 M/D
        const dateObj = evt.getAllDayStartDate();
        const month = dateObj.getMonth() + 1; 
        const day = dateObj.getDate();
        const dateMD = `${month}/${day}`; 

        resultList.push({
          d: dateMD,       
          n: shipNameOnly  
        });
      }
    });

    return createJsonResponse({ 
      success: true, 
      count: resultList.length,
      data: resultList 
    });

  } catch (err) {
    return createJsonResponse({ success: false, error: err.message });
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 資料庫邏輯
// ==========================================
function fetchShipDatabase() {
  const dbMap = new Map();
  if (!DB_SHEET_ID) return dbMap;
  try {
    const sheet = SpreadsheetApp.openById(DB_SHEET_ID).getSheets()[0];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return dbMap;
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues(); 
    data.forEach(row => {
      if (row[0]) dbMap.set(cleanText(row[0].toString()), cleanText(row[1] ? row[1].toString() : ''));
    });
  } catch (e) { console.error('讀取DB失敗', e); }
  return dbMap;
}

function updateShipDatabase(newEntries) {
  if (!DB_SHEET_ID) return;
  try {
    const sheet = SpreadsheetApp.openById(DB_SHEET_ID).getSheets()[0];
    const lastRow = sheet.getLastRow();
    let existingData = [];
    const shipIndexMap = new Map();
    
    if (lastRow >= 2) {
      existingData = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      existingData.forEach((row, idx) => {
        shipIndexMap.set(cleanText(row[0].toString()), idx);
      });
    }

    const rowsToAdd = [];
    const processedShips = new Set();
    let isExistingDataModified = false;

    newEntries.forEach(entry => {
      const ship = cleanText(entry.shipName);
      const remark = cleanText(entry.remark);
      if (!ship || processedShips.has(ship)) return;

      if (shipIndexMap.has(ship)) {
        const idx = shipIndexMap.get(ship);
        const currentRemark = existingData[idx][1];
        if (remark !== '' && remark !== currentRemark) {
           existingData[idx][1] = remark;
           isExistingDataModified = true;
        }
      } else {
        rowsToAdd.push([ship, remark]);
        shipIndexMap.set(ship, -1); 
      }
      processedShips.add(ship);
    });

    if (isExistingDataModified) {
      sheet.getRange(2, 1, existingData.length, 2).setValues(existingData);
    }

    if (rowsToAdd.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 2).setValues(rowsToAdd);
    }
  } catch (e) { console.error('更新DB失敗', e); }
}

// ==========================================
// 階段一：解析 Word
// ==========================================
function parseWordFile(data, filename, targetPort) {
  try {
    const shipDb = fetchShipDatabase();
    
    const decoded = Utilities.base64Decode(data);
    const blob = Utilities.newBlob(decoded, MimeType.MICROSOFT_WORD, filename);
    const resource = { title: '[TEMP] ' + filename, mimeType: MimeType.GOOGLE_DOCS };
    const tempFile = Drive.Files.insert(resource, blob, {convert: true});
    const docId = tempFile.id;
    const doc = DocumentApp.openById(docId);
    const tables = doc.getBody().getTables();
    
    if (tables.length < 2) {
      Drive.Files.remove(docId);
      return { success: false, message: '❌ 格式錯誤：找不到第二張表格' };
    }

    const table = tables[1];
    const numRows = table.getNumRows();
    const parsedData = [];

    for (let i = 1; i < numRows; i++) {
      const row = table.getRow(i);
      if (row.getNumCells() < 6) continue;

      let portText = cleanText(row.getCell(4).getText()); 
      
      if (portText.includes(targetPort)) {
        let dateText = cleanText(row.getCell(2).getText());
        let shipName = cleanText(row.getCell(3).getText());
        let cargo = cleanText(row.getCell(5).getText());
        
        let ghv = "";
        if (row.getNumCells() > 6) {
           ghv = cleanText(row.getCell(6).getText());
        }

        const dateObj = parseDate(dateText);
        
        if (dateObj) {
          const autoRemark = shipDb.get(shipName) || '';
          parsedData.push({
            dateRoc: toRocDateString(dateObj), 
            shipName: shipName,
            remark: autoRemark,
            cargo: cargo,
            ghv: ghv
          });
        }
      }
    }

    Drive.Files.remove(docId);
    
    if (parsedData.length === 0) {
      return { success: false, message: `⚠️ 找不到「${targetPort}」的資料。` };
    }
    return { success: true, data: parsedData };

  } catch (e) {
    return { success: false, message: '❌ 解析失敗: ' + e.message };
  }
}

// ==========================================
// 階段二：更新日曆 (★ 修改重點：貨源前加 "-")
// ==========================================
function updateCalendarFromList(eventsList, targetPort) {
  const lock = LockService.getScriptLock();
  try {
    const success = lock.tryLock(GLOBAL_CONFIG.LOCK_TIMEOUT);
    if (!success) {
      return { success: false, message: '⚠️ 系統忙碌中，請稍後再試' };
    }

    const calendarId = PORT_CONFIG[targetPort];
    if (!calendarId) return { success: false, message: `❌ 未設定「${targetPort}」日曆 ID` };

    const calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) return { success: false, message: `❌ 找不到日曆 (${targetPort})` };

    // 1. 更新資料庫
    updateShipDatabase(eventsList);

    // 2. 資料準備
    const timeZone = Session.getScriptTimeZone();
    const processList = eventsList.map(item => {
      const eventDate = parseRocDateString(item.dateRoc);
      
      let fullTitle = item.shipName;
      if (item.remark && item.remark.trim() !== '') fullTitle += `(${item.remark})`;
      
      // ★★★ 修改處：貨源前自動加上 "-" (如果貨源存在) ★★★
      if (item.cargo && item.cargo.trim() !== '') {
         fullTitle += `-${item.cargo}`; // 原本是空格，現在改為減號
      }

      // 標準化指紋
      const dateStr = Utilities.formatDate(eventDate, timeZone, 'yyyy/MM/dd');
      const normalizedFingerprint = normalizeString(dateStr + "_" + fullTitle);

      return {
        dateObj: eventDate,
        dateStr: dateStr,
        title: fullTitle,
        fingerprint: normalizedFingerprint
      };
    });

    // 3. 智慧比對
    let minDate = processList[0].dateObj;
    let maxDate = processList[0].dateObj;
    processList.forEach(item => {
      if (item.dateObj < minDate) minDate = item.dateObj;
      if (item.dateObj > maxDate) maxDate = item.dateObj;
    });

    const searchStart = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate() - 1);
    const searchEnd = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate() + 1, 23, 59, 59);

    const oldEvents = calendar.getEvents(searchStart, searchEnd);
    const candidatesMap = new Map();

    oldEvents.forEach(e => {
      if (!e.isAllDayEvent()) return; 

      const desc = e.getDescription() || "";
      const title = e.getTitle() || "";
      
      if (desc.includes("GAS")) {
        const eDateStr = Utilities.formatDate(e.getAllDayStartDate(), timeZone, 'yyyy/MM/dd');
        const eFingerprint = normalizeString(eDateStr + "_" + title);
        candidatesMap.set(eFingerprint, e);
      }
    });

    processList.forEach(newItem => {
      if (candidatesMap.has(newItem.fingerprint)) {
        candidatesMap.delete(newItem.fingerprint);
      } else {
        const e = calendar.createAllDayEvent(newItem.title, newItem.dateObj, { description: GLOBAL_CONFIG.EVENT_MARK });
        e.setColor(GLOBAL_CONFIG.EVENT_COLOR);
      }
    });

    candidatesMap.forEach((eventToDelete) => {
      try { eventToDelete.deleteEvent(); } catch(err) { console.log("刪除失敗", err); }
    });

    return { 
      success: true, 
      message: `✅ 【${targetPort}】更新完成！` 
    };

  } catch (e) {
    return { success: false, message: '❌ 處理失敗: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 工具函式
// ==========================================
function cleanText(text) {
  if (!text) return '';
  return text.replace(/\*/g, '').replace(/\u0007/g, '').trim();
}

function normalizeString(str) {
  if (!str) return "";
  let tmp = str.replace(/\s+/g, '');
  tmp = tmp.replace(/[\uff01-\uff5e]/g, function(ch) { 
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); 
  });
  tmp = tmp.replace(/\u3000/g, '');
  return tmp;
}

function parseDate(dateStr) {
  dateStr = dateStr.split('(')[0].trim(); 
  const parts = dateStr.split('/');
  if (parts.length < 2) return null;
  let month = parseInt(parts[0], 10);
  let day = parseInt(parts[1], 10);
  if (isNaN(month) || isNaN(day)) return null;
  const now = new Date();
  let year = now.getFullYear();
  if (now.getMonth() > 8 && month < 3) year++; 
  return new Date(year, month - 1, day);
}

function toRocDateString(date) {
  const rocYear = date.getFullYear() - 1911;
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  return `${rocYear}/${month}/${day}`;
}

function parseRocDateString(rocStr) {
  const parts = rocStr.split('/'); 
  if (parts.length !== 3) return new Date();
  const year = parseInt(parts[0], 10) + 1911;
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return new Date(year, month, day);
}