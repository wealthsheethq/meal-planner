// Turning what the import-recipe function returns into an editor draft. Pure.
import { parseIngredient, parseRecipeText } from './core.js';

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i;

// First http(s) link in some text, without trailing punctuation.
export function findUrl(text) {
  const m = String(text || '').match(URL_RE);
  if (!m) return '';
  return m[0].replace(/[),.!?;:\]]+$/, '');
}

// True when pasted/shared text is basically just a link ("Check out this video! https://vm.tiktok.com/…").
export function isMostlyUrl(text) {
  const t = String(text || '').trim();
  const u = findUrl(t);
  if (!u) return false;
  const rest = t.replace(u, '').trim();
  return rest.split('\n').filter(l => l.trim()).length <= 2 && rest.length <= 160;
}

export function safeUrl(u) {
  try { const x = new URL(String(u || '')); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; }
}

export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const clampMin = v => { const n = Math.round(+v); return n > 0 && n < 24 * 60 ? n : 0; };

// res: { title, ingredients[], steps[], servings, prepTime, cookTime, image, imageData, author, sourceUrl, site, rawText }
// -> { title, servings, prepMin, cookMin, ingredients[{qty,unit,item,note}], steps[], notes, sourceUrl, sourceName, author, imageData, usable, from }
export function importToDraft(res) {
  const r = res && typeof res === 'object' ? res : {};
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const list = v => (Array.isArray(v) ? v.map(x => str(typeof x === 'string' ? x : '')).filter(Boolean) : []);
  let ingredients = list(r.ingredients).map(parseIngredient).filter(i => i.item);
  let steps = list(r.steps);
  let title = str(r.title);
  let servings = +r.servings > 0 ? Math.round(+r.servings) : null;
  let prepMin = clampMin(r.prepTime), cookMin = clampMin(r.cookTime);
  let notes = '';
  let from = 'structured';
  if (!ingredients.length && !steps.length && str(r.rawText)) {
    const p = parseRecipeText(r.rawText);
    ingredients = p.ingredients;
    steps = p.steps;
    if (!title && p.title) title = p.title;
    servings = servings || p.servings;
    prepMin = prepMin || p.prepMin || 0;
    cookMin = cookMin || p.cookMin || 0;
    notes = p.notes && p.notes !== title ? p.notes : '';
    from = 'text';
  }
  const sourceUrl = safeUrl(r.sourceUrl);
  const imageData = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(str(r.imageData)) ? r.imageData : '';
  return {
    title: title.slice(0, 120) || (hostOf(sourceUrl) ? `Recipe from ${hostOf(sourceUrl)}` : 'Imported recipe'),
    servings: servings || 4, prepMin, cookMin, ingredients, steps, notes,
    sourceUrl, sourceName: str(r.site) || hostOf(sourceUrl), author: str(r.author).slice(0, 80),
    imageData, usable: ingredients.length > 0 || steps.length > 0, from,
  };
}

// Friendly message for errors from supabase.functions.invoke
export function importErrorMessage(err, body) {
  const b = body && typeof body === 'object' ? body : null;
  if (b && typeof b.error === 'string' && b.error) return b.error;
  const name = err && (err.name || err.constructor && err.constructor.name) || '';
  const status = err && err.context && err.context.status;
  if (status === 404 || /FunctionsRelayError|not found/i.test(name + ' ' + (err && err.message))) return "The import service isn't set up yet. Deploy the import-recipe function (see the README), then try again.";
  if (status === 401) return 'Please sign in again, then try the import.';
  if (/FunctionsFetchError/i.test(name) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return "Couldn't reach the import service. Check your connection and try again.";
  return "Couldn't import that link. You can paste the recipe text instead.";
}
