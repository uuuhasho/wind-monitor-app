// Temporary cutover verification: remove after production acceptance as requested.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function harness(url = 'https://example.test/formal') {
  const properties = new Map([
    ['FIREBASE_URL', url], ['FIREBASE_SECRET', 'synthetic-secret'],
    ['SPREADSHEET_ID', 'synthetic-sheet'], ['TARGET_URL', 'Realtime_Panel_Port_GatData'],
    ['STATION_NAME', 'synthetic-station'], ['SHIP_SCHEDULE_API_URL', 'synthetic-schedule'],
    ['OP_PASSWORD', 'synthetic-password'],
  ]);
  const calls = [];
  const props = {
    getProperty: key => properties.get(key) || '',
    setProperty: (key, value) => properties.set(key, value),
    setProperties: values => Object.entries(values).forEach(([key, value]) => properties.set(key, value)),
    deleteProperty: key => properties.delete(key),
  };
  const context = {
    console, PropertiesService: {getScriptProperties: () => props},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: text => ({text, setMimeType() {return this;}})},
    SpreadsheetApp: {openById: id => {calls.push(['sheet', id]); return {getName: () => 'synthetic'};}},
    UrlFetchApp: {fetch: url => {calls.push(['fetch', url]); return {getResponseCode: () => 200};}},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/monitor.js'), 'utf8'), context);
  context.archiveAndClearFirebase = date => {calls.push(['archive', date, properties.get('FIREBASE_URL')]);};
  context.callFirebase = (node, data, method) => {calls.push(['firebase', node, method, properties.get('FIREBASE_URL')]);};
  return {context, properties, calls};
}

{
  const h = harness();
  const result = h.context.doGet({parameter: {action: 'archive_test', pwd: 'synthetic-password', sim_date: '2026-11-12'}});
  assert.equal(JSON.parse(result.text).status, 'success');
  assert.ok(h.calls.some(call => call[0] === 'archive' && call[2] === 'https://example.test/formal'));
  assert.ok(h.calls.some(call => call[0] === 'firebase' && call[3] === 'https://example.test/formal'));
  assert.equal(h.properties.get('FIREBASE_URL'), 'https://example.test/formal');
  assert.equal(h.properties.get('FIREBASE_SECRET'), 'synthetic-secret');
  assert.equal(h.properties.get('SPREADSHEET_ID'), 'synthetic-sheet');
  assert.equal(h.properties.get('SHIP_SCHEDULE_API_URL'), 'synthetic-schedule');
}

{
  const h = harness();
  h.context.setupProperties();
  assert.equal(h.properties.get('FIREBASE_URL'), 'https://example.test/formal');
  assert.equal(h.properties.get('FIREBASE_SECRET'), 'synthetic-secret');
  assert.equal(h.properties.get('SPREADSHEET_ID'), 'synthetic-sheet');
  assert.ok(h.calls.some(call => call[0] === 'sheet' && call[1] === 'synthetic-sheet'));
}

{
  const h = harness('https://example.test/test');
  assert.throws(() => h.context.setupProperties(), /formal namespace/);
  assert.equal(h.properties.get('FIREBASE_URL'), 'https://example.test/test');
  assert.equal(h.properties.get('FIREBASE_SECRET'), 'synthetic-secret');
  assert.equal(h.calls.length, 0);
}

{
  const h = harness();
  h.properties.delete('FIREBASE_URL');
  h.context.setupProperties();
  assert.equal(h.properties.get('FIREBASE_URL'), 'https://newlngship-default-rtdb.asia-southeast1.firebasedatabase.app/formal');
  assert.equal(h.properties.get('FIREBASE_SECRET'), 'synthetic-secret');
}

{
  const h = harness();
  h.context.archiveAndClearFirebase = () => {throw new Error('synthetic archive failure');};
  const result = h.context.doGet({parameter: {action: 'archive_test', pwd: 'synthetic-password'}});
  assert.equal(JSON.parse(result.text).status, 'error');
  assert.equal(h.properties.get('FIREBASE_URL'), 'https://example.test/formal');
  assert.equal(h.calls.some(call => call[0] === 'firebase'), false);
}

{
  const source = fs.readFileSync(path.join(__dirname, '../gas/monitor.js'), 'utf8');
  assert.doesNotMatch(source, /firebasedatabase\.app\/test(?:[/'"`]|$)/);
}

console.log('Temporary GAS formal cutover checks passed');
