import test from 'node:test';
import assert from 'node:assert/strict';
import { lineCost, recipeCost, planCost, groceryTotal, budgetProgress, money, findPrice } from '../js/core.js';

const prices = {
  'chicken thigh': { id: 'chicken thigh', item: 'Chicken thighs', price: 3.99, qty: 1, unit: 'lb' },
  'olive oil': { id: 'olive oil', item: 'Olive oil', price: 8.99, qty: 16.9, unit: 'fl oz' },
  lime: { id: 'lime', item: 'Lime', price: 0.5, qty: 1, unit: '' },
  cumin: { id: 'cumin', item: 'Cumin', price: 3.49, qty: 1, unit: 'jar' },
  rice: { id: 'rice', item: 'Rice', price: 2, qty: 2, unit: 'lb', deleted: true },
};

const close = (a, b) => assert.ok(Math.abs(a - b) < 0.011, `${a} ≈ ${b}`);

test('line cost converts units', () => {
  close(lineCost({ qty: 2, unit: 'lb' }, prices['chicken thigh']).cost, 7.98);
  close(lineCost({ qty: 24, unit: 'oz' }, prices['chicken thigh']).cost, 5.985);
  // 2 tbsp = 1 fl oz of a 16.9 fl oz bottle
  close(lineCost({ qty: 2, unit: 'tbsp' }, prices['olive oil']).cost, 8.99 / 16.9);
  close(lineCost({ qty: 3, unit: '' }, prices.lime).cost, 1.5);
});

test('incompatible units count one package and are flagged approximate', () => {
  const c = lineCost({ qty: 1, unit: 'tsp' }, prices.cumin);
  assert.equal(c.cost, 3.49);
  assert.equal(c.approx, true);
  assert.equal(lineCost({ qty: null, unit: '' }, prices.lime), null);
  assert.equal(lineCost({ qty: 1, unit: '' }, null), null);
});

test('deleted prices are ignored; lookup is by item key', () => {
  assert.equal(findPrice(prices, 'Rice'), null);
  assert.equal(findPrice(prices, 'limes').price, 0.5);
});

const recipe = {
  servings: 4,
  ingredients: [
    { qty: 2, unit: 'lb', item: 'chicken thighs' },
    { qty: 2, unit: 'tbsp', item: 'olive oil' },
    { qty: 2, unit: '', item: 'limes' },
    { qty: 1, unit: 'cup', item: 'mystery sauce' },
  ],
};

test('recipe cost, cost per serving and scaling', () => {
  const c = recipeCost(recipe, prices);
  close(c.total, 7.98 + 0.53 + 1);
  close(c.perServing, (7.98 + 0.53 + 1) / 4);
  assert.equal(c.priced, 3);
  assert.equal(c.missing, 1);
  const doubled = recipeCost(recipe, prices, 8);
  close(doubled.total, 2 * (7.98 + 0.532 + 1));
  close(doubled.perServing, c.perServing);
});

test('plan cost sums scaled recipes and skips notes and deleted entries', () => {
  const recipes = { r1: recipe };
  const entries = [
    { recipeId: 'r1', servings: 4 },
    { recipeId: 'r1', servings: 2 },
    { note: 'Leftovers' },
    { recipeId: 'r1', servings: 4, deleted: true },
    { recipeId: 'gone', servings: 4 },
  ];
  close(planCost(entries, recipes, prices), 9.51 * 1.5);
});

test('grocery total ignores "already have" items and counts unpriced', () => {
  const items = [
    { name: 'Chicken thighs', qty: 1.5, unit: 'lb' },
    { name: 'Limes', qty: 4, unit: '' },
    { name: 'Paper towels', qty: 1, unit: '', price: 6.49 },
    { name: 'Olive oil', qty: 2, unit: 'tbsp', have: true },
    { name: 'Saffron', qty: 1, unit: 'pinch' },
    { name: 'Old', qty: 1, unit: '', price: 100, deleted: true },
  ];
  const t = groceryTotal(items, prices);
  close(t.total, 5.985 + 2 + 6.49);
  assert.equal(t.missing, 1);
});

test('budget progress', () => {
  assert.deepEqual(budgetProgress(75, 150), { pct: 50, over: false, remaining: 75 });
  const over = budgetProgress(180, 150);
  assert.equal(over.pct, 100);
  assert.equal(over.over, true);
  assert.equal(over.remaining, -30);
  assert.equal(budgetProgress(10, 0).remaining, null);
  assert.equal(money(12.5), '$12.50');
  assert.equal(money(-3), '-$3.00');
});
