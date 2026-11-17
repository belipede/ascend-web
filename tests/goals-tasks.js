// Task pickers, carrying typed text into the full task form, goal steps, and the compact Goals tab.
// Run: node tests/goals-tasks.js [old.html]   (old.html = previous live index.html, for the "old data still loads" checks)
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const OLD = process.argv[2] ? fs.readFileSync(process.argv[2]) : null;
const PORT = 8793, U = `http://localhost:${PORT}/`;
const srv = http.createServer((q, r) => { const u = q.url.split('?')[0], body = u === '/new.html' ? NEW : u === '/old.html' ? OLD : null; if (!body) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(body); }).listen(PORT);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const LS = 'ascend-proto-v1';
const pad = n => String(n).padStart(2, '0');
const day = off => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const stored = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), LS);
const seed = () => ({ v: 1, started: true, savedAt: Date.now() - 1000, opens: {}, trialStart: day(-3),
  goals: [{ id: 'g1', name: 'Read 24 books', emoji: '📚', target: 24, unit: 'books', deadline: day(100), createdDay: day(-10) },
    { id: 'g2', name: 'Run 100 km', target: 100, unit: 'km', deadline: null, createdDay: day(-5) },
    { id: 'g3', name: 'Done one', target: 1, unit: '', createdDay: day(-30), archived: true }],
  habits: [], tasks: [], logs: {}, entries: [{ id: 'e1', goalId: 'g1', day: day(-2), amount: 6, note: '' }, { id: 'e2', goalId: 'g3', day: day(-20), amount: 1, note: '' }] });
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
  await ctx.route(/fonts\./, r => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  const load = async (file, data) => { await p.goto(U + file); await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); }, [LS, JSON.stringify(data)]); await p.reload(); await p.waitForTimeout(300); };
  await load('new.html', seed());

  // 1. Add sheet: date and priority pills
  await p.click('#fab'); await p.waitForTimeout(250);
  ok(await p.isVisible('.sheet [data-act="pickDue"][aria-checked="true"]'), 'Add sheet shows date pills with Today selected');
  await p.fill('#qa2', 'Buy milk');
  await p.click('.sheet [data-act="pickDue"]:text("Tomorrow")'); await p.click('.sheet [data-act="pickPr"]:text("High")');
  await p.fill('#qa2', 'Buy milk now'); // typing without a date keeps the tapped pills
  await p.click('.sheet button[type=submit]'); await p.waitForTimeout(250);
  let s = await stored(p), t = s.tasks.find(x => x.title === 'Buy milk now');
  ok(t && t.due === day(1) && t.priority === 1, `tapped Tomorrow + High are saved (${t && t.due}, ${t && t.priority})`);
  await p.click('#fab'); await p.waitForTimeout(250);
  await p.fill('#qa2', 'Water plants'); await p.click('.sheet [data-act="pickDue"]:text("No date")'); await p.click('.sheet [data-act="pickPr"]:text("Low")');
  await p.click('.sheet button[type=submit]'); await p.waitForTimeout(250);
  s = await stored(p); t = s.tasks.find(x => x.title === 'Water plants');
  ok(t && t.due === null && t.priority === 3, 'No date + Low saved');
  await p.click('#fab'); await p.waitForTimeout(250);
  await p.fill('#qa2', 'Call Sam fri !');
  ok(await p.getAttribute('.sheet [data-act="pickPr"]:text("High")', 'aria-checked') === 'true', 'typing ! selects High');
  ok(await p.getAttribute('.sheet [data-act="pickDue"]:text("Today")', 'aria-checked') === 'false' || (await p.evaluate(() => new Date().getDay())) === 5, 'typing fri moves the date');
  await p.fill('.sheet .duepick', day(9)); await p.waitForTimeout(100);
  ok(await p.isVisible('.sheet label.pill.on'), 'picked date shows on the date pill');
  await p.click('.sheet button[type=submit]'); await p.waitForTimeout(250);
  s = await stored(p); t = s.tasks.find(x => x.title === 'Call Sam');
  ok(t && t.due === day(9) && t.priority === 1, 'picked calendar date wins over typed day: ' + (t && t.due));

  // 2. Task with all options carries the typed text
  await p.click('#fab'); await p.waitForTimeout(250);
  await p.fill('#qa2', 'Return library book tmr #books');
  await p.click('.sheet [data-act="pickPr"]:text("High")');
  await p.click('.sheet [data-act="openForm"][data-form="task"]'); await p.waitForTimeout(250);
  ok(await p.inputValue('#t-title') === 'Return library book', 'task name carried into the full form: ' + await p.inputValue('#t-title'));
  ok(await p.getAttribute('.sheet [data-act="pickDue"]:text("Tomorrow")', 'aria-checked') === 'true', 'typed date carried');
  ok(await p.getAttribute('.sheet [data-act="pickPr"]:text("High")', 'aria-checked') === 'true', 'chosen priority carried');
  ok(await p.inputValue('#t-goal') === 'g1', 'linked goal carried');
  await p.click('.sheet [data-act="pickDue"]:text("No date")');
  await p.click('.sheet button[type=submit]'); await p.waitForTimeout(250);
  s = await stored(p); t = s.tasks.find(x => x.title === 'Return library book');
  ok(t && t.due === null && t.priority === 1 && t.goalId === 'g1', 'full form saves with no date');
  await p.click('#fab'); await p.waitForTimeout(250);
  await p.fill('#qa2', 'Learn Spanish'); await p.click('.sheet [data-act="openForm"][data-form="goal"]'); await p.waitForTimeout(250);
  ok(await p.inputValue('#g-name') === 'Learn Spanish', 'New goal from the Add sheet also carries the text');
  await p.click('.sheet [data-act="closeForm"]'); await p.waitForTimeout(200);
  await p.click('nav.tabs button[data-tab="tasks"]'); await p.click('[data-act="openForm"][data-form="task"]'); await p.waitForTimeout(250);
  ok(await p.inputValue('#t-title') === '', 'New task from Tasks starts empty (no stale text)');
  // Editing an existing task keeps its date and can clear it
  await p.click('.sheet [data-act="closeForm"]'); await p.waitForTimeout(200);
  const bm = s.tasks.find(x => x.title === 'Buy milk now');
  await p.click(`[data-act="editTask"].mini[data-id="${bm.id}"]`); await p.waitForTimeout(250);
  ok(await p.getAttribute('.sheet [data-act="pickDue"]:text("Tomorrow")', 'aria-checked') === 'true', 'edit form shows the task\'s date');
  await p.click('.sheet [data-act="pickDue"]:text("No date")'); await p.click('.sheet [data-act="pickPr"]:text("Normal")');
  await p.click('.sheet button[type=submit]'); await p.waitForTimeout(250);
  s = await stored(p); t = s.tasks.find(x => x.id === bm.id);
  ok(t.due === null && t.priority === 2, 'edit clears the date and changes priority');

  // 3. Goals tab: summary + folded goals
  await p.click('nav.tabs button[data-tab="goals"]'); await p.waitForTimeout(200);
  const gv = await p.innerText('#view');
  ok(/3\s*Goals set/.test(gv) && /1\s*Completed/.test(gv), 'summary shows goals set and completed');
  ok(/13%\s*Overall/.test(gv), 'overall progress is the average of active goals (25% and 0%): ' + (gv.match(/\d+%\s*Overall/) || [''])[0]);
  ok(await p.$$eval('#view svg', x => x.length) === 0, 'no charts until a goal is opened');
  await p.click('[data-act="toggleGoal"][data-id="g1"]'); await p.waitForTimeout(150);
  ok(await p.$$eval('#view .goal svg', x => x.length) === 1 && await p.getAttribute('[data-act="toggleGoal"][data-id="g1"]', 'aria-expanded') === 'true', 'tapping a goal opens only its chart');
  await p.click('[data-act="toggleGoal"][data-id="g2"]'); await p.waitForTimeout(150);
  ok(await p.getAttribute('[data-act="toggleGoal"][data-id="g1"]', 'aria-expanded') === 'false', 'opening another goal folds the first');

  // 4. Steps (milestones)
  await p.click('[data-act="editGoal"][data-id="g2"]'); await p.waitForTimeout(250);
  for (let i = 0; i < 3; i++) await p.click('.sheet [data-act="addStep"]');
  const names = p.locator('.sheet input[name="ms-name"]');
  await names.nth(0).fill('First 10 km'); await names.nth(1).fill('');  await names.nth(2).fill('Half way');
  await p.locator('.sheet input.msdue').nth(2).fill(day(-1));
  await p.locator('.sheet input.msdue').nth(0).fill(day(5));
  await p.click('.sheet button[type=submit]'); await p.waitForTimeout(250);
  s = await stored(p); let g2 = s.goals.find(g => g.id === 'g2');
  ok(g2.milestones.length === 2 && g2.milestones[0].name === 'First 10 km' && g2.milestones[0].due === day(5) && g2.milestones[1].due === day(-1), 'steps saved in order with dates; blank row dropped');
  let txt = await p.innerText('#view');
  ok(/0 of 2 done/.test(txt) && /was due/.test(txt), 'steps listed, overdue one flagged');
  await p.click(`[data-act="toggleStep"][data-id="g2"][data-step="${g2.milestones[0].id}"]`); await p.waitForTimeout(200);
  s = await stored(p); g2 = s.goals.find(g => g.id === 'g2');
  ok(g2.milestones[0].done && g2.milestones[0].doneOn === day(0), 'ticking a step saves it');
  // editing keeps ticks; removing a step works
  await p.click('[data-act="editGoal"][data-id="g2"]'); await p.waitForTimeout(250);
  await p.locator('.sheet [data-act="removeStep"]').nth(1).click();
  await p.click('.sheet [data-act="addStep"]'); await p.locator('.sheet input[name="ms-name"]').nth(1).fill('Finish 100 km');
  await p.click('.sheet button[type=submit]'); await p.waitForTimeout(250);
  s = await stored(p); g2 = s.goals.find(g => g.id === 'g2');
  ok(g2.milestones.length === 2 && g2.milestones[0].done && g2.milestones[1].name === 'Finish 100 km' && !g2.milestones[1].done, 'edit keeps ticks, removes and adds steps');
  ok(goalNum(s, 'g2') === 0, 'steps do not change goal progress');
  await p.click('[data-act="toggleGoal"][data-id="g2"]'); await p.waitForTimeout(150);
  ok(/Next step: Finish 100 km/.test(await p.innerText('#view')) && /1\/2 steps/.test(await p.innerText('#view')), 'folded card shows steps count and next step');
  // New goal with steps
  await p.click('[data-act="openForm"][data-form="goal"]'); await p.waitForTimeout(250);
  await p.fill('#g-name', 'Learn guitar'); await p.fill('#g-target', '3'); await p.fill('#g-unit', 'songs');
  await p.click('.sheet [data-act="addStep"]'); await p.locator('.sheet input[name="ms-name"]').nth(0).fill('Learn 3 chords');
  await p.click('.sheet button[type=submit]'); await p.waitForTimeout(250);
  s = await stored(p); const lg = s.goals.find(g => g.name === 'Learn guitar');
  ok(lg && lg.milestones.length === 1 && lg.milestones[0].due === null, 'new goal saved with an undated step');
  ok(await p.getAttribute(`[data-act="toggleGoal"][data-id="${lg.id}"]`, 'aria-expanded') === 'true', 'new goal opens after creating it');

  // 5. Data: bad steps are cleaned, not fatal; old goals untouched; old app keeps steps
  const bad = seed(); bad.goals[0].milestones = [{ id: 'a', name: 'Ok', due: 'nope', done: 1 }, { name: '' }, null, 'x']; bad.goals[1].milestones = 'oops';
  await load('new.html', bad);
  s = await stored(p);
  ok(!/couldn't be read/i.test(await p.innerText('#view')), 'odd step data does not trigger the recovery screen');
  await p.click('nav.tabs button[data-tab="goals"]'); await p.click('[data-act="toggleGoal"][data-id="g1"]'); await p.waitForTimeout(150);
  ok(/1 of 1 done/.test(await p.innerText('#view')), 'odd step data is cleaned to the one valid step');
  const plain = seed(); await load('new.html', plain); s = await stored(p);
  ok(s.goals.every(g => !('milestones' in g)), 'goals without steps load and stay unchanged');
  if (OLD) {
    const withSteps = seed(); withSteps.goals[0].milestones = [{ id: 'm1', name: 'Book 1', due: day(3), done: true, doneOn: day(-1) }];
    await load('old.html', withSteps);
    await p.click('nav.tabs button[data-tab="today"]').catch(() => {}); await p.waitForTimeout(200);
    await p.fill('#qa', 'Saved by old version').catch(() => {}); await p.press('#qa', 'Enter').catch(() => {}); await p.waitForTimeout(300);
    s = await stored(p);
    ok(JSON.stringify(s.goals[0].milestones) === JSON.stringify(withSteps.goals[0].milestones), 'previous live version keeps steps when it saves (safe to roll back)');
  } else console.log('SKIP old-version check (no old.html given)');
  ok(errs.length === 0, 'no page errors ' + errs.join(' / '));
  await b.close(); srv.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
function goalNum(s, id) { return s.entries.filter(e => e.goalId === id).reduce((a, e) => a + e.amount, 0); }
