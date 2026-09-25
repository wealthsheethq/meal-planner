// Ingredient matching, unit conversion, cost estimates and nutrition.
// Pure: no DOM, no network. Your saved prices always win over the built-in estimates.
import { itemKey, normUnit, convert, unitDim, singular, readPrice } from './core.js';
import { PRICE_DB } from './prices.js';
import { NUTRITION } from './nutrition.js';

const round2 = n => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ *
 * Name clean-up + matching
 * ------------------------------------------------------------------ */

// Words that describe prep or size rather than what you buy.
const DROP = new Set(('chopped diced minced sliced thinly thickly thin thick finely roughly coarsely grated shredded crumbled cubed ' +
  'halved quartered peeled seeded deveined trimmed rinsed drained packed softened melted beaten freshly organic ripe about ' +
  'plus more to taste for serving garnish optional divided room temperature a an the of some few large medium small jumbo ' +
  'extra boneless skinless low sodium reduced lite light unsalted salted unsweetened sweetened plain pure natural homemade ' +
  'prepared good quality best your favorite store bought storebought lightly heaping level scant cut into piece pieces ' +
  'oz ounce ounces lb lbs pound pounds g gram grams kg ml can cans jar jars pkg bag bags box boxes bottle container carton tub ' +
  'x approximately approx roughly firmly loosely well needed').split(' '));

// Count words: "3 garlic cloves" means 3 cloves of garlic, not 3 heads.
const UNIT_WORDS = new Set(['clove', 'stalk', 'rib', 'slice', 'sprig', 'leaf', 'head', 'bunch', 'ear', 'fillet', 'strip', 'link', 'spear', 'sheet', 'block', 'cube', 'envelope', 'wrapper', 'noodle', 'inch', 'knob']);

export function nameWords(name) {
  const s = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/%/g, '% ').replace(/[^a-z0-9%\s]/g, ' ');
  return s.split(/\s+/).filter(w => w && !DROP.has(w) && !/^\d+([./]\d+)?%?$/.test(w)).map(singular);
}

const INDEX = new Map();
for (const e of PRICE_DB) {
  e.key = itemKey(e.n);
  const names = [e.n, ...(e.a ? e.a.split('|') : [])];
  e.keys = [...new Set(names.map(itemKey))];
  for (const n of names) { const k = nameWords(n).join(' '); if (k && !INDEX.has(k)) INDEX.set(k, e); }
}
const INDEX_KEYS = [...INDEX.keys()];

