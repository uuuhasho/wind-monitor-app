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
      'formal/active_status': {app_mode: 'stop', current_wind: 4, last_update: '10:00', forecast_updating: false},
      'formal/schedule_list': [
        {d: monthDay, ship_name: 'DEMO-SHIP', limit_speed: 12, terminal: 'W12'},
        {d: monthDay, ship_name: 'DEMO-W13', limit_speed: 15, terminal: ''},
        {d: monthDay, ship_name: 'DEMO-EMPTY', limit_speed: 15},
      ],
      'formal/forecast_data': [
        {timestamp: `${today}T08:00:00+08:00`, cpc_wind_speed: 5, open_meteo_wind_speed: 6},
        {timestamp: `${today}T09:00:00+08:00`, cpc_wind_speed: 7, open_meteo_wind_speed: 8},
      ],
      'formal/forecast_metadata': {updatedAt: `${today}T02:00:00Z`},
    };
    const listeners = {};
    const snapshot = path => ({val: () => records[path] ?? null, exists: () => records[path] != null});
    window.__emit = (path, value) => { records[path] = value; (listeners[path] || []).forEach(callback => callback(snapshot(path))); };
    window.__requests = [];
    window.__chartOptions = [];
    window.__today = today;
    window.firebase = {
      apps: [], initializeApp() { this.apps.push({}); },
      database: () => ({ref: path => {
        if (!path.startsWith('formal/') && !path.startsWith('.info/')) throw new Error(`Unexpected Firebase path: ${path}`);
        return {
          on(_event, callback) { (listeners[path] ||= []).push(callback); callback(snapshot(path)); },
          off() { listeners[path] = []; }, once: async () => snapshot(path),
        };
      }}),
    };
    window.echarts = {graphic: {LinearGradient: class {}}, init: () => ({resize() {}, setOption(value) { window.__chartOptions.push(value); }, dispatchAction() {}, dispose() {}})};
    window.Audio = class {constructor() {this.paused = true;} play() {this.paused = false; return Promise.resolve();} pause() {this.paused = true;} addEventListener() {}};
    window.alert = message => { (window.__alerts ||= []).push(message); };
    window.confirm = () => true;
    window.prompt = () => 'synthetic';
    window.fetch = async url => {
      const parsed = new URL(url);
      window.__requests.push({
        action: parsed.searchParams.get('action'),
        mode: parsed.searchParams.get('mode'),
        pobTime: parsed.searchParams.get('pob_time'),
        modalType: parsed.searchParams.get('modal_type'),
      });
      return {ok: true, status: 200, json: async () => ({status: 'success', data: []}), text: async () => 'OK'};
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4177/index.html');
  const initial = await page.evaluate(() => ({title: document.title, wind: document.getElementById('windSpeed').textContent, schedule: document.body.textContent.includes('DEMO-SHIP')}));
  if (initial.title !== '臺中LNG船監控(v1.2.1)' || initial.wind !== '4' || !initial.schedule) throw new Error(`Initial UI: ${JSON.stringify(initial)}`);
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
    const svg = document.querySelector('.wind-icon');
    const iconRect = svg.getBoundingClientRect();
    const unit = document.querySelector('.wind-speed-unit').getBoundingClientRect();
    const number = document.getElementById('windSpeed').getBoundingClientRect();
    const msgHeading = document.querySelector('.schedule-header h3');
    const oldTableImport = document.querySelector('.pulso-table-import');
    const msgSvg = msgHeading.querySelector('svg.pulso-message-square-text');
    const msgRect = msgSvg.getBoundingClientRect();
    const gearSvg = document.querySelector('.cpc-btn.pulso-settings');
    const gearRect = gearSvg.getBoundingClientRect();
    return {
      aboveUnit: iconRect.bottom <= unit.top,
      rightOfNumber: iconRect.left >= number.right,
      alignedBottom: Math.abs(unit.bottom - (number.bottom - 6)) < 1,
      windTag: svg.tagName.toLowerCase(),
      mask: getComputedStyle(svg).maskImage,
      windBg: getComputedStyle(svg).backgroundColor,
      windColor: getComputedStyle(svg).color,
      windPaths: svg.querySelectorAll('path.pulso-wind-1, path.pulso-wind-2, path.pulso-wind-3').length,
      oldTableImportExists: Boolean(oldTableImport),
      msgText: msgHeading.textContent.trim(),
      msgRole: msgHeading.getAttribute('role'),
      msgOnclick: msgHeading.getAttribute('onclick'),
      msgTitle: msgHeading.getAttribute('title'),
      msgAriaLabel: msgHeading.getAttribute('aria-label'),
      msgCursor: getComputedStyle(msgHeading).cursor,
      msgSvgWidth: Math.round(msgRect.width),
      msgSvgHeight: Math.round(msgRect.height),
      msgColor: getComputedStyle(msgSvg).color,
      msgBubble: Boolean(msgSvg.querySelector('path.pulso-msg-bubble')),
      msgLines: msgSvg.querySelectorAll('path.pulso-msg-line-1, path.pulso-msg-line-2, path.pulso-msg-line-3').length,
      gearWidth: Math.round(gearRect.width),
      gearHeight: Math.round(gearRect.height),
      gearColor: getComputedStyle(gearSvg).color,
      gearGroup: Boolean(gearSvg.querySelector('.pulso-gear-group')),
    };
  });
  if (!icon.aboveUnit || !icon.rightOfNumber || !icon.alignedBottom || icon.windTag !== 'svg' ||
      icon.mask !== 'none' || icon.windBg !== 'rgba(0, 0, 0, 0)' || icon.windColor !== 'rgb(16, 69, 140)' ||
      icon.windPaths !== 3) {
    throw new Error(`Wind icon: ${JSON.stringify(icon)}`);
  }
  if (icon.oldTableImportExists || icon.msgText !== '' || icon.msgRole !== null || icon.msgOnclick !== null ||
      icon.msgTitle !== null || icon.msgAriaLabel !== '對話訊息（尚未開放）' || icon.msgCursor === 'pointer' ||
      icon.msgSvgWidth !== 32 || icon.msgSvgHeight !== 32 || icon.msgColor !== 'rgb(16, 69, 140)' ||
      !icon.msgBubble || icon.msgLines !== 3) {
    throw new Error(`Message icon: ${JSON.stringify(icon)}`);
  }
  if (icon.gearWidth !== 32 || icon.gearHeight !== 32 || icon.gearColor !== 'rgb(16, 69, 140)' || !icon.gearGroup) {
    throw new Error(`Gear icon: ${JSON.stringify(icon)}`);
  }
  const animStart = await page.evaluate(() => {
    const windContainer = document.querySelector('.wind-container');
    const windNum = document.getElementById('windSpeed');
    const msgHeading = document.querySelector('.schedule-header h3');
    const gearSvg = document.querySelector('.cpc-btn');
    windNum.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    msgHeading.dispatchEvent(new Event('pointerenter'));
    gearSvg.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
    return {
      windActive: windContainer.classList.contains('is-animating'),
      windAnim1: getComputedStyle(windContainer.querySelector('.pulso-wind-1')).animationName,
      windAnim2: getComputedStyle(windContainer.querySelector('.pulso-wind-2')).animationName,
      windAnim3: getComputedStyle(windContainer.querySelector('.pulso-wind-3')).animationName,
      windDelay3: getComputedStyle(windContainer.querySelector('.pulso-wind-3')).animationDelay,
      msgActive: msgHeading.classList.contains('is-animating'),
      msgBubbleAnim: getComputedStyle(msgHeading.querySelector('.pulso-msg-bubble')).animationName,
      msgLine1Anim: getComputedStyle(msgHeading.querySelector('.pulso-msg-line-1')).animationName,
      msgLine1Delay: getComputedStyle(msgHeading.querySelector('.pulso-msg-line-1')).animationDelay,
      msgLine2Delay: getComputedStyle(msgHeading.querySelector('.pulso-msg-line-2')).animationDelay,
      msgLine3Delay: getComputedStyle(msgHeading.querySelector('.pulso-msg-line-3')).animationDelay,
      gearActive: gearSvg.classList.contains('is-animating'),
      gearAnim: getComputedStyle(gearSvg.querySelector('.pulso-gear-group')).animationName,
    };
  });
  if (!animStart.windActive || animStart.windAnim1 !== 'pulso-slide-right' || animStart.windAnim2 !== 'pulso-slide-right' ||
      animStart.windAnim3 !== 'pulso-slide-right' || animStart.windDelay3 !== '0.12s' ||
      !animStart.msgActive || animStart.msgBubbleAnim !== 'pulso-press' || animStart.msgLine1Anim !== 'pulso-grow-x' ||
      animStart.msgLine1Delay !== '0.1s' || animStart.msgLine2Delay !== '0.16s' || animStart.msgLine3Delay !== '0.22s' ||
      !animStart.gearActive || animStart.gearAnim !== 'pulso-spin-180') {
    throw new Error(`Icon animation start: ${JSON.stringify(animStart)}`);
  }
  await page.clock.fastForward(750);
  const msgClearedAt750 = await page.evaluate(() => !document.querySelector('.schedule-header h3').classList.contains('is-animating'));
  if (!msgClearedAt750) throw new Error('Message icon animation did not clear after 700ms');
  await page.clock.fastForward(150);
  const animReplayAndLock = await page.evaluate(() => {
    const windContainer = document.querySelector('.wind-container');
    const msgHeading = document.querySelector('.schedule-header h3');
    const gearSvg = document.querySelector('.cpc-btn');
    const cleared = !windContainer.classList.contains('is-animating') &&
      !msgHeading.classList.contains('is-animating') &&
      !gearSvg.classList.contains('is-animating');
    windContainer.dispatchEvent(new Event('pointerenter'));
    msgHeading.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
    const replayed = windContainer.classList.contains('is-animating') && msgHeading.classList.contains('is-animating');
    gearSvg.classList.add('locked-btn');
    gearSvg.dispatchEvent(new Event('pointerenter'));
    const blockedWhenLocked = !gearSvg.classList.contains('is-animating');
    gearSvg.classList.remove('locked-btn');
    return {cleared, replayed, blockedWhenLocked};
  });
  if (!animReplayAndLock.cleared || !animReplayAndLock.replayed || !animReplayAndLock.blockedWhenLocked) {
    throw new Error(`Icon replay/lock: ${JSON.stringify(animReplayAndLock)}`);
  }
  await page.clock.fastForward(900);
  await page.emulateMedia({reducedMotion: 'reduce'});
  const reducedMotionAnim = await page.evaluate(() => {
    const msgHeading = document.querySelector('.schedule-header h3');
    msgHeading.classList.add('is-animating');
    const styles = {
      bubble: getComputedStyle(msgHeading.querySelector('.pulso-msg-bubble')).animationName,
      line1: getComputedStyle(msgHeading.querySelector('.pulso-msg-line-1')).animationName,
      line2: getComputedStyle(msgHeading.querySelector('.pulso-msg-line-2')).animationName,
      line3: getComputedStyle(msgHeading.querySelector('.pulso-msg-line-3')).animationName,
    };
    msgHeading.classList.remove('is-animating');
    msgHeading.dispatchEvent(new Event('pointerenter'));
    return {...styles, skippedClass: !msgHeading.classList.contains('is-animating')};
  });
  await page.emulateMedia({reducedMotion: 'no-preference'});
  if (reducedMotionAnim.bubble !== 'none' || reducedMotionAnim.line1 !== 'none' ||
      reducedMotionAnim.line2 !== 'none' || reducedMotionAnim.line3 !== 'none' || !reducedMotionAnim.skippedClass) {
    throw new Error(`Reduced motion: ${JSON.stringify(reducedMotionAnim)}`);
  }
  await page.locator('.schedule-header h3').click();
  const msgClickState = await page.evaluate(() => ({
    pwdVisible: getComputedStyle(document.getElementById('pwdModal')).display,
    adjustVisible: getComputedStyle(document.getElementById('scheduleAdjustModal')).display,
  }));
  if (msgClickState.pwdVisible !== 'none' || msgClickState.adjustVisible !== 'none') {
    throw new Error(`Message icon click must be a no-op: ${JSON.stringify(msgClickState)}`);
  }
  const headerStyles = await page.evaluate(() => {
    const row = document.getElementById('scheduleHeaderRow');
    const ths = Array.from(row.querySelectorAll('th'));
    return {
      rowTitle: row.hasAttribute('title'),
      ths: ths.map(th => ({
        text: th.textContent.trim(),
        userSelect: getComputedStyle(th).userSelect,
        touchAction: getComputedStyle(th).touchAction,
        cursor: getComputedStyle(th).cursor,
        hasTitle: th.hasAttribute('title'),
      })),
    };
  });
  if (headerStyles.rowTitle || headerStyles.ths.length !== 3 || headerStyles.ths.some(th =>
      th.userSelect !== 'none' || th.touchAction !== 'manipulation' || th.cursor === 'pointer' || th.hasTitle)) {
    throw new Error(`Schedule header styles: ${JSON.stringify(headerStyles)}`);
  }
  await page.locator('#scheduleHeaderRow th').nth(1).click();
  if (await page.locator('#pwdModal').isVisible() || await page.locator('#scheduleAdjustModal').isVisible()) {
    throw new Error('Single click on schedule header must not open modals');
  }
  const dispatchTap = async (dx = 0, dy = 0) => page.evaluate(({moveX, moveY}) => {
    const row = document.getElementById('scheduleHeaderRow');
    const rect = row.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const startTouch = new Touch({identifier: 1, target: row, clientX: x, clientY: y});
    row.dispatchEvent(new TouchEvent('touchstart', {bubbles: true, cancelable: true, touches: [startTouch], changedTouches: [startTouch]}));
    if (moveX || moveY) {
      const movedTouch = new Touch({identifier: 1, target: row, clientX: x + moveX, clientY: y + moveY});
      row.dispatchEvent(new TouchEvent('touchmove', {bubbles: true, cancelable: true, touches: [movedTouch], changedTouches: [movedTouch]}));
    }
    const endTouch = new Touch({identifier: 1, target: row, clientX: x + moveX, clientY: y + moveY});
    const endEvt = new TouchEvent('touchend', {bubbles: true, cancelable: true, touches: [], changedTouches: [endTouch]});
    row.dispatchEvent(endEvt);
    return endEvt.defaultPrevented;
  }, {moveX: dx, moveY: dy});
  await dispatchTap(0, 0);
  await page.clock.fastForward(400);
  await dispatchTap(0, 0);
  if (await page.locator('#pwdModal').isVisible()) throw new Error('Slow taps (>350ms) must not open password modal');
  await page.clock.fastForward(400);
  await dispatchTap(0, 18);
  await page.clock.fastForward(120);
  await dispatchTap(0, 18);
  if (await page.locator('#pwdModal').isVisible()) throw new Error('Scroll swipe taps (>12px) must not open password modal');
  await page.locator('#scheduleHeaderRow th').nth(1).dblclick();
  if (!await page.locator('#pwdModal').isVisible()) throw new Error('Double-click on schedule header must open password modal');
  await page.fill('#modalPwdInput', 'synthetic');
  await page.evaluate(() => closePwdModal(true));
  if (!await page.locator('#scheduleAdjustModal').isVisible()) throw new Error('Password confirmation must open schedule adjust modal');
  await page.waitForTimeout(0);
  const verifyReq = await page.evaluate(() => window.__requests.find(r => r.action === 'verify_password' && r.modalType === 'schedule'));
  if (!verifyReq) throw new Error('Expected verify_password request with modal_type=schedule');
  await page.evaluate(() => closeScheduleAdjustModal());
  if (await page.locator('#scheduleAdjustModal').isVisible()) throw new Error('Schedule adjust modal must close');
  await page.clock.fastForward(600);
  const tap1Prevented = await dispatchTap(0, 0);
  await page.clock.fastForward(120);
  const tap2Prevented = await dispatchTap(0, 0);
  if (tap1Prevented || !tap2Prevented || !await page.locator('#pwdModal').isVisible()) {
    throw new Error(`Touch double-tap failed: tap1Prevented=${tap1Prevented}, tap2Prevented=${tap2Prevented}`);
  }
  await page.clock.fastForward(80);
  const tap3Prevented = await dispatchTap(0, 0);
  if (tap3Prevented) throw new Error('Third tap immediately after double-tap must not re-trigger');
  await page.evaluate(() => closePwdModal(false));
  await page.clock.fastForward(5100);
  await page.evaluate(() => window.__emit('formal/editing_lock', {locked: true, locked_at: Date.now()}));
  const lockedState = await page.evaluate(() => {
    const row = document.getElementById('scheduleHeaderRow');
    const th = row.querySelector('th');
    const h3 = document.querySelector('.schedule-header h3');
    const cpc = document.querySelector('.cpc-btn');
    const bg = getComputedStyle(th).backgroundColor;
    const isOpaque = bg.startsWith('rgb(') || (bg.startsWith('rgba(') && bg.endsWith(', 1)'));
    return {
      rowLocked: row.classList.contains('locked-btn'),
      rowTitle: row.title,
      thCursor: getComputedStyle(th).cursor,
      thOpaque: isOpaque,
      h3Locked: h3.classList.contains('locked-btn'),
      h3HasOldTitle: h3.getAttribute('title') === '點擊調整船期',
      cpcLocked: cpc.classList.contains('locked-btn'),
    };
  });
  if (!lockedState.rowLocked || !lockedState.rowTitle.includes('🔒') || lockedState.thCursor !== 'not-allowed' ||
      !lockedState.thOpaque || lockedState.h3Locked || lockedState.h3HasOldTitle || !lockedState.cpcLocked) {
    throw new Error(`Locked UI transfer: ${JSON.stringify(lockedState)}`);
  }
  const lockedAlertTest = await page.evaluate(() => {
    const row = document.getElementById('scheduleHeaderRow');
    const rect = row.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const origNow = Date.now;
    const origAlert = window.alert;
    const beforeCount = (window.__alerts || []).length;
    let extra = 0;
    try {
      Date.now = () => origNow() + extra;
      window.alert = msg => {
        origAlert(msg);
        extra += 600;
      };
      const t1 = new Touch({identifier: 1, target: row, clientX: x, clientY: y});
      row.dispatchEvent(new TouchEvent('touchstart', {bubbles: true, cancelable: true, touches: [t1], changedTouches: [t1]}));
      row.dispatchEvent(new TouchEvent('touchend', {bubbles: true, cancelable: true, touches: [], changedTouches: [t1]}));
      extra += 120;
      const t2 = new Touch({identifier: 1, target: row, clientX: x, clientY: y});
      row.dispatchEvent(new TouchEvent('touchstart', {bubbles: true, cancelable: true, touches: [t2], changedTouches: [t2]}));
      row.dispatchEvent(new TouchEvent('touchend', {bubbles: true, cancelable: true, touches: [], changedTouches: [t2]}));
      row.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}));
      const newAlerts = (window.__alerts || []).slice(beforeCount);
      return {newAlertCount: newAlerts.length, alertText: newAlerts[0] || '', pwdDisplay: getComputedStyle(document.getElementById('pwdModal')).display};
    } finally {
      Date.now = origNow;
      window.alert = origAlert;
    }
  });
  if (lockedAlertTest.newAlertCount !== 1 || !lockedAlertTest.alertText.includes('🔒') || lockedAlertTest.pwdDisplay !== 'none') {
    throw new Error(`Locked double-tap/dblclick suppression: ${JSON.stringify(lockedAlertTest)}`);
  }
  await page.evaluate(() => window.__emit('formal/editing_lock', null));
  const unlockedRow = await page.evaluate(() => {
    const row = document.getElementById('scheduleHeaderRow');
    return {locked: row.classList.contains('locked-btn'), hasTitle: row.hasAttribute('title')};
  });
  if (unlockedRow.locked || unlockedRow.hasTitle) throw new Error(`Unlocked schedule header: ${JSON.stringify(unlockedRow)}`);
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
      window.__emit('formal/active_status', {app_mode: 'start', ship_name: 'DEMO-SHIP', limit_speed: 12,
        season_time: '06:00', current_wind: item.wind, current_wave: item.wave, current_visibility: item.visibility});
      const box = document.getElementById('dynamicBox');
      const reasons = [...box.querySelectorAll('.condition-warning')];
      return {expected: item, status: currentStatus, text: box.textContent, reasons: reasons.length,
        images: reasons.map(row => row.querySelector('img')?.getAttribute('src')),
        highlighted: document.querySelector('#scheduleBody tr[data-shipname="DEMO-SHIP"]').className,
        soundPlaying: !notificationSound.paused};
    });
    isSoundEnabled = false;
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:00'});
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
    window.__emit('formal/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 10});
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, forecast_updating: true});
  });
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Live lease must disable update');
  await page.clock.fastForward(5000);
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Valid lease must remain disabled');
  await page.evaluate(() => window.__emit('formal/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 10}));
  await page.clock.fastForward(5000);
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Renewed lease must remain disabled');
  await page.evaluate(() => window.__emit('.info/serverTimeOffset', 6000));
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Server offset must expire lease immediately');
  await page.evaluate(() => {
    window.__emit('.info/serverTimeOffset', 0);
    window.__emit('formal/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 5});
  });
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('New lease must disable update');
  await page.clock.fastForward(5000);
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Expired lease must restore update');
  await page.evaluate(() => {
    window.__emit('formal/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 5});
    window.__emit('.info/serverTimeOffset', -5000);
  });
  await page.clock.fastForward(5000);
  if (!await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Negative server offset must delay expiry');
  await page.clock.fastForward(5000);
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Lease must expire after negative offset');
  await page.evaluate(() => {
    window.__emit('.info/serverTimeOffset', 0);
    window.__emit('formal/forecast_update_lock', {owner: 'synthetic', expiresAt: Date.now() / 1000 + 5});
    window.__emit('formal/active_status', {app_mode: 'stop', forecast_updating: false});
  });
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Completed update must restore button');
  await page.evaluate(() => window.__emit('formal/active_status', {app_mode: 'stop', forecast_updating: false, forecast_auto_failed: true}));
  if (!await page.locator('#forecastUpdateBtn').textContent().then(text => text.includes('請手動更新'))) throw new Error('Failed update must show manual retry');
  await page.evaluate(() => window.__emit('formal/forecast_update_lock', null));
  if (await page.locator('#forecastUpdateBtn').isDisabled()) throw new Error('Completed update with missing lease must remain enabled');
  await page.evaluate(() => {
    window.__emit('formal/active_status', {app_mode: 'start', target_key: 'synthetic', ship_name: 'DEMO-SHIP', limit_speed: 12, terminal: 'W12', current_wind: 4});
    window.__emit(`formal/daily_records/${window.__today}`, {synthetic: {config: {ship_name: 'DEMO-SHIP'}, pob_info: {pob_time: '10:00', formatted_msg: '示意 POB'}}});
  });
  const operations = await page.evaluate(() => ({monitor: document.getElementById('shipName').disabled, pob: document.getElementById('pobList').textContent.includes('DEMO-SHIP 已於 10:00 進港')}));
  if (!operations.monitor || !operations.pob || errors.length) throw new Error(JSON.stringify({operations, errors}));
  await page.evaluate(() => {window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4});});
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
    return {commands: window.__requests.filter(item => item.action === 'set_mode'), alerts: window.__alerts,
      pob: document.getElementById('pobTime').value, reason: document.getElementById('noEntryReason').value};
  });
  if (!commands.commands.some(item => item.mode === 'start') || !commands.commands.some(item => item.mode === 'reset' && item.pobTime === '10:00')) throw new Error(`Commands: ${JSON.stringify(commands)}`);
  if (errors.length) throw new Error(JSON.stringify(errors));
  return {externalServices: 'mocked', initial, forecast, operations, commands, expiredLeaseRecovered: true, errors};
}
