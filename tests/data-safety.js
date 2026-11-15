// Data-safety checks for Ascend web. Run: node tests/data-safety.js [old.html]
// Serves this repo's index.html as /new.html and, if given, a previous version as /old.html
// (for example: git show origin/main:index.html > /tmp/old.html). Needs Playwright with Chromium.
// It runs in Chrome's engine on a simulated iPhone, not Safari on a real phone.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const OLD = process.argv[2] ? fs.readFileSync(process.argv[2]) : null;
const PORT = 8790, U = `http://localhost:${PORT}/`;
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0], body = u === '/new.html' ? NEW : u === '/old.html' ? OLD : null;
  if (!body) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': 'text/html' }); r.end(body);
}).listen(PORT);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const LS = 'ascend-proto-v1';
const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = off => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + off); return key(d); };
const T = day(0);
const monday = (() => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return key(d); })();
const seed = () => ({
  v: 1, started: true, trialStart: day(-20), savedAt: Date.now() - 1000, opens: { [day(-20)]: true, [day(-1)]: true },
  goals: [
    { id: 'g1', name: 'Read 24 books', emoji: '📚', color: 'violet', target: 24, unit: 'books', deadline: day(200), createdDay: day(-60) },
    { id: 'g2', name: 'Save money', target: 5000, unit: '$', deadline: null, createdDay: day(-30) },
    { id: 'g3', name: 'Old goal', target: 10, unit: 'km', deadline: null, createdDay: day(-90), archived: true },
  ],
  habits: [
    { id: 'h1', name: 'Read 20 min', days: [], goalId: 'g1', amount: 0.1, startDay: day(-40), part: 'evening' },
    { id: 'h2', name: 'Gym', days: [], times: 3, every: 7, anchor: monday, goalId: null, amount: 0, startDay: day(-20), color: 'coral', emoji: '💪' },
    { id: 'h3', name: 'Stretch', days: [1, 3, 5], goalId: null, amount: 0, startDay: day(-15) },
    { id: 'h5', name: 'Swim', days: [], times: 2, every: 10, anchor: day(-3), goalId: 'g3', amount: 1, startDay: day(-12), archived: true },
  ],
  tasks: [
    { id: 't1', title: 'Finish book', due: day(3), priority: 2, goalId: 'g1', amount: 1, done: false },
    { id: 't2', title: 'Pay bills', due: day(-2), priority: 1, goalId: 'g2', amount: 0, done: false },
    { id: 't6', title: 'Buy bookmark', due: day(-1), priority: 2, goalId: 'g1', amount: 0, done: false },
    { id: 't3', title: 'Deposit', due: day(-5), priority: 2, goalId: 'g2', amount: 250, done: true, doneOn: day(-5) },
    { id: 't4', title: 'Someday', due: null, priority: 3, goalId: null, amount: 0, done: false, part: 'morning' },
    { id: 't5', title: 'Dropped one', due: day(-8), priority: 2, goalId: null, amount: 0, done: false, dropped: true },
  ],
  logs: { h1: { [day(-1)]: 'done', [day(-2)]: 'done', [day(-3)]: 'rest', [day(-9)]: 'done' }, h2: { [day(-1)]: 'done' }, h3: { [day(-4)]: 'done' }, h5: { [day(-2)]: 'done' } },
  entries: [{ id: 'e1', goalId: 'g2', day: day(-10), amount: 1200, note: 'bonus' }, { id: 'e2', goalId: 'g1', day: day(-20), amount: 3, note: '' }],
});
const strip = s => { const o = JSON.parse(JSON.stringify(s)); delete o.savedAt; delete o.opens; delete o.trialStart; return o; };
const same = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const stored = p => p.evaluate(k => localStorage.getItem(k), LS);
const backups = p => p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ascend-bak:')).sort());
const tab = (p, t) => p.click(`nav.tabs button[data-tab="${t}"]`).then(() => p.waitForTimeout(150));

async function phone(b) {
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
  await ctx.route(/fonts\./, r => r.abort());
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  return { ctx, p };
}
async function open(p, file, data) {
  await p.goto(U + file);
  if (data !== undefined) { await p.evaluate(([k, v]) => { localStorage.clear(); if (v != null) localStorage.setItem(k, v); }, [LS, typeof data === 'string' ? data : data && JSON.stringify(data)]); await p.reload(); }
  await p.waitForTimeout(400);
}

