// Browser check for the kitchen display (display/) with a mocked Supabase and
// mocked Open-Meteo: 1280x800, 800x1280 and 1920x1080 must never scroll and log
// no console errors; plus live sync from a phone at 375px, cook mode, settings,
// night mode, and the Money HQ panel staying hidden unless readable.
//   node tests/display-check.mjs [--shots <dir>]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { stamp, emptyDoc, isoDate, addDays, itemKey, guessSection } from '../js/core.js';
import { SEED_RECIPES } from '../js/seed.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsIdx = process.argv.indexOf('--shots');
const shots = shotsIdx > -1 ? process.argv[shotsIdx + 1] : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const mock = fs.readFileSync(path.join(root, 'tests/mock-supabase.js'), 'utf8');

/* ---------- A lived-in kitchen ---------- */
const T = isoDate(new Date());
const ME = 'user-me', HER = 'user-her';
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function kitchenDoc() {
  const d = emptyDoc();
  const put = (col, e, by = ME) => { d[col][e.id] = stamp(null, e, by, Date.now() - 60000); };
  for (const r of SEED_RECIPES) put('recipes', { ...r }, 'seed');
  const R = SEED_RECIPES;
  d.recipes[R[0].id] = stamp(d.recipes[R[0].id], { photo: PX }, ME, Date.now() - 50000);
  put('settings', { id: 'seeded', value: true }, 'seed');
  let n = 0;
  const plan = (date, slot, x) => put('plan', { id: 'p' + (n++), date, slot, order: n, servings: 4, cook: '', ...x });
  plan(T, 'breakfast', { recipeId: R[5].id });
  plan(T, 'lunch', { note: 'Eat out' });
  plan(T, 'dinner', { recipeId: R[0].id, cook: HER });
  plan(addDays(T, 1), 'breakfast', { recipeId: R[6].id });
  plan(addDays(T, 1), 'lunch', { note: 'Leftovers', leftoverOf: R[0].id, leftoverFrom: 'p2' });
  plan(addDays(T, 1), 'dinner', { recipeId: R[1].id, cook: 'together' });
  for (let i = 2; i < 7; i++) plan(addDays(T, i), 'dinner', { recipeId: R[i + 1].id });
  const items = ['2 lb apples', 'Bananas', 'Baby spinach', 'Cilantro', 'Limes', 'Red onion', 'Garlic', 'Avocados', 'Sourdough bread', 'Tortillas', 'Chicken thighs', 'Ground turkey', 'Salmon fillets', 'Milk', 'Greek yogurt', 'Eggs', 'Cheddar cheese', 'Butter', 'Black beans', 'Diced tomatoes', 'Chicken broth', 'Coconut milk', 'Rice', 'Penne', 'Olive oil', 'Soy sauce', 'Cumin', 'Paprika', 'Frozen peas', 'Ice cream', 'Paper towels', 'Coffee', 'Sparkling water', 'Granola', 'Almonds', 'Dish soap', 'Parmesan', 'Tomatoes', 'Bell peppers', 'Zucchini', 'Mushrooms', 'Carrots', 'Celery', 'Lemons', 'Ginger'];
  items.forEach((name, i) => put('grocery', { id: 'g' + i, name, key: itemKey(name), qty: i % 3 ? null : 1, unit: '', section: guessSection(name), source: 'manual', checked: false, have: false }));
  put('pantry', { id: 'pa1', name: 'Heavy cream', key: 'heavy cream', expires: addDays(T, 1), low: false });
  put('pantry', { id: 'pa2', name: 'Cilantro', key: 'cilantro', expires: T, low: false });
  put('pantry', { id: 'pa3', name: 'Olive oil', key: 'olive oil', low: true });
  put('pantry', { id: 'pa4', name: 'Rice', key: 'rice', low: true });
  put('countdowns', { id: 'c1', title: 'Beach trip', date: addDays(T, 12), emoji: '🏖️', yearly: false });
  put('countdowns', { id: 'c2', title: "Sam's birthday", date: '1994-' + addDays(T, 1).slice(5), emoji: '🎂', yearly: true });
  put('countdowns', { id: 'c3', title: 'Anniversary', date: '2019-06-15', emoji: '💍', yearly: true });
  put('countdowns', { id: 'c4', title: 'Thanksgiving at Mom’s', date: addDays(T, 58), emoji: '🦃', yearly: false });
  put('notes', { id: 'n1', text: 'Pizza night Friday! 🍕', by: HER, expires: addDays(T, 3), createdAt: 2 });
  put('notes', { id: 'n2', text: 'Dentist at 3pm — back by 5', by: ME, expires: null, createdAt: 1 });
  put('notes', { id: 'n3', text: 'This one expired', by: ME, expires: addDays(T, -1), createdAt: 3 });
  return d;
}
const DB = (extra = {}) => ({
  meal_households: [{ id: 'kitchen-1', name: 'Our Kitchen', created_by: ME, created_at: '2026-09-01T00:00:00Z' }],
  meal_members: [
    { household_id: 'kitchen-1', user_id: ME, email: 'kendall@example.com', role: 'owner', joined_at: '2026-09-01T00:00:00Z' },
    { household_id: 'kitchen-1', user_id: HER, email: 'sam@example.com', role: 'member', joined_at: '2026-09-02T00:00:00Z' },
  ],
  meal_state: [{ household_id: 'kitchen-1', data: kitchenDoc(), updated_at: '2026-09-01T00:00:00.000Z', updated_by: ME }],
  meal_invites: [], ...extra,
});

