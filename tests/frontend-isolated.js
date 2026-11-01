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
      'test/schedule_list': [
        {d: monthDay, ship_name: 'DEMO-SHIP', limit_speed: 12, terminal: 'W12'},
        {d: monthDay, ship_name: 'DEMO-W13', limit_speed: 15, terminal: ''},
        {d: monthDay, ship_name: 'DEMO-EMPTY', limit_speed: 15},
      ],
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
  const badges = await page.evaluate(() => Array.from(document.querySelectorAll('#scheduleBody tr'), row => ({
    terminal: row.querySelector('.badge')?.textContent,
    color: row.querySelector('.badge') && getComputedStyle(row.querySelector('.badge')).backgroundColor,
  })));
  if (JSON.stringify(badges) !== JSON.stringify([
    {terminal: 'W12', color: 'rgb(255, 140, 0)'},
    {terminal: 'W13', color: 'rgb(36, 93, 152)'},
    {terminal: 'W13', color: 'rgb(36, 93, 152)'},
  ])) throw new Error(`Terminal badges: ${JSON.stringify(badges)}`);
  if (await page.locator('.badge-w13').first().evaluate(el => getComputedStyle(el).color) !== 'rgb(255, 255, 255)') throw new Error('W13 text must be white');
  const icon = await page.evaluate(() => {
    const icon = document.querySelector('.wind-icon').getBoundingClientRect();
    const unit = document.querySelector('.wind-speed-unit').getBoundingClientRect();
    const number = document.getElementById('windSpeed').getBoundingClientRect();
    return {aboveUnit: icon.bottom <= unit.top, rightOfNumber: icon.left >= number.right,
      alignedBottom: Math.abs(unit.bottom - (number.bottom - 6)) < 1,
      mask: getComputedStyle(document.querySelector('.wind-icon')).maskImage};
  });
  if (!icon.aboveUnit || !icon.rightOfNumber || !icon.alignedBottom || !icon.mask.includes('wind.svg')) throw new Error(`Wind icon: ${JSON.stringify(icon)}`);
  const conditions = await page.evaluate(() => {
    getCurrentTimeHHMM = () => '10:00';
    isSoundEnabled = true;
    const cases = [
      {wind: 10, wave: 2.5, visibility: 2, status: 'safe', reasons: 0},
      {wind: 10, wave: 2.51, visibility: 2, status: 'warning', reasons: 1},
      {wind: 10, wave: 2.5, visibility: 1.99, status: 'warning', reasons: 1},
      {wind: 10, wave: 2.51, visibility: 1.99, status: 'warning', reasons: 2},
      {wind: 13, wave: 2.5, visibility: 2, status: 'warning', reasons: 0},
      {wind: 13, wave: 2.51, visibility: 2, status: 'warning', reasons: 0},
      {wind: 13, wave: 2.5, visibility: 1.99, status: 'warning', reasons: 0},
      {wind: 13, wave: 2.51, visibility: 1.99, status: 'warning', reasons: 0},
      {wind: 10, wave: null, visibility: null, status: 'safe', reasons: 0},
      {wind: 10, wave: '', visibility: 0, status: 'warning', reasons: 1},
      {wind: 10, wave: 3, visibility: '未知', status: 'warning', reasons: 1},
    ];
    const results = cases.map(item => {
      window.__emit('test/active_status', {app_mode: 'start', ship_name: 'DEMO-SHIP', limit_speed: 12,
        season_time: '06:00', current_wind: item.wind, current_wave: item.wave, current_visibility: item.visibility});
      const box = document.getElementById('dynamicBox');
      const reasons = [...box.querySelectorAll('.condition-warning')];
      return {expected: item, status: currentStatus, text: box.textContent, reasons: reasons.length,
        images: reasons.map(row => row.querySelector('img')?.getAttribute('src')),
        highlighted: document.querySelector('#scheduleBody tr[data-shipname="DEMO-SHIP"]').className,
        soundPlaying: !notificationSound.paused};
    });
    isSoundEnabled = false;
    window.__emit('test/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:00'});
    return results;
  });
  for (const result of conditions) {
    if (result.status !== result.expected.status || result.reasons !== result.expected.reasons ||
        result.soundPlaying !== (result.status === 'safe') || !result.highlighted.includes(`schedule-row-${result.status}`)) {
      throw new Error(`Entry conditions: ${JSON.stringify(result)}`);
    }
    if (result.expected.wind > 12 && !result.text.includes('風速超標')) throw new Error(`Wind priority: ${JSON.stringify(result)}`);
    if (result.expected.wind <= 12 && typeof result.expected.wave === 'number' && result.expected.wave > 2.5 &&
        !result.text.includes(`浪高 ${result.expected.wave} > 2.5 m`)) throw new Error(`Wave value: ${JSON.stringify(result)}`);
    if (result.expected.wind <= 12 && typeof result.expected.visibility === 'number' && result.expected.visibility < 2 &&
        !result.text.includes(`能見度 ${result.expected.visibility} < 2 浬`)) throw new Error(`Visibility value: ${JSON.stringify(result)}`);
    if (result.expected.reasons === 2 && (result.images.join(',') !== '/APP_SVG/wave.svg,/APP_SVG/eye.svg' ||
        !result.text.includes('浪高 2.51 > 2.5 m') || !result.text.includes('能見度 1.99 < 2 浬'))) {
      throw new Error(`Entry warning details: ${JSON.stringify(result)}`);
    }
  }
  await page.locator('#windSpeed').click();
  if (!await page.locator('#forecastModal').isVisible()) throw new Error('Wind speed must open forecast');
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
