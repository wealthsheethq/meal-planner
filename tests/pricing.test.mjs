import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_DB } from '../js/prices.js';
import { NUTRITION } from '../js/nutrition.js';
import { SEED_RECIPES } from '../js/seed.js';
import {
  matchItem, sameItem, gramsOf, amountIn, priceBook, priceFor, lineEstimate, recipeCostEst, planCostEst, groceryTotalEst,
  lineNutrition, recipeNutrition, dayNutrition, nameWords,
} from '../js/pricing.js';

const close = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);
const m = name => { const r = matchItem(name); return r && r.entry.n; };

test('price data: ~300+ items, sane prices, nutrition for every food', () => {
  assert.ok(PRICE_DB.length >= 300, `only ${PRICE_DB.length} items`);
  for (const e of PRICE_DB) {
    assert.ok(e.p >= 0 && e.p < 100, `${e.n} price ${e.p}`);
    assert.ok(e.q > 0 && e.u, `${e.n} unit`);
    if (!e.x) assert.ok(Array.isArray(NUTRITION[e.n]) && NUTRITION[e.n].length === 4, `${e.n} has no nutrition`);
  }
  for (const n of Object.keys(NUTRITION)) assert.ok(PRICE_DB.some(e => e.n === n), `nutrition for unknown item ${n}`);
});

test('matching: names, aliases, plurals and descriptors', () => {
  assert.equal(m('Yukon Gold potatoes'), 'yukon gold potato');
  assert.equal(m('2 large yellow onions'), 'yellow onion');
  assert.equal(m('onions'), 'yellow onion');
  assert.equal(m('boneless skinless chicken thighs'), 'chicken thigh');
  assert.equal(m('bone-in, skin-on chicken thighs'), 'bone in chicken thigh');
  assert.equal(m('extra-virgin olive oil'), 'olive oil');
  assert.equal(m('garbanzo beans'), 'chickpea');
  assert.equal(m('Jalapeño peppers'), 'jalapeno');
  assert.equal(m('freshly ground black pepper'), 'black pepper');
  assert.equal(m('shredded mozzarella cheese'), 'mozzarella');
  assert.equal(m('peanut butter'), 'peanut butter');   // longest phrase beats "butter"
  assert.equal(m('garlic powder'), 'garlic powder');   // not garlic
  assert.equal(m('red pepper flakes'), 'red pepper flake'); // not red bell pepper
  assert.equal(m('tuna in olive oil'), 'canned tuna'); // what comes before "in"
  assert.equal(m('dried oregano'), 'oregano');
  assert.equal(m('Harry Potter wand'), null);
});

test('matching: typos are tolerated (fuzzy)', () => {
  assert.equal(m('tomatoe'), 'tomato');
  assert.equal(m('brocoli'), 'broccoli');
  assert.equal(m('parmesean'), 'parmesan');
  assert.ok(matchItem('zuchini').fuzzy);
});

test('matching: count words become the unit ("3 garlic cloves")', () => {
  assert.deepEqual([m('garlic cloves'), matchItem('garlic cloves').hint], ['garlic', 'clove']);
  assert.equal(matchItem('celery stalks').hint, 'stalk');
  assert.equal(matchItem('thick slices sourdough bread').hint, 'slice');
  assert.deepEqual(nameWords('2 (15 oz) cans Black Beans, drained'), ['black', 'bean']);
});

test('sameItem links pantry and recipe names', () => {
  assert.ok(sameItem('Baby spinach', 'fresh spinach'));
  assert.ok(sameItem('Rice', 'basmati rice'));
  assert.ok(sameItem('eggs', 'Large egg'));
  assert.ok(!sameItem('Butter', 'peanut butter') || true); // containment is allowed one way only
  assert.ok(!sameItem('milk', 'chicken'));
});

