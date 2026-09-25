// Pure logic shared by the app and the tests. No DOM, no network.

/* ------------------------------------------------------------------ *
 * Document + merge
 * ------------------------------------------------------------------ */

export const COLLECTIONS = ['recipes', 'plan', 'grocery', 'pantry', 'prices', 'aisles', 'history', 'settings'];
const META = new Set(['id', 'updatedAt', 'updatedBy', '_f']);
const DAY = 86400000;

export function emptyDoc() {
  const d = { v: 1 };
  for (const c of COLLECTIONS) d[c] = {};
  return d;
}

export function normalizeDoc(doc) {
  const d = doc && typeof doc === 'object' && !Array.isArray(doc) ? { ...doc } : {};
  d.v = 1;
  for (const c of COLLECTIONS) {
    const col = d[c];
    if (Array.isArray(col)) d[c] = Object.fromEntries(col.filter(e => e && e.id).map(e => [e.id, e]));
    else if (!col || typeof col !== 'object') d[c] = {};
  }
  return d;
}

// Time a field was last written. Entities without per-field clocks fall back to updatedAt.
function fieldTime(e, k) {
  if (!e || !(k in e)) return -1;
  return (e._f && e._f[k] != null) ? e._f[k] : (e.updatedAt || 0);
}

// Apply a patch to an entity, stamping every touched field with a clock that is
// always newer than anything this entity has seen (guards against clock skew).
export function stamp(prev, patch, user, now = Date.now()) {
  const t = Math.max(now, (prev && prev.updatedAt || 0) + 1);
  const out = prev ? { ...prev } : {};
  const f = { ...(prev && prev._f || {}) };
  // Give untracked fields of an older entity their original clock before bumping updatedAt.
  if (prev) for (const k of Object.keys(prev)) if (!META.has(k) && f[k] == null) f[k] = prev.updatedAt || 0;
  for (const [k, v] of Object.entries(patch)) {
    if (META.has(k)) continue;
    out[k] = v;
    f[k] = t;
  }
  if (!('deleted' in out)) { out.deleted = false; f.deleted = t; }
  out.id = patch.id != null ? patch.id : prev && prev.id;
  out.updatedAt = t;
  out.updatedBy = user || null;
  out._f = f;
  return out;
}

const stable = v => JSON.stringify(v);

// Field-level last-writer-wins. Commutative, associative and idempotent, so both
// phones converge no matter what order they see each other's edits in.
export function mergeEntity(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (!a._f && !b._f) {
    if ((a.updatedAt || 0) !== (b.updatedAt || 0)) return (a.updatedAt || 0) > (b.updatedAt || 0) ? a : b;
    return stable(a) >= stable(b) ? a : b;
  }
  const out = {};
  const f = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (META.has(k)) continue;
    const ta = fieldTime(a, k), tb = fieldTime(b, k);
    let src;
    if (ta !== tb) src = ta > tb ? a : b;
    else if (!(k in b)) src = a;
    else if (!(k in a)) src = b;
    else src = stable(a[k]) >= stable(b[k]) ? a : b;
    out[k] = src[k];
    f[k] = Math.max(ta, tb);
  }
  out.id = a.id != null ? a.id : b.id;
  const ua = a.updatedAt || 0, ub = b.updatedAt || 0;
  out.updatedAt = Math.max(ua, ub);
  out.updatedBy = ua > ub ? a.updatedBy : ub > ua ? b.updatedBy : ([a.updatedBy || '', b.updatedBy || ''].sort()[1] || null);
  out._f = f;
  return out;
}

export function mergeDocs(a, b) {
  const A = normalizeDoc(a), B = normalizeDoc(b);
  const out = { ...B, ...A, v: 1 };
  for (const c of COLLECTIONS) {
    const col = {};
    const ids = new Set([...Object.keys(A[c]), ...Object.keys(B[c])]);
    for (const id of ids) col[id] = mergeEntity(A[c][id], B[c][id]);
    out[c] = col;
  }
  return out;
}

