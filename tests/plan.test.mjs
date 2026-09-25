import test from 'node:test';
import assert from 'node:assert/strict';
import { autoPlan, shuffleSlot, leftoverSlots, leftoverTargets, fitsSlot, expiringSoon, useItUp, isWeeknight } from '../js/plan.js';
import { addDays } from '../js/core.js';

// Week of Sun 2026-09-27 .. Sat 2026-10-03
const WS = '2026-09-27';
const day = i => addDays(WS, i);

// Deterministic "random" for repeatable picks
function rng(seed = 1) { let x = seed; return () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; }

const R = (id, o = {}) => ({ id, title: id, servings: 4, prepMin: 10, cookMin: 20, tags: ['Dinner'], ingredients: [{ qty: 1, unit: 'lb', item: 'chicken breast' }], ...o });
const cost = map => (r, s) => (map[r.id] ?? 10) * (s / (r.servings || 4));

const base = (over = {}) => ({
  recipes: [], entries: [], weekStart: WS, today: WS, want: { dinner: 3 }, costOf: cost({}), rng: rng(7), lastHad: new Map(), ...over,
});

test('fills only empty slots and never overwrites planned meals', () => {
  const recipes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => R(id));
  const entries = [
    { id: 'x1', date: day(0), slot: 'dinner', recipeId: 'a' },
    { id: 'x2', date: day(1), slot: 'dinner', note: 'Eat out' },
  ];
  const res = autoPlan(base({ recipes, entries, want: { dinner: 4 } }));
  assert.equal(res.picks.length, 4);
  const dates = res.picks.map(p => p.date);
  assert.ok(!dates.includes(day(0)) && !dates.includes(day(1)), 'planned days untouched');
  assert.deepEqual(dates, [day(2), day(3), day(4), day(5)]);
  assert.ok(!res.picks.some(p => p.recipeId === 'a'), 'already planned this week');
  assert.equal(new Set(res.picks.map(p => p.recipeId)).size, 4, 'no repeats in the week');
});

test('skips days before today', () => {
  const recipes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => R(id));
  const res = autoPlan(base({ recipes, today: day(4), want: { dinner: 5 } }));
  assert.deepEqual(res.picks.map(p => p.date), [day(4), day(5), day(6)]);
});

test('avoids anything eaten in the last 2 weeks', () => {
  const recipes = ['a', 'b', 'c', 'd'].map(id => R(id, { fav: id === 'a', rating: id === 'a' ? 5 : 0 }));
  const lastHad = new Map([['a', addDays(WS, -3)], ['b', addDays(WS, -13)], ['c', addDays(WS, -14)]]);
  for (let seed = 1; seed < 20; seed++) {
    const res = autoPlan(base({ recipes, lastHad, rng: rng(seed), want: { dinner: 3 } }));
    const ids = res.picks.map(p => p.recipeId);
    assert.ok(!ids.includes('a') && !ids.includes('b'), `seed ${seed}: picked a recent recipe ${ids}`);
    assert.deepEqual(ids.sort(), ['c', 'd']);
    assert.equal(res.unfilled.length, 1);
  }
});

test('stays under the budget cap (including meals already planned)', () => {
  const recipes = ['cheap1', 'cheap2', 'cheap3', 'mid', 'pricey1', 'pricey2'].map(id => R(id, { fav: id.startsWith('pricey'), rating: id.startsWith('pricey') ? 5 : 1 }));
  const prices = { cheap1: 6, cheap2: 7, cheap3: 8, mid: 15, pricey1: 30, pricey2: 32 };
  const entries = [{ date: day(0), slot: 'dinner', recipeId: 'mid', servings: 4 }];
  for (let seed = 1; seed < 30; seed++) {
    const res = autoPlan(base({ recipes, entries, costOf: cost(prices), budget: 45, want: { dinner: 4 }, rng: rng(seed) }));
    assert.equal(res.existingCost, 15);
    assert.ok(res.weekTotal <= 45, `seed ${seed}: ${res.weekTotal}`);
    assert.equal(res.picks.length, 3); // only three fit: 15 + 6 + 7 + 8 = 36
    assert.ok(res.budgetLeft >= 0);
  }
  // Without a budget the favorites win
  const free = autoPlan(base({ recipes, costOf: cost(prices), want: { dinner: 2 } }));
  assert.deepEqual(free.picks.map(p => p.recipeId).sort(), ['pricey1', 'pricey2']);
});

