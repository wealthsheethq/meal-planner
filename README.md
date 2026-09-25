# Meal Planner

A shared meal planning + grocery app for two. Plan the week, build the grocery list in one tap, check things off live on both phones, and cook with a big-text, screen-stays-awake cook mode.

**Live:** https://wealthsheethq.github.io/meal-planner/

Static site for GitHub Pages: no build step, no paid services. Installable (manifest, icons, service worker) and works offline. Edits made offline are saved on the phone and sync when you're back online.

## Features

- **Plan:** a 7-day week (start day configurable) with breakfast, lunch, dinner and snack slots. Add a recipe or a quick note ("Leftovers", "Eat out"…) by tapping, or drag from the recipe shelf. You can drag meals between slots (on phones, press and hold first), set servings per meal, tag who's cooking, and copy last week.
- **Recipes:** photo (compressed to under 150 KB and stored in the doc), ingredients (qty / unit / item / prep note), steps, prep and cook time, servings, tags, rating, favorites and notes. Scale servings on the fly. Paste a recipe as plain text and it gets parsed into ingredients and steps. Comes with 24 original starter recipes you can edit or delete.
- **Groceries:** build the list from the week's plan. Duplicates are combined with unit conversion (tsp/tbsp/cup, oz/lb, g/kg) and grouped by store section in your own order (defaults to a Harris Teeter walk). Check items off live on both phones. Pantry staples go into an "already have" group. You can add items by hand, and share the list as text.
- **Prices & budget:** remembers the last price you entered per item. Estimates each meal's cost, cost per serving and the week's grocery total, and shows a progress bar against your weekly budget.
- **Pantry:** staples with a "running low" switch that puts them on the grocery list.
- **Cook mode:** full screen, one step at a time, ingredient checklist, timers detected from step text ("simmer 10 minutes"), and the screen stays awake (Wake Lock API).
- **Kitchen sharing:** rename the kitchen, see members, invite by email, cancel invites, leave, switch or create kitchens.
- **Extras:** "What should we eat?" picks from your favorites, weighted toward things you haven't had lately. Also meal history with "haven't had in a while", search across everything, dark mode, and toasts with undo.

## How sync works

All app data is one JSON document in `meal_state.data`. It has collections for recipes, plan, grocery, pantry, prices, aisles, history and settings. Every entity has `id`, `updatedAt`, `updatedBy` and `deleted`.

- **Merge** (`js/core.js`): last-writer-wins on each *field*, using per-field clocks (`_f`). If you both change the same field, the newer write wins. If you change different fields of the same thing at the same time (she checks off milk while you change the quantity), both changes survive. Deletes are tombstones, so a stale copy can't bring a deleted item back. An explicit undo (a newer undelete) can. The merge is commutative, associative and idempotent, so both phones converge.
- **Save** (`js/sync.js`): fetch the latest row, merge, then write with a compare-and-swap on `updated_at`. If the other phone saved in between, it retries.
- **Live:** a Realtime `postgres_changes` subscription on the kitchen's `meal_state` row. Incoming changes are merged the same way. If this phone still holds newer edits after a merge, it pushes them back.
- **Offline:** the doc is cached in IndexedDB with a dirty flag. The service worker caches the app shell, supabase-js and fonts.

Supabase tables, policies and RPCs are used as-is. The app only calls `accept_meal_invites()`, `create_meal_household(p_name)` and ordinary reads and writes that RLS allows.

## Files

```
index.html            page shell
styles.css            design system (light + dark)
js/core.js            pure logic: merge, units, parsing, scaling, costs, sections, dates
js/sync.js            IndexedDB cache + Supabase fetch/merge/update + realtime
js/ui.js              icons, sheets, toasts, drag & drop, photo compression
js/app.js             screens and actions
js/seed.js            24 original starter recipes + pantry staples
sw.js, manifest.webmanifest, icons/
tests/*.test.mjs      unit tests (node:test)
tests/ui-check.mjs    browser check with a mocked Supabase
```

## Tests

```sh
npm test          # merge, unit conversion + combining, recipe parsing, scaling, cost math
npm run test:ui   # Playwright: 375px + 1280px, no horizontal scroll, no console errors, two-phone live sync
```

`test:ui` needs Playwright with Chromium available. It serves the repo locally and swaps supabase-js for `tests/mock-supabase.js`.
