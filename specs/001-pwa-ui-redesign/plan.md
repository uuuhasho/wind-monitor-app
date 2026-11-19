# Technical Plan · 001-pwa-ui-redesign

- **Canonical Spec**: `specs/001-pwa-ui-redesign/spec.md` (`REQ-001`–`REQ-010`, `AC-001`–`AC-010`)
- **Decisions**: `specs/001-pwa-ui-redesign/decisions.md` (`D1`–`D6`)

## Architecture & File Changes

### 1. `gas/monitor.js`
- **Date Normalization Helper**:
  Add `normalizeScheduleDateMD(dStr)`:
  - Returns `""` if `!dStr || typeof dStr !== "string"`.
  - Trims string; if `/^(\d{1,2})\/(\d{1,2})$/` matches and `1 <= m <= 12 && 1 <= d <= 31`, returns `${m}/${d}` (removes leading zeros so `"06/09"` == `"6/9"`). Otherwise returns trimmed string.
- **`update_schedule` (`doGet`)**:
  - Iterate `list`: extract `shipName = (item.ship_name || "").trim()`, `key = sanitizeKey(shipName)`.
  - If `item.is_deleted === true`: `callFirebase(\`schedule_overrides/${key}\`, { d: normalizeScheduleDateMD(item.d || ""), ship_name: shipName, is_deleted: true, created_at: getTwDateStr(new Date(), "yyyy-MM-dd") }, "put")`.
  - Else: `callFirebase(\`schedule_overrides/${key}\`, { d: normalizeScheduleDateMD(item.d || ""), ship_name: shipName, limit_speed: item.limit_speed ? Number(item.limit_speed) : 15.0, terminal: item.terminal === "W12" ? "W12" : (item.terminal === "W13" ? "W13" : ""), is_deleted: false, created_at: getTwDateStr(new Date(), "yyyy-MM-dd") }, "put")`.
  - Delete `UNFINISHED_SHIP` property (`props.deleteProperty('UNFINISHED_SHIP')`), then call `try { updateFirebaseScheduleList(true); } catch (syncErr) { console.warn("update_schedule 同步 schedule_list 跳過 (保留既有列表): " + syncErr.message); }` and always call `releaseEditingLock()`.
- **`updateFirebaseScheduleList(allowEmptyOnVerifiedApi = false)`**:
  - Calls `const list = getScheduleList(Boolean(allowEmptyOnVerifiedApi));`.
  - When `!allowEmptyOnVerifiedApi && (!list || list.length === 0)`: keeps existing fail-safe (`console.warn` + `return` without writing Firebase `schedule_list`).
  - When `allowEmptyOnVerifiedApi === true`: `getScheduleList(true)` throws if Calendar API (`SHIP_SCHEDULE_API_URL` configured but unavailable/non-200/invalid) or `schedule_overrides` failed to read — preventing accidental wipe on outage. If `getScheduleList(true)` succeeds cleanly and `list` is `[]` (e.g. user deleted the last remaining ship), writes `callFirebase("schedule_list", [], "put")` so Firebase `formal/schedule_list` becomes empty (`null` in RTDB, handled as `[]` by frontend `snapshot.val() || []` and `safeJsonParse(scheduleRes, [])`).
- **`set_mode` reset (`noEntryReason`)**:
  - Save `terminal: activeStatus.terminal || ""` alongside `ship_name` and `limit_speed` in `UNFINISHED_SHIP`.
- **`getScheduleList(strict)`**:
  - Step 1 (`futureApiData.map`): normalize `d: normalizeScheduleDateMD(item.d)`. Note: when `SHIP_SCHEDULE_API_URL` is configured and returns `{"data":[]}`, `apiDataRaw` is truthy and `Array.isArray(apiData)` is true, so `strict` passes cleanly; only failed/non-200/empty HTTP bodies throw.
  - Step 3 expiry cleanup: also delete `schedule_overrides/${key}` if `!ov.d && ov.is_deleted === true && ov.created_at && ov.created_at < dateStr` (documented behavior: undated `UNFINISHED_SHIP` tombstones expire the following day).
  - Step 4 merge: if `ov.is_deleted === true`, splice existing match (`targetIdx >= 0`) from `filteredList` and `continue` (never push deleted override). Otherwise merge with normalized `d: normalizeScheduleDateMD(ov.d || "")`.
  - Step 2 today-POB filter: compare `normalizeScheduleDateMD(ship.d) === todayM_D`.
  - Step 3 `UNFINISHED_SHIP`: keep `terminal: unfinished.terminal || ""` when unshifting `{ d: "", ship_name, limit_speed, terminal }`.
