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
    const tree = {};
    window.__onDisconnectHooks = new Map();
    const cloneVal = val => (val === undefined ? null : JSON.parse(JSON.stringify(val)));
    const splitPath = p => p.split('/').filter(Boolean);
    const getTree = path => {
      const parts = splitPath(path);
      let cur = tree;
      for (const part of parts) {
        if (cur == null || typeof cur !== 'object') return null;
        cur = cur[part];
      }
      return cur === undefined ? null : cloneVal(cur);
    };
    const setTree = (path, value) => {
      const parts = splitPath(path);
      if (!parts.length) return;
      if (value === null || value === undefined) {
        let cur = tree;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') return;
          cur = cur[parts[i]];
        }
        delete cur[parts[parts.length - 1]];
        return;
      }
      let cur = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = cloneVal(value);
    };
    const snapshot = path => {
      const val = getTree(path);
      return {val: () => cloneVal(val), exists: () => val != null};
    };
    const notifyPath = path => {
      Object.keys(listeners).forEach(listenerPath => {
        if (listenerPath === path || path.startsWith(listenerPath + '/') || listenerPath.startsWith(path + '/')) {
          const snap = snapshot(listenerPath);
          (listeners[listenerPath] || []).forEach(callback => callback(snap));
        }
      });
    };
    Object.entries(records).forEach(([k, v]) => setTree(k, v));
    window.__emit = (path, value) => { setTree(path, value); notifyPath(path); };
    window.__getDb = path => getTree(path);
    window.__requests = [];
    window.__chartOptions = [];
    window.__today = today;
    window.firebase = {
      apps: [], initializeApp() { this.apps.push({}); },
      database: () => ({ref: path => {
        if (!path.startsWith('formal/') && !path.startsWith('.info/')) throw new Error(`Unexpected Firebase path: ${path}`);
        return {
          on(_event, callback) { (listeners[path] ||= []).push(callback); callback(snapshot(path)); },
          off(_event, callback) {
            if (callback && listeners[path]) listeners[path] = listeners[path].filter(fn => fn !== callback);
            else listeners[path] = [];
          },
          once: async () => snapshot(path),
          set: async value => { setTree(path, value); notifyPath(path); },
          remove: async () => { setTree(path, null); notifyPath(path); },
          transaction: async updateFn => {
            const cur = getTree(path);
            const next = updateFn(cloneVal(cur));
            if (next === undefined) return {committed: false, snapshot: snapshot(path)};
            setTree(path, next);
            notifyPath(path);
            return {committed: true, snapshot: snapshot(path)};
          },
          onDisconnect: () => ({
            remove: async () => { window.__onDisconnectHooks.set(path, true); },
            cancel: async () => { window.__onDisconnectHooks.delete(path); },
          }),
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
  if (initial.title !== '臺中LNG船監控(v1.3)' || initial.wind !== '4' || !initial.schedule) throw new Error(`Initial UI: ${JSON.stringify(initial)}`);
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
      unreadBadgeDisplay: getComputedStyle(document.getElementById('chatUnreadBadge')).display,
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
  if (icon.oldTableImportExists || icon.msgRole !== 'button' || icon.msgOnclick !== 'openChatModal()' ||
      icon.msgTitle !== null || icon.msgAriaLabel !== '開啟接船對話' || icon.msgCursor !== 'pointer' ||
      icon.unreadBadgeDisplay !== 'none' || icon.msgSvgWidth !== 32 || icon.msgSvgHeight !== 32 ||
      icon.msgColor !== 'rgb(16, 69, 140)' || !icon.msgBubble || icon.msgLines !== 3) {
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
    chatVisible: getComputedStyle(document.getElementById('chatModal')).display,
    pwdVisible: getComputedStyle(document.getElementById('pwdModal')).display,
    adjustVisible: getComputedStyle(document.getElementById('scheduleAdjustModal')).display,
  }));
  if (msgClickState.chatVisible !== 'flex' || msgClickState.pwdVisible !== 'none' || msgClickState.adjustVisible !== 'none') {
    throw new Error(`Message icon click must open chatModal only: ${JSON.stringify(msgClickState)}`);
  }
  await page.locator('#chatCloseBtn').click();
  if (await page.locator('#chatModal').isVisible()) {
    throw new Error('chatModal must close before scheduleHeaderRow double-tap test');
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

  // ==================== Ship Chat Room Tests (AC-001 ~ AC-004) ====================
  await page.evaluate(() => {
    if (typeof closeForecastModal === 'function') closeForecastModal();
    localStorage.clear();
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}`, null);
    window.__emit(`formal/chat_attachments/${d}`, null);
  });

  // AC-001: Unread static red "!" lifecycle & no red border/animation
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/messages`, {
      m1: {id: 'm1', ts: 10000, timeStr: '08:00', roleId: 'CPCLNG', roleLabel: 'CPCLNG-1', clientId: 'other-1', text: '早安，引水梯備便'},
    });
  });
  const unread1 = await page.evaluate(() => {
    const badge = document.getElementById('chatUnreadBadge');
    const btn = document.getElementById('chatOpenBtn');
    const bs = getComputedStyle(badge);
    const hs = getComputedStyle(btn);
    return {text: badge.textContent.trim(), display: bs.display, color: bs.color, anim: bs.animationName, btnBorder: hs.borderStyle};
  });
  if (unread1.text !== '!' || unread1.display === 'none' || unread1.color !== 'rgb(220, 38, 38)' ||
      unread1.anim !== 'none' || unread1.btnBorder !== 'none') {
    throw new Error(`AC-001 badge initial unread: ${JSON.stringify(unread1)}`);
  }

  await page.locator('#chatOpenBtn').click();
  const afterOpenUnread = await page.evaluate(() => ({
    modalDisplay: getComputedStyle(document.getElementById('chatModal')).display,
    badgeDisplay: getComputedStyle(document.getElementById('chatUnreadBadge')).display,
    seatsVal: window.__getDb(`formal/chat_rooms/${window.__today}/seats`),
    spectatorVisible: getComputedStyle(document.getElementById('chatSpectatorBar')).display,
    composerVisible: getComputedStyle(document.getElementById('chatActiveComposer')).display,
    titleText: document.getElementById('chatModalTitle').textContent.trim(),
    titleIconSrc: document.querySelector('#chatModalTitle img')?.getAttribute('src') || '',
  }));
  if (afterOpenUnread.modalDisplay !== 'flex' || afterOpenUnread.badgeDisplay !== 'none' ||
      afterOpenUnread.seatsVal !== null || afterOpenUnread.spectatorVisible !== 'block' ||
      afterOpenUnread.composerVisible !== 'none' ||
      afterOpenUnread.titleText !== '即時溝通' || afterOpenUnread.titleIconSrc !== 'talk.png') {
    throw new Error(`AC-001/AC-002 open spectator state: ${JSON.stringify(afterOpenUnread)}`);
  }

  // Receive new message while modal open -> read marker updates, closing stays hidden
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/messages`, {
      m1: {id: 'm1', ts: 10000, timeStr: '08:00', roleId: 'CPCLNG', roleLabel: 'CPCLNG-1', clientId: 'other-1', text: '早安，引水梯備便'},
      m2: {id: 'm2', ts: 20000, timeStr: '08:05', roleId: 'Pilot', roleLabel: 'Pilot-1', clientId: 'other-2', text: '已登輪'},
    });
  });
  await page.locator('#chatCloseBtn').click();
  if (await page.evaluate(() => getComputedStyle(document.getElementById('chatUnreadBadge')).display) !== 'none') {
    throw new Error('AC-001: Badge must remain hidden after closing modal when newest msg was read while open');
  }
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/messages/m3`, {
      id: 'm3', ts: 30000, timeStr: '08:06', roleId: 'VTS', roleLabel: 'VTS-1', clientId: 'other-3', text: '進入外港航道',
    });
  });
  if (await page.evaluate(() => getComputedStyle(document.getElementById('chatUnreadBadge')).display) === 'none') {
    throw new Error('AC-001: Badge must reappear when new message arrives after closing modal');
  }

  // AC-002: Seats allocation (-1 / -2 / 2/2滿 / full switch keeps old seat / 15-min overwrite safe / midnight release)
  await page.locator('#chatOpenBtn').click();
  await page.locator('.chat-role-btn[data-role-id="CPCLNG"]').click();
  await page.waitForFunction(() => document.getElementById('chatIdentityText').textContent.includes('CPCLNG-1'));
  const seatState1 = await page.evaluate(() => ({
    seat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPCLNG_1`),
    hookArmed: window.__onDisconnectHooks.has(`formal/chat_rooms/${window.__today}/seats/CPCLNG_1`),
    composerVisible: getComputedStyle(document.getElementById('chatActiveComposer')).display,
  }));
  if (!seatState1.seat || seatState1.seat.roleLabel !== 'CPCLNG-1' || !seatState1.hookArmed || seatState1.composerVisible !== 'flex') {
    throw new Error(`AC-002 claim CPCLNG-1: ${JSON.stringify(seatState1)}`);
  }

  // Fill Pilot 2/2 and verify clicking Pilot preserves existing CPCLNG-1 seat
  await page.evaluate(() => {
    const d = window.__today;
    const now = getServerNow();
    window.__emit(`formal/chat_rooms/${d}/seats/Pilot_1`, {clientId: 'p1', roleId: 'Pilot', roleLabel: 'Pilot-1', slot: 1, activeAt: now});
    window.__emit(`formal/chat_rooms/${d}/seats/Pilot_2`, {clientId: 'p2', roleId: 'Pilot', roleLabel: 'Pilot-2', slot: 2, activeAt: now});
  });
  await page.locator('.chat-role-btn[data-role-id="Pilot"]').click();
  await page.waitForFunction(() => document.getElementById('chatStatusBanner').textContent.includes('2/2 滿'));
  const fullSwitch = await page.evaluate(() => ({
    banner: document.getElementById('chatStatusBanner').textContent,
    idText: document.getElementById('chatIdentityText').textContent,
    cpcSeat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPCLNG_1`),
    pilotText: document.querySelector('.chat-role-btn[data-role-id="Pilot"] .chat-role-count').textContent,
  }));
  if (!fullSwitch.banner.includes('2/2 滿') || !fullSwitch.idText.includes('CPCLNG-1') ||
      !fullSwitch.cpcSeat || fullSwitch.pilotText !== '2/2 滿') {
    throw new Error(`AC-002 full switch preserve: ${JSON.stringify(fullSwitch)}`);
  }

  // Switch to Tug -> claims Tug-1 and releases CPCLNG-1 safely; then simulate remote overwrite without losing new owner
  await page.locator('.chat-role-btn[data-role-id="Tug"]').click();
  await page.waitForFunction(() => document.getElementById('chatIdentityText').textContent.includes('拖船-1'));
  const switchedSeat = await page.evaluate(() => ({
    oldSeat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPCLNG_1`),
    newSeat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/Tug_1`),
    oldHook: window.__onDisconnectHooks.has(`formal/chat_rooms/${window.__today}/seats/CPCLNG_1`),
    newHook: window.__onDisconnectHooks.has(`formal/chat_rooms/${window.__today}/seats/Tug_1`),
  }));
  if (switchedSeat.oldSeat !== null || switchedSeat.oldHook || !switchedSeat.newSeat || !switchedSeat.newHook) {
    throw new Error(`AC-002 switch release old: ${JSON.stringify(switchedSeat)}`);
  }

  // Remote overwrite on Tug_1 must forfeit local seat and cancel Tug_1 onDisconnect without deleting takeover user
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/seats/Tug_1`, {
      clientId: 'takeover-other', roleId: 'Tug', roleLabel: '拖船-1', slot: 1, activeAt: getServerNow(),
    });
  });
  await page.waitForFunction(() => document.getElementById('chatIdentityText').textContent.includes('旁觀模式'));
  const afterTakeover = await page.evaluate(() => ({
    remoteSeat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/Tug_1`),
    hookStillArmed: window.__onDisconnectHooks.has(`formal/chat_rooms/${window.__today}/seats/Tug_1`),
  }));
  if (!afterTakeover.remoteSeat || afterTakeover.remoteSeat.clientId !== 'takeover-other' || afterTakeover.hookStillArmed) {
    throw new Error(`AC-002 takeover safety: ${JSON.stringify(afterTakeover)}`);
  }

  // Reclaim expired Pilot_1 (>15 min idle) & verify leave/midnight rollover cleanup
  await page.evaluate(() => {
    const d = window.__today;
    const stale = getServerNow() - (15 * 60 * 1000 + 5000);
    window.__emit(`formal/chat_rooms/${d}/seats/Pilot_1`, {
      clientId: 'stale-pilot', roleId: 'Pilot', roleLabel: 'Pilot-1', slot: 1, activeAt: stale,
    });
  });
  await page.locator('.chat-role-btn[data-role-id="Pilot"]').click();
  await page.waitForFunction(() => document.getElementById('chatIdentityText').textContent.includes('Pilot-1'));
  await page.locator('#chatLeaveRoleBtn').click();
  await page.waitForFunction(() => document.getElementById('chatIdentityText').textContent.includes('旁觀模式'));
  if (await page.evaluate(() => window.__getDb(`formal/chat_rooms/${window.__today}/seats/Pilot_1`)) !== null) {
    throw new Error('AC-002: leaveChatRole must delete owned seat');
  }

  // AC-003: Neutral #f4f4f5 background, 5 high-contrast left stripes, self #10458C right-aligned, XSS immunity
  await page.locator('.chat-role-btn[data-role-id="Agent"]').click();
  await page.waitForFunction(() => document.getElementById('chatIdentityText').textContent.includes('Agent-1'));
  await page.fill('#chatTextInput', '報告進港 <img src=x onerror="window.__xss=1">');
  await page.locator('#chatSendBtn').click();
  await page.waitForFunction(() => {
    const msgs = window.__getDb(`formal/chat_rooms/${window.__today}/messages`) || {};
    return Object.values(msgs).some(m => m.text && m.text.includes('<img src=x'));
  });
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/messages`, {
      o1: {id: 'o1', ts: 40001, timeStr: '09:01', roleId: 'CPCLNG', roleLabel: 'CPCLNG-1', clientId: 'other-c', text: 'CPC'},
      o2: {id: 'o2', ts: 40002, timeStr: '09:02', roleId: 'Pilot', roleLabel: 'Pilot-2', clientId: 'other-p', text: 'Pilot'},
      o3: {id: 'o3', ts: 40003, timeStr: '09:03', roleId: 'VTS', roleLabel: 'VTS-1', clientId: 'other-v', text: 'VTS'},
      o4: {id: 'o4', ts: 40004, timeStr: '09:04', roleId: 'Agent', roleLabel: 'Agent-2', clientId: 'other-a', text: 'Agent'},
      o5: {id: 'o5', ts: 40005, timeStr: '09:05', roleId: 'Tug', roleLabel: '拖船-1', clientId: 'other-t', text: 'Tug'},
      ...window.__getDb(`formal/chat_rooms/${d}/messages`),
    });
  });
  const ac3 = await page.evaluate(() => {
    const container = document.getElementById('chatMessagesContainer');
    const rows = Array.from(container.querySelectorAll('.chat-msg-row'));
    const others = ['CPC', 'Pilot', 'VTS', 'Agent', 'Tug'].map(txt => {
      const r = rows.find(row => row.querySelector('.chat-msg-text')?.textContent === txt);
      const b = r && r.querySelector('.chat-bubble');
      const s = b && getComputedStyle(b);
      return r ? {isOther: r.classList.contains('is-other'), bg: s.backgroundColor, blw: s.borderLeftWidth, blc: s.borderLeftColor} : null;
    });
    const selfRow = rows.find(r => r.classList.contains('is-self'));
    const selfBubble = selfRow && selfRow.querySelector('.chat-bubble');
    return {
      xssTriggered: Boolean(window.__xss),
      areaBg: getComputedStyle(container).backgroundColor,
      others,
      selfText: selfBubble ? selfBubble.textContent : '',
      selfBg: selfBubble ? getComputedStyle(selfBubble).backgroundColor : '',
    };
  });
  const expectedBorders = ['rgb(29, 78, 216)', 'rgb(124, 58, 237)', 'rgb(5, 150, 105)', 'rgb(234, 88, 12)', 'rgb(190, 18, 60)'];
  if (ac3.xssTriggered || ac3.areaBg !== 'rgb(244, 244, 245)' ||
      ac3.others.some((o, i) => !o || !o.isOther || o.bg !== 'rgb(255, 255, 255)' || o.blw !== '5px' || o.blc !== expectedBorders[i]) ||
      ac3.selfBg !== 'rgb(16, 69, 140)' || !ac3.selfText.includes('<img src=x')) {
    throw new Error(`AC-003 styles/XSS: ${JSON.stringify(ac3)}`);
  }

  // AC-004: Valid oversized-dimension image compression (1600x800 -> 1280px JPEG) & PDF upload, #chatPreviewModal (z-index 2100), SVG & >2.5MB rejection
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(0, 0, 1600, 800);
    const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([pngBlob], 'berth.png', {type: 'image/png'}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => document.querySelectorAll('.chat-att-thumb-img').length > 0);
  await page.locator('.chat-att-thumb-btn').first().click();
  await page.waitForFunction(() => !document.getElementById('chatPreviewDownload').classList.contains('is-disabled'));
  await page.waitForFunction(() => {
    const img = document.querySelector('#chatPreviewBody img.chat-preview-img');
    return Boolean(img && img.complete && img.naturalWidth > 0);
  });
  const imgPreview = await page.evaluate(() => {
    const m = document.getElementById('chatPreviewModal');
    const dl = document.getElementById('chatPreviewDownload');
    const img = document.querySelector('#chatPreviewBody img.chat-preview-img');
    return {
      display: getComputedStyle(m).display,
      zIndex: getComputedStyle(m).zIndex,
      href: dl.getAttribute('href') || '',
      hasImg: Boolean(img),
      naturalWidth: img ? img.naturalWidth : 0,
      naturalHeight: img ? img.naturalHeight : 0,
      inputVal: document.getElementById('chatFileInput').value,
    };
  });
  if (imgPreview.display !== 'flex' || Number(imgPreview.zIndex) < 2100 ||
      !imgPreview.href.startsWith('data:image/jpeg;base64,') || !imgPreview.hasImg ||
      imgPreview.naturalWidth !== 1280 || imgPreview.naturalHeight !== 640 || imgPreview.inputVal !== '') {
    throw new Error(`AC-004 image preview: ${JSON.stringify(imgPreview)}`);
  }
  await page.locator('#chatPreviewCloseBtn').click();

  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'], 'plan.pdf', {type: 'application/pdf'}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => document.querySelectorAll('.chat-att-file-btn').length > 0);
  await page.locator('.chat-att-file-btn').first().click();
  await page.waitForFunction(() => !document.getElementById('chatPreviewDownload').classList.contains('is-disabled'));
  const pdfPreview = await page.evaluate(() => ({
    title: document.getElementById('chatPreviewTitle').textContent,
    href: document.getElementById('chatPreviewDownload').getAttribute('href') || '',
  }));
  if (pdfPreview.title !== 'plan.pdf' || !pdfPreview.href.startsWith('data:application/pdf;base64,')) {
    throw new Error(`AC-004 PDF preview: ${JSON.stringify(pdfPreview)}`);
  }
  await page.locator('#chatPreviewCloseBtn').click();

  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['<svg onload="window.__xss=2"></svg>'], 'bad.svg', {type: 'image/svg+xml'}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => document.getElementById('chatStatusBanner').style.display === 'block');
  const blockedSvg = await page.evaluate(() => ({
    banner: document.getElementById('chatStatusBanner').textContent,
    inputVal: document.getElementById('chatFileInput').value,
    xss: Boolean(window.__xss),
  }));
  if (!blockedSvg.banner.includes('SVG') || blockedSvg.inputVal !== '' || blockedSvg.xss) {
    throw new Error(`AC-004 SVG block: ${JSON.stringify(blockedSvg)}`);
  }

  await page.evaluate(() => {
    const bigBytes = new Uint8Array(2700000);
    bigBytes.fill(65);
    const dt = new DataTransfer();
    dt.items.add(new File([bigBytes], 'huge.pdf', {type: 'application/pdf'}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => document.getElementById('chatStatusBanner').textContent.includes('2.5 MB'));
  if (await page.evaluate(() => document.getElementById('chatFileInput').value) !== '') {
    throw new Error('AC-004 oversized file must clear fileInput');
  }

  // Delivery F-002 / F-004 (1): empty-MIME & octet-stream .csv uploads normalize to data:text/csv;base64,... and preview cleanly
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['colA,colB\n1,2'], 'notes.csv', {type: ''}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.chat-att-file-btn')).some(btn => btn.textContent.includes('notes.csv'))
  );
  const csvAttStored = await page.evaluate(() => {
    const atts = window.__getDb(`formal/chat_attachments/${window.__today}`) || {};
    return Object.values(atts).some(a => a && a.name === 'notes.csv' && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:text/csv;base64,'));
  });
  if (!csvAttStored) throw new Error('F-002 empty-MIME notes.csv must store normalized data:text/csv;base64 URI');
  await page.locator('.chat-att-file-btn', {hasText: 'notes.csv'}).click();
  await page.waitForFunction(() => {
    const m = document.getElementById('chatPreviewModal');
    const dl = document.getElementById('chatPreviewDownload');
    return m && getComputedStyle(m).display === 'flex' && dl && !dl.classList.contains('is-disabled') && (dl.getAttribute('href') || '').startsWith('data:text/csv;base64,');
  });
  await page.locator('#chatPreviewCloseBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatPreviewModal')).display === 'none');

  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x,y\n3,4'], 'octet.csv', {type: 'application/octet-stream'}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.chat-att-file-btn')).some(btn => btn.textContent.includes('octet.csv'))
  );
  const octetCsvStored = await page.evaluate(() => {
    const atts = window.__getDb(`formal/chat_attachments/${window.__today}`) || {};
    return Object.values(atts).some(a => a && a.name === 'octet.csv' && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:text/csv;base64,'));
  });
  if (!octetCsvStored) throw new Error('F-004 octet-stream octet.csv must store normalized data:text/csv;base64 URI');
  await page.locator('.chat-att-file-btn', {hasText: 'octet.csv'}).click();
  await page.waitForFunction(() => {
    const m = document.getElementById('chatPreviewModal');
    const dl = document.getElementById('chatPreviewDownload');
    return m && getComputedStyle(m).display === 'flex' && dl && !dl.classList.contains('is-disabled') && (dl.getAttribute('href') || '').startsWith('data:text/csv;base64,');
  });
  await page.locator('#chatPreviewCloseBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatPreviewModal')).display === 'none');

  // Delivery F-004 (2): application/octet-stream, spoofed csv, and blocked extension downloads must all be refused in preview modal
  await page.evaluate(() => {
    const d = window.__today;
    const cases = [
      {attId: 'att_bad', msgId: 'msg_bad', meta: {id: 'att_bad', name: 'evil.exe', mimeType: 'application/octet-stream', size: 4, isImage: false}, dataUrl: 'data:application/octet-stream;base64,TVqQ'},
      {attId: 'att_bad2', msgId: 'msg_bad2', meta: {id: 'att_bad2', name: 'spoof.csv', mimeType: 'application/octet-stream', size: 4, isImage: false}, dataUrl: 'data:application/octet-stream;base64,TVqQ'},
      {attId: 'att_bad3', msgId: 'msg_bad3', meta: {id: 'att_bad3', name: 'bad.exe', mimeType: 'application/pdf', size: 12, isImage: false}, dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ='},
    ];
    cases.forEach((c, idx) => {
      window.__emit(`formal/chat_attachments/${d}/${c.attId}`, {
        ...c.meta,
        dataUrl: c.dataUrl,
        ts: Date.now() + 50 + idx,
        uploadedBy: 'VTS-1',
      });
      window.__emit(`formal/chat_rooms/${d}/messages/${c.msgId}`, {
        id: c.msgId,
        ts: Date.now() + 50 + idx,
        timeStr: '12:30',
        roleId: 'VTS',
        roleLabel: 'VTS-1',
        clientId: 'other_bad_client',
        text: '',
        attachment: c.meta,
      });
    });
  });
  for (const blockedName of ['evil.exe', 'spoof.csv', 'bad.exe']) {
    await page.waitForFunction(name =>
      Array.from(document.querySelectorAll('.chat-att-file-btn')).some(btn => btn.textContent.includes(name)),
    blockedName);
    await page.locator('.chat-att-file-btn', {hasText: blockedName}).click();
    await page.waitForFunction(() => {
      const m = document.getElementById('chatPreviewModal');
      const dl = document.getElementById('chatPreviewDownload');
      const body = document.getElementById('chatPreviewBody');
      return m && getComputedStyle(m).display === 'flex' &&
        body && body.textContent.includes('未通過安全格式檢查') &&
        dl && dl.classList.contains('is-disabled') && !dl.getAttribute('href');
    });
    await page.locator('#chatPreviewCloseBtn').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('chatPreviewModal')).display === 'none');
  }

  // Delivery F-003 (1): leave seat via close -> reopen in spectator mode -> rejected transaction displays status banner error
  await page.locator('#chatCloseBtn').click();
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('chatModal')).display === 'none' &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/Agent_1`) === null
  );
  await page.locator('#chatOpenBtn').click();
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('chatModal')).display === 'flex' &&
    document.getElementById('chatIdentityText').textContent.includes('旁觀模式')
  );
  await page.evaluate(() => {
    const targetDb = typeof db !== 'undefined' ? db : firebase.database();
    window.__origDbRef = targetDb.ref.bind(targetDb);
    targetDb.ref = function (path) {
      const refObj = window.__origDbRef(path);
      if (typeof path === 'string' && path.includes('/seats/')) {
        const origTx = refObj.transaction.bind(refObj);
        refObj.transaction = function (updater) {
          if (window.__txTestMode === 'reject') {
            return Promise.reject(new Error('PERMISSION_DENIED'));
          }
          if (window.__txTestMode === 'delay') {
            const p = origTx(updater);
            return new Promise((resolve, reject) => {
              window.__flushDelayedTx = () => p.then(resolve, reject);
            });
          }
          return origTx(updater);
        };
      }
      return refObj;
    };
    window.__txTestMode = 'reject';
  });
  await page.locator('.chat-role-btn[data-role-id="VTS"]').click();
  await page.waitForFunction(() => {
    const banner = document.getElementById('chatStatusBanner');
    return banner && getComputedStyle(banner).display === 'block' &&
      banner.textContent.includes('PERMISSION_DENIED') &&
      document.getElementById('chatIdentityText').textContent.includes('旁觀模式');
  });

  // Delivery F-003 (2): closing modal while seat transaction is in-flight must release seat and keep no ghost seat
  await page.evaluate(() => {
    window.__flushDelayedTx = null;
    window.__txTestMode = 'delay';
  });
  await page.locator('.chat-role-btn[data-role-id="VTS"]').click();
  await page.waitForFunction(() =>
    typeof window.__flushDelayedTx === 'function' &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/VTS_1`) !== null
  );
  await page.locator('#chatCloseBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatModal')).display === 'none');
  await page.evaluate(() => {
    window.__txTestMode = null;
    window.__flushDelayedTx();
  });
  await page.waitForFunction(() =>
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/VTS_1`) === null &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/VTS_2`) === null
  );
  await page.evaluate(() => {
    const targetDb = typeof db !== 'undefined' ? db : firebase.database();
    if (window.__origDbRef) {
      targetDb.ref = window.__origDbRef;
      delete window.__origDbRef;
    }
  });
  await page.locator('#chatOpenBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatModal')).display === 'flex');
  await page.locator('.chat-role-btn[data-role-id="Agent"]').click();
  await page.waitForFunction(() => document.getElementById('chatIdentityText').textContent.includes('Agent-1'));

  // Verify 15-min local idle auto-release AND midnight rollover release + close modal
  await page.clock.fastForward(15 * 60 * 1000 + 20000);
  await page.clock.fastForward(16000);
  await page.waitForFunction(() =>
    document.getElementById('chatIdentityText').textContent.includes('旁觀模式') &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/Agent_1`) === null
  );

  // Re-claim Agent-1, then verify midnight rollover releases old day's seat
  await page.locator('.chat-role-btn[data-role-id="Agent"]').click();
  await page.waitForFunction(() => document.getElementById('chatIdentityText').textContent.includes('Agent-1'));
  await page.evaluate(() => {
    window.__oldChatDateForTest = window.__today;
    window.__origGetCurrentDateStr = window.getCurrentDateStr;
    window.getCurrentDateStr = () => '2099-01-01';
    listenToChatRoom();
  });
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__oldChatDateForTest}/seats/Agent_1`) === null);
  await page.evaluate(() => {
    window.getCurrentDateStr = window.__origGetCurrentDateStr;
    listenToChatRoom();
  });
  await page.locator('#chatCloseBtn').click();

  if (errors.length) throw new Error(JSON.stringify(errors));
  return {externalServices: 'mocked', initial, forecast, operations, commands, chatVerified: true, expiredLeaseRecovered: true, errors};
}
