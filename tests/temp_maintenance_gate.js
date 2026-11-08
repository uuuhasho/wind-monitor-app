// Temporary cutover verification: remove after production acceptance as requested.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const values = new Map([['MAINTENANCE_MODE', 'true'], ['FIREBASE_URL', 'https://example.test/test']]);
const writes = [];
const props = {
  getProperty: key => values.get(key) || '',
  setProperty: (key, value) => {writes.push(key); values.set(key, value);},
  setProperties: value => {writes.push(...Object.keys(value));},
  deleteProperty: key => {writes.push(key);},
};
const context = {
  console, PropertiesService: {getScriptProperties: () => props},
  UrlFetchApp: {fetch: () => {throw new Error('unexpected network');}},
  SpreadsheetApp: {openById: () => {throw new Error('unexpected spreadsheet');}},
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/monitor.js'), 'utf8'), context);
for (const [name, args] of [
  ['doGet', [{parameter: {action: 'display'}}]],
  ['doGet', [{parameter: {action: 'set_mode'}}]],
  ['doGet', [{parameter: {action: 'archive_test'}}]],
  ['doPost', [{parameter: {action: 'update_schedule'}}]],
  ['doPost', [{parameter: {}, postData: {contents: '{}'}}]],
  ['executeMonitor', []], ['checkDailySchedule', []], ['archiveAndClearFirebase', []],
  ['onCalendarOrSheetChange', []], ['setupProperties', []],
  ['callFirebase', ['active_status', {x: 1}, 'patch']],
]) {
  assert.throws(() => context[name](...args), /maintenance/i, name);
}
assert.deepEqual(writes, []);
values.set('MAINTENANCE_MODE', 'false');
assert.throws(() => context.ensureFirebaseEnvironment(), /formal namespace/);
values.set('MAINTENANCE_MODE', 'unexpected');
assert.throws(() => context.ensureFirebaseEnvironment(), /maintenance/i);
console.log('Temporary GAS maintenance checks passed');