- **`checkDailySchedule()`, `tryHandoffToNextShip()`, and `archiveAndClearFirebase()`**:
  - Compare `normalizeScheduleDateMD(item.d) === todayM_D` in `checkDailySchedule()` & `tryHandoffToNextShip()`, and `normalizeScheduleDateMD(item.d) && normalizeScheduleDateMD(item.d) !== todayMD` in `archiveAndClearFirebase()` line 771.

### 2. `frontend/index.html`
- **HTML & CSS Refactor (Main Shell & Non-Chat/Non-Forecast Modals)**:
  - Keep `#forecastModal` CSS/DOM and `#chatModal`/`#chatPreviewModal` CSS/DOM completely intact.
  - Replace glassmorphism body/container styles with `.app-shell` (`max-width: 480px; margin: 0 auto; padding: 12px 12px calc(84px + env(safe-area-inset-bottom, 0px))`) over `#EEF3F7` background.
  - Top header `.app-header`: left `logo.png` + `<h1>臺中LNG船監控</h1>`; right `#soundToggle` (`button` with SVG inside, `display: none` initially) + `<a id="infoLink" href="presentation/index.html" target="_blank" rel="noopener">`.
  - Wind card `.wind-card`: header `北堤風速`, `.wind-main-row` containing `.wind-container` (`.wind-speed-num` `#windSpeed` + `.wind-detail` with `.wind-icon.pulso-icon.pulso-wind` above `.wind-speed-unit`) on left and `#dynamicBox.status-pill` on right; footer `#dataTime`.
  - `#pobList.pob-records`: full-width alert card between `.wind-card` and `.schedule-section`.
  - `.schedule-section`: header with `<h2>船期表</h2>` and `.cpc-btn.pulso-icon.pulso-settings` gear SVG (`onclick="triggerOpenManualModal()"`, keyboard Enter/Space support); `.table-wrapper` + `.schedule-table` with `#scheduleHeaderRow` (`日期`, `船名`, `速限 m/s`) and `#scheduleBody`.
  - `.bottom-nav`: fixed 4-column bar (`#navMonitorBtn`, `#navForecastBtn`, `#navScheduleBtn`, `#chatOpenBtn` containing `<span id="chatUnreadBadge" class="chat-unread-badge" style="display: none;" aria-label="有未讀新對話">!</span>` styled as a compact solid `#dc2626` circular dot with `color: #dc2626`, `font-size: 1px`, `width: 9px`, `height: 9px`, `border-radius: 999px`, `animation: none` so it renders visually as a red dot on the chat icon while keeping v2 chat unread assertions `text === '!'`, `color === 'rgb(220, 38, 38)'`, `anim === 'none'`, `btnBorder === 'none'` green).
  - `#manualModal`: `.modal-overlay.bottom-sheet-overlay` -> `.modal-content.bottom-sheet-content`; start mode has `#shipName`, `#speedSegmentGroup` (`12` / `15` / `自訂`) + `#customLimitSpeedWrap` (`#limitSpeed`), `#terminalSegmentGroup` (`W12` / `W13`) + `#terminal` hidden input, `#startBtn`; stop mode has `#monitoringTargetBanner`, `#pobTime`, `#noEntryReason`, `#customReasonGroup`, red `#resetBtn` (`#DC2626`).
  - `#scheduleAdjustModal`: `.modal-overlay.fullscreen-sheet-overlay` -> `.modal-content.fullscreen-sheet-content`; header `< 監控`, `船期調整`, `+ 新增`; `#adjustCardList` scrollable 2-row cards; sticky footer `儲存調整`.
  - `#pwdModal`: clean light modal styling matching new palette.