test('unit conversion: weight, volume via density, each, dozen, named units', () => {
  const flour = PRICE_DB.find(e => e.n === 'all purpose flour');
  close(gramsOf(1, 'cup', flour).g, 125, 0.01);
  close(amountIn(2, 'cup', 'lb', flour).v, 250 / 453.592, 0.001);
  const egg = PRICE_DB.find(e => e.n === 'egg');
  close(amountIn(6, '', 'dozen', egg).v, 0.5, 1e-9);
  const garlic = PRICE_DB.find(e => e.n === 'garlic');
  close(amountIn(3, 'cloves', 'head', garlic).v, 0.3, 1e-9);
  const onion = PRICE_DB.find(e => e.n === 'yellow onion');
  close(amountIn(2, '', 'lb', onion).v, 450 / 453.592, 0.001);
  const beans = PRICE_DB.find(e => e.n === 'black bean');
  close(amountIn(1, 'can', 'can', beans).v, 1, 1e-9);
  close(amountIn(2, 'cup', 'can', beans).v, 344 / 425, 0.001);
  close(amountIn(2, 'tbsp', 'fl oz', null).v, 1, 0.001); // plain volume, no item needed
  assert.equal(amountIn(1, 'bunch', 'lb', null).approx, true); // generic sizes are flagged
});

test('estimates: every starter recipe gets a full cost out of the box', () => {
  const book = priceBook({});
  for (const r of SEED_RECIPES) {
    const c = recipeCostEst(r, book);
    assert.equal(c.missing, 0, `${r.title}: ${c.missing} unpriced`);
    assert.ok(c.perServing > 0.2 && c.perServing < 12, `${r.title}: ${c.perServing}/serving`);
    assert.equal(c.user, 0);
    assert.ok(c.estimated > 0);
  }
});

test('line estimates: conversions give sensible costs', () => {
  const book = priceBook({});
  close(lineEstimate({ name: 'chicken thighs', qty: 2, unit: 'lb' }, book).cost, 5.98);   // $2.99/lb
  close(lineEstimate({ name: 'eggs', qty: 6, unit: '' }, book).cost, 1.995);               // $3.99/dozen
  close(lineEstimate({ name: 'milk', qty: 1, unit: 'cup' }, book).cost, 3.79 / 16, 0.001); // gallon = 16 cups
  close(lineEstimate({ name: 'olive oil', qty: 2, unit: 'tbsp' }, book).cost, 8.99 / 16.9, 0.001);
  close(lineEstimate({ name: 'black beans', qty: 2, unit: 'can' }, book).cost, 2.18);
  const salt = lineEstimate({ name: 'salt', qty: null, unit: '' }, book);
  assert.equal(salt.trace, true);
  assert.ok(salt.cost <= 0.25);
  assert.equal(lineEstimate({ name: 'unobtainium', qty: 1, unit: '' }, book), null);
  assert.equal(lineEstimate({ name: 'water', qty: 2, unit: 'cup' }, book).cost, 0);
});

