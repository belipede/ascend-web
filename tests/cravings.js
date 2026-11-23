// Craving list checks. Run: node tests/cravings.js
// Logging, Let go / Had it, Sat-to-Fri weeks, the Friday summary, and the links to shopping and tasks.
// Runs on a simulated iPhone in Singapore time with a fixed clock.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8795, U = `http://localhost:${PORT}/new.html`;
const srv = http.createServer((q, r) => { if (q.url.split('?')[0] !== '/new.html') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(NEW); }).listen(PORT);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const LS = 'ascend-proto-v1';
const N = d => `2026-11-${String(d).padStart(2, '0')}`, D = d => `2026-12-${String(d).padStart(2, '0')}`;
let n = 0; const C = (day, at, name, cat, got, extra = {}) => ({ id: 'c' + (++n), name, cat, day, at, level: 2, ...(got ? { got } : {}), ...extra });
const list = () => [
  // week Sat 14 – Fri 20: 4
  C(N(14), '15:10', 'Bubble tea', 'drink', 'had'), C(N(16), '22:15', 'Bubble tea', 'drink', 'skip'), C(N(18), '21:45', 'Chocolate', 'sweet', 'skip'), C(N(20), '23:10', 'Chocolate', 'sweet', 'had'),
  // week Sat 21 – Fri 27: 6 (Fri 27 01:30 is late night)
  C(N(21), '14:30', 'Bubble tea', 'drink', 'had'), C(N(22), '10:00', 'Sushi', 'meal', null, { wk: true }),
  C(N(23), '22:45', 'Bubble tea', 'drink', 'skip'), C(N(25), '23:00', 'Chocolate', 'sweet', 'skip'),
  C(N(27), '01:30', 'Chocolate', 'sweet', null), C(N(27), '13:15', 'Gummies', 'sweet', 'skip'),
  // Sat 28 belongs to the next week
  C(N(28), '20:00', 'Mala', 'meal', 'had'),
];
const seed = () => ({ v: 1, started: true, trialStart: N(1), savedAt: 1, opens: {},
  goals: [], habits: [{ id: 'h1', name: 'Walk', days: [], goalId: null, amount: 0, startDay: N(1) }], tasks: [], logs: {}, entries: [],
  shop: { items: [{ id: 'milk', name: 'Fresh milk 1L', cat: 'dairy', price: 315, want: 1 }], trips: [], cart: {}, budget: {}, shopDay: 6 },
  cravings: { list: list() } });
