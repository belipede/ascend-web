// Shopping list checks: suggestions, in-store ticks, finishing a shop, counting stock, items, budget.
// Run: node tests/shopping.js   (Playwright + Chromium, simulated iPhone, fixed clock in Singapore time)
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8794, U = `http://localhost:${PORT}/new.html`;
const srv = http.createServer((q, r) => { if (q.url.split('?')[0] !== '/new.html') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'text/html' }); r.end(NEW); }).listen(PORT);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const LS = 'ascend-proto-v1';
const N = d => `2026-11-${String(d).padStart(2, '0')}`;
const it = (id, name, cat, price, extra = {}) => ({ id, name, cat, price, ...extra });
const seed = () => ({ v: 1, started: true, trialStart: N(1), savedAt: 1, opens: {},
  goals: [], habits: [{ id: 'h1', name: 'Stretch', days: [], goalId: null, amount: 0, startDay: N(1) }],
  tasks: [{ id: 't1', title: 'Call mum', due: N(20), priority: 2, goalId: null, amount: 0, done: false }], logs: {}, entries: [],
  shop: { shopDay: 6, budget: { week: 7000 }, cart: {}, items: [
    it('milk', 'Fresh milk 1L', 'dairy', 315, { rate: 2, keeps: 7, stock: 1, stockOn: N(18), boughtOn: N(14) }),
    it('yog', 'Greek yoghurt', 'dairy', 520, { rate: 1, keeps: 10, stock: 1, stockOn: N(19), boughtOn: N(14) }),
    it('eggs', 'Eggs (10)', 'dairy', 340, { rate: 0.5, keeps: 28, stock: 1, stockOn: N(14) }),
    it('ban', 'Bananas', 'fruitveg', 250, { rate: 2, keeps: 5, stock: 0, stockOn: N(19) }),
    it('spin', 'Baby spinach', 'fruitveg', 195, { rate: 2, keeps: 4, stock: 0.5, stockOn: N(17) }),
    it('chk', 'Frozen chicken thigh', 'meat', 790, { rate: 1.5, keeps: 60, stock: 0.5, stockOn: N(16) }),
    it('rice', 'Jasmine rice 5kg', 'pantry', 1290, { staple: true, low: true }),
    it('tp', 'Toothpaste', 'care', 450, { staple: true }),
    it('card', 'Birthday card', 'other', 400, { want: 1 }),
  ], trips: [
    { id: 'a', day: N(14), where: 'FairPrice', lines: [{ name: 'Milk', cat: 'dairy', qty: 2, cents: 630 }, { name: 'Chicken', cat: 'meat', qty: 2, cents: 1580 }] },
    { id: 'b', day: N(17), lines: [{ name: 'Snacks', cat: 'snacks', qty: 1, cents: 560 }] },
    { id: 'c', day: '2026-10-31', lines: [{ name: 'Rice', cat: 'pantry', qty: 1, cents: 1290 }] },
  ] } });