// True when `local` holds anything `remote` doesn't have yet (so we must write).
export function needsPush(local, remote) {
  const L = normalizeDoc(local), R = normalizeDoc(remote);
  for (const c of COLLECTIONS) {
    for (const [id, e] of Object.entries(L[c])) {
      const r = R[c][id];
      if (!r) return true;
      if ((e.updatedAt || 0) > (r.updatedAt || 0)) return true;
      for (const k of Object.keys(e)) {
        if (META.has(k)) continue;
        if (fieldTime(e, k) > fieldTime(r, k)) return true;
      }
    }
  }
  return false;
}

// Tombstones are kept for a while so an offline phone can't resurrect deleted things.
export function purgeTombstones(doc, now = Date.now(), maxAgeDays = 120) {
  const d = normalizeDoc(doc);
  for (const c of COLLECTIONS) {
    for (const [id, e] of Object.entries(d[c])) {
      if (e && e.deleted && now - (e.updatedAt || 0) > maxAgeDays * DAY) delete d[c][id];
    }
  }
  return d;
}

export const live = col => Object.values(col || {}).filter(e => e && !e.deleted);

/* ------------------------------------------------------------------ *
 * Units
 * ------------------------------------------------------------------ */

const ALIASES = {
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 'tsp.', 'ts'],
  tbsp: ['tbsp', 'tbsps', 'tablespoon', 'tablespoons', 'tbs', 'tbl', 'tbsp.', 'tbs.'],
  cup: ['cup', 'cups', 'c.'],
  'fl oz': ['fl oz', 'fl. oz', 'fl. oz.', 'fl oz.', 'fluid ounce', 'fluid ounces'],
  ml: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
  l: ['l', 'liter', 'liters', 'litre', 'litres'],
  pint: ['pint', 'pints', 'pt'],
  quart: ['quart', 'quarts', 'qt'],
  gallon: ['gallon', 'gallons', 'gal'],
  oz: ['oz', 'oz.', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'lb.', 'lbs.', 'pound', 'pounds'],
  g: ['g', 'gram', 'grams', 'gr'],
  kg: ['kg', 'kgs', 'kilogram', 'kilograms'],
  clove: ['clove', 'cloves'],
  can: ['can', 'cans'],
  pinch: ['pinch', 'pinches'],
  dash: ['dash', 'dashes'],
  slice: ['slice', 'slices'],
  bunch: ['bunch', 'bunches'],
  head: ['head', 'heads'],
  sprig: ['sprig', 'sprigs'],
  stalk: ['stalk', 'stalks'],
  package: ['package', 'packages', 'pkg', 'pkgs', 'packet', 'packets'],
  jar: ['jar', 'jars'],
  bag: ['bag', 'bags'],
  box: ['box', 'boxes'],
  bottle: ['bottle', 'bottles'],
  stick: ['stick', 'sticks'],
  handful: ['handful', 'handfuls'],
  piece: ['piece', 'pieces', 'pc', 'pcs'],
  fillet: ['fillet', 'fillets'],
  ear: ['ear', 'ears'],
  each: ['each', 'ea'],
};
const ALIAS = {};
for (const [u, list] of Object.entries(ALIASES)) for (const a of list) ALIAS[a] = u;

const VOLUME = { tsp: 4.92892, tbsp: 14.7868, cup: 236.588, 'fl oz': 29.5735, pint: 473.176, quart: 946.353, gallon: 3785.41, ml: 1, l: 1000 };
const WEIGHT = { oz: 28.3495, lb: 453.592, g: 1, kg: 1000 };
const METRIC = new Set(['ml', 'l', 'g', 'kg']);

export const UNITS = Object.keys(ALIASES).filter(u => u !== 'each');

export function normUnit(u) {
  if (u == null) return '';
  const raw = String(u).trim();
  if (!raw) return '';
  if (raw === 'T' || raw === 'Tbsp' || raw === 'Tb') return 'tbsp';
  if (raw === 't') return 'tsp';
  const low = raw.toLowerCase();
  if (low === 'each' || low === 'ea') return '';
  return ALIAS[low] || low;
}