- **JavaScript Updates**:
  - Add `escapeHtml()`, `normalizeFrontendDateMD()`, `normalizeScheduleTerminal()`, `setActiveNav()`, `selectLimitSpeedPreset()`, `selectTerminalSegment()`, `syncManualModalUI(data, forceReset)`.
  - Update `syncAudioState()` to inject inline SVG icons into `#soundToggle` and set `dataset.soundState` (`muted` | `armed` | `ringing`).
  - Update `updateDynamicBox()` to render `可進港` / `等待進港` / 2-line `無法進港` (`風速超標`, `浪高 ${data.current_wave} > 2.5 m`, `能見度 ${data.current_visibility} < 2 浬`) inside `#dynamicBox`, preserving `.condition-warning` + `/APP_SVG/wave.svg` & `/APP_SVG/eye.svg` contracts.
  - Update `formatLastUpdateTime()` to produce compact `MM/DD HH:mm` when matched.
  - Update `renderScheduleTable()` to output numeric `${item.limit_speed}` and `W12`/`W13` badge under date.
  - Remove `bindScheduleHeaderDoubleActivate()`.
  - Update `bindPulsoIconTriggers()` to keep `.wind-container` and `.cpc-btn` animations; remove dead `.schedule-header h3` trigger.
  - Update `updateLockUI()` to toggle `.locked-btn` on `#navScheduleBtn` and `.cpc-btn` (instead of `#scheduleHeaderRow`).
  - **Manual Modal State & Live Sync Guard**:
    - `openManualModal()` branches explicitly on `currentAppData && currentAppData.app_mode === 'start'`:
      - When `'start'`: shows `#stopMonitorGroup` & `#resetBtn`, hides `#startMonitorGroup` & `#startBtn`, disables start inputs and fills them from `currentAppData`, updates `#monitoringTargetBanner`, clears `#pobTime`, `#noEntryReason`, `#customReason`.
      - When `'stop'`: shows `#startMonitorGroup` & `#startBtn`, hides `#stopMonitorGroup` & `#resetBtn`, enables inputs, clears `#shipName`, sets speed preset `'15'` (`#limitSpeed.value = '15'`, hides `#customLimitSpeedWrap`), sets terminal segment `'W13'` (`#terminal.value = 'W13'`), clears stop fields.
    - `startFirebaseListeners()` (`formal/active_status`) tracks `lastObservedAppMode`:
      - When `data.app_mode === 'start'`: always enforces stop-mode view + disabled start inputs + `#monitoringTargetBanner`, and clears `#pobTime`/`#noEntryReason`/`#customReason` ONLY if `lastObservedAppMode !== 'start'` or `#manualModal` is closed (`style.display !== 'flex'`).
      - When `data.app_mode !== 'start'`: only resets `#shipName`, speed preset `'15'`, and terminal segment `'W13'` if `#manualModal` is closed (`style.display !== 'flex'`) OR on a transition from `'start'` -> non-`'start'`, so live 1-minute `active_status` wind ticks NEVER clobber in-progress user selections.
    - Note: Keep existing POB validation (`04:00`–`17:59`, `hour < 4 || hour > 17`) unchanged from v1.4.
  - **Schedule Adjust Functions**:
    - Replace `renderAdjustTable()` with `renderAdjustCards()`.
    - Update `addEditItem()` to unshift `{ d: '', ship_name: '', limit_speed: 15.0, terminal: 'W13', source: 'manual' }`, call `renderAdjustCards()`, and scroll `document.getElementById('adjustCardList').scrollTop = 0`.
    - Add `deleteEditItem(index)` with `confirm()` removal and `renderAdjustCards()`.
    - Update `validateDateInput(input, index)` to enforce `1 <= month <= 12 && 1 <= day <= 31` (and auto-format 3–4 digit inputs when valid).
    - Update `saveScheduleAdjustments()` to:
      - Validate non-empty trimmed `ship_name`, reject case-insensitive trimmed duplicate `ship_name`s, and validate `1 <= month <= 12 && 1 <= day <= 31` for non-empty dates.
      - Match `originalScheduleSnapshot` using trimmed `ship_name`.
      - Compare symmetrically using `normalizeFrontendDateMD(item.d) !== normalizeFrontendDateMD(orig.d)` and `normalizeScheduleTerminal(item.terminal) !== normalizeScheduleTerminal(orig.terminal)` and `Number(item.limit_speed) !== Number(orig.limit_speed)`.
      - Emit `is_deleted: true` entries BEFORE `is_deleted: false` entries in `diffList`.