export function lev(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const MATCH_CACHE = new Map();
// Best built-in entry for a name: longest phrase match (rightmost first, so the
// head noun wins), then a typo-tolerant fallback. Returns { entry, hint, fuzzy } or null.
export function matchItem(name) {
  const raw = String(name || '');
  if (MATCH_CACHE.has(raw)) return MATCH_CACHE.get(raw);
  const W = nameWords(raw);
  const find = (words) => {
    for (let len = Math.min(6, words.length); len >= 1; len--) {
      for (let s = words.length - len; s >= 0; s--) {
        const e = INDEX.get(words.slice(s, s + len).join(' '));
        if (e) {
          const rest = W.filter(w => !words.slice(s, s + len).includes(w));
          return { entry: e, hint: rest.find(w => UNIT_WORDS.has(w)) || '', fuzzy: false };
        }
      }
    }
    return null;
  };
  // "tuna in olive oil", "beans with liquid": what you buy comes before "in"/"with".
  const cut = W.findIndex((w, i) => i > 0 && (w === 'in' || w === 'with'));
  let res = INDEX.has(W.join(' ')) ? find(W) : null;
  if (!res && cut > 0) res = find(W.slice(0, cut));
  if (!res) res = find(W);
  if (!res && W.length) {
    const whole = W.join(' ');
    const cands = [whole, ...W.slice().reverse()].filter(w => w.length >= 4);
    outer: for (const w of cands) {
      const max = w.length >= 8 ? 2 : 1;
      let best = null, bestD = max + 1;
      for (const k of INDEX_KEYS) {
        if (Math.abs(k.length - w.length) > max) continue;
        const d = lev(w, k, max);
        if (d < bestD) { best = k; bestD = d; if (d === 1 && max === 1) break; }
      }
      if (best) { res = { entry: INDEX.get(best), hint: '', fuzzy: true }; break outer; }
    }
  }
  if (MATCH_CACHE.size > 5000) MATCH_CACHE.clear();
  MATCH_CACHE.set(raw, res);
  return res;
}

// Do two names refer to the same thing you'd buy? (pantry vs recipe, receipt vs list)
export function sameItem(a, b) {
  const ka = itemKey(a), kb = itemKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ma = matchItem(a), mb = matchItem(b);
  if (ma && mb && ma.entry === mb.entry) return true;
  const wa = nameWords(a).join(' '), wb = nameWords(b).join(' ');
  if (!wa || !wb) return false;
  return (' ' + wb).endsWith(' ' + wa) || (' ' + wa).endsWith(' ' + wb);
}

/* ------------------------------------------------------------------ *
 * Unit conversion between recipe amounts and what a price is "per"
 * ------------------------------------------------------------------ */

const COUNT = { '': 1, dozen: 12 };
const GENERIC = { pinch: 0.35, dash: 0.6, handful: 30, sprig: 1, leaf: 0.5, slice: 25, stick: 113, clove: 5, can: 425, jar: 450, bunch: 100, head: 500, ear: 100, fillet: 170, strip: 20, link: 100, package: 450, bag: 450, box: 450, bottle: 500, cube: 4, envelope: 7, inch: 15, knob: 30, stalk: 40, rib: 40, spear: 20, sheet: 20, block: 400, loaf: 567 };

// Grams in `qty` of `unit` for a built-in entry (or generic sizes when unknown).
export function gramsOf(qty, unit, e) {
  let u = normUnit(unit);
  if (u === 'piece' || u === 'whole') u = '';
  const dim = unitDim(u);
  if (dim === 'weight') return { g: convert(qty, u, 'g'), approx: false };
  if (dim === 'volume') {
    const dens = e && e.c ? e.c / 236.588 : 1;
    return { g: convert(qty, u, 'ml') * dens, approx: !(e && e.c) };
  }
  if (e) {
    if (u === '' && e.g) return { g: qty * e.g, approx: false };
    if (u === 'dozen' && e.g) return { g: qty * 12 * e.g, approx: false };
    if (e.sz && e.sz[u]) return { g: qty * e.sz[u], approx: false };
    if (normUnit(e.u) === u && e.w) return { g: qty * e.w, approx: false };
    if (u === '' && e.w) return { g: qty * e.w, approx: true };
  }
  if (GENERIC[u]) return { g: qty * GENERIC[u], approx: true };
  return null;
}

// How many `to` units are in `qty` `from` units, for this item.
export function amountIn(qty, from, to, e) {
  const f = normUnit(from), t = normUnit(to);
  if (f === t) return { v: qty, approx: false };
  const c = convert(qty, f, t);
  if (c != null) return { v: c, approx: false };
  if (f in COUNT && t in COUNT) return { v: qty * COUNT[f] / COUNT[t], approx: false };
  const gf = gramsOf(qty, f, e), gt = gramsOf(1, t, e);
  if (gf && gt && gt.g > 0) return { v: gf.g / gt.g, approx: gf.approx || gt.approx };
  return null;
}

/* ------------------------------------------------------------------ *
 * Prices: yours first, then the built-in estimate
 * ------------------------------------------------------------------ */

// Build once per render from the doc's prices collection.
export function priceBook(userPrices) {
  const user = {};
  const byEntry = new Map();
  for (const [id, raw] of Object.entries(userPrices || {})) {
    const p = readPrice(raw);
    if (!p) continue;
    user[id] = p;
    const m = matchItem(p.item || id);
    if (!m || m.fuzzy) continue;
    const cur = byEntry.get(m.entry.n);
    if (!cur || (p.updatedAt || 0) > (cur.updatedAt || 0)) byEntry.set(m.entry.n, p);
  }
  return { user, byEntry };
}

// { source: 'user'|'estimate', spec: {p, q, u}, entry, hint, price? } or null
export function priceFor(name, book) {
  const b = book || priceBook(null);
  const m = matchItem(name);
  const up = b.user[itemKey(name)] || (m && !m.fuzzy && b.byEntry.get(m.entry.n)) || null;
  if (up) return { source: 'user', spec: { p: up.price, q: up.qty, u: normUnit(up.unit) }, entry: m && m.entry, hint: m ? m.hint : '', price: up };
  if (m) return { source: 'estimate', spec: { p: m.entry.p, q: m.entry.q, u: normUnit(m.entry.u) }, entry: m.entry, hint: m.hint };
  return null;
}

// Cost of one ingredient/grocery line: { cost, source, approx, trace } or null when unknown.
export function lineEstimate(line, book) {
  const pf = priceFor(line.name || line.item, book);
  if (!pf) return null;
  const { p, q, u } = pf.spec;
  if (line.qty == null || !isFinite(line.qty)) {
    // "Salt, to taste": a pinch of the package, capped.
    return { cost: round2(Math.min(0.25, p * 0.05)), source: pf.source, approx: true, trace: true };
  }
  let lu = normUnit(line.unit);
  if (!lu && pf.hint) lu = pf.hint;
  const a = amountIn(line.qty, lu, u, pf.entry);
  if (a) return { cost: p * a.v / (q > 0 ? q : 1), source: pf.source, approx: a.approx, trace: false };
  return { cost: p, source: pf.source, approx: true, trace: false }; // can't convert: count one package
}

export function recipeCostEst(recipe, book, servings) {
  const base = recipe.servings > 0 ? recipe.servings : 1;
  const want = servings > 0 ? servings : base;
  const f = want / base;
  let total = 0, priced = 0, missing = 0, approx = false, user = 0, estimated = 0;
  for (const i of recipe.ingredients || []) {
    if (!i || !i.item) continue;
    const c = lineEstimate({ name: i.item, qty: i.qty == null ? null : i.qty * f, unit: i.unit }, book);
    if (!c) { missing++; continue; }
    total += c.cost; priced++; approx = approx || c.approx;
    if (c.source === 'user') user++; else estimated++;
  }
  return { total: round2(total), perServing: round2(total / want), priced, missing, approx, user, estimated, servings: want };
}

// Planned meals. Leftover entries have no recipeId, so they cost nothing extra.
export function planCostEst(entries, recipes, book, costOf) {
  let total = 0;
  for (const e of entries) {
    if (!e || e.deleted || !e.recipeId) continue;
    const r = recipes[e.recipeId];
    if (!r || r.deleted) continue;
    total += costOf ? costOf(r, e.servings || r.servings) : recipeCostEst(r, book, e.servings || r.servings).total;
  }
  return round2(total);
}

export function groceryTotalEst(items, book) {
  let total = 0, missing = 0, user = 0, estimated = 0;
  for (const it of items) {
    if (!it || it.deleted || it.have) continue;
    if (it.price != null && isFinite(it.price)) { total += +it.price; user++; continue; }
    const c = lineEstimate({ name: it.name, qty: it.qty == null ? 1 : it.qty, unit: it.unit }, book);
    if (!c) { missing++; continue; }
    total += c.cost;
    if (c.source === 'user') user++; else estimated++;
  }
  return { total: round2(total), missing, user, estimated };
}

// Price per unit, for labels like "$1.29/lb".
export function specLabel(spec) {
  const u = spec.u || 'each';
  return spec.q && spec.q !== 1 ? `${spec.q} ${u}` : u;
}

/* ------------------------------------------------------------------ *
 * Nutrition (approximate)
 * ------------------------------------------------------------------ */

const ZERO = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 });