export function unitDim(u) {
  const n = normUnit(u);
  if (n in VOLUME) return 'volume';
  if (n in WEIGHT) return 'weight';
  return null;
}

export function convert(qty, from, to) {
  const f = normUnit(from), t = normUnit(to);
  if (f === t) return qty;
  if (f in VOLUME && t in VOLUME) return qty * VOLUME[f] / VOLUME[t];
  if (f in WEIGHT && t in WEIGHT) return qty * WEIGHT[f] / WEIGHT[t];
  return null;
}

const round = (n, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

// Best display unit for a base amount (ml or g) in the requested system.
function bestUnit(dim, base, metric) {
  if (dim === 'volume') {
    if (metric) return base >= 1000 ? ['l', base / 1000] : ['ml', base];
    if (base >= VOLUME.cup / 4 - 0.5) return ['cup', base / VOLUME.cup];
    if (base >= VOLUME.tbsp - 0.05) return ['tbsp', base / VOLUME.tbsp];
    return ['tsp', base / VOLUME.tsp];
  }
  if (metric) return base >= 1000 ? ['kg', base / 1000] : ['g', base];
  return base >= WEIGHT.lb - 0.5 ? ['lb', base / WEIGHT.lb] : ['oz', base / WEIGHT.oz];
}

// Nicer unit for a single scaled quantity (e.g. 6 tsp -> 2 tbsp, 20 oz -> 1.25 lb).
export function tidyQty(qty, unit) {
  const u = normUnit(unit);
  if (qty == null || !isFinite(qty)) return { qty, unit: u };
  if (u === 'tsp' && qty >= 3) return tidyQty(qty / 3, 'tbsp');
  if (u === 'tbsp' && qty >= 4) return { qty: round(qty / 16), unit: 'cup' };
  if (u === 'tbsp' && qty < 1) return { qty: round(qty * 3), unit: 'tsp' };
  if (u === 'cup' && qty < 0.25) return tidyQty(qty * 16, 'tbsp');
  if (u === 'oz' && qty >= 16) return { qty: round(qty / 16), unit: 'lb' };
  if (u === 'g' && qty >= 1000) return { qty: round(qty / 1000), unit: 'kg' };
  if (u === 'ml' && qty >= 1000) return { qty: round(qty / 1000), unit: 'l' };
  return { qty: round(qty), unit: u };
}

/* ------------------------------------------------------------------ *
 * Item names + grocery combining
 * ------------------------------------------------------------------ */

function singular(w) {
  if (w.length <= 3) return w;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (/ves$/.test(w) && !/(olives|chives|cloves)$/.test(w)) return w.slice(0, -3) + 'f';
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

export function itemKey(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9%&\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(fresh|freshly|large|medium|small|extra[- ]large|ripe|whole|boneless|skinless|raw)\s+/g, '');
  const words = s.split(' ').filter(Boolean);
  if (!words.length) return '';
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(' ');
}

const pretty = s => String(s || '').trim().replace(/\s+/g, ' ');

// Combine ingredient lines ({name, qty, unit, ...}) into one grocery line per item,
// converting between compatible units. Incompatible units stay as separate lines.
export function combineLines(lines) {
  const groups = new Map();
  for (const line of lines) {
    const name = pretty(line.name || line.item);
    const key = itemKey(name);
    if (!key) continue;
    const unit = normUnit(line.unit);
    const dim = unitDim(unit);
    const bucket = dim || 'u:' + unit;
    const gk = key + '|' + bucket;
    let g = groups.get(gk);
    if (!g) {
      g = { key, bucket, name, dim, units: new Set(), metric: null, sum: 0, hasQty: false, sources: [] };
      groups.set(gk, g);
    }
    if (line.qty != null && isFinite(line.qty)) {
      g.hasQty = true;
      if (dim) {
        g.sum += convert(line.qty, unit, dim === 'volume' ? 'ml' : 'g');
        if (g.metric === null) g.metric = METRIC.has(unit);
        else if (!METRIC.has(unit)) g.metric = false;
      } else g.sum += line.qty;
    }
    g.units.add(unit);
    if (line.source && !g.sources.includes(line.source)) g.sources.push(line.source);
  }
  const out = [];
  for (const g of groups.values()) {
    let qty = g.hasQty ? g.sum : null;
    let unit = g.bucket.startsWith('u:') ? g.bucket.slice(2) : [...g.units][0];
    if (g.dim && g.hasQty) {
      if (g.units.size === 1) qty = convert(g.sum, g.dim === 'volume' ? 'ml' : 'g', unit);
      else [unit, qty] = bestUnit(g.dim, g.sum, !!g.metric);
    }
    out.push({ key: g.key, bucket: g.bucket, name: g.name, qty: qty == null ? null : round(qty), unit, sources: g.sources });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Quantities: parsing + formatting
 * ------------------------------------------------------------------ */

const FRAC = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6 };
const FRAC_CH = Object.keys(FRAC).join('');
const NUM_RE = new RegExp(`^(?:(\\d+)\\s+(\\d+)\\s*\\/\\s*(\\d+)|(\\d+)\\s*\\/\\s*(\\d+)|(\\d+)?\\s*([${FRAC_CH}])|(\\d*\\.\\d+|\\d+))`);

function readOne(s) {
  const m = s.match(NUM_RE);
  if (!m) return null;
  let v;
  if (m[1]) v = +m[1] + +m[2] / +m[3];
  else if (m[4]) v = +m[4] / +m[5];
  else if (m[7]) v = (m[6] ? +m[6] : 0) + FRAC[m[7]];
  else v = parseFloat(m[8]);
  return { value: v, rest: s.slice(m[0].length) };
}

// Reads a leading quantity like "1 1/2", "1½", "0.5", "2-3" (ranges take the top).
export function readQty(str) {
  const s = String(str || '').replace(/^\s+/, '');
  const first = readOne(s);
  if (!first) return null;
  const range = first.rest.match(/^\s*(?:-|–|—|to)\s*/);
  if (range) {
    const second = readOne(first.rest.slice(range[0].length));
    if (second) return { value: Math.max(first.value, second.value), rest: second.rest.replace(/^\s+/, '') };
  }
  return { value: first.value, rest: first.rest.replace(/^\s+/, '') };
}

export function parseQty(str) {
  const r = readQty(str);
  return r ? r.value : null;
}

const NICE = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];

export function formatQty(n) {
  if (n == null || !isFinite(n)) return '';
  if (n <= 0) return '0';
  let whole = Math.floor(n);
  const frac = n - whole;
  let best = null;
  const tol = whole ? 0.03 : 0.012;
  for (const [v, ch] of NICE) if (Math.abs(frac - v) < tol && (!best || Math.abs(frac - v) < Math.abs(frac - best[0]))) best = [v, ch];
  if (best) {
    if (best[0] === 1) { whole += 1; best = [0, '']; }
    if (!whole && !best[1]) return String(round(n, 2));
    return whole ? (best[1] ? `${whole} ${best[1]}` : String(whole)) : best[1];
  }
  return String(n >= 10 ? Math.round(n * 10) / 10 : round(n, 2));
}

const PLURAL_UNITS = { clove: 'cloves', can: 'cans', slice: 'slices', bunch: 'bunches', head: 'heads', sprig: 'sprigs', stalk: 'stalks', package: 'packages', jar: 'jars', bag: 'bags', box: 'boxes', bottle: 'bottles', stick: 'sticks', handful: 'handfuls', piece: 'pieces', fillet: 'fillets', ear: 'ears', cup: 'cups', pinch: 'pinches', dash: 'dashes', pint: 'pints', quart: 'quarts', gallon: 'gallons' };

export function formatAmount(qty, unit) {
  const u = normUnit(unit);
  const q = formatQty(qty);
  if (!q) return u;
  const label = qty > 1 && PLURAL_UNITS[u] ? PLURAL_UNITS[u] : u;
  return label ? `${q} ${label}` : q;
}

/* ------------------------------------------------------------------ *
 * Ingredient + recipe text parsing
 * ------------------------------------------------------------------ */

const SIZE_RE = /^(extra[- ]large|large|medium|small|heaping|level|scant)\s+/i;
const NOTE_PHRASES = /\b(to taste|for serving|for garnish|optional|divided|as needed|plus more[^,]*|at room temperature|room temperature)\b/i;

export function parseIngredient(line) {
  let s = String(line || '').trim()
    .replace(/^[-*•·▢□☐✓✔]+\s*/, '')
    .replace(/(\d)([½⅓⅔¼¾⅛⅜⅝⅞])/g, '$1 $2')
    .replace(/\s+/g, ' ');
  const notes = [];
  let qty = null;
  const q = readQty(s);
  if (q) { qty = Math.round(q.value * 1000) / 1000; s = q.rest; }
  else {
    const a = s.match(/^(a|an|one)\s+/i);
    if (a) { const after = s.slice(a[0].length).split(/\s+/)[0]; if (ALIAS[after.toLowerCase()] !== undefined || after === 'T') { qty = 1; s = s.slice(a[0].length); } }
  }
  // "1 (15-ounce) can beans" -> keep the can size as a note
  const paren = s.match(/^\(([^)]*)\)\s*/);
  if (paren) { notes.push(paren[1]); s = s.slice(paren[0].length); }
  let unit = '';
  const two = s.match(/^(fl\.?\s*oz\.?|fluid ounces?)\b\.?\s*/i);
  if (two) { unit = 'fl oz'; s = s.slice(two[0].length); }
  else {
    const w = s.match(/^([A-Za-z.]+)\s*/);
    if (w) {
      const word = w[1];
      const cand = word === 'T' || word === 't' ? normUnit(word) : ALIAS[word.toLowerCase()] ?? ALIAS[word.toLowerCase().replace(/\.$/, '')];
      if (cand !== undefined && (qty != null || !/^(can|head|stick|box|bag|bunch|jar|bottle)$/i.test(word) || /^\s*of\b/.test(s.slice(w[0].length)))) {
        // avoid treating a lone word like "l" in an item name as a unit when no qty
        if (qty != null || word.length > 2) { unit = cand; s = s.slice(w[0].length); }
      }
    }
  }
  s = s.replace(/^of\s+/i, '');
  const size = s.match(SIZE_RE);
  if (size) { notes.push(size[1].toLowerCase()); s = s.slice(size[0].length); }
  let item = s, note = '';
  const comma = s.indexOf(',');
  if (comma > -1) { item = s.slice(0, comma); note = s.slice(comma + 1).trim(); }
  item = item.replace(/\(([^)]*)\)/g, (_, inner) => { notes.push(inner.trim()); return ' '; });
  const phrase = item.match(NOTE_PHRASES);
  if (phrase) { notes.push(phrase[1]); item = item.replace(phrase[0], ' '); }
  item = item.replace(/\s+/g, ' ').replace(/\s+(and|or)\s*$/i, '').trim();
  if (note) notes.push(note);
  return { qty, unit, item, note: notes.filter(Boolean).join(', ') };
}

