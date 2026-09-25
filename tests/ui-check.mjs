// Browser smoke test with a mocked Supabase: renders every screen at 375px and
// 1280px, fails on horizontal overflow or console errors, and checks that two
// "phones" see each other's edits live.
//   node tests/ui-check.mjs [--shots <dir>]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const mock = fs.readFileSync(path.join(root, 'tests/mock-supabase.js'), 'utf8');

const browser = await chromium.launch();
const failures = [];
const fail = (m) => { failures.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

async function newContext(viewport) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', deviceScaleFactor: 1, hasTouch: viewport.width < 500 });
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ contentType: 'text/javascript', body: mock }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  // On-device OCR stand-in: the real Tesseract.js is only fetched when you scan.
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/tesseract\.js@/, r => r.fulfill({ contentType: 'text/javascript', body: `window.__tessLoaded = (window.__tessLoaded || 0) + 1;
    window.Tesseract = { createWorker: async (lang, oem, opts) => ({
      recognize: async () => { opts.logger({ status: 'recognizing text', progress: 0.6 }); return { data: { text: 'HARRIS TEETER\\n09/24/2026\\nBANANAS\\n2.14 lb @ 0.59 /lb 1.26 F\\nGV WHL MLK GAL 3.49\\nTOTAL 4.75' } }; },
      terminate: async () => {} }) };` }));
  return ctx;
}
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error') fail(`${label}: console error: ${m.text()}`); });
  page.on('pageerror', e => fail(`${label}: page error: ${e.message}`));
}
async function overflow(page, label) {
  const o = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const wide = [...document.querySelectorAll('body *')].filter(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= w + 1) return false;
      // ignore children of horizontally scrolling strips and hidden/off-screen sheets
      for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') return false; }
      return true;
    }).slice(0, 3).map(el => el.className || el.tagName);
    return { w, sw, wide };
  });
  if (o.sw > o.w) fail(`${label}: horizontal scroll (${o.sw} > ${o.w}) ${o.wide.join(', ')}`);
  else ok(`${label}: no horizontal scroll`);
}
const snap = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }); };
const settle = (page, ms = 450) => page.waitForTimeout(ms);
async function closeSheets(page) { for (let i = 0; i < 4 && await page.locator('.sheet.in').count(); i++) { await page.keyboard.press('Escape'); await settle(page, 380); } }