/* ---------- Open-Meteo stand-in ---------- */
let weatherHits = 0, geoHits = 0;
const weatherJson = () => ({
  current_units: { temperature_2m: '°F' },
  current: { temperature_2m: 71.6, apparent_temperature: 72.4, relative_humidity_2m: 64, weather_code: 2, is_day: 1, wind_speed_10m: 5.8 },
  daily: {
    time: Array.from({ length: 6 }, (_, i) => addDays(T, i)), weather_code: [2, 61, 95, 0, 3, 71],
    temperature_2m_max: [78, 70, 69, 75, 74, 60], temperature_2m_min: [60, 59, 55, 52, 54, 45], precipitation_probability_max: [10, 80, 65, 0, 5, 50],
    sunrise: [T + 'T07:13'], sunset: [T + 'T19:12'],
  },
});

const browser = await chromium.launch();
const failures = [];
const fail = m => { failures.push(m); console.log('  ✗ ' + m); };
const ok = m => console.log('  ✓ ' + m);
const check = (cond, good, bad) => cond ? ok(good) : fail(bad || good);

async function newContext(viewport, { db = DB(), cfg = {} } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', deviceScaleFactor: 1, hasTouch: viewport.width < 500 });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ contentType: 'text/javascript', body: mock }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route(/open-meteo\.com/, r => {
    const u = r.request().url();
    if (/geocoding-api/.test(u)) { geoHits++; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ name: 'Asheville', latitude: 35.6009, longitude: -82.554, admin1_code: 'NC', country_code: 'US' }] }) }); }
    weatherHits++;
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(weatherJson()) });
  });
  await ctx.addInitScript(({ db, cfg }) => {
    window.__MP_NO_SW__ = true;
    if (!localStorage.getItem('mockdb')) localStorage.setItem('mockdb', JSON.stringify(db));
    localStorage.setItem('mockcfg', JSON.stringify(cfg));
    // Display clock: 2pm today unless a test moves it.
    const d = new Date();
    window.__kdOffset = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 14, 0, 0).getTime() - Date.now();
    window.__kdNow = () => Date.now() + window.__kdOffset;
  }, { db, cfg });
  return ctx;
}
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error') fail(`${label}: console error: ${m.text()}`); });
  page.on('pageerror', e => fail(`${label}: page error: ${e.message}`));
}
const snap = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
const settle = (page, ms = 450) => page.waitForTimeout(ms);

