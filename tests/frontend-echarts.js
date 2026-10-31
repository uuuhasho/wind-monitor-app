async page => {
  await page.unrouteAll({behavior: 'wait'});
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:4177/')) return route.continue();
    if (url.includes('echarts@5.5.0')) return route.fulfill({path: 'runtime/echarts-5.5.0.min.js', contentType: 'application/javascript'});
    return route.fulfill({status: 200, contentType: 'application/javascript', body: ''});
  });
  await page.addInitScript(() => {
    const date = new Date();
    const day = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    const nextDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
    const nextDay = `${nextDate.getUTCMonth() + 1}/${nextDate.getUTCDate()}`;
    const data = Array.from({length: 193}, (_, i) => ({timestamp: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), i - 8)).toISOString(), cpc_wind_speed: 5, open_meteo_wind_speed: 6}));
    const records = {'test/schedule_list': [{d: day, ship_name: 'ONE', limit_speed: 12}, {d: nextDay, ship_name: 'TWO', limit_speed: 15}], 'test/forecast_data': data, 'test/forecast_metadata': {}, 'test/active_status': {app_mode: 'stop'}, '.info/connected': true};
    const snapshot = path => ({val: () => records[path] ?? null, exists: () => records[path] != null});
    window.firebase = {apps: [], initializeApp() {this.apps.push({});}, database: () => ({ref: path => ({on(_event, cb) {cb(snapshot(path));}, off() {}, once: async () => snapshot(path)})})};
    window.Audio = class {play() {return Promise.resolve();} pause() {} addEventListener() {}};
    window.fetch = async () => {throw new Error('Unexpected fetch');};
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4177/index.html');
  await page.evaluate(async () => {openForecastModal(); await loadForecastData();});
  await page.waitForTimeout(250);
  const initialZoom = await page.evaluate(() => {
    const option = forecastChartInstance.getOption();
    const month = new Date().getUTCMonth() + 1;
    const target = option.xAxis[0].data.findIndex(label => label.endsWith(month >= 4 && month <= 9 ? '05:00' : '06:00'));
    return {target, start: option.dataZoom[0].startValue, end: option.dataZoom[0].endValue};
  });
  if (initialZoom.target < initialZoom.start || initialZoom.target > initialZoom.end) throw new Error(`Target outside zoom: ${JSON.stringify(initialZoom)}`);
  await page.locator('#shipForecastSelect').selectOption('15');
  await page.waitForTimeout(250);
  if (!(await page.locator('.custom-tooltip').textContent()).includes('TWO')) throw new Error('Single switch tooltip must show TWO');
  const nextZoom = await page.evaluate(() => {
    const option = forecastChartInstance.getOption();
    const date = new Date();
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
    const month = next.getUTCMonth() + 1;
    const label = `${month}/${next.getUTCDate()} ${month >= 4 && month <= 9 ? '05:00' : '06:00'}`;
    return {target: option.xAxis[0].data.indexOf(label), start: option.dataZoom[0].startValue, end: option.dataZoom[0].endValue, label};
  });
  if (nextZoom.target < 0 || nextZoom.target < nextZoom.start || nextZoom.target > nextZoom.end) throw new Error(`Next-day target outside zoom: ${JSON.stringify(nextZoom)}`);
  if (!(await page.locator('.custom-tooltip').textContent()).includes(nextZoom.label)) throw new Error('Tooltip must show next-day target');
  for (let i = 0; i < 8; i++) {
    await page.locator('#shipForecastSelect').selectOption(i % 2 ? '12' : '15');
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => {
    const select = document.querySelector('#shipForecastSelect');
    for (let i = 0; i < 20; i++) {select.selectedIndex = i % 2; onForecastShipChange();}
  });
  await page.waitForTimeout(250);
  const latestTooltip = await page.locator('.custom-tooltip').textContent();
  if (!latestTooltip.includes('TWO') || !latestTooltip.includes(nextZoom.label)) throw new Error(`Latest selection tooltip: ${latestTooltip}`);
  const rapidZoom = await page.evaluate(() => {const zoom = forecastChartInstance.getOption().dataZoom[0]; return {start: zoom.startValue, end: zoom.endValue};});
  if (nextZoom.target < rapidZoom.start || nextZoom.target > rapidZoom.end) throw new Error(`Rapid switch target outside zoom: ${JSON.stringify(rapidZoom)}`);
  const zoomBefore = await page.evaluate(() => forecastChartInstance.getOption().dataZoom[0].start);
  const chart = await page.locator('#forecastChart').boundingBox();
  await page.mouse.move(chart.x + chart.width * 0.2, chart.y + chart.height - 8);
  await page.mouse.down();
  await page.mouse.move(chart.x + chart.width * 0.55, chart.y + chart.height - 8, {steps: 8});
  await page.mouse.up();
  await page.waitForTimeout(150);
  const zoomAfter = await page.evaluate(() => forecastChartInstance.getOption().dataZoom[0].start);
  if (zoomBefore === zoomAfter) throw new Error(`Slider did not move: ${zoomBefore}`);
  const shortData = await page.evaluate(() => {
    renderForecastChart(lastFetchedForecastData.slice(0, 24));
    const option = forecastChartInstance.getOption();
    return {axis: option.xAxis[0].data.length, series: option.series.map(series => series.data.length)};
  });
  if (shortData.axis !== 24 || shortData.series.some(length => length !== 24)) throw new Error(`Stale chart data: ${JSON.stringify(shortData)}`);
  await page.evaluate(() => {onForecastShipChange(); closeForecastModal();});
  await page.waitForTimeout(250);
  await page.evaluate(() => openForecastModal());
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => ({version: echarts.version, selected: document.querySelector('#shipForecastSelect').selectedOptions[0].textContent, tooltip: document.querySelector('.custom-tooltip')?.textContent, zoom: forecastChartInstance.getOption().dataZoom[0]}));
  if (errors.length) throw new Error(JSON.stringify({errors, state}));
  if (state.version !== '5.5.0' || !state.tooltip?.includes('ONE')) throw new Error(JSON.stringify({errors, state}));
  return {errors, version: state.version, selected: state.selected, singleSwitchTooltip: 'TWO', rapidSwitchTooltip: 'TWO', initialZoom, nextZoom, rapidZoom, zoomBefore, zoomAfter, shortData, reopenTooltip: 'ONE'};
}
