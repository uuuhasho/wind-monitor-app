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
          [(rows[row - 1 + index] || [])[column - 1]]),
      };
    },
  };
}

function createHarness({records, schedule = [], failDeleteOnce = false, failMoveOnce = false, fetchHook, sheetHook, flushHook, lockBusy = false, opPassword = "test"}) {
  const db = {daily_records: records, forecast_data: [{timestamp: "2026-10-26T08:00:00+08:00", cpc_wind_speed: 5, open_meteo_wind_speed: 7}]};
  const props = new Map([
    ["FIREBASE_URL", "https://example.test/test"], ["SPREADSHEET_ID", "sheet"],
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
      formatDate: date => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10),
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
    UrlFetchApp: {fetch: (url, options) => {
      const path = decodeURIComponent(url.match(/\/test\/(.*)\.json/)[1]).split("?")[0];
      const method = options.method;
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
  context.ensureTestEnvironment = () => {};
  context.getScheduleList = () => schedule;
  context.updateFirebaseScheduleList = () => {};
  return {context, db, sheets, calls};
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

console.log("GAS archive and operations: 21 scenarios passed");
