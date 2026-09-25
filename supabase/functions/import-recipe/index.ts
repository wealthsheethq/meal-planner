// Supabase Edge Function: import-recipe
//
// POST { url } from the signed-in Meal Planner app. Fetches the page server-side
// (browsers can't, because of CORS) and returns the recipe it finds:
//   websites -> schema.org Recipe from JSON-LD (incl. @graph and arrays), then microdata
//   TikTok   -> caption, author and thumbnail from TikTok's public oEmbed endpoint
// Response: { title, ingredients[], steps[], servings, prepTime, cookTime, image,
//             imageData, author, sourceUrl, site, rawText }
//
// Safety: signed-in users only (JWT verified by the gateway AND checked here),
// CORS only for the app's origin, http/https only, no private/loopback/link-local
// addresses or non-standard ports (checked again on every redirect), 8 s overall
// timeout, 2 MB cap on anything we download.
//
// No imports on purpose: paste this one file into Dashboard > Edge Functions.
// The pure helpers are exported so tests can run them under Node.

export const ALLOWED_ORIGIN = 'https://wealthsheethq.github.io';
export const TIMEOUT_MS = 8000;
export const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const UA = 'Mozilla/5.0 (compatible; MealPlannerImport/1.0; +https://wealthsheethq.github.io/meal-planner/)';

/* ------------------------------------------------------------------ *
 * URL safety
 * ------------------------------------------------------------------ */

function ipv4Parts(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n >= 0 && n <= 255) ? p : null;
}

export function isPrivateIPv4(host: string): boolean {
  const p = ipv4Parts(host);
  if (!p) return false;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (cloud metadata lives here)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && p[2] === 100) ||
    (a === 203 && b === 0 && p[2] === 113);
}

export function isPrivateIPv6(host: string): boolean {
  let h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes(':')) return false;
  const zone = h.indexOf('%');
  if (zone > -1) h = h.slice(0, zone);
  if (h === '::' || h === '::1') return true;
  // IPv4-mapped / -compatible / NAT64 forms (::ffff:7f00:1, ::127.0.0.1…) are
  // a classic way around IPv4 checks; real sites never need them, so refuse all.
  if (/(?:^|:)\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || /^::(ffff:)?[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h)) return true;
  const first = parseInt(h.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xffc0) === 0xfec0 || // fec0::/10 site-local
    (first & 0xff00) === 0xff00 || // multicast
    h.startsWith('64:ff9b:') || h.startsWith('2001:db8:') || h.startsWith('100::');
}

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|localdomain|home|lan|intranet|corp|test|invalid|example)$/i;

// Throws a user-safe message when the URL must not be fetched; returns the parsed URL.
export function checkUrl(input: unknown): URL {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Send a link to a recipe.');
  if (input.length > 2048) throw new Error('That link is too long.');
  let u: URL;
  try { u = new URL(input.trim()); } catch { throw new Error("That doesn't look like a web link."); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https links can be imported.');
  if (u.username || u.password) throw new Error('Links with passwords are not allowed.');
  if (u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80'))) throw new Error('Links on non-standard ports are not allowed.');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || (!host.includes('.') && !host.includes(':'))) throw new Error('That link points to a private address.');
  if (BLOCKED_HOSTS.test(host)) throw new Error('That link points to a private address.');
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) throw new Error('That link points to a private address.');
  if (/^\d+$/.test(host) || /^0x/i.test(host)) throw new Error('That link points to a private address.');
  return u;
}

// Resolve the name and make sure every address is public (when DNS lookup is available).
async function checkResolves(u: URL): Promise<void> {
  const D = (globalThis as any).Deno;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!D || typeof D.resolveDns !== 'function' || ipv4Parts(host) || host.includes(':')) return;
  const addrs: string[] = [];
  for (const type of ['A', 'AAAA']) {
    try { addrs.push(...await D.resolveDns(host, type)); } catch { /* no records of this type */ }
  }
  for (const a of addrs) if (isPrivateIPv4(a) || isPrivateIPv6(a)) throw new Error('That link points to a private address.');
}

/* ------------------------------------------------------------------ *
 * Fetching: manual redirects (each hop re-checked), deadline, size cap
 * ------------------------------------------------------------------ */

