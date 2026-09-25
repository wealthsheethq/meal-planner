import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleIngredients, formatAmount } from '../js/core.js';

const ings = [
  { qty: 1, unit: 'lb', item: 'chicken thighs', note: '' },
  { qty: 2, unit: 'tbsp', item: 'olive oil', note: '' },
  { qty: 1, unit: 'tsp', item: 'cumin', note: '' },
  { qty: 3, unit: 'clove', item: 'garlic', note: 'minced' },
  { qty: null, unit: '', item: 'salt', note: 'to taste' },
  { qty: 0.5, unit: 'cup', item: 'rice', note: '' },
];

test('doubling a recipe', () => {
  const s = scaleIngredients(ings, 4, 8);
  assert.deepEqual(s.map(i => [i.qty, i.unit]), [[2, 'lb'], [0.25, 'cup'], [2, 'tsp'], [6, 'clove'], [null, ''], [1, 'cup']]);
  assert.equal(s[3].note, 'minced');
});

test('halving a recipe', () => {
  const s = scaleIngredients(ings, 4, 2);
  assert.deepEqual(s.map(i => [i.qty, i.unit]), [[0.5, 'lb'], [1, 'tbsp'], [0.5, 'tsp'], [1.5, 'clove'], [null, ''], [0.25, 'cup']]);
  assert.equal(formatAmount(s[0].qty, s[0].unit), '½ lb');
});

test('odd scale factors (4 -> 6 servings) with tidy units', () => {
  const s = scaleIngredients(ings, 4, 6);
  assert.equal(s[0].qty, 1.5);
  assert.deepEqual([s[1].qty, s[1].unit], [3, 'tbsp']);
  assert.deepEqual([s[2].qty, s[2].unit], [1.5, 'tsp']);
  assert.equal(formatAmount(s[5].qty, s[5].unit), '¾ cup');
});

test('scaling to 1 serving and back is lossless enough', () => {
  const down = scaleIngredients(ings, 4, 1);
  const up = scaleIngredients(down, 1, 4);
  assert.equal(up[0].qty, 1);
  assert.deepEqual([up[1].qty, up[1].unit], [2, 'tbsp']);
  assert.deepEqual([up[5].qty, up[5].unit], [0.5, 'cup']);
});

test('no-op when servings match or are missing, and input is not mutated', () => {
  assert.deepEqual(scaleIngredients(ings, 4, 4), ings);
  assert.deepEqual(scaleIngredients(ings, 0, 4), ings);
  assert.equal(ings[0].qty, 1);
});