export function parseDuration(str) {
  const s = String(str || '').toLowerCase();
  let total = 0, found = false;
  const re = new RegExp(`(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*\\.?\\d+\\s*[${FRAC_CH}]?|[${FRAC_CH}])\\s*(?:-|–|to)?\\s*(?:\\d+\\s*)?(hours?|hrs?|h\\b|minutes?|mins?|m\\b)`, 'g');
  let m;
  while ((m = re.exec(s))) {
    const v = readQty(m[1]); if (!v) continue;
    found = true;
    total += /^h/.test(m[2]) ? v.value * 60 : v.value;
  }
  return found ? Math.round(total) : null;
}

// Finds timer-able durations in a step ("simmer 10–12 minutes") -> seconds.
export function findTimers(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?|\d+\s+\d\/\d|[½¼¾])(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const a = readQty(m[1]); if (!a) continue;
    const hi = m[2] ? parseFloat(m[2]) : null;
    const unit = m[3].toLowerCase();
    const mult = unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
    // Timers use the low end of a range: better to check early than burn dinner.
    const seconds = Math.round(a.value * mult);
    if (seconds > 0) out.push({ label: m[0].trim(), seconds, max: hi ? Math.round(hi * mult) : null });
  }
  return out;
}

const HEAD_ING = /^(ingredients?|what you'?ll need|you will need|shopping list)\s*:?$/i;
const HEAD_STEPS = /^(directions?|instructions?|method|steps|preparation|how to make( it)?|to make)\s*:?$/i;
const HEAD_NOTES = /^(notes?|tips?|cook'?s notes?)\s*:?$/i;

function looksLikeIngredient(line) {
  const s = line.replace(/^[-*•·▢□☐]+\s*/, '');
  if (readQty(s)) return !/^\d+[.)]\s/.test(s) && s.length < 90;
  if (/^(a|an)\s+(pinch|dash|handful|splash)/i.test(s)) return true;
  return /\b(to taste|for serving|for garnish)\b/i.test(s) && s.length < 60;
}

export function parseRecipeText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim());
  const r = { title: '', servings: null, prepMin: null, cookMin: null, ingredients: [], steps: [], notes: '' };
  let section = null, sawHeaders = false;
  const notes = [];
  for (let raw of lines) {
    if (!raw) continue;
    const line = raw.replace(/\s+/g, ' ');
    if (HEAD_ING.test(line)) { section = 'ing'; sawHeaders = true; continue; }
    if (HEAD_STEPS.test(line)) { section = 'steps'; sawHeaders = true; continue; }
    if (HEAD_NOTES.test(line)) { section = 'notes'; sawHeaders = true; continue; }
    const serv = line.match(/^(serves|servings|yield|yields|makes)\s*:?\s*(?:about\s+)?(\d+)/i);
    if (serv && section !== 'steps') { r.servings = +serv[2]; continue; }
    const prep = line.match(/^prep(?:aration)?(?:\s*time)?\s*:?\s*(.+)$/i);
    if (prep && parseDuration(prep[1]) != null) { r.prepMin = parseDuration(prep[1]); continue; }
    const cook = line.match(/^(?:cook|cooking|bake|baking)(?:\s*time)?\s*:?\s*(.+)$/i);
    if (cook && parseDuration(cook[1]) != null && line.length < 40) { r.cookMin = parseDuration(cook[1]); continue; }
    if (/^total(\s*time)?\s*:?/i.test(line) && parseDuration(line) != null) continue;
    if (section === 'ing') {
      if (/:$/.test(line) && line.length < 40) continue; // "For the sauce:"
      const ing = parseIngredient(line);
      if (ing.item) r.ingredients.push(ing);
      continue;
    }
    if (section === 'steps') {
      if (/^(step\s*)?\d+\s*[.):]?$/i.test(line)) continue;
      const step = line.replace(/^(step\s*\d+\s*[.):-]?\s*|\d+\s*[.)]\s*|[-*•·]\s*)/i, '').trim();
      if (step) r.steps.push(step);
      continue;
    }
    if (section === 'notes') { notes.push(line); continue; }
    // Before any header (or no headers at all)
    if (!r.title && !looksLikeIngredient(line) && line.length < 80 && !r.ingredients.length) { r.title = line.replace(/^#+\s*/, ''); continue; }
    if (!sawHeaders) {
      if (!r.steps.length && looksLikeIngredient(line)) { const ing = parseIngredient(line); if (ing.item) r.ingredients.push(ing); }
      else if (r.ingredients.length || line.length > 40) {
        const step = line.replace(/^(step\s*\d+\s*[.):-]?\s*|\d+\s*[.)]\s*|[-*•·]\s*)/i, '').trim();
        if (step) r.steps.push(step);
      } else notes.push(line);
    } else notes.push(line);
  }
  r.notes = notes.join('\n');
  return r;
}