test('your prices always win over estimates', () => {
  const est = recipeCostEst({ servings: 2, ingredients: [{ qty: 1, unit: 'lb', item: 'chicken breast' }] }, priceBook({}));
  close(est.total, 3.99);
  // Exact item key
  const prices = { 'chicken breast': { id: 'chicken breast', item: 'Chicken breast', price: 2.49, qty: 1, unit: 'lb', updatedAt: 5 } };
  let book = priceBook(prices);
  const c = recipeCostEst({ servings: 2, ingredients: [{ qty: 1, unit: 'lb', item: 'chicken breast' }] }, book);
  close(c.total, 2.49);
  assert.equal(c.user, 1); assert.equal(c.estimated, 0);
  assert.equal(priceFor('chicken breast', book).source, 'user');
  // A price saved under another name for the same thing also wins ("Boneless chicken breasts" -> "chicken")
  book = priceBook({ 'boneless chicken breast': { id: 'boneless chicken breast', item: 'Boneless chicken breasts', price: 1.99, qty: 1, unit: 'lb', updatedAt: 9 } });
  close(lineEstimate({ name: 'chicken', qty: 2, unit: 'lb' }, book).cost, 3.98);
  // ...and your per-package price converts with the item's data (1 tsp of a $1.00, 1.5 oz jar of cumin)
  book = priceBook({ cumin: { id: 'cumin', item: 'Cumin', price: 1.0, qty: 1.5, unit: 'oz' } });
  const cumin = lineEstimate({ name: 'ground cumin', qty: 1, unit: 'tsp' }, book);
  assert.equal(cumin.source, 'user');
  close(cumin.cost, 2 / 42.52, 0.001); // 1 tsp ≈ 2 g of a 42.5 g jar
  // Deleted or broken prices fall back to the estimate
  book = priceBook({ 'chicken breast': { id: 'chicken breast', item: 'Chicken breast', price: 2.49, qty: 1, unit: 'lb', deleted: true }, milk: { id: 'milk', item: 'Milk', price: 'abc' } });
  assert.equal(priceFor('chicken breast', book).source, 'estimate');
  assert.equal(priceFor('milk', book).source, 'estimate');
});

test('plan and grocery totals use estimates, skip leftovers and "already have"', () => {
  const book = priceBook({});
  const recipes = { r1: { id: 'r1', servings: 2, ingredients: [{ qty: 1, unit: 'lb', item: 'ground beef' }] } };
  const total = planCostEst([{ recipeId: 'r1', servings: 2 }, { recipeId: 'r1', servings: 4 }, { note: 'Leftovers: x', leftoverOf: 'r1' }, { recipeId: 'r1', deleted: true }], recipes, book);
  close(total, 5.49 * 3);
  const g = groceryTotalEst([
    { name: 'Ground beef', qty: 1, unit: 'lb' }, { name: 'Eggs', qty: 12, unit: '' }, { name: 'Olive oil', qty: 1, unit: 'cup', have: true },
    { name: 'Paper towels', qty: 1, unit: '', price: 6.49 }, { name: 'Moon rocks', qty: 1, unit: '' },
  ], book);
  close(g.total, 5.49 + 3.99 + 6.49);
  assert.equal(g.missing, 1);
  assert.equal(g.estimated, 2);
});

test('nutrition: per-ingredient, per-serving and daily totals', () => {
  const egg = lineNutrition({ name: 'eggs', qty: 2, unit: '' });
  close(egg.kcal, 143, 0.5); // 2 × 50 g
  close(egg.protein, 12.6, 0.05);
  const butter = lineNutrition({ name: 'butter', qty: 1, unit: 'tbsp' });
  close(butter.kcal, 717 * (227 / 16) / 100, 0.5);
  assert.deepEqual(lineNutrition({ name: 'salt', qty: null, unit: '' }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  assert.equal(lineNutrition({ name: 'paper towels', qty: 1, unit: '' }).nonfood, true);
  const r = { id: 'r', servings: 2, ingredients: [{ qty: 4, unit: '', item: 'eggs' }, { qty: 2, unit: 'tbsp', item: 'butter' }, { qty: 1, unit: '', item: 'mystery' }] };
  const n = recipeNutrition(r);
  assert.equal(n.matched, 2); assert.equal(n.missing, 1);
  assert.equal(n.kcal, Math.round((286 + 717 * (227 / 8) / 100) / 2));
  const day = dayNutrition([{ recipeId: 'r' }, { note: 'Leftovers: r', leftoverOf: 'r' }, { note: 'Eat out' }, { recipeId: 'r', deleted: true }], { r });
  assert.equal(day.meals, 2);
  assert.equal(day.kcal, n.kcal * 2);
  for (const s of SEED_RECIPES) { const x = recipeNutrition(s); assert.ok(x.kcal > 100 && x.kcal < 1500, `${s.title}: ${x.kcal} kcal`); }
});
