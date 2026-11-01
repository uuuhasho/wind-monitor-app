const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const properties = new Map();
const cache = new Map();
const calls = [];
let html = '';
let activeStatus = {app_mode: 'stop'};
const props = {
  getProperty: key => properties.get(key) || '',
  setProperty: (key, value) => properties.set(key, value),
  setProperties: values => Object.entries(values).forEach(([key, value]) => properties.set(key, value)),
};
const context = {
  console,
  PropertiesService: {getScriptProperties: () => props},
  CacheService: {getScriptCache: () => ({get: key => cache.get(key), put: (key, value) => cache.set(key, value)})},
  UrlFetchApp: {fetch: () => ({getContentText: () => html})},
  Utilities: {formatDate: (_date, _zone, format) => format === 'HHmm' ? '1200' : format === 'HH:mm:ss' ? '12:00:00' : '2026-11-01'},
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/monitor.js'), 'utf8'), context);
context.ensureTestEnvironment = () => {};
context.callFirebase = (key, value, method) => {
  calls.push({key, value, method});
  return {getContentText: () => JSON.stringify(activeStatus), getResponseCode: () => 200};
};

function fixture(wave, visibility, waveTime = '11/01 14:40', visTime = '11/01 14:52') {
  const values = [
    `Observation,AWAC,臺中港底碇式波流主站|TCAW01|TC,北堤,0,0,21,${waveTime},${wave}|黃|#FFFF00|#000000`,
    'Observation,VISIBILITY,臺中港能見度站(運技中心)||TC,運技中心,0,0,214,11/01 14:52,0.3浬',
    `Observation,VISIBILITY,臺中港能見度站(北內堤)||TC,北內堤,0,0,242,${visTime},${visibility}`,
  ].join('@');
  const cells = Array.from({length: 22}, () => '');
  cells[5] = '臺中港風力觀測站(北堤綠燈塔)';
  cells[20] = '11/01 14:50';
  cells[21] = 'WS_AVG=6.39,WD_AVG=20';
  return `<input name="Txt_Station_Data" value="${values}" id="Txt_Station_Data"><table><tr>${cells.map(v => `<td>${v}</td>`).join('')}</tr></table>`;
}

for (const [wave, visibility, expectedWave, expectedVisibility, waveTime, visTime] of [
  ['0.87', '10.8浬以上(20公里以上)', 0.87, 10.8],
  ['2.51', '1.9浬(3.5公里)', 2.51, 1.9],
  ['0', '0浬', 0, 0],
  ['', '', null, null],
  ['-9999', '未知', null, null],
  ['1.2', '1.5浬', null, null, '無連線', '無連線'],
]) {
  cache.clear(); calls.length = 0;
  html = fixture(wave, visibility, waveTime, visTime);
  const result = context.fetchWindData();
  assert.equal(result.valid, true);
  assert.equal(result.speed, 6.4);
  assert.equal(result.wave, expectedWave);
  assert.equal(result.visibility, expectedVisibility);
  context.executeMonitor();
  const status = calls.find(call => call.key === 'active_status' && call.method === 'patch');
  assert.equal(status.value.current_wave, expectedWave);
  assert.equal(status.value.current_visibility, expectedVisibility);
  assert.equal(calls.some(call => call.key.includes('daily_records')), false);
}

cache.set('cached_wind_data', JSON.stringify({valid: true, speed: 4, time: '12:00'}));
calls.length = 0;
context.executeMonitor();
const legacy = calls.find(call => call.key === 'active_status' && call.method === 'patch');
assert.equal(legacy.value.current_wave, null);
assert.equal(legacy.value.current_visibility, null);

activeStatus = {app_mode: 'start', target_key: 'synthetic', ship_name: 'SYNTHETIC'};
cache.clear(); calls.length = 0;
html = fixture('2.51', '1.9浬');
context.executeMonitor();
const windLog = calls.find(call => call.key.endsWith('/wind_logs'));
assert.ok(windLog);
assert.deepEqual(Object.values(windLog.value), [6.4]);
assert.equal(calls.filter(call => call.method === 'patch').length, 2);
console.log('GAS conditions: 8 scenarios passed');
