// Small fixes from the 2026-11-15 evaluation. Run: node tests/polish.js
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8792, U = `http://localhost:${PORT}/new.html`;
const srv = http.createServer((q, r) => { if (q.url.split('?')[0] !== '/new.html') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(NEW); }).listen(PORT);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const stored = p => p.evaluate(() => JSON.parse(localStorage.getItem('ascend-proto-v1')));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
  await ctx.route(/fonts\./, r => r.abort());
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('home')) Object.defineProperty(navigator, 'standalone', { get: () => false }); });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto(U); await p.waitForTimeout(300);
  ok(/You're in Safari/.test(await p.innerText('#view')), 'Safari (not Home Screen) shows the separate-data note');
  await p.click('[data-act="template"]'); await p.waitForTimeout(300);
  let s = await stored(p);
  ok(s.habits[0].goalId === s.goals[0].id, 'template habit is linked to its goal');
  ok(!/Trial day/.test(await p.innerText('#view')), 'no "Trial day" banner');
  ok(/swipe a task left/.test(await p.innerText('#view')), 'swipe tip shown');
  // undated task stays in Today's Done after ticking
  await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('ascend-proto-v1')); d.tasks.push({ id: 'wp1', title: 'Water plants', due: null, priority: 2, goalId: null, amount: 0, done: false }); localStorage.setItem('ascend-proto-v1', JSON.stringify(d)); });
  await p.reload(); await p.waitForTimeout(300);
  s = await stored(p); const wt = s.tasks.find(t => t.title === 'Water plants');
  ok(wt && !wt.due, 'quick-added task has no date');
  await p.click(`[data-act="toggleTask"][data-id="${wt.id}"]`); await p.waitForTimeout(250);
  await p.click('[data-act="toggleDone"]'); await p.waitForTimeout(150);
  ok(/Water plants/.test(await p.innerText('#view')), 'ticked undated task is still in Today\'s Done list');
  // Move to tomorrow without swiping
  const pick = s.tasks.find(t => t.title === 'Pick the next book');
  await p.click('nav.tabs button[data-tab="tasks"]'); await p.waitForTimeout(150);
  await p.click(`[data-act="editTask"].mini[data-id="${pick.id}"]`); await p.waitForTimeout(200);
  await p.click('.sheet [data-act="moveTomorrow"]'); await p.waitForTimeout(250);
  s = await stored(p);
  const tm = (() => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  ok(s.tasks.find(t => t.id === pick.id).due === tm && await p.isHidden('.sheet'), 'Edit sheet has Move to tomorrow, and it works');
  // another window saves: this one picks it up rather than overwriting it
  const p2 = await ctx.newPage(); await p2.goto(U); await p2.waitForTimeout(300);
  await p2.fill('#qa', 'From other window'); await p2.press('#qa', 'Enter'); await p2.waitForTimeout(300);
  await p.waitForTimeout(200);
  await p.click('nav.tabs button[data-tab="today"]'); await p.fill('#qa', 'From first window'); await p.press('#qa', 'Enter'); await p.waitForTimeout(300);
  s = await stored(p);
  ok(s.tasks.some(t => t.title === 'From other window') && s.tasks.some(t => t.title === 'From first window'), 'two windows no longer overwrite each other');
  await p.click('nav.tabs button[data-tab="more"]'); await p.waitForTimeout(150);
  const more = await p.innerText('#view');
  ok(/How often you open Ascend/.test(more) && !/Your trial/.test(more), 'More: trial section renamed');
  ok(/Google Fonts/.test(more), 'About is honest about the font request');
  ok(errs.length === 0, 'no page errors ' + errs.join(' / '));
  await b.close(); srv.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
