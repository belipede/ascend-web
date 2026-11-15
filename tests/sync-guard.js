// GitHub sync safety checks against a fake GitHub. Run: node tests/sync-guard.js
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8791, U = `http://localhost:${PORT}/new.html`;
const srv = http.createServer((q, r) => { if (q.url.split('?')[0] !== '/new.html') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(NEW); }).listen(PORT);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
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
const full = savedAt => ({ v: 1, goals: [{ id: 'g1', name: 'Read', target: 24, unit: 'books', deadline: null, createdDay: '2026-01-01' }], habits: [{ id: 'h1', name: 'Walk', days: [], goalId: null, amount: 0, startDay: '2026-01-01' }], tasks: [{ id: 't1', title: 'Call Sam', due: null, priority: 2, goalId: null, amount: 0, done: false }], logs: { h1: { '2026-11-01': 'done' } }, entries: [], started: true, savedAt });
const empty = savedAt => ({ v: 1, goals: [], habits: [], tasks: [], logs: {}, entries: [], started: true, savedAt });
const stored = p => p.evaluate(() => JSON.parse(localStorage.getItem('ascend-proto-v1')));
async function phone(b, local) {
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
  await ctx.route(/fonts\./, r => r.abort()); await ctx.route(/api\.github\.com/, fakeGh);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(U);
  await p.evaluate(s => { localStorage.clear(); localStorage.setItem('ascend-gh-sync-v1', JSON.stringify({ repo: 'ben/data', token: 'tok' })); if (s) localStorage.setItem('ascend-proto-v1', JSON.stringify(s)); }, local);
  await p.reload(); await p.waitForTimeout(900);
  return { ctx, p };
}
(async () => {
  const b = await chromium.launch(); const errs = [];
  // A. Phone is empty (but newer) and GitHub has data: never upload the empty copy.
  {
    GH.file = JSON.stringify(full(1000)); GH.puts = 0;
    const { ctx, p } = await phone(b, empty(Date.now()));
    ok(GH.puts === 0, 'empty phone did not upload over GitHub data');
    ok(JSON.parse(GH.file).goals.length === 1, 'GitHub data is intact');
    await p.click('nav.tabs button[data-tab="more"]'); await p.waitForTimeout(200);
    ok(/didn't upload/.test(await p.innerText('#view')), 'More explains and offers a choice');
    await p.click('[data-act="ghPull"]'); await p.waitForTimeout(500);
    const s = await stored(p);
    ok(s.goals.length === 1 && s.tasks.length === 1 && s.logs.h1['2026-11-01'] === 'done', '"Use GitHub\'s copy" brings the data back');
    await p.waitForTimeout(2000);
    ok(GH.puts === 0 && JSON.parse(GH.file).goals.length === 1, 'GitHub still intact afterwards');
    errs.push(...p.errs); await ctx.close();
  }
  // A2. Same, but the phone had no data at all (storage wiped, settings kept): downloads, never uploads.
  {
    GH.file = JSON.stringify(full(1000)); GH.puts = 0;
    const { ctx, p } = await phone(b, null);
    ok(GH.puts === 0 && (await stored(p))?.goals.length === 1, 'wiped phone downloads GitHub data instead of uploading');
    errs.push(...p.errs); await ctx.close();
  }
  // B. Deliberate "Delete everything" with sync on is allowed to upload.
  {
    GH.file = JSON.stringify(full(1000)); GH.puts = 0;
    const { ctx, p } = await phone(b, full(2000));
    await p.click('nav.tabs button[data-tab="more"]'); await p.click('[data-act="askReset"]'); await p.waitForTimeout(150); await p.click('[data-act="confirmYes"]');
    await p.waitForTimeout(2500);
    ok(JSON.parse(GH.file).goals.length === 0, 'deliberate delete syncs the empty copy: puts=' + GH.puts + ' goals=' + JSON.parse(GH.file).goals.length);
    errs.push(...p.errs); await ctx.close();
  }
  // C. Normal upload still works; D. a newer GitHub copy downloads and keeps a backup first.
  {
    GH.file = JSON.stringify(full(1000)); GH.puts = 0;
    const local = full(5000); local.tasks.push({ id: 't2', title: 'New one', due: null, priority: 2, goalId: null, amount: 0, done: false });
    const { ctx, p } = await phone(b, local);
    ok(GH.puts === 1 && JSON.parse(GH.file).tasks.length === 2, 'newer phone data uploads as before');
    const r = full(Date.now() + 60000); r.tasks[0].title = 'Changed elsewhere'; GH.file = JSON.stringify(r); GH.sha++;
    await p.click('nav.tabs button[data-tab="more"]'); await p.click('[data-act="ghNow"]'); await p.waitForTimeout(800);
    const s = await stored(p);
    ok(s.tasks[0].title === 'Changed elsewhere', 'newer GitHub data downloads as before');
    const bk = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ascend-bak:') && k.endsWith('-before-sync')));
    ok(bk.length === 1, 'download kept an automatic backup first: ' + JSON.stringify(await p.evaluate(() => Object.keys(localStorage))));
    errs.push(...p.errs); await ctx.close();
  }
  ok(errs.length === 0, 'no page errors ' + errs.join(' / '));
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
