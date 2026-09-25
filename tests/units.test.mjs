import test from 'node:test';
import assert from 'node:assert/strict';
import { normUnit, convert, combineLines, itemKey, tidyQty, formatQty, formatAmount, guessSection } from '../js/core.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('unit aliases normalize', () => {
  assert.equal(normUnit('Tablespoons'), 'tbsp');
  assert.equal(normUnit('T'), 'tbsp');
  assert.equal(normUnit('t'), 'tsp');
  assert.equal(normUnit('lbs'), 'lb');
  assert.equal(normUnit('Ounces'), 'oz');
  assert.equal(normUnit('grams'), 'g');
  assert.equal(normUnit('each'), '');
  assert.equal(normUnit(''), '');
});

test('conversions between tsp/tbsp/cup, oz/lb and g/kg', () => {
  close(convert(3, 'tsp', 'tbsp'), 1);
  close(convert(16, 'tbsp', 'cup'), 1);
  close(convert(1, 'cup', 'tsp'), 48);
  close(convert(16, 'oz', 'lb'), 1);
  close(convert(1500, 'g', 'kg'), 1.5);
  close(convert(1, 'lb', 'g'), 453.59);
  assert.equal(convert(1, 'cup', 'lb'), null);
  assert.equal(convert(2, 'clove', 'clove'), 2);
});

test('item keys ignore plurals, case and descriptors', () => {
  assert.equal(itemKey('Tomatoes'), 'tomato');
  assert.equal(itemKey('large Eggs'), 'egg');
  assert.equal(itemKey('Blueberries'), 'blueberry');
  assert.equal(itemKey('Olive oil'), 'olive oil');
  assert.equal(itemKey('Fresh basil leaves'), 'basil leaf');
  assert.equal(itemKey('Chives'), itemKey('chive'));
  assert.equal(itemKey('Hummus'), 'hummus');
});

test('combines duplicates with the same unit', () => {
  const out = combineLines([{ name: 'Onion', qty: 1, unit: '' }, { name: 'onions', qty: 2, unit: '' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].qty, 3);
  assert.equal(out[0].name, 'Onion');
});

test('combines tsp + tbsp + cup into the best unit', () => {
  const out = combineLines([
    { name: 'olive oil', qty: 2, unit: 'tbsp' },
    { name: 'Olive Oil', qty: 1, unit: 'cup' },
    { name: 'olive oil', qty: 3, unit: 'tsp' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].unit, 'cup');
  close(out[0].qty, 1.1875, 0.005); // 1 cup + 3 tbsp
});

test('small volumes stay in spoons', () => {
  const out = combineLines([{ name: 'cumin', qty: 1, unit: 'tsp' }, { name: 'cumin', qty: 1, unit: 'tbsp' }]);
  assert.equal(out[0].unit, 'tbsp');
  close(out[0].qty, 1.333);
  const out2 = combineLines([{ name: 'salt', qty: 0.5, unit: 'tsp' }, { name: 'salt', qty: 0.25, unit: 'tsp' }]);
  assert.equal(out2[0].unit, 'tsp');
  close(out2[0].qty, 0.75);
});

test('oz + lb combine to lb when a pound or more', () => {
  const out = combineLines([{ name: 'ground beef', qty: 1, unit: 'lb' }, { name: 'ground beef', qty: 8, unit: 'oz' }]);
  assert.equal(out[0].unit, 'lb');
  close(out[0].qty, 1.5);
  const small = combineLines([{ name: 'feta', qty: 4, unit: 'oz' }, { name: 'feta', qty: 2, unit: 'ounces' }]);
  assert.equal(small[0].unit, 'oz');
  close(small[0].qty, 6);
});

test('g + kg combine in metric', () => {
  const out = combineLines([{ name: 'rice', qty: 600, unit: 'g' }, { name: 'rice', qty: 0.5, unit: 'kg' }]);
  assert.equal(out[0].unit, 'kg');
  close(out[0].qty, 1.1);
});

test('mixed metric + US weight prefers US', () => {
  const out = combineLines([{ name: 'chicken thighs', qty: 500, unit: 'g' }, { name: 'chicken thigh', qty: 1, unit: 'lb' }]);
  assert.equal(out[0].unit, 'lb');
  close(out[0].qty, 2.10, 0.01);
});

test('incompatible units stay separate; qty-less lines are kept', () => {
  const out = combineLines([
    { name: 'garlic', qty: 3, unit: 'clove' },
    { name: 'garlic', qty: 1, unit: 'head' },
    { name: 'garlic', qty: 2, unit: 'cloves' },
    { name: 'salt', qty: null, unit: '' },
  ]);
  const cloves = out.find(o => o.unit === 'clove');
  assert.equal(cloves.qty, 5);
  assert.ok(out.find(o => o.unit === 'head'));
  assert.equal(out.find(o => o.key === 'salt').qty, null);
  assert.equal(out.length, 3);
});

test('sources (recipes) are tracked on combined lines', () => {
  const out = combineLines([{ name: 'lime', qty: 1, unit: '', source: 'Tacos' }, { name: 'limes', qty: 2, unit: '', source: 'Salad' }, { name: 'lime', qty: 1, source: 'Tacos' }]);
  assert.deepEqual(out[0].sources, ['Tacos', 'Salad']);
  assert.equal(out[0].qty, 4);
});

test('tidyQty picks friendlier units', () => {
  assert.deepEqual(tidyQty(6, 'tsp'), { qty: 2, unit: 'tbsp' });
  assert.deepEqual(tidyQty(8, 'tbsp'), { qty: 0.5, unit: 'cup' });
  assert.deepEqual(tidyQty(0.125, 'cup'), { qty: 2, unit: 'tbsp' });
  assert.deepEqual(tidyQty(24, 'oz'), { qty: 1.5, unit: 'lb' });
  assert.deepEqual(tidyQty(2, 'clove'), { qty: 2, unit: 'clove' });
});

test('formatting quantities as kitchen fractions', () => {
  assert.equal(formatQty(0.5), '½');
  assert.equal(formatQty(1.5), '1 ½');
  assert.equal(formatQty(0.333), '⅓');
  assert.equal(formatQty(2.25), '2 ¼');
  assert.equal(formatQty(0.99), '1');
  assert.equal(formatQty(3), '3');
  assert.equal(formatQty(0.1), '0.1');
  assert.equal(formatQty(12.34), '12 ⅓');
  assert.equal(formatQty(1.07), '1.07');
  assert.equal(formatAmount(2, 'clove'), '2 cloves');
  assert.equal(formatAmount(1, 'cup'), '1 cup');
  assert.equal(formatAmount(3, ''), '3');
});

test('store section guesses', () => {
  assert.equal(guessSection('Red bell pepper'), 'Produce');
  assert.equal(guessSection('black pepper'), 'Baking & Spices');
  assert.equal(guessSection('chicken thighs'), 'Meat & Seafood');
  assert.equal(guessSection('Cheddar cheese'), 'Dairy & Eggs');
  assert.equal(guessSection('coconut milk'), 'Canned & Jarred');
  assert.equal(guessSection('Frozen peas'), 'Frozen');
  assert.equal(guessSection('spaghetti'), 'Pasta & Grains');
  assert.equal(guessSection('flour tortillas'), 'Bakery');
  assert.equal(guessSection('Canned tomatoes'), 'Canned & Jarred');
  assert.equal(guessSection('mystery item'), 'Other');
});
