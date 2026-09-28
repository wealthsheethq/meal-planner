# Meal Planner

A shared meal planning + grocery app for two. Plan the week, build the grocery list in one tap, check things off live on both phones, and cook with a big-text, screen-stays-awake cook mode.

**Live:** https://wealthsheethq.github.io/meal-planner/

Static site for GitHub Pages: no build step, no paid services. Installable (manifest, icons, service worker) and works offline. Edits made offline are saved on the phone and sync when you're back online.

## Features

- **Plan:** a 7-day week (start day configurable) with breakfast, lunch, dinner and snack slots. Add a recipe or a quick note ("Leftovers", "Eat out"…) by tapping, or drag from the recipe shelf. You can drag meals between slots (on phones, press and hold first), set servings per meal, tag who's cooking, and copy last week.
- **Recipes:** photo (compressed to under 150 KB and stored in the doc), ingredients (qty / unit / item / prep note), steps, prep and cook time, servings, tags, rating, favorites and notes. Scale servings on the fly. Paste a recipe as plain text and it gets parsed into ingredients and steps. Comes with 24 original starter recipes you can edit or delete.
- **Import from a link:** paste a recipe website or TikTok link (Recipes → Import, or paste a link into the Paste box, or share a link to the installed app). Websites are read from their schema.org Recipe data. For TikTok, the caption is parsed. You always review before saving. If the recipe is only spoken in the video, a draft is saved with the title, thumbnail and link so you can paste the steps. Every imported recipe keeps its source link and credit. This needs the `import-recipe` Edge Function (see below).
- **Groceries:** build the list from the week's plan. Duplicates are combined with unit conversion (tsp/tbsp/cup, oz/lb, g/kg) and grouped by store section in your own order (defaults to a Harris Teeter walk). Check items off live on both phones. Pantry staples go into an "already have" group. You can add items by hand, and share the list as text.
- **Costs out of the box:** built-in typical US supermarket prices for about 400 common groceries (`js/prices.js`), unit-aware (per lb, oz, each, dozen, gallon, bunch, can…). Recipe ingredients are matched to them (aliases, plurals, typos) and converted (cups of flour to pounds, cloves to heads, eggs to dozens), so every recipe, meal, day, week and grocery list shows a cost right away, labeled **estimate**. Your prices always win: once you enter a price for something it's used from then on, labeled **your price**. "Cheap eats" filter and "Cheapest" sort on Recipes.
- **Receipt scanning:** snap or upload a receipt photo. It's read on the phone with Tesseract.js (loaded from jsDelivr only when you scan; the photo never leaves the device). Lines are matched to your list and to the built-in items, you check and edit everything on a review screen, then the prices are saved as yours and the total is logged as a shopping trip. You can also paste receipt text or log a trip by hand.
- **Spending:** shopping trips, weekly actual spend against your budget, and a 12-week chart.
- **Auto-plan:** choose how many dinners, lunches and breakfasts to fill, a budget cap, max weeknight (Mon–Fri) cook time, and tags to include or avoid. It fills empty slots only, favors favorites and higher ratings, skips anything eaten in the last 2 weeks, and prefers recipes that share ingredients. Lock the picks you like, shuffle one, or regenerate, and see the week's estimated cost before adding anything. "Plan a week under $X" starts it with your budget.
- **Leftovers:** set your household size (default 2). When a recipe makes more servings than you eat, you're offered to put the leftovers in the next open lunch or dinner (within 3 days). Leftovers are marked on the plan and never added to the grocery list again.
- **Nutrition (approximate):** built-in calories, protein, carbs and fat for the same items (`js/nutrition.js`). Per-serving estimates on recipes and cards, and per-person daily totals on the week view.
- **Pantry:** staples with a "running low" switch that puts them on the grocery list. Optional use-by dates, an "Expiring soon" section, and "Use it up" recipe ideas ranked by how many soon-to-expire and on-hand items they use.
- **Settings (More):** household size, weekly budget, US or metric display units, and switches to hide costs or nutrition.
- **Cook mode:** full screen, one step at a time, ingredient checklist, timers detected from step text ("simmer 10 minutes"), and the screen stays awake (Wake Lock API).
- **Kitchen sharing:** rename the kitchen, see members, invite by email, cancel invites, leave, switch or create kitchens.
- **Countdowns and notes (More):** countdowns to trips, birthdays, anniversaries and events (one-off or yearly; a Feb 29 date falls on Feb 28 in other years), and short notes for the kitchen with an optional expiry date. Both sync like everything else and show on the kitchen display.
- **Extras:** "What should we eat?" picks from your favorites, weighted toward things you haven't had lately. Also meal history with "haven't had in a while", search across everything, dark mode, and toasts with undo.

## Kitchen display