// No page scroll, and nothing spilling out of the scene, side column or cards.
async function noScroll(page, label) {
  const r = await page.evaluate(() => {
    const de = document.documentElement;
    const out = [];
    if (de.scrollHeight > innerHeight + 1 || de.scrollWidth > innerWidth + 1 || document.body.scrollHeight > innerHeight + 1) out.push(`page ${de.scrollWidth}x${de.scrollHeight} > ${innerWidth}x${innerHeight}`);
    const vis = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
    for (const el of document.querySelectorAll('.kd-scene.on, .kd-scene.on .kd-card, .kd-scene.on .kd-day, .kd-scene.on .kd-wx, .kd-scene.on .kd-hero, .kd-side, .kd-notes, .kd-cook, .kd-cook-main, .kd-dots, .kd-frame')) {
      if (!vis(el)) continue;
      if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) out.push(`${el.className.split(' ').slice(0, 2).join('.')} ${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight}`);
    }
    for (const el of document.querySelectorAll('.kd-frame > *, .kd-tools')) {
      const b = el.getBoundingClientRect();
      if (vis(el) && b.width && (b.right > innerWidth + 1 || b.bottom > innerHeight + 1 || b.left < -1 || b.top < -1)) out.push(`${el.className} off-screen`);
    }
    return out;
  });
  check(!r.length, `${label}: fits the screen, no scrolling`, `${label}: overflow — ${r.join('; ')}`);
}
const showScene = async (page, id) => { await page.locator(`.kd-dot[data-scene="${id}"]`).click(); await settle(page, 1300); };

