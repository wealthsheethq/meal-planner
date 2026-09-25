import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkUrl, isPrivateIPv4, isPrivateIPv6, extractRecipe, extractJsonLdRecipe, extractMicrodataRecipe, durationMinutes, servingsFrom,
  captionToText, canonicalTikTok, isTikTok, handle, corsHeaders, readCapped, ALLOWED_ORIGIN, decodeEntities,
} from '../supabase/functions/import-recipe/index.ts';
import { findUrl, isMostlyUrl, safeUrl, importToDraft, importErrorMessage } from '../js/importer.js';

const page = (...ld) => `<!doctype html><html><head><title>Page title</title><meta property="og:site_name" content="Test Kitchen">
  ${ld.map(x => `<script type="application/ld+json">${typeof x === 'string' ? x : JSON.stringify(x)}</script>`).join('\n')}</head><body>hi</body></html>`;
const BASE = 'https://cooking.example.com/recipes/chili';

/* ---------- JSON-LD shapes seen in the wild ---------- */

test('JSON-LD: a plain Recipe object (string instructions, ISO durations)', () => {
  const r = extractRecipe(page({
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Weeknight Chili', recipeYield: '6 servings', prepTime: 'PT15M', cookTime: 'PT1H',
    recipeIngredient: ['1 lb ground beef', '1 onion, diced', '2 tbsp chili powder'], recipeInstructions: 'Brown the beef.\nAdd the onion.\nSimmer.',
    image: 'https://cdn.example.com/chili.jpg', author: { '@type': 'Person', name: 'Jane Cook' },
  }), BASE);
  assert.equal(r.title, 'Weeknight Chili');
  assert.deepEqual(r.ingredients, ['1 lb ground beef', '1 onion, diced', '2 tbsp chili powder']);
  assert.deepEqual(r.steps, ['Brown the beef.', 'Add the onion.', 'Simmer.']);
  assert.deepEqual([r.servings, r.prepTime, r.cookTime], [6, 15, 60]);
  assert.equal(r.image, 'https://cdn.example.com/chili.jpg');
  assert.equal(r.author, 'Jane Cook');
  assert.equal(r.sourceUrl, BASE);
  assert.equal(r.site, 'Test Kitchen');
});

test('JSON-LD: Yoast-style @graph with HowToStep list, image object, author array', () => {
  const r = extractRecipe(page({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': BASE, name: 'Chili - Test Kitchen' },
      { '@type': 'Person', name: 'Someone else' },
      { '@type': ['Recipe', 'NewsArticle'], name: 'Graph Chili', recipeYield: ['4', '4 bowls'], totalTime: 'PT45M', prepTime: 'PT10M',
        image: { '@type': 'ImageObject', url: '/img/chili.webp' }, author: [{ '@type': 'Person', name: 'Ana' }, { '@type': 'Person', name: 'Bo' }],
        recipeIngredient: ['2 cups beans &amp; liquid', '1 tsp <b>cumin</b>'],
        recipeInstructions: [{ '@type': 'HowToStep', text: 'Step one.' }, { '@type': 'HowToStep', name: 'Step two.', text: 'Step two, longer.' }] },
    ],
  }), BASE);
  assert.equal(r.title, 'Graph Chili');
  assert.deepEqual(r.ingredients, ['2 cups beans & liquid', '1 tsp cumin']);
  assert.deepEqual(r.steps, ['Step one.', 'Step two, longer.']);
  assert.deepEqual([r.servings, r.prepTime, r.cookTime], [4, 10, 35]); // cook = total - prep
  assert.equal(r.image, 'https://cooking.example.com/img/chili.webp');
  assert.equal(r.author, 'Ana, Bo');
});

