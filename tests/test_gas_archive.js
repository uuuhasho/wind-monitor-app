const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const crypto = require("crypto");

function createSheet(name) {
  const rows = [];
  return {
    name,
    rows,
    getLastRow: () => rows.length,
    appendRow: row => rows.push(row),
    getRange(row, column, count = 1, width = 1) {
      return {
        getValue: () => (rows[row - 1] || [])[column - 1],
        setValue: value => { (rows[row - 1] ||= [])[column - 1] = value; },
        getValues: () => Array.from({length: count}, (_, index) =>
          Array.from({length: width}, (_, colIdx) => (rows[row - 1 + index] || [])[column - 1 + colIdx])),
      };
    },
  };
}

function createHarness({records, extraDb = {}, extraProps = {}, schedule = [], failDeleteOnce = false, failMoveOnce = false, fetchHook, externalFetchHook, sheetHook, flushHook, lockBusy = false, opPassword = "test", stubSchedule = true}) {
  const db = {daily_records: records, forecast_data: [{timestamp: "2026-10-26T08:00:00+08:00", cpc_wind_speed: 5, open_meteo_wind_speed: 7}], ...extraDb};
  const props = new Map([
    ["FIREBASE_URL", "https://example.test/formal"], ["SPREADSHEET_ID", "sheet"],
    ...Object.entries(extraProps),
  ]);
  if (opPassword !== null) props.set("OP_PASSWORD", opPassword);
  const sheets = new Map();
  const calls = [];
  let deleteFailed = failDeleteOnce;
  let moveFailed = failMoveOnce;
  const getAt = path => path.split("/").reduce((value, part) => value == null ? null : value[part], db);
  const putAt = (path, value) => {
    const parts = path.split("/"); let target = db;
    parts.slice(0, -1).forEach(part => target = target[part] ||= {});
    if (value === null) delete target[parts.at(-1)]; else target[parts.at(-1)] = value;
  };
  const response = (code, body, etag = "etag") => ({
    getResponseCode: () => code,
    getContentText: () => JSON.stringify(body),
    getAllHeaders: () => ({ETag: etag}),
  });
  const context = {
    console, JSON, Date, Math, Object, Array, String, Number, Error, RegExp,
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => props.get(key) || "",
      setProperty: (key, value) => props.set(key, value),
      setProperties: values => Object.entries(values).forEach(([key, value]) => props.set(key, value)),
      deleteProperty: key => props.delete(key),
    })},
    LockService: {getScriptLock: () => ({tryLock: () => !lockBusy, releaseLock: () => {}})},
    Utilities: {
      formatDate: (date, _tz, pattern) => {
        const iso = new Date(date.getTime() + 8 * 3600000).toISOString();
        if (pattern === "HH:mm") return iso.slice(11, 16);
        if (pattern === "yyyy/MM/dd") return iso.slice(0, 10).replace(/-/g, "/");
        if (pattern === "M/d") return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
        return iso.slice(0, 10);
      },
      DigestAlgorithm: {SHA_256: "sha256"},
      computeDigest: (_algorithm, value) => [...crypto.createHash("sha256").update(value).digest()],
      sleep: () => {},
    },
    ContentService: {MimeType: {JSON: "application/json"}, createTextOutput: text => ({
      text, setMimeType() { return this; },
    })},
    SpreadsheetApp: {flush: () => { if (flushHook) flushHook(); }, openById: () => ({
      getSheetByName: name => sheets.get(name) || null,
      insertSheet: name => { const sheet = createSheet(name); if (sheetHook) sheetHook(sheet); sheets.set(name, sheet); return sheet; },
    })},
    UrlFetchApp: {fetch: (url, options = {}) => {
      if (externalFetchHook && !url.includes("/formal/")) {
        return externalFetchHook(url, options);
      }
      const path = decodeURIComponent(url.match(/\/formal\/(.*)\.json/)[1]).split("?")[0];
      const method = (options.method || "GET").toUpperCase();
      calls.push({path, method, headers: options.headers || {}});
      const hookResponse = fetchHook && fetchHook({path, method, db, putAt, response});
      if (hookResponse) return hookResponse;
      const current = getAt(path);
      const etag = crypto.createHash("sha256").update(JSON.stringify(current ?? null)).digest("hex");
      if (method === "GET") return response(200, current ?? null, etag);
      if (options.headers && options.headers["if-match"] && options.headers["if-match"] !== etag) return response(412, {});
      if (method === "DELETE" && deleteFailed && path === "daily_records/2026-10-26/ship_a") {
        deleteFailed = false; return response(500, {error: "temporary"});
      }
      if (method === "PUT" && moveFailed && path.startsWith("daily_records/")) {
        moveFailed = false; return response(500, {error: "temporary"});
      }
      const payload = options.payload == null ? null : JSON.parse(options.payload);
      if (method === "PATCH") putAt(path, Object.assign({}, current || {}, payload)); else putAt(path, payload);
      return response(200, payload);
    }},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../gas/monitor.js"), "utf8"), context);
  context.ensureFirebaseEnvironment = () => {};
  if (stubSchedule) {
    context.getScheduleList = () => schedule;
    context.updateFirebaseScheduleList = () => {};
  }
  return {context, db, sheets, calls, props};
}

function normalCard() {
  return {config: {ship_name: "A", limit_speed: 13.8}, pob_info: {pob_time: "10:00", pob_wind_speed: 4}, wind_logs: {"上午 09:50": 3}};
}

