const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../gas/monitor.js"), "utf8");
function extractFunction(name) {
  const start = source.indexOf(`function ${name}()`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Function not found: ${name}`);
}
const triggerSource = `${extractFunction("setupSystemTriggers")}\n${extractFunction("pauseSystemTriggers")}`;
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
    deleteTrigger(item) { triggers.splice(triggers.indexOf(item), 1); },
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
  vm.runInContext(triggerSource, context);
  return {triggers, created, setup: context.setupSystemTriggers, pause: context.pauseSystemTriggers, source: scriptApp.TriggerSource};
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

{
  const targetTriggers = [
    trigger("checkDailySchedule", "CLOCK"),
    trigger("executeMonitor", "CLOCK"),
    trigger("archiveAndClearFirebase", "CLOCK"),
    trigger("onCalendarOrSheetChange", "CALENDAR", calendarId),
  ];
  const otherCalendar = trigger("onCalendarOrSheetChange", "CALENDAR", "other-calendar@example.test");
  const wrongSource = trigger("executeMonitor", "SPREADSHEETS", "sheet-id");
  const unrelated = trigger("unrelated", "CLOCK");
  const test = createHarness([...targetTriggers, otherCalendar, wrongSource, unrelated]);

  const result = test.pause();
  assert.equal(result.deletedCount, 4, "only the four confirmed triggers are deleted");
  assert.deepEqual(Array.from(result.handlers), targetTriggers.map(item => item.getHandlerFunction()));
  assert.deepEqual(test.triggers, [otherCalendar, wrongSource, unrelated], "other calendars and unrelated triggers are preserved");

  const repeated = test.pause();
  assert.equal(repeated.deletedCount, 0, "repeated pause is safe");
  assert.deepEqual(Array.from(repeated.handlers), []);

  test.setup();
  assert.equal(test.created.length, 4, "setup restores all missing system triggers");
  assert.ok(test.triggers.includes(otherCalendar), "setup also preserves other calendars");
  assert.ok(test.triggers.includes(wrongSource), "setup also preserves unrelated sources");
  assert.ok(test.triggers.includes(unrelated), "setup also preserves unrelated handlers");
}

console.log("GAS trigger setup/pause: 5 scenarios passed");
