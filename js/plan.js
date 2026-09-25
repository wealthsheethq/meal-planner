// Auto-plan, leftovers and "use it up". Pure: no DOM, no network.
import { addDays, parseDate, daysBetween, itemKey } from './core.js';
import { matchItem, sameItem } from './pricing.js';

export const PLAN_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_TAGS = PLAN_SLOTS;
const round2 = n => Math.round(n * 100) / 100;
const lower = a => (a || []).map(t => String(t).toLowerCase());
const totalMin = r => (r.prepMin || 0) + (r.cookMin || 0);
const slotKey = (date, slot) => date + '|' + slot;

// Weeknights are Monday–Friday.
export const isWeeknight = date => { const d = parseDate(date).getDay(); return d >= 1 && d <= 5; };

// Does a recipe belong in this kind of slot? Untagged recipes are main meals.
export function fitsSlot(r, slot) {
  const meal = lower(r.tags).filter(t => MEAL_TAGS.includes(t));
  if (!meal.length) return slot === 'dinner' || slot === 'lunch';
  if (slot === 'lunch') return meal.includes('lunch') || meal.includes('dinner');
  return meal.includes(slot);
}

// Ingredients that say nothing about overlap (everyone has them).
const STAPLES = new Set(['salt', 'black pepper', 'water', 'olive oil', 'vegetable oil', 'cooking spray', 'butter', 'sugar', 'all purpose flour']);
export function ingredientKeys(r) {
  const out = new Set();
  for (const i of r.ingredients || []) {
    if (!i || !i.item) continue;
    const m = matchItem(i.item);
    const k = m ? m.entry.n : itemKey(i.item);
    if (k && !STAPLES.has(k)) out.add(k);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Auto-plan
 * ------------------------------------------------------------------ */

// opts:
//   recipes          array of recipes
//   entries          live plan entries (any week)
//   weekStart, today ISO dates; only today and later get filled
//   want             { dinner: 5, lunch: 3 } how many of each to have planned by this run
//   budget           cap for the week's total (existing planned meals + new picks), 0 = none
//   maxWeeknightMin  cap on prep+cook for weeknight dinners, 0 = none
//   includeTags      recipe must have at least one (if any given)
//   avoidTags        recipe must have none
//   locked           picks to keep: [{ date, slot, recipeId, servings }]
//   exclude          { 'date|slot': [recipeIds] } never pick these there (shuffle)
//   targets          explicit [{date, slot}] to fill instead of "first empty"
//   costOf(r, serv)  estimated cost
//   servingsFor(r)   servings for a new pick (default: as written)
//   lastHad          Map recipeId -> last date eaten (ISO)
//   recentDays       skip anything eaten this recently (default 14)
//   householdSize, leftovers  fill requested lunches with leftovers from big dinners
//   rng              random source (0..1), for tests
// Returns { picks, leftovers, total, existingCost, budgetLeft, unfilled }
export function autoPlan(opts) {
  const {
    recipes = [], entries = [], weekStart, today = weekStart, want = {}, budget = 0, maxWeeknightMin = 0,
    includeTags = [], avoidTags = [], locked = [], exclude = {}, targets = null,
    costOf = () => 0, servingsFor = r => r.servings || 2, lastHad = new Map(), recentDays = 14,
    householdSize = 2, leftovers = false, rng = Math.random,
  } = opts;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = days[6];
  const inWeek = e => e.date >= weekStart && e.date <= weekEnd;
  const live = entries.filter(e => e && !e.deleted);
  const occupied = new Set(live.map(e => slotKey(e.date, e.slot)));
  const inc = lower(includeTags), avoid = lower(avoidTags);

  const existing = live.filter(inWeek);
  const existingCost = round2(existing.reduce((s, e) => {
    const r = e.recipeId && recipes.find(x => x.id === e.recipeId);
    return s + (r ? costOf(r, e.servings || r.servings) : 0);
  }, 0));

  // Recipes already on this week's plan, or eaten in the last two weeks, are out.
  const used = new Set(existing.map(e => e.recipeId || e.leftoverOf).filter(Boolean));
  const recent = new Set();
  for (const [id, d] of lastHad) if (d && d <= today && daysBetween(d, today) < recentDays) recent.add(id);

  const picks = [];
  const shared = new Set();
  let spent = existingCost;
  for (const l of locked) {
    const r = recipes.find(x => x.id === l.recipeId);
    if (!r) continue;
    const servings = l.servings || servingsFor(r);
    const cost = round2(costOf(r, servings));
    picks.push({ date: l.date, slot: l.slot, recipeId: r.id, servings, cost, locked: true });
    used.add(r.id); spent += cost;
    for (const k of ingredientKeys(r)) shared.add(k);
  }
  const taken = new Set([...occupied, ...picks.map(p => slotKey(p.date, p.slot))]);

  // Which empty slots to fill, in order: dinners, then lunches, breakfasts, snacks.
  const order = ['dinner', 'lunch', 'breakfast', 'snack'];
  const plan = [];
  if (targets) for (const t of targets) { if (!taken.has(slotKey(t.date, t.slot))) plan.push({ ...t }); }
  else {
    for (const slot of order) {
      let need = Math.max(0, (want[slot] || 0) - picks.filter(p => p.slot === slot).length);
      for (const d of days) {
        if (!need) break;
        if (d < today || taken.has(slotKey(d, slot))) continue;
        plan.push({ date: d, slot });
        need--;
      }
    }
  }

  const eligible = (r, t) => {
    if (!r || r.deleted || r.draft || !(r.ingredients || []).length || used.has(r.id) || recent.has(r.id)) return false;
    if (!fitsSlot(r, t.slot)) return false;
    const tags = lower(r.tags);
    if (inc.length && !inc.some(x => tags.includes(x))) return false;
    if (avoid.some(x => tags.includes(x))) return false;
    if (maxWeeknightMin > 0 && t.slot === 'dinner' && isWeeknight(t.date) && totalMin(r) > maxWeeknightMin) return false;
    if ((exclude[slotKey(t.date, t.slot)] || []).includes(r.id)) return false;
    return true;
  };
  const costs = new Map(recipes.map(r => [r.id, round2(costOf(r, servingsFor(r)))]));
  const cheapest = t => { let m = Infinity; for (const r of recipes) if (eligible(r, t)) m = Math.min(m, costs.get(r.id)); return m; };

  const leftoverPicks = [];
  const unfilled = [];
  const isLeftoverSlot = new Set();
  const fill = (t, idx) => {
    const k = slotKey(t.date, t.slot);
    if (isLeftoverSlot.has(k)) return;
    const pool = recipes.filter(r => eligible(r, t));
    if (!pool.length) { unfilled.push({ ...t, reason: 'no-recipes' }); return; }
    let afford = pool;
    if (budget > 0) {
      // Keep enough room to fill the remaining slots at their cheapest.
      let reserve = 0;
      for (const u of plan.slice(idx + 1)) { if (isLeftoverSlot.has(slotKey(u.date, u.slot))) continue; const c = cheapest(u); if (isFinite(c)) reserve += c; }
      afford = pool.filter(r => spent + costs.get(r.id) + reserve <= budget + 0.005);
      if (!afford.length) afford = pool.filter(r => spent + costs.get(r.id) <= budget + 0.005);
      if (!afford.length) { unfilled.push({ ...t, reason: 'budget' }); return; }
    }
    const maxCost = Math.max(...afford.map(r => costs.get(r.id)), 0.01);
    const lh = r => lastHad.get(r.id);
    let best = null, bestScore = -Infinity;
    for (const r of afford) {
      const keys = ingredientKeys(r);
      let overlap = 0; for (const x of keys) if (shared.has(x)) overlap++;
      const since = lh(r) ? Math.min(60, daysBetween(lh(r), today)) / 60 : 0.5;
      const score = 1 + (r.fav ? 2 : 0) + (r.rating || 0) * 0.5 + Math.min(overlap, 5) * 0.4
        + (budget > 0 ? (1 - costs.get(r.id) / maxCost) : 0) + since * 0.5;
      const noisy = score * (0.75 + 0.5 * rng());
      if (noisy > bestScore) { bestScore = noisy; best = r; }
    }
    const servings = servingsFor(best);
    const cost = costs.get(best.id);
    picks.push({ date: t.date, slot: t.slot, recipeId: best.id, servings, cost, locked: false });
    used.add(best.id); spent += cost;
    for (const x of ingredientKeys(best)) shared.add(x);
    if (leftovers && t.slot === 'dinner') {
      // Leftovers can only go into lunches the user asked us to fill.
      const open = new Set(plan.filter(u => u.slot === 'lunch' && !isLeftoverSlot.has(slotKey(u.date, u.slot)) && !picks.some(p => p.date === u.date && p.slot === u.slot)).map(u => slotKey(u.date, u.slot)));
      const spots = leftoverSlots({ date: t.date, slot: t.slot, servings, householdSize, isOpen: (d, s) => s === 'lunch' && open.has(slotKey(d, s)) });
      for (const sp of spots) { isLeftoverSlot.add(slotKey(sp.date, sp.slot)); leftoverPicks.push({ ...sp, leftoverOf: best.id, servings: householdSize }); }
    }
  };
  plan.forEach(fill);
  picks.sort((a, b) => a.date.localeCompare(b.date) || PLAN_SLOTS.indexOf(a.slot) - PLAN_SLOTS.indexOf(b.slot));
  const total = round2(picks.reduce((s, p) => s + p.cost, 0));
  return { picks, leftovers: leftoverPicks, total, existingCost, weekTotal: round2(existingCost + total), budgetLeft: budget > 0 ? round2(budget - existingCost - total) : null, unfilled };
}

// Re-pick one slot, keeping every other pick where it is.
export function shuffleSlot(opts, result, index) {
  const target = result.picks[index];
  if (!target) return result;
  const k = slotKey(target.date, target.slot);
  const exclude = { ...(opts.exclude || {}) };
  exclude[k] = [...(exclude[k] || []), target.recipeId];
  const locked = result.picks.filter((_, i) => i !== index).map(p => ({ ...p }));
  const lockedLeftovers = result.leftovers.filter(l => l.leftoverOf !== target.recipeId);
  const next = autoPlan({ ...opts, exclude, locked, targets: [{ date: target.date, slot: target.slot }], leftovers: false,
    entries: [...(opts.entries || []), ...lockedLeftovers.map(l => ({ date: l.date, slot: l.slot, leftoverOf: l.leftoverOf }))] });
  // Keep the original locked flags; the new pick is unlocked.
  next.picks = next.picks.map(p => { const was = result.picks.find(q => q.date === p.date && q.slot === p.slot && q.recipeId === p.recipeId); return { ...p, locked: was ? !!was.locked : false }; });
  next.leftovers = lockedLeftovers;
  next.exclude = exclude;
  if (!next.picks.some(p => p.date === target.date && p.slot === target.slot)) next.unfilled = [{ date: target.date, slot: target.slot, reason: 'no-alternative' }];
  return next;
}

/* ------------------------------------------------------------------ *
 * Leftovers
 * ------------------------------------------------------------------ */

// The next open lunch/dinner slots after a cooked meal for its extra servings
// (one slot per household-sized portion), within `maxDays` days.
export function leftoverSlots({ date, slot, servings, householdSize = 2, isOpen, maxDays = 3 }) {
  const hh = Math.max(1, householdSize || 1);
  const portions = Math.floor(Math.max(0, (servings || 0) - hh) / hh);
  if (portions < 1) return [];
  const seq = [];
  for (let i = 0; i <= maxDays; i++) {
    const d = addDays(date, i);
    for (const s of ['lunch', 'dinner']) {
      if (i === 0 && PLAN_SLOTS.indexOf(s) <= PLAN_SLOTS.indexOf(slot)) continue;
      seq.push({ date: d, slot: s });
    }
  }
  const out = [];
  for (const x of seq) { if (out.length >= portions) break; if (isOpen(x.date, x.slot)) out.push(x); }
  return out;
}

// Convenience for the app: where would this entry's leftovers go?
export function leftoverTargets(entry, recipe, entries, householdSize) {
  const busy = new Set(entries.filter(e => e && !e.deleted).map(e => slotKey(e.date, e.slot)));
  return leftoverSlots({ date: entry.date, slot: entry.slot, servings: entry.servings || recipe.servings, householdSize, isOpen: (d, s) => !busy.has(slotKey(d, s)) });
}

/* ------------------------------------------------------------------ *
 * Pantry: expiring soon + use it up
 * ------------------------------------------------------------------ */

export function expiringSoon(pantry, today, days = 3) {
  return pantry.filter(p => p && !p.deleted && p.expires && daysBetween(today, p.expires) <= days)
    .sort((a, b) => a.expires.localeCompare(b.expires) || String(a.name).localeCompare(String(b.name)));
}

// Recipes ranked by how many soon-to-expire (weighted by urgency) and on-hand
// pantry items they use.
export function useItUp(recipes, pantry, today, { soonDays = 3, limit = 12 } = {}) {
  const stock = pantry.filter(p => p && !p.deleted && p.name);
  const soon = new Set(expiringSoon(stock, today, soonDays).map(p => p.id));
  const out = [];
  for (const r of recipes) {
    if (!r || r.deleted) continue;
    const ings = (r.ingredients || []).filter(i => i && i.item);
    if (!ings.length) continue;
    const soonHits = [], haveHits = [];
    let covered = 0;
    for (const p of stock) {
      const uses = ings.some(i => sameItem(i.item, p.name));
      if (!uses) continue;
      covered++;
      (soon.has(p.id) ? soonHits : haveHits).push(p);
    }
    if (!soonHits.length && (soon.size || !haveHits.length)) continue;
    const urgency = soonHits.reduce((s, p) => s + Math.max(0, soonDays + 1 - Math.max(0, daysBetween(today, p.expires))), 0);
    const score = soonHits.length * 10 + urgency + haveHits.length * 2 + Math.min(1, covered / ings.length) * 3;
    out.push({ recipe: r, soon: soonHits.map(p => p.name), have: haveHits.map(p => p.name), score: Math.round(score * 100) / 100 });
  }
  out.sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title));
  return out.slice(0, limit);
}