const stored = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), LS);
const item = async (p, id) => (await stored(p)).shop.items.find(i => i.id === id);
async function phone(b, when, data = seed(), tz = 'Asia/Singapore') {
  const ctx = await b.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block', timezoneId: tz });
  await ctx.route(/fonts\./, r => r.abort());
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.clock.setFixedTime(new Date(when));
  await p.goto(U);
  await p.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem('ascend-ui-v1', JSON.stringify({ swiped: true, checkSeen: 'x' })); }, [LS, JSON.stringify(data)]);
  await p.reload(); await p.waitForTimeout(400);
  return { ctx, p };
}
const click = async (p, sel) => { await p.click(sel); await p.waitForTimeout(200); };
const view = p => p.innerText('#view');
const FRI = '2026-11-20T18:30:00+08:00';
(async () => {
  const b = await chromium.launch(); const errs = [];
  // 1. Today card and the suggested list.
  {
    const { ctx, p } = await phone(b, FRI);
    const v = await view(p);
    ok(/Shop Sat: 6 items, about \$43/.test(v) && /will run out by then/.test(v), 'Friday: Today shows the weekend shop card');
    await click(p, '[data-act="goShop"]');
    const L = await view(p);
    ok(/Sat, (21 Nov|Nov 21)/.test(L), 'list is for Saturday');
    ok(/Fresh milk 1L ×2/.test(L), 'milk: ½ left, uses 2 a week, suggests 2');
    ok(/Bananas\n/.test(L) && /keeps 5 days, so just 1/.test(L), 'bananas: capped by shelf life to 1');
    ok(/Frozen chicken thigh ×2/.test(L), 'chicken: suggests 2');
    ok(!/Greek yoghurt/.test(L) && !/Eggs/.test(L), 'yoghurt and eggs: enough, not listed');
    ok(/Jasmine rice/.test(L) && /Marked running low/.test(L) && !/Toothpaste/.test(L), 'staples: only the one marked Low is listed');
    ok(/\$49 of your \$70 budget/.test(L), 'weekly budget line adds this week\'s spending and the estimate');
    await p.screenshot({ path: '/tmp/shop-list.png', fullPage: true }).catch(() => {});
    errs.push(...p.errs); await ctx.close();
  }
  // 2. Not shown midweek.
  {
    const { ctx, p } = await phone(b, '2026-11-17T09:00:00+08:00');
    ok(!/Shop Sat/.test(await view(p)), 'Tuesday: no shop card on Today');
    errs.push(...p.errs); await ctx.close();
  }
  // 3. Quick add, tick, finish shop, undo.
  {
    const { ctx, p } = await phone(b, FRI);
    await click(p, '[data-act="goShop"]');
    await p.fill('#sq', 'Toothpaste $4.80 x2'); await p.press('#sq', 'Enter'); await p.waitForTimeout(200);
    let tp = await item(p, 'tp');
    ok(tp.want === 2 && tp.price === 480 && (await stored(p)).shop.items.length === 9, 'quick add reuses an existing item (amount and price updated)');
    await p.fill('#sq', 'Dish soap $2.10'); await p.press('#sq', 'Enter'); await p.waitForTimeout(200);
    const ds = (await stored(p)).shop.items.find(i => i.name === 'Dish soap');
    ok(ds && ds.cat === 'home' && ds.price === 210 && ds.want === 1, 'quick add makes a new item with a guessed category');
    await click(p, '[data-act="shopTick"][data-id="milk"]'); await click(p, '[data-act="shopTick"][data-id="ban"]'); await click(p, '[data-act="shopTick"][data-id="card"]');
    ok(Object.keys((await stored(p)).shop.cart).length === 3, 'ticks are saved (survive closing the app)');
    await p.reload(); await p.waitForTimeout(300); await click(p, '[data-act="goShop"]');
    ok(/In cart: 3 of/.test(await view(p)) && await p.isHidden('#fab'), 'after reopening: cart bar is back, + button hidden');
    await click(p, '.cartbar .btn');
    await p.fill('[name="c-milk"]', '6.00'); await p.fill('#tr-w', 'FairPrice');
    await click(p, '.sheet button[type="submit"]');
    let s = await stored(p);
    const trip = s.shop.trips.at(-1);
    ok(trip.day === N(20) && trip.where === 'FairPrice' && trip.lines.length === 3 && trip.lines.reduce((a, l) => a + l.cents, 0) === 600 + 250 + 400, 'shop saved with the prices you entered');
    const milk = s.shop.items.find(i => i.id === 'milk');
    ok(milk.price === 300 && milk.stock === 2.5 && milk.stockOn === N(20) && milk.boughtOn === N(20), 'milk: new price remembered, stock = ½ left + 2 bought');
    ok(!s.shop.items.find(i => i.id === 'card').want && Object.keys(s.shop.cart).length === 0, 'bought items leave the list, cart cleared');
    const L = await view(p);
    ok(!/Fresh milk/.test(L) && /Frozen chicken/.test(L) && /Dish soap/.test(L), 'unticked items stay on the list');
    await p.click('.toast button'); await p.waitForTimeout(200);
    s = await stored(p);
    ok(s.shop.trips.length === 3 && s.shop.items.find(i => i.id === 'milk').stock === 1 && Object.keys(s.shop.cart).length === 3, 'Undo puts the shop back exactly');
    errs.push(...p.errs); await ctx.close();
  }
  // 4. Count what's left: stock reset and usage rate learned.
  {
    const { ctx, p } = await phone(b, FRI);
    await click(p, '[data-act="goShop"]'); await click(p, '[data-act="shopView"][data-id="stock"]');
    const v = await view(p);
    ok(/Fresh and tracked\s*6/i.test(v) && /Enough/.test(v), 'Stock lists tracked items with what to buy');
    await click(p, '[data-act="openForm"][data-form="count"]');
    await p.fill('[name="n-chk"]', '1');                 // chicken: thought 0, actually 1 left after 4 days from 0.5? -> used less
    await p.fill('[name="n-eggs"]', '0');                // eggs: used 1 in 6 days
    await click(p, '.sheet button[type="submit"]');
    const s = await stored(p), chk = s.shop.items.find(i => i.id === 'chk'), eggs = s.shop.items.find(i => i.id === 'eggs');
    ok(chk.stock === 1 && chk.stockOn === N(20), 'count sets the stock');
    ok(chk.rate === 0.75, 'chicken rate nudged down halfway (1.5 → 0.75): ' + chk.rate);
    ok(eggs.stock === 0 && eggs.rate === 0.75, 'eggs rate nudged up halfway (0.5 and 1.17 seen → 0.75): ' + eggs.rate);
    ok(s.shop.items.find(i => i.id === 'milk').stockOn === N(18), 'items left as they were are untouched');
    errs.push(...p.errs); await ctx.close();
  }
  // 5. New item, edit, skip, staple Low, delete.
  {
    const { ctx, p } = await phone(b, FRI);
    await click(p, '[data-act="goShop"]');
    await click(p, '#fab');
    await p.fill('#it-n', 'Oat milk'); await click(p, '[data-act="pickIn"][data-name="cat"][data-id="dairy"]');
    await p.fill('#it-p', '3.95'); await p.fill('#it-w', '');
    await click(p, '[data-act="pickIn"][data-name="kind"][data-id="track"]');
    ok(await p.isVisible('#it-r'), 'choosing Fresh shows the stock fields');
    await p.fill('#it-r', '1'); await p.fill('#it-kp', '10'); await p.fill('#it-s', '0');
    await click(p, '.sheet button[type="submit"]');
    let oat = (await stored(p)).shop.items.find(i => i.name === 'Oat milk');
    ok(oat && oat.cat === 'dairy' && oat.price === 395 && oat.rate === 1 && oat.keeps === 10 && oat.stock === 0 && oat.stockOn === N(20) && !oat.want, 'tracked item saved');
    ok(/Oat milk/.test(await view(p)) && /suggested/.test(await view(p)), 'new item is suggested straight away');
    await click(p, `[data-form="item:${oat.id}"]`);
    await click(p, '[data-act="shopSkip"]');
    oat = await item(p, oat.id);
    ok(oat.skip === N(21) && !/Oat milk/.test(await view(p)), 'Skip this week hides it from Saturday\'s list');
    await click(p, '[data-act="shopView"][data-id="stock"]');
    await click(p, '[data-act="shopLow"][data-id="tp"][data-v="1"]');
    ok((await item(p, 'tp')).low === true, 'staple marked Low');
    await click(p, '[data-act="shopView"][data-id="list"]');
    ok(/Toothpaste/.test(await view(p)), 'Low staple is on the list');
    await click(p, '[data-form="item:tp"]'); await click(p, '[data-act="askDelItem"]'); await click(p, '[data-act="confirmYes"]');
    ok(!(await item(p, 'tp')), 'item deleted after confirming');
    errs.push(...p.errs); await ctx.close();
  }
  // 6. Spending: week, month, categories, budget, delete a shop.
  {
    const { ctx, p } = await phone(b, FRI);
    await click(p, '[data-act="goShop"]'); await click(p, '[data-act="shopView"][data-id="spend"]');
    let v = await view(p);
    ok(/This week\s*\$5\.60/.test(v) && /November\s*\$27\.70/.test(v), 'this week $5.60, November $27.70 (October not counted)');
    ok(/Meat & fish\s*\$15\.80/.test(v) && !/Pantry/.test(v), 'month by category');
    await click(p, '[data-act="spendPer"][data-id="week"]');
    v = await view(p);
    ok(/Snacks\s*\$5\.60/.test(v) && !/Meat/.test(v), 'week by category');
    await p.fill('#bw', ''); await p.fill('#bm', '250'); await p.selectOption('#sday', '0');
    await click(p, 'form[data-form="shopset"] button[type="submit"]');
    let s = await stored(p);
    ok(!s.shop.budget.week && s.shop.budget.month === 25000 && s.shop.shopDay === 0, 'budget and shop day saved; empty budget removed');
    await click(p, '[data-act="askDelTrip"][data-id="b"]'); await click(p, '[data-act="confirmYes"]');
    s = await stored(p);
    ok(s.shop.trips.length === 2 && !s.shop.trips.some(t => t.id === 'b'), 'shop deleted after confirming');
    await click(p, '[data-act="shopView"][data-id="list"]');
    ok(/Sun, 22 Nov|Sun, Nov 22/.test(await view(p)), 'list follows the new shop day');
    errs.push(...p.errs); await ctx.close();
  }
  // 7. Month boundary: on 1 Dec, November shops don't count.
  {
    const { ctx, p } = await phone(b, '2026-12-01T08:00:00+08:00');
    await click(p, 'nav.tabs button[data-tab="tasks"]'); await click(p, '[data-act="tasksView"][data-id="shop"]'); await click(p, '[data-act="shopView"][data-id="spend"]');
    ok(/December\s*\$0\.00/.test(await view(p)), '1 December: month total starts at $0');
    errs.push(...p.errs); await ctx.close();
  }
  // 8. Days are calendar days in the phone's time zone, also across a clock change (New York, 1 Nov 2026).
  {
    const d = seed(); d.shop.items = [it('m', 'Milk', 'dairy', 300, { rate: 7, stock: 3, stockOn: '2026-10-31' })];
    const { ctx, p } = await phone(b, '2026-11-02T08:00:00-05:00', d, 'America/New_York');
    await click(p, 'nav.tabs button[data-tab="tasks"]'); await click(p, '[data-act="tasksView"][data-id="shop"]'); await click(p, '[data-act="shopView"][data-id="stock"]');
    ok(/About 1 left · 1 day/.test(await view(p)), 'two calendar days used across the clock change (3 − 2 = 1)');
    errs.push(...p.errs); await ctx.close();
  }
  // 9. Empty state, and switching back to To do.
  {
    const d = seed(); delete d.shop;
    const { ctx, p } = await phone(b, FRI, d);
    await click(p, 'nav.tabs button[data-tab="tasks"]'); await click(p, '[data-act="tasksView"][data-id="shop"]');
    ok(/Your list is empty/.test(await view(p)), 'empty shopping list explains what to do');
    ok(!('shop' in await stored(p)), 'opening Shopping alone doesn\'t add data');
    await click(p, '[data-act="tasksView"][data-id="todo"]');
    ok(/Call mum/.test(await view(p)), 'To do still shows tasks');
    errs.push(...p.errs); await ctx.close();
  }
  ok(errs.length === 0, 'no page errors ' + errs.join(' / '));
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