export function lineNutrition(line) {
  const m = matchItem(line.name || line.item);
  if (!m) return null;
  if (m.entry.x) return { ...ZERO(), nonfood: true };
  const n = NUTRITION[m.entry.n];
  if (!n) return null;
  if (line.qty == null || !isFinite(line.qty)) return ZERO(); // "to taste"
  let u = normUnit(line.unit);
  if (!u && m.hint) u = m.hint;
  const g = gramsOf(line.qty, u, m.entry);
  if (!g) return null;
  const f = g.g / 100;
  return { kcal: n[0] * f, protein: n[1] * f, carbs: n[2] * f, fat: n[3] * f };
}

// Per serving of the recipe as written.
export function recipeNutrition(recipe) {
  const t = ZERO();
  let matched = 0, missing = 0;
  for (const i of recipe.ingredients || []) {
    if (!i || !i.item) continue;
    const n = lineNutrition({ name: i.item, qty: i.qty, unit: i.unit });
    if (!n) { missing++; continue; }
    matched++;
    t.kcal += n.kcal; t.protein += n.protein; t.carbs += n.carbs; t.fat += n.fat;
  }
  const s = recipe.servings > 0 ? recipe.servings : 1;
  return { kcal: Math.round(t.kcal / s), protein: Math.round(t.protein / s), carbs: Math.round(t.carbs / s), fat: Math.round(t.fat / s), matched, missing };
}

// One person's totals for a list of plan entries (one serving of each meal).
// Leftover entries count as a serving of the recipe they came from.
export function dayNutrition(entries, recipes, nutritionOf = recipeNutrition) {
  const t = { ...ZERO(), meals: 0 };
  for (const e of entries) {
    if (!e || e.deleted) continue;
    const r = recipes[e.recipeId || e.leftoverOf];
    if (!r || r.deleted) continue;
    const n = nutritionOf(r);
    t.kcal += n.kcal; t.protein += n.protein; t.carbs += n.carbs; t.fat += n.fat; t.meals++;
  }
  return t;
}