export async function readCapped(res: Response, max = MAX_BYTES, truncate = true): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') || 0);
  if (!truncate && len > max) throw new Error('That file is too large.');
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > max) {
      if (!truncate) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('That file is too large.'); }
      chunks.push(value.slice(0, max - total));
      total = max;
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function safeFetch(start: string, signal: AbortSignal, accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5'): Promise<{ res: Response; url: URL }> {
  let url = checkUrl(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkResolves(url);
    const res = await fetch(url.href, { redirect: 'manual', signal, headers: { 'user-agent': UA, accept, 'accept-language': 'en-US,en;q=0.9' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      url = checkUrl(new URL(res.headers.get('location') as string, url).href);
      continue;
    }
    return { res, url };
  }
  throw new Error('That link redirects too many times.');
}

/* ------------------------------------------------------------------ *
 * Text helpers
 * ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', ntilde: 'ñ', times: '×', frac13: '⅓', frac23: '⅔', frac18: '⅛' };
export function decodeEntities(s: string): string {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
export function cleanText(s: unknown): string {
  if (s == null) return '';
  return decodeEntities(String(s).replace(/<br\s*\/?>|<\/(p|li|div|h[1-6]|tr|ol|ul)\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
const oneLine = (s: unknown) => cleanText(s).replace(/\s+/g, ' ').trim();

// ISO 8601 duration ("PT1H30M", "P0DT0H20M") or loose text -> minutes
export function durationMinutes(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v > 0 ? Math.round(v) : null;
  const s = String(v).trim();
  const m = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (m && (m[1] || m[2] || m[3] || m[4])) {
    const min = (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) + (+(m[4] || 0)) / 60;
    return min > 0 ? Math.round(min) : null;
  }
  let total = 0, found = false;
  for (const x of s.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/gi)) { found = true; total += /^h/i.test(x[2]) ? +x[1] * 60 : +x[1]; }
  return found && total > 0 ? Math.round(total) : null;
}

export function servingsFrom(v: unknown): number | null {
  const list = Array.isArray(v) ? v : [v];
  for (const x of list) {
    if (typeof x === 'number' && x > 0) return Math.round(x);
    const m = String(x ?? '').match(/(\d+)/);
    if (m && +m[1] > 0 && +m[1] < 200) return +m[1];
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * schema.org Recipe: JSON-LD
 * ------------------------------------------------------------------ */

const isRecipeType = (t: unknown) => (Array.isArray(t) ? t : [t]).some((x) => typeof x === 'string' && /(^|[/:])Recipe$/i.test(x));

export function findRecipeNode(data: unknown, depth = 0): any {
  if (!data || depth > 8) return null;
  if (Array.isArray(data)) { for (const x of data) { const r = findRecipeNode(x, depth + 1); if (r) return r; } return null; }
  if (typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (isRecipeType(o['@type'])) return o;
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'hasPart', 'about', 'subjectOf']) {
    if (o[k]) { const r = findRecipeNode(o[k], depth + 1); if (r) return r; }
  }
  return null;
}

function parseJsonLoose(raw: string): unknown {
  const t = raw.trim().replace(/^<!--/, '').replace(/-->$/, '').replace(/^\s*\/\/\s*<!\[CDATA\[/, '').replace(/\/\/\s*\]\]>\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* try once more without control characters and trailing commas */ }
  try { return JSON.parse(t.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}

export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) { const j = parseJsonLoose(decodeIfEscaped(m[1])); if (j) out.push(j); }
  return out;
}
const decodeIfEscaped = (s: string) => (/^\s*&quot;|^\s*\{&quot;/.test(s) ? decodeEntities(s) : s);

function textsFrom(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(textsFrom);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return textsFrom(o.text ?? o.name ?? o.url ?? '');
  }
  return [String(v)];
}

function instructionSteps(v: unknown, depth = 0): string[] {
  if (v == null || depth > 6) return [];
  if (typeof v === 'string') {
    const t = cleanText(v);
    // One big string: split on line breaks or numbered steps
    const parts = t.split(/\n+|(?:^|\s)(?=\d{1,2}[.)]\s+[A-Z])/).map((x) => x.replace(/^\s*(?:step\s*)?\d{1,2}[.):-]?\s+/i, '').trim()).filter(Boolean);
    return parts.length ? parts : (t ? [t] : []);
  }
  if (Array.isArray(v)) return v.flatMap((x) => instructionSteps(x, depth + 1));
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const type = String(o['@type'] || '');
    if (/HowToSection/i.test(type) || (o.itemListElement && !o.text)) return instructionSteps(o.itemListElement, depth + 1);
    const t = oneLine(o.text ?? o.name ?? '');
    return t ? [t] : [];
  }
  return [];
}