test('JSON-LD: top-level array, HowToSection groups, HTML-comment wrapper, second block', () => {
  const html = page(
    { '@type': 'Organization', name: 'Site' },
    `<!--${JSON.stringify([{ '@type': 'BreadcrumbList' }, {
      '@type': 'Recipe', name: 'Sectioned Cake', recipeYield: 12, recipeIngredient: ['2 cups flour'],
      recipeInstructions: [
        { '@type': 'HowToSection', name: 'Cake', itemListElement: [{ '@type': 'HowToStep', text: 'Mix.' }, { '@type': 'HowToStep', text: 'Bake 30 minutes.' }] },
        { '@type': 'HowToSection', name: 'Frosting', itemListElement: [{ '@type': 'HowToStep', text: 'Whip.' }] },
      ],
      image: ['https://x.example/a.jpg', 'https://x.example/b.jpg'],
    }])}-->`);
  const r = extractJsonLdRecipe(html, BASE);
  assert.equal(r.title, 'Sectioned Cake');
  assert.deepEqual(r.steps, ['Mix.', 'Bake 30 minutes.', 'Whip.']);
  assert.equal(r.servings, 12);
  assert.equal(r.image, 'https://x.example/a.jpg');
});

test('JSON-LD: mainEntity nesting, numbered-string instructions, trailing commas', () => {
  const json = `{"@context":"http://schema.org","@type":"WebPage","mainEntity":{"@type":"http://schema.org/Recipe","name":"Pancakes","recipeIngredient":["1 cup flour","1 egg",],
    "recipeInstructions":"1. Whisk everything. 2. Cook on a hot griddle. 3. Serve.","recipeYield":"Makes 8 pancakes","cookTime":"P0DT0H20M"},}`;
  const r = extractJsonLdRecipe(page(json), BASE);
  assert.equal(r.title, 'Pancakes');
  assert.deepEqual(r.ingredients, ['1 cup flour', '1 egg']);
  assert.deepEqual(r.steps, ['Whisk everything.', 'Cook on a hot griddle.', 'Serve.']);
  assert.deepEqual([r.servings, r.cookTime], [8, 20]);
});

test('microdata fallback', () => {
  const html = `<html><body><div itemscope itemtype="https://schema.org/Recipe">
    <h1 itemprop="name">Grandma's Soup</h1><img itemprop="image" src="/soup.jpg">
    <span itemprop="author">Grandma</span><meta itemprop="prepTime" content="PT20M"><meta itemprop="cookTime" content="PT40M">
    <span itemprop="recipeYield">Serves 4</span>
    <ul><li itemprop="recipeIngredient">1 onion</li><li itemprop="recipeIngredient">4 cups <a href="#">broth</a></li></ul>
    <div itemprop="recipeInstructions"><p>Chop the onion.</p><p>Simmer in broth.</p></div>
  </div></body></html>`;
  assert.equal(extractJsonLdRecipe(html, BASE), null);
  const r = extractMicrodataRecipe(html, BASE);
  assert.equal(r.title, "Grandma's Soup");
  assert.deepEqual(r.ingredients, ['1 onion', '4 cups broth']);
  assert.deepEqual(r.steps, ['Chop the onion.', 'Simmer in broth.']);
  assert.deepEqual([r.servings, r.prepTime, r.cookTime, r.author], [4, 20, 40, 'Grandma']);
  assert.equal(r.image, 'https://cooking.example.com/soup.jpg');
  assert.equal(extractRecipe(html, BASE).title, "Grandma's Soup");
});

test('no recipe markup: title, image and description from meta tags', () => {
  const html = '<html><head><meta property="og:title" content="A Story About Soup"><meta property="og:image" content="https://i.example/s.png"><meta name="description" content="Some words"></head></html>';
  const r = extractRecipe(html, BASE);
  assert.deepEqual([r.title, r.image, r.ingredients.length, r.steps.length, r.rawText], ['A Story About Soup', 'https://i.example/s.png', 0, 0, 'Some words']);
});

test('durations, yields and entities', () => {
  assert.equal(durationMinutes('PT1H30M'), 90);
  assert.equal(durationMinutes('PT90S'), 2);
  assert.equal(durationMinutes('1 hr 15 mins'), 75);
  assert.equal(durationMinutes('PT0M'), null);
  assert.equal(durationMinutes(null), null);
  assert.equal(servingsFrom(['Serves 4-6']), 4);
  assert.equal(servingsFrom('abc'), null);
  assert.equal(decodeEntities('Mac &amp; cheese &#8211; &frac12; cup &#x2019;'), 'Mac & cheese – ½ cup ’');
});

