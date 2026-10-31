async page => {
  await page.clock.install();
  await page.context().setOffline(false);
  await page.unrouteAll({behavior: 'wait'});
  await page.route('https://**/*', route => route.fulfill({status: 200, contentType: 'application/javascript', body: ''}));
  await page.route('http://**/*', route => route.request().url().startsWith('http://127.0.0.1:4177/') ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const today = new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Taipei'});
    const monthDay = `${Number(today.slice(5, 7))}/${Number(today.slice(8))}`;
    const records = {
      '.info/serverTimeOffset': 0,
      '.info/connected': true,
      'test/active_status': {app_mode: 'stop', current_wind: 4, last_update: '10:00', forecast_updating: false},
      'test/schedule_list': [{d: monthDay, ship_name: 'DEMO-SHIP', limit_speed: 12, terminal: 'W12'}],
      'test/forecast_data': [
        {timestamp: `${today}T08:00:00+08:00`, cpc_wind_speed: 5, open_meteo_wind_speed: 6},
        {timestamp: `${today}T09:00:00+08:00`, cpc_wind_speed: 7, open_meteo_wind_speed: 8},
      ],
      'test/forecast_metadata': {updatedAt: `${today}T02:00:00Z`},
    };
    const listeners = {};
    const snapshot = path => ({val: () => records[path] ?? null, exists: () => records[path] != null});
    window.__emit = (path, value) => { records[path] = value; (listeners[path] || []).forEach(callback => callback(snapshot(path))); };
    window.__requests = [];
    window.__chartOptions = [];
    window.__today = today;
    window.firebase = {
      apps: [], initializeApp() { this.apps.push({}); },
      database: () => ({ref: path => ({
        on(_event, callback) { (listeners[path] ||= []).push(callback); callback(snapshot(path)); },
        off() { listeners[path] = []; }, once: async () => snapshot(path),
      })}),
    };
    window.echarts = {graphic: {LinearGradient: class {}}, init: () => ({resize() {}, setOption(value) { window.__chartOptions.push(value); }, dispatchAction() {}, dispose() {}})};
    window.Audio = class {constructor() {this.paused = true;} play() {this.paused = false; return Promise.resolve();} pause() {this.paused = true;} addEventListener() {}};
    window.alert = message => { (window.__alerts ||= []).push(message); };
    window.confirm = () => true;
    window.prompt = () => 'synthetic';
    window.fetch = async url => {
      const parsed = new URL(url);
      window.__requests.push({action: parsed.searchParams.get('action'), mode: parsed.searchParams.get('mode'), pobTime: parsed.searchParams.get('pob_time')});
      return {ok: true, status: 200, json: async () => ({status: 'success', data: []}), text: async () => 'OK'};
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4177/index.html');
  const initial = await page.evaluate(() => ({wind: document.getElementById('windSpeed').textContent, schedule: document.body.textContent.includes('DEMO-SHIP')}));
  if (initial.wind !== '4' || !initial.schedule) throw new Error(`Initial UI: ${JSON.stringify(initial)}`);
  await page.evaluate(async () => {openForecastModal(); await loadForecastData();});
  const forecast = await page.evaluate(() => ({drawn: window.__chartOptions.length > 0, status: document.getElementById('forecastStatus').textContent}));
  if (!forecast.drawn || !forecast.status.includes('10:00')) throw new Error(`Forecast UI: ${JSON.stringify(forecast)}`);
  await page.evaluate(() => {
    window.__emit('test/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 10});
    window.__emit('test/active_status', {app_mode: 'stop', current_wind: 4, forecast_updating: true});
  });
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Live lease must disable update');
  await page.clock.fastForward(5000);
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Valid lease must remain disabled');
  await page.evaluate(() => window.__emit('test/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 10}));
  await page.clock.fastForward(5000);
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Renewed lease must remain disabled');
  await page.evaluate(() => window.__emit('.info/serverTimeOffset', 6000));
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Server offset must expire lease immediately');
  await page.evaluate(() => {
    window.__emit('.info/serverTimeOffset', 0);
    window.__emit('test/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 5});
  });
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('New lease must disable update');
  await page.clock.fastForward(5000);
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Expired lease must restore update');
  await page.evaluate(() => {
    window.__emit('test/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 5});
    window.__emit('.info/serverTimeOffset', -5000);
  });
  await page.clock.fastForward(5000);
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Negative server offset must delay expiry');
  await page.clock.fastForward(5000);
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Lease must expire after negative offset');
  await page.evaluate(() => {
    window.__emit('.info/serverTimeOffset', 0);
    window.__emit('test/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 5});
    window.__emit('test/active_status', {app_mode: 'stop', forecast_updating: false});
  });
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Completed update must restore button');
  await page.evaluate(() => window.__emit('test/active_status', {app_mode: 'stop', forecast_updating: false, forecast_auto_failed: true}));
  if (!await page.locator('#forecastUpdateBtn').textContent().then(text => text.includes('請手動更新'))) throw new Error('Failed update must show manual retry');
  await page.evaluate(() => window.__emit('test/forecast_update_lock', null));
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Completed update with missing lease must remain enabled');
  await page.evaluate(() => {
    window.__emit('test/active_status', {app_mode: 'start', target_key: 'synthetic', ship_name: 'DEMO-SHIP', limit_speed: 12, terminal: 'W12', current_wind: 4});
    window.__emit(`test/daily_records/${window.__today}`, {synthetic: {config: {ship_name: 'DEMO-SHIP'}, pob_info: {pob_time: '10:00', formatted_msg: '示意 POB'}}});
  });
  const operations = await page.evaluate(() => ({monitor: document.getElementById('shipName').disabled, pob: document.getElementById('pobList').textContent.includes('DEMO-SHIP 已於 10:00 進港')}));
  if (!operations.monitor || !operations.pob || errors.length) throw new Error(JSON.stringify({operations, errors}));
  await page.evaluate(() => {window.__emit('test/active_status', {app_mode: 'stop', current_wind: 4});});
  if (await page.locator('#shipName').isDisabled()) throw new Error('Stop must unlock monitor inputs');
  const commands = await page.evaluate(async () => {
    cachedSessionPassword = 'synthetic';
    currentLockState = null;
    document.getElementById('shipName').value = 'DEMO-SHIP';
    document.getElementById('limitSpeed').value = '12';
    await setMode('start');
    cachedSessionPassword = 'synthetic';
    document.getElementById('pobTime').value = '10:00';
    await setMode('reset');
    await triggerManualArchive();
    return {commands: window.__requests.filter(item => item.action === 'set_mode' || item.action === 'archive_test'), alerts: window.__alerts,
      pob: document.getElementById('pobTime').value, reason: document.getElementById('noEntryReason').value};
  });
  if (!commands.commands.some(item => item.mode === 'start') || !commands.commands.some(item => item.mode === 'reset' && item.pobTime === '10:00') || !commands.commands.some(item => item.action === 'archive_test')) throw new Error(`Commands: ${JSON.stringify(commands)}`);
  if (errors.length) throw new Error(JSON.stringify(errors));
  return {externalServices: 'mocked', initial, forecast, operations, commands, expiredLeaseRecovered: true, errors};
}