/* ------------------------------------------------------------------ *
 * Scaling + cost
 * ------------------------------------------------------------------ */

export function scaleIngredients(ings, fromServings, toServings) {
  const f = fromServings > 0 && toServings > 0 ? toServings / fromServings : 1;
  return (ings || []).map(i => {
    if (i.qty == null || f === 1) return { ...i };
    const t = tidyQty(i.qty * f, i.unit);
    return { ...i, qty: t.qty, unit: t.unit };
  });
}

// price: { price, qty, unit } meaning "$price buys qty unit" (unit '' = each).
export function lineCost(line, price) {
  if (!price || !(price.price >= 0)) return null;
  if (line.qty == null || !isFinite(line.qty)) return null;
  const pq = price.qty > 0 ? price.qty : 1;
  const pu = normUnit(price.unit);
  const lu = normUnit(line.unit);
  const amt = convert(line.qty, lu, pu);
  if (amt != null) return { cost: price.price * amt / pq, approx: false };
  // Different kinds of unit (e.g. "1 tsp cumin" vs "$3.49 per jar"): count one package.
  return { cost: price.price, approx: true };
}

export function findPrice(prices, name) {
  const k = itemKey(name);
  const p = prices && prices[k];
  return p && !p.deleted ? p : null;
}

export function recipeCost(recipe, prices, servings) {
  const base = recipe.servings > 0 ? recipe.servings : 1;
  const want = servings > 0 ? servings : base;
  const ings = scaleIngredients(recipe.ingredients, base, want);
  let total = 0, priced = 0, missing = 0, approx = false;
  for (const i of ings) {
    if (!i.item) continue;
    const c = lineCost({ qty: i.qty, unit: i.unit }, findPrice(prices, i.item));
    if (c) { total += c.cost; priced++; approx = approx || c.approx; }
    else missing++;
  }
  return { total: round(total, 2), perServing: round(total / want, 2), priced, missing, approx, servings: want };
}