test('locks survive regeneration; shuffle changes only one slot', () => {
  const recipes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => R(id));
  const opts = base({ recipes, want: { dinner: 3 } });
  const first = autoPlan(opts);
  const keep = { ...first.picks[1], locked: true };
  for (let seed = 2; seed < 12; seed++) {
    const again = autoPlan({ ...opts, rng: rng(seed), locked: [keep] });
    const kept = again.picks.find(p => p.date === keep.date && p.slot === keep.slot);
    assert.equal(kept.recipeId, keep.recipeId);
    assert.equal(kept.locked, true);
    assert.equal(again.picks.length, 3);
    assert.equal(again.picks.filter(p => p.recipeId === keep.recipeId).length, 1);
  }
  const shuffled = shuffleSlot(opts, first, 0);
  assert.equal(shuffled.picks.length, 3);
  assert.notEqual(shuffled.picks.find(p => p.date === first.picks[0].date).recipeId, first.picks[0].recipeId);
  for (const i of [1, 2]) assert.equal(shuffled.picks.find(p => p.date === first.picks[i].date).recipeId, first.picks[i].recipeId);
  // Shuffling again never brings back what was shuffled away
  const again = shuffleSlot({ ...opts, exclude: shuffled.exclude }, shuffled, shuffled.picks.findIndex(p => p.date === first.picks[0].date));
  const now = again.picks.find(p => p.date === first.picks[0].date);
  assert.ok(now && ![first.picks[0].recipeId, shuffled.picks.find(p => p.date === first.picks[0].date).recipeId].includes(now.recipeId));
});

test('drafts and recipes without ingredients are never picked', () => {
  const recipes = [R('ok'), R('draft', { draft: true }), R('empty', { ingredients: [] })];
  const res = autoPlan(base({ recipes, want: { dinner: 3 } }));
  assert.deepEqual(res.picks.map(p => p.recipeId), ['ok']);
});

test('tags to include/avoid, meal types and weeknight cook time', () => {
  const recipes = [
    R('quick-veg', { tags: ['Dinner', 'Vegetarian'], cookMin: 15 }),
    R('slow-veg', { tags: ['Dinner', 'Vegetarian'], prepMin: 30, cookMin: 90 }),
    R('fish', { tags: ['Dinner', 'Seafood'], cookMin: 15 }),
    R('pancakes', { tags: ['Breakfast'], cookMin: 15 }),
  ];
  assert.ok(fitsSlot(recipes[3], 'breakfast') && !fitsSlot(recipes[3], 'dinner'));
  assert.ok(fitsSlot(R('x', { tags: [] }), 'lunch'));
  assert.ok(isWeeknight(day(1)) && !isWeeknight(day(0)) && !isWeeknight(day(6)));
  const res = autoPlan(base({ recipes, want: { dinner: 7 }, includeTags: ['vegetarian'], avoidTags: ['Seafood'], maxWeeknightMin: 30 }));
  const got = Object.fromEntries(res.picks.map(p => [p.recipeId, p.date]));
  assert.deepEqual(Object.keys(got).sort(), ['quick-veg', 'slow-veg']);
  assert.ok(!isWeeknight(got['slow-veg']), 'long recipe only on a weekend night');
});

test('prefers recipes that share ingredients', () => {
  const recipes = [
    R('first', { fav: true, rating: 5, ingredients: [{ item: 'cilantro' }, { item: 'limes' }, { item: 'black beans' }, { item: 'corn tortillas' }] }),
    R('shares', { ingredients: [{ item: 'fresh cilantro' }, { item: 'lime' }, { item: 'black beans' }, { item: 'rice' }] }),
    R('other1', { ingredients: [{ item: 'salmon' }, { item: 'soy sauce' }, { item: 'bok choy' }] }),
    R('other2', { ingredients: [{ item: 'pasta' }, { item: 'marinara sauce' }, { item: 'parmesan' }] }),
  ];
  let shared = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const res = autoPlan(base({ recipes, want: { dinner: 2 }, rng: rng(seed) }));
    if (res.picks.some(p => p.recipeId === 'shares')) shared++;
  }
  assert.ok(shared >= 30, `shared-ingredient recipe picked ${shared}/40 times`);
});

