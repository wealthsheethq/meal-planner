import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDoc, migrateDoc, mergeDocs, needsPush, stamp, live, readRecipe, readPantry, readPrice, readTrip, isTrip, readSetting, SETTING_DEFAULTS, toSystem,
} from '../js/core.js';
import { priceBook, recipeCostEst, recipeNutrition, groceryTotalEst, planCostEst } from '../js/pricing.js';
import { useItUp, autoPlan } from '../js/plan.js';

// A document as round 1 of the app saved it (plus the odd hand-edited/legacy shape).
const OLD = {
  v: 1,
  recipes: {
    r1: { id: 'r1', title: 'Tacos', servings: '4', prepMin: 10, cookMin: '15', tags: ['Dinner'], ingredients: [{ id: 'i0', qty: 1, unit: 'lb', item: 'ground beef', note: '' }, { id: 'i1', qty: '8', unit: '', item: 'corn tortillas', note: '' }], steps: ['Cook.'], updatedAt: 100, updatedBy: 'u1', deleted: false },
    r2: { id: 'r2', title: '', ingredients: null, updatedAt: 90 }, // missing almost everything
  },
  plan: [{ id: 'p1', date: '2026-09-28', slot: 'dinner', recipeId: 'r1', servings: 4, updatedAt: 100 }, null], // array form
  grocery: { g1: { id: 'g1', name: 'Milk', qty: 1, unit: 'gallon', checked: false, updatedAt: 100 } },
  pantry: { pa1: { id: 'pa1', name: 'Rice', key: 'rice', low: false, updatedAt: 100 }, pa2: { id: 'pa2', name: 'Spinach', expires: 'soon', updatedAt: 1 } },
  prices: { milk: { id: 'milk', item: 'Milk', price: 3.29, qty: 1, unit: 'gallon', updatedAt: 100 }, bad: { id: 'bad', item: 'Bad', price: 'n/a', updatedAt: 1 } },
  aisles: {},
  history: { h1: { id: 'h1', recipeId: 'r1', date: '2026-09-20', servings: 4, updatedAt: 100 } },
  settings: { budget: { id: 'budget', value: 150, updatedAt: 100 }, seeded: { id: 'seeded', value: true, updatedAt: 1 } },
  somethingFromTheFuture: { keep: 'me' },
};

test('old documents load: array collections become maps, junk is dropped, unknown keys kept', () => {
  const d = migrateDoc(OLD);
  assert.deepEqual(Object.keys(d.plan), ['p1']);
  assert.ok(d.recipes.r1 && d.recipes.r2);
  assert.deepEqual(d.somethingFromTheFuture, { keep: 'me' });
  const junk = normalizeDoc({ recipes: { a: 'oops', b: null, c: [1], d: { id: 'd', title: 'Real' } } });
  assert.deepEqual(Object.keys(junk.recipes), ['d']);
  assert.equal(migrateDoc({ recipes: { x: { title: 'no id' } } }).recipes.x.id, 'x');
  assert.deepEqual(Object.keys(migrateDoc(null)).sort(), ['aisles', 'grocery', 'history', 'pantry', 'plan', 'prices', 'recipes', 'settings', 'v']);
  // No field was renamed or rewritten
  assert.deepEqual(d.recipes.r1, OLD.recipes.r1);
  assert.deepEqual(d.prices.milk, OLD.prices.milk);
});

test('readers give safe defaults for everything new', () => {
  const d = migrateDoc(OLD);
  const r1 = readRecipe(d.recipes.r1);
  assert.deepEqual([r1.servings, r1.cookMin, r1.ingredients[1].qty, r1.sourceUrl, r1.draft], [4, 15, 8, '', false]);
  const r2 = readRecipe(d.recipes.r2);
  assert.deepEqual([r2.title, r2.servings, r2.ingredients, r2.steps, r2.tags, r2.rating], ['Untitled recipe', 1, [], [], [], 0]);
  assert.equal(readPantry(d.pantry.pa1).expires, null);
  assert.equal(readPantry(d.pantry.pa2).expires, null); // not a real date
  assert.equal(readPantry({ name: 'Feta', expires: '2026-10-01' }).expires, '2026-10-01');
  assert.equal(readPrice(d.prices.bad), null);
  assert.equal(readPrice(d.prices.milk).price, 3.29);
  assert.equal(readPrice({ price: '2.50', qty: 0 }).qty, 1);
  // Settings that didn't exist before fall back to defaults
  assert.equal(readSetting(d.settings, 'householdSize'), 2);
  assert.equal(readSetting(d.settings, 'units'), 'us');
  assert.equal(readSetting(d.settings, 'hideCost'), false);
  assert.equal(readSetting(d.settings, 'budget'), 150);
  assert.equal(readSetting({ householdSize: { value: 'lots' } }, 'householdSize'), 2);
  assert.equal(readSetting({ householdSize: { value: 4, deleted: true } }, 'householdSize'), SETTING_DEFAULTS.householdSize);
});