/* ---------- TikTok ---------- */

test('TikTok caption -> recipe text the app can parse', () => {
  const { title, text } = captionToText('Easy garlic butter noodles 🍜 Ingredients: 8 oz spaghetti, 4 cloves garlic, 3 tbsp butter, 1/4 cup parmesan Instructions: 1. Boil pasta 10 minutes. 2. Melt butter with garlic. 3. Toss and top with parmesan! #pasta #easyrecipe #fyp @chefsam');
  assert.equal(title, 'Easy garlic butter noodles');
  assert.deepEqual(text.split('\n'), ['Easy garlic butter noodles', 'Ingredients', '8 oz spaghetti', '4 cloves garlic', '3 tbsp butter', '1/4 cup parmesan', 'Instructions',
    '1. Boil pasta 10 minutes.', '2. Melt butter with garlic.', '3. Toss and top with parmesan!']);
  // Emoji bullets instead of commas, "You'll need", no explicit steps header
  const b = captionToText("Cozy tomato soup ✨ You'll need: 🍅 2 cans tomatoes 🧅 1 onion 🧄 3 cloves garlic 🥛 1/2 cup cream Method: Sauté onion and garlic. Add tomatoes, simmer 20 min, blend with cream.");
  const lines = b.text.split('\n');
  assert.ok(lines.includes('2 cans tomatoes') && lines.includes('1 onion') && lines.includes('1/2 cup cream'), lines.join(' | '));
  assert.ok(lines.includes('Instructions'));
  // Just a caption, no recipe in it
  const c = captionToText('this pasta changed my life 😭😭 #pasta #foodtok');
  assert.equal(c.title, 'this pasta changed my life');
  assert.ok(!/Ingredients/.test(c.text));
});

test('TikTok URLs: detection and canonical form', () => {
  assert.ok(isTikTok(new URL('https://vm.tiktok.com/ZMabc123/')));
  assert.ok(isTikTok(new URL('https://www.tiktok.com/@chef/video/123')));
  assert.ok(!isTikTok(new URL('https://nottiktok.com/x')));
  assert.equal(canonicalTikTok(new URL('https://www.tiktok.com/@chef.sam/video/7301234567890?is_from_webapp=1&sender_device=pc')), 'https://www.tiktok.com/@chef.sam/video/7301234567890');
});

/* ---------- URL safety ---------- */

test('URL safety: only public http(s) on standard ports', () => {
  const blocked = [
    'http://localhost/x', 'http://foo.localhost/', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0.0.0.0/',
    'http://10.1.2.3/', 'http://172.20.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://router.local/', 'http://metadata.internal/',
    'https://example.com:8443/', 'http://example.com:22/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com/',
    'not a url', '', 42, 'http://intranet/',
  ];
  for (const u of blocked) assert.throws(() => checkUrl(u), undefined, `should block ${u}`);
  for (const u of ['https://www.allrecipes.com/recipe/1/', 'http://example.com:80/x', 'https://example.com:443/', 'https://vm.tiktok.com/ZM123/', 'https://8.8.8.8/'])
    assert.equal(checkUrl(u).protocol.startsWith('http'), true, u);
  assert.ok(isPrivateIPv4('172.31.255.255') && !isPrivateIPv4('172.32.0.1') && !isPrivateIPv4('93.184.216.34'));
  assert.ok(isPrivateIPv6('fc00::1') && !isPrivateIPv6('2606:4700::1111'));
});

test('download cap: stops at 2 MB (truncating pages, refusing files)', async () => {
  const big = () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); } }));
  assert.equal((await readCapped(big(), 2 * 1024 * 1024, true)).length, 2 * 1024 * 1024);
  await assert.rejects(readCapped(big(), 2 * 1024 * 1024, false), /too large/);
});

