// Craving data safety checks. Run: node tests/crave-data.js
// The cravings section must survive loading, saving, export/restore, backups and GitHub sync,
// a broken craving must never stop the rest of the data from loading, and sections from a newer version are kept.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8794, U = `http://localhost:${PORT}/new.html`;
const srv = http.createServer((q, r) => { if (q.url.split('?')[0] !== '/new.html') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(NEW); }).listen(PORT);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const LS = 'ascend-proto-v1';
const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = off => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + off); return key(d); };
const shop = () => ({
  items: [
    { id: 'milk', name: 'Fresh milk 1L', cat: 'dairy', price: 315, rate: 2, keeps: 7, stock: 1, stockOn: day(-2), boughtOn: day(-6) },
    { id: 'rice', name: 'Jasmine rice 5kg', cat: 'pantry', price: 1290, staple: true, low: true },
    { id: 'card', name: 'Birthday card', cat: 'other', price: 400, want: 1, note: 'for Sam', futureField: { kept: true } },
  ],
  trips: [{ id: 'tr1', day: day(-6), where: 'FairPrice', lines: [{ name: 'Fresh milk 1L', cat: 'dairy', qty: 2, cents: 630, itemId: 'milk' }] }],
  cart: { milk: { qty: 2, cents: 630 } }, budget: { week: 7000 }, shopDay: 6,
});
const cravings = () => ({ list: [
  { id: 'c1', name: 'Bubble tea', cat: 'drink', day: day(-1), at: '22:10', level: 2, got: 'skip' },
  { id: 'c2', name: 'Mala', cat: 'meal', day: day(0), at: '13:05', level: 3, note: 'long day', futureField: { kept: true } },
  { id: 'c3', name: 'Sushi', cat: 'meal', day: day(-2), at: '09:00', wk: true } ], futureTop: 1 });
const seed = (withShop = true) => ({ v: 1, started: true, trialStart: day(-10), savedAt: Date.now() - 1000, opens: {},
  goals: [{ id: 'g1', name: 'Read 24 books', target: 24, unit: 'books', deadline: null, createdDay: day(-30) }],
  habits: [{ id: 'h1', name: 'Walk', days: [], goalId: null, amount: 0, startDay: day(-30) }],
  tasks: [{ id: 't1', title: 'Call Sam', due: null, priority: 2, goalId: null, amount: 0, done: false }],
  logs: { h1: { [day(-1)]: 'done' } }, entries: [], ...(withShop ? { shop: shop() } : {}), cravings: cravings() });
