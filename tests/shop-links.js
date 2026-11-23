// Shopping list <-> stock links: quick add keeps suggestions, in-store adds, quantities at the till,
// deleting a shop takes its stock back, Ran out, and the Track it suggestion.
// Run: node tests/shop-links.js   (Playwright + Chromium, simulated iPhone, fixed clock in Singapore time)
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const NEW = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8795, U = `http://localhost:${PORT}/new.html`;
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
const SHOTS = process.env.SHOTS;   // folder for proposal screenshots (optional)
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const listLine = async (p, name) => ((await view(p)).match(new RegExp(name + '[^\\n]*')) || [''])[0];
  // 1. Typing an item that's already suggested keeps the suggested amount.
  {
    const { ctx, p } = await phone(b, FRI);
    await click(p, '[data-act="goShop"]');
    ok(/×2/.test(await listLine(p, 'Fresh milk 1L')), 'milk suggested ×2');
    await p.fill('#sq', 'fresh milk 1l'); await p.press('#sq', 'Enter'); await p.waitForTimeout(300);
    ok(/Fresh milk 1L ×2/.test(await listLine(p, 'Fresh milk 1L')) && (await item(p, 'milk')).want === 2, 'typing milk again keeps ×2 (was cut to ×1)');
    await p.fill('#sq', 'Birthday card'); await p.press('#sq', 'Enter'); await p.waitForTimeout(300);
    ok((await item(p, 'card')).want === 2, 'an item you added yourself still adds up (1 + 1)');
    errs.push(...p.errs); await ctx.close();
  }
  // 2. In the shop: extras go into the cart; the till takes quantities; 0 means not bought.
  {
    const { ctx, p } = await phone(b, '2026-11-21T11:00:00+08:00');
    await click(p, '[data-act="goShop"]');
    await click(p, '[data-act="shopTick"][data-id="milk"]');
    await click(p, '[data-act="shopTick"][data-id="ban"]');
    await click(p, '[data-act="shopTick"][data-id="chk"]');
    ok(/something else/.test(await p.getAttribute('#sq', 'placeholder')), 'mid-shop, the add box says extras go in the cart');
    await p.fill('#sq', 'Potato chips $3.20'); await p.press('#sq', 'Enter'); await p.waitForTimeout(300);
    const chips = (await stored(p)).shop.items.find(i => i.name === 'Potato chips');
    ok(chips && (await stored(p)).shop.cart[chips.id] === true, 'an extra added mid-shop is already in the cart');
    await shot(p, '1-in-store');
    await click(p, '[data-act="openForm"][data-form="trip"]');
    ok(await p.$('input[name="q-milk"]') !== null, 'Finish shop has a quantity for each line');
    await p.fill('input[name="q-milk"]', '3');                 // bought 3 instead of 2, price untouched
    await p.click('form[data-form="trip"] [data-act="cntStep"][data-id="-1"] >> nth=1'); // bananas 1 -> 0
    await p.waitForTimeout(100);
    ok(await p.inputValue('input[name="c-milk"]') === '9.45' && await p.inputValue('input[name="c-ban"]') === '0.00', 'prices follow the quantity as you change it');
    await shot(p, '2-finish-shop');
    await click(p, 'form[data-form="trip"] button[type="submit"]');
    const s = await stored(p), tr = s.shop.trips.find(t => t.day === '2026-11-21');
    const milk = s.shop.items.find(i => i.id === 'milk'), ban = s.shop.items.find(i => i.id === 'ban');
    const ml = tr.lines.find(l => l.itemId === 'milk');
    ok(ml.qty === 3 && ml.cents === 945 && ml.added === 3, 'milk: 3 bought, price follows (3 × $3.15), stock +3 recorded');
    ok(milk.stock === 3 && milk.price === 315, 'milk stock is what was left (0) plus 3');
    ok(!tr.lines.some(l => l.itemId === 'ban') && !s.shop.cart.ban && ban.stock === 0, 'bananas set to 0: not in the shop, not in cart, stock unchanged');
    ok(/Bananas/.test(await view(p)), 'bananas stay on the list');
    ok(tr.lines.some(l => l.name === 'Potato chips' && l.cents === 320), 'the extra is in the shop and its spending');
    // 3. Deleting the shop takes its stock back out.
    await click(p, '[data-act="shopView"][data-id="spend"]');
    await click(p, `[data-act="askDelTrip"][data-id="${tr.id}"]`);
    const conf = await p.innerText('[role="alertdialog"]');
    ok(/taken back out/.test(conf) && /Fresh milk 1L/.test(conf), 'delete warning names the stock that comes back out');
    await p.click('[role="alertdialog"] button:has-text("Delete shop")'); await p.waitForTimeout(300);
    const s2 = await stored(p);
    ok(s2.shop.items.find(i => i.id === 'milk').stock === 0 && s2.shop.items.find(i => i.id === 'chk').stock === 0, 'milk and chicken stock back to before the shop');
    ok(!s2.shop.trips.some(t => t.id === tr.id), 'shop removed from spending');
    errs.push(...p.errs); await ctx.close();
  }
  // 4. A count after the shop wins: deleting the shop then leaves stock alone.
  {
    const d = seed(); d.shop.items[0] = { ...d.shop.items[0], stock: 4, stockOn: N(22) };
    d.shop.trips.push({ id: 'z', day: N(21), lines: [{ itemId: 'milk', name: 'Fresh milk 1L', cat: 'dairy', qty: 2, cents: 630, added: 2 }] });
    const { ctx, p } = await phone(b, '2026-11-23T10:00:00+08:00', d);
    await click(p, '[data-act="goShop"]').catch(() => {});
    await p.evaluate(() => {}); await click(p, 'nav.tabs button[data-tab="tasks"]');
    await p.click('button:has-text("Shopping")').catch(() => {}); await p.waitForTimeout(200);
    await click(p, '[data-act="shopView"][data-id="spend"]');
    await click(p, '[data-act="askDelTrip"][data-id="z"]');
    ok(/isn't changed/.test(await p.innerText('[role="alertdialog"]')), 'counted since: warning says stock is not changed');
    await p.click('[role="alertdialog"] button:has-text("Delete shop")'); await p.waitForTimeout(300);
    ok((await item(p, 'milk')).stock === 4, 'counted stock kept');
    errs.push(...p.errs); await ctx.close();
  }
  // 5. Ran out, and the Track it suggestion.
  {
    const d = seed();
    d.shop.items.push(it('bread', 'Wholemeal bread', 'bakery', 280, {}));
    for (const day of [N(2), N(9), N(16)]) d.shop.trips.push({ id: 'br' + day, day, lines: [{ itemId: 'bread', name: 'Wholemeal bread', cat: 'bakery', qty: 1, cents: 280 }] });
    const { ctx, p } = await phone(b, FRI, d);
    await click(p, '[data-act="goShop"]');
    await click(p, '[data-act="shopView"][data-id="stock"]');
    const v = await view(p);
    ok(/You buy Wholemeal bread often/.test(v) && /3 shops in 3 weeks/.test(v) && /about 1 a week/.test(v), 'bread bought 3 weeks running: Track it suggestion with ~1 a week');
    ok(await p.$('[data-act="shopOut"][data-id="yog"]') !== null, 'tracked item with stock has a Ran out button');
    await shot(p, '3-stock-hint');
    await p.evaluate(() => document.querySelector('[data-act="shopOut"][data-id="milk"]').scrollIntoView({ block: 'center' })); await p.waitForTimeout(150);
    await shot(p, '4-stock-ran-out');
    await click(p, '[data-act="shopOut"][data-id="yog"]');
    const y = await item(p, 'yog');
    ok(y.stock === 0 && y.stockOn === N(20), 'Ran out sets stock to 0 today');
    await click(p, '[data-act="shopView"][data-id="list"]');
    ok(/Greek yoghurt/.test(await view(p)), 'yoghurt is now on the list');
    await click(p, '[data-act="shopView"][data-id="stock"]');
    await click(p, '[data-act="shopTrack"][data-id="bread"]');
    const br = await item(p, 'bread');
    ok(br.rate === 1 && await p.$('form[data-form="item"][data-id="bread"]') !== null, 'Track it makes bread tracked and opens it to set what you have');
    await click(p, 'form[data-form="item"] [data-act="closeForm"]');
    errs.push(...p.errs); await ctx.close();
  }
  {
    const d = seed(); d.shop.items.push(it('bread', 'Wholemeal bread', 'bakery', 280, {}));
    for (const day of [N(2), N(9), N(16)]) d.shop.trips.push({ id: 'br' + day, day, lines: [{ itemId: 'bread', name: 'Wholemeal bread', cat: 'bakery', qty: 1, cents: 280 }] });
    const { ctx, p } = await phone(b, FRI, d);
    await click(p, '[data-act="goShop"]'); await click(p, '[data-act="shopView"][data-id="stock"]');
    await click(p, '[data-act="shopNoTrack"][data-id="bread"]');
    ok(!/buy Wholemeal bread often/.test(await view(p)) && (await item(p, 'bread')).noTrack === true, 'No thanks hides it for good');
    errs.push(...p.errs); await ctx.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); srv.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