(async () => {
  const b = await chromium.launch();
  const errs = [];

  // 1. Data written by the previous version opens unchanged, and the previous version can still open ours.
  if (OLD) {
    const { ctx, p } = await phone(b);
    await open(p, 'old.html', seed());
    await p.click('[data-act="toggleHabit"][data-id="h1"]'); await p.waitForTimeout(200);
    const oldText = await stored(p), oldBlob = JSON.parse(oldText);
    ok(oldBlob.logs.h1[T] === 'done', 'previous version wrote a check-in today');
    await open(p, 'new.html');
    const after = await stored(p);
    ok(same(JSON.parse(after), oldBlob), 'new version loads previous version\'s data with every field unchanged');
    const body = await p.innerText('#view');
    ok(/Gym/.test(body) && /Pay bills/.test(body) && !/Start with/.test(body), 'Today shows the data, not the welcome screen');
    ok((await backups(p)).includes('ascend-bak:' + T), 'a daily backup was made on first open');
    // use it a bit, then roll back
    await p.click('[data-act="toggleHabit"][data-id="h3"]').catch(() => {});
    await p.click('[data-act="toggleTask"][data-id="t1"]').catch(() => {});
    await tab(p, 'tasks'); await tab(p, 'today');
    const newBlob = JSON.parse(await stored(p));
    await open(p, 'old.html');
    const back = JSON.parse(await stored(p));
    ok(same(back, newBlob) && /Gym/.test(await p.innerText('#view')), 'previous version still opens data saved by the new one (safe to roll back)');
    errs.push(...p.errs); await ctx.close();
  } else console.log('SKIP previous-version checks (no old.html given)');

  // 2. Export, delete everything, restore: identical data. Delete makes a backup first.
  {
    const { ctx, p } = await phone(b);
    await open(p, 'new.html', seed());
    await tab(p, 'more'); await p.click('[data-act="showExport"]'); await p.waitForTimeout(150);
    const exp = await p.inputValue('#exp'), before = JSON.parse(await stored(p));
    ok(same(JSON.parse(exp), before), 'export text equals saved data');
    await p.click('[data-act="askReset"]'); await p.waitForTimeout(150); await p.click('[data-act="confirmYes"]'); await p.waitForTimeout(250);
    ok(JSON.parse(await stored(p)).goals.length === 0, 'Delete everything empties the data');
    const bk = await backups(p);
    ok(bk.some(k => k.endsWith('-before-delete')), 'Delete everything kept a backup first');
    await tab(p, 'more');
    await p.fill('#imp', exp); await p.click('[data-act="askImport"]'); await p.waitForTimeout(150); await p.click('[data-act="confirmYes"]'); await p.waitForTimeout(250);
    ok(same(JSON.parse(await stored(p)), before), 'restore gives back identical data');
    // Restoring an automatic backup
    await tab(p, 'more');
    const del = (await backups(p)).find(k => k.endsWith('-before-delete'));
    await p.click(`[data-act="askRestoreBackup"][data-id="${del}"]`); await p.waitForTimeout(150); await p.click('[data-act="confirmYes"]'); await p.waitForTimeout(250);
    ok(same(JSON.parse(await stored(p)), before), 'restoring the automatic backup gives back identical data');
    ok((await backups(p)).some(k => k.endsWith('-before-restore')), 'a restore keeps a backup of what was there');
    // bad import rejected, data untouched
    await tab(p, 'more'); const cur = await stored(p);
    await p.fill('#imp', '{"goals":[]}'); await p.click('[data-act="askImport"]'); await p.waitForTimeout(150);
    ok(await stored(p) === cur && /Missing/.test(await p.innerText('#view')), 'bad import rejected, data untouched');
    errs.push(...p.errs); await ctx.close();
  }

  // 3. One unreadable value: the app must not start empty or write anything.
  {
    const { ctx, p } = await phone(b);
    await open(p, 'new.html', seed());           // makes today's daily backup
    const bad = seed(); bad.logs.h1[day(-1)] = 'skip';
    const badText = JSON.stringify(bad);
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [LS, badText]);
    await p.reload(); await p.waitForTimeout(500);
    const body = await p.innerText('#view');
    ok(/couldn't read your saved data/i.test(body) && !/Start blank/.test(body), 'unreadable data shows the recovery screen, not the welcome screen');
    for (const t of ['today', 'goals', 'habits', 'tasks', 'more', 'today']) await tab(p, t);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(300);
    ok(await stored(p) === badText, 'nothing was written over the unreadable data');
    ok(await p.isHidden('#fab'), 'the + button is hidden while data is unreadable');
    const bk = (await backups(p)).find(k => k.startsWith('ascend-bak:' + T));
    ok(!!bk && /Read 24 books|3 goals/.test(body), 'recovery screen offers the automatic backup');
    await p.click(`[data-act="askRestoreBackup"][data-id="${bk}"]`); await p.waitForTimeout(150); await p.click('[data-act="confirmYes"]'); await p.waitForTimeout(300);
    const now = JSON.parse(await stored(p));
    ok(now.goals.length === 3 && now.logs.h1[day(-1)] === 'done', 'restoring from the recovery screen brings the data back');
    const keep = (await backups(p)).find(k => k.endsWith('-unreadable'));
    ok(!!keep && JSON.parse(await p.evaluate(k => localStorage.getItem(k), keep)).data === badText, 'the unreadable data is kept, byte for byte');
    ok(/Gym/.test(await p.innerText('#view')), 'app works normally after restoring');
    errs.push(...p.errs); await ctx.close();
  }
  // 3b. Broken JSON with no backups: recovery screen, copy-out available, data untouched.
  {
    const { ctx, p } = await phone(b);
    await open(p, 'new.html', '{"v":1,"goals":[{"id":');
    ok(/couldn't read/i.test(await p.innerText('#view')), 'broken JSON shows the recovery screen');
    await p.click('[data-act="template"]').catch(() => {});
    ok(await stored(p) === '{"v":1,"goals":[{"id":', 'broken JSON is left untouched');
    errs.push(...p.errs); await ctx.close();
  }

  // 4. Saving fails: a clear warning, not "Saved".
  {
    const { ctx, p } = await phone(b);
    await open(p, 'new.html', seed());
    await p.evaluate(() => { const orig = Storage.prototype.setItem; window.__restore = () => { Storage.prototype.setItem = orig; }; Storage.prototype.setItem = function (k, v) { if (k === 'ascend-proto-v1') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } return orig.call(this, k, v); }; });
    await p.click('[data-act="toggleHabit"][data-id="h1"]'); await p.waitForTimeout(200);
    ok(await p.isVisible('#saveerr') && /wasn't saved/.test(await p.innerText('#saveerr')), 'failed save shows a warning');
    await tab(p, 'more');
    ok(/NOT saved/.test(await p.innerText('#view')), 'More says the last change was not saved');
    await p.evaluate(() => window.__restore());
    await p.click('[data-act="retrySave"]'); await p.waitForTimeout(200);
    ok(await p.isHidden('#saveerr') && JSON.parse(await stored(p)).logs.h1[T] === 'done', 'Try again saves and clears the warning');
    errs.push(...p.errs); await ctx.close();
  }

  // 5. "Let them go" only lets go of the tasks on screen, and they can be brought back.
  {
    const { ctx, p } = await phone(b);
    await open(p, 'new.html', seed());
    await p.click('.gcard[data-id="g1"]'); await p.waitForTimeout(150);
    const body = await p.innerText('#view');
    ok(/Buy bookmark/.test(body) && !/Pay bills/.test(body), 'filtered to one goal, Carried over shows only its task');
    await p.click('[data-act="askDropOverdue"]'); await p.waitForTimeout(150); await p.click('[data-act="confirmYes"]'); await p.waitForTimeout(250);
    let s = JSON.parse(await stored(p));
    ok(s.tasks.find(t => t.id === 't6').dropped && !s.tasks.find(t => t.id === 't2').dropped, 'only the visible task was let go');
    await tab(p, 'tasks'); await p.click('[data-act="toggleGone"]'); await p.waitForTimeout(150);
    ok(/Buy bookmark/.test(await p.innerText('#view')), 'Tasks lists the tasks you let go');
    await p.click('[data-act="undrop"][data-id="t6"]'); await p.waitForTimeout(200);
    s = JSON.parse(await stored(p));
    ok(!s.tasks.find(t => t.id === 't6').dropped, 'Bring back restores it');
    errs.push(...p.errs); await ctx.close();
  }

  // 6. Backups are capped: at most 7 daily copies.
  {
    const { ctx, p } = await phone(b);
    await open(p, 'new.html', seed());
    await p.evaluate(([d0, T]) => { for (let i = 1; i <= 10; i++) { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - i); const k = d.toISOString().slice(0, 10); localStorage.setItem('ascend-bak:' + k, JSON.stringify({ at: d.getTime(), reason: 'daily', data: localStorage.getItem('ascend-proto-v1') })); } localStorage.removeItem('ascend-bak:' + T); }, [0, T]);
    await p.reload(); await p.waitForTimeout(400);
    const bk = await backups(p);
    ok(bk.length === 7 && bk.includes('ascend-bak:' + T), 'keeps the newest 7 daily backups: ' + bk.length);
    errs.push(...p.errs); await ctx.close();
  }

  ok(errs.length === 0, 'no page errors ' + errs.join(' / '));
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