function imageFrom(v: unknown): string {
  const first = textsFrom(Array.isArray(v) ? v[0] : v)[0] || '';
  if (!first && v && typeof v === 'object' && !Array.isArray(v)) return String((v as any).contentUrl || '');
  return first;
}

function authorFrom(v: unknown): string {
  const names = textsFrom(v).map(oneLine).filter(Boolean);
  return names.slice(0, 3).join(', ');
}

export interface RecipeOut {
  title: string; ingredients: string[]; steps: string[]; servings: number | null;
  prepTime: number | null; cookTime: number | null; image: string; author: string; sourceUrl: string;
  site?: string; rawText?: string; imageData?: string; kind?: string;
}

export function recipeFromNode(o: any, base: string): RecipeOut {
  const abs = (u: string) => { try { return u ? new URL(u, base).href : ''; } catch { return ''; } };
  const ingredients = textsFrom(o.recipeIngredient ?? o.ingredients).map(oneLine).filter(Boolean);
  let prep = durationMinutes(o.prepTime), cook = durationMinutes(o.cookTime);
  const total = durationMinutes(o.totalTime);
  if (cook == null && total != null) cook = prep != null ? Math.max(0, total - prep) || null : total;
  return {
    title: oneLine(o.name || o.headline || ''),
    ingredients,
    steps: instructionSteps(o.recipeInstructions).map(oneLine).filter(Boolean),
    servings: servingsFrom(o.recipeYield ?? o.yield),
    prepTime: prep, cookTime: cook,
    image: abs(imageFrom(o.image || o.thumbnailUrl)),
    author: authorFrom(o.author || o.creator),
    sourceUrl: base,
  };
}

export function extractJsonLdRecipe(html: string, base: string): RecipeOut | null {
  for (const block of jsonLdBlocks(html)) {
    const node = findRecipeNode(block);
    if (node) return recipeFromNode(node, base);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * schema.org Recipe: microdata fallback
 * ------------------------------------------------------------------ */

// Inner HTML of the element starting at `start` (tag name `tag`), balancing nested same-name tags.
function innerHtml(html: string, start: number, tag: string): string {
  const open = html.indexOf('>', start);
  if (open < 0) return '';
  if (/^(meta|img|link|br|hr|input|source)$/i.test(tag) || html[open - 1] === '/') return '';
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = open + 1;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open + 1, m.index);
  }
  return html.slice(open + 1, open + 1 + 5000);
}

const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null; };