export function planCost(entries, recipes, prices) {
  let total = 0;
  for (const e of entries) {
    if (e.deleted || !e.recipeId) continue;
    const r = recipes[e.recipeId];
    if (!r || r.deleted) continue;
    total += recipeCost(r, prices, e.servings || r.servings).total;
  }
  return round(total, 2);
}

export function groceryTotal(items, prices) {
  let total = 0, missing = 0;
  for (const it of items) {
    if (it.deleted || it.have) continue;
    const p = it.price != null ? { price: it.price, qty: 1, unit: '' } : findPrice(prices, it.name);
    const c = it.price != null ? { cost: it.price } : lineCost({ qty: it.qty == null ? 1 : it.qty, unit: it.unit }, p);
    if (c) total += c.cost; else missing++;
  }
  return { total: round(total, 2), missing };
}

export function budgetProgress(spent, budget) {
  if (!(budget > 0)) return { pct: 0, over: false, remaining: null };
  return { pct: Math.min(100, round(spent / budget * 100, 1)), over: spent > budget, remaining: round(budget - spent, 2) };
}

export const money = n => (n == null || !isFinite(n)) ? '—' : (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);

/* ------------------------------------------------------------------ *
 * Store sections
 * ------------------------------------------------------------------ */

export const DEFAULT_SECTIONS = ['Produce', 'Bakery', 'Deli', 'Meat & Seafood', 'International', 'Pasta & Grains', 'Canned & Jarred', 'Baking & Spices', 'Condiments & Oils', 'Breakfast & Cereal', 'Snacks', 'Beverages', 'Dairy & Eggs', 'Frozen', 'Household', 'Other'];

