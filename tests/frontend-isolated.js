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
    window.fetch = async (url, options = {}) => {
      const parsed = new URL(url);
      let scheduleBody = null;
      if (options && options.body && typeof options.body.get === 'function') {
        scheduleBody = options.body.get('schedule');
      }
      window.__requests.push({
        action: parsed.searchParams.get('action'),
        mode: parsed.searchParams.get('mode'),
        pobTime: parsed.searchParams.get('pob_time'),
        modalType: parsed.searchParams.get('modal_type'),
        schedule: scheduleBody,
      });
      return {ok: true, status: 200, json: async () => ({status: 'success', data: []}), text: async () => 'OK'};
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('http://127.0.0.1:4177/index.html');
  const initial = await page.evaluate(() => {
    const labelStyle = getComputedStyle(document.querySelector('.wind-card-label'));
    const timeEl = document.getElementById('dataTime');
    const timeStyle = getComputedStyle(timeEl);
    const timeRect = timeEl.getBoundingClientRect();
    const speedRect = document.getElementById('windSpeed').getBoundingClientRect();
    const monitorWrapStyle = getComputedStyle(document.querySelector('#navMonitorBtn .bottom-nav-icon-wrap'));
    const forecastWrapStyle = getComputedStyle(document.querySelector('#navForecastBtn .bottom-nav-icon-wrap'));
    return {
      title: document.title,
      wind: document.getElementById('windSpeed').textContent,
      schedule: document.body.textContent.includes('DEMO-SHIP'),
      hasLegacyPresLink: Boolean(document.querySelector('.presentation-link')),
      windTitle: document.querySelector('.wind-card-label')?.textContent?.trim(),
      windLabelFontSize: parseFloat(labelStyle.fontSize),
      windLabelFontWeight: Number(labelStyle.fontWeight),
      hasWindForecastBtn: document.querySelector('.wind-card')?.textContent?.includes('風速預報'),
      scheduleTitle: document.querySelector('.schedule-title')?.textContent?.trim(),
      infoHref: document.getElementById('infoLink')?.getAttribute('href'),
      headerBarBg: getComputedStyle(document.querySelector('.app-header-bar')).backgroundColor,
      headerHasBell: Boolean(document.querySelector('.app-header #soundToggle')),
      scheduleHasBell: Boolean(document.querySelector('.schedule-header #soundToggle')),
      windCardIdleHasPillClass: document.querySelector('.wind-card').classList.contains('has-status-pill'),
      windMainRowIdleJustify: getComputedStyle(document.querySelector('.wind-main-row')).justifyContent,
      timeBelowSpeed: timeRect.top >= speedRect.bottom - 2,
      timeIdleAlign: timeStyle.textAlign,
      tableHeadBg: getComputedStyle(document.querySelector('#scheduleHeaderRow th')).backgroundColor,
      monitorNavWrapBg: monitorWrapStyle.backgroundColor,
      monitorNavWrapBorder: monitorWrapStyle.borderColor,
      monitorNavWrapColor: monitorWrapStyle.color,
      inactiveNavWrapBg: forecastWrapStyle.backgroundColor,
      soundDisplay: getComputedStyle(document.getElementById('soundToggle')).display,
      backdropFilter: getComputedStyle(document.querySelector('.wind-card')).backdropFilter,
    };
  });
  if (initial.title !== '臺中LNG船監控(v1.5)' || initial.wind !== '4' || !initial.schedule ||
      initial.hasLegacyPresLink || initial.windTitle !== '北堤風速' ||
      initial.windLabelFontSize < 18 || initial.windLabelFontWeight < 800 || initial.hasWindForecastBtn ||
      initial.scheduleTitle !== '船期表' || initial.infoHref !== 'presentation/index.html' ||
      initial.headerBarBg !== 'rgb(11, 41, 72)' || initial.headerHasBell || !initial.scheduleHasBell ||
      initial.windCardIdleHasPillClass || initial.windMainRowIdleJustify !== 'center' ||
      !initial.timeBelowSpeed || initial.timeIdleAlign !== 'center' ||
      initial.tableHeadBg !== 'rgb(220, 229, 240)' ||
      initial.monitorNavWrapBg !== 'rgba(0, 0, 0, 0)' || initial.monitorNavWrapBorder !== 'rgba(0, 0, 0, 0)' ||
      initial.monitorNavWrapColor !== 'rgb(11, 41, 72)' ||
      initial.inactiveNavWrapBg !== 'rgba(0, 0, 0, 0)' ||
      initial.soundDisplay !== 'none' || initial.backdropFilter !== 'none') {
    throw new Error(`Initial UI: ${JSON.stringify(initial)}`);
  }
  const badges = await page.evaluate(() => Array.from(document.querySelectorAll('#scheduleBody tr'), row => ({
    terminal: row.querySelector('.badge')?.textContent,
    color: row.querySelector('.badge') && getComputedStyle(row.querySelector('.badge')).backgroundColor,
    speedCell: row.querySelectorAll('td')[2]?.textContent?.trim(),
  })));
  if (JSON.stringify(badges) !== JSON.stringify([
    {terminal: 'W12', color: 'rgb(217, 119, 6)', speedCell: '12'},
    {terminal: 'W13', color: 'rgb(11, 41, 72)', speedCell: '15'},
    {terminal: 'W13', color: 'rgb(11, 41, 72)', speedCell: '15'},
  ])) throw new Error(`Terminal badges / speed cell: ${JSON.stringify(badges)}`);
  if (await page.locator('.badge-w13').first().evaluate(el => getComputedStyle(el).color) !== 'rgb(255, 255, 255)') throw new Error('W13 text must be white');
  const icon = await page.evaluate(() => {
    const svg = document.querySelector('.wind-icon');
    const iconRect = svg.getBoundingClientRect();
    const unit = document.querySelector('.wind-speed-unit').getBoundingClientRect();
    const number = document.getElementById('windSpeed').getBoundingClientRect();
    const chatBtn = document.getElementById('chatOpenBtn');
    const oldTableImport = document.querySelector('.pulso-table-import');
    const gearSvg = document.querySelector('.cpc-btn.pulso-settings');
    const gearRect = gearSvg.getBoundingClientRect();
    const navBtns = Array.from(document.querySelectorAll('.bottom-nav-item')).map(b => ({id: b.id, text: b.textContent.trim()}));
    return {
      aboveUnit: iconRect.bottom <= unit.top,
      rightOfNumber: iconRect.left >= number.right,
      alignedBottom: Math.abs(unit.bottom - (number.bottom - 3)) < 3,
      windTag: svg.tagName.toLowerCase(),
      mask: getComputedStyle(svg).maskImage,
      windBg: getComputedStyle(svg).backgroundColor,
      windColor: getComputedStyle(svg).color,
      windPaths: svg.querySelectorAll('path.pulso-wind-1, path.pulso-wind-2, path.pulso-wind-3').length,
      oldTableImportExists: Boolean(oldTableImport),
      chatOnclick: chatBtn.getAttribute('onclick'),
      chatAriaLabel: chatBtn.getAttribute('aria-label'),
      chatCursor: getComputedStyle(chatBtn).cursor,
      unreadBadgeDisplay: getComputedStyle(document.getElementById('chatUnreadBadge')).display,
      gearWidth: Math.round(gearRect.width),
      gearHeight: Math.round(gearRect.height),
      gearColor: getComputedStyle(gearSvg).color,
      gearGroup: Boolean(gearSvg.querySelector('.pulso-gear-group')),
      navBtns,
    };
  });
  if (!icon.aboveUnit || !icon.rightOfNumber || !icon.alignedBottom || icon.windTag !== 'svg' ||
      icon.mask !== 'none' || icon.windBg !== 'rgba(0, 0, 0, 0)' || icon.windColor !== 'rgb(22, 78, 138)' ||
      icon.windPaths !== 3) {
    throw new Error(`Wind icon: ${JSON.stringify(icon)}`);
  }
  if (icon.oldTableImportExists || icon.chatOnclick !== 'openChatModal()' ||
      icon.chatAriaLabel !== '開啟 LNG 船聊天室' || icon.chatCursor !== 'pointer' ||
      icon.unreadBadgeDisplay !== 'none' ||
      JSON.stringify(icon.navBtns) !== JSON.stringify([
        {id: 'navMonitorBtn', text: '監控'},
        {id: 'navForecastBtn', text: '預報'},
        {id: 'navScheduleBtn', text: '船期'},
        {id: 'chatOpenBtn', text: '! 聊天室'.replace('! ', '!')},
      ].map((x, idx) => idx === 3 ? {id: 'chatOpenBtn', text: icon.navBtns[3].text} : x)) ||
      !icon.navBtns[3].text.includes('聊天室')) {
    throw new Error(`Nav/Chat icon: ${JSON.stringify(icon)}`);
  }
  if (icon.gearWidth !== 32 || icon.gearHeight !== 32 || icon.gearColor !== 'rgb(22, 78, 138)' || !icon.gearGroup) {
    throw new Error(`Gear icon: ${JSON.stringify(icon)}`);
  }
  const animStart = await page.evaluate(() => {
    const windContainer = document.querySelector('.wind-container');
    const windNum = document.getElementById('windSpeed');
    const gearSvg = document.querySelector('.cpc-btn');
    windNum.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    gearSvg.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
    return {
      windActive: windContainer.classList.contains('is-animating'),
      windAnim1: getComputedStyle(windContainer.querySelector('.pulso-wind-1')).animationName,
      windAnim2: getComputedStyle(windContainer.querySelector('.pulso-wind-2')).animationName,
      windAnim3: getComputedStyle(windContainer.querySelector('.pulso-wind-3')).animationName,
      windDelay3: getComputedStyle(windContainer.querySelector('.pulso-wind-3')).animationDelay,
      gearActive: gearSvg.classList.contains('is-animating'),
      gearAnim: getComputedStyle(gearSvg.querySelector('.pulso-gear-group')).animationName,
    };
  });
  if (!animStart.windActive || animStart.windAnim1 !== 'pulso-slide-right' || animStart.windAnim2 !== 'pulso-slide-right' ||
      animStart.windAnim3 !== 'pulso-slide-right' || animStart.windDelay3 !== '0.12s' ||
      !animStart.gearActive || animStart.gearAnim !== 'pulso-spin-180') {
    throw new Error(`Icon animation start: ${JSON.stringify(animStart)}`);
  }
  await page.clock.fastForward(900);
  const animReplayAndLock = await page.evaluate(() => {
    const windContainer = document.querySelector('.wind-container');
    const gearSvg = document.querySelector('.cpc-btn');
    const cleared = !windContainer.classList.contains('is-animating') && !gearSvg.classList.contains('is-animating');
    windContainer.dispatchEvent(new Event('pointerenter'));
    const replayed = windContainer.classList.contains('is-animating');
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
    const gearSvg = document.querySelector('.cpc-btn');
    gearSvg.classList.add('is-animating');
    const gearAnim = getComputedStyle(gearSvg.querySelector('.pulso-gear-group')).animationName;
    gearSvg.classList.remove('is-animating');
    gearSvg.dispatchEvent(new Event('pointerenter'));
    return {gearAnim, skippedClass: !gearSvg.classList.contains('is-animating')};
  });
  await page.emulateMedia({reducedMotion: 'no-preference'});
  if (reducedMotionAnim.gearAnim !== 'none' || !reducedMotionAnim.skippedClass) {
    throw new Error(`Reduced motion: ${JSON.stringify(reducedMotionAnim)}`);
  }

  // Bottom nav chat button opens chatModal only
  await page.locator('#chatOpenBtn').click();
  const msgClickState = await page.evaluate(() => ({
    chatVisible: getComputedStyle(document.getElementById('chatModal')).display,
    pwdVisible: getComputedStyle(document.getElementById('pwdModal')).display,
    adjustVisible: getComputedStyle(document.getElementById('scheduleAdjustModal')).display,
  }));
  if (msgClickState.chatVisible !== 'flex' || msgClickState.pwdVisible !== 'none' || msgClickState.adjustVisible !== 'none') {
    throw new Error(`Bottom nav chat click must open chatModal only: ${JSON.stringify(msgClickState)}`);
  }
  await page.locator('#chatRoleBackBtn').click();
  if (await page.locator('#chatModal').isVisible()) {
    throw new Error('chatModal must close before schedule tests');
  }

  // Verify schedule header columns & that double-click / double-tap on #scheduleHeaderRow NO LONGER triggers password/adjust
  const headerStyles = await page.evaluate(() => {
    const row = document.getElementById('scheduleHeaderRow');
    const ths = Array.from(row.querySelectorAll('th'));
    return {
      texts: ths.map(th => th.textContent.trim()),
      userSelect: ths.map(th => getComputedStyle(th).userSelect),
    };
  });
  if (JSON.stringify(headerStyles.texts) !== JSON.stringify(['日期', '船名', '速限 m/s'])) {
    throw new Error(`Schedule header texts: ${JSON.stringify(headerStyles)}`);
  }
  await page.locator('#scheduleHeaderRow th').nth(1).click();
  await page.locator('#scheduleHeaderRow th').nth(1).dblclick();
  await page.evaluate(() => {
    const row = document.getElementById('scheduleHeaderRow');
    const rect = row.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (let i = 0; i < 2; i++) {
      const t = new Touch({identifier: 1, target: row, clientX: x, clientY: y});
      row.dispatchEvent(new TouchEvent('touchstart', {bubbles: true, cancelable: true, touches: [t], changedTouches: [t]}));
      row.dispatchEvent(new TouchEvent('touchend', {bubbles: true, cancelable: true, touches: [], changedTouches: [t]}));
    }
  });
  if (await page.locator('#pwdModal').isVisible() || await page.locator('#scheduleAdjustModal').isVisible()) {
    throw new Error('Schedule header click/dblclick/double-tap must NOT open password or schedule adjust modals');
  }

  // Verify bottom nav 預報 tab opens #forecastModal and illuminates amber active capsule
  await page.locator('#navForecastBtn').click();
  if (!await page.locator('#forecastModal').isVisible()) throw new Error('Bottom nav 預報 must open forecastModal');
  await page.waitForTimeout(220);
  const forecastNavWrap = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#navForecastBtn .bottom-nav-icon-wrap'));
    return {bg: s.backgroundColor, border: s.borderColor, active: document.getElementById('navForecastBtn').classList.contains('is-active')};
  });
  if (!forecastNavWrap.active || forecastNavWrap.bg !== 'rgb(254, 243, 199)' || forecastNavWrap.border !== 'rgb(245, 158, 11)') {
    throw new Error(`Forecast active nav capsule: ${JSON.stringify(forecastNavWrap)}`);
  }
  await page.locator('.forecast-close').click();

  // Verify bottom nav 船期 tab -> password -> full-screen double-row card schedule adjust (with UNFINISHED_SHIP, MM/DD, delete, diffing)
  await page.evaluate(() => {
    window.__emit('formal/schedule_list', [
      {d: '', ship_name: 'UNFIN-SHIP', limit_speed: 12, terminal: 'W12'},
      {d: '06/09', ship_name: 'DEMO-SHIP', limit_speed: 12, terminal: 'W12'},
      {d: '06/10', ship_name: 'DEMO-W13', limit_speed: 15, terminal: ''},
      {d: '06/12', ship_name: 'CUSTOM-SPD', limit_speed: 13.8, terminal: 'W13'},
    ]);
  });
  const mainTableHasBlankDate = await page.evaluate(() => document.getElementById('scheduleBody').textContent.includes('UNFIN-SHIP'));
  if (mainTableHasBlankDate) throw new Error('Main schedule table must hide blank-date UNFINISHED_SHIP');

  await page.locator('#navScheduleBtn').click();
  if (!await page.locator('#pwdModal').isVisible()) throw new Error('Bottom nav 船期 must open password modal');
  await page.fill('#modalPwdInput', 'synthetic');
  await page.evaluate(() => closePwdModal(true));
  if (!await page.locator('#scheduleAdjustModal').isVisible()) throw new Error('Password confirmation must open schedule adjust modal');
  await page.waitForTimeout(0);
  const verifySchedReq = await page.evaluate(() => window.__requests.find(r => r.action === 'verify_password' && r.modalType === 'schedule'));
  if (!verifySchedReq) throw new Error('Expected verify_password request with modal_type=schedule');

  const adjustCardsState = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#adjustCardList .adjust-card'));
    const backBtn = document.getElementById('adjustBackBtn');
    const addBtn = document.getElementById('adjustAddBtn');
    const topInner = document.querySelector('.adjust-topbar-inner').getBoundingClientRect();
    const firstCardRect = cards[0].getBoundingClientRect();
    const saveRect = document.getElementById('saveScheduleBtn').getBoundingClientRect();
    const addRect = addBtn.getBoundingClientRect();
    return {
      count: cards.length,
      firstHasUnfinishedTag: Boolean(cards[0]?.querySelector('.adjust-unfinished-tag')),
      firstDateVal: cards[0]?.querySelector('.adjust-date-input')?.value,
      firstShipVal: cards[0]?.querySelector('.adjust-ship-input')?.value,
      row1Inputs: cards[1]?.querySelectorAll('.adjust-card-row1 input, .adjust-card-row1 select, .adjust-card-row1 button').length,
      row2Inputs: cards[1]?.querySelectorAll('.adjust-card-row2 input, .adjust-card-row2 select').length,
      customSpeedPreserved: cards[3]?.querySelector('.adjust-speed-select')?.value,
      backBtnText: backBtn.textContent.trim(),
      addBtnClass: addBtn.classList.contains('add-row-btn'),
      addBtnRadius: getComputedStyle(addBtn).borderRadius,
      addBtnCircular: Math.abs(addRect.width - addRect.height) < 1 && Math.round(addRect.width) === 30,
      cardMatchesSaveLeft: Math.abs(firstCardRect.left - saveRect.left) <= 1,
      cardMatchesSaveRight: Math.abs(firstCardRect.right - saveRect.right) <= 1,
      cardMatchesTopLeft: Math.abs(firstCardRect.left - topInner.left - 14) <= 1,
      cardMatchesTopRight: Math.abs((topInner.right - 14) - firstCardRect.right) <= 1,
    };
  });
  if (adjustCardsState.count !== 4 || !adjustCardsState.firstHasUnfinishedTag || adjustCardsState.firstDateVal !== '' ||
      adjustCardsState.firstShipVal !== 'UNFIN-SHIP' || adjustCardsState.row1Inputs !== 3 || adjustCardsState.row2Inputs !== 2 ||
      adjustCardsState.customSpeedPreserved !== '13.8' || adjustCardsState.backBtnText !== '' ||
      !adjustCardsState.addBtnClass || adjustCardsState.addBtnRadius !== '50%' || !adjustCardsState.addBtnCircular ||
      !adjustCardsState.cardMatchesSaveLeft || !adjustCardsState.cardMatchesSaveRight ||
      !adjustCardsState.cardMatchesTopLeft || !adjustCardsState.cardMatchesTopRight) {
    throw new Error(`Adjust cards state: ${JSON.stringify(adjustCardsState)}`);
  }

  // Verify 1280x800 desktop alignment for #scheduleAdjustModal topbar, middle cards, and 儲存調整 footer
  await page.setViewportSize({width: 1280, height: 800});
  const desktopAdjustAlign = await page.evaluate(() => {
    const topInner = document.querySelector('.adjust-topbar-inner').getBoundingClientRect();
    const card = document.querySelector('#adjustCardList .adjust-card').getBoundingClientRect();
    const saveBtn = document.getElementById('saveScheduleBtn').getBoundingClientRect();
    return {
      cardWidth: Math.round(card.width),
      saveWidth: Math.round(saveBtn.width),
      cardLeftVsSaveLeft: Math.abs(card.left - saveBtn.left),
      cardRightVsSaveRight: Math.abs(card.right - saveBtn.right),
      topLeftVsCardLeft: Math.abs((card.left - 14) - topInner.left),
      topRightVsCardRight: Math.abs(topInner.right - (card.right + 14)),
    };
  });
  await page.setViewportSize({width: 390, height: 844});
  if (desktopAdjustAlign.cardLeftVsSaveLeft > 1 || desktopAdjustAlign.cardRightVsSaveRight > 1 ||
      desktopAdjustAlign.topLeftVsCardLeft > 1 || desktopAdjustAlign.topRightVsCardRight > 1) {
    throw new Error(`Desktop #scheduleAdjustModal alignment: ${JSON.stringify(desktopAdjustAlign)}`);
  }

  // Test 4-digit auto-format (0609 -> 06/09), invalid date (99/99), addEditItem(), deleteEditItem(), and tombstone-first normalized save
  await page.evaluate(() => {
    const firstDateInput = document.querySelectorAll('.adjust-date-input')[1];
    firstDateInput.value = '99/99';
    validateDateInput(firstDateInput, 1);
  });
  if (!await page.evaluate(() => getComputedStyle(document.querySelectorAll('.adjust-card .date-error')[1]).display === 'block')) {
    throw new Error('Invalid date 99/99 must show inline date-error');
  }
  await page.evaluate(() => {
    const firstDateInput = document.querySelectorAll('.adjust-date-input')[1];
    firstDateInput.value = '0609';
    validateDateInput(firstDateInput, 1);
  });
  if (await page.evaluate(() => document.querySelectorAll('.adjust-date-input')[1].value) !== '06/09') {
    throw new Error('0609 must auto-format to 06/09');
  }
  await page.locator('#adjustAddBtn').click();
  await page.evaluate(() => {
    const dateInput = document.querySelectorAll('.adjust-date-input')[0];
    dateInput.value = '06/15';
    updateEditItem(0, 'd', '06/15');
    const shipInput = document.querySelectorAll('.adjust-ship-input')[0];
    shipInput.value = 'NEW-SHIP';
    updateEditItem(0, 'ship_name', 'NEW-SHIP');
  });
  // Delete DEMO-W13 (now at index 3 after addEditItem)
  await page.locator('.adjust-card').nth(3).locator('.adjust-delete-btn').click();
  await page.locator('#saveScheduleBtn').click();
  await page.waitForTimeout(0);
  const savedScheduleReq = await page.evaluate(() => window.__requests.find(r => r.action === 'update_schedule'));
  if (!savedScheduleReq || !savedScheduleReq.schedule) throw new Error('Expected update_schedule request with schedule payload');
  const savedDiff = JSON.parse(savedScheduleReq.schedule);
  if (savedDiff.length !== 2 ||
      !savedDiff[0].is_deleted || savedDiff[0].ship_name !== 'DEMO-W13' || savedDiff[0].d !== '6/10' ||
      savedDiff[1].is_deleted !== false || savedDiff[1].ship_name !== 'NEW-SHIP' || savedDiff[1].d !== '6/15' || savedDiff[1].terminal !== 'W13') {
    throw new Error(`Unexpected update_schedule diff payload: ${JSON.stringify(savedDiff)}`);
  }
  if (await page.locator('#scheduleAdjustModal').isVisible()) throw new Error('Schedule adjust modal must close after save');

  // Restore standard test schedule for remaining tests
  await page.evaluate(() => {
    const today = window.__today;
    const monthDay = `${Number(today.slice(5, 7))}/${Number(today.slice(8))}`;
    window.__emit('formal/schedule_list', [
      {d: monthDay, ship_name: 'DEMO-SHIP', limit_speed: 12, terminal: 'W12'},
      {d: monthDay, ship_name: 'DEMO-W13', limit_speed: 15, terminal: ''},
      {d: monthDay, ship_name: 'DEMO-EMPTY', limit_speed: 15},
    ]);
  });

  // Verify gear icon (.cpc-btn) -> password -> bottom-sheet #manualModal (segmented controls, live wind-tick guard, red #resetBtn)
  await page.clock.fastForward(5100);
  await page.locator('.cpc-btn').click();
  if (!await page.locator('#pwdModal').isVisible()) throw new Error('Gear icon must open password modal');
  await page.fill('#modalPwdInput', 'synthetic');
  await page.evaluate(() => closePwdModal(true));
  if (!await page.locator('#manualModal').isVisible()) throw new Error('Password confirmation must open manualModal');
  await page.waitForTimeout(260);
  const verifyManualReq = await page.evaluate(() => window.__requests.find(r => r.action === 'verify_password' && r.modalType === 'manual'));
  if (!verifyManualReq) throw new Error('Expected verify_password request with modal_type=manual');

  const sheetLayout = await page.evaluate(() => {
    const rect = document.querySelector('#manualModal .bottom-sheet-content').getBoundingClientRect();
    const speedBtns = Array.from(document.querySelectorAll('#speedSegmentGroup .seg-btn')).map(b => b.textContent.trim());
    return {
      bottomDiff: Math.abs(rect.bottom - window.innerHeight),
      defaultSpeed: document.getElementById('limitSpeed').value,
      defaultTerm: document.getElementById('terminal').value,
      speedBtns,
      customWrapExists: Boolean(document.getElementById('customLimitSpeedWrap')),
    };
  });
  if (sheetLayout.bottomDiff > 2 || sheetLayout.defaultSpeed !== '15' || sheetLayout.defaultTerm !== 'W13' ||
      JSON.stringify(sheetLayout.speedBtns) !== JSON.stringify(['12', '15']) || sheetLayout.customWrapExists) {
    throw new Error(`Manual bottom sheet layout/defaults: ${JSON.stringify(sheetLayout)}`);
  }

  // Click 12, then W12, then emit live active_status stop tick and ensure selections survive!
  await page.locator('#speedSegmentGroup [data-speed="12"]').click();
  await page.locator('#terminalSegmentGroup [data-terminal="W12"]').click();
  await page.evaluate(() => {
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 6.2, last_update: '10:05'});
  });
  const afterTick = await page.evaluate(() => ({
    speed: document.getElementById('limitSpeed').value,
    term: document.getElementById('terminal').value,
    w12Active: document.querySelector('#terminalSegmentGroup [data-terminal="W12"]').classList.contains('is-active'),
    w12Bg: getComputedStyle(document.querySelector('#terminalSegmentGroup [data-terminal="W12"]')).backgroundColor,
    windNum: document.getElementById('windSpeed').textContent,
  }));
  if (afterTick.speed !== '12' || afterTick.term !== 'W12' || !afterTick.w12Active || afterTick.windNum !== '6.2') {
    throw new Error(`Open manualModal live wind-tick guard failed: ${JSON.stringify(afterTick)}`);
  }

  // Verify stop mode red #resetBtn
  await page.evaluate(() => {
    window.__emit('formal/active_status', {app_mode: 'start', ship_name: 'DEMO-SHIP', limit_speed: 12, terminal: 'W12', current_wind: 4});
  });
  const stopSheet = await page.evaluate(() => ({
    banner: document.getElementById('monitoringTargetBanner').textContent,
    resetDisplay: getComputedStyle(document.getElementById('resetBtn')).display,
    resetBg: getComputedStyle(document.getElementById('resetBtn')).backgroundColor,
  }));
  if (!stopSheet.banner.includes('DEMO-SHIP') || stopSheet.resetDisplay !== 'block' || stopSheet.resetBg !== 'rgb(220, 38, 38)') {
    throw new Error(`Manual stop sheet: ${JSON.stringify(stopSheet)}`);
  }
  await page.evaluate(() => closeManualModal());
  await page.evaluate(() => window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:00'}));

  // Verify pessimistic editing lock transfers to #navScheduleBtn + .cpc-btn and blocks modals
  await page.clock.fastForward(5100);
  await page.evaluate(() => window.__emit('formal/editing_lock', {locked: true, locked_at: Date.now()}));
  const lockedState = await page.evaluate(() => ({
    navLocked: document.getElementById('navScheduleBtn').classList.contains('locked-btn'),
    navTitle: document.getElementById('navScheduleBtn').title,
    cpcLocked: document.querySelector('.cpc-btn').classList.contains('locked-btn'),
    rowLocked: document.getElementById('scheduleHeaderRow').classList.contains('locked-btn'),
  }));
  if (!lockedState.navLocked || !lockedState.navTitle.includes('🔒') || !lockedState.cpcLocked || lockedState.rowLocked) {
    throw new Error(`Locked UI transfer: ${JSON.stringify(lockedState)}`);
  }
  const beforeLockAlerts = await page.evaluate(() => (window.__alerts || []).length);
  await page.locator('#navScheduleBtn').click();
  const lockAlertCheck = await page.evaluate((prevLen) => ({
    newAlerts: (window.__alerts || []).slice(prevLen),
    pwdDisplay: getComputedStyle(document.getElementById('pwdModal')).display,
  }), beforeLockAlerts);
  if (lockAlertCheck.newAlerts.length !== 1 || !lockAlertCheck.newAlerts[0].includes('🔒') || lockAlertCheck.pwdDisplay !== 'none') {
    throw new Error(`Locked #navScheduleBtn guard: ${JSON.stringify(lockAlertCheck)}`);
  }
  await page.evaluate(() => window.__emit('formal/editing_lock', null));

  // Entry conditions + bell SVG states + 375x812 overflow check
  await page.setViewportSize({width: 375, height: 812});
  const bellStates = await page.evaluate(() => {
    getCurrentTimeHHMM = () => '10:00';
    isSoundEnabled = false;
    window.__emit('formal/active_status', {app_mode: 'start', ship_name: 'DEMO-SHIP', limit_speed: 12, season_time: '06:00', current_wind: 6});
    const muted = {display: getComputedStyle(document.getElementById('soundToggle')).display, state: document.getElementById('soundToggle').dataset.soundState};
    isSoundEnabled = true;
    syncAudioState();
    const ringing = {state: document.getElementById('soundToggle').dataset.soundState, color: getComputedStyle(document.getElementById('soundToggle')).color};
    window.__emit('formal/active_status', {app_mode: 'start', ship_name: 'DEMO-SHIP', limit_speed: 12, season_time: '06:00', current_wind: 14});
    const armed = {state: document.getElementById('soundToggle').dataset.soundState, color: getComputedStyle(document.getElementById('soundToggle')).color};
    isSoundEnabled = false;
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:00'});
    return {muted, ringing, armed};
  });
  if (bellStates.muted.display === 'none' || bellStates.muted.state !== 'muted' ||
      bellStates.ringing.state !== 'ringing' || bellStates.ringing.color !== 'rgb(234, 140, 30)' ||
      bellStates.armed.state !== 'armed') {
    throw new Error(`Bell SVG states: ${JSON.stringify(bellStates)}`);
  }

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
      const windCard = document.querySelector('.wind-card');
      const boxRect = box.getBoundingClientRect();
      const cardRect = windCard.getBoundingClientRect();
      const reasons = [...box.querySelectorAll('.condition-warning')];
      return {expected: item, status: currentStatus, text: box.textContent, reasons: reasons.length,
        insideWindCard: Boolean(windCard.contains(box)) && boxRect.right <= cardRect.right + 1,
        hasStatusPillClass: windCard.classList.contains('has-status-pill'),
        mainRowJustify: getComputedStyle(windCard.querySelector('.wind-main-row')).justifyContent,
        timeActiveAlign: getComputedStyle(document.getElementById('dataTime')).textAlign,
        noOverflow375: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        images: reasons.map(row => row.querySelector('img')?.getAttribute('src')),
        highlighted: document.querySelector('#scheduleBody tr[data-shipname="DEMO-SHIP"]').className,
        soundPlaying: !notificationSound.paused};
    });
    isSoundEnabled = false;
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:00'});
    const idleJustify = getComputedStyle(document.querySelector('.wind-card .wind-main-row')).justifyContent;
    if (document.querySelector('.wind-card').classList.contains('has-status-pill') || idleJustify !== 'center') {
      throw new Error(`Expected idle centered wind-card after stop, got ${idleJustify}`);
    }
    return results;
  });
  for (const result of conditions) {
    if (result.status !== result.expected.status || result.reasons !== result.expected.reasons ||
        !result.insideWindCard || !result.hasStatusPillClass || result.mainRowJustify !== 'space-between' ||
        result.timeActiveAlign !== 'left' || !result.noOverflow375 ||
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
  await page.setViewportSize({width: 390, height: 844});

  // Verify same-day dual-ship coexistence: Ship A finished (POB) while Ship B active -> both #pobList and #dynamicBox visible
  await page.evaluate(() => {
    getCurrentTimeHHMM = () => '10:00';
    window.__emit(`formal/daily_records/${window.__today}`, {
      ship_a: {config: {ship_name: 'DEMO-W13'}, pob_info: {pob_time: '06:15', formatted_msg: 'DEMO-W13 已於 06:15 進港'}}
    });
    window.__emit('formal/active_status', {app_mode: 'start', ship_name: 'DEMO-SHIP', limit_speed: 12, season_time: '06:00', current_wind: 7.4});
  });
  const dualCoexist = await page.evaluate(() => ({
    pobDisplay: getComputedStyle(document.getElementById('pobList')).display,
    boxDisplay: getComputedStyle(document.getElementById('dynamicBox')).display,
    boxText: document.getElementById('dynamicBox').textContent,
  }));
  if (dualCoexist.pobDisplay !== 'block' || dualCoexist.boxDisplay !== 'block' || !dualCoexist.boxText.includes('可進港')) {
    throw new Error(`Dual-ship same-day POB + status coexistence failed: ${JSON.stringify(dualCoexist)}`);
  }
  await page.evaluate(() => {
    window.__emit(`formal/daily_records/${window.__today}`, null);
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:00'});
  });
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

  // ==================== Ship Chat Room v2 PWA Tests (AC-001 ~ AC-004 + F-001 ~ F-004) ====================
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
      m1: {id: 'm1', ts: 10000, timeStr: '08:00', roleId: 'CPC_LM', roleLabel: '中油LNG', clientId: 'other-1', text: '早安，引水梯備便'},
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

  // Open modal -> Screen 1 (選擇角色) with bold ROC date & 4 custom icon rows + lock.png when full
  await page.evaluate(() => {
    const d = window.__today;
    const now = getServerNow();
    window.__emit(`formal/chat_rooms/${d}/seats/Pilot_1`, {clientId: 'p1', roleId: 'Pilot', roleLabel: 'Pilot', slot: 1, activeAt: now});
  });
  await page.locator('#chatOpenBtn').click();
  const expectedRocDate = await page.evaluate(() => {
    const [y, m, dd] = window.__today.split('-');
    return `${Number(y) - 1911}/${m}/${dd}`;
  });
  const screen1State = await page.evaluate(() => {
    const modal = document.getElementById('chatModal');
    const roleScreen = document.getElementById('chatRoleScreen');
    const roomScreen = document.getElementById('chatRoomScreen');
    const dateBadge = document.getElementById('chatDateBadge');
    const pilotBtn = document.querySelector('.chat-role-item[data-role-id="Pilot"]');
    const lockImg = pilotBtn ? pilotBtn.querySelector('img.chat-role-lock-img') : null;
    const roleBtns = Array.from(document.querySelectorAll('#chatRoleBar .chat-role-item'));
    return {
      modalDisplay: getComputedStyle(modal).display,
      badgeDisplay: getComputedStyle(document.getElementById('chatUnreadBadge')).display,
      roleDisplay: getComputedStyle(roleScreen).display,
      roomDisplay: getComputedStyle(roomScreen).display,
      dateText: dateBadge.textContent.trim(),
      dateWeight: Number(getComputedStyle(dateBadge).fontWeight),
      talkImgCount: document.querySelectorAll('img[src*="talk.png"]').length,
      roleIds: roleBtns.map(b => b.dataset.roleId),
      roleIcons: roleBtns.map(b => b.querySelector('img.chat-role-icon')?.getAttribute('src')),
      pilotDisabled: pilotBtn ? pilotBtn.disabled : false,
      pilotCount: pilotBtn ? pilotBtn.querySelector('.chat-role-count')?.textContent : '',
      lockImgSrc: lockImg ? lockImg.getAttribute('src') : '',
    };
  });
  if (screen1State.modalDisplay !== 'flex' || screen1State.badgeDisplay !== 'none' ||
      screen1State.roleDisplay !== 'flex' || screen1State.roomDisplay !== 'none' ||
      screen1State.dateText !== expectedRocDate || screen1State.dateWeight < 700 ||
      screen1State.talkImgCount !== 0 ||
      JSON.stringify(screen1State.roleIds) !== JSON.stringify(['CPC_LM', 'Pilot', 'Other', 'Spectator']) ||
      !screen1State.pilotDisabled || screen1State.pilotCount !== '1/1' || screen1State.lockImgSrc !== 'pic/lock.png') {
    throw new Error(`AC-001/v2 Screen 1 state: ${JSON.stringify(screen1State)}`);
  }

  // Click Spectator (觀眾) -> enters Screen 2 (LNG 船聊天室) in Spectator mode without claiming any seat
  await page.locator('.chat-role-item[data-role-id="Spectator"]').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex');
  const specRoomState = await page.evaluate(() => ({
    titleText: document.getElementById('chatModalTitle').textContent.trim(),
    specVisible: getComputedStyle(document.getElementById('chatSpectatorBar')).display,
    specPillText: document.getElementById('chatSpectatorPill').textContent.trim(),
    footerDisplay: getComputedStyle(document.getElementById('chatComposerFooter')).display,
    cpcSeat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`),
  }));
  if (specRoomState.titleText !== 'LNG 船聊天室' || specRoomState.specVisible !== 'flex' ||
      !specRoomState.specPillText.includes('觀眾模式') || specRoomState.footerDisplay !== 'none' ||
      specRoomState.cpcSeat !== null) {
    throw new Error(`AC-002 Spectator mode state: ${JSON.stringify(specRoomState)}`);
  }

  // Receive new message while modal open -> read marker updates, closing stays hidden, reappears after closing
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/messages`, {
      m1: {id: 'm1', ts: 10000, timeStr: '08:00', roleId: 'CPC_LM', roleLabel: '中油LNG', clientId: 'other-1', text: '早安，引水梯備便'},
      m2: {id: 'm2', ts: 20000, timeStr: '08:05', roleId: 'Pilot', roleLabel: 'Pilot', clientId: 'other-2', text: '已登輪'},
    });
  });
  await page.locator('#chatCloseBtn').click();
  if (await page.evaluate(() => getComputedStyle(document.getElementById('chatUnreadBadge')).display) !== 'none') {
    throw new Error('AC-001: Badge must remain hidden after closing modal when newest msg was read while open');
  }
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/messages/m3`, {
      id: 'm3', ts: 30000, timeStr: '08:06', roleId: 'Other', roleLabel: '拖船船長', clientId: 'other-3', text: '拖船就位',
    });
  });
  if (await page.evaluate(() => getComputedStyle(document.getElementById('chatUnreadBadge')).display) === 'none') {
    throw new Error('AC-001: Badge must reappear when new message arrives after closing modal');
  }

  // AC-002: Claim 中油LNG (CPC_LM_1) directly from Screen 1 -> enters Screen 2 Active mode
  await page.locator('#chatOpenBtn').click();
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex');
  const seatCpc = await page.evaluate(() => ({
    seat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`),
    hookArmed: window.__onDisconnectHooks.has(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`),
    specVisible: getComputedStyle(document.getElementById('chatSpectatorBar')).display,
    footerDisplay: getComputedStyle(document.getElementById('chatComposerFooter')).display,
  }));
  if (!seatCpc.seat || seatCpc.seat.roleId !== 'CPC_LM' || seatCpc.seat.roleLabel !== '中油LNG' ||
      !seatCpc.hookArmed || seatCpc.specVisible !== 'none' || seatCpc.footerDisplay !== 'block') {
    throw new Error(`AC-002 claim 中油LNG: ${JSON.stringify(seatCpc)}`);
  }

  // Test 「其他」 bottom sheet: blank name -> spectator (releases CPC_LM_1); non-blank -> claims Other_1 & releases old seat
  await page.locator('#chatBackToRolesBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatRoleScreen')).display === 'flex');
  await page.locator('.chat-role-item[data-role-id="Other"]').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatNameSheetBackdrop')).display === 'flex');
  await page.fill('#chatNameInput', '   ');
  await page.locator('#chatEnterRoomBtn').click();
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex' &&
    getComputedStyle(document.getElementById('chatComposerFooter')).display === 'none' &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) === null
  );

  // Now test non-blank name in 「其他」 bottom sheet -> claims Other_1 with custom name
  await page.locator('#chatBackToRolesBtn').click();
  await page.locator('.chat-role-item[data-role-id="Other"]').click();
  await page.fill('#chatNameInput', '海事工程師');
  await page.locator('#chatEnterRoomBtn').click();
  await page.waitForFunction(() => {
    const s = window.__getDb(`formal/chat_rooms/${window.__today}/seats/Other_1`);
    return Boolean(s && s.roleLabel === '海事工程師') && getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex';
  });

  // Remote overwrite on Other_1 must forfeit local seat and cancel Other_1 onDisconnect without deleting takeover user
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/seats/Other_1`, {
      clientId: 'takeover-other', roleId: 'Other', roleLabel: '接手人員', slot: 1, activeAt: getServerNow(),
    });
  });
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('chatComposerFooter')).display === 'none' &&
    document.getElementById('chatStatusBanner').textContent.includes('觀眾模式')
  );
  const afterTakeover = await page.evaluate(() => ({
    remoteSeat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/Other_1`),
    hookStillArmed: window.__onDisconnectHooks.has(`formal/chat_rooms/${window.__today}/seats/Other_1`),
  }));
  if (!afterTakeover.remoteSeat || afterTakeover.remoteSeat.clientId !== 'takeover-other' || afterTakeover.hookStillArmed) {
    throw new Error(`AC-002 takeover safety: ${JSON.stringify(afterTakeover)}`);
  }

  // Test 15/15 full lock on 「其他」, then clear & reclaim expired Pilot_1 (>15 min idle)
  await page.locator('#chatBackToRolesBtn').click();
  await page.evaluate(() => {
    const d = window.__today;
    const now = getServerNow();
    for (let i = 1; i <= 15; i++) {
      window.__emit(`formal/chat_rooms/${d}/seats/Other_${i}`, {clientId: `o_${i}`, roleId: 'Other', roleLabel: `人員${i}`, slot: i, activeAt: now});
    }
    const stale = now - (15 * 60 * 1000 + 5000);
    window.__emit(`formal/chat_rooms/${d}/seats/Pilot_1`, {clientId: 'stale-pilot', roleId: 'Pilot', roleLabel: 'Pilot', slot: 1, activeAt: stale});
  });
  const otherFullState = await page.evaluate(() => {
    const btn = document.querySelector('.chat-role-item[data-role-id="Other"]');
    return {
      disabled: btn ? btn.disabled : false,
      count: btn ? btn.querySelector('.chat-role-count')?.textContent : '',
      lockImg: btn ? btn.querySelector('img.chat-role-lock-img')?.getAttribute('src') : '',
    };
  });
  if (!otherFullState.disabled || otherFullState.count !== '15/15' || otherFullState.lockImg !== 'pic/lock.png') {
    throw new Error(`AC-002 Other 15/15 lock: ${JSON.stringify(otherFullState)}`);
  }
  await page.locator('.chat-role-item[data-role-id="Pilot"]').click();
  await page.waitForFunction(() => {
    const s = window.__getDb(`formal/chat_rooms/${window.__today}/seats/Pilot_1`);
    return Boolean(s && s.clientId !== 'stale-pilot') && getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex';
  });
  await page.locator('#chatBackToRolesBtn').click();
  await page.locator('.chat-role-item[data-role-id="Spectator"]').click();
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__today}/seats/Pilot_1`) === null);

  // AC-003: Outgoing mint-teal #b2ebe0 + 已送出, incoming light-grey #e5e7eb, XSS immunity
  await page.locator('#chatBackToRolesBtn').click();
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatComposerFooter')).display === 'block');
  await page.fill('#chatTextInput', '報告進港 <img src=x onerror="window.__xss=1">');
  await page.locator('#chatSendBtn').click();
  await page.waitForFunction(() => {
    const msgs = window.__getDb(`formal/chat_rooms/${window.__today}/messages`) || {};
    return Object.values(msgs).some(m => m.text && m.text.includes('<img src=x'));
  });
  const ac3 = await page.evaluate(() => {
    const container = document.getElementById('chatMessagesContainer');
    const rows = Array.from(container.querySelectorAll('.chat-msg-row'));
    const otherRow = rows.find(r => r.classList.contains('is-other'));
    const otherBubble = otherRow && otherRow.querySelector('.chat-bubble');
    const selfRow = rows.find(r => r.classList.contains('is-self'));
    const selfBubble = selfRow && selfRow.querySelector('.chat-bubble');
    const selfStatus = selfRow && selfRow.querySelector('.chat-msg-status');
    return {
      xssTriggered: Boolean(window.__xss),
      areaBg: getComputedStyle(container).backgroundColor,
      otherBg: otherBubble ? getComputedStyle(otherBubble).backgroundColor : '',
      selfBg: selfBubble ? getComputedStyle(selfBubble).backgroundColor : '',
      selfText: selfBubble ? selfBubble.textContent : '',
      selfStatusText: selfStatus ? selfStatus.textContent : '',
    };
  });
  if (ac3.xssTriggered || ac3.areaBg !== 'rgb(255, 255, 255)' ||
      ac3.otherBg !== 'rgb(229, 231, 235)' || ac3.selfBg !== 'rgb(178, 235, 224)' ||
      !ac3.selfText.includes('<img src=x') || !ac3.selfStatusText.includes('已送出')) {
    throw new Error(`AC-003 bubble styles/XSS: ${JSON.stringify(ac3)}`);
  }

  // AC-004 (a): Attachment Bottom Sheet (拍照 / 從相簿選取 / 選擇檔案) & Cancel Upload mid-flight
  await page.locator('#chatAttachBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatAttachSheetBackdrop')).display === 'flex');
  const sheetOpts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#chatAttachSheetBackdrop .chat-attach-option')).map(btn => ({
      id: btn.id,
      title: btn.querySelector('.chat-attach-option-title')?.textContent,
      icon: btn.querySelector('img.chat-attach-option-icon')?.getAttribute('src'),
    }))
  );
  if (sheetOpts.length !== 3 ||
      sheetOpts[0].title !== '拍照' || sheetOpts[0].icon !== 'pic/拍照.png' ||
      sheetOpts[1].title !== '從相簿選取' || sheetOpts[1].icon !== 'pic/從相簿選取.png' ||
      sheetOpts[2].title !== '選擇檔案' || sheetOpts[2].icon !== 'pic/選擇檔案.png') {
    throw new Error(`AC-004 attachment sheet: ${JSON.stringify(sheetOpts)}`);
  }
  await page.evaluate(() => {
    closeChatAttachSheet();
    const targetDb = typeof db !== 'undefined' ? db : firebase.database();
    window.__origAttDbRef = targetDb.ref.bind(targetDb);
    window.__holdAttUpload = true;
    targetDb.ref = function (path) {
      const refObj = window.__origAttDbRef(path);
      if (window.__holdAttUpload && typeof path === 'string' && path.includes('/chat_attachments/')) {
        const origSet = refObj.set.bind(refObj);
        refObj.set = function (val) {
          return new Promise(resolve => {
            window.__resumeHeldAttUpload = () => origSet(val).then(resolve);
          });
        };
      }
      return refObj;
    };
    const dt = new DataTransfer();
    dt.items.add(new File(['a,b\n1,2'], 'cancel_me.csv', {type: 'text/csv'}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => Boolean(document.getElementById('chatCancelUploadBtn') && window.__resumeHeldAttUpload));
  await page.locator('#chatCancelUploadBtn').click();
  await page.evaluate(() => {
    window.__holdAttUpload = false;
    const targetDb = typeof db !== 'undefined' ? db : firebase.database();
    if (window.__origAttDbRef) {
      targetDb.ref = window.__origAttDbRef;
      delete window.__origAttDbRef;
    }
    if (window.__resumeHeldAttUpload) window.__resumeHeldAttUpload();
  });
  const canceledMsgExists = await page.evaluate(() => {
    const msgs = Object.values(window.__getDb(`formal/chat_rooms/${window.__today}/messages`) || {});
    return msgs.some(m => m.attachment && m.attachment.name === 'cancel_me.csv');
  });
  if (canceledMsgExists) throw new Error('AC-004: Canceled upload must not publish chat message');

  // AC-004 (b): Valid oversized-dimension image compression (1600x800 -> 1280px JPEG) & Full-Screen Photo Lightbox with zoom
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
    const img = document.getElementById('chatPreviewImage');
    return Boolean(img && img.complete && img.naturalWidth > 0);
  });
  await page.locator('#chatZoomInBtn').click();
  const imgZoomedIn = await page.evaluate(() => ({
    display: getComputedStyle(document.getElementById('chatPreviewModal')).display,
    zIndex: getComputedStyle(document.getElementById('chatPreviewModal')).zIndex,
    boxRadius: getComputedStyle(document.querySelector('#chatPreviewModal .chat-preview-box')).borderRadius,
    zoomLabel: document.getElementById('chatZoomResetBtn').textContent,
    transform: document.getElementById('chatPreviewImage').style.transform,
    naturalWidth: document.getElementById('chatPreviewImage').naturalWidth,
    naturalHeight: document.getElementById('chatPreviewImage').naturalHeight,
    href: document.getElementById('chatPreviewDownload').getAttribute('href') || '',
  }));
  await page.locator('#chatZoomResetBtn').click();
  const imgResetZoom = await page.evaluate(() => document.getElementById('chatZoomResetBtn').textContent);
  await page.locator('#chatPreviewImage').dblclick();
  const imgDblZoom = await page.evaluate(() => document.getElementById('chatZoomResetBtn').textContent);
  await page.locator('#chatZoomResetBtn').click();
  if (imgZoomedIn.display !== 'flex' || Number(imgZoomedIn.zIndex) < 2100 || imgZoomedIn.boxRadius !== '0px' ||
      imgZoomedIn.zoomLabel !== '125%' || imgZoomedIn.transform !== 'scale(1.25)' ||
      imgResetZoom !== '100%' || imgDblZoom !== '200%' ||
      imgZoomedIn.naturalWidth !== 1280 || imgZoomedIn.naturalHeight !== 640 ||
      !imgZoomedIn.href.startsWith('data:image/jpeg;base64,')) {
    throw new Error(`AC-004 lightbox zoom: ${JSON.stringify({imgZoomedIn, imgDblZoom, imgResetZoom})}`);
  }
  await page.locator('#chatPreviewCloseBtn').click();

  // AC-004 (c): File bubble icon-only download button (pic/下載.png, no "下載" text) & SVG/>2.5MB/F-002/F-004 checks
  await page.evaluate(() => {
    window.__downloadedAtts = [];
    window.__origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__downloadedAtts.push({download: this.download, href: this.getAttribute('href') || ''});
    };
    const dt = new DataTransfer();
    dt.items.add(new File(['%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'], 'plan.pdf', {type: 'application/pdf'}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.chat-att-file-card')).some(
      c => c.textContent.includes('plan.pdf') && Boolean(c.querySelector('button.chat-att-file-btn'))
    )
  );
  const fileCardUi = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.chat-att-file-card')).find(
      c => c.textContent.includes('plan.pdf') && Boolean(c.querySelector('button.chat-att-file-btn'))
    );
    const icon = card ? card.querySelector('img.chat-att-file-icon') : null;
    const btn = card ? card.querySelector('button.chat-att-file-btn') : null;
    const dlImg = btn && btn.querySelector('img.chat-att-download-img');
    return {
      iconSrc: icon ? icon.getAttribute('src') : '',
      btnText: btn ? btn.textContent.trim() : 'ERR',
      dlImgSrc: dlImg ? dlImg.getAttribute('src') : '',
    };
  });
  if (fileCardUi.iconSrc !== 'pic/選擇檔案.png' || fileCardUi.btnText !== '' || fileCardUi.dlImgSrc !== 'pic/下載.png') {
    throw new Error(`AC-004 file bubble icon-only download UI: ${JSON.stringify(fileCardUi)}`);
  }
  await page.locator('.chat-att-file-card', {hasText: 'plan.pdf'}).locator('.chat-att-file-btn').click();
  await page.waitForFunction(() => window.__downloadedAtts.some(d => d.download === 'plan.pdf'));

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

  // Delivery F-002 / F-004 (1): empty-MIME & octet-stream .csv uploads normalize to data:text/csv;base64,... and download cleanly
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['colA,colB\n1,2'], 'notes.csv', {type: ''}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.chat-att-file-card')).some(
      c => c.textContent.includes('notes.csv') && Boolean(c.querySelector('button.chat-att-file-btn'))
    )
  );
  await page.locator('.chat-att-file-card', {hasText: 'notes.csv'}).locator('.chat-att-file-btn').click();
  await page.waitForFunction(() =>
    window.__downloadedAtts.some(d => d.download === 'notes.csv' && d.href.startsWith('data:text/csv;base64,'))
  );

  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x,y\n3,4'], 'octet.csv', {type: 'application/octet-stream'}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.chat-att-file-card')).some(
      c => c.textContent.includes('octet.csv') && Boolean(c.querySelector('button.chat-att-file-btn'))
    )
  );
  await page.locator('.chat-att-file-card', {hasText: 'octet.csv'}).locator('.chat-att-file-btn').click();
  await page.waitForFunction(() =>
    window.__downloadedAtts.some(d => d.download === 'octet.csv' && d.href.startsWith('data:text/csv;base64,'))
  );

  // Delivery F-004 (2): application/octet-stream, spoofed csv, and blocked extension downloads must be refused
  await page.evaluate(() => {
    window.__downloadedAtts = [];
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
        uploadedBy: 'Other',
      });
      window.__emit(`formal/chat_rooms/${d}/messages/${c.msgId}`, {
        id: c.msgId,
        ts: Date.now() + 50 + idx,
        timeStr: '12:30',
        roleId: 'Other',
        roleLabel: 'Other',
        clientId: 'other_bad_client',
        text: '',
        attachment: c.meta,
      });
    });
  });
  for (const blockedName of ['evil.exe', 'spoof.csv', 'bad.exe']) {
    await page.waitForFunction(name =>
      Array.from(document.querySelectorAll('.chat-att-file-card')).some(c => c.textContent.includes(name)),
    blockedName);
    await page.evaluate(() => { clearChatStatus(); });
    await page.locator('.chat-att-file-card', {hasText: blockedName}).locator('.chat-att-file-btn').click();
    await page.waitForFunction(() => {
      const banner = document.getElementById('chatStatusBanner');
      return banner && getComputedStyle(banner).display === 'block' && banner.textContent.includes('未通過安全格式檢查');
    });
  }
  const blockedDownloadTriggered = await page.evaluate(() => {
    const count = window.__downloadedAtts.length;
    if (window.__origAnchorClick) {
      HTMLAnchorElement.prototype.click = window.__origAnchorClick;
      delete window.__origAnchorClick;
    }
    return count;
  });
  if (blockedDownloadTriggered !== 0) throw new Error('F-004: blocked attachments must never trigger anchor download');

  // Delivery F-003 (1): leave seat via close -> reopen on Screen 1 -> rejected transaction displays status banner error
  await page.locator('#chatCloseBtn').click();
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('chatModal')).display === 'none' &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) === null
  );
  await page.locator('#chatOpenBtn').click();
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('chatModal')).display === 'flex' &&
    getComputedStyle(document.getElementById('chatRoleScreen')).display === 'flex'
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
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() => {
    const banner = document.getElementById('chatStatusBanner');
    return banner && getComputedStyle(banner).display === 'block' &&
      banner.textContent.includes('PERMISSION_DENIED') &&
      getComputedStyle(document.getElementById('chatRoleScreen')).display === 'flex';
  });

  // Delivery F-003 (2) / F-001: closing modal while seat transaction is in-flight must release seat and keep no ghost seat
  await page.evaluate(() => {
    window.__flushDelayedTx = null;
    window.__txTestMode = 'delay';
  });
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() =>
    typeof window.__flushDelayedTx === 'function' &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) !== null
  );
  await page.locator('#chatRoleBackBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatModal')).display === 'none');
  await page.evaluate(() => {
    window.__txTestMode = null;
    window.__flushDelayedTx();
  });
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) === null);
  await page.evaluate(() => {
    const targetDb = typeof db !== 'undefined' ? db : firebase.database();
    if (window.__origDbRef) {
      targetDb.ref = window.__origDbRef;
      delete window.__origDbRef;
    }
  });

  // Verify 15-min local idle auto-release AND midnight rollover release + close modal
  await page.locator('#chatOpenBtn').click();
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex');
  await page.clock.fastForward(15 * 60 * 1000 + 20000);
  await page.clock.fastForward(16000);
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('chatComposerFooter')).display === 'none' &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) === null
  );

  await page.locator('#chatBackToRolesBtn').click();
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) !== null);
  await page.evaluate(() => {
    window.__oldChatDateForTest = window.__today;
    window.__origGetCurrentDateStr = window.getCurrentDateStr;
    window.getCurrentDateStr = () => '2099-01-01';
    listenToChatRoom();
  });
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__oldChatDateForTest}/seats/CPC_LM_1`) === null);
  await page.evaluate(() => {
    window.getCurrentDateStr = window.__origGetCurrentDateStr;
    listenToChatRoom();
  });

  // Regression: mobile camera/picker backgrounding wipes seat via onDisconnect -> reclaim seat on file select & clear 95% progress row
  await page.locator('#chatBackToRolesBtn').click();
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex' &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) !== null
  );
  await page.evaluate(() => {
    const cam = document.getElementById('chatCameraInput');
    cam.__origClick = cam.click;
    cam.click = () => {};
    document.getElementById('chatAttachBtn').click();
    document.getElementById('chatAttachCameraBtn').click();
    cam.click = cam.__origClick;
    delete cam.__origClick;
    window.__emit(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`, null);
  });
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) === null);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['reclaim-test'], 'reclaim.txt', {type: 'text/plain'}));
    const input = document.getElementById('chatFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.chat-att-file-card')).some(c => c.textContent.includes('reclaim.txt')) &&
    !document.getElementById('chatUploadProgressRow') &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) !== null &&
    getComputedStyle(document.getElementById('chatComposerFooter')).display === 'block' &&
    !document.getElementById('chatStatusBanner').textContent.includes('請先選擇角色再上傳附件')
  );

  await page.locator('#chatCloseBtn').click();

  if (errors.length) throw new Error(JSON.stringify(errors));
  return {externalServices: 'mocked', initial, forecast, operations, commands, chatVerified: true, expiredLeaseRecovered: true, errors};
}