test('handler: CORS only for the app, POST only, signed-in only', async () => {
  const pre = await handle(new Request('https://fn.example/import-recipe', { method: 'OPTIONS', headers: { origin: ALLOWED_ORIGIN } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://wealthsheethq.github.io');
  assert.equal(corsHeaders()['Access-Control-Allow-Origin'], ALLOWED_ORIGIN);
  const evil = await handle(new Request('https://fn.example/import-recipe', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }));
  assert.equal(evil.status, 403);
  assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example');
  const get = await handle(new Request('https://fn.example/import-recipe', { method: 'GET', headers: { origin: ALLOWED_ORIGIN } }));
  assert.equal(get.status, 405);
  const anon = await handle(new Request('https://fn.example/import-recipe', { method: 'POST', headers: { origin: ALLOWED_ORIGIN }, body: JSON.stringify({ url: 'https://example.com' }) }));
  assert.equal(anon.status, 401);
});

/* ---------- App side ---------- */

test('app: links in pasted or shared text', () => {
  assert.equal(findUrl('Check this out! https://vm.tiktok.com/ZMabc/ 😋'), 'https://vm.tiktok.com/ZMabc/');
  assert.equal(findUrl('see (https://example.com/recipe).'), 'https://example.com/recipe');
  assert.ok(isMostlyUrl('https://example.com/r'));
  assert.ok(isMostlyUrl('Look at this recipe https://example.com/r'));
  assert.ok(!isMostlyUrl('Chili\nServes 4\nIngredients\n1 lb beef\n2 cans beans\nFrom https://example.com/r'));
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://example.com/a b'), 'https://example.com/a%20b');
});

test('app: structured import -> editor draft', () => {
  const d = importToDraft({ title: 'Chili', ingredients: ['1 lb ground beef', '2 (15 oz) cans kidney beans', ''], steps: ['Brown.', 'Simmer.'], servings: 6, prepTime: 10, cookTime: 40, author: 'Jane', sourceUrl: 'https://example.com/chili', site: 'Example Kitchen', imageData: 'data:image/png;base64,AAAA' });
  assert.equal(d.usable, true);
  assert.equal(d.from, 'structured');
  assert.deepEqual(d.ingredients.map(i => [i.qty, i.unit, i.item]), [[1, 'lb', 'ground beef'], [2, 'can', 'kidney beans']]);
  assert.deepEqual([d.servings, d.prepMin, d.cookMin, d.sourceName, d.author, d.imageData.slice(0, 10)], [6, 10, 40, 'Example Kitchen', 'Jane', 'data:image']);
});

test('app: TikTok caption text is parsed; nothing usable -> draft', () => {
  const { title, text } = captionToText('Garlic noodles Ingredients: 8 oz spaghetti, 4 cloves garlic Instructions: 1. Boil. 2. Toss. #food');
  const d = importToDraft({ title, rawText: text, ingredients: [], steps: [], sourceUrl: 'https://www.tiktok.com/@a/video/1', site: 'TikTok', author: 'A' });
  assert.equal(d.from, 'text');
  assert.equal(d.title, 'Garlic noodles');
  assert.deepEqual(d.ingredients.map(i => i.item), ['spaghetti', 'garlic']);
  assert.deepEqual(d.steps, ['Boil.', 'Toss.']);
  const empty = importToDraft({ title: 'Viral pasta', rawText: 'Viral pasta', sourceUrl: 'https://www.tiktok.com/@a/video/2', imageData: 'javascript:bad' });
  assert.equal(empty.usable, false);
  assert.equal(empty.title, 'Viral pasta');
  assert.equal(empty.imageData, '');
  assert.equal(empty.sourceUrl, 'https://www.tiktok.com/@a/video/2');
  assert.equal(importToDraft({ sourceUrl: 'https://www.bbc.co.uk/food/x' }).title, 'Recipe from bbc.co.uk');
});

test('app: friendly import errors', () => {
  assert.match(importErrorMessage({ context: { status: 404 } }), /isn't set up yet/);
  assert.equal(importErrorMessage({ context: { status: 502 } }, { error: 'That site took too long to answer.' }), 'That site took too long to answer.');
  assert.match(importErrorMessage({ context: { status: 401 } }), /sign in/);
});