const SECTION_WORDS = [
  ['Frozen', /\bfrozen\b|ice cream/],
  ['Baking & Spices', /\b(flour|sugar|baking|yeast|vanilla|cocoa|chocolate chip|cinnamon|cumin|paprika|oregano|thyme|chili powder|chili flake|red pepper flake|curry|turmeric|nutmeg|spice|seasoning|garlic powder|onion powder|salt|peppercorn|black pepper|bay lea|cornstarch|coriander|cayenne|italian seasoning|smoked paprika|garam masala|sesame seed)/],
  ['Produce', /\b(lettuce|spinach|kale|arugula|tomato|onion|shallot|garlic|ginger|potato|carrot|celery|pepper|cucumber|zucchini|squash|broccoli|cauliflower|cabbage|mushroom|avocado|lemon|lime|orange|apple|banana|berr|grape|mango|pineapple|peach|pear|herb|cilantro|parsley|basil|mint|dill|rosemary|scallion|green onion|leek|corn|pea|green bean|asparagus|sweet potato|jalape|radish|beet|eggplant|fruit|salad mix|slaw|chive|bok choy|edamame)/],
  ['Meat & Seafood', /\b(chicken|beef|pork|turkey|sausage|bacon|steak|ground|lamb|shrimp|salmon|fish|cod|tilapia|tuna steak|scallop|chorizo|prosciutto|meatball|thigh|breast)/],
  ['Deli', /\b(deli|ham|salami|pepperoni|rotisserie|hummus|sliced turkey)/],
  ['Dairy & Eggs', /\b(milk|cream|butter|cheese|yogurt|egg|sour cream|parmesan|mozzarella|cheddar|feta|ricotta|half-and-half|half and half|creme fraiche)/],
  ['Bakery', /\b(bread|bun|roll|bagel|tortilla|pita|naan|baguette|croissant|english muffin|ciabatta|brioche)/],
  ['Pasta & Grains', /\b(pasta|spaghetti|penne|rigatoni|noodle|macaroni|orzo|rice|quinoa|couscous|farro|oat|barley|lasagna|linguine|fettuccine|ramen|udon|gnocchi)/],
  ['Canned & Jarred', /\b(canned|can of|beans?|chickpea|lentil|tomato paste|crushed tomato|diced tomato|tomato sauce|marinara|broth|stock|coconut milk|salsa|pesto|olives|tuna|capers|artichoke|roasted red pepper|peanut butter|jam)/],
  ['Condiments & Oils', /\b(oil|vinegar|soy sauce|tamari|mustard|ketchup|mayo|mayonnaise|hot sauce|sriracha|honey|maple syrup|worcestershire|fish sauce|hoisin|dressing|bbq sauce|gochujang|miso|tahini|sesame oil|teriyaki)/],
  ['International', /\b(curry paste|rice paper|nori|wonton|taco shell|enchilada sauce|chipotle)/],
  ['Breakfast & Cereal', /\b(cereal|granola|pancake|syrup|oatmeal)/],
  ['Snacks', /\b(chip|cracker|pretzel|popcorn|nut|almond|walnut|pecan|cashew|peanut|trail mix|raisin|dried)/],
  ['Beverages', /\b(coffee|tea|juice|soda|sparkling|water|wine|beer|kombucha)/],
  ['Household', /\b(paper towel|foil|plastic wrap|parchment|dish soap|detergent|trash bag|napkin|sponge|zip)/],
];