{
  const test = createHarness({records: {"2026-10-26": {ship_a: normalCard()}}, failDeleteOnce: true});
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.ok(test.db.daily_records["2026-10-26"].ship_a, "failed delete retains source card");
  assert.equal(test.sheets.get("歸檔總表").rows.length, 2, "first attempt creates one archive row");
  test.context.archiveAndClearFirebase("2026-10-26");
  assert.equal(test.db.daily_records["2026-10-26"].ship_a, undefined, "retry deletes the unchanged source");
  assert.equal(test.sheets.get("歸檔總表").rows.length, 2, "retry does not duplicate archive row");
  assert.ok(test.calls.some(call => call.path === "daily_records/2026-10-26/ship_a" && call.method === "DELETE" && call.headers["if-match"]), "source deletion uses ETag");
}

{
  const card = {config: {ship_name: "B", limit_speed: 12}, pob_info: {no_entry_reason: "wind"}, wind_logs: {"上午 09:50": 3}};
  const test = createHarness({
    records: {"2026-10-26": {ship_b: card}},
    schedule: [{ship_name: "B", d: "10/27"}],
    failMoveOnce: true,
  });
  assert.equal(test.context.rescheduledDate("10/27", new Date("2026-10-26T12:00:00Z")), "2026-10-27");
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.ok(test.db.daily_records["2026-10-26"].ship_b, "failed migration retains source card");
  test.context.archiveAndClearFirebase("2026-10-26");
  assert.equal(test.db.daily_records["2026-10-26"].ship_b, undefined, "successful retry deletes migrated source");
  const destination = Object.entries(test.db.daily_records).find(([date, cards]) => cards[`${date}_B`]);
  assert.equal(destination[1][`${destination[0]}_B`].config.migration_source.includes("ship_b"), true);
}

