const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../gas/monitor.js"), "utf8");
const start = source.indexOf("function setupSystemTriggers()");
let depth = 0;
let end = start;
for (let index = source.indexOf("{", start); index < source.length; index += 1) {
  if (source[index] === "{") depth += 1;
  if (source[index] === "}" && --depth === 0) { end = index + 1; break; }
}
const setupSource = source.slice(start, end);
const calendarId = "89f17p8et94udnavnaqgihrgvg@group.calendar.google.com";

function trigger(handler, source, sourceId = null) {
  return {
    getHandlerFunction: () => handler,
    getTriggerSource: () => source,
    getTriggerSourceId: () => sourceId,
  };
}

function createHarness(initial = []) {
  const triggers = [...initial];
  const created = [];
  const scriptApp = {
    TriggerSource: {CLOCK: "CLOCK", CALENDAR: "CALENDAR", SPREADSHEETS: "SPREADSHEETS"},
    getProjectTriggers: () => triggers,
    newTrigger(handler) {
      return {
        timeBased() {
          const spec = {handler, source: scriptApp.TriggerSource.CLOCK};
          const builder = {
            atHour(hour) { spec.hour = hour; return builder; },
            everyDays(days) { spec.days = days; return builder; },
            everyMinutes(minutes) { spec.minutes = minutes; return builder; },
            create() { const item = trigger(handler, spec.source); triggers.push(item); created.push(spec); return item; },
          };
          return builder;
        },
        forUserCalendar(id) {
          return {
            onEventUpdated() {
              return {create() {
                const item = trigger(handler, scriptApp.TriggerSource.CALENDAR, id);
                triggers.push(item);
                created.push({handler, source: scriptApp.TriggerSource.CALENDAR, sourceId: id, event: "updated"});
                return item;
              }};
            },
          };
        },
      };
    },
  };
  const context = {ScriptApp: scriptApp};
  vm.createContext(context);
  vm.runInContext(setupSource, context);
  return {triggers, created, setup: context.setupSystemTriggers, source: scriptApp.TriggerSource};
}

{
  const test = createHarness();
  test.setup();
  assert.deepEqual(test.created, [
    {handler: "checkDailySchedule", source: "CLOCK", hour: 4, days: 1},
    {handler: "executeMonitor", source: "CLOCK", minutes: 1},
    {handler: "archiveAndClearFirebase", source: "CLOCK", hour: 23, days: 1},
    {handler: "onCalendarOrSheetChange", source: "CALENDAR", sourceId: calendarId, event: "updated"},
  ]);
}

{
  const test = createHarness();
  test.setup();
  test.setup();
  assert.equal(test.created.length, 4, "repeated setup does not duplicate triggers");
}

{
  const initial = [
    trigger("checkDailySchedule", "CLOCK"),
    trigger("executeMonitor", "CLOCK"),
    trigger("archiveAndClearFirebase", "CLOCK"),
  ];
  const test = createHarness(initial);
  test.setup();
  assert.deepEqual(test.created, [{handler: "onCalendarOrSheetChange", source: "CALENDAR", sourceId: calendarId, event: "updated"}]);
  assert.equal(test.triggers.slice(0, 3).every((item, index) => item === initial[index]), true, "existing time triggers remain intact");
}

{
  const otherCalendar = trigger("onCalendarOrSheetChange", "CALENDAR", "other-calendar@example.test");
  const unrelated = trigger("unrelated", "SPREADSHEETS", "sheet-id");
  const test = createHarness([otherCalendar, unrelated]);
  test.setup();
  assert.ok(test.triggers.includes(otherCalendar), "other calendar trigger is preserved");
  assert.ok(test.triggers.includes(unrelated), "unrelated trigger is preserved");
  assert.equal(test.created.filter(item => item.source === "CALENDAR").length, 1, "required calendar is still created");
}

console.log("GAS trigger setup: 4 scenarios passed");
