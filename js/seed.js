// Original starter recipes + pantry staples. Seeded with fixed ids and an ancient
// clock (updatedAt: 1) so seeding twice, or on both phones at once, merges cleanly
// and any edit or delete always wins.
import { parseIngredient, itemKey, guessSection } from './core.js';

const R = (id, title, emoji, tags, servings, prepMin, cookMin, ingredients, steps, notes = '') =>
  ({ id: 'seed-' + id, title, emoji, tags, servings, prepMin, cookMin, ingredients, steps, notes });

const RAW = [
  // ---------- Breakfasts ----------
  R('b1', 'Brown Butter Banana Oat Pancakes', '🥞', ['Breakfast', 'Vegetarian', 'Weekend'], 4, 10, 20, [
    '2 tbsp butter', '2 ripe bananas', '2 large eggs', '1 cup milk', '1 cup rolled oats', '3/4 cup all-purpose flour',
    '2 tsp baking powder', '1/2 tsp cinnamon', '1/4 tsp salt', 'Maple syrup, for serving',
  ], [
    'Melt the butter in a small pan over medium heat and let it foam until it smells nutty and turns golden, about 3 minutes. Let cool slightly.',
    'In a large bowl, mash the bananas, then whisk in the eggs, milk and browned butter.',
    'Stir in the oats, flour, baking powder, cinnamon and salt until just combined. Rest 5 minutes so the oats soften.',
    'Heat a lightly buttered griddle over medium. Pour 1/4 cup batter per pancake and cook until bubbles form, about 2 minutes, then flip and cook 1 minute more.',
    'Serve warm with maple syrup and extra sliced banana.',
  ], 'Batter keeps in the fridge overnight — add a splash of milk in the morning.'),
  R('b2', 'Green Shakshuka with Feta', '🍳', ['Breakfast', 'Vegetarian', 'Gluten-free'], 2, 10, 20, [
    '2 tbsp olive oil', '1 leek, thinly sliced', '2 cloves garlic, sliced', '1 small zucchini, diced', '4 cups baby spinach',
    '1/2 tsp ground cumin', '4 large eggs', '2 oz feta, crumbled', '1/4 cup fresh dill, chopped', 'Salt and pepper to taste',
  ], [
    'Warm the olive oil in a 10-inch skillet over medium heat. Add the leek and a pinch of salt and cook until soft, about 6 minutes.',
    'Add the garlic, zucchini and cumin; cook 3 minutes. Stir in the spinach a handful at a time until wilted.',
    'Make 4 wells in the greens and crack an egg into each. Cover and cook on medium-low 5 to 7 minutes, until the whites are set.',
    'Scatter the feta and dill over the top, season with pepper and serve straight from the pan.',
  ]),
  R('b3', 'Overnight Oats, Three Ways', '🥣', ['Breakfast', 'Vegetarian', 'Make-ahead', 'Quick'], 2, 5, 0, [
    '1 cup rolled oats', '1 cup milk', '1/2 cup plain Greek yogurt', '1 tbsp chia seeds', '1 tbsp maple syrup', '1/2 tsp vanilla extract',
    '1 cup mixed berries', '2 tbsp peanut butter',
  ], [
    'Stir the oats, milk, yogurt, chia seeds, maple syrup and vanilla together in a bowl or two jars.',
    'Cover and refrigerate at least 4 hours or overnight.',
    'In the morning, loosen with a splash of milk. Top one with berries and one with a swirl of peanut butter — or go half and half.',
  ], 'Keeps 3 days in the fridge. Swap berries for grated apple + cinnamon in the fall.'),
  R('b4', 'Sheet-Pan Breakfast Hash', '🥔', ['Breakfast', 'Gluten-free', 'Weekend'], 4, 10, 30, [
    '1 1/2 lb Yukon Gold potatoes, cut in 3/4-inch cubes', '1 red bell pepper, diced', '1 red onion, diced', '3 tbsp olive oil',
    '1 tsp smoked paprika', '1/2 tsp garlic powder', '1 tsp salt', '8 oz breakfast sausage', '4 large eggs', '2 scallions, sliced',
  ], [
    'Heat the oven to 425°F.',
    'Toss the potatoes, pepper and onion with the oil, paprika, garlic powder and salt on a sheet pan. Roast 20 minutes.',
    'Crumble the sausage over the vegetables, stir, and roast 8 minutes more.',
    'Make 4 wells, crack in the eggs and bake 6 to 8 minutes, until the whites are set.',
    'Finish with scallions and plenty of black pepper.',
  ]),
  R('b5', 'Savory Cottage Cheese Toast', '🍞', ['Breakfast', 'Vegetarian', 'Quick'], 2, 5, 3, [
    '2 thick slices sourdough bread', '3/4 cup cottage cheese', '1 cup cherry tomatoes, halved', '1/2 small cucumber, sliced',
    '1 tbsp olive oil', '1 tsp everything bagel seasoning', '1 tbsp fresh chives, chopped',
  ], [
    'Toast the bread until deeply golden.',
    'Spread each slice thickly with cottage cheese.',
    'Pile on tomatoes and cucumber, drizzle with olive oil and shower with seasoning and chives.',
  ]),
  R('b6', 'Spiced Pumpkin Baked Oatmeal', '🎃', ['Breakfast', 'Vegetarian', 'Make-ahead'], 6, 10, 35, [
    '2 1/2 cups rolled oats', '1 tsp baking powder', '1 1/2 tsp pumpkin pie spice', '1/2 tsp salt', '1 cup pumpkin puree',
    '1 1/2 cups milk', '2 large eggs', '1/3 cup maple syrup', '2 tbsp butter, melted', '1/2 cup pecans, chopped',
  ], [
    'Heat the oven to 375°F and butter an 8x8-inch baking dish.',
    'In a bowl, mix the oats, baking powder, spice and salt.',
    'In another bowl whisk the pumpkin, milk, eggs, maple syrup and melted butter. Stir into the oats.',
    'Pour into the dish, scatter with pecans and bake 35 minutes, until set in the center.',
    'Cut into squares. Reheat slices with a splash of milk through the week.',
  ]),

  // ---------- Lunches ----------
  R('l1', 'Crunchy Chickpea Shawarma Wraps', '🌯', ['Lunch', 'Vegetarian', 'Quick'], 4, 10, 15, [
    '2 (15 oz) cans chickpeas, drained and patted dry', '2 tbsp olive oil', '2 tsp shawarma spice blend', '1/2 tsp salt',
    '4 large flour tortillas', '1/2 cup hummus', '2 cups shredded romaine', '1 cup cherry tomatoes, quartered',
    '1/2 red onion, thinly sliced', '1/2 cup plain Greek yogurt', '1 lemon',
  ], [
    'Heat the oven to 425°F. Toss the chickpeas with oil, spice and salt on a sheet pan; roast 15 minutes, shaking once, until crisp.',
    'Stir the yogurt with a squeeze of lemon and a pinch of salt.',
    'Warm the tortillas, spread each with hummus and fill with romaine, tomatoes, onion and chickpeas.',
    'Drizzle with lemon yogurt, roll up tightly and slice in half.',
  ]),
  R('l2', 'Sesame Soba Noodle Salad', '🥢', ['Lunch', 'Vegetarian', 'Make-ahead'], 4, 15, 8, [
    '8 oz soba noodles', '3 tbsp soy sauce', '2 tbsp rice vinegar', '1 tbsp toasted sesame oil', '1 tbsp honey', '1 tbsp fresh ginger, grated',
    '1 cup shelled edamame', '1 English cucumber, cut in matchsticks', '2 carrots, shredded', '3 scallions, sliced', '2 tbsp sesame seeds',
  ], [
    'Cook the soba according to the package, adding the edamame for the last 2 minutes. Drain and rinse under cold water.',
    'Whisk the soy sauce, vinegar, sesame oil, honey and ginger in a large bowl.',
    'Add the noodles, edamame, cucumber, carrots and scallions and toss well.',
    'Top with sesame seeds. Eat right away or pack for lunches — it keeps 3 days.',
  ]),
  R('l3', 'Chicken, Apple & Cheddar Grain Bowls', '🥗', ['Lunch', 'Make-ahead'], 4, 20, 20, [
    '1 cup farro', '1 lb chicken breast', '1 tsp salt', '1/2 tsp black pepper', '1 tbsp olive oil', '2 crisp apples, diced',
    '4 oz sharp cheddar, cubed', '4 cups baby arugula', '1/2 cup toasted walnuts', '3 tbsp apple cider vinegar', '1 tbsp Dijon mustard',
    '1 tbsp honey', '1/3 cup olive oil',
  ], [
    'Simmer the farro in salted water until chewy-tender, about 20 minutes. Drain.',
    'Season the chicken with salt and pepper. Sear in 1 tbsp oil over medium-high 6 minutes per side, until cooked through. Rest, then slice.',
    'Shake the vinegar, mustard, honey and 1/3 cup oil in a jar with a pinch of salt.',
    'Divide farro and arugula among bowls; top with chicken, apple, cheddar and walnuts. Dress just before eating.',
  ]),
  R('l4', 'Tomato-Basil Soup with Grilled Cheese Dippers', '🍅', ['Lunch', 'Vegetarian', 'Comfort'], 4, 10, 30, [
    '2 tbsp butter', '1 yellow onion, chopped', '3 cloves garlic, smashed', '1 (28 oz) can whole peeled tomatoes', '2 cups vegetable broth',
    '1/2 tsp sugar', '1/2 cup heavy cream', '1/2 cup fresh basil leaves', '8 slices sandwich bread', '6 oz cheddar, sliced', 'Salt and pepper to taste',
  ], [
    'Melt the butter in a pot over medium heat. Cook the onion until soft, 8 minutes; add garlic for 1 minute.',
    'Add the tomatoes with their juices, the broth and sugar. Simmer 20 minutes.',
    'Add the basil and blend until smooth. Stir in the cream and season.',
    'Meanwhile make grilled cheese sandwiches in a buttered skillet, 3 minutes per side. Cut into strips for dunking.',
  ]),
  R('l5', 'Lemony Tuna & White Bean Salad', '🐟', ['Lunch', 'Quick', 'Gluten-free'], 2, 10, 0, [
    '1 (5 oz) can tuna in olive oil', '1 (15 oz) can cannellini beans, drained and rinsed', '1/4 red onion, finely diced',
    '1 celery stalk, diced', '2 tbsp capers', '1/4 cup fresh parsley, chopped', '1 lemon', '2 tbsp olive oil', 'Salt and pepper to taste',
  ], [
    'Flake the tuna into a bowl with a little of its oil.',
    'Add the beans, onion, celery, capers and parsley.',
    'Zest the lemon over the top, squeeze in the juice, add the olive oil and toss. Season well.',
    'Eat on greens, stuffed in a pita or on toasted bread.',
  ]),
  R('l6', 'Turkey Pesto Paninis', '🥪', ['Lunch', 'Quick'], 2, 5, 8, [
    '4 slices ciabatta', '2 tbsp basil pesto', '6 oz sliced deli turkey', '2 oz fresh mozzarella, sliced',
    '1/2 cup roasted red peppers', '1 cup baby spinach', '1 tbsp olive oil',
  ], [
    'Spread the pesto on the inside of the bread.',
    'Layer turkey, mozzarella, red peppers and spinach; close the sandwiches.',
    'Brush the outsides with oil and cook in a skillet over medium, pressing with a heavy pan, 3 to 4 minutes per side until melty.',
  ]),

  // ---------- Weeknight dinners ----------
  R('d1', 'Honey-Garlic Chicken Thighs with Green Beans', '🍗', ['Dinner', 'Weeknight', 'Gluten-free', 'Sheet pan'], 4, 10, 25, [
    '2 lb boneless skinless chicken thighs', '1 lb green beans, trimmed', '2 tbsp olive oil', '1 tsp salt', '1/4 cup honey',
    '3 tbsp soy sauce', '4 cloves garlic, minced', '1 tbsp rice vinegar', '1 tsp cornstarch', '1 tbsp sesame seeds',
  ], [
    'Heat the oven to 425°F. Toss the chicken and green beans with oil and salt on a sheet pan, keeping the chicken in the center.',
    'Roast 15 minutes.',
    'Meanwhile whisk the honey, soy sauce, garlic, vinegar and cornstarch in a small pot; simmer 2 minutes until glossy.',
    'Brush half the glaze over the chicken and roast 8 minutes more, until the chicken reaches 175°F.',
    'Brush with remaining glaze, sprinkle with sesame seeds and serve with rice.',
  ]),
  R('d2', 'One-Pot Creamy Tuscan Orzo', '🍝', ['Dinner', 'Weeknight', 'Vegetarian', 'One pot'], 4, 10, 20, [
    '2 tbsp olive oil', '1 shallot, minced', '3 cloves garlic, minced', '1/3 cup sun-dried tomatoes, chopped', '1 1/2 cups orzo',
    '4 cups vegetable broth', '1/2 tsp red pepper flakes', '3 cups baby spinach', '1/2 cup grated Parmesan', '1/3 cup heavy cream',
    '1 lemon', 'Fresh basil, for serving',
  ], [
    'Warm the oil in a wide pot over medium heat. Cook the shallot 2 minutes, then the garlic and sun-dried tomatoes for 1 minute.',
    'Stir in the orzo and toast 1 minute. Add the broth and pepper flakes and bring to a simmer.',
    'Cook, stirring often, 10 to 12 minutes, until the orzo is tender and most of the liquid is absorbed.',
    'Stir in the spinach, Parmesan, cream and a squeeze of lemon. Top with torn basil.',
  ], 'Add a can of drained white beans or leftover chicken for extra protein.'),
  R('d3', 'Crispy Black Bean Tacos with Lime Slaw', '🌮', ['Dinner', 'Weeknight', 'Vegetarian', 'Quick'], 4, 15, 15, [
    '2 (15 oz) cans black beans, drained', '1 tsp ground cumin', '1 tsp chili powder', '1/2 tsp garlic powder', '1 cup shredded Monterey Jack',
    '8 corn tortillas', '2 tbsp olive oil', '3 cups shredded cabbage', '1/4 cup fresh cilantro, chopped', '2 limes', '1/4 cup sour cream',
    '1 avocado, sliced',
  ], [
    'Mash the beans with the cumin, chili powder, garlic powder and a pinch of salt, leaving some texture.',
    'Toss the cabbage with cilantro, the juice of 1 lime and a pinch of salt.',
    'Fill each tortilla with beans and cheese, fold in half and brush with oil.',
    'Cook in a large skillet over medium-high 3 minutes per side, until crisp and melty. Work in batches.',
    'Open the tacos and stuff with slaw, avocado and a dollop of sour cream. Serve with lime wedges.',
  ]),
  R('d4', 'Miso-Glazed Salmon with Bok Choy', '🍣', ['Dinner', 'Weeknight', 'Quick'], 2, 10, 12, [
    '2 salmon fillets (6 oz each)', '2 tbsp white miso', '1 tbsp maple syrup', '1 tbsp rice vinegar', '1 tsp toasted sesame oil',
    '4 baby bok choy, halved', '1 tbsp neutral oil', '1 scallion, sliced', '1 cup jasmine rice',
  ], [
    'Start the rice. Heat the broiler with a rack 6 inches from the heat.',
    'Stir the miso, maple syrup, vinegar and sesame oil together. Spread over the salmon on a foil-lined sheet pan.',
    'Toss the bok choy with oil and arrange around the fish.',
    'Broil 7 to 9 minutes, until the glaze is caramelized and the salmon flakes.',
    'Scatter with scallions and serve over rice.',
  ]),
  R('d5', 'Weeknight Turkey Chili', '🌶️', ['Dinner', 'Weeknight', 'Gluten-free', 'Freezer-friendly'], 6, 15, 35, [
    '1 tbsp olive oil', '1 yellow onion, diced', '1 red bell pepper, diced', '3 cloves garlic, minced', '1 1/4 lb ground turkey',
    '2 tbsp chili powder', '2 tsp ground cumin', '1 tsp smoked paprika', '1 (28 oz) can crushed tomatoes', '1 (15 oz) can kidney beans, drained',
    '1 (15 oz) can black beans, drained', '1 cup chicken broth', '1 tsp salt', 'Shredded cheddar, for serving',
  ], [
    'Heat the oil in a Dutch oven over medium-high. Cook the onion and pepper 6 minutes, then the garlic 1 minute.',
    'Add the turkey and brown, breaking it up, about 6 minutes.',
    'Stir in the spices and cook 1 minute until fragrant.',
    'Add the tomatoes, beans, broth and salt. Simmer uncovered 25 minutes, stirring now and then.',
    'Taste, adjust seasoning and serve with cheddar, sour cream and scallions.',
  ], 'Freezes beautifully for up to 3 months.'),
  R('d6', 'Sheet-Pan Sausage, Peppers & Potatoes', '🫑', ['Dinner', 'Weeknight', 'Sheet pan', 'Gluten-free'], 4, 10, 30, [
    '1 lb smoked sausage, sliced', '1 1/2 lb baby potatoes, halved', '2 bell peppers, sliced', '1 red onion, cut in wedges',
    '3 tbsp olive oil', '1 tsp Italian seasoning', '1/2 tsp garlic powder', '1 tsp salt', '2 tbsp whole-grain mustard', '1 tbsp honey',
  ], [
    'Heat the oven to 425°F.',
    'Toss the potatoes with half the oil and salt; roast 15 minutes.',
    'Add the sausage, peppers and onion with the remaining oil, Italian seasoning and garlic powder. Roast 15 minutes more.',
    'Whisk the mustard and honey and drizzle over the pan before serving.',
  ]),
  R('d7', 'Coconut Red Curry with Shrimp', '🍤', ['Dinner', 'Weeknight', 'Gluten-free', 'Quick'], 4, 10, 20, [
    '1 tbsp coconut oil', '1 shallot, sliced', '1 tbsp fresh ginger, grated', '3 tbsp red curry paste', '1 (13.5 oz) can coconut milk',
    '1/2 cup chicken broth', '1 tbsp fish sauce', '1 tsp brown sugar', '1 red bell pepper, sliced', '2 cups snap peas',
    '1 lb large shrimp, peeled and deveined', '1 lime', '1/4 cup fresh basil leaves', '1 1/2 cups jasmine rice',
  ], [
    'Start the rice.',
    'Warm the coconut oil in a large skillet over medium. Cook the shallot and ginger 2 minutes; add the curry paste and fry 1 minute.',
    'Whisk in the coconut milk, broth, fish sauce and sugar. Simmer 5 minutes.',
    'Add the pepper and snap peas; cook 3 minutes. Add the shrimp and simmer 3 to 4 minutes, until pink.',
    'Finish with lime juice and basil. Serve over rice.',
  ]),
  R('d8', 'Baked Ricotta Meatballs in Marinara', '🧆', ['Dinner', 'Comfort', 'Freezer-friendly'], 4, 20, 25, [
    '1 lb ground beef', '1/2 cup whole-milk ricotta', '1/2 cup panko breadcrumbs', '1/3 cup grated Parmesan', '1 large egg',
    '2 cloves garlic, grated', '1 tsp salt', '1/2 tsp dried oregano', '1 (24 oz) jar marinara sauce', '4 oz fresh mozzarella', '12 oz spaghetti',
  ], [
    'Heat the oven to 425°F.',
    'Gently mix the beef, ricotta, panko, Parmesan, egg, garlic, salt and oregano. Roll into 16 meatballs.',
    'Pour the marinara into a baking dish, nestle in the meatballs and bake 20 minutes.',
    'Tear the mozzarella over the top and bake 5 minutes more. Meanwhile cook the spaghetti.',
    'Serve the meatballs and sauce over spaghetti with more Parmesan.',
  ]),
  R('d9', 'Chicken Fajita Rice Bowls', '🍚', ['Dinner', 'Weeknight', 'Gluten-free'], 4, 15, 20, [
    '1 1/2 lb chicken breast, sliced thin', '2 bell peppers, sliced', '1 yellow onion, sliced', '2 tbsp olive oil', '2 tsp chili powder',
    '1 tsp ground cumin', '1 tsp smoked paprika', '1 tsp salt', '1 1/2 cups long-grain rice', '1 cup corn kernels', '1 cup pico de gallo',
    '1/2 cup sour cream', '1 lime',
  ], [
    'Cook the rice.',
    'Toss the chicken with the spices, salt and 1 tbsp oil.',
    'Sear the chicken in a large skillet over high heat 5 to 6 minutes; transfer to a plate.',
    'Add the remaining oil, peppers, onion and corn; cook 6 minutes until charred at the edges. Return the chicken and squeeze in lime.',
    'Serve over rice with pico de gallo and sour cream.',
  ]),
  R('d10', 'Crispy Gnocchi with Brussels Sprouts & Brown Butter', '🥟', ['Dinner', 'Weeknight', 'Vegetarian'], 3, 10, 20, [
    '1 (16 oz) package shelf-stable gnocchi', '12 oz Brussels sprouts, halved', '2 tbsp olive oil', '3 tbsp butter', '8 fresh sage leaves',
    '1/4 cup grated Parmesan', '1/2 lemon', 'Salt and pepper to taste',
  ], [
    'Heat the oil in a large nonstick skillet over medium-high. Add the gnocchi in one layer and cook without stirring 4 minutes, until golden; toss and cook 3 minutes more. Remove.',
    'Add the Brussels sprouts cut-side down with a pinch of salt; cook 6 minutes until charred and tender.',
    'Add the butter and sage and cook until the butter browns, about 2 minutes.',
    'Return the gnocchi, squeeze in lemon, toss with Parmesan and season with pepper.',
  ]),
  R('d11', 'Ginger Pork Lettuce Cups', '🥬', ['Dinner', 'Weeknight', 'Quick'], 4, 10, 12, [
    '1 lb ground pork', '1 tbsp neutral oil', '3 cloves garlic, minced', '1 tbsp fresh ginger, grated', '1 (8 oz) can water chestnuts, chopped',
    '3 tbsp hoisin sauce', '1 tbsp soy sauce', '1 tsp sriracha', '1 head butter lettuce', '1 carrot, shredded', '2 scallions, sliced',
    '1/4 cup roasted peanuts, chopped',
  ], [
    'Heat the oil in a skillet over medium-high. Brown the pork, breaking it up, 6 minutes.',
    'Add the garlic, ginger and water chestnuts; cook 2 minutes.',
    'Stir in the hoisin, soy sauce and sriracha; simmer 1 minute until glossy.',
    'Spoon into lettuce leaves and top with carrot, scallions and peanuts.',
  ]),
  R('d12', 'Lemon-Herb Roast Chicken & Vegetables', '🍋', ['Dinner', 'Weekend', 'Gluten-free', 'Comfort'], 4, 20, 70, [
    '1 whole chicken (about 4 lb)', '1 lemon, halved', '4 cloves garlic, smashed', '4 sprigs fresh thyme', '2 tbsp butter, softened',
    '1 1/2 tsp salt', '1 lb carrots, cut in chunks', '1 lb baby potatoes', '1 red onion, cut in wedges', '2 tbsp olive oil',
  ], [
    'Heat the oven to 425°F. Pat the chicken dry and season inside and out with salt.',
    'Stuff the cavity with lemon, garlic and thyme. Rub the skin with softened butter.',
    'Toss the carrots, potatoes and onion with oil in a roasting pan and set the chicken on top.',
    'Roast 1 hour 10 minutes, until the thigh reaches 165°F and the juices run clear.',
    'Rest 15 minutes before carving. Spoon the pan juices over everything.',
  ], 'Save the carcass in the freezer for stock.'),
];

export const SEED_RECIPES = RAW.map(r => ({
  ...r,
  ingredients: r.ingredients.map((line, i) => ({ id: 'i' + i, ...parseIngredient(line) })),
  rating: 0,
  fav: false,
  photo: '',
  seeded: true,
}));

const PANTRY = [
  'Olive oil', 'Neutral oil', 'Butter', 'Eggs', 'Milk', 'Salt', 'Black pepper', 'Garlic', 'Yellow onions', 'All-purpose flour', 'Sugar',
  'Rice', 'Pasta', 'Soy sauce', 'Honey', 'Maple syrup', 'Ground cumin', 'Chili powder', 'Smoked paprika', 'Red pepper flakes',
  'Chicken broth', 'Canned tomatoes', 'Rolled oats', 'Parmesan',
];

export const SEED_PANTRY = PANTRY.map(name => ({ id: 'pantry-' + itemKey(name).replace(/\s+/g, '-'), name, section: guessSection(name), low: false }));