for (const [vw, vh] of [[375, 812], [1280, 800]]) {
  const L = `${vw}px`;
  console.log(`\n${L}`);
  const ctx = await newContext({ width: vw, height: vh });
  const page = await ctx.newPage();
  watch(page, L);
  await page.addInitScript(() => { window.__MP_NO_SW__ = true; });
  await page.goto(base);
  await page.waitForSelector('.tabbar .tab', { timeout: 10000 });
  await page.waitForFunction(() => window.__mp && Object.keys(window.__mp.doc.recipes).length >= 24, null, { timeout: 10000 });
  ok(`${L}: signed in, 24 starter recipes seeded`);

  // Plan
  await settle(page);
  await overflow(page, `${L} plan`); await snap(page, `${vw}-plan`);
  await page.locator('.add-slot').nth(2).click(); await settle(page);
  await overflow(page, `${L} add-meal sheet`); await snap(page, `${vw}-add-sheet`);
  await page.locator('[data-act="pick-recipe"]').first().click(); await settle(page);
  await page.locator('.add-slot').nth(6).click(); await settle(page);
  await page.locator('[data-act="as-mode"][data-mode="note"]').click(); await settle(page, 150);
  await page.locator('[data-act="as-quick"]').first().click(); await settle(page);
  // add a second recipe dinner via the recipe detail "Add to plan"
  const entries = await page.locator('.entry').count();
  if (entries >= 2) ok(`${L}: added a recipe and a quick note to the plan`); else fail(`${L}: expected 2 plan entries, got ${entries}`);
  await page.locator('.entry').first().click(); await settle(page);
  await overflow(page, `${L} entry sheet`); await snap(page, `${vw}-entry-sheet`);
  await page.locator('[data-act="en-cook"]').nth(1).click(); await settle(page, 200);
  await page.locator('[data-act="en-serv"][data-d="1"]').click(); await settle(page, 200);
  await closeSheets(page);

  // Drag an entry (mouse only on desktop)
  if (vw >= 1000) {
    const src = page.locator('.entry').first();
    const dst = page.locator('.slot[data-slot="lunch"]').nth(4);
    await dst.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, 120)); await settle(page, 200);
    const a = await src.boundingBox(), b = await dst.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + 30, a.y + 30, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up(); await settle(page);
    const moved = await page.locator('.slot[data-slot="lunch"]').nth(4).locator('.entry').count();
    if (moved) ok(`${L}: drag & drop moved a meal`); else fail(`${L}: drag & drop did not move the meal`);
    // drag a recipe from the shelf
    await page.evaluate(() => window.scrollTo(0, 0)); await settle(page, 200);
    const shelf = page.locator('.shelf-item').nth(1), d2 = page.locator('.slot[data-slot="dinner"]').nth(5);
    const c = await shelf.boundingBox(), d = await d2.boundingBox();
    await page.mouse.move(c.x + 20, c.y + 10); await page.mouse.down(); await page.mouse.move(c.x + 40, c.y + 40, { steps: 3 });
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 8 }); await page.mouse.up(); await settle(page);
    if (await page.locator('.slot[data-slot="dinner"]').nth(5).locator('.entry').count()) ok(`${L}: dragged a recipe from the shelf`); else fail(`${L}: shelf drag failed`);
  }

  // Copy last week, week nav
  await page.locator('[data-act="week-prev"]').click(); await settle(page, 250);
  await page.locator('[data-act="week-next"]').click(); await settle(page, 250);

  // Build grocery list
  await page.locator('[data-act="build-list"]').first().click(); await settle(page, 600);
  const gcount = await page.locator('.gitem').count();
  if (gcount > 3) ok(`${L}: grocery list built (${gcount} rows)`); else fail(`${L}: grocery list too short (${gcount})`);
  await overflow(page, `${L} groceries`); await snap(page, `${vw}-groceries`);
  await page.locator('.gitem [data-act="gcheck"].gcheck').first().click(); await settle(page, 200);
  await page.locator('form[data-submit="gadd"] input').fill('2 lb apples'); await page.keyboard.press('Enter'); await settle(page);
  await page.locator('[data-act="gprice"]').first().click(); await settle(page);
  await page.locator('#pr-price').fill('3.49'); await page.locator('[data-act="pr-save"]').click(); await settle(page);
  await page.locator('[data-act="gitem"]').first().click(); await settle(page);
  await overflow(page, `${L} grocery item sheet`); await closeSheets(page);
  await page.locator('[data-act="grocery-menu"]').click(); await settle(page); await closeSheets(page);

  // Recipes
  await page.locator('.tab[data-tab="recipes"]').click(); await settle(page);
  await overflow(page, `${L} recipes`); await snap(page, `${vw}-recipes`);
  await page.locator('[data-input="rq"]').fill('chicken'); await settle(page, 200);
  const hits = await page.locator('.rcard').count();
  if (hits > 0) ok(`${L}: ingredient search found ${hits} recipes`); else fail(`${L}: search found nothing`);
  await page.locator('[data-input="rq"]').fill(''); await settle(page, 150);
  await page.locator('.rcard [data-act="open-recipe"]').first().click(); await settle(page);
  await overflow(page, `${L} recipe detail`); await snap(page, `${vw}-recipe`);
  await page.locator('[data-act="rd-serv"][data-d="1"]').click(); await settle(page, 150);
  await page.locator('[data-act="rd-edit"]').click(); await settle(page);
  await overflow(page, `${L} recipe editor`); await snap(page, `${vw}-editor`);
  // Upload a big, noisy photo: it must be stored as a data URL under 150KB.
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2200;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i % 4 === 3) ? 255 : Math.random() * 255;
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'big.png', { type: 'image/png' }));
    const input = document.querySelector('.sheet [data-change="ed-photo"]'); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('.editor-photo img', { timeout: 15000 }).catch(() => {});
  const size = await page.evaluate(() => { const i = document.querySelector('.editor-photo img'); return i ? i.src.length : 0; });
  if (size > 0 && size <= 150 * 1024) ok(`${L}: photo compressed to ${Math.round(size / 1024)} KB`); else fail(`${L}: photo upload size ${size}`);
  await page.locator('[data-act="ed-save"]').click(); await settle(page, 500);
  if (await page.evaluate(() => Object.values(window.__mp.doc.recipes).some(r => r.photo && r.photo.length <= 150 * 1024))) ok(`${L}: photo saved with the recipe`); else fail(`${L}: photo not saved`);
  await closeSheets(page);
  await page.locator('.rcard [data-act="open-recipe"]').first().click(); await settle(page);
  await page.locator('[data-act="rd-cook"]').click(); await settle(page);
  await overflow(page, `${L} cook mode`); await snap(page, `${vw}-cook`);
  const tb = page.locator('[data-act="ck-timer"]');
  await page.locator('[data-act="ck-next"]').click(); await settle(page, 200);
  if (await tb.count()) await tb.first().click();
  await page.locator('[data-act="ck-tab"][data-t="ing"]').click(); await settle(page, 200);
  await snap(page, `${vw}-cook-ing`);
  await page.locator('[data-act="ck-close"]').click(); await settle(page);
  await closeSheets(page);
  await page.locator('[data-act="paste-recipe"]').click(); await settle(page);
  await page.locator('#paste-text').fill('Easy Pesto Pasta\nServes 2\nIngredients\n8 oz penne\n1/4 cup pesto\nInstructions\n1. Boil pasta 10 minutes.\n2. Toss with pesto.');
  await page.locator('[data-act="pi-parse"]').click(); await settle(page, 600);
  await page.locator('[data-act="ed-save"]').click(); await settle(page, 600);
  if (await page.evaluate(() => Object.values(window.__mp.doc.recipes).some(r => r.title === 'Easy Pesto Pasta' && r.ingredients.length === 2 && r.steps.length === 2))) ok(`${L}: pasted recipe parsed and saved`); else fail(`${L}: pasted recipe not saved correctly`);
  await closeSheets(page);

  // Pantry
  await page.locator('.tab[data-tab="pantry"]').click(); await settle(page);
  await page.locator('[data-act="plow"]').first().click(); await settle(page);
  await overflow(page, `${L} pantry`); await snap(page, `${vw}-pantry`);

  // More + sheets
  await page.locator('.tab[data-tab="more"]').click(); await settle(page);
  await overflow(page, `${L} more`); await snap(page, `${vw}-more`);
  for (const act of ['open-kitchen', 'open-prices', 'open-history', 'open-search', 'open-sections', 'pick']) {
    await page.locator(`[data-act="${act}"]`).first().click(); await settle(page, act === 'pick' ? 1500 : 600);
    await overflow(page, `${L} ${act}`); await snap(page, `${vw}-${act}`);
    await closeSheets(page);
  }
  // Undo toast
  await page.locator('.tab[data-tab="recipes"]').click(); await settle(page);
  const before = await page.evaluate(() => Object.values(window.__mp.doc.recipes).filter(r => !r.deleted).length);
  await page.locator('.rcard [data-act="open-recipe"]').first().click(); await settle(page);
  await page.locator('[data-act="rd-menu"]').click(); await settle(page);
  await page.locator('[data-act="m-del"]').click(); await settle(page, 600);
  await page.locator('.toast button', { hasText: 'Undo' }).last().click(); await settle(page);
  const after = await page.evaluate(() => Object.values(window.__mp.doc.recipes).filter(r => !r.deleted).length);
  if (before === after) ok(`${L}: delete + undo restored the recipe`); else fail(`${L}: undo failed (${before} → ${after})`);

  /* ---------- Round 2 features ---------- */
  const doc = fn => page.evaluate(fn);
  // Costs + nutrition out of the box
  await page.locator('.tab[data-tab="recipes"]').click(); await settle(page);
  const badges = await page.locator('.rcard .badge-soft.green').count();
  const cals = await page.locator('.rcard .badge-soft', { hasText: 'cal' }).count();
  if (badges >= 20 && cals >= 20) ok(`${L}: recipe cards show cost/serving (${badges}) and calories (${cals})`); else fail(`${L}: missing card badges (${badges} cost, ${cals} cal)`);
  await page.locator('[data-act="rtag"][data-tag="Cheap eats"]').click(); await settle(page, 250);
  const cheap = await page.locator('.rcard').count();
  if (cheap > 0 && cheap < 25) ok(`${L}: Cheap eats filter shows ${cheap} recipes`); else fail(`${L}: Cheap eats filter (${cheap})`);
  await page.locator('[data-act="rtag"][data-tag="All"]').click(); await settle(page, 200);
  await page.locator('.rcard [data-act="open-recipe"]').first().click(); await settle(page);
  if (await page.locator('.sheet .nutri-card').count() && await page.locator('.sheet .cost-card .src-tag', { hasText: 'estimate' }).count()) ok(`${L}: recipe page shows estimated cost and approximate nutrition`); else fail(`${L}: recipe page missing cost/nutrition`);
  await closeSheets(page);

  // Import from a link (website), review, save with source credit
  await page.locator('[data-act="paste-recipe"]').click(); await settle(page);
  await overflow(page, `${L} import sheet`); await snap(page, `${vw}-import`);
  await page.locator('#import-url').fill('https://cooking.example.com/chili'); await page.locator('form[data-submit="pi-url"] button').click();
  await page.waitForSelector('.sheet [data-act="ed-save"]', { timeout: 5000 }).catch(() => {}); await settle(page, 500);
  await overflow(page, `${L} imported recipe review`); await snap(page, `${vw}-import-review`);
  await page.locator('[data-act="ed-save"]').click(); await settle(page, 600);
  if (await doc(() => Object.values(window.__mp.doc.recipes).some(r => r.title === 'Best Weeknight Chili' && r.ingredients.length === 4 && r.sourceUrl === 'https://cooking.example.com/chili' && r.author === 'Jane Cook' && /^data:image/.test(r.photo || '')))) ok(`${L}: website import saved with source, credit and photo`); else fail(`${L}: website import not saved correctly`);
  if (await page.locator('.sheet .source-line a[href="https://cooking.example.com/chili"]').count()) ok(`${L}: recipe shows its Source link`); else fail(`${L}: no source link on imported recipe`);
  await closeSheets(page);
  // TikTok with the recipe in the caption, pasted into the Paste box
  await page.locator('[data-act="paste-recipe"]').click(); await settle(page);
  await page.locator('#paste-text').fill('omg try this https://vm.tiktok.com/ZMabc/'); await page.locator('[data-act="pi-parse"]').click();
  await page.waitForSelector('.sheet [data-act="ed-save"]', { timeout: 5000 }).catch(() => {}); await settle(page, 500);
  await page.locator('[data-act="ed-save"]').click(); await settle(page, 600);
  if (await doc(() => Object.values(window.__mp.doc.recipes).some(r => r.title === 'Garlic butter noodles' && r.ingredients.length === 3 && r.steps.length === 2 && /tiktok/.test(r.sourceUrl)))) ok(`${L}: TikTok caption imported from a pasted link`); else fail(`${L}: TikTok caption import failed`);
  await closeSheets(page);
  // TikTok where the recipe is only spoken -> draft
  await page.locator('[data-act="paste-recipe"]').click(); await settle(page);
  await page.locator('#import-url').fill('https://www.tiktok.com/@chefsam/video/2?spoken=1'); await page.locator('form[data-submit="pi-url"] button').click();
  await page.waitForSelector('.sheet .banner', { timeout: 5000 }).catch(() => {}); await settle(page, 400);
  if (await doc(() => Object.values(window.__mp.doc.recipes).some(r => r.draft && r.title === 'Viral feta pasta' && /tiktok/.test(r.sourceUrl)))) ok(`${L}: spoken-only TikTok saved as a draft`); else fail(`${L}: no draft for spoken-only TikTok`);
  await closeSheets(page);
  // Import errors are friendly
  await page.locator('[data-act="paste-recipe"]').click(); await settle(page);
  await page.locator('#import-url').fill('https://broken.example.com/x'); await page.locator('form[data-submit="pi-url"] button').click(); await settle(page, 400);
  if (await page.locator('.toast', { hasText: 'answered with an error' }).count()) ok(`${L}: import error shown`); else fail(`${L}: import error not shown`);
  await closeSheets(page);

  // Auto-plan next week: generate, lock, shuffle, apply
  await page.locator('.tab[data-tab="plan"]').click(); await settle(page);
  await page.locator('[data-act="week-next"]').click(); await settle(page, 250);
  const before2 = await doc(() => Object.values(window.__mp.doc.plan).filter(e => !e.deleted).length);
  await page.locator('[data-act="autoplan"]').first().click(); await settle(page);
  await page.locator('[data-act="ap-n"][data-k="lunch"][data-d="1"]').click(); await page.locator('[data-act="ap-n"][data-k="lunch"][data-d="1"]').click();
  await page.locator('#ap-budget').fill('120');
  await page.locator('[data-act="ap-time"][data-v="45"]').click(); await settle(page, 150);
  await overflow(page, `${L} auto-plan settings`); await snap(page, `${vw}-autoplan`);
  await page.locator('[data-act="ap-go"]').click(); await settle(page);
  const rows = await page.locator('.ap-row').count();
  await overflow(page, `${L} auto-plan result`); await snap(page, `${vw}-autoplan-result`);
  await page.locator('[data-act="ap-lock"]').first().click(); await settle(page, 150);
  await page.locator('[data-act="ap-shuffle"]').last().click(); await settle(page, 200);
  await page.locator('[data-act="ap-go"]').click(); await settle(page, 200);
  const lockedStill = await page.locator('.ap-row.locked').count();
  await page.locator('[data-act="ap-apply"]').click(); await settle(page, 500);
  const after2 = await doc(() => Object.values(window.__mp.doc.plan).filter(e => !e.deleted).length);
  if (rows >= 5 && lockedStill === 1 && after2 - before2 >= 5) ok(`${L}: auto-plan proposed ${rows}, kept the lock, applied ${after2 - before2} meals`); else fail(`${L}: auto-plan (rows ${rows}, locked ${lockedStill}, added ${after2 - before2})`);
  if (await page.locator('.day-cost', { hasText: 'cal' }).count()) ok(`${L}: week view shows daily cost + calories`); else fail(`${L}: no daily cost/calorie strip`);
  await overflow(page, `${L} plan after auto-plan`); await snap(page, `${vw}-plan-autoplanned`);

  // Leftovers: add a 6-serving recipe, accept the offer
  await page.locator('[data-act="week-prev"]').click(); await settle(page, 250);
  await page.evaluate(() => { const S = window.__mp; const r = Object.values(S.doc.recipes).find(x => x.title === 'Weeknight Turkey Chili'); window.__chili = r.id; });
  await page.locator('.add-slot').nth(10).click(); await settle(page);
  await page.locator('[data-input="as-q"]').fill('Turkey Chili'); await settle(page, 150);
  await page.locator('[data-act="pick-recipe"]').first().click(); await settle(page, 300);
  const loBtn = page.locator('.toast button', { hasText: /Leftovers|leftovers/ });
  if (await loBtn.count()) { await loBtn.first().click(); await settle(page, 400); }
  if (await doc(() => Object.values(window.__mp.doc.plan).some(e => !e.deleted && e.leftoverOf === window.__chili && !e.recipeId))) ok(`${L}: leftovers placed into the next open slot`); else fail(`${L}: leftovers not placed`);
  if (await page.locator('.entry.leftover').count()) ok(`${L}: leftovers shown on the plan`); else fail(`${L}: leftover entry not rendered`);
  await page.locator('[data-act="build-list"]').first().click(); await settle(page, 600);

  // Receipts: scan a photo (mocked OCR), review, save
  await page.locator('[data-act="scan-receipt"]').first().click(); await settle(page);
  await overflow(page, `${L} scan receipt`); await snap(page, `${vw}-scan`);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 120; c.getContext('2d').fillRect(0, 0, 10, 10);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'r.png', { type: 'image/png' }));
    const input = document.querySelector('.sheet [data-change="rc-file"]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('.rv-row', { timeout: 8000 }).catch(() => {}); await settle(page);
  await overflow(page, `${L} receipt review`); await snap(page, `${vw}-receipt-review`);
  const rvRows = await page.locator('.rv-row').count();
  await page.locator('[data-act="rv-save"]').click(); await settle(page, 500);
  const saved = await doc(() => ({ trip: Object.values(window.__mp.doc.history).some(h => h.type === 'trip' && h.total === 4.75 && h.date === '2026-09-24'), prices: Object.values(window.__mp.doc.prices).filter(p => p.source === 'receipt' && !p.deleted).length, loaded: window.__tessLoaded || 0 }));
  if (rvRows === 2 && saved.trip && saved.prices === 2 && saved.loaded === 1) ok(`${L}: receipt scanned on-device, 2 prices saved, trip logged`); else fail(`${L}: receipt flow ${JSON.stringify({ rvRows, ...saved })}`);
  // Paste-text path + your price beats the estimate in the list
  await page.locator('[data-act="scan-receipt"]').first().click(); await settle(page);
  await page.locator('#rc-text').fill('KROGER\nOLIVE OIL 16.9OZ 5.00\nTOTAL 5.00'); await page.locator('[data-act="rc-parse"]').click(); await settle(page);
  await page.locator('[data-act="rv-save"]').click(); await settle(page, 500);
  const oil = await doc(() => Object.values(window.__mp.doc.prices).filter(x => /olive oil/i.test(x.item) && !x.deleted).map(x => ({ item: x.item, price: x.price, qty: x.qty, unit: x.unit })));
  if (oil.length === 1 && oil[0].price === 5 && oil[0].qty === 16.9 && oil[0].unit === 'fl oz') ok(`${L}: pasted receipt text saved a price`); else fail(`${L}: pasted receipt price wrong ${JSON.stringify(oil)}`);
  const mine = await page.locator('.price-chip.mine').count(), est = await page.locator('.price-chip.est').count();
  if (mine >= 1 && est >= 3) ok(`${L}: grocery list marks your prices (${mine}) vs estimates (${est})`); else fail(`${L}: price chip labels (${mine} mine, ${est} est)`);
  await overflow(page, `${L} groceries with prices`); await snap(page, `${vw}-groceries-priced`);
  // Spending
  await page.locator('[data-act="open-spending"]').first().click(); await settle(page);
  if (await page.locator('.sheet svg.spend-chart rect.hit').count() === 12) ok(`${L}: spending chart shows 12 weeks`); else fail(`${L}: spending chart missing`);
  await page.locator('[data-act="sp-log"]').click(); await settle(page);
  await page.locator('input[name="total"]').fill('42.10'); await page.locator('form[data-submit="tr-save"] button').click(); await settle(page, 500);
  await overflow(page, `${L} spending`); await snap(page, `${vw}-spending`);
  await closeSheets(page);

  // Pantry: use-by date -> expiring soon -> use it up
  await page.locator('.tab[data-tab="pantry"]').click(); await settle(page);
  await page.locator('form[data-submit="padd"] input').fill('Baby spinach'); await page.keyboard.press('Enter'); await settle(page, 300);
  await page.locator('.pitem button', { hasText: 'Baby spinach' }).first().click(); await settle(page);
  await page.locator('[data-act="pe-exp-set"][data-n="3"]').click();
  await page.locator('[data-act="pe-save"]').click(); await settle(page, 400);
  const exp = await page.locator('.expiring .exp-chip', { hasText: 'Baby spinach' }).count();
  const idea = await page.locator('section', { hasText: 'Use it up' }).locator('.list-item', { hasText: /Uses Baby spinach/ }).count();
  if (exp && idea) ok(`${L}: expiring item listed and "Use it up" suggests ${idea} recipes`); else fail(`${L}: pantry expiry (${exp}) / use it up (${idea})`);
  await overflow(page, `${L} pantry with expiry`); await snap(page, `${vw}-pantry-expiring`);
  await page.locator('[data-act="open-useitup"]').click(); await settle(page);
  await overflow(page, `${L} use it up`); await closeSheets(page);

  // Settings: metric units, hide cost/nutrition, household size
  await page.locator('.tab[data-tab="more"]').click(); await settle(page);
  await page.locator('[data-act="pref-units"][data-v="metric"]').click(); await settle(page, 200);
  await page.locator('[data-act="pref-cost"]').click(); await settle(page, 200);
  await page.locator('[data-act="pref-nutri"]').click(); await settle(page, 200);
  await page.locator('[data-change="pref-hh"]').selectOption('4'); await settle(page, 200);
  await overflow(page, `${L} more (settings)`); await snap(page, `${vw}-settings`);
  await page.locator('.tab[data-tab="recipes"]').click(); await settle(page);
  const hidden = await page.locator('.rcard .rcard-badges').count();
  await page.locator('.rcard', { hasText: 'Weeknight Turkey Chili' }).locator('[data-act="open-recipe"]').click(); await settle(page);
  const metric = await page.locator('.sheet .ing-amt', { hasText: /\bg$/ }).count();
  const noCost = !(await page.locator('.sheet .cost-card').count()) && !(await page.locator('.sheet .nutri-card').count());
  if (hidden === 0 && metric > 0 && noCost) ok(`${L}: metric display and hide cost/nutrition toggles work`); else fail(`${L}: settings (${hidden} badges, ${metric} metric, noCost ${noCost})`);
  await closeSheets(page);
  if (await doc(() => window.__mp.doc.settings.householdSize.value === 4)) ok(`${L}: household size saved`); else fail(`${L}: household size not saved`);
  await page.locator('.tab[data-tab="more"]').click(); await settle(page);
  await page.locator('[data-act="pref-units"][data-v="us"]').click(); await page.locator('[data-act="pref-cost"]').click(); await page.locator('[data-act="pref-nutri"]').click(); await settle(page, 200);

  // Dark mode
  await page.locator('.tab[data-tab="more"]').click(); await settle(page);
  await page.locator('[data-act="theme"][data-v="dark"]').click(); await settle(page);
  await page.locator('.tab[data-tab="plan"]').click(); await settle(page);
  await overflow(page, `${L} plan (dark)`); await snap(page, `${vw}-plan-dark`);
  await page.locator('.tab[data-tab="groceries"]').click(); await settle(page); await snap(page, `${vw}-groceries-dark`);
  await ctx.close();
}