/* ---------- Three screen sizes ---------- */
for (const [vw, vh] of [[1280, 800], [800, 1280], [1920, 1080]]) {
  const L = `${vw}x${vh}`;
  console.log(`\n${L}`);
  const ctx = await newContext({ width: vw, height: vh });
  const page = await ctx.newPage();
  watch(page, L);
  await page.goto(base + 'display/');
  await page.waitForSelector('.kd-scene.on', { timeout: 10000 });
  await page.waitForSelector('.kd-wx-days', { timeout: 5000 }).catch(() => {});
  await settle(page, 800);
  check(await page.locator('.kd-wx-day').count() === 5, `${L}: 5-day forecast from Open-Meteo`, `${L}: forecast missing`);
  check(/\d{1,2}:\d{2}/.test(await page.locator('#kd-time').textContent()), `${L}: big clock shows the time`);
  check(/Good afternoon, Kendall & Sam/.test(await page.locator('#kd-greet').textContent()), `${L}: time-of-day greeting with names`, `${L}: greeting was "${await page.locator('#kd-greet').textContent()}"`);
  check(await page.getAttribute('html', 'data-tod') === 'afternoon', `${L}: warm afternoon theme`);
  check(await page.locator('.kd-note').count() === 2, `${L}: 2 active notes on the board (expired one hidden)`, `${L}: notes shown: ${await page.locator('.kd-note').count()}`);

  await showScene(page, 'tonight');
  check(await page.locator('.kd-scene.on .kd-hero h2').textContent() === SEED_RECIPES[0].title, `${L}: tonight's dinner hero`);
  check(await page.locator('.kd-scene.on .kd-hero .kd-hero-img').count() === 1, `${L}: hero shows the recipe photo`);
  check(await page.locator('.kd-scene.on .kd-hero', { hasText: 'Sam is cooking' }).count() === 1, `${L}: who's cooking`);
  check(await page.locator('.kd-scene.on .kd-days .kd-lo', { hasText: 'Leftovers' }).count() >= 1, `${L}: leftovers noted for tomorrow`);
  check(await page.locator('.kd-scene.on .kd-days .kd-card').first().locator('.kd-meal').count() === 3 && await page.locator('.kd-scene.on .kd-days .kd-card').nth(1).locator('.kd-meal').count() === 3, `${L}: today & tomorrow list every planned meal`);
  await noScroll(page, `${L} tonight`); await snap(page, `display-${vw}x${vh}-tonight`);

  await showScene(page, 'groceries');
  const shown = await page.locator('.kd-scene.on .kd-gi').count();
  const more = await page.locator('#kd-groc-more').textContent();
  check(shown >= 8 && (shown === 45 || /more item/.test(more)), `${L}: groceries grouped by section (${shown} shown${/more/.test(more) ? ', ' + more.trim() : ''})`, `${L}: grocery list (${shown}, "${more}")`);
  check(/45/.test(await page.locator('.kd-scene.on .kd-scene-head').textContent()) && /\$\d/.test(await page.locator('.kd-scene.on .kd-scene-head').textContent()), `${L}: item count and estimated total`);
  const box = await page.locator('.kd-scene.on .kd-gi').first().boundingBox();
  check(box.height >= 44, `${L}: grocery touch targets are ${Math.round(box.height)}px tall`);
  await noScroll(page, `${L} groceries`); await snap(page, `display-${vw}x${vh}-groceries`);

  await showScene(page, 'week');
  check(await page.locator('.kd-scene.on .kd-day').count() === 7, `${L}: 7-day week`);
  check(await page.locator('.kd-scene.on .kd-chip.warn').count() === 2 && await page.locator('.kd-scene.on .kd-pantry .kd-chip:not(.warn)').count() === 2, `${L}: pantry use-soon + running low`);
  await noScroll(page, `${L} week`); await snap(page, `display-${vw}x${vh}-week`);

  await showScene(page, 'weather');
  check(await page.locator('.kd-scene.on .kd-cd').count() === 4, `${L}: 4 countdowns`, `${L}: countdowns ${await page.locator('.kd-scene.on .kd-cd').count()}`);
  check(await page.locator('.kd-scene.on .kd-cd', { hasText: "Sam's birthday" }).locator('.kd-cd-when', { hasText: 'Tomorrow' }).count() === 1, `${L}: yearly birthday says Tomorrow`);
  check(/Updated/.test(await page.locator('.kd-wx-foot').textContent()), `${L}: weather shows last-updated time`);
  check(await page.locator('.kd-money-card').count() === 0, `${L}: Money HQ is off by default`);
  await noScroll(page, `${L} weather`); await snap(page, `display-${vw}x${vh}-weather`);

  // Cook mode on the display
  await showScene(page, 'tonight');
  await page.locator('.kd-scene.on [data-act="cook"]').click(); await settle(page);
  check(await page.locator('.kd-cook').count() === 1, `${L}: Start cooking opens cook mode`);
  await noScroll(page, `${L} cook mode`); await snap(page, `display-${vw}x${vh}-cook`);
  await page.locator('.kd-cook [data-act="ck-next"]').click(); await settle(page, 200);
  check(/Step 2/.test(await page.locator('.kd-cook-step').textContent()), `${L}: next step`);
  await page.locator('.kd-cook [data-act="ck-close"]').click(); await settle(page, 200);

  // Settings
  await page.locator('[data-act="gear"]').click(); await settle(page);
  await noScroll(page, `${L} settings`); await snap(page, `display-${vw}x${vh}-settings`);
  await page.locator('.kd-modal [data-act="set-close"]').click(); await settle(page, 200);

  // Night mode
  await page.evaluate(() => { const d = new Date(); window.__kdOffset = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 10).getTime() - Date.now(); });
  await settle(page, 2800);
  check(await page.locator('.kd.is-night').count() === 1 && await page.getAttribute('html', 'data-tod') === 'night', `${L}: night mode at 11pm`);
  check(/Tomorrow's breakfast: .+/.test(await page.locator('.kd-night-bf').textContent()), `${L}: night shows tomorrow's breakfast`);
  await noScroll(page, `${L} night`); await snap(page, `display-${vw}x${vh}-night`);
  await page.locator('#kd-night').click(); await settle(page, 2800);
  check(await page.locator('.kd.is-night').count() === 0, `${L}: a tap wakes the display for a while`);
  await ctx.close();
}

/* ---------- Live sync with a phone, interactions ---------- */
console.log('\nlive: phone (375px) + display');
{
  const ctx = await newContext({ width: 1280, height: 800 });
  const display = await ctx.newPage();
  watch(display, 'display');
  await display.goto(base + 'display/');
  await display.waitForSelector('.kd-scene.on');
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 375, height: 812 });
  watch(phone, 'phone');
  await phone.goto(base);
  await phone.waitForSelector('.tabbar .tab');
  await phone.waitForFunction(() => window.__mp && window.__mp.sync && window.__mp.sync.loaded);

  // Check off on the display -> saved
  await showScene(display, 'groceries');
  const first = display.locator('.kd-scene.on .kd-gi').first();
  const gid = await first.getAttribute('data-id');
  await first.click(); await settle(display, 1500);
  check(await display.evaluate(id => JSON.parse(localStorage.getItem('mockdb')).meal_state[0].data.grocery[id].checked === true, gid), 'tap on the display checks an item off and syncs');
  await phone.waitForFunction(id => window.__mp.doc.grocery[id].checked, gid, { timeout: 5000 }).then(() => ok('phone sees the display check-off live')).catch(() => fail('phone did not see the check-off'));
  // Tapping pins the scene
  check(await display.locator('.kd-pinned').count() === 1, 'tapping pins the scene for 2 minutes');
  // Phone adds an item -> display updates instantly
  await phone.locator('.tab[data-tab="groceries"]').click(); await settle(phone);
  await phone.locator('form[data-submit="gadd"] input').fill('Maple syrup'); await phone.keyboard.press('Enter');
  // (the row itself may be in "+N more" on a long list, so check the data and the count)
  await display.waitForFunction(() => Object.values(window.__kd.doc.grocery).some(g => g.name === 'Maple syrup' && !g.deleted) && /\b45\b/.test(document.querySelector('.kd-scene[data-scene="groceries"] .kd-scene-head').textContent), null, { timeout: 5000 })
    .then(() => ok('item added on the phone appears on the display instantly (realtime)')).catch(() => fail('phone item did not reach the display'));

  // Phone: More -> Kitchen display, Countdowns, Notes
  await phone.locator('.tab[data-tab="more"]').click(); await settle(phone);
  const phoneOverflow = async label => {
    const o = await phone.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    check(o <= 0, `phone ${label}: no horizontal scroll`, `phone ${label}: horizontal scroll by ${o}px`);
  };
  await phoneOverflow('more'); await snap(phone, 'phone-375-more');
  await phone.locator('[data-act="open-display"]').click(); await settle(phone);
  check(await phone.locator('.sheet a[href$="display/"]').count() === 1, 'More → Kitchen display links to /display/');
  await phoneOverflow('kitchen display sheet'); await snap(phone, 'phone-375-display-settings');
  await phone.locator('.sheet [data-act="dp-set"][data-k="rotateSec"][data-v="30"]').click(); await settle(phone, 300);
  await phone.locator('.sheet form[data-submit="dp-geo"] input').fill('Asheville'); await phone.locator('.sheet form[data-submit="dp-geo"] button').click(); await settle(phone, 500);
  await phone.locator('.sheet [data-act="dp-place"]').first().click(); await settle(phone, 300);
  await phone.keyboard.press('Escape'); await settle(phone);
  await display.waitForFunction(() => window.__kd.doc.settings['display.rotateSec'] && window.__kd.doc.settings['display.rotateSec'].value === 30, null, { timeout: 5000 }).then(() => ok('display settings changed on the phone reach the display')).catch(() => fail('display settings did not sync'));
  await display.waitForFunction(() => /Asheville/.test(document.querySelector('.kd-wx-foot') ? document.querySelector('.kd-wx-foot').textContent : ''), null, { timeout: 5000 }).then(() => ok('new weather location refetched')).catch(() => fail('weather location not applied'));

  await phone.locator('[data-act="open-countdowns"]').click(); await settle(phone);
  await phone.locator('.sheet input[name="title"]').fill('Mountain cabin');
  await phone.locator('.sheet input[name="date"]').fill(addDays(T, 3));
  await phone.locator('.sheet [data-act="cd-emoji"][data-v="🏔️"]').click(); await settle(phone, 200);
  check(await phone.locator('.sheet input[name="title"]').inputValue() === 'Mountain cabin', 'countdown form keeps typed text while picking an emoji');
  await phone.locator('.sheet form[data-submit="cd-save"] button[type="submit"]').click(); await settle(phone, 400);
  check(await phone.locator('.sheet .list-item', { hasText: 'Mountain cabin' }).count() === 1, 'countdown added on the phone');
  await phoneOverflow('countdowns sheet'); await snap(phone, 'phone-375-countdowns');
  await phone.keyboard.press('Escape'); await settle(phone);
  await phone.locator('[data-act="open-notes"]').click(); await settle(phone);
  await phone.locator('.sheet textarea[name="text"]').fill('Soup is in the fridge');
  await phone.locator('.sheet [data-act="nt-exp"][data-v="1"]').click(); await settle(phone, 200);
  await phone.locator('.sheet form[data-submit="nt-save"] button[type="submit"]').click(); await settle(phone, 400);
  await phoneOverflow('notes sheet'); await snap(phone, 'phone-375-notes');
  await phone.keyboard.press('Escape'); await settle(phone);
  await display.waitForSelector('.kd-note:has-text("Soup is in the fridge")', { timeout: 5000 }).then(() => ok('note posted on the phone shows on the display')).catch(() => fail('note did not reach the display'));
  await showScene(display, 'weather');
  check(await display.locator('.kd-cd', { hasText: 'Mountain cabin' }).count() === 1, 'countdown added on the phone shows on the display');

  // Money HQ turned on, but this account can't read tracker_state -> stays hidden, no errors
  await display.locator('[data-act="gear"]').click(); await settle(display);
  await display.locator('.kd-modal [data-act="toggle"][data-k="money"]').click(); await settle(display, 800);
  await display.locator('.kd-modal [data-act="set-close"]').click(); await settle(display, 300);
  await showScene(display, 'weather');
  const tr = await display.evaluate(() => window.__mockStats);
  check(tr.tracker >= 1 && !tr.trackerWrites && await display.locator('.kd-money-card').count() === 0, 'Money HQ stays hidden when tracker_state is denied (and is never written)');
  await ctx.close();
}

/* ---------- Money HQ for the account that can read it ---------- */
console.log('\nMoney HQ');
{
  const settingsOn = DB();
  settingsOn.meal_state[0].data.settings['display.money'] = stamp(null, { id: 'display.money', value: true }, ME, Date.now() - 1000);
  const tracker = { user_id: ME, data: { debts: [{ name: 'Card', balance: 1500, originalBalance: 5000, apr: 22.9, minPayment: 100 }, { name: 'Car', balance: 6000, startingBalance: 10000, apr: 5, minPayment: 300 }, { name: 'Old card', balance: 0, originalBalance: 1000, paidOff: true }], extraPayment: 200 } };
  for (const [vw, vh] of [[1280, 800], [800, 1280]]) {
    const ctx = await newContext({ width: vw, height: vh }, { db: settingsOn, cfg: { tracker } });
    const p = await ctx.newPage();
    watch(p, `money ${vw}`);
    await p.goto(base + 'display/');
    await p.waitForSelector('.kd-scene.on');
    await p.waitForSelector('.kd-money-card', { timeout: 5000 }).catch(() => {});
    await showScene(p, 'weather');
    const txt = await p.locator('.kd-money-card').textContent().catch(() => '');
    check(/53\.1%/.test(txt) && /Debt-free by/.test(txt) && !txt.includes('$'), `${vw}x${vh}: Money HQ in privacy mode shows progress, no dollars`, `${vw}x${vh}: Money HQ text "${txt}"`);
    await noScroll(p, `${vw}x${vh} weather + Money HQ`); await snap(p, `display-${vw}x${vh}-money`);
    if (vw === 1280) {
      await p.locator('[data-act="gear"]').click(); await settle(p);
      await p.locator('.kd-modal [data-act="toggle"][data-k="moneyPrivacy"]').click(); await settle(p, 400);
      await p.locator('.kd-modal [data-act="set-close"]').click(); await settle(p, 300);
      check(/\$7,500 left of \$16,000/.test(await p.locator('.kd-money-card').textContent()), 'privacy mode off shows totals');
      check(!(await p.evaluate(() => window.__mockStats.trackerWrites)), 'tracker_state was only ever read');
    }
    await ctx.close();
  }
}

/* ---------- Signed out ---------- */
console.log('\nsign-in');
{
  const ctx = await newContext({ width: 1280, height: 800 }, { cfg: { signedOut: true } });
  const p = await ctx.newPage();
  watch(p, 'display sign-in');
  await p.goto(base + 'display/');
  await p.waitForSelector('form[data-submit="signin"]');
  await noScroll(p, 'sign-in'); await snap(p, 'display-signin');
  await p.fill('input[name="email"]', 'kendall@example.com'); await p.click('button[type="submit"]');
  await p.waitForSelector('text=Check your inbox').then(() => ok('magic link requested from the display')).catch(() => fail('no confirmation after requesting a link'));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} problem(s)` : '\nAll display checks passed');
process.exit(failures.length ? 1 : 0);