test('leftovers from big dinners fill requested lunches', () => {
  const recipes = [R('big', { servings: 6, fav: true, rating: 5, tags: ['Dinner'] }), R('lunch1', { tags: ['Lunch'], servings: 2 }), R('lunch2', { tags: ['Lunch'], servings: 2 })];
  const res = autoPlan(base({ recipes, want: { dinner: 1, lunch: 3 }, householdSize: 2, leftovers: true }));
  assert.equal(res.picks.find(p => p.slot === 'dinner').recipeId, 'big');
  // 6 servings for 2 people = 2 extra meals -> the next two requested lunches
  assert.deepEqual(res.leftovers.map(l => [l.date, l.slot, l.leftoverOf]), [[day(1), 'lunch', 'big'], [day(2), 'lunch', 'big']]);
  assert.equal(res.picks.filter(p => p.slot === 'lunch').length, 1);
  assert.equal(res.picks.find(p => p.slot === 'lunch').date, day(0));
});

test('leftover placement: next open lunch/dinner, within 3 days, one per portion', () => {
  const busy = new Set([day(1) + '|lunch']);
  const isOpen = (d, s) => !busy.has(d + '|' + s);
  // Dinner Sunday, 6 servings, 2 people: 2 portions -> Mon dinner (Mon lunch taken), Tue lunch
  assert.deepEqual(leftoverSlots({ date: day(0), slot: 'dinner', servings: 6, householdSize: 2, isOpen }), [{ date: day(1), slot: 'dinner' }, { date: day(2), slot: 'lunch' }]);
  // Lunch -> same-day dinner first
  assert.deepEqual(leftoverSlots({ date: day(0), slot: 'lunch', servings: 4, householdSize: 2, isOpen }), [{ date: day(0), slot: 'dinner' }]);
  // Not enough extra for a meal
  assert.deepEqual(leftoverSlots({ date: day(0), slot: 'dinner', servings: 3, householdSize: 2, isOpen }), []);
  // Nothing open within 3 days
  assert.deepEqual(leftoverSlots({ date: day(0), slot: 'dinner', servings: 8, householdSize: 2, isOpen: () => false }), []);
  // Household of 1, 4 servings -> 3 portions
  assert.equal(leftoverSlots({ date: day(0), slot: 'dinner', servings: 4, householdSize: 1, isOpen: () => true }).length, 3);
  // From real plan entries (deleted ones don't block)
  const entries = [{ date: day(1), slot: 'lunch', note: 'x' }, { date: day(1), slot: 'dinner', note: 'y', deleted: true }];
  assert.deepEqual(leftoverTargets({ date: day(0), slot: 'dinner', servings: 4 }, R('r'), entries, 2), [{ date: day(1), slot: 'dinner' }]);
});

test('expiring soon + use it up ranking', () => {
  const t = '2026-09-27';
  const pantry = [
    { id: 'p1', name: 'Baby spinach', expires: '2026-09-28' },
    { id: 'p2', name: 'Feta', expires: '2026-09-26' }, // already expired: most urgent
    { id: 'p3', name: 'Eggs' },
    { id: 'p4', name: 'Rice', expires: '2026-12-01' },
    { id: 'p5', name: 'Milk', expires: '2026-09-29', deleted: true },
  ];
  assert.deepEqual(expiringSoon(pantry, t).map(p => p.id), ['p2', 'p1']);
  const recipes = [
    R('both', { title: 'Spinach feta omelet', ingredients: [{ item: 'eggs' }, { item: 'fresh spinach' }, { item: 'feta, crumbled' }] }),
    R('spinach', { title: 'Spinach rice', ingredients: [{ item: 'spinach' }, { item: 'basmati rice' }, { item: 'eggs' }] }),
    R('have-only', { title: 'Egg fried rice', ingredients: [{ item: 'rice' }, { item: 'eggs' }, { item: 'soy sauce' }] }),
    R('none', { title: 'Tacos', ingredients: [{ item: 'ground beef' }, { item: 'tortillas' }] }),
  ];
  const ranked = useItUp(recipes, pantry, t);
  assert.deepEqual(ranked.map(x => x.recipe.id), ['both', 'spinach']);
  assert.deepEqual(ranked[0].soon.sort(), ['Baby spinach', 'Feta']);
  assert.deepEqual(ranked[1].have.sort(), ['Eggs', 'Rice']);
  // Nothing expiring: rank by what's on hand
  const calm = pantry.map(p => ({ ...p, expires: null }));
  const r2 = useItUp(recipes, calm, t);
  assert.deepEqual(r2.map(x => [x.recipe.id, x.have.length]), [['both', 3], ['spinach', 3], ['have-only', 2]]); // ties by title
  assert.ok(!r2.some(x => x.recipe.id === 'none'));
});