const stored = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), LS);
async function phone(b, when, data, opts = {}) {
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block', timezoneId: 'Asia/Singapore', colorScheme: opts.dark ? 'dark' : 'light' });
  await ctx.route(/fonts\./, r => r.abort());
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.clock.setFixedTime(new Date(when));
  await p.goto(U);
  await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('ascend-ui-v1', JSON.stringify({ swiped: true, checkSeen: 'x', lastExport: Date.now() })); }, [LS, JSON.stringify(data)]);
  await p.reload(); await p.waitForTimeout(350);
  return { ctx, p };
}
const go = async p => { await p.click('nav.tabs button[data-tab="tasks"]'); await p.waitForTimeout(120); await p.click('[data-act="tasksView"][data-id="crave"]'); await p.waitForTimeout(150); };
const view = p => p.innerText('#view');
(async () => {
  const b = await chromium.launch(); const errs = [];
  // 1. Friday evening: Today card, the summary and its numbers.
  {
    const { ctx, p } = await phone(b, '2026-11-27T20:30:00+08:00', seed());
    const t = await view(p);
    ok(/Your craving week: 6, and you let 3 go/.test(t), 'Friday: Today shows the craving week card');
    await p.click('[data-act="goCrave"]'); await p.waitForTimeout(200);
    const v = await view(p);
    ok(/Sat 21 – Fri 27 Nov/.test(v), 'week runs Sat 21 to Fri 27');
    ok(/Your Friday summary/i.test(v) && /6\s*cravings/.test(v), 'summary counts 6 cravings (Sat 28 not included)');
    ok(/2 more than last week/.test(v), 'compares with last week (4)');
    ok(/Let go 3/.test(v) && /Had it 1/.test(v) && /Not decided 2/.test(v), 'let go / had it / not decided split');
    ok(/Most of your cravings came late at night \(3 of 6\)/.test(v), '1:30 am counts as late night');
    ok(/Still wanting it\?/i.test(v) && /Chocolate/.test(v) && /Sushi/.test(v), 'lists what is still wanted');
    // Shopping link
    await p.click('[data-act="craveShop"]'); await p.waitForTimeout(200);
    let s = await stored(p);
    const choc = s.shop.items.find(i => i.name === 'Chocolate');
    ok(choc && choc.want === 1 && choc.cat === 'snacks' && choc.note === 'From your cravings', 'Add to Sat\'s shop puts it on the shopping list');
    ok(/On shop list/.test(await view(p)), 'summary shows it is on the list');
    // Plan a meal
    await p.click('[data-act="cravePlan"]'); await p.waitForTimeout(200);
    s = await stored(p);
    ok(s.tasks.some(x => x.title === 'Have Sushi' && x.due === N(28)), 'Plan it for Sat adds a task for Saturday');
    // Log, mark, undo
    await p.fill('#cq', 'Bubble tea'); await p.click('.cadd .btn'); await p.waitForTimeout(200);
    s = await stored(p); const c = s.cravings.list.at(-1);
    ok(c.name === 'Bubble tea' && c.day === N(27) && c.at === '20:30' && c.cat === 'drink' && c.level === 2, 'quick log saves name, day, time and guessed kind');
    await p.click(`[data-act="craveGot"][data-id="${c.id}"][data-v="skip"]`); await p.waitForTimeout(150);
    ok((await stored(p)).cravings.list.at(-1).got === 'skip', 'Let go is saved');
    await p.click('.toast button'); await p.waitForTimeout(150);
    ok(!('got' in (await stored(p)).cravings.list.at(-1)), 'Undo clears it again');
    // Edit sheet
    await p.click(`[data-act="openForm"][data-form="crave:${c.id}"]`); await p.waitForTimeout(150);
    await p.click('.sheet [data-name="level"][data-id="3"]'); await p.click('.sheet [data-name="got"][data-id="had"]');
    await p.fill('#cr-note', 'after run'); await p.click('.sheet button[type="submit"]'); await p.waitForTimeout(200);
    const e = (await stored(p)).cravings.list.find(x => x.id === c.id);
    ok(e.level === 3 && e.got === 'had' && e.note === 'after run' && e.day === N(27) && e.at === '20:30', 'edit saves strength, outcome and note, keeps day and time');
    // Delete with undo
    await p.click(`[data-act="openForm"][data-form="crave:${c.id}"]`); await p.waitForTimeout(150);
    await p.click('.sheet [data-act="craveDel"]'); await p.waitForTimeout(150);
    ok(!(await stored(p)).cravings.list.some(x => x.id === c.id), 'delete removes it');
    await p.click('.toast button'); await p.waitForTimeout(150);
    ok((await stored(p)).cravings.list.some(x => x.id === c.id), 'Undo brings it back');
    // Previous week
    await p.click('[data-act="craveWeek"][aria-label="Previous week"]'); await p.waitForTimeout(150);
    const pw = await view(p);
    ok(/Last week/i.test(pw) && /Sat 14 – Fri 20 Nov/.test(pw) && /Friday summary/i.test(pw) && /4\s*cravings/.test(pw), 'previous week shows its own summary');
    ok(!(await p.$('#cq')), 'no log box on past weeks');
    errs.push(...p.errs); await ctx.close();
  }
  // 2. Thursday: no Today card, no summary yet, just the log.
  {
    const { ctx, p } = await phone(b, '2026-11-26T09:00:00+08:00', seed());
    ok(!/craving week/i.test(await view(p)), 'Thursday: no craving card on Today');
    await go(p);
    ok(/summary for this week arrives on Friday/.test(await view(p)), 'Thursday: summary not shown yet');
    errs.push(...p.errs); await ctx.close();
  }
  // 3. Sunday across a month boundary: Today shows last week's card; current week is Sat 28 Nov – Fri 4 Dec.
  {
    const { ctx, p } = await phone(b, '2026-11-29T10:00:00+08:00', seed());
    ok(/Last week's cravings: 6/.test(await view(p)), 'Sunday: Today shows last week\'s card');
    await go(p);
    const v = await view(p);
    ok(/Sat 28 Nov – Fri 4 Dec/.test(v) && /1 craving\b/.test(v), 'week across months: Sat 28 Nov – Fri 4 Dec with 1 craving');
    errs.push(...p.errs); await ctx.close();
  }
  // 4. No cravings yet: empty state, logging works from nothing.
  {
    const d = seed(); delete d.cravings;
    const { ctx, p } = await phone(b, D(4) + 'T19:00:00+08:00', d);
    await go(p);
    ok(/Nothing logged this week/.test(await view(p)), 'empty state shows');
    await p.fill('#cq', 'Kaya toast'); await p.click('.cadd .btn'); await p.waitForTimeout(200);
    const s = await stored(p);
    ok(s.cravings.list.length === 1 && s.cravings.list[0].day === D(4), 'first craving creates the section');
    ok(s.shop.items.length === 1 && s.habits.length === 1, 'other data untouched');
    errs.push(...p.errs); await ctx.close();
  }
  // 5. Dark mode renders without errors.
  {
    const { ctx, p } = await phone(b, '2026-11-27T20:30:00+08:00', seed(), { dark: true });
    await go(p);
    ok(/Your Friday summary/i.test(await view(p)), 'dark mode summary renders');
    errs.push(...p.errs); await ctx.close();
  }
  ok(errs.length === 0, 'no page errors ' + errs.join(' / '));
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