### 3. Tests & Build
- `tests/test_gas_archive.js`:
  - Extend `createHarness()` `Utilities.formatDate` mock to support `'yyyy/MM/dd'` and `'M/d'` patterns (while keeping `'HH:mm'` and `'yyyy-MM-dd'`), and add optional `stubSchedule = true` (default `true` for the existing 29 scenarios; `false` for new T005 tests exercising real `getScheduleList` & `updateFirebaseScheduleList`). Also support `SHIP_SCHEDULE_API_URL` / `UrlFetchApp.fetch` mocking for Calendar API success vs failure in T005 scenarios.
  - Add scenarios: (1) `is_deleted: true` hides calendar ship, (2) deleting ALL/last remaining ship via `update_schedule` clears `schedule_list` (`[]`), (3) Calendar API fetch failure during `update_schedule` preserves existing `schedule_list` instead of wiping it, (4) re-adding deleted ship restores it, (5) deleting `UNFINISHED_SHIP` clears it, (6) `06/09` -> `6/9` normalization across `update_schedule`, `getScheduleList`, `tryHandoffToNextShip`, and `archiveAndClearFirebase`, (7) expired tombstone cleanup, and (8) `UNFINISHED_SHIP` terminal retention.
- `tests/frontend-isolated.js`:
  - Update DOM selectors/assertions for v1.5 layout, verify no double-click trigger on `#scheduleHeaderRow`, test 375px zero-overflow on dual warning (`浪高 2.51 > 2.5 m` & `能見度 1.99 < 2 浬`), test segmented controls + open-modal `active_status` wind tick immunity + red `#resetBtn`, test double-row schedule editor add/edit/delete/`MM/DD`/`99/99` bounds/trimmed diffing, verify `#navScheduleBtn` lock UI, and run full existing forecast + v2 chat room suites unchanged.
- `tests/frontend-echarts.js`: Run unchanged to verify zero regressions in `#forecastModal`.
- `python deploy/build_hosting.py`: Build `public/` and validate resource integrity.

### 4. Verification & Visual Check
- Run `node --test`, `pytest`, Playwright `frontend-isolated.js` and `frontend-echarts.js`, plus capture mobile screenshots (`390x844` and `375x812`) via Playwright for direct visual inspection.

### 5. Round-2 Addendum (Scheme A Maritime Blue-Gray-Gold + 6 Refinements)
- Update `frontend/index.html` palette & tokens to **方案 A（港務藍灰金 60-30-10）**: `<meta name="theme-color" content="#0B2948"/>`, `--bg-color: #E9EEF4`, `--border-subtle: #D5DFEA`, `--text-navy: #0B2948`, `--text-blue: #164E8A`, `--accent-gold: #EAB308`, `--accent-gold-bg: #FEF3C7`, `--accent-gold-border: #F59E0B`, `--table-head-bg: #DCE5F0`, `--table-head-text: #1E3A5F`, `--w12: #D97706`, `--w13: #0B2948`.
- Replace `.app-header` with full-width `.app-header-bar` (`#0B2948` + `3px solid #EAB308` bottom accent, circular white `logo.png` badge, white title, ONLY `#infoLink` on right); restore `#soundToggle` to `.schedule-header` center column (`grid-template-columns: 1fr auto 1fr`).
- Pair `.wind-card-top` (`北堤風速` left + `#dataTime` right); center `.wind-main-row` when `.wind-card` lacks `.has-status-pill` and split `space-between` when active monitoring.
- Style `#scheduleHeaderRow th` with opaque `#DCE5F0` fill and `#1E3A5F` bold text inside bordered `.table-wrapper`.
- Style `.bottom-nav-item.is-active .bottom-nav-icon-wrap` with `#FEF3C7` background, `#F59E0B` border, and scaled `#0B2948` SVG stroke.
- Simplify `#manualModal` limit speed to 2-column `12` | `15` (removing `自訂` button and `#customLimitSpeedWrap`, retaining hidden `#limitSpeed`).
- Refactor `#scheduleAdjustModal` to arrow-only `#adjustBackBtn`, circular `.add-row-btn` with green `#28a745` hover spin (`rotate(90deg) scale(1.1)`), and centered `max-width: 480px` horizontal column alignment across `.adjust-topbar-inner`, `.adjust-card-list`, and `.adjust-footer-inner`.
- Update `tests/frontend-isolated.js`, rebuild `public/`, run full verification + desktop/mobile screenshots (`00`–`09`), pass fresh `egm-codebase-details` audit (`r2`), consolidate same-day HTML report, and commit locally.