An always-on screen for an old tablet or a TV browser mounted in the kitchen: **https://wealthsheethq.github.io/meal-planner/display/** (or **More → Kitchen display** in the app).

- **Sign in** with the same magic link. If the phone app is already signed in in that browser, the display starts on its own. It stays signed in, refreshes its token after the device sleeps, reconnects realtime when it wakes or comes back online, re-checks the kitchen every 5 minutes as a safety net, and reloads itself at 3am to pick up app updates. Offline it runs from cache and shows a small "Reconnecting…" badge instead of errors.
- **Always on screen:** a big clock and date, a greeting that changes with the time of day, the current weather, and notes from the message board.
- **Scenes** that crossfade every 20 seconds (configurable): **Tonight** (tonight's dinner with photo, cook time, who's cooking and a **Start cooking** button that opens cook mode on the display, plus today's and tomorrow's meals with leftovers marked), **Groceries** (live, grouped by store section, tap to check off, item count and estimated total; realtime updates when anyone adds or checks something), **Week** (the next 7 days plus pantry items expiring in the next 3 days and running low), and **Weather & countdowns** (current conditions, 5-day forecast, countdowns and the optional Money HQ panel). Tap a scene, or its name at the bottom, to pin it for 2 minutes.
- **Weather** comes from [Open-Meteo](https://open-meteo.com/) (free, no key), refreshed every 30 minutes, with the last-updated time shown. The default location is Charlotte, NC; search for another city in the display settings.
- **Ambient:** bright mornings, warm afternoons and dim evenings. Night mode (10pm–6am by default) is very dim and shows only the clock, the weather and the next breakfast; a tap wakes the screen for 2 minutes. The Screen Wake Lock API keeps the screen on (re-requested after the tab comes back and after any tap), and the layout drifts a few pixels every 3 minutes to protect against burn-in. There's a fullscreen button, and the display installs as its own app (`display/manifest.webmanifest`).
- **Display settings** (gear icon on the display, or More → Kitchen display on the phone): location, how often scenes change, which scenes to show, night mode hours, °F/°C, 12/24-hour clock, and the Money HQ panel. They're stored in the kitchen doc (`settings` entries named `display.*`), so both places edit the same values.
- **Money HQ (optional, off by default):** a read-only peek at `public.tracker_state`. That table is limited by RLS to one account; the display runs one `select … limit 1` and hides the panel silently when the query is denied, empty or holds nothing it can read. It never writes to it. In privacy mode (on by default) the panel shows only a debt-free progress bar, percent paid and the debt-free month; turning privacy off also shows the remaining and starting totals. The reader in `js/display-core.js` (`parseTracker`) accepts a `debts` (or `accounts`/`loans`) list with balance and original-balance fields, or top-level `totalDebt`/`startingDebt` totals, plus an optional debt-free date; if it can't work out a percentage, the panel stays hidden.

Magic links from the display ask Supabase to send you back to `/display/`. If that address isn't in the project's allowed redirect URLs (Authentication → URL Configuration), Supabase sends you to the app instead, which signs in that browser too. Then open `/display/`.

## How sync works

All app data is one JSON document in `meal_state.data`. It has collections for recipes, plan, grocery, pantry, prices, aisles, history, settings, countdowns and notes. Every entity has `id`, `updatedAt`, `updatedBy` and `deleted`.

`countdowns` (`title`, `date`, `emoji`, `yearly`) and `notes` (`text`, `by`, `expires`) are the newest collections and merge like the rest. A phone still on an older version keeps them as unknown keys; update it (reopen the app) so its saves carry the other phone's newest countdowns and notes.

New features only add optional fields, so existing data keeps working and a phone that hasn't updated yet still merges cleanly: pantry items get `expires`, recipes get `sourceUrl`, `sourceName`, `author` and `draft`, leftovers are plan notes with `leftoverOf`/`leftoverFrom` (older versions show them as a note and never shop for them), and shopping trips are history entries with `type: 'trip'`. Nothing is renamed; readers in `js/core.js` (`readRecipe`, `readPantry`, `readPrice`, `readTrip`, `readSetting`) supply safe defaults.

- **Merge** (`js/core.js`): last-writer-wins on each *field*, using per-field clocks (`_f`). If you both change the same field, the newer write wins. If you change different fields of the same thing at the same time (she checks off milk while you change the quantity), both changes survive. Deletes are tombstones, so a stale copy can't bring a deleted item back. An explicit undo (a newer undelete) can. The merge is commutative, associative and idempotent, so both phones converge.
- **Save** (`js/sync.js`): fetch the latest row, merge, then write with a compare-and-swap on `updated_at`. If the other phone saved in between, it retries.
- **Live:** a Realtime `postgres_changes` subscription on the kitchen's `meal_state` row. Incoming changes are merged the same way. If this phone still holds newer edits after a merge, it pushes them back.
- **Offline:** the doc is cached in IndexedDB with a dirty flag. The service worker caches the app shell, supabase-js and fonts.

Supabase tables, policies and RPCs are used as-is. The app only calls `accept_meal_invites()`, `create_meal_household(p_name)`, ordinary reads and writes that RLS allows, and the optional `import-recipe` Edge Function.

## Deploying the import-recipe Edge Function

"Import from a link" needs one Edge Function. Everything else works without it. It's free on the Supabase free plan and nothing here needs the Supabase CLI.

1. Open the [Supabase dashboard](https://supabase.com/dashboard) and select the Meal Planner project (`fnkdyhmogylbibgsbhgc`).
2. In the left sidebar, click **Edge Functions**.
3. Click **Deploy a new function** and choose **Via Editor**.
4. Set the function name to exactly **`import-recipe`** (the app calls it by this name).
5. Select everything in the editor's starter code and delete it.
6. Open [`supabase/functions/import-recipe/index.ts`](supabase/functions/import-recipe/index.ts) in this repo, copy the whole file, and paste it into the editor. It's one file with no imports, so nothing else needs adding.
7. Click **Deploy function** and wait for it to finish.
8. Open the function's **Details** (or **Settings**) tab and check that JWT verification (**Verify JWT** / **Enforce JWT verification**) is **on**. It's on by default; leave it on. The function also checks for a signed-in user itself.
9. You don't need to add any secrets. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided to every function automatically.
10. Test it: open the app, go to **Recipes → Import**, paste a recipe link and tap **Import**.

To update it later, open **Edge Functions → import-recipe → Code**, paste the new version of the file, and deploy again.

What the function does, and its limits:

- It only answers `POST {"url": "…"}` from signed-in users, and CORS allows only `https://wealthsheethq.github.io`.
- It only fetches `http`/`https` links on the standard ports. It refuses localhost, private, link-local and other internal addresses, and checks again on every redirect (up to 5). Where the runtime supports DNS lookups, it also checks the resolved addresses.
- It stops after 8 seconds in total and never reads more than 2 MB.
- For websites it reads schema.org `Recipe` JSON-LD (including `@graph` and arrays), falling back to microdata. It returns `{ title, ingredients[], steps[], servings, prepTime, cookTime, image, author, sourceUrl }` plus the site name and a small copy of the image.
- For TikTok (`tiktok.com`, `vm.tiktok.com`, `vt.tiktok.com`) it follows the short link, calls TikTok's public oEmbed endpoint and returns the caption as `rawText` along with the title, thumbnail, author and link. The app parses the caption itself.

## Files

```
index.html            page shell
styles.css            design system (light + dark)
js/core.js            pure logic: merge, safe readers for saved data, units, parsing, scaling, sections, dates
js/prices.js          built-in price estimates (~400 items) with unit/size/density data
js/nutrition.js       built-in nutrition per 100 g for the same items
js/pricing.js         ingredient matching, unit conversion, cost estimates (your prices first), nutrition
js/plan.js            auto-plan, leftovers placement, expiring soon + use it up
js/receipt.js         receipt text parsing and matching lines to items
js/importer.js        turns an imported link into a recipe draft
js/config.js          Supabase project URL + anon key and the site address (shared by both pages)
js/display-core.js    kitchen display logic: countdown date math, scenes, night mode, weather parsing, notes, Money HQ
js/display.js         the kitchen display page (display/index.html, display/display.css, display/manifest.webmanifest)
supabase/functions/import-recipe/index.ts   Edge Function for link import (deploy from the dashboard)
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
npm test          # countdown date math, scenes + night mode, weather parsing, notes, Money HQ, merge, units, parsing, scaling, costs, price matching + conversion, your-price override,
                  # receipts, auto-plan, leftovers, use it up, nutrition, JSON-LD/microdata extraction,
                  # TikTok captions, URL safety, migration of saved data
npm run test:display  # Playwright: the kitchen display at 1280x800, 800x1280 and 1920x1080 never scrolls and
                      # logs no errors (mocked Supabase + Open-Meteo); every scene, cook mode, settings, night mode,
                      # live sync with a phone at 375px, countdowns + notes from the phone, Money HQ hidden when denied
npm run test:ui   # Playwright: every screen at 375px + 1280px, no horizontal scroll, no console errors,
                  # import, auto-plan, leftovers, receipt scan (mocked OCR), spending, pantry, settings,
                  # share target, two-phone live sync
```

`test:ui` needs Playwright with Chromium available. It serves the repo locally, swaps supabase-js for `tests/mock-supabase.js` (which includes a stand-in for the import function) and Tesseract.js for a canned OCR result. The Edge Function tests import `index.ts` directly, which needs Node 22.18+ (built-in TypeScript type stripping).
