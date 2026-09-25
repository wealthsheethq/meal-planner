import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredient, parseRecipeText, readQty, parseDuration, findTimers } from '../js/core.js';

test('reads quantities: mixed numbers, unicode, decimals, ranges', () => {
  assert.equal(readQty('1 1/2 cups').value, 1.5);
  assert.equal(readQty('½ cup').value, 0.5);
  assert.equal(readQty('1½ cups').value, 1.5);
  assert.equal(readQty('0.25 lb').value, 0.25);
  assert.equal(readQty('2-3 cloves').value, 3);
  assert.equal(readQty('2 to 3 cloves').value, 3);
  assert.equal(readQty('garlic'), null);
});

test('parses ingredient lines into qty/unit/item/note', () => {
  assert.deepEqual(parseIngredient('2 cups all-purpose flour, sifted'), { qty: 2, unit: 'cup', item: 'all-purpose flour', note: 'sifted' });
  assert.deepEqual(parseIngredient('1 1/2 tbsp olive oil'), { qty: 1.5, unit: 'tbsp', item: 'olive oil', note: '' });
  assert.deepEqual(parseIngredient('3 cloves garlic, minced'), { qty: 3, unit: 'clove', item: 'garlic', note: 'minced' });
  assert.deepEqual(parseIngredient('2 large eggs'), { qty: 2, unit: '', item: 'eggs', note: 'large' });
  assert.deepEqual(parseIngredient('1 (15-ounce) can black beans, drained and rinsed'), { qty: 1, unit: 'can', item: 'black beans', note: '15-ounce, drained and rinsed' });
  assert.deepEqual(parseIngredient('Salt and pepper to taste'), { qty: null, unit: '', item: 'Salt and pepper', note: 'to taste' });
  assert.deepEqual(parseIngredient('- ½ tsp. smoked paprika'), { qty: 0.5, unit: 'tsp', item: 'smoked paprika', note: '' });
  assert.deepEqual(parseIngredient('1 lb ground turkey'), { qty: 1, unit: 'lb', item: 'ground turkey', note: '' });
  assert.deepEqual(parseIngredient('a pinch of salt'), { qty: 1, unit: 'pinch', item: 'salt', note: '' });
  assert.deepEqual(parseIngredient('4 oz feta (crumbled)'), { qty: 4, unit: 'oz', item: 'feta', note: 'crumbled' });
  assert.deepEqual(parseIngredient('1 T soy sauce'), { qty: 1, unit: 'tbsp', item: 'soy sauce', note: '' });
  assert.deepEqual(parseIngredient('8 fl oz chicken broth'), { qty: 8, unit: 'fl oz', item: 'chicken broth', note: '' });
  assert.deepEqual(parseIngredient('1 lemon'), { qty: 1, unit: '', item: 'lemon', note: '' });
  assert.equal(parseIngredient('Fresh cilantro, for serving').note, 'for serving');
});

test('durations', () => {
  assert.equal(parseDuration('15 minutes'), 15);
  assert.equal(parseDuration('1 hr 20 mins'), 80);
  assert.equal(parseDuration('1 1/2 hours'), 90);
  assert.equal(parseDuration('soon'), null);
});

test('timers found in step text', () => {
  const t = findTimers('Simmer 10–12 minutes, then rest for 5 min. Bake 1 hour.');
  assert.deepEqual(t.map(x => x.seconds), [600, 300, 3600]);
  assert.equal(t[0].max, 720);
  assert.deepEqual(findTimers('Stir well.'), []);
});

test('parses a recipe with headers', () => {
  const r = parseRecipeText(`Lemony White Bean Soup
Serves 4
Prep time: 10 minutes
Cook time: 25 minutes

Ingredients
2 tbsp olive oil
1 onion, diced
3 cloves garlic, minced
For the finish:
2 (15 oz) cans cannellini beans, drained
4 cups vegetable broth
1 lemon, juiced
Salt to taste

Instructions
1. Warm the oil in a pot over medium heat.
2. Add onion and cook 5 minutes.
Step 3: Add garlic, beans and broth; simmer 15 minutes.
4) Stir in lemon juice and season.

Notes
Great with crusty bread.`);
  assert.equal(r.title, 'Lemony White Bean Soup');
  assert.equal(r.servings, 4);
  assert.equal(r.prepMin, 10);
  assert.equal(r.cookMin, 25);
  assert.equal(r.ingredients.length, 7);
  assert.deepEqual(r.ingredients[3], { qty: 2, unit: 'can', item: 'cannellini beans', note: '15 oz, drained' });
  assert.equal(r.steps.length, 4);
  assert.equal(r.steps[0], 'Warm the oil in a pot over medium heat.');
  assert.equal(r.steps[2], 'Add garlic, beans and broth; simmer 15 minutes.');
  assert.equal(r.notes, 'Great with crusty bread.');
});

test('parses a recipe without headers using heuristics', () => {
  const r = parseRecipeText(`Quick Peanut Noodles
8 oz spaghetti
3 tbsp peanut butter
2 tbsp soy sauce
1 tbsp rice vinegar
Cook the spaghetti according to the package directions and drain.
Whisk the peanut butter, soy sauce and vinegar with a splash of pasta water, then toss with the noodles.`);
  assert.equal(r.title, 'Quick Peanut Noodles');
  assert.equal(r.ingredients.length, 4);
  assert.equal(r.steps.length, 2);
  assert.equal(r.ingredients[1].item, 'peanut butter');
});

test('handles bullets, unicode fractions and "Directions"', () => {
  const r = parseRecipeText(`Ingredients:
• 1½ cups rolled oats
• ¾ cup milk
Directions:
• Stir together.
• Chill overnight.`);
  assert.equal(r.ingredients[0].qty, 1.5);
  assert.equal(r.ingredients[0].item, 'rolled oats');
  assert.equal(r.ingredients[1].qty, 0.75);
  assert.deepEqual(r.steps, ['Stir together.', 'Chill overnight.']);
});