// Two phones, one kitchen: realtime + merge
console.log('\nlive sync');
{
  const ctx = await newContext({ width: 390, height: 844 });
  const a = await ctx.newPage(), b = await ctx.newPage();
  watch(a, 'phone A'); watch(b, 'phone B');
  for (const p of [a, b]) { await p.addInitScript(() => { window.__MP_NO_SW__ = true; }); }
  await a.goto(base);
  await a.waitForFunction(() => window.__mp && Object.keys(window.__mp.doc.recipes).length >= 24);
  await b.goto(base);
  await b.waitForFunction(() => window.__mp && Object.keys(window.__mp.doc.recipes).length >= 24);
  await a.locator('.tab[data-tab="groceries"]').click(); await b.locator('.tab[data-tab="groceries"]').click();
  await a.locator('form[data-submit="gadd"] input').fill('Milk'); await a.keyboard.press('Enter');
  await b.waitForFunction(() => Object.values(window.__mp.doc.grocery).some(g => g.name === 'Milk' && !g.deleted), null, { timeout: 5000 }).then(() => ok('item added on A appears on B')).catch(() => fail('item did not reach B'));
  await b.locator('.gitem', { hasText: 'Milk' }).locator('.gcheck').click();
  // concurrent edits: A renames a recipe while B rates it
  await a.evaluate(() => { const S = window.__mp; });
  await a.waitForFunction(() => Object.values(window.__mp.doc.grocery).some(g => g.name === 'Milk' && g.checked), null, { timeout: 5000 }).then(() => ok('check-off on B appears live on A')).catch(() => fail('check-off did not reach A'));
  await a.locator('.tab[data-tab="recipes"]').click(); await b.locator('.tab[data-tab="recipes"]').click();
  await a.locator('.rcard').first().locator('[data-act="fav"]').click();
  await b.locator('.rcard').nth(1).locator('[data-act="fav"]').click();
  await a.waitForTimeout(2500);
  const favA = await a.evaluate(() => Object.values(window.__mp.doc.recipes).filter(r => r.fav && !r.deleted).length);
  const favB = await b.evaluate(() => Object.values(window.__mp.doc.recipes).filter(r => r.fav && !r.deleted).length);
  const server = await a.evaluate(() => Object.values(JSON.parse(localStorage.getItem('mockdb')).meal_state[0].data.recipes).filter(r => r.fav && !r.deleted).length);
  if (favA === 2 && favB === 2 && server === 2) ok('simultaneous edits on both phones both survive'); else fail(`concurrent edits lost (A:${favA} B:${favB} server:${server})`);
  await ctx.close();
}