export function extractMicrodataRecipe(html: string, base: string): RecipeOut | null {
  const scope = html.match(/<(\w+)\b[^>]*itemtype\s*=\s*["']?https?:\/\/schema\.org\/Recipe["']?[^>]*>/i);
  if (!scope || scope.index == null) return null;
  const body = innerHtml(html, scope.index, scope[1]) || html.slice(scope.index);
  const props: Record<string, string[]> = {};
  const re = /<(\w+)\b[^>]*\bitemprop\s*=\s*["']?([^"'>]+)["']?[^>]*>/gi;
  let m;
  while ((m = re.exec(body))) {
    const tag = m[0], name = m[1];
    const value = attr(tag, 'content') ?? attr(tag, 'datetime') ?? (/^(img|source)$/i.test(name) ? attr(tag, 'src') : null) ?? (/^(a|link)$/i.test(name) && /image|url/.test(m[2]) ? attr(tag, 'href') : null) ?? cleanText(innerHtml(body, m.index, name));
    for (const p of m[2].trim().split(/\s+/)) (props[p] ||= []).push(value || '');
  }
  const o = {
    name: props.name?.[0], recipeIngredient: props.recipeIngredient || props.ingredients,
    recipeInstructions: props.recipeInstructions || props.step || props.text, recipeYield: props.recipeYield?.[0] || props.yield?.[0],
    prepTime: props.prepTime?.[0], cookTime: props.cookTime?.[0], totalTime: props.totalTime?.[0],
    image: props.image?.[0] || props.thumbnailUrl?.[0], author: props.author?.[0] || props.creator?.[0],
  };
  const r = recipeFromNode(o, base);
  r.steps = r.steps.flatMap((s) => instructionSteps(s)).map(oneLine).filter(Boolean);
  return r.ingredients.length || r.steps.length ? r : null;
}

function metaContent(html: string, key: string): string {
  const re = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${key.replace(/[:.]/g, '\\$&')}["'][^>]*>`, 'i');
  const m = html.match(re);
  return m ? oneLine(attr(m[0], 'content') || '') : '';
}

// Everything we can get from a web page.
export function extractRecipe(html: string, base: string): RecipeOut {
  const r = extractJsonLdRecipe(html, base) || extractMicrodataRecipe(html, base);
  const ogTitle = metaContent(html, 'og:title') || oneLine((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const ogImage = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  const site = metaContent(html, 'og:site_name');
  const abs = (u: string) => { try { return u ? new URL(u, base).href : ''; } catch { return ''; } };
  if (r) return { ...r, title: r.title || ogTitle, image: r.image || abs(ogImage), site };
  const desc = metaContent(html, 'og:description') || metaContent(html, 'description');
  return { title: ogTitle, ingredients: [], steps: [], servings: null, prepTime: null, cookTime: null, image: abs(ogImage), author: metaContent(html, 'author'), sourceUrl: base, site, rawText: desc };
}

/* ------------------------------------------------------------------ *
 * TikTok
 * ------------------------------------------------------------------ */

export const isTikTok = (u: URL) => /(^|\.)tiktok\.com$/i.test(u.hostname);

// Keep only the canonical video URL (drops tracking query strings).
export function canonicalTikTok(u: URL): string {
  const m = u.pathname.match(/^\/(@[\w.-]+)\/(video|photo)\/(\d+)/);
  return m ? `https://www.tiktok.com/${m[1]}/${m[2]}/${m[3]}` : `https://www.tiktok.com${u.pathname}`;
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const BULLET = /\s*(?:[•●▪▫◦‣∙·]|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]\u{FE0F}?|(?<=\s)[-–—*](?=\s))\s*/gu;

// Turn a one-line TikTok caption into text our recipe parser understands:
// headers on their own lines, one ingredient per line, one step per line,
// hashtags and mentions removed. Returns { title, text }.
export function captionToText(caption: string): { title: string; text: string } {
  let s = String(caption || '').replace(/\r/g, '');
  s = s.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, ' ').replace(/(^|\s)@[\w.]+/g, ' ');
  // Section headers
  s = s.replace(/\s*\b(ingredients?|what you(?:'|’)?ll need|you(?:'|’)?ll need|you will need|shopping list)\b\s*[:：\-–]?\s*/gi, '\nIngredients\n')
    .replace(/\s*\b(instructions?|directions?|method|steps?|how to make(?: it)?|recipe steps)\b\s*[:：\-–]\s*/gi, '\nInstructions\n');
  // Numbered steps "1." / "2)" / "Step 3:" inline -> own lines
  s = s.replace(/\s+(?=(?:step\s*)?\d{1,2}\s*[.)](?:\s|$))/gi, '\n').replace(/\s+(?=step\s*\d{1,2}\s*:)/gi, '\n');
  // Emoji/bullet separators -> new lines
  s = s.replace(BULLET, '\n');
  s = s.replace(EMOJI, ' ');
  const lines = s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Inside the ingredients section, split comma lists ("2 eggs, 1 cup milk, salt")
  const out: string[] = [];
  let section = '';
  for (const l of lines) {
    if (/^ingredients$/i.test(l)) { section = 'ing'; out.push('Ingredients'); continue; }
    if (/^instructions$/i.test(l)) { section = 'steps'; out.push('Instructions'); continue; }
    if (section === 'ing' && /,/.test(l)) {
      const parts = l.split(/,(?![^()]*\))|;/).map((x) => x.trim()).filter(Boolean);
      if (parts.length > 1 && parts.every((p) => p.length < 60)) { out.push(...parts); continue; }
    }
    if (section === 'ing' && /\.\s+[A-Z]/.test(l) && l.length > 80) {
      // A sentence after the list usually starts the method.
      const [first, ...rest] = l.split(/\.\s+(?=[A-Z])/);
      out.push(first, 'Instructions', ...rest.map((x) => x.trim()));
      section = 'steps';
      continue;
    }
    out.push(l);
  }
  let title = '';
  if (out.length && !/^(ingredients|instructions)$/i.test(out[0])) {
    title = out[0].split(/(?<=[.!?])\s+/)[0].replace(/[.!?:]+$/, '').trim();
    if (title.length > 80) title = title.slice(0, 77).replace(/\s+\S*$/, '') + '…';
  }
  return { title, text: out.join('\n') };
}

async function tiktokImport(u: URL, signal: AbortSignal): Promise<RecipeOut> {
  let url = u;
  if (!/^\/@[\w.-]+\/(video|photo)\/\d+/.test(u.pathname)) {
    // Short link (vm./vt.tiktok.com or /t/...): follow the redirect to the video.
    const { res, url: final } = await safeFetch(u.href, signal);
    try { await res.body?.cancel(); } catch { /* ignore */ }
    if (!isTikTok(final)) throw new Error("That TikTok link didn't lead to a video.");
    url = final;
  }
  const canonical = canonicalTikTok(url);
  const { res } = await safeFetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(canonical)}`, signal, 'application/json');
  if (!res.ok) throw new Error("TikTok didn't share that video's details (it may be private or removed).");
  const data = JSON.parse(new TextDecoder().decode(await readCapped(res, MAX_BYTES, false)));
  const caption = String(data.title || '');
  const { title, text } = captionToText(caption);
  const handle = data.author_unique_id ? `@${data.author_unique_id}` : '';
  const author = [data.author_name, handle && handle !== `@${data.author_name}` ? handle : ''].filter(Boolean).join(' ') || handle;
  return {
    title: title || (author ? `TikTok recipe from ${author}` : 'TikTok recipe'),
    ingredients: [], steps: [], servings: null, prepTime: null, cookTime: null,
    image: String(data.thumbnail_url || ''), author, sourceUrl: canonical, site: 'TikTok', rawText: text, kind: 'tiktok',
  };
}

/* ------------------------------------------------------------------ *
 * Thumbnail: fetched here so the app can keep a small copy (browsers can't read
 * cross-origin images into a canvas).
 * ------------------------------------------------------------------ */

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function imageData(src: string, signal: AbortSignal): Promise<string> {
  if (!src) return '';
  try {
    const { res } = await safeFetch(src, signal, 'image/avif,image/webp,image/jpeg,image/png,*/*;q=0.5');
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) { try { await res.body?.cancel(); } catch { /* ignore */ } return ''; }
    const bytes = await readCapped(res, MAX_BYTES, false);
    return `data:${type};base64,${toBase64(bytes)}`;
  } catch { return ''; }
}

/* ------------------------------------------------------------------ *
 * HTTP handler
 * ------------------------------------------------------------------ */

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

async function signedInUser(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(auth)) return false;
  const D = (globalThis as any).Deno;
  const url = D?.env.get('SUPABASE_URL'), key = D?.env.get('SUPABASE_ANON_KEY');
  if (!url || !key) return false;
  // The anon key is also a valid JWT, so ask Auth whether this is a real user session.
  const res = await fetch(`${url}/auth/v1/user`, { headers: { authorization: auth, apikey: key } });
  if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } return false; }
  const u = await res.json().catch(() => null);
  return !!(u && u.id && u.aud !== 'anon' && u.role !== 'anon');
}

export async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (origin && origin !== ALLOWED_ORIGIN) return json({ error: 'Origin not allowed.' }, 403, origin);
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405, origin);
  if (!(await signedInUser(req))) return json({ error: 'Please sign in first.' }, 401, origin);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Send JSON like {"url": "https://…"}.' }, 400, origin); }
  let target: URL;
  try { target = checkUrl(body && body.url); } catch (e) { return json({ error: (e as Error).message }, 400, origin); }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let out: RecipeOut;
    if (isTikTok(target)) out = await tiktokImport(target, ctl.signal);
    else {
      const { res, url } = await safeFetch(target.href, ctl.signal);
      if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } return json({ error: `That site answered with an error (${res.status}).` }, 502, origin); }
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (type && !/html|xml|json|text\/plain/.test(type)) { try { await res.body?.cancel(); } catch { /* ignore */ } return json({ error: "That link isn't a web page." }, 415, origin); }
      const html = new TextDecoder().decode(await readCapped(res, MAX_BYTES, true));
      out = extractRecipe(html, url.href);
      if (!out.site) out.site = url.hostname.replace(/^www\./, '');
    }
    out.imageData = await imageData(out.image, ctl.signal);
    return json(out, 200, origin);
  } catch (e) {
    const aborted = ctl.signal.aborted || (e as Error)?.name === 'AbortError';
    const msg = aborted ? 'That site took too long to answer.' : (e as Error)?.message || "Couldn't import that link.";
    return json({ error: msg }, aborted ? 504 : 502, origin);
  } finally {
    clearTimeout(timer);
  }
}

const D = (globalThis as any).Deno;
if (D && typeof D.serve === 'function') D.serve(handle);