{
  let changed = false;
  const card = {config: {ship_name: "B", limit_speed: 12}, pob_info: {no_entry_reason: "wind"}, wind_logs: {"上午 09:50": 3}};
  const test = createHarness({
    records: {"2026-10-26": {ship_b: card}},
    schedule: [{ship_name: "B", d: "10/27"}],
    fetchHook({path, method, db}) {
      if (method === "DELETE" && path === "daily_records/2026-10-26/ship_b" && !changed) {
        changed = true;
        db.daily_records["2026-10-26"].ship_b.wind_logs["上午 10:00"] = 6;
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  test.context.archiveAndClearFirebase("2026-10-26");
  assert.equal(test.db.daily_records["2026-10-26"].ship_b, undefined, "wind-log retry deletes the retained source");
  assert.equal(Object.keys(test.db.daily_records["2026-10-27"]).length, 1, "wind-log retry does not create another target");
  const rows = test.sheets.get("歸檔總表").rows;
  assert.equal(rows.length, 2, "wind-log retry keeps one archive row");
  assert.equal(rows[1][9], JSON.stringify({"09:50": 3, "10:00": 6}), "wind-log retry refreshes the archive row");
}

{
  let deleteFailed = false;
  const card = {config: {ship_name: "B", limit_speed: 12}, pob_info: {no_entry_reason: "wind"}};
  const test = createHarness({
    records: {"2026-10-26": {ship_b: card}}, schedule: [{ship_name: "B", d: "10/27"}],
    fetchHook({path, method, response}) {
      if (method === "DELETE" && path === "daily_records/2026-10-26/ship_b" && !deleteFailed) {
        deleteFailed = true;
        return response(500, {});
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  test.db.daily_records["2026-10-27"]["2026-10-27_B"] = normalCard();
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.ok(test.db.daily_records["2026-10-26"].ship_b, "missing or replaced migration target retains the source");
}

{
  let failFlush = false;
  const test = createHarness({
    records: {"2026-10-26": {ship_a: normalCard()}},
    failDeleteOnce: true,
    flushHook() { if (failFlush) throw new Error("sheet flush failed"); },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  failFlush = true;
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.ok(test.db.daily_records["2026-10-26"].ship_a, "failed archive-row flush retains the source");
}

{
  const card = normalCard();
  const test = createHarness({records: {"2026-10-26": {ship_a: card}}, failDeleteOnce: true});
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  const oldId = test.context.archiveId("2026-10-26", "ship_a", test.context.archiveFingerprint(card));
  test.sheets.get("歸檔總表").rows[1][12] = oldId;
  test.db.archive_receipts["2026-10-26"].ship_a = {
    archive_id: oldId, source_fingerprint: test.context.archiveFingerprint(card), completed_at: "legacy",
  };
  test.context.archiveAndClearFirebase("2026-10-26");
  assert.equal(test.db.daily_records["2026-10-26"].ship_a, undefined, "unchanged legacy receipt can finish its retained delete");
}

{
  let changed = false;
  const card = {config: {ship_name: "B", limit_speed: 12}, pob_info: {no_entry_reason: "wind"}};
  const test = createHarness({
    records: {"2026-10-26": {ship_b: card}},
    schedule: [{ship_name: "B", d: "10/27"}],
    fetchHook({path, method, db}) {
      if (method === "DELETE" && path === "daily_records/2026-10-26/ship_b" && !changed) {
        changed = true;
        db.daily_records["2026-10-26"].ship_b.config.limit_speed = 13.8;
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.ok(test.db.daily_records["2026-10-26"].ship_b, "changed configuration retains the source");
  assert.equal(test.db.daily_records["2026-10-27"]["2026-10-27_B"].config.limit_speed, 12, "changed configuration does not overwrite the target");
}

{
  let changed = false;
  const card = {config: {ship_name: "B", limit_speed: 12}, pob_info: {no_entry_reason: "wind"}};
  const test = createHarness({
    records: {"2026-10-26": {ship_b: card}},
    schedule: [{ship_name: "B", d: "10/27"}],
    fetchHook({path, method, db}) {
      if (method === "DELETE" && path === "daily_records/2026-10-26/ship_b" && !changed) {
        changed = true;
        db.daily_records["2026-10-26"].ship_b.pob_info.pob_time = "11:00";
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.equal(test.db.daily_records["2026-10-26"].ship_b.pob_info.pob_time, "11:00", "new POB retains the source for manual reconciliation");
  assert.ok(test.db.daily_records["2026-10-27"]["2026-10-27_B"], "new POB does not delete the existing target");
}

{
  let receiptWrites = 0;
  const card = {config: {ship_name: "B", limit_speed: 12}, pob_info: {no_entry_reason: "wind"}};
  const test = createHarness({
    records: {"2026-10-26": {ship_b: card}},
    schedule: [{ship_name: "B", d: "10/27"}],
    fetchHook({path, method, db, response}) {
      if (method === "PUT" && path.startsWith("archive_receipts/")) {
        receiptWrites += 1;
        if (receiptWrites === 2) {
          db.daily_records["2026-10-26"].ship_b.pob_info.pob_time = "11:00";
          return response(500, {});
        }
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.ok(test.db.daily_records["2026-10-26"].ship_b, "pending receipt with new POB retains the source");
  assert.ok(test.db.daily_records["2026-10-27"]["2026-10-27_B"], "pending receipt with new POB retains the target");
}

{
  const test = createHarness({records: {"2026-10-26": {invalid: {config: {}, pob_info: {}}}}});
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.ok(test.db.daily_records["2026-10-26"].invalid, "missing ship name retains the source");
  assert.equal(test.db.active_status, undefined, "invalid source does not reset monitoring");
}

{
  let failed = false;
  const test = createHarness({records: {"2026-10-26": {ship_a: normalCard(), ship_b: {...normalCard(), config: {ship_name: "B", limit_speed: 12}}}},
    sheetHook(sheet) {
      if (sheet.name !== "160K") return;
      const append = sheet.appendRow;
      sheet.appendRow = row => {
        if (row.length === 5 && !failed) { failed = true; throw new Error("classification unavailable"); }
        append(row);
      };
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.ok(test.db.daily_records["2026-10-26"].ship_a);
  assert.equal(test.db.daily_records["2026-10-26"].ship_b, undefined, "successful card deleted independently");
  test.context.archiveAndClearFirebase("2026-10-26");
  assert.equal(test.sheets.get("歸檔總表").rows.length, 3, "partial retry does not duplicate either ship");
  assert.equal(test.sheets.get("160K").rows.length, 2);
}

{
  let receiptWrites = 0;
  const test = createHarness({records: {"2026-10-26": {ship_a: normalCard()}},
    fetchHook({path, method, db, response}) {
      if (method === "PUT" && path.startsWith("archive_receipts/")) {
        receiptWrites += 1;
        if (receiptWrites === 2) {
          db.daily_records["2026-10-26"].ship_a.pob_info.pob_time = "11:00";
          return response(500, {});
        }
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.equal(test.sheets.get("歸檔總表").rows.length, 2, "pending archive receipt blocks a duplicate row");
  assert.ok(test.db.daily_records["2026-10-26"].ship_a, "business change after receipt failure retains the source");
}

{
  let failed = false;
  const test = createHarness({records: {"2026-10-26": {ship_a: normalCard()}},
    sheetHook(sheet) {
      if (sheet.name !== "歸檔總表") return;
      const append = sheet.appendRow;
      sheet.appendRow = row => {
        append(row);
        if (row[0] === "2026-10-26" && !failed) { failed = true; throw new Error("ambiguous append timeout"); }
      };
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  test.context.archiveAndClearFirebase("2026-10-26");
  assert.equal(test.sheets.get("歸檔總表").rows.length, 2, "find committed row after ambiguous timeout");
}

{
  const existing = normalCard();
  const source = {config: {ship_name: "A", limit_speed: 13.8}, pob_info: {no_entry_reason: "wind"}};
  const test = createHarness({records: {"2026-10-26": {ship_a: source}, "2026-10-27": {"2026-10-27_A": existing}}, schedule: [{ship_name: "A", d: "10/27"}]});
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.deepEqual(test.db.daily_records["2026-10-27"]["2026-10-27_A"], existing);
  assert.ok(test.db.daily_records["2026-10-26"].ship_a, "existing future card cannot be overwritten");
}

{
  let changed = false;
  const test = createHarness({records: {"2026-10-26": {ship_a: normalCard()}},
    fetchHook({path, method, db}) {
      if (method === "DELETE" && path.endsWith("ship_a") && !changed) {
        changed = true; db.daily_records["2026-10-26"].ship_a.pob_info.pob_time = "11:00";
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.equal(test.db.daily_records["2026-10-26"].ship_a.pob_info.pob_time, "11:00", "concurrent POB update retained by ETag");
}

{
  const test = createHarness({records: {"2026-10-26": {ship_a: normalCard()}}});
  test.db.forecast_data = null;
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /forecast_data is unavailable/);
  assert.ok(test.db.daily_records["2026-10-26"].ship_a);
  assert.equal(test.calls.some(call => call.method === "DELETE"), false);
}

{
  const test = createHarness({records: {}, lockBusy: true});
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive already running/);
  assert.equal(test.calls.length, 0);
}

{
  const test = createHarness({records: {}});
  assert.equal(test.context.rescheduledDate("1/1", new Date("2026-12-31T12:00:00Z")), "2027-01-01");
  assert.throws(() => test.context.rescheduledDate("2/31", new Date("2026-10-26T12:00:00Z")), /invalid rescheduled date/);
  assert.equal(test.context.archiveFingerprint({a: 1, b: 2}), test.context.archiveFingerprint({b: 2, a: 1}));
  test.context.archiveAndClearFirebase("2026-10-26");
  assert.equal(test.db.active_status.app_mode, "stop", "empty day still resets monitoring");
}

{
  const date = "2026-10-26";
  const key = `${date}_A`;
  const card = normalCard();
  card.config.original_date = "2026-10-25";
  const test = createHarness({records: {[date]: {[key]: card}}});
  test.context.getTwDateStr = () => date;
  test.context.getTodaySeasonTime = () => "16:00";
  test.context.startMonitoring("A", 12, "true", "W12");
  assert.equal(test.db.daily_records[date][key].config.original_date, "2026-10-25", "monitor start preserves inherited metadata");
  assert.equal(test.db.active_status.app_mode, "start");
  let handoff = false;
  test.context.tryHandoffToNextShip = () => { handoff = true; return false; };
  test.context.processPobDirect("A", "10:00");
  assert.equal(test.db.daily_records[date][key].pob_info.pob_wind_speed, 3, "POB uses nearest preceding ten-minute log");
  assert.equal(test.db.daily_records[date][key].pob_info.pob_time, "10:00");
  assert.equal(test.db.active_status.app_mode, "stop");
  assert.ok(handoff, "POB invokes handoff");
}

{
  const today = new Date();
  const d = `${today.getMonth() + 1}/${today.getDate()}`;
  const test = createHarness({records: {}, schedule: [
    {d, ship_name: "OTHER", limit_speed: 13.8, terminal: "W11"},
    {d, ship_name: "PRIORITY", limit_speed: 12, terminal: "W12"},
  ]});
  let selected;
  test.context.startMonitoring = (...args) => { selected = args; };
  assert.ok(test.context.tryHandoffToNextShip("test"));
  assert.equal(selected[0], "PRIORITY", "handoff gives W12 priority");
}

{
  const test = createHarness({records: {}, opPassword: null});
  const result = test.context.doGet({parameter: {action: "set_mode", pwd: "synthetic"}});
  assert.equal(JSON.parse(result.text).status, "error", "missing operation password rejects writes");
  assert.equal(test.calls.length, 0, "missing operation password does not call Firebase");
}

// 22. 既有的 13 欄歸檔總表會自動補上第 14 欄「接船對話」表頭並保留第 13 欄 archive_id
{
  const card = normalCard();
  card.pob_info = {no_entry_reason: "風大"};
  const test = createHarness({
    records: {"2026-11-15": {ship_a: card}},
  });
  const sheet13 = createSheet("歸檔總表");
  sheet13.rows.push(["日期", "船名", "限制風速", "POB時間", "POB風速", "POB訊息", "碼頭", "未進港原因", "備註", "北堤實際風力", "空軍預測值", "陣風預測值", "archive_id"]);
  test.sheets.set("歸檔總表", sheet13);
  test.context.archiveAndClearFirebase("2026-11-15");
  assert.strictEqual(sheet13.rows[0][12], "archive_id");
  assert.strictEqual(sheet13.rows[0][13], "接船對話");
  assert.strictEqual(sheet13.rows[1][13], "-");
}

// 23. 當日有船隻卡片與對話（含附件 metadata）：排序整理成純 JSON、剝除 dataUrl 與 clientId、成功後刪除 chat_rooms 與 chat_attachments
{
  const card = normalCard();
  card.pob_info = {pob_time: "08:30", pob_wind_speed: "12.0", formatted_msg: "POB 08:30"};
  const test = createHarness({
    records: {"2026-11-15": {ship_a: card}},
    extraDb: {
      chat_rooms: {
        "2026-11-15": {
          seats: {CPCLNG_1: {clientId: "secret-client", roleId: "CPCLNG", roleLabel: "CPCLNG-1", slot: 1, activeAt: 1700000000000}},
          messages: {
            m2: {id: "m2", ts: 2000, timeStr: "09:10", roleId: "Pilot", roleLabel: "Pilot-1", clientId: "c-pilot", text: "引水梯已備妥", attachment: {id: "att1", name: "photo.jpg", mimeType: "image/jpeg", size: 12345, isImage: true, dataUrl: "data:image/jpeg;base64,AAAA"}},
            m1: {id: "m1", ts: 1000, timeStr: "09:05", roleId: "CPCLNG", roleLabel: "CPCLNG-1", clientId: "c-cpc", text: "準備靠泊"},
          },
        },
      },
      chat_attachments: {
        "2026-11-15": {
          att1: {id: "att1", name: "photo.jpg", mimeType: "image/jpeg", size: 12345, isImage: true, dataUrl: "data:image/jpeg;base64,AAAA"},
        },
      },
    },
  });
  test.context.archiveAndClearFirebase("2026-11-15");
  const rows = test.sheets.get("歸檔總表").rows;
  assert.strictEqual(rows[0][13], "接船對話");
  const parsed = JSON.parse(rows[1][13]);
  assert.strictEqual(parsed.date, "2026-11-15");
  assert.strictEqual(parsed.count, 2);
  assert.deepStrictEqual(parsed.messages.map(m => m.time), ["09:05", "09:10"]);
  assert.strictEqual(parsed.messages[1].attachment.name, "photo.jpg");
  assert.strictEqual(parsed.messages[1].attachment.type, "image/jpeg");
  assert.strictEqual(parsed.messages[1].attachment.size, 12345);
  assert.strictEqual(parsed.messages[1].attachment.dataUrl, undefined);
  assert.strictEqual(parsed.messages[1].clientId, undefined);
  assert.strictEqual(rows[1][13].includes("c-pilot"), false);
  assert.strictEqual(rows[1][13].includes("AAAA"), false);
  assert.strictEqual(test.db.chat_rooms["2026-11-15"], undefined);
  assert.strictEqual(test.db.chat_attachments["2026-11-15"], undefined);
}

// 24. 當日僅有船隻卡片、無任何對話時，第 14 欄寫入 "-" 且清理空房間/附件
{
  const card = normalCard();
  card.pob_info = {no_entry_reason: "取消"};
  const test = createHarness({
    records: {"2026-11-15": {ship_a: card}},
    extraDb: {chat_rooms: {"2026-11-15": {seats: {Tug_1: {clientId: "x", roleLabel: "拖船-1"}}}}},
  });
  test.context.archiveAndClearFirebase("2026-11-15");
  assert.strictEqual(test.sheets.get("歸檔總表").rows[1][13], "-");
  assert.strictEqual(test.db.chat_rooms["2026-11-15"], undefined);
}

// 25. 無船期純對話日寫入 14 欄 chat_only 列（無船期(純對話)），且刪除 chat_rooms 失敗一次後重試不會重複補列
{
  let failChatDelete = true;
  const test = createHarness({
    records: {},
    extraDb: {
      chat_rooms: {
        "2026-11-16": {messages: {m1: {id: "m1", ts: 1000, timeStr: "10:00", roleLabel: "VTS-1", clientId: "c1", text: "航道淨空"}}},
      },
      chat_attachments: {"2026-11-16": {att1: {dataUrl: "data:text/plain;base64,MQ=="}}},
    },
    fetchHook: ({path, method, response}) => {
      if (method === "DELETE" && path === "chat_rooms/2026-11-16" && failChatDelete) {
        failChatDelete = false;
        return response(500, {error: "chat delete transient failure"});
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-11-16"), /500/);
  const sheet = test.sheets.get("歸檔總表");
  assert.strictEqual(sheet.rows.length, 2);
  assert.strictEqual(sheet.rows[1][0], "2026-11-16");
  assert.strictEqual(sheet.rows[1][1], "無船期(純對話)");
  assert.strictEqual(sheet.rows[1][12], "2026-11-16:chat_only");
  assert.strictEqual(JSON.parse(sheet.rows[1][13]).count, 1);

  test.db.chat_rooms["2026-11-16"].messages.m2 = {id: "m2", ts: 2000, timeStr: "10:05", roleLabel: "Agent-1", clientId: "c2", text: "收到"};
  test.context.archiveAndClearFirebase("2026-11-16");
  assert.strictEqual(sheet.rows.length, 2);
  assert.strictEqual(JSON.parse(sheet.rows[1][13]).count, 2);
  assert.strictEqual(test.db.chat_rooms["2026-11-16"], undefined);
  assert.strictEqual(test.db.chat_attachments["2026-11-16"], undefined);
}

// 26. 船隻已歸檔並自 daily_records 刪除、但首次刪除 chat_rooms 失敗時，重試偵測已有船列後不誤寫 chat_only 列並完成收尾刪除
{
  let failChatDelete = true;
  const card = {config: {ship_name: "LNG_A", limit_speed: 12}, pob_info: {pob_time: "07:00", pob_wind_speed: "9.5"}, wind_logs: {"上午 07:00": 9}};
  const test = createHarness({
    records: {"2026-11-17": {ship_a: card}},
    extraDb: {
      chat_rooms: {
        "2026-11-17": {messages: {m1: {id: "m1", ts: 1000, timeStr: "06:50", roleLabel: "CPCLNG-1", clientId: "c1", text: "準備帶纜"}}},
      },
      chat_attachments: {"2026-11-17": {a1: {dataUrl: "data:image/jpeg;base64,xx"}}},
    },
    fetchHook: ({path, method, response}) => {
      if (method === "DELETE" && path === "chat_rooms/2026-11-17" && failChatDelete) {
        failChatDelete = false;
        return response(500, {error: "chat delete failed once"});
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-11-17"), /500/);
  assert.deepStrictEqual(test.db.daily_records["2026-11-17"], {});
  assert.ok(test.db.chat_rooms["2026-11-17"]);

  test.context.archiveAndClearFirebase("2026-11-17");
  const rows = test.sheets.get("歸檔總表").rows;
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1][1], "LNG_A");
  assert.strictEqual(rows.some(r => r[1] === "無船期(純對話)"), false);
  assert.strictEqual(test.db.chat_rooms["2026-11-17"], undefined);
  assert.strictEqual(test.db.chat_attachments["2026-11-17"], undefined);
}

// 27. 若船隻卡片歸檔失敗，必須保留 chat_rooms 與 chat_attachments 不可提前刪除
{
  const card = normalCard();
  card.pob_info = {no_entry_reason: "風大"};
  const test = createHarness({
    records: {"2026-10-26": {ship_a: card}},
    failDeleteOnce: true,
    extraDb: {
      chat_rooms: {"2026-10-26": {messages: {m1: {id: "m1", ts: 1000, timeStr: "08:00", roleLabel: "Pilot-1", text: "等候指令"}}}},
      chat_attachments: {"2026-10-26": {a1: {dataUrl: "data:application/pdf;base64,JVBER"}}},
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-10-26"), /archive incomplete/);
  assert.ok(test.db.chat_rooms["2026-10-26"]);
  assert.ok(test.db.chat_attachments["2026-10-26"]);
}

// 28. 多則超過 48,000 字元自最舊截斷並附 truncated/total_count/kept_count；單則超長亦安全截斷至 <= 48,000
{
  const manyMsgs = {};
  for (let i = 1; i <= 120; i++) {
    manyMsgs[`m${String(i).padStart(3, "0")}`] = {
      id: `m${i}`,
      ts: i * 1000,
      timeStr: "12:00",
      roleLabel: "CPCLNG-1",
      text: `msg-${i}-` + "x".repeat(600),
    };
  }
  const card1 = normalCard();
  card1.pob_info = {no_entry_reason: "取消"};
  const testMany = createHarness({
    records: {"2026-11-18": {ship_a: card1}},
    extraDb: {chat_rooms: {"2026-11-18": {messages: manyMsgs}}},
  });
  testMany.context.archiveAndClearFirebase("2026-11-18");
  const manyStr = testMany.sheets.get("歸檔總表").rows[1][13];
  assert.ok(manyStr.length <= 48000, `Expected <= 48000, got ${manyStr.length}`);
  const manyParsed = JSON.parse(manyStr);
  assert.strictEqual(manyParsed.truncated, true);
  assert.strictEqual(manyParsed.total_count, 120);
  assert.strictEqual(manyParsed.kept_count, manyParsed.messages.length);
  assert.strictEqual(manyParsed.count, manyParsed.kept_count);
  assert.ok(manyParsed.messages.at(-1).text.startsWith("msg-120-"));

  const card2 = normalCard();
  card2.pob_info = {no_entry_reason: "取消"};
  const testSingle = createHarness({
    records: {"2026-11-19": {ship_a: card2}},
    extraDb: {
      chat_rooms: {
        "2026-11-19": {
          messages: {
            m1: {id: "m1", ts: 1000, timeStr: "12:00", roleLabel: "拖船-1", text: "舊訊息"},
            m2: {id: "m2", ts: 2000, timeStr: "12:01", roleLabel: "VTS-1", text: "超長訊息" + "A".repeat(60000)},
          },
        },
      },
    },
  });
  testSingle.context.archiveAndClearFirebase("2026-11-19");
  const singleStr = testSingle.sheets.get("歸檔總表").rows[1][13];
  assert.ok(singleStr.length <= 48000, `Expected single-msg JSON <= 48000, got ${singleStr.length}`);
  const singleParsed = JSON.parse(singleStr);
  assert.strictEqual(singleParsed.truncated, true);
  assert.strictEqual(singleParsed.total_count, 2);
  assert.strictEqual(singleParsed.kept_count, 1);
  assert.ok(singleParsed.messages[0].text.endsWith("…(已截斷)"));
}

// 29. Google Sheets 將第 1 欄自動轉成 Date 物件且遺失 archive_receipts 時，重試仍能辨識已歸檔船隻列並略過補寫 chat_only 列
{
  let failChatDelete = true;
  const card = {config: {ship_name: "LNG_B", limit_speed: 12}, pob_info: {pob_time: "08:00", pob_wind_speed: "10.2"}, wind_logs: {"上午 08:00": 10}};
  const test = createHarness({
    records: {"2026-11-20": {ship_a: card}},
    extraDb: {
      chat_rooms: {
        "2026-11-20": {messages: {m1: {id: "m1", ts: 1000, timeStr: "08:00", roleLabel: "CPCLNG-1", clientId: "c1", text: "準備靠泊"}}},
      },
      chat_attachments: {"2026-11-20": {att1: {dataUrl: "data:text/plain;base64,MQ=="}}},
    },
    fetchHook: ({path, method, response}) => {
      if (method === "DELETE" && path === "chat_rooms/2026-11-20" && failChatDelete) {
        failChatDelete = false;
        return response(500, {error: "transient delete fail"});
      }
    },
  });
  assert.throws(() => test.context.archiveAndClearFirebase("2026-11-20"), /500/);
  const sheet = test.sheets.get("歸檔總表");
  assert.strictEqual(sheet.rows.length, 2);

  // 模擬 Google Sheets 將 Col 1 的 "2026-11-20" 字串自動解析為 Date 物件，並清除 receipt 強迫走備援查找
  sheet.rows[1][0] = new Date("2026-11-20T00:00:00+08:00");
  delete test.db.archive_receipts["2026-11-20"];
  test.db.chat_rooms["2026-11-20"].messages.m2 = {id: "m2", ts: 2000, timeStr: "08:15", roleLabel: "Pilot-1", clientId: "c2", text: "引水人登輪"};

  test.context.archiveAndClearFirebase("2026-11-20");
  assert.strictEqual(sheet.rows.length, 2);
  assert.strictEqual(sheet.rows.some(r => r[1] === "無船期(純對話)"), false);
  assert.strictEqual(JSON.parse(sheet.rows[1][13]).count, 2);
  assert.strictEqual(test.db.chat_rooms["2026-11-20"], undefined);
  assert.strictEqual(test.db.chat_attachments["2026-11-20"], undefined);
}

// 30. update_schedule 支援 is_deleted: true 寫入 tombstone 隱藏日曆船期，且重新新增同船名會覆蓋 is_deleted: false 恢復顯示
{
  const now = new Date();
  const twIso = new Date(now.getTime() + 8 * 3600000).toISOString();
  const todayMD = `${Number(twIso.slice(5, 7))}/${Number(twIso.slice(8, 10))}`;
  const todayZeroPadded = `${twIso.slice(5, 7)}/${twIso.slice(8, 10)}`;
  const tomorrow = new Date(now.getTime() + 24 * 3600000);
  const tomIso = new Date(tomorrow.getTime() + 8 * 3600000).toISOString();
  const tomZeroPadded = `${tomIso.slice(5, 7)}/${tomIso.slice(8, 10)}`;
  const tomMD = `${Number(tomIso.slice(5, 7))}/${Number(tomIso.slice(8, 10))}`;

  let calendarData = [
    {d: todayZeroPadded, n: "CAL_A(12)", t: "W12"},
    {d: tomZeroPadded, n: "CAL_B(15)", t: "W13"},
  ];
  const test = createHarness({
    records: {},
    stubSchedule: false,
    extraProps: {SHIP_SCHEDULE_API_URL: "https://calendar.example.test/api"},
    externalFetchHook: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({data: calendarData}),
    }),
  });

  // 刪除 CAL_A (從日曆來源而來) 並新增一筆 MM/DD 補零日期船隻 MAN_C
  const delRes = JSON.parse(test.context.doGet({
    parameter: {
      action: "update_schedule",
      pwd: "test",
      schedule: JSON.stringify([
        {ship_name: "CAL_A", d: todayZeroPadded, is_deleted: true},
        {ship_name: "MAN_C", d: tomZeroPadded, limit_speed: 12, terminal: "W12", is_deleted: false},
      ]),
    },
  }).text);
  assert.strictEqual(delRes.status, "success");
  assert.strictEqual(test.db.schedule_overrides.CAL_A.is_deleted, true);
  assert.strictEqual(test.db.schedule_overrides.CAL_A.d, todayMD);
  assert.strictEqual(test.db.schedule_overrides.MAN_C.d, tomMD);
  assert.deepStrictEqual(
    test.db.schedule_list.map(x => ({d: x.d, ship_name: x.ship_name, terminal: x.terminal})),
    [
      {d: tomMD, ship_name: "MAN_C", terminal: "W12"},
      {d: tomMD, ship_name: "CAL_B", terminal: "W13"},
    ]
  );

  // 重新新增 CAL_A 後應恢復顯示 (is_deleted: false)
  test.context.doGet({
    parameter: {
      action: "update_schedule",
      pwd: "test",
      schedule: JSON.stringify([
        {ship_name: "CAL_A", d: todayZeroPadded, limit_speed: 12, terminal: "W12", is_deleted: false},
      ]),
    },
  });
  assert.strictEqual(test.db.schedule_overrides.CAL_A.is_deleted, false);
  assert.strictEqual(test.db.schedule_list[0].ship_name, "CAL_A");
  assert.strictEqual(test.db.schedule_list[0].d, todayMD);
}

// 31. 刪除最後一筆船期時 (Calendar API 成功且全數刪除)，update_schedule 應清空 schedule_list 為 []；若 Calendar API 失敗則保護既有 schedule_list 不被清空
{
  const tom = new Date(Date.now() + 24 * 3600000);
  const tomIso = new Date(tom.getTime() + 8 * 3600000).toISOString();
  const tomMD = `${Number(tomIso.slice(5, 7))}/${Number(tomIso.slice(8, 10))}`;

  let apiOk = true;
  const test = createHarness({
    records: {},
    stubSchedule: false,
    extraProps: {SHIP_SCHEDULE_API_URL: "https://calendar.example.test/api"},
    extraDb: {schedule_list: [{d: tomMD, ship_name: "ONLY_SHIP", limit_speed: 15, terminal: "W13"}]},
    externalFetchHook: () => apiOk
      ? {getResponseCode: () => 200, getContentText: () => JSON.stringify({data: [{d: tomMD, n: "ONLY_SHIP(15)", t: "W13"}]})}
      : {getResponseCode: () => 500, getContentText: () => "API down"},
  });

  // 模擬日曆 API 失敗時，delete 應保留既有 schedule_list (fail-safe)
  apiOk = false;
  test.context.doGet({
    parameter: {
      action: "update_schedule",
      pwd: "test",
      schedule: JSON.stringify([{ship_name: "ONLY_SHIP", d: tomMD, is_deleted: true}]),
    },
  });
  assert.strictEqual(test.db.schedule_list.length, 1, "API failure must retain existing schedule_list");

  // 日曆 API 正常時，刪除最後一筆船期必須清空 schedule_list
  apiOk = true;
  test.context.doGet({
    parameter: {
      action: "update_schedule",
      pwd: "test",
      schedule: JSON.stringify([{ship_name: "ONLY_SHIP", d: tomMD, is_deleted: true}]),
    },
  });
  assert.deepStrictEqual(test.db.schedule_list, [], "Verified empty schedule must write [] to schedule_list");
}

// 32. 刪除 UNFINISHED_SHIP、保留 UNFINISHED_SHIP.terminal、與過期 tombstone (含無日期 tombstone) 自動清理
{
  const now = new Date();
  const twIso = new Date(now.getTime() + 8 * 3600000).toISOString();
  const todayStr = twIso.slice(0, 10);
  const todayMD = `${Number(twIso.slice(5, 7))}/${Number(twIso.slice(8, 10))}`;
  const yest = new Date(now.getTime() - 24 * 3600000);
  const yestIso = new Date(yest.getTime() + 8 * 3600000).toISOString();
  const yestStr = yestIso.slice(0, 10);
  const yestMD = `${Number(yestIso.slice(5, 7))}/${Number(yestIso.slice(8, 10))}`;
  const tom = new Date(now.getTime() + 24 * 3600000);
  const tomIso = new Date(tom.getTime() + 8 * 3600000).toISOString();
  const tomMD = `${Number(tomIso.slice(5, 7))}/${Number(tomIso.slice(8, 10))}`;

  const test = createHarness({
    records: {},
    stubSchedule: false,
    extraDb: {
      active_status: {app_mode: "start", ship_name: "UNFIN_A", limit_speed: 12, terminal: "W12"},
      schedule_overrides: {
        OLD_DATED_DEL: {d: yestMD, ship_name: "OLD_DATED_DEL", is_deleted: true, created_at: yestStr},
        OLD_UNDATED_DEL: {d: "", ship_name: "OLD_UNDATED_DEL", is_deleted: true, created_at: yestStr},
        TODAY_UNDATED_DEL: {d: "", ship_name: "TODAY_UNDATED_DEL", is_deleted: true, created_at: todayStr},
        KEEP_FUTURE: {d: tomMD, ship_name: "KEEP_FUTURE", limit_speed: 15, terminal: "W13", is_deleted: false, created_at: todayStr},
      },
    },
  });

  // set_mode reset (no_entry_reason) 應保留 terminal 於 UNFINISHED_SHIP 並置頂於 getScheduleList()
  test.context.doGet({
    parameter: {action: "set_mode", mode: "reset", pwd: "test", no_entry_reason: "風速超標"},
  });
  const listBeforeDel = test.context.getScheduleList();
  assert.strictEqual(listBeforeDel[0].ship_name, "UNFIN_A");
  assert.strictEqual(listBeforeDel[0].d, "");
  assert.strictEqual(listBeforeDel[0].terminal, "W12");
  // 過期 tombstone 應已自動刪除，當日無日期 tombstone 仍保留
  assert.strictEqual(test.db.schedule_overrides.OLD_DATED_DEL, undefined);
  assert.strictEqual(test.db.schedule_overrides.OLD_UNDATED_DEL, undefined);
  assert.strictEqual(test.db.schedule_overrides.TODAY_UNDATED_DEL.is_deleted, true);

  // 在 UNFIN_A 未被異動的情況下調整其他船期 (新增 OTHER_NEW)，UNFINISHED_SHIP 必須保留且置頂於 schedule_list
  test.context.doGet({
    parameter: {
      action: "update_schedule",
      pwd: "test",
      schedule: JSON.stringify([{ship_name: "OTHER_NEW", d: tomMD, limit_speed: 12, terminal: "W12", is_deleted: false}]),
    },
  });
  assert.ok(test.props.get("UNFINISHED_SHIP"), "unrelated update_schedule diff must preserve UNFINISHED_SHIP");
  assert.strictEqual(test.db.schedule_list[0].ship_name, "UNFIN_A");
  assert.strictEqual(test.db.schedule_list[0].d, "");
  assert.strictEqual(test.db.schedule_list[0].terminal, "W12");

  // 刪除 UNFIN_A 後應清除 UNFINISHED_SHIP 且不再出現於 getScheduleList()
  test.context.doGet({
    parameter: {
      action: "update_schedule",
      pwd: "test",
      schedule: JSON.stringify([{ship_name: "UNFIN_A", d: "", is_deleted: true}]),
    },
  });
  assert.strictEqual(test.props.get("UNFINISHED_SHIP"), undefined);
  const listAfterDel = test.context.getScheduleList();
  assert.strictEqual(listAfterDel.some(item => item.ship_name === "UNFIN_A"), false);
  assert.strictEqual(listAfterDel.some(item => item.ship_name === "KEEP_FUTURE"), true);
  assert.strictEqual(listAfterDel.some(item => item.ship_name === "OTHER_NEW"), true);

  // 驗證 normalizeScheduleDateMD、archiveAndClearFirebase 與 tryHandoffToNextShip 能匹配補零日期 06/09 <-> 6/9
  assert.strictEqual(test.context.normalizeScheduleDateMD("06/09"), "6/9");
  assert.strictEqual(test.context.normalizeScheduleDateMD("01/05"), "1/5");
  assert.strictEqual(test.context.normalizeScheduleDateMD(""), "");

  const normCard = {config: {ship_name: "PAD_SHIP", limit_speed: 12}, pob_info: {no_entry_reason: "風速超標"}, wind_logs: {"上午 09:50": 14}};
  const testNorm = createHarness({
    records: {"2026-06-09": {pad_ship: normCard}},
    schedule: [{d: "06/09", ship_name: "PAD_SHIP"}, {d: "06/10", ship_name: "NEXT_PAD"}],
  });
  testNorm.context.archiveAndClearFirebase("2026-06-09");
  assert.strictEqual(testNorm.db.daily_records["2026-06-09"].pad_ship, undefined);
  assert.strictEqual(testNorm.db.daily_records["2026-06-10"], undefined, "same-day padded 06/09 schedule entry must not trigger reschedule");

  const paddedToday = `${twIso.slice(5, 7)}/${twIso.slice(8, 10)}`;
  const handoffTest = createHarness({
    records: {},
    schedule: [{d: paddedToday, ship_name: "HANDOFF_PAD", limit_speed: 12, terminal: "W12"}],
  });
  assert.strictEqual(handoffTest.context.tryHandoffToNextShip("normalized-date"), true);
  assert.strictEqual(handoffTest.db.active_status.ship_name, "HANDOFF_PAD");
  assert.strictEqual(handoffTest.db.active_status.terminal, "W12");
  void todayMD;
}

console.log("GAS archive and operations: 32 scenarios passed");