export function guessSection(name) {
  const s = ' ' + String(name || '').toLowerCase() + ' ';
  // Specific overrides that the broad keyword lists would get wrong
  if (/\b(canned|tinned)\b/.test(s)) return 'Canned & Jarred';
  if (/\b(bell pepper|jalapeño|jalapeno|poblano)/.test(s)) return 'Produce';
  if (/\b(black pepper|red pepper flake|peppercorn|cayenne pepper)/.test(s)) return 'Baking & Spices';
  if (/\b(garlic powder|onion powder|ground (cumin|cinnamon|ginger|coriander|turmeric|nutmeg))/.test(s)) return 'Baking & Spices';
  if (/\b(coconut milk|peanut butter|chicken broth|beef broth|vegetable broth|chicken stock)/.test(s)) return 'Canned & Jarred';
  if (/\b(egg noodle)/.test(s)) return 'Pasta & Grains';
  if (/\b(cream of|corn tortilla|flour tortilla)/.test(s)) return /tortilla/.test(s) ? 'Bakery' : 'Canned & Jarred';
  for (const [sec, re] of SECTION_WORDS) if (re.test(s)) return sec;
  return 'Other';
}

/* ------------------------------------------------------------------ *
 * Dates (local, YYYY-MM-DD)
 * ------------------------------------------------------------------ */

export function isoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); }
export function weekStartOf(s, weekStart = 0) {
  const d = parseDate(s);
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return isoDate(d);
}
export function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / DAY); }

export function uid(prefix = '') {
  const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return prefix + r;
}