// Sharing a link to the installed app opens the import
console.log('\nshare target');
{
  const ctx = await newContext({ width: 390, height: 844 });
  const p = await ctx.newPage();
  watch(p, 'share');
  await p.addInitScript(() => { window.__MP_NO_SW__ = true; });
  await p.goto(base + '?share=1&title=Chili&text=' + encodeURIComponent('Look at this https://cooking.example.com/shared-chili'));
  await p.waitForSelector('.sheet [data-act="ed-save"]', { timeout: 10000 }).then(() => ok('shared link opens the import review')).catch(() => fail('share target did not open the import'));
  if (!/share=/.test(p.url())) ok('share parameters cleaned from the address'); else fail('share params left in URL');
  await ctx.close();
}

// Signed-out + onboarding screens
console.log('\nauth screens');
for (const [vw, vh] of [[375, 812], [1280, 800]]) {
  const ctx = await newContext({ width: vw, height: vh });
  const p = await ctx.newPage();
  watch(p, `auth ${vw}`);
  await p.addInitScript(() => { window.__MP_NO_SW__ = true; localStorage.setItem('mockcfg', JSON.stringify({ signedOut: true })); });
  await p.goto(base); await p.waitForSelector('form[data-submit="signin"]');
  await overflow(p, `${vw}px sign-in`); await snap(p, `${vw}-signin`);
  await p.fill('input[name="email"]', 'nobody@example.com'); await p.click('button[type="submit"]');
  await p.waitForSelector('.auth-msg.err').then(() => ok(`${vw}px friendly message when sign-in is refused`)).catch(() => fail('no sign-in error message'));
  await snap(p, `${vw}-signin-error`);
  await ctx.close();
  const ctx2 = await newContext({ width: vw, height: vh });
  const q = await ctx2.newPage();
  watch(q, `onboarding ${vw}`);
  await q.addInitScript(() => { window.__MP_NO_SW__ = true; localStorage.setItem('mockcfg', JSON.stringify({ noKitchen: true })); });
  await q.goto(base); await q.waitForSelector('form[data-submit="create-kitchen"]');
  await overflow(q, `${vw}px onboarding`); await snap(q, `${vw}-onboarding`);
  await q.click('form[data-submit="create-kitchen"] button');
  await q.waitForFunction(() => window.__mp && Object.keys(window.__mp.doc.recipes).length >= 24, null, { timeout: 8000 }).then(() => ok(`${vw}px onboarding creates a kitchen`)).catch(() => fail('onboarding did not create kitchen'));
  await ctx2.close();
}

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} problem(s)` : '\nAll UI checks passed');
process.exit(failures.length ? 1 : 0);
