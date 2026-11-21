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
    window.__confirmResult = true;
    window.__confirmCalls = [];
    window.confirm = message => {
      window.__confirmCalls.push(String(message || ''));
      return window.__confirmResult;
    };
    window.prompt = () => 'synthetic';
    window.__customVerifyHandler = null;
    window.fetch = async (url, options = {}) => {
      const parsed = new URL(url);
      const action = parsed.searchParams.get('action');
      let scheduleBody = null;
      if (options && options.body && typeof options.body.get === 'function') {
        scheduleBody = options.body.get('schedule');
      }
      const reqRecord = {
        action,
        pwd: parsed.searchParams.get('pwd'),
        mode: parsed.searchParams.get('mode'),
        pobTime: parsed.searchParams.get('pob_time'),
        modalType: parsed.searchParams.get('modal_type'),
        schedule: scheduleBody,
      };
      window.__requests.push(reqRecord);
      if (action === 'verify_password' && typeof window.__customVerifyHandler === 'function') {
        return window.__customVerifyHandler(reqRecord);
      }
      return {ok: true, status: 200, json: async () => ({status: 'success', data: []}), text: async () => 'OK'};
    };
  });

  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('http://127.0.0.1:4177/index.html');

  // AC-001: Unified top header (no gold border, 操作說明 text) & fixed 4-tab bottom nav with active sky-blue capsule
  const initial = await page.evaluate(() => {
    const labelStyle = getComputedStyle(document.querySelector('.wind-card-label'));
    const windSpeedEl = document.getElementById('windSpeed');
    const windRowStyle = getComputedStyle(document.querySelector('.wind-main-row'));
    const timeEl = document.getElementById('dataTime');
    const timeStyle = getComputedStyle(timeEl);
    const timeRect = timeEl.getBoundingClientRect();
    const speedRect = windSpeedEl.getBoundingClientRect();
    const headerBar = document.querySelector('.app-header-bar');
    const headerBarStyle = getComputedStyle(headerBar);
    const bottomNavInnerStyle = getComputedStyle(document.querySelector('.bottom-nav-inner'));
    const monitorWrapStyle = getComputedStyle(document.querySelector('#navMonitorBtn .bottom-nav-icon-wrap'));
    const forecastWrapStyle = getComputedStyle(document.querySelector('#navForecastBtn .bottom-nav-icon-wrap'));
    return {
      title: document.title,
      wind: windSpeedEl.textContent,
      windSpeedFontSize: parseFloat(getComputedStyle(windSpeedEl).fontSize),
      schedule: document.body.textContent.includes('DEMO-SHIP'),
      hasLegacyPresLink: Boolean(document.querySelector('.presentation-link')),
      windTitle: document.querySelector('.wind-card-label')?.textContent?.trim(),
      windLabelFontSize: parseFloat(labelStyle.fontSize),
      windLabelFontWeight: Number(labelStyle.fontWeight),
      windLabelAlign: labelStyle.textAlign,
      hasWindForecastBtn: document.querySelector('.wind-card')?.textContent?.includes('風速預報'),
      scheduleTitle: document.querySelector('.schedule-title')?.textContent?.trim(),
      infoHref: document.getElementById('infoLink')?.getAttribute('href'),
      infoText: document.getElementById('infoLink')?.textContent?.trim(),
      headerTitleText: document.querySelector('.app-title')?.textContent?.trim(),
      headerBarPosition: headerBarStyle.position,
      headerBarBg: headerBarStyle.backgroundColor,
      headerBarBorderBottom: headerBarStyle.borderBottomWidth,
      headerHasBell: Boolean(document.querySelector('.app-header #soundToggle')),
      scheduleHasBell: Boolean(document.querySelector('.schedule-header #soundToggle')),
      windMainRowJustify: windRowStyle.justifyContent,
      timeBelowSpeed: timeRect.top >= speedRect.bottom - 2,
      timeText: timeEl.textContent,
      timeAlign: timeStyle.textAlign,
      tableHeadBg: getComputedStyle(document.querySelector('#scheduleHeaderRow th')).backgroundColor,
      bottomNavInnerHeight: parseFloat(bottomNavInnerStyle.height),
      monitorNavWrapBg: monitorWrapStyle.backgroundColor,
      monitorNavWrapColor: monitorWrapStyle.color,
      inactiveNavWrapBg: forecastWrapStyle.backgroundColor,
      soundDisplay: getComputedStyle(document.getElementById('soundToggle')).display,
      backdropFilter: getComputedStyle(document.querySelector('.wind-card')).backdropFilter,
      hasWatermark: document.body.textContent.includes('介面示意'),
    };
  });
  if (initial.title !== '臺中LNG船監控(v1.5)' || initial.wind !== '4' || initial.windSpeedFontSize < 50 || !initial.schedule ||
      initial.hasLegacyPresLink || initial.windTitle !== '北堤風速' ||
      initial.windLabelFontSize < 18 || initial.windLabelFontWeight < 800 || initial.windLabelAlign !== 'center' ||
      initial.hasWindForecastBtn || initial.scheduleTitle !== '船期表' ||
      initial.infoHref !== 'presentation/intro.html' || initial.infoText !== '操作說明' ||
      initial.headerTitleText !== '臺中 LNG 船監控' || initial.headerBarPosition !== 'fixed' ||
      initial.headerBarBg !== 'rgb(11, 41, 72)' || initial.headerBarBorderBottom !== '0px' ||
      initial.headerHasBell || !initial.scheduleHasBell ||
      initial.windMainRowJustify !== 'center' || !initial.timeBelowSpeed ||
      !initial.timeText.startsWith('更新時間 ') || initial.timeAlign !== 'center' ||
      initial.tableHeadBg !== 'rgb(226, 238, 250)' || Math.abs(initial.bottomNavInnerHeight - 66) > 1 ||
      initial.monitorNavWrapBg !== 'rgb(217, 236, 255)' || initial.monitorNavWrapColor !== 'rgb(24, 119, 242)' ||
      initial.inactiveNavWrapBg !== 'rgba(0, 0, 0, 0)' ||
      initial.soundDisplay !== 'none' || initial.backdropFilter !== 'none' || initial.hasWatermark) {
    throw new Error(`Initial UI: ${JSON.stringify(initial)}`);
  }

  // AC-004: Schedule terminal badges (W12 orange, W13 deep navy #0B2948) and numeric speed cells
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

  // PulsoIcon wind icon + gear icon + bottom nav 4 tabs
  const icon = await page.evaluate(() => {
    const svg = document.querySelector('.wind-icon');
    const iconRect = svg.getBoundingClientRect();
    const unit = document.querySelector('.wind-speed-unit').getBoundingClientRect();
    const number = document.getElementById('windSpeed').getBoundingClientRect();
    const chatBtn = document.getElementById('chatOpenBtn');
    const gearSvg = document.querySelector('.cpc-btn.pulso-settings');
    const gearRect = gearSvg.getBoundingClientRect();
    const navBtns = Array.from(document.querySelectorAll('.bottom-nav-item')).map(b => ({id: b.id, text: b.textContent.trim()}));
    return {
      aboveUnit: iconRect.bottom <= unit.top,
      rightOfNumber: iconRect.left >= number.right,
      alignedBottom: Math.abs(unit.bottom - (number.bottom - 3)) < 4,
      windTag: svg.tagName.toLowerCase(),
      mask: getComputedStyle(svg).maskImage,
      windBg: getComputedStyle(svg).backgroundColor,
      windColor: getComputedStyle(svg).color,
      windPaths: svg.querySelectorAll('path.pulso-wind-1, path.pulso-wind-2, path.pulso-wind-3').length,
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
  if (icon.chatOnclick !== 'openChatModal()' || icon.chatAriaLabel !== '開啟 LNG 船聊天室' ||
      icon.chatCursor !== 'pointer' || icon.unreadBadgeDisplay !== 'none' ||
      JSON.stringify(icon.navBtns) !== JSON.stringify([
        {id: 'navMonitorBtn', text: '監控'},
        {id: 'navForecastBtn', text: '預報'},
        {id: 'navScheduleBtn', text: '船期'},
        {id: 'chatOpenBtn', text: icon.navBtns[3].text},
      ]) || !icon.navBtns[3].text.includes('聊天室')) {
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

  // Verify schedule header columns & that double-click / double-tap on #scheduleHeaderRow NO LONGER triggers password/adjust
  const headerStyles = await page.evaluate(() => {
    const row = document.getElementById('scheduleHeaderRow');
    const ths = Array.from(row.querySelectorAll('th'));
    return {
      texts: ths.map(th => th.textContent.trim()),
      userSelect: ths.map(th => getComputedStyle(th).userSelect),
    };
  });
  if (JSON.stringify(headerStyles.texts) !== JSON.stringify(['日期', '船名', '速限'])) {
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

  // AC-005: Bottom nav 預報 tab opens embedded #forecastModal (header & bottom nav stay visible, sky-blue active capsule, dark ship card, isolated ECharts stacking above #pwdModal)
  await page.locator('#navForecastBtn').click();
  await page.waitForTimeout(220);
  const forecastTabState = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#navForecastBtn .bottom-nav-icon-wrap'));
    const fModal = document.getElementById('forecastModal');
    const mView = document.getElementById('monitorView');
    const shipCard = document.querySelector('.forecast-ship-card');
    const shipLabel = document.querySelector('.forecast-ship-label');
    const shipSelect = document.getElementById('shipForecastSelect');
    const chartCard = document.querySelector('.forecast-chart-card');
    const chartWrap = document.querySelector('.chart-wrapper');
    const shipCardStyle = getComputedStyle(shipCard);
    const labelStyle = getComputedStyle(shipLabel);
    const selectStyle = getComputedStyle(shipSelect);
    return {
      forecastVisible: getComputedStyle(fModal).display !== 'none',
      monitorHidden: getComputedStyle(mView).display === 'none',
      headerVisible: getComputedStyle(document.querySelector('.app-header-bar')).display !== 'none',
      navVisible: getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none',
      navActive: document.getElementById('navForecastBtn').classList.contains('is-active'),
      bg: s.backgroundColor,
      color: s.color,
      chartBg: getComputedStyle(chartCard).backgroundColor,
      chartIsolation: getComputedStyle(chartCard).isolation,
      wrapIsolation: getComputedStyle(chartWrap).isolation,
      shipBg: shipCardStyle.backgroundColor,
      shipLabelColor: labelStyle.color,
      selectBg: selectStyle.backgroundColor,
      selectColor: selectStyle.color,
      selectChevron: selectStyle.backgroundImage,
      shipBelowChart: shipCard.getBoundingClientRect().top >= chartCard.getBoundingClientRect().bottom - 1,
    };
  });
  if (!forecastTabState.forecastVisible || !forecastTabState.monitorHidden ||
      !forecastTabState.headerVisible || !forecastTabState.navVisible ||
      !forecastTabState.navActive || forecastTabState.bg !== 'rgb(217, 236, 255)' ||
      forecastTabState.color !== 'rgb(24, 119, 242)' || forecastTabState.chartBg !== 'rgb(15, 23, 34)' ||
      forecastTabState.chartIsolation !== 'isolate' || forecastTabState.wrapIsolation !== 'isolate' ||
      forecastTabState.shipBg !== 'rgb(15, 23, 34)' || forecastTabState.shipLabelColor !== 'rgb(203, 213, 225)' ||
      forecastTabState.selectBg !== 'rgb(22, 34, 52)' || forecastTabState.selectColor !== 'rgb(248, 250, 252)' ||
      !String(forecastTabState.selectChevron || '').includes('data:image/svg+xml') ||
      !forecastTabState.shipBelowChart) {
    throw new Error(`Embedded forecast tab state: ${JSON.stringify(forecastTabState)}`);
  }

  // D6 Item 5: High z-index ECharts tooltip inside #forecastChart must NEVER overlap #pwdModal when tapping #navScheduleBtn
  await page.evaluate(() => {
    const fc = document.getElementById('forecastChart');
    const tip = document.createElement('div');
    tip.id = '__syntheticTooltip';
    tip.className = 'custom-tooltip';
    tip.style.cssText = 'position: fixed; position: absolute; inset: 0; z-index: 9999999; pointer-events: auto;';
    tip.textContent = '11/23 06:00 Tooltip';
    fc.appendChild(tip);
  });
  await page.locator('#navScheduleBtn').click();
  if (!await page.locator('#pwdModal').isVisible()) throw new Error('Expected #pwdModal when clicking 船期 from 預報');
  const pwdTopMostCheck = await page.evaluate(() => {
    const pwdModal = document.getElementById('pwdModal');
    const inp = document.getElementById('modalPwdInput');
    const r = inp.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const tip = document.getElementById('__syntheticTooltip');
    if (tip) tip.remove();
    return {
      modalZ: Number(getComputedStyle(pwdModal).zIndex),
      hitIsInput: hit === inp || pwdModal.contains(hit),
      hitTag: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null,
    };
  });
  await page.evaluate(() => closePwdModal(false));
  if (pwdTopMostCheck.modalZ < 2000 || !pwdTopMostCheck.hitIsInput) {
    throw new Error(`D6 Item 5 tooltip overlapped #pwdModal: ${JSON.stringify(pwdTopMostCheck)}`);
  }

  await page.locator('#navMonitorBtn').click();
  if (await page.locator('#forecastModal').isVisible() || !await page.locator('#monitorView').isVisible()) {
    throw new Error('Clicking 監控 tab must return to monitorView');
  }

  // AC-006: Bottom nav 船期 tab -> password -> embedded schedule adjust tab (UNFINISHED_SHIP, MM/DD, terminal pill sync, dirty-leave guard, auth failure guard, delete/save)
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
  if (!await page.locator('#scheduleAdjustModal').isVisible()) throw new Error('Password confirmation must open schedule adjust tab');
  await page.waitForTimeout(0);
  const verifySchedReq = await page.evaluate(() => window.__requests.find(r => r.action === 'verify_password' && r.modalType === 'schedule'));
  if (!verifySchedReq) throw new Error('Expected verify_password request with modal_type=schedule');

  const adjustCardsState = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#adjustCardList .adjust-card'));
    const schedTab = document.getElementById('scheduleAdjustModal');
    return {
      count: cards.length,
      headerVisible: getComputedStyle(document.querySelector('.app-header-bar')).display !== 'none',
      navVisible: getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none',
      navActive: document.getElementById('navScheduleBtn').classList.contains('is-active'),
      schedDisplay: getComputedStyle(schedTab).display,
      firstHasUnfinishedTag: Boolean(cards[0]?.querySelector('.adjust-unfinished-tag')),
      firstTitle: cards[0]?.querySelector('.adjust-card-title')?.textContent?.trim(),
      firstDateVal: cards[0]?.querySelector('.adjust-date-input')?.value,
      existingHasShipInput: cards.some(c => Boolean(c.querySelector('.adjust-ship-input'))),
      subText: document.querySelector('.adjust-page-sub')?.textContent?.trim(),
      subRightOfTitle: (() => {
        const tEl = document.getElementById('scheduleAdjustTitle')?.getBoundingClientRect();
        const sEl = document.querySelector('.adjust-page-sub')?.getBoundingClientRect();
        return Boolean(tEl && sEl && sEl.left >= tEl.right + 4 && Math.abs(sEl.bottom - tEl.bottom) < 8);
      })(),
      firstHasCalIcon: Boolean(cards[0]?.querySelector('.adjust-date-icon')),
      firstPillText: cards[0]?.querySelector('.adjust-terminal-pill')?.textContent?.trim(),
      firstPillBg: cards[0]?.querySelector('.adjust-terminal-pill') && getComputedStyle(cards[0].querySelector('.adjust-terminal-pill')).backgroundColor,
      customSpeedPreserved: cards[3]?.querySelector('.adjust-speed-select')?.value,
      speedSelectBgImage: cards[0]?.querySelector('.adjust-speed-select') && getComputedStyle(cards[0].querySelector('.adjust-speed-select')).backgroundImage,
      cardBgs: cards.map(c => getComputedStyle(c).backgroundColor),
      addBtnText: document.getElementById('adjustAddBtn')?.textContent?.trim(),
      addBtnHasClass: document.getElementById('adjustAddBtn')?.classList.contains('add-row-btn'),
      addBtnRadius: getComputedStyle(document.getElementById('adjustAddBtn')).borderRadius,
      addBtnWidth: Math.round(document.getElementById('adjustAddBtn').getBoundingClientRect().width),
      addBtnHeight: Math.round(document.getElementById('adjustAddBtn').getBoundingClientRect().height),
      addBtnBg: getComputedStyle(document.getElementById('adjustAddBtn')).backgroundColor,
      saveBtnBg: getComputedStyle(document.getElementById('saveScheduleBtn')).backgroundColor,
      cancelBtnText: document.getElementById('cancelScheduleBtn')?.textContent?.trim(),
    };
  });
  if (adjustCardsState.count !== 4 || !adjustCardsState.headerVisible || !adjustCardsState.navVisible ||
      !adjustCardsState.navActive || adjustCardsState.schedDisplay !== 'block' ||
      !adjustCardsState.firstHasUnfinishedTag || adjustCardsState.firstTitle !== 'UNFIN-SHIP' ||
      adjustCardsState.firstDateVal !== '' || adjustCardsState.existingHasShipInput ||
      adjustCardsState.subText !== '修改後請儲存' || !adjustCardsState.subRightOfTitle ||
      !adjustCardsState.firstHasCalIcon || adjustCardsState.firstPillText !== 'W12' ||
      adjustCardsState.firstPillBg !== 'rgb(217, 119, 6)' || adjustCardsState.customSpeedPreserved !== '13.8' ||
      !String(adjustCardsState.speedSelectBgImage || '').includes('data:image/svg+xml') ||
      JSON.stringify(adjustCardsState.cardBgs) !== JSON.stringify([
        'rgb(255, 255, 255)', 'rgb(235, 239, 244)', 'rgb(255, 255, 255)', 'rgb(235, 239, 244)'
      ]) ||
      adjustCardsState.addBtnText !== '＋' || !adjustCardsState.addBtnHasClass ||
      adjustCardsState.addBtnRadius !== '50%' || adjustCardsState.addBtnWidth !== 36 ||
      adjustCardsState.addBtnHeight !== 36 || adjustCardsState.addBtnBg !== 'rgb(22, 78, 138)' ||
      adjustCardsState.saveBtnBg !== 'rgb(0, 102, 230)' ||
      adjustCardsState.cancelBtnText !== '取消') {
    throw new Error(`Adjust cards state: ${JSON.stringify(adjustCardsState)}`);
  }

  // D7 Item 1: Touch/pointer on circular #adjustAddBtn activates .is-spin-green (#28a745 + 90deg rotate) and clears cleanly
  const addSpinCheck = await page.evaluate(() => {
    const btn = document.getElementById('adjustAddBtn');
    btn.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    const hasStart = btn.classList.contains('is-spin-green');
    btn.style.transition = 'none';
    const st = getComputedStyle(btn);
    const activeStyle = {hasStart, bg: st.backgroundColor, transform: st.transform};
    btn.style.transition = '';
    return activeStyle;
  });
  await page.clock.fastForward(480);
  const addSpinEnd = await page.evaluate(() => document.getElementById('adjustAddBtn').classList.contains('is-spin-green'));
  if (!addSpinCheck.hasStart || addSpinCheck.bg !== 'rgb(40, 167, 69)' ||
      addSpinCheck.transform === 'none' || addSpinCheck.transform === 'matrix(1, 0, 0, 1, 0, 0)' || addSpinEnd) {
    throw new Error(`D7 circular add button green spin check failed: ${JSON.stringify({addSpinCheck, addSpinEnd})}`);
  }

  // Verify live terminal pill update & live ship title oninput update, then test dirty-leave guard!
  await page.locator('.adjust-card').nth(1).locator('.adjust-terminal-select').selectOption('W13');
  const pillSynced = await page.evaluate(() => {
    const pill = document.querySelectorAll('.adjust-card')[1].querySelector('.adjust-terminal-pill');
    return {text: pill.textContent.trim(), bg: getComputedStyle(pill).backgroundColor};
  });
  if (pillSynced.text !== 'W13' || pillSynced.bg !== 'rgb(11, 41, 72)') {
    throw new Error(`Live terminal pill sync failed: ${JSON.stringify(pillSynced)}`);
  }

  // Dirty-leave guard: confirm=false keeps user on schedule tab with edits & password intact
  await page.evaluate(() => {
    window.__confirmCalls = [];
    window.__confirmResult = false;
  });
  await page.locator('#navMonitorBtn').click();
  const stayOnDirtyCancel = await page.evaluate(() => ({
    tab: currentActiveTab,
    schedVisible: getComputedStyle(document.getElementById('scheduleAdjustModal')).display !== 'none',
    confirmCount: window.__confirmCalls.length,
    pwdIntact: cachedSessionPassword === 'synthetic',
  }));
  if (stayOnDirtyCancel.tab !== 'schedule' || !stayOnDirtyCancel.schedVisible ||
      stayOnDirtyCancel.confirmCount !== 1 || !stayOnDirtyCancel.pwdIntact) {
    throw new Error(`Dirty-leave cancel guard failed: ${JSON.stringify(stayOnDirtyCancel)}`);
  }

  // Confirm=true leaves schedule tab, releases lock, and clears cachedSessionPassword
  await page.evaluate(() => {
    window.__confirmCalls = [];
    window.__confirmResult = true;
  });
  await page.locator('#cancelScheduleBtn').click();
  await page.waitForTimeout(0);
  const leftOnConfirm = await page.evaluate(() => ({
    tab: currentActiveTab,
    schedVisible: getComputedStyle(document.getElementById('scheduleAdjustModal')).display !== 'none',
    confirmCount: window.__confirmCalls.length,
    pwdCleared: cachedSessionPassword === '',
    releasedLock: window.__requests.some(r => r.action === 'release_lock'),
  }));
  if (leftOnConfirm.tab !== 'monitor' || leftOnConfirm.schedVisible ||
      leftOnConfirm.confirmCount !== 1 || !leftOnConfirm.pwdCleared || !leftOnConfirm.releasedLock) {
    throw new Error(`Dirty-leave accept cleanup failed: ${JSON.stringify(leftOnConfirm)}`);
  }

  // Re-open schedule adjust, test 4-digit auto-format, 99/99 invalid date, addEditItem, deleteEditItem, and 0 dirty-leave confirms on save
  await page.clock.fastForward(5100);
  await page.locator('#navScheduleBtn').click();
  await page.fill('#modalPwdInput', 'synthetic');
  await page.evaluate(() => closePwdModal(true));
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
  await page.locator('.adjust-card').nth(0).locator('.adjust-date-input').fill('06/15');
  await page.locator('.adjust-card').nth(0).locator('.adjust-ship-input').fill('NEW-SHIP');
  const existingCardShipInput = await page.locator('.adjust-card').nth(1).locator('.adjust-ship-input').count();
  if (existingCardShipInput !== 0) throw new Error('Existing card must not render ship name input');
  const liveTitleUpdated = await page.evaluate(() => document.querySelectorAll('.adjust-card .adjust-card-title')[0].textContent.trim());
  if (liveTitleUpdated !== 'NEW-SHIP') throw new Error(`Live ship title oninput failed: ${liveTitleUpdated}`);

  await page.evaluate(() => {
    window.__confirmCalls = [];
    window.__confirmResult = true;
    window.__requests = [];
  });
  // Delete DEMO-W13 (now at index 3 after addEditItem)
  await page.locator('.adjust-card').nth(3).locator('.adjust-delete-btn').click();
  await page.locator('#saveScheduleBtn').click();
  await page.waitForTimeout(0);
  const savedInfo = await page.evaluate(() => ({
    req: window.__requests.find(r => r.action === 'update_schedule'),
    confirmCalls: window.__confirmCalls.slice(),
    schedVisible: getComputedStyle(document.getElementById('scheduleAdjustModal')).display !== 'none',
    tab: currentActiveTab,
  }));
  if (!savedInfo.req || !savedInfo.req.schedule || savedInfo.confirmCalls.length !== 1 ||
      !savedInfo.confirmCalls[0].includes('DEMO-W13') || savedInfo.schedVisible || savedInfo.tab !== 'monitor') {
    throw new Error(`Save schedule confirm/close check failed: ${JSON.stringify(savedInfo)}`);
  }
  const savedDiff = JSON.parse(savedInfo.req.schedule);
  if (savedDiff.length !== 2 ||
      !savedDiff[0].is_deleted || savedDiff[0].ship_name !== 'DEMO-W13' || savedDiff[0].d !== '6/10' ||
      savedDiff[1].is_deleted !== false || savedDiff[1].ship_name !== 'NEW-SHIP' || savedDiff[1].d !== '6/15' || savedDiff[1].terminal !== 'W13') {
    throw new Error(`Unexpected update_schedule diff payload: ${JSON.stringify(savedDiff)}`);
  }

  // DES-002: Delayed auth failure on dirty schedule tab closes cleanly without dirty confirm; cross-session delayed failure does NOT yank active #manualModal
  await page.clock.fastForward(5100);
  await page.evaluate(() => {
    window.__confirmCalls = [];
    window.__confirmResult = false;
    window.__alerts = [];
    window.__customVerifyHandler = () => new Promise(resolve => {
      window.__resolveVerify = status => resolve({ok: true, status: 200, json: async () => ({status})});
    });
  });
  await page.locator('#navScheduleBtn').click();
  await page.fill('#modalPwdInput', 'bad-pwd');
  await page.evaluate(() => closePwdModal(true));
  await page.locator('.adjust-card').nth(0).locator('.adjust-date-input').fill('07/01');
  await page.evaluate(async () => {
    window.__resolveVerify('error');
    await new Promise(r => setTimeout(r, 10));
  });
  const dirtyAuthFail = await page.evaluate(() => ({
    tab: currentActiveTab,
    schedVisible: getComputedStyle(document.getElementById('scheduleAdjustModal')).display !== 'none',
    confirmCount: window.__confirmCalls.length,
    pwdCleared: cachedSessionPassword === '',
  }));
  if (dirtyAuthFail.tab !== 'monitor' || dirtyAuthFail.schedVisible || dirtyAuthFail.confirmCount !== 0 || !dirtyAuthFail.pwdCleared) {
    throw new Error(`Dirty auth fail must skip confirm and return to monitor: ${JSON.stringify(dirtyAuthFail)}`);
  }

  // Now test delayed stale verify_password from canceled schedule session does not touch new #manualModal session
  await page.clock.fastForward(5100);
  await page.evaluate(() => {
    window.__resolveVerify = null;
    window.__customVerifyHandler = req => {
      if (req.modalType === 'schedule') {
        return new Promise(resolve => {
          window.__resolveOldSchedVerify = () => resolve({ok: true, status: 200, json: async () => ({status: 'error'})});
        });
      }
      return Promise.resolve({ok: true, status: 200, json: async () => ({status: 'success'})});
    };
  });
  await page.locator('#navScheduleBtn').click();
  await page.fill('#modalPwdInput', 'stale-pwd');
  await page.evaluate(() => closePwdModal(true));
  await page.locator('#cancelScheduleBtn').click();
  await page.clock.fastForward(5100);
  await page.locator('.cpc-btn').click();
  await page.fill('#modalPwdInput', 'active-manual-pwd');
  await page.evaluate(() => closePwdModal(true));
  await page.evaluate(async () => {
    window.__resolveOldSchedVerify();
    await new Promise(r => setTimeout(r, 10));
    window.__customVerifyHandler = null;
  });
  const crossSessionIsolation = await page.evaluate(() => ({
    manualOpen: getComputedStyle(document.getElementById('manualModal')).display === 'flex',
    pwdIntact: cachedSessionPassword === 'active-manual-pwd',
  }));
  if (!crossSessionIsolation.manualOpen || !crossSessionIsolation.pwdIntact) {
    throw new Error(`Stale delayed verify_password leaked across sessions: ${JSON.stringify(crossSessionIsolation)}`);
  }
  await page.evaluate(() => closeManualModal());

  // Restore standard test schedule and default confirm=true for remaining tests
  await page.evaluate(() => {
    window.__confirmResult = true;
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

  // AC-002 / AC-004: Entry conditions + bell SVG states + full-width #dynamicBox + 375x812 overflow + #B91C1C icon filter
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
      {wind: 10, wave: 2.5, visibility: 2, status: 'safe', reasons: 0, ship: 'DEMO-SHIP'},
      {wind: 10, wave: 2.51, visibility: 2, status: 'warning', reasons: 1, ship: 'DEMO-SHIP'},
      {wind: 10, wave: 2.5, visibility: 1.99, status: 'warning', reasons: 1, ship: 'DEMO-SHIP'},
      {wind: 10, wave: 2.51, visibility: 1.99, status: 'warning', reasons: 2, ship: 'LONG-VESSEL-NAME-FOR-375PX-OVERFLOW-CHECK'},
      {wind: 13, wave: 2.5, visibility: 2, status: 'warning', reasons: 0, ship: 'DEMO-SHIP'},
      {wind: 13, wave: 2.51, visibility: 2, status: 'warning', reasons: 0, ship: 'DEMO-SHIP'},
      {wind: 13, wave: 2.5, visibility: 1.99, status: 'warning', reasons: 0, ship: 'DEMO-SHIP'},
      {wind: 13, wave: 2.51, visibility: 1.99, status: 'warning', reasons: 0, ship: 'DEMO-SHIP'},
      {wind: 10, wave: null, visibility: null, status: 'safe', reasons: 0, ship: 'DEMO-SHIP'},
      {wind: 10, wave: '', visibility: 0, status: 'warning', reasons: 1, ship: 'DEMO-SHIP'},
      {wind: 10, wave: 3, visibility: '未知', status: 'warning', reasons: 1, ship: 'DEMO-SHIP'},
      {wind: 4, wave: 1, visibility: 5, seasonTime: '--:--', status: 'waiting', reasons: 0, ship: 'DEMO-SHIP'},
    ];
    const results = cases.map(item => {
      window.__emit('formal/active_status', {app_mode: 'start', ship_name: item.ship, limit_speed: 12,
        season_time: item.seasonTime || '06:00', current_wind: item.wind, current_wave: item.wave, current_visibility: item.visibility});
      const box = document.getElementById('dynamicBox');
      const windCard = document.querySelector('.wind-card');
      const boxRect = box.getBoundingClientRect();
      const cardRect = windCard.getBoundingClientRect();
      const reasons = [...box.querySelectorAll('.condition-warning')];
      const filters = reasons.map(row => getComputedStyle(row.querySelector('img')).filter);
      return {
        expected: item,
        status: currentStatus,
        text: box.textContent,
        reasons: reasons.length,
        insideWindCard: Boolean(windCard.contains(box)) && boxRect.right <= cardRect.right + 1,
        fullWidthBar: boxRect.width >= cardRect.width * 0.85,
        dividerVisible: getComputedStyle(windCard.querySelector('.wind-status-divider')).display === 'block',
        noOverflow375: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        images: reasons.map(row => row.querySelector('img')?.getAttribute('src')),
        filters,
        highlighted: item.ship === 'DEMO-SHIP' ? document.querySelector('#scheduleBody tr[data-shipname="DEMO-SHIP"]').className : 'skip',
        soundPlaying: !notificationSound.paused,
      };
    });
    isSoundEnabled = false;
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:00'});
    const dividerHiddenAfterStop = getComputedStyle(document.querySelector('.wind-status-divider')).display === 'none';
    if (!dividerHiddenAfterStop) throw new Error('Expected .wind-status-divider hidden after stop');
    return results;
  });
  for (const result of conditions) {
    if (result.status !== result.expected.status || result.reasons !== result.expected.reasons ||
        !result.insideWindCard || !result.fullWidthBar || !result.dividerVisible || !result.noOverflow375 ||
        result.soundPlaying !== (result.status === 'safe') ||
        (result.highlighted !== 'skip' && !result.highlighted.includes(`schedule-row-${result.status}`))) {
      throw new Error(`Entry conditions: ${JSON.stringify(result)}`);
    }
    if (!result.text.includes(result.expected.ship)) throw new Error(`Status bar missing ship name: ${JSON.stringify(result)}`);
    if (result.expected.status === 'waiting' && !result.text.includes('等待進港')) throw new Error(`Waiting label missing: ${JSON.stringify(result)}`);
    if (result.expected.wind > 12 && !result.text.includes('風速超標')) throw new Error(`Wind priority: ${JSON.stringify(result)}`);
    if (result.expected.wind <= 12 && typeof result.expected.wave === 'number' && result.expected.wave > 2.5 &&
        !result.text.includes(`浪高 ${result.expected.wave} > 2.5 m`)) throw new Error(`Wave value: ${JSON.stringify(result)}`);
    if (result.expected.wind <= 12 && typeof result.expected.visibility === 'number' && result.expected.visibility < 2 &&
        !result.text.includes(`能見度 ${result.expected.visibility} < 2 浬`)) throw new Error(`Visibility value: ${JSON.stringify(result)}`);
    for (const f of result.filters) {
      if (!f || f === 'none' || f === 'brightness(0) invert(1)') {
        throw new Error(`Icon filter must not remain white invert(1): ${JSON.stringify(result)}`);
      }
    }
    if (result.expected.reasons === 2 && (result.images.join(',') !== '/APP_SVG/wave.svg,/APP_SVG/eye.svg' ||
        !result.text.includes('浪高 2.51 > 2.5 m') || !result.text.includes('能見度 1.99 < 2 浬'))) {
      throw new Error(`Entry warning details: ${JSON.stringify(result)}`);
    }
  }
  await page.setViewportSize({width: 390, height: 844});

  // AC-003: Verify POB card structure, is-no-entry styling & same-day dual-ship coexistence
  await page.evaluate(() => {
    getCurrentTimeHHMM = () => '10:00';
    window.__emit(`formal/daily_records/${window.__today}`, {
      ship_a: {config: {ship_name: 'DEMO-W13'}, pob_info: {pob_time: '06:15', formatted_msg: 'DEMO-W13 已於 06:15 進港'}},
      ship_b: {config: {ship_name: 'DEMO-NOENTRY'}, pob_info: {no_entry_reason: '風速超標', formatted_msg: 'DEMO-NOENTRY 無法進港'}}
    });
    window.__emit('formal/active_status', {app_mode: 'start', ship_name: 'DEMO-SHIP', limit_speed: 12, season_time: '06:00', current_wind: 7.4});
  });
  const dualCoexist = await page.evaluate(() => {
    const pobEl = document.getElementById('pobList');
    const row = pobEl.querySelector('.pob-item-row');
    const noEntryRow = pobEl.querySelector('.pob-item-row.is-no-entry');
    const noEntryStyle = noEntryRow ? getComputedStyle(noEntryRow) : null;
    return {
      pobDisplay: getComputedStyle(pobEl).display,
      pobBg: getComputedStyle(pobEl).backgroundColor,
      pobTitle: pobEl.querySelector('.pob-card-title')?.textContent?.trim(),
      pobShip: row?.querySelector('.pob-item-ship')?.textContent?.trim(),
      pobTime: row?.querySelector('.pob-item-time')?.textContent?.trim(),
      noEntryText: noEntryRow?.textContent?.trim(),
      noEntryBg: noEntryStyle?.backgroundColor,
      noEntryColor: noEntryStyle?.color,
      boxDisplay: getComputedStyle(document.getElementById('dynamicBox')).display,
      boxText: document.getElementById('dynamicBox').textContent,
    };
  });
  if (dualCoexist.pobDisplay !== 'block' || dualCoexist.pobBg !== 'rgb(255, 255, 255)' ||
      dualCoexist.pobTitle !== 'POB 紀錄' || dualCoexist.pobShip !== 'DEMO-W13' ||
      dualCoexist.pobTime !== '06:15' || dualCoexist.noEntryText !== 'DEMO-NOENTRY 無法進港' ||
      dualCoexist.noEntryBg !== 'rgb(254, 242, 242)' || dualCoexist.noEntryColor !== 'rgb(185, 28, 28)' ||
      dualCoexist.boxDisplay !== 'block' || !dualCoexist.boxText.includes('可進港')) {
    throw new Error(`Dual-ship same-day POB + status coexistence failed: ${JSON.stringify(dualCoexist)}`);
  }
  await page.evaluate(() => {
    window.__emit(`formal/daily_records/${window.__today}`, null);
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:00'});
  });

  // D6 Item 6: Clicking #windSpeed MUST NOT navigate to forecast; use bottom nav #navForecastBtn only
  const windCursor = await page.locator('#windSpeed').evaluate(el => getComputedStyle(el).cursor);
  if (windCursor === 'pointer') throw new Error(`D6 Item 6: #windSpeed cursor must not be pointer (${windCursor})`);
  await page.locator('#windSpeed').click();
  if (await page.locator('#forecastModal').isVisible() || !await page.locator('#monitorView').isVisible()) {
    throw new Error('D6 Item 6: Clicking #windSpeed must NOT open forecast tab');
  }
  await page.locator('#navForecastBtn').click();
  if (!await page.locator('#forecastModal').isVisible()) throw new Error('Bottom nav 預報 must open forecast');
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

  await page.locator('#navMonitorBtn').click();
  await page.evaluate(() => {
    window.__emit('formal/active_status', {app_mode: 'start', target_key: 'synthetic', ship_name: 'DEMO-SHIP', limit_speed: 12, terminal: 'W12', current_wind: 4});
    window.__emit(`formal/daily_records/${window.__today}`, {synthetic: {config: {ship_name: 'DEMO-SHIP'}, pob_info: {pob_time: '10:00', formatted_msg: '示意 POB'}}});
  });
  const operations = await page.evaluate(() => ({monitor: document.getElementById('shipName').disabled, pob: document.getElementById('pobList').textContent.includes('DEMO-SHIP') && document.getElementById('pobList').textContent.includes('10:00')}));
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

  // ==================== AC-007: Ship Chat Room v2 Embedded Tab + D2 Off-Tab Seat Persistence ====================
  await page.evaluate(() => {
    localStorage.clear();
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}`, null);
    window.__emit(`formal/chat_attachments/${d}`, null);
  });

  // Unread static red dot lifecycle (no "!", persists on #chatRoleScreen until #chatRoomScreen entered)
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
    return {
      text: badge.textContent.trim(),
      display: bs.display,
      bg: bs.backgroundColor,
      width: parseFloat(bs.width),
      height: parseFloat(bs.height),
      radius: bs.borderRadius,
      anim: bs.animationName,
      btnBorder: hs.borderStyle,
    };
  });
  if (unread1.text !== '' || unread1.display === 'none' || unread1.bg !== 'rgb(239, 68, 68)' ||
      unread1.width < 10 || unread1.height < 10 || unread1.radius !== '999px' ||
      unread1.anim !== 'none' || unread1.btnBorder !== 'none') {
    throw new Error(`AC-007 badge initial unread red dot: ${JSON.stringify(unread1)}`);
  }

  // Open chat tab -> Screen 1 (選擇角色) inside unified shell + red dot remains until room entered
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
      headerVisible: getComputedStyle(document.querySelector('.app-header-bar')).display !== 'none',
      navVisible: getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none',
      navActive: document.getElementById('chatOpenBtn').classList.contains('is-active'),
      badgeDisplay: getComputedStyle(document.getElementById('chatUnreadBadge')).display,
      roleDisplay: getComputedStyle(roleScreen).display,
      roomDisplay: getComputedStyle(roomScreen).display,
      dateText: dateBadge.textContent.trim(),
      dateWeight: Number(getComputedStyle(dateBadge).fontWeight),
      roleIds: roleBtns.map(b => b.dataset.roleId),
      pilotDisabled: pilotBtn ? pilotBtn.disabled : false,
      pilotCount: pilotBtn ? pilotBtn.querySelector('.chat-role-count')?.textContent : '',
      lockImgSrc: lockImg ? lockImg.getAttribute('src') : '',
    };
  });
  if (screen1State.modalDisplay !== 'flex' || !screen1State.headerVisible || !screen1State.navVisible ||
      !screen1State.navActive || screen1State.badgeDisplay === 'none' ||
      screen1State.roleDisplay !== 'flex' || screen1State.roomDisplay !== 'none' ||
      screen1State.dateText !== expectedRocDate || screen1State.dateWeight < 700 ||
      JSON.stringify(screen1State.roleIds) !== JSON.stringify(['CPC_LM', 'Pilot', 'Other', 'Spectator']) ||
      !screen1State.pilotDisabled || screen1State.pilotCount !== '1/1' || screen1State.lockImgSrc !== 'pic/lock.png') {
    throw new Error(`AC-007 Screen 1 state: ${JSON.stringify(screen1State)}`);
  }

  // DES-001: Hoisted #chatNameSheetBackdrop covers header & bottom-nav at 390x844 and 1280x800
  for (const vp of [{width: 390, height: 844}, {width: 1280, height: 800}]) {
    await page.setViewportSize(vp);
    await page.locator('.chat-role-item[data-role-id="Other"]').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('chatNameSheetBackdrop')).display === 'flex');
    const sheetOverlayCheck = await page.evaluate(() => {
      const bd = document.getElementById('chatNameSheetBackdrop');
      const sheet = bd.querySelector('.chat-bottom-sheet');
      const bdRect = bd.getBoundingClientRect();
      const sheetRect = sheet.getBoundingClientRect();
      const hitHeader = document.elementFromPoint(20, 20);
      const hitBottom = document.elementFromPoint(20, window.innerHeight - 20);
      return {
        isBodyDirectChild: bd.parentElement === document.body,
        bdWidth: Math.round(bdRect.width),
        bdHeight: Math.round(bdRect.height),
        vpWidth: window.innerWidth,
        vpHeight: window.innerHeight,
        sheetWidth: Math.round(sheetRect.width),
        hitHeaderIsBackdrop: hitHeader === bd || bd.contains(hitHeader),
        hitBottomIsBackdropOrSheet: hitBottom === bd || bd.contains(hitBottom),
      };
    });
    if (!sheetOverlayCheck.isBodyDirectChild ||
        Math.abs(sheetOverlayCheck.bdWidth - sheetOverlayCheck.vpWidth) > 1 ||
        Math.abs(sheetOverlayCheck.bdHeight - sheetOverlayCheck.vpHeight) > 1 ||
        sheetOverlayCheck.sheetWidth > 480 ||
        !sheetOverlayCheck.hitHeaderIsBackdrop || !sheetOverlayCheck.hitBottomIsBackdropOrSheet) {
      throw new Error(`DES-001 name sheet stacking check (${vp.width}x${vp.height}): ${JSON.stringify(sheetOverlayCheck)}`);
    }
    await page.evaluate(() => closeChatNameSheet());
  }
  await page.setViewportSize({width: 390, height: 844});

  // Spectator (觀眾) -> enters Screen 2 (作業聊天室): no #chatSpectatorBar divider, 「僅供瀏覽」 left of #chatRoleSwitchBtn, red dot clears!
  await page.locator('.chat-role-item[data-role-id="Spectator"]').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex');
  const specRoomState = await page.evaluate(() => {
    const hint = document.getElementById('chatSpectatorHint');
    const pill = document.getElementById('chatRoleSwitchBtn');
    const hintRect = hint.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    return {
      titleText: document.getElementById('chatModalTitle').textContent.trim(),
      rolePillText: pill.textContent.trim(),
      hasOldDivider: document.getElementById('chatSpectatorBar') !== null,
      hintDisplay: getComputedStyle(hint).display,
      hintText: hint.textContent.trim(),
      hintLeftOfPill: hintRect.right <= pillRect.left + 1 && Math.abs(hintRect.top - pillRect.top) < 12,
      badgeDisplay: getComputedStyle(document.getElementById('chatUnreadBadge')).display,
      footerDisplay: getComputedStyle(document.getElementById('chatComposerFooter')).display,
      cpcSeat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`),
    };
  });
  if (specRoomState.titleText !== '作業聊天室' || specRoomState.rolePillText !== '觀眾' ||
      specRoomState.hasOldDivider || specRoomState.hintDisplay === 'none' ||
      specRoomState.hintText !== '僅供瀏覽' || !specRoomState.hintLeftOfPill ||
      specRoomState.badgeDisplay !== 'none' || specRoomState.footerDisplay !== 'none' ||
      specRoomState.cpcSeat !== null) {
    throw new Error(`AC-007 Spectator mode state: ${JSON.stringify(specRoomState)}`);
  }

  // Switch to 監控 tab -> receive new message off-tab -> badge reappears!
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/messages`, {
      m1: {id: 'm1', ts: 10000, timeStr: '08:00', roleId: 'CPC_LM', roleLabel: '中油LNG', clientId: 'other-1', text: '早安，引水梯備便'},
      m2: {id: 'm2', ts: 20000, timeStr: '08:05', roleId: 'Pilot', roleLabel: 'Pilot', clientId: 'other-2', text: '已登輪'},
    });
  });
  await page.locator('#navMonitorBtn').click();
  if (await page.evaluate(() => getComputedStyle(document.getElementById('chatUnreadBadge')).display) !== 'none') {
    throw new Error('AC-007: Badge must stay hidden after leaving chat when newest msg was read while open');
  }
  await page.evaluate(() => {
    const d = window.__today;
    window.__emit(`formal/chat_rooms/${d}/messages/m3`, {
      id: 'm3', ts: 30000, timeStr: '08:06', roleId: 'Other', roleLabel: '拖船船長', clientId: 'other-3', text: '拖船就位',
    });
  });
  if (await page.evaluate(() => getComputedStyle(document.getElementById('chatUnreadBadge')).display) === 'none') {
    throw new Error('AC-007: Badge must reappear when new message arrives while off chat tab');
  }

  // Claim 中油LNG (CPC_LM_1) -> enters Screen 2 Active mode (#chatRoleSwitchBtn === '中油LNG', #chatSpectatorHint hidden)
  await page.locator('#chatOpenBtn').click();
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex');
  const seatCpc = await page.evaluate(() => ({
    seat: window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`),
    hookArmed: window.__onDisconnectHooks.has(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`),
    rolePillText: document.getElementById('chatRoleSwitchBtn').textContent.trim(),
    specHintDisplay: getComputedStyle(document.getElementById('chatSpectatorHint')).display,
    footerDisplay: getComputedStyle(document.getElementById('chatComposerFooter')).display,
  }));
  if (!seatCpc.seat || seatCpc.seat.roleId !== 'CPC_LM' || seatCpc.seat.roleLabel !== '中油LNG' ||
      seatCpc.rolePillText !== '中油LNG' || !seatCpc.hookArmed ||
      seatCpc.specHintDisplay !== 'none' || seatCpc.footerDisplay !== 'block') {
    throw new Error(`AC-007 claim 中油LNG: ${JSON.stringify(seatCpc)}`);
  }

  // DES-003: At 1280x800, clicking horizontal margin outside .chat-modal-box keeps #chatModal active and retains mySeat
  await page.setViewportSize({width: 1280, height: 800});
  await page.mouse.click(40, 300);
  const desktopMarginClick = await page.evaluate(() => ({
    tab: currentActiveTab,
    chatVisible: getComputedStyle(document.getElementById('chatModal')).display === 'flex',
    seatHeld: window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) !== null,
  }));
  await page.setViewportSize({width: 390, height: 844});
  if (desktopMarginClick.tab !== 'chat' || !desktopMarginClick.chatVisible || !desktopMarginClick.seatHeld) {
    throw new Error(`DES-003 desktop margin click closed chat tab: ${JSON.stringify(desktopMarginClick)}`);
  }

  // D2: Switching to 監控 tab preserves CPC_LM_1 seat; returning to 聊天室 resumes #chatRoomScreen directly!
  await page.locator('#navMonitorBtn').click();
  const offTabRetained = await page.evaluate(() => ({
    tab: currentActiveTab,
    chatVisible: getComputedStyle(document.getElementById('chatModal')).display !== 'none',
    seatHeld: window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) !== null,
  }));
  if (offTabRetained.tab !== 'monitor' || offTabRetained.chatVisible || !offTabRetained.seatHeld) {
    throw new Error(`D2 off-tab seat retention failed: ${JSON.stringify(offTabRetained)}`);
  }
  await page.locator('#chatOpenBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex');
  if (await page.locator('#chatRoleSwitchBtn').textContent() !== '中油LNG') {
    throw new Error('D2 resume must land directly in room screen with 中油LNG role pill');
  }

  // Test 「其他」 bottom sheet via #chatRoleSwitchBtn: blank name -> spectator (releases CPC_LM_1); non-blank -> Other_1
  await page.locator('#chatRoleSwitchBtn').click();
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

  await page.locator('#chatRoleSwitchBtn').click();
  await page.locator('.chat-role-item[data-role-id="Other"]').click();
  await page.fill('#chatNameInput', '海事工程師');
  await page.locator('#chatEnterRoomBtn').click();
  await page.waitForFunction(() => {
    const s = window.__getDb(`formal/chat_rooms/${window.__today}/seats/Other_1`);
    return Boolean(s && s.roleLabel === '海事工程師') &&
      getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex' &&
      document.getElementById('chatRoleSwitchBtn').textContent.trim() === '海事工程師';
  });

  // Remote overwrite on Other_1 forfeits local seat cleanly
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
    throw new Error(`AC-007 takeover safety: ${JSON.stringify(afterTakeover)}`);
  }

  // Test 15/15 full lock on 「其他」, then reclaim expired Pilot_1 (>15 min idle)
  await page.locator('#chatRoleSwitchBtn').click();
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
    throw new Error(`AC-007 Other 15/15 lock: ${JSON.stringify(otherFullState)}`);
  }
  await page.locator('.chat-role-item[data-role-id="Pilot"]').click();
  await page.waitForFunction(() => {
    const s = window.__getDb(`formal/chat_rooms/${window.__today}/seats/Pilot_1`);
    return Boolean(s && s.clientId !== 'stale-pilot') && getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex';
  });
  await page.locator('#chatRoleSwitchBtn').click();
  await page.locator('.chat-role-item[data-role-id="Spectator"]').click();
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__today}/seats/Pilot_1`) === null);

  // AC-007 / DES-R1-001: Outgoing sky-blue #C2E1FF + 已送出, incoming white #FFFFFF, #EBF3FC message area, date divider, XSS immunity
  await page.locator('#chatRoleSwitchBtn').click();
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatComposerFooter')).display === 'block');
  await page.fill('#chatTextInput', '報告進港 <img src=x onerror="window.__xss=1">');
  await page.locator('#chatSendBtn').click();
  await page.waitForFunction(() => {
    const msgs = window.__getDb(`formal/chat_rooms/${window.__today}/messages`) || {};
    return Object.values(msgs).some(m => m.text && m.text.includes('<img src=x'));
  });
  const expectedMonthDay = await page.evaluate(() => {
    const parts = window.__today.split('-');
    return `${Number(parts[1])}月${Number(parts[2])}日`;
  });
  const ac7Msgs = await page.evaluate(() => {
    const container = document.getElementById('chatMessagesContainer');
    const divider = container.querySelector('.chat-date-divider span');
    const rows = Array.from(container.querySelectorAll('.chat-msg-row'));
    const otherRow = rows.find(r => r.classList.contains('is-other'));
    const otherBubble = otherRow && otherRow.querySelector('.chat-bubble');
    const selfRow = rows.find(r => r.classList.contains('is-self'));
    const selfBubble = selfRow && selfRow.querySelector('.chat-bubble');
    const selfStatus = selfRow && selfRow.querySelector('.chat-msg-status');
    return {
      xssTriggered: Boolean(window.__xss),
      areaBg: getComputedStyle(container).backgroundColor,
      dividerText: divider ? divider.textContent.trim() : '',
      otherBg: otherBubble ? getComputedStyle(otherBubble).backgroundColor : '',
      selfBg: selfBubble ? getComputedStyle(selfBubble).backgroundColor : '',
      selfText: selfBubble ? selfBubble.textContent : '',
      selfStatusText: selfStatus ? selfStatus.textContent : '',
    };
  });
  if (ac7Msgs.xssTriggered || ac7Msgs.areaBg !== 'rgb(235, 243, 252)' ||
      ac7Msgs.dividerText !== expectedMonthDay ||
      ac7Msgs.otherBg !== 'rgb(255, 255, 255)' || ac7Msgs.selfBg !== 'rgb(194, 225, 255)' ||
      !ac7Msgs.selfText.includes('<img src=x') || !ac7Msgs.selfStatusText.includes('已送出')) {
    throw new Error(`AC-007 bubble styles/XSS/date divider: ${JSON.stringify(ac7Msgs)}`);
  }

  // Attachment bottom sheet (hoisted DES-001 check) + cancel upload mid-flight
  await page.locator('#chatAttachBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatAttachSheetBackdrop')).display === 'flex');
  const attachSheetInfo = await page.evaluate(() => {
    const bd = document.getElementById('chatAttachSheetBackdrop');
    const hitHeader = document.elementFromPoint(20, 20);
    const hitBottom = document.elementFromPoint(20, window.innerHeight - 20);
    const opts = Array.from(bd.querySelectorAll('.chat-attach-option')).map(btn => ({
      title: btn.querySelector('.chat-attach-option-title')?.textContent,
      icon: btn.querySelector('img.chat-attach-option-icon')?.getAttribute('src'),
    }));
    return {
      isBodyDirectChild: bd.parentElement === document.body,
      hitHeader: hitHeader === bd || bd.contains(hitHeader),
      hitBottom: hitBottom === bd || bd.contains(hitBottom),
      opts,
    };
  });
  if (!attachSheetInfo.isBodyDirectChild || !attachSheetInfo.hitHeader || !attachSheetInfo.hitBottom ||
      attachSheetInfo.opts.length !== 3 ||
      attachSheetInfo.opts[0].title !== '拍照' || attachSheetInfo.opts[0].icon !== 'pic/拍照.png' ||
      attachSheetInfo.opts[1].title !== '從相簿選取' || attachSheetInfo.opts[1].icon !== 'pic/從相簿選取.png' ||
      attachSheetInfo.opts[2].title !== '選擇檔案' || attachSheetInfo.opts[2].icon !== 'pic/選擇檔案.png') {
    throw new Error(`AC-007 attachment sheet: ${JSON.stringify(attachSheetInfo)}`);
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
  if (canceledMsgExists) throw new Error('AC-007: Canceled upload must not publish chat message');

  // Image compression (1600x800 -> 1280x640 JPEG) & Full-Screen Photo Lightbox zoom
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
  const imgZoomedIn = await page.evaluate(() => {
    const closeBtnStyle = getComputedStyle(document.getElementById('chatPreviewCloseBtn'));
    return {
      display: getComputedStyle(document.getElementById('chatPreviewModal')).display,
      zIndex: getComputedStyle(document.getElementById('chatPreviewModal')).zIndex,
      boxRadius: getComputedStyle(document.querySelector('#chatPreviewModal .chat-preview-box')).borderRadius,
      closeBtnBg: closeBtnStyle.backgroundColor,
      closeBtnColor: closeBtnStyle.color,
      closeBtnBorder: closeBtnStyle.borderTopStyle,
      zoomLabel: document.getElementById('chatZoomResetBtn').textContent,
      transform: document.getElementById('chatPreviewImage').style.transform,
      naturalWidth: document.getElementById('chatPreviewImage').naturalWidth,
      naturalHeight: document.getElementById('chatPreviewImage').naturalHeight,
      href: document.getElementById('chatPreviewDownload').getAttribute('href') || '',
    };
  });
  await page.locator('#chatZoomResetBtn').click();
  const imgResetZoom = await page.evaluate(() => document.getElementById('chatZoomResetBtn').textContent);
  await page.locator('#chatPreviewImage').dblclick();
  const imgDblZoom = await page.evaluate(() => document.getElementById('chatZoomResetBtn').textContent);
  await page.locator('#chatZoomResetBtn').click();
  if (imgZoomedIn.display !== 'flex' || Number(imgZoomedIn.zIndex) < 2100 || imgZoomedIn.boxRadius !== '0px' ||
      imgZoomedIn.closeBtnBg !== 'rgba(0, 0, 0, 0)' || imgZoomedIn.closeBtnColor !== 'rgb(255, 255, 255)' ||
      imgZoomedIn.closeBtnBorder !== 'none' ||
      imgZoomedIn.zoomLabel !== '125%' || imgZoomedIn.transform !== 'scale(1.25)' ||
      imgResetZoom !== '100%' || imgDblZoom !== '200%' ||
      imgZoomedIn.naturalWidth !== 1280 || imgZoomedIn.naturalHeight !== 640 ||
      !imgZoomedIn.href.startsWith('data:image/jpeg;base64,')) {
    throw new Error(`AC-007 lightbox zoom: ${JSON.stringify({imgZoomedIn, imgDblZoom, imgResetZoom})}`);
  }
  await page.locator('#chatPreviewCloseBtn').click();

  // Standalone white file card (is-file-only bubble, EXT · SIZE, blue SVG icon & download SVG button) & security checks
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
    const bubble = card ? card.closest('.chat-bubble') : null;
    const svgIcon = card ? card.querySelector('svg.chat-att-file-svg') : null;
    const btn = card ? card.querySelector('button.chat-att-file-btn') : null;
    const dlSvg = btn && btn.querySelector('svg.chat-att-download-svg');
    const sizeText = card ? card.querySelector('.chat-att-file-size')?.textContent?.trim() : '';
    return {
      cardBg: card ? getComputedStyle(card).backgroundColor : '',
      bubbleIsFileOnly: Boolean(bubble && bubble.classList.contains('is-file-only')),
      bubbleBg: bubble ? getComputedStyle(bubble).backgroundColor : '',
      hasFileSvg: Boolean(svgIcon),
      sizeText,
      btnText: btn ? btn.textContent.trim() : 'ERR',
      hasDlSvg: Boolean(dlSvg),
    };
  });
  if (fileCardUi.cardBg !== 'rgb(255, 255, 255)' || !fileCardUi.bubbleIsFileOnly ||
      fileCardUi.bubbleBg !== 'rgba(0, 0, 0, 0)' || !fileCardUi.hasFileSvg ||
      !fileCardUi.sizeText.startsWith('PDF · ') || fileCardUi.btnText !== '' || !fileCardUi.hasDlSvg) {
    throw new Error(`AC-007 standalone white file card UI: ${JSON.stringify(fileCardUi)}`);
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
    throw new Error(`AC-007 SVG block: ${JSON.stringify(blockedSvg)}`);
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
  if (blockedDownloadTriggered !== 0) throw new Error('blocked attachments must never trigger anchor download');

  // Seat transaction error & in-flight tab-switch ghost-seat guard
  await page.locator('#chatRoleSwitchBtn').click();
  await page.locator('.chat-role-item[data-role-id="Spectator"]').click();
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) === null);
  await page.locator('#chatRoleSwitchBtn').click();
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

  // In-flight claim when switching to 監控 tab must release seat immediately with zero ghost seat
  await page.evaluate(() => {
    window.__flushDelayedTx = null;
    window.__txTestMode = 'delay';
  });
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() =>
    typeof window.__flushDelayedTx === 'function' &&
    window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) !== null
  );
  await page.locator('#navMonitorBtn').click();
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

  // Off-tab 15-min idle auto-release: claim CPC_LM, switch to 監控 tab, advance 15 min -> seat auto-releases!
  await page.locator('#chatOpenBtn').click();
  await page.locator('.chat-role-item[data-role-id="CPC_LM"]').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatRoomScreen')).display === 'flex');
  await page.locator('#navMonitorBtn').click();
  await page.clock.fastForward(15 * 60 * 1000 + 20000);
  await page.clock.fastForward(16000);
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) === null);
  await page.locator('#chatOpenBtn').click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('chatRoleScreen')).display === 'flex');

  // Midnight rollover release
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

  // Mobile camera/picker disconnect seat reclaim + 95% upload cleanup
  await page.locator('#chatRoleSwitchBtn').click();
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

  await page.evaluate(() => closeChatModal({releaseSeat: true}));
  await page.waitForFunction(() => window.__getDb(`formal/chat_rooms/${window.__today}/seats/CPC_LM_1`) === null);

  // Animata UI checks: Wind Ticker, Segmented Fluid Thumb, Schedule Skeleton, and no bottom-nav fluid track
  await page.evaluate(() => {
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:05'});
  });
  const animataUi = {};
  await page.evaluate(() => {
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 6.2, last_update: '10:06'});
  });
  animataUi.windUpText = await page.locator('#windSpeed').textContent();
  animataUi.windUpClass = await page.locator('#windSpeed').evaluate(el => el.classList.contains('is-tick-up'));
  await page.evaluate(() => {
    window.__emit('formal/active_status', {app_mode: 'stop', current_wind: 4, last_update: '10:07'});
  });
  animataUi.windDownClass = await page.locator('#windSpeed').evaluate(el => el.classList.contains('is-tick-down'));

  await page.locator('#navForecastBtn').click();
  animataUi.hasNavFluidTrack = await page.evaluate(() => Boolean(document.querySelector('.bottom-nav-fluid-track')));

  await page.evaluate(() => {
    selectLimitSpeedPreset('12');
    selectTerminalSegment('W12');
  });
  animataUi.segSpeedIdx = await page.evaluate(() => document.getElementById('speedSegmentGroup').style.getPropertyValue('--seg-active-idx').trim());
  animataUi.segTermIdx = await page.evaluate(() => document.getElementById('terminalSegmentGroup').style.getPropertyValue('--seg-active-idx').trim());
  animataUi.segTermAttr = await page.evaluate(() => document.getElementById('terminalSegmentGroup').dataset.activeTerminal);
  await page.locator('#navMonitorBtn').click();
  animataUi.scheduleBusy = await page.evaluate(() => document.getElementById('scheduleBody').getAttribute('aria-busy'));

  const indexHtmlSource = await (await page.request.get('http://127.0.0.1:4177/index.html')).text();
  const tbodyMatch = indexHtmlSource.match(/<tbody id="scheduleBody"[^>]*>([\s\S]*?)<\/tbody>/);
  animataUi.hasInitialSkeleton = Boolean(tbodyMatch && tbodyMatch[0].includes('schedule-skeleton-row'));

  if (animataUi.windUpText !== '6.2' || !animataUi.windUpClass || !animataUi.windDownClass ||
      animataUi.hasNavFluidTrack ||
      animataUi.segSpeedIdx !== '0' || animataUi.segTermIdx !== '0' || animataUi.segTermAttr !== 'W12' ||
      animataUi.scheduleBusy !== null || !animataUi.hasInitialSkeleton) {
    throw new Error(`Animata UI checks failed: ${JSON.stringify(animataUi)}`);
  }

  if (errors.length) throw new Error(JSON.stringify(errors));
  return {externalServices: 'mocked', initial, forecast, operations, commands, chatVerified: true, expiredLeaseRecovered: true, errors};
}
