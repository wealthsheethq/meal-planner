// Receipt text (from on-device OCR) -> items, prices and the trip total. Pure.
import { itemKey, normUnit, isoDate } from './core.js';
import { matchItem, sameItem } from './pricing.js';

const round2 = n => Math.round(n * 100) / 100;

// Lines that carry money but aren't groceries.
const SKIP = /\b(sub\s*-?\s*total|total|tax|balance|change|cash|visa|master\s*card|mastercard|amex|discover|debit|credit|card|tend(er)?|payment|paid|savings?|you\s+saved|saved|coupon|discount|promo|member|loyalty|vic|points?|rewards?|deposit|approved|auth|ref\s*#?|acct|account|thank|receipt|store\s*#|tel|phone|items?\s+sold|item\s+count|cashier|register|trans|refund|void|gift\s*card|ebt|snap|fuel|bag\s+fee|bottle\s+dep|price\s+you\s+pay|reg(ular)?\s+price)\b/i;

// Money at the end of a line: "3.49", "$3.49", "3,49", "1.00-", with trailing tax flags ("F", "T", "N", "*").
const PRICE_END = /(-)?\$?\s?(\d{0,4})\s?[.,]\s?(\d{2})\s*(-)?\s*(?:[A-Z*#]{1,2}\b\s*)?$/i;
// "1.23 lb @ 0.59 /lb", "1.23 LB @ $0.59/LB", "0.64 kg @ 2.18/kg"
const WEIGHT = /(\d*[.,]?\d+)\s*(lb|lbs|kg|oz)\b\.?\s*@\s*\$?\s?(\d*[.,]?\d+)\s*\/?\s*(?:lb|lbs|kg|oz)?/i;
// "2 @ 1.99", "2 @ $1.99 ea", "3 for 5.00"? (qty @ unit price)
const MULTI = /(?:^|\s)(\d{1,2})\s*(?:@|x|×)\s*\$?\s?(\d*[.,]\d{2})/i;

const fixOcr = s => String(s || '')
  .replace(/[“”"']/g, '')
  .replace(/(\d)[oO](?=\d|\b)/g, (m, a) => a + '0').replace(/(\d[.,])[oO]/g, (m, a) => a + '0').replace(/(^|[\s$])[oO](?=[.,]\d)/g, (m, a) => a + '0')
  .replace(/\s+/g, ' ').trim();

const toNum = s => parseFloat(String(s).replace(',', '.'));

function readDate(text) {
  let m = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/);
  if (m) {
    let [, mo, d, y] = m.map(Number);
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [mo, d] = [d, mo];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 2000 && y < 2100) return isoDate(new Date(y, mo - 1, d));
  }
  m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// Split a line into { name, amount, negative } or null when it has no money at the end.
export function readLine(raw) {
  const line = fixOcr(raw);
  const m = line.match(PRICE_END);
  if (!m) return null;
  const amount = round2(toNum((m[2] || '0') + '.' + m[3]));
  const negative = !!(m[1] || m[4]);
  let name = line.slice(0, m.index).trim();
  return { line, name, amount, negative };
}

function cleanName(name) {
  return name
    .replace(WEIGHT, ' ').replace(MULTI, ' ')
    .replace(/\b\d{5,}\b/g, ' ')          // UPC / PLU codes
    .replace(/^\s*\d{1,4}\s+(?=[a-z])/i, ' ') // leading item numbers
    .replace(/[^A-Za-z0-9%&/ -]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function parseReceipt(text) {
  const rows = String(text || '').replace(/\r/g, '').split('\n').map(fixOcr).filter(Boolean);
  const out = { store: '', date: readDate(rows.join('\n')), lines: [], subtotal: null, tax: 0, total: null, discounts: 0 };
  for (const r of rows.slice(0, 4)) {
    const letters = (r.match(/[A-Za-z]/g) || []).length;
    if (letters >= 3 && letters / r.length > 0.6 && !PRICE_END.test(r) && !SKIP.test(r)) { out.store = r.replace(/\s{2,}/g, ' ').slice(0, 40); break; }
  }
  let pendingName = '';
  let pending = null; // detail line waiting for its item
  let last = null;
  for (const row of rows) {
    const w = row.match(WEIGHT);
    const mul = w ? null : row.match(MULTI);
    // The unit price in "2 @ 1.99" isn't the line's amount.
    const p = readLine(w ? row.replace(WEIGHT, ' ') : mul ? row.replace(MULTI, ' ') : row);
    const label = p ? p.name : row;
    if (p && SKIP.test(label)) {
      pendingName = '';
      if (/\bsub\s*-?\s*total\b/i.test(label)) out.subtotal = p.amount;
      else if (/\btotal\b|\bbalance\b|\bamount\s+due\b/i.test(label) && !/\bsaved|savings|items?\b/i.test(label)) { if (out.total == null || p.amount > out.total) out.total = p.amount; }
      else if (/\btax\b/i.test(label)) out.tax = round2(out.tax + p.amount);
      else if (p.negative || /coupon|discount|savings|saved/i.test(label)) out.discounts = round2(out.discounts + p.amount);
      continue;
    }
    if (!p) {
      // Weight or "2 @ 1.99" line without its own amount: it belongs to the item
      // above if the math works out, otherwise to the next item.
      if (w || mul) {
        const d = w ? { qty: toNum(w[1]), unit: normUnit(w[2]), unitPrice: toNum(w[3]) } : { qty: +mul[1], unit: '', unitPrice: toNum(mul[2]) };
        if (last && Math.abs(last.amount - d.qty * d.unitPrice) <= 0.02) { Object.assign(last, d); pending = null; }
        else pending = { d, prev: last };
        continue;
      }
      if (!SKIP.test(row) && /[a-z]{2}/i.test(row) && row.length < 40) pendingName = cleanName(row);
      continue;
    }
    if (p.negative) { out.discounts = round2(out.discounts + p.amount); pendingName = ''; continue; }
    let name = cleanName(p.name);
    const detail = {};
    if (w) Object.assign(detail, { qty: toNum(w[1]), unit: normUnit(w[2]), unitPrice: toNum(w[3]) });
    else if (mul) Object.assign(detail, { qty: +mul[1], unit: '', unitPrice: toNum(mul[2]) });
    if ((w || mul) && !/[a-z]{2}/i.test(name)) {
      // "1.23 lb @ 0.59 /lb   0.73": the name was on the line above.
      if (pendingName) name = pendingName;
      else if (last && last.amount == null) { Object.assign(last, detail, { amount: p.amount }); continue; }
      else if (last) { Object.assign(last, detail); continue; }
    }
    pendingName = '';
    if (!/[a-z]{2}/i.test(name)) continue;
    if (pending && !w && !mul) {
      if (Math.abs(p.amount - pending.d.qty * pending.d.unitPrice) <= 0.02 || !pending.prev) Object.assign(detail, pending.d);
      else Object.assign(pending.prev, pending.d);
    }
    pending = null;
    last = { raw: row, name, amount: p.amount, ...detail };
    out.lines.push(last);
  }
  const sum = round2(out.lines.reduce((s, l) => s + (l.amount || 0), 0));
  out.itemsTotal = sum;
  if (out.total == null) out.total = round2((out.subtotal != null ? out.subtotal : sum - out.discounts) + out.tax);
  return out;
}

/* ------------------------------------------------------------------ *
 * Receipt names -> things on your list
 * ------------------------------------------------------------------ */

const ABBR = {
  chkn: 'chicken', chk: 'chicken', ckn: 'chicken', bnls: 'boneless', bnlss: 'boneless', sknls: 'skinless', skls: 'skinless', thgh: 'thigh', thghs: 'thighs', thg: 'thigh',
  brst: 'breast', brs: 'breast', grd: 'ground', gr: 'ground', grnd: 'ground', bf: 'beef', trky: 'turkey', tky: 'turkey', prk: 'pork', saus: 'sausage', ssg: 'sausage',
  bcn: 'bacon', stk: 'steak', slmn: 'salmon', shrmp: 'shrimp', org: '', orgnc: '', whl: 'whole', mlk: 'milk', gal: 'gallon', hlf: 'half',
  chs: 'cheese', chse: 'cheese', shrd: 'shredded', mozz: 'mozzarella', chdr: 'cheddar', ched: 'cheddar', parm: 'parmesan', ygrt: 'yogurt', yog: 'yogurt', yogrt: 'yogurt',
  grk: 'greek', crm: 'cream', sr: 'sour', btr: 'butter', bttr: 'butter', unsltd: 'unsalted', egg: 'egg', eggs: 'eggs', lg: 'large', dz: 'dozen', doz: 'dozen',
  tom: 'tomato', toms: 'tomatoes', tomatos: 'tomatoes', pot: 'potato', pots: 'potatoes', potat: 'potato', russ: 'russet', onn: 'onion', onio: 'onion', onns: 'onions', yel: 'yellow', ylw: 'yellow',
  grn: 'green', rd: 'red', wht: 'white', brwn: 'brown', brn: 'brown', ppr: 'pepper', pepr: 'pepper', bell: 'bell', lettce: 'lettuce', lett: 'lettuce', rom: 'romaine', spin: 'spinach',
  brocc: 'broccoli', broc: 'broccoli', caul: 'cauliflower', cuc: 'cucumber', cuke: 'cucumber', zucc: 'zucchini', mush: 'mushrooms', mshrm: 'mushrooms', avo: 'avocado', avoc: 'avocado',
  ban: 'bananas', bnna: 'bananas', bana: 'bananas', strwb: 'strawberries', straw: 'strawberries', bluebry: 'blueberries', blueb: 'blueberries', rasp: 'raspberries', lem: 'lemon', lemn: 'lemon', lme: 'lime',
  cilan: 'cilantro', cil: 'cilantro', pars: 'parsley', scal: 'scallions', gar: 'garlic', grlc: 'garlic',
  brd: 'bread', tort: 'tortillas', tortl: 'tortillas', flr: 'flour', sgr: 'sugar', ric: 'rice', rce: 'rice', jsmn: 'jasmine', basm: 'basmati',
  pst: 'pasta', spag: 'spaghetti', spagh: 'spaghetti', pnne: 'penne', sce: 'sauce', sauc: 'sauce', mrnra: 'marinara', mar: 'marinara', bns: 'beans', blk: 'black', chkpea: 'chickpeas', garb: 'garbanzo',
  brth: 'broth', stck: 'stock', veg: 'vegetable', vgtbl: 'vegetable', oj: 'orange juice', jce: 'juice', jc: 'juice', cff: 'coffee', cof: 'coffee',
  pb: 'peanut butter', pnt: 'peanut', evoo: 'olive oil', olv: 'olive', vin: 'vinegar', vngr: 'vinegar', mayo: 'mayonnaise', ktchp: 'ketchup', mstrd: 'mustard', hny: 'honey',
  frz: 'frozen', froz: 'frozen', frzn: 'frozen', crn: 'corn', cerl: 'cereal', crkr: 'crackers', chps: 'chips', twl: 'towels', tp: 'toilet paper',
  pk: '', pkg: '', ea: '', ct: '', lb: '', lbs: '', oz: '', fz: '', ga: '', each: '',
};
// Store brands that start receipt lines.
const BRANDS = /^(ht|harris teeter|gv|great value|ks|kirkland|kroger|kro|pl|private selection|simple truth|st|365|wf|whole foods|tj|trader joe'?s|good ?& ?gather|g&g|mkt pantry|market pantry|publix|pbx|food lion|fl|hy-?vee|heb|h-e-b|meijer|signature|sig|o organics|open nature|wegmans|wgmn|aldi|clancy'?s|member'?s mark|mm|sams|sam'?s choice|essential everyday|nature'?s promise|lucerne|store brand|brand)\b\s*/i;

export function expandReceiptName(name) {
  let s = String(name || '').toLowerCase().replace(/[^a-z0-9%&' ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) s = s.replace(BRANDS, '');
  const words = s.split(' ').filter(Boolean).map(w => (w in ABBR ? ABBR[w] : w)).filter(w => w && !/^\d+(ct|pk|oz|lb|g|ml)?$/.test(w));
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

// Best match for a receipt line: something on the current list first, then a
// built-in item. Returns { name, key, entry, source } (name '' when unsure).
export function matchReceiptLine(name, listNames = []) {
  const expanded = expandReceiptName(name);
  if (!expanded) return { name: '', key: '', entry: null, source: 'none' };
  for (const n of listNames) if (sameItem(expanded, n)) return { name: n, key: itemKey(n), entry: (matchItem(n) || {}).entry || null, source: 'list' };
  const m = matchItem(expanded);
  if (m) return { name: m.entry.n.charAt(0).toUpperCase() + m.entry.n.slice(1), key: itemKey(m.entry.n), entry: m.entry, source: m.fuzzy ? 'fuzzy' : 'estimate' };
  const title = expanded.replace(/\b[a-z]/g, c => c.toUpperCase());
  return { name: title, key: itemKey(expanded), entry: null, source: 'none' };
}

// What to save as "your price" for a receipt line: { price, qty, unit }.
export function receiptPriceSpec(line, entry) {
  if (line.unitPrice > 0 && line.unit) return { price: round2(line.unitPrice), qty: 1, unit: normUnit(line.unit) };
  if (line.unitPrice > 0 && line.qty > 1) return { price: round2(line.unitPrice), qty: 1, unit: '' };
  const amount = round2(line.amount || 0);
  if (entry) {
    const u = normUnit(entry.u);
    if (u === 'lb' || u === 'kg') {
      // Sold by weight but the receipt didn't say how much: work it out from the typical price.
      const perUnit = entry.p / (entry.q || 1);
      const w = perUnit > 0 ? Math.max(0.25, Math.round((amount / perUnit) * 4) / 4) : 1;
      return { price: amount, qty: w, unit: u, inferred: true };
    }
    return { price: amount, qty: entry.q || 1, unit: u };
  }
  return { price: amount, qty: 1, unit: '' };
}