const stored = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), LS);
const backups = p => p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ascend-bak:')));
const tab = (p, t) => p.click(`nav.tabs button[data-tab="${t}"]`).then(() => p.waitForTimeout(150));
const GH = { file: null, sha: 0, puts: 0 };
async function fakeGh(route) {
  const q = route.request(), u = new URL(q.url()), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT' };
  if (q.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const j = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (u.pathname === '/repos/ben/data') return j(200, { private: true });
  if (q.method() === 'GET') return GH.file ? j(200, { sha: 's' + GH.sha, size: GH.file.length, content: Buffer.from(GH.file).toString('base64') }) : j(404, {});
  const b = JSON.parse(q.postData());
  if (GH.file && b.sha !== 's' + GH.sha) return j(409, {});
  GH.file = Buffer.from(b.content, 'base64').toString(); GH.sha++; GH.puts++;
  return j(200, { content: { sha: 's' + GH.sha } });
}
async function phone(b, data, gh) {
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
  await ctx.route(/fonts\./, r => r.abort()); await ctx.route(/api\.github\.com/, fakeGh);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(U);
  await p.evaluate(([k, v, g]) => { localStorage.clear(); if (g) localStorage.setItem('ascend-gh-sync-v1', JSON.stringify({ repo: 'ben/data', token: 'tok' })); if (v != null) localStorage.setItem(k, v); }, [LS, data == null ? null : typeof data === 'string' ? data : JSON.stringify(data), !!gh]);
  await p.reload(); await p.waitForTimeout(gh ? 900 : 400);
  return { ctx, p };
}
(async () => {
  const b = await chromium.launch(); const errs = [];
  // 1. Craving data and unknown sections survive opening and using the app.
  {
    const d = seed(); d.fromTheFuture = { notes: ['keep me'] };
    const { ctx, p } = await phone(b, d);
    await p.click('[data-act="toggleHabit"][data-id="h1"]'); await p.waitForTimeout(200);
    const s = await stored(p);
    ok(JSON.stringify(s.cravings) === JSON.stringify(cravings()), 'craving data is saved back unchanged after using the app');
    ok(JSON.stringify(s.fromTheFuture) === JSON.stringify(d.fromTheFuture), 'a section from a newer version is kept');
    ok(JSON.stringify(s.shop) === JSON.stringify(shop()), 'shopping data is still kept');
    errs.push(...p.errs); await ctx.close();
  }
  // 2. Export, delete everything, restore: cravings come back.
  {
    const { ctx, p } = await phone(b, seed());
    await tab(p, 'more'); await p.click('[data-act="showExport"]'); await p.waitForTimeout(150);
    const exp = await p.inputValue('#exp');
    ok(JSON.stringify(JSON.parse(exp).cravings) === JSON.stringify(cravings()), 'export includes the cravings');
    await p.click('[data-act="askReset"]'); await p.waitForTimeout(150); await p.click('[data-act="confirmYes"]'); await p.waitForTimeout(250);
    await tab(p, 'more');
    await p.fill('#imp', exp); await p.click('[data-act="askImport"]'); await p.waitForTimeout(150); await p.click('[data-act="confirmYes"]'); await p.waitForTimeout(250);
    ok(JSON.stringify((await stored(p)).cravings) === JSON.stringify(cravings()), 'restore brings the cravings back');
    errs.push(...p.errs); await ctx.close();
  }
  // 3. Broken cravings never block the rest of the data.
  {
    const bad = seed(); bad.cravings.list.push(null, { name: '', day: day(0) }, { name: 'No day' }, { id: 'c1', name: 'Dup', day: day(0), at: '25:99', level: 7, got: 'maybe', cat: 'weird', wk: 'yes', note: 5 });
    const { ctx, p } = await phone(b, bad);
    ok(!/couldn't read/i.test(await p.innerText('#view')), 'data with broken cravings still opens');
    const s = await stored(p);
    ok(s.goals.length === 1 && s.habits.length === 1 && s.tasks.length === 1 && s.shop.items.length === 3, 'goals, habits, tasks and shopping are untouched');
    ok(s.cravings.list.length === 4 && new Set(s.cravings.list.map(c => c.id)).size === 4, 'bad cravings dropped, duplicate id made unique');
    const c = s.cravings.list[3];
    ok(c.at === '12:00' && c.cat === 'other' && !('level' in c) && !('got' in c) && !('wk' in c) && !('note' in c), 'bad craving fields fixed or removed');
    errs.push(...p.errs); await ctx.close();
  }
  // 4. Not an object: ignored, rest loads.
  {
    const d = seed(); d.cravings = 'lots';
    const { ctx, p } = await phone(b, d);
    const s = await stored(p);
    ok(s.goals.length === 1 && !('cravings' in s), 'a cravings section that isn\'t an object is ignored');
    errs.push(...p.errs); await ctx.close();
  }
  // 5. Only cravings on the phone still counts as data.
  {
    const d = seed(false); d.goals = []; d.habits = []; d.tasks = []; d.logs = {}; d.started = false;
    const { ctx, p } = await phone(b, d);
    ok(!/Start with/i.test(await p.innerText('#view')), 'only-cravings data does not show the welcome screen');
    ok((await backups(p)).length === 1, 'a daily backup is made for only-cravings data');
    errs.push(...p.errs); await ctx.close();
  }
  // 6. GitHub has only cravings and the phone is empty: never upload the empty copy over it.
  {
    const remote = seed(false); remote.goals = []; remote.habits = []; remote.tasks = []; remote.logs = {}; remote.savedAt = 1000;
    GH.file = JSON.stringify(remote); GH.puts = 0;
    const { ctx, p } = await phone(b, { v: 1, goals: [], habits: [], tasks: [], logs: {}, entries: [], started: true, savedAt: Date.now() }, true);
    ok(GH.puts === 0 && JSON.parse(GH.file).cravings.list.length === 3, 'empty phone did not upload over GitHub\'s cravings');
    errs.push(...p.errs); await ctx.close();
  }
  // 7. Sync upload carries the cravings.
  {
    GH.file = null; GH.puts = 0;
    const { ctx, p } = await phone(b, seed(), true);
    await p.click('[data-act="toggleHabit"][data-id="h1"]'); await p.waitForTimeout(2500);
    ok(GH.puts > 0 && JSON.stringify(JSON.parse(GH.file).cravings) === JSON.stringify(cravings()), 'GitHub sync uploads the cravings');
    errs.push(...p.errs); await ctx.close();
  }
  ok(errs.length === 0, 'no page errors ' + errs.join(' / '));
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