test('meal history and shopping trips share the history collection without confusing each other', () => {
  const d = migrateDoc(OLD);
  d.history.t1 = stamp(null, { id: 't1', type: 'trip', date: '2026-09-24', total: 82.4, store: 'Harris Teeter', source: 'receipt', count: 21 }, 'u1', 200);
  d.history.t2 = { id: 't2', type: 'trip', date: 'bad', total: 5 };
  const trips = live(d.history).map(readTrip).filter(Boolean);
  assert.deepEqual(trips.map(t => [t.id, t.total]), [['t1', 82.4]]);
  assert.deepEqual(live(d.history).filter(h => !isTrip(h)).map(h => h.id), ['h1']);
});

test('new features work on an old document', () => {
  const d = migrateDoc(OLD);
  const book = priceBook(d.prices);
  const recipes = Object.fromEntries(Object.entries(d.recipes).map(([k, v]) => [k, readRecipe(v)]));
  const c = recipeCostEst(recipes.r1, book);
  assert.equal(c.missing, 0);
  assert.ok(c.total > 5);
  assert.equal(recipeCostEst(recipes.r2, book).total, 0);
  assert.ok(recipeNutrition(recipes.r1).kcal > 0);
  assert.equal(groceryTotalEst(live(d.grocery), book).total, 3.29); // your old saved price wins
  assert.ok(planCostEst(live(d.plan), recipes, book) > 0);
  assert.deepEqual(useItUp(Object.values(recipes), live(d.pantry).map(readPantry), '2026-09-27'), []);
  const plan = autoPlan({ recipes: Object.values(recipes), entries: live(d.plan), weekStart: '2026-09-27', today: '2026-09-27', want: { dinner: 2 }, costOf: () => 1, rng: () => 0.5 });
  assert.ok(!plan.picks.some(p => p.date === '2026-09-28'), 'kept the planned dinner');
});

test('an updated phone and an old phone still merge and converge', () => {
  const server = migrateDoc(OLD);
  const newPhone = migrateDoc(OLD);
  newPhone.pantry.pa1 = stamp(newPhone.pantry.pa1, { expires: '2026-10-02' }, 'u1', 300);
  newPhone.history.t1 = stamp(null, { id: 't1', type: 'trip', date: '2026-09-24', total: 50 }, 'u1', 300);
  newPhone.plan.lo = stamp(null, { id: 'lo', date: '2026-09-29', slot: 'lunch', note: 'Leftovers: Tacos', leftoverOf: 'r1', leftoverFrom: 'p1', recipeId: null }, 'u1', 300);
  const oldPhone = migrateDoc(OLD);
  oldPhone.pantry.pa1 = stamp(oldPhone.pantry.pa1, { low: true }, 'u2', 310); // old app edits another field
  const a = mergeDocs(mergeDocs(server, newPhone), oldPhone);
  const b = mergeDocs(oldPhone, mergeDocs(newPhone, server));
  assert.deepEqual(a, b);
  assert.equal(a.pantry.pa1.expires, '2026-10-02');
  assert.equal(a.pantry.pa1.low, true);
  assert.equal(a.plan.lo.leftoverOf, 'r1');
  assert.equal(a.history.t1.type, 'trip');
  assert.equal(needsPush(a, b), false);
});

test('display units: US and metric', () => {
  assert.deepEqual(toSystem(1, 'lb', 'metric'), { qty: 455, unit: 'g' });
  assert.deepEqual(toSystem(3, 'lb', 'metric'), { qty: 1.36, unit: 'kg' });
  assert.deepEqual(toSystem(2, 'cup', 'metric'), { qty: 475, unit: 'ml' });
  assert.deepEqual(toSystem(2, 'tbsp', 'metric'), { qty: 2, unit: 'tbsp' }); // spoons stay spoons
  assert.deepEqual(toSystem(500, 'g', 'us'), { qty: 1.1, unit: 'lb' });
  assert.deepEqual(toSystem(250, 'ml', 'us'), { qty: 1.06, unit: 'cup' });
  assert.deepEqual(toSystem(2, 'can', 'metric'), { qty: 2, unit: 'can' });
  assert.deepEqual(toSystem(1, 'lb', 'us'), { qty: 1, unit: 'lb' });
});
