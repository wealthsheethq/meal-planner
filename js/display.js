// Kitchen wall display: an always-on, glanceable screen for an old tablet or a TV browser.
// Same sign-in, same kitchen and same sync engine as the phone app.
import { live, stamp, emptyDoc, isoDate, addDays, parseDate, itemKey, guessSection, DEFAULT_SECTIONS, readPantry, scaleIngredients, findTimers, formatAmount, toSystem, readSetting, uid, money } from './core.js';
import { priceBook, groceryTotalEst } from './pricing.js';
import { expiringSoon } from './plan.js';
import { DocSync, kvGet, kvSet } from './sync.js';
import { $, $$, esc, ic, toast } from './ui.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL } from './config.js';
import * as K from './display-core.js';

const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
const QUICK = { leftovers: '🍲', 'eat out': '🍽️', takeout: '🥡', 'fend for yourselves': '🥪', 'freezer meal': '🧊', 'date night': '🕯️' };
const AV_COLORS = ['#C1603A', '#3D6139', '#8B5A7A', '#B8841E', '#3E7C8C', '#6B7F3E'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SVG = {
  expand: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  shrink: '<path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4"/>',
  pin: '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3Z"/><path d="M12 14v7"/>',
  pinOff: '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3Z"/><path d="M12 14v7M3 3l18 18"/>',
};
const svg = (k, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[k]}</svg>`;

const D = {
  sb: null, user: null, offline: false, households: [], hid: null, members: [], sync: null,
  doc: emptyDoc(), status: 'idle', weather: null, weatherTry: 0, weatherKey: '', money: null, moneyAt: 0,
  pin: null, wakeUntil: 0, cook: null, settings: null, scene: null, night: null, minute: '', built: false,
  hiddenAt: 0, reloadAt: 0, lastPull: 0,
};
window.__kd = D; // for debugging and the UI check

/* ================================================================== *
 * Helpers
 * ================================================================== */
const now = () => (window.__kdNow ? window.__kdNow() : Date.now());
const nowDate = () => new Date(now());
const today = () => isoDate(nowDate());
const cfg = () => K.readDisplaySettings(D.doc.settings);
const setting = (id, def) => { const e = D.doc.settings[id]; return e && !e.deleted && e.value !== undefined && e.value !== null ? e.value : def; };
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const photo = r => r && typeof r.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.photo) ? r.photo : '';
const recipe = id => { const r = id && D.doc.recipes[id]; return r && !r.deleted ? r : null; };
const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;
const fmtMin = m => !m ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
const amountText = (qty, unit) => { const t = toSystem(qty, unit, readSetting(D.doc.settings, 'units')); return formatAmount(t.qty, t.unit); };
const online = () => navigator.onLine !== false;

function memberName(id) {
  if (!id) return '';
  if (id === 'together') return 'Together';
  const custom = setting('name:' + id, '');
  if (custom) return custom;
  const m = D.members.find(x => x.user_id === id);
  const email = m ? m.email : (D.user && D.user.id === id ? D.user.email : '');
  if (!email) return 'Someone';
  const local = email.split('@')[0].split(/[._+-]/)[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}
function avatar(id) {
  if (!id) return '';
  if (id === 'together') return `<span class="kd-av together">${ic('heart', 14)}</span>`;
  const n = memberName(id);
  return `<span class="kd-av" style="background:${AV_COLORS[hash(id) % AV_COLORS.length]}">${esc(n.slice(0, 2).toUpperCase())}</span>`;
}
const names = () => {
  const list = (D.members.length ? D.members.map(m => m.user_id) : [D.user && D.user.id]).filter(Boolean).map(memberName).filter(n => n && n !== 'Someone');
  return list.length ? list.slice(0, 3).join(' & ') : '';
};

let bookCache = { sig: null, book: null };
function book() {
  const ps = D.doc.prices;
  let max = 0, n = 0;
  for (const p of Object.values(ps)) { n++; if ((p.updatedAt || 0) > max) max = p.updatedAt || 0; }
  const sig = n + ':' + max;
  if (bookCache.sig !== sig || bookCache.src !== ps) bookCache = { sig, src: ps, book: priceBook(ps) };
  return bookCache.book;
}

function entriesOn(date) {
  return live(D.doc.plan).filter(e => e.date === date)
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || (a.order || 0) - (b.order || 0));
}
// { title, emoji, recipe, leftover, note } for one plan entry
function describe(e) {
  const r = recipe(e.recipeId);
  if (r) return { title: r.title, recipe: r, emoji: r.emoji || '🍽️' };
  const lo = recipe(e.leftoverOf);
  if (lo) return { title: lo.title, recipe: lo, emoji: lo.emoji || '🍲', leftover: true };
  const note = String(e.note || (e.recipeId ? 'Deleted recipe' : 'Note'));
  return { title: note, emoji: QUICK[note.toLowerCase()] || '📝', note: true };
}

function groceryVisible() {
  const items = live(D.doc.grocery);
  const planKeys = new Set(items.filter(g => g.source !== 'pantry').map(g => g.key));
  return items.filter(g => !(g.source === 'pantry' && planKeys.has(g.key)));
}
const sectionOrder = () => { const o = setting('sectionOrder', null); const base = Array.isArray(o) && o.length ? o.slice() : DEFAULT_SECTIONS.slice(); for (const s of DEFAULT_SECTIONS) if (!base.includes(s)) base.push(s); return base; };
const sectionFor = g => { if (g.section) return g.section; const k = g.key || itemKey(g.name); const a = D.doc.aisles[k]; return a && !a.deleted && a.section ? a.section : guessSection(g.name); };

/* ================================================================== *
 * Mutations (the display only checks off groceries, posts nothing else
 * except history from cook mode and its own settings)
 * ================================================================== */
function put(col, id, patch) {
  D.doc[col][id] = stamp(D.doc[col][id], { ...patch, id }, D.user && D.user.id);
}
function commit() { if (D.sync) D.sync.touched(D.doc); renderAll(); }
function putSetting(key, value) { put('settings', 'display.' + key, { value }); commit(); }

function toggleCheck(id) {
  const g = D.doc.grocery[id];
  if (!g || g.deleted) return;
  const on = !g.checked;
  put('grocery', id, { checked: on, checkedBy: on ? D.user.id : null });
  if (on) {
    const p = live(D.doc.pantry).find(x => (x.key || itemKey(x.name)) === g.key);
    if (p && p.low) put('pantry', p.id, { low: false });
  }
  commit();
}

/* ================================================================== *
 * Boot + auth
 * ================================================================== */
const app = () => $('#app');
const redirectUrl = () => /github\.io$/.test(location.hostname) ? SITE_URL + 'display/' : location.origin + location.pathname;

function renderAuth({ msg = '', kind = '', sent = '' } = {}) {
  D.built = false;
  document.documentElement.dataset.tod = dayTheme();
  app().innerHTML = `
  <div class="kd-auth">
    <div class="kd-auth-card">
      <div class="brand"><span class="brand-mark kd-brand-mark">${ic('utensils', 20)}</span>Kitchen Display</div>
      ${sent ? `<h1>Check your inbox</h1><p>We sent a sign-in link to <b>${esc(sent)}</b>. Open it on this screen (or sign in to Meal Planner in this browser) and the display starts on its own.</p>
        <button class="kd-btn ghost" data-act="auth-back">Use a different email</button>`
    : `<h1>Your kitchen, on the wall.</h1>
        <p>Sign in with the same email you use for Meal Planner. This screen stays signed in.</p>
        <form data-submit="signin" class="kd-auth-form">
          <input class="kd-input" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required aria-label="Email">
          <button class="kd-btn primary" type="submit">${ic('mail', 20)} Email me a sign-in link</button>
        </form>
        ${msg ? `<div class="kd-auth-msg ${kind}">${esc(msg)}</div>` : ''}`}
    </div>
  </div>`;
}

async function signIn(form) {
  const email = form.email.value.trim().toLowerCase();
  if (!email) return;
  if (!D.sb) return renderAuth({ msg: "You're offline. Connect to the internet to sign in.", kind: 'err' });
  const btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const { error } = await D.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl(), shouldCreateUser: false } });
    if (error) throw error;
    renderAuth({ sent: email });
  } catch (e) {
    const m = String(e && e.message || e);
    renderAuth({ kind: 'err', msg: /signup|sign up|not allowed|not found|otp_disabled|user/i.test(m) ? "We couldn't sign you in with that email. Use the email you use for Meal Planner." : /rate|seconds|too many/i.test(m) ? 'Too many attempts — please wait a minute and try again.' : "Sign-in didn't work just now. Please try again in a moment." });
  }
}

async function boot() {
  registerSW();
  applyTheme();
  app().innerHTML = `<div class="kd-boot"><div class="boot-mark">${ic('utensils', 30)}</div></div>`;
  if (!window.supabase || !window.supabase.createClient) {
    const last = await kvGet('last-user');
    return last ? start(last, { offline: true }) : renderAuth({ msg: 'Connect to the internet once to sign in — after that the display works offline.', kind: 'err' });
  }
  D.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'meal-planner-auth' },
  });
  D.sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (session && session.user) { if (!D.user || D.user.id !== session.user.id || D.offline) start(session.user); }
      else if (event === 'SIGNED_OUT') stop();
    }, 0);
  });
  let session = null;
  try { const { data } = await D.sb.auth.getSession(); session = data && data.session; } catch { /* offline */ }
  if (session) {
    if (!D.user) start(session.user);
    if (/access_token|code=/.test(location.href)) history.replaceState(null, '', location.pathname);
  } else if (!online()) {
    const last = await kvGet('last-user');
    if (last) start(last, { offline: true }); else renderAuth({ msg: "You're offline. Connect to sign in.", kind: 'err' });
  } else renderAuth();
  // Another tab (e.g. the phone app in this browser) signed in: pick it up.
  window.addEventListener('storage', e => { if (e.key === 'meal-planner-auth' && e.newValue && !D.user && D.sb) D.sb.auth.getSession().then(({ data }) => { if (data && data.session) start(data.session.user); }).catch(() => {}); });
}

function stop() {
  if (D.sync) D.sync.stop();
  Object.assign(D, { user: null, households: [], hid: null, members: [], sync: null, doc: emptyDoc(), money: null });
  renderAuth();
}

async function start(user, { offline = false } = {}) {
  D.user = { id: user.id, email: user.email };
  D.offline = offline;
  kvSet('last-user', D.user);
  const cached = await kvGet('households:' + user.id);
  if (!offline && D.sb && online()) {
    try { await D.sb.rpc('accept_meal_invites'); } catch { /* not fatal */ }
    try {
      const { data, error } = await D.sb.from('meal_households').select('id, name, created_by, created_at').order('created_at');
      if (error) throw error;
      D.households = data || []; kvSet('households:' + user.id, D.households);
    } catch (e) { console.warn('households', e); D.households = cached || []; }
  } else D.households = cached || [];
  if (!D.households.length) {
    app().innerHTML = `<div class="kd-auth"><div class="kd-auth-card"><div class="brand"><span class="brand-mark kd-brand-mark">${ic('utensils', 20)}</span>Kitchen Display</div>
      <h1>No kitchen yet</h1><p>Open Meal Planner on your phone to create or join a kitchen, then come back here.</p>
      <a class="kd-btn primary" href="../">Open Meal Planner</a> <button class="kd-btn ghost" data-act="sign-out">Sign out</button></div></div>`;
    return;
  }
  let hid = null;
  try { hid = localStorage.getItem('mp:hid'); } catch { /* ignore */ }
  openKitchen(D.households.some(h => h.id === hid) ? hid : D.households[0].id);
}

async function openKitchen(hid) {
  if (D.sync) D.sync.stop();
  D.hid = hid;
  try { localStorage.setItem('mp:hid', hid); } catch { /* ignore */ }
  D.members = (await kvGet('members:' + hid)) || [];
  const sync = new DocSync({
    sb: D.offline ? null : D.sb, householdId: hid, userId: D.user.id,
    onChange: doc => { if (D.sync !== sync) return; D.doc = doc; D.lastPull = now(); renderSoon(); },
    onStatus: st => { D.status = st; updateBadge(); },
  });
  D.sync = sync;
  await sync.loadCache();
  D.doc = sync.doc;
  const cw = await kvGet('weather');
  if (cw && cw.w) { D.weather = cw.w; D.weatherKey = cw.key || ''; }
  buildShell();
  renderAll();
  D.lastPull = now();
  if (!D.offline && D.sb) {
    sync.pull();
    sync.subscribe();
    loadMembers();
  } else { D.status = 'offline'; updateBadge(); }
  maybeWeather(true);
  maybeMoney(true);
  lockScreen();
}

async function loadMembers() {
  if (!D.sb || D.offline) return;
  try {
    const { data, error } = await D.sb.from('meal_members').select('household_id, user_id, email, role, joined_at').eq('household_id', D.hid).order('joined_at');
    if (error) throw error;
    if (data && data.length) { D.members = data; kvSet('members:' + D.hid, data); renderAll(); }
  } catch (e) { console.warn('members', e); }
}

/* ================================================================== *
 * Weather + Money HQ
 * ================================================================== */
async function maybeWeather(force = false) {
  const c = cfg();
  const key = `${c.place.lat},${c.place.lon},${c.temp}`;
  const fresh = D.weather && D.weatherKey === key && now() - D.weather.at < K.WEATHER_EVERY;
  if (fresh || !online()) return;
  if (!force && now() - D.weatherTry < 5 * 60000) return; // failed recently: retry in 5 minutes
  D.weatherTry = now();
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), 12000);
    const res = await fetch(K.weatherUrl(c.place, c.temp), ctl ? { signal: ctl.signal } : {});
    clearTimeout(t);
    if (!res.ok) throw new Error('weather ' + res.status);
    const w = K.parseWeather(await res.json(), now());
    if (!w) throw new Error('weather unreadable');
    D.weather = w; D.weatherKey = key;
    kvSet('weather', { w, key });
    renderAll();
  } catch (e) { console.warn('weather', e && e.message || e); if (D.weatherKey !== key) { D.weather = null; D.weatherKey = key; renderAll(); } }
}

async function maybeMoney(force = false) {
  const c = cfg();
  if (!c.money || D.offline || !D.sb) { if (D.money) { D.money = null; renderAll(); } return; }
  if (!force && now() - D.moneyAt < 30 * 60000) return;
  D.moneyAt = now();
  const m = await K.loadMoneyHQ(D.sb);
  const changed = JSON.stringify(m) !== JSON.stringify(D.money);
  D.money = m;
  if (changed) renderAll();
}

/* ================================================================== *
 * Shell + rendering
 * ================================================================== */
function dayTheme() { return D.doc ? K.themeFor(nowDate(), cfg()) : 'morning'; }
function isNight() { return K.isNightTime(nowDate(), cfg()) && now() >= D.wakeUntil && !D.cook; }

function applyTheme() {
  const tod = D.user ? (isNight() ? 'night' : K.themeFor(nowDate(), { ...cfg(), nightOn: false })) : K.themeFor(nowDate(), { nightOn: false });
  document.documentElement.dataset.tod = tod;
  const meta = $('meta[name="theme-color"]');
  const dark = tod === 'evening' || tod === 'night' || document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (meta) meta.content = tod === 'night' ? '#050604' : dark ? '#12150F' : '#FAF6EE';
}

function buildShell() {
  D.built = true;
  const scenes = K.SCENES;
  app().innerHTML = `
  <div class="kd" id="kd">
    <div class="kd-frame" id="kd-frame">
      <aside class="kd-side">
        <div class="kd-clock" aria-live="off"><span id="kd-time"></span><span class="kd-ampm" id="kd-ampm"></span></div>
        <div class="kd-date" id="kd-date"></div>
        <div class="kd-greet" id="kd-greet"></div>
        <button class="kd-wxmini" id="kd-wxmini" data-act="dot" data-scene="weather" aria-label="Weather"></button>
        <div class="kd-notes" id="kd-notes"></div>
        <div class="kd-side-foot" id="kd-foot"></div>
      </aside>
      <main class="kd-stage" id="kd-stage">
        ${scenes.map(([id, label]) => `<section class="kd-scene" data-scene="${id}" aria-label="${label}"></section>`).join('')}
      </main>
      <nav class="kd-dots" id="kd-dots" aria-label="Screens"></nav>
    </div>
    <div class="kd-tools">
      <span class="kd-badge hidden" id="kd-badge" role="status"><i></i>Reconnecting…</span>
      <button class="kd-tool" data-act="fs" id="kd-fs" aria-label="Full screen">${svg('expand')}</button>
      <button class="kd-tool" data-act="gear" aria-label="Display settings">${ic('gear', 22)}</button>
    </div>
    <div class="kd-night" id="kd-night" data-act="wake" aria-hidden="true"></div>
  </div>`;
  if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) $('#kd-fs').classList.add('hidden');
  updateBadge();
}

let renderQueued = false;
function renderSoon() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}

function renderAll() {
  if (!D.built || !D.user) return;
  applyTheme();
  const c = cfg();
  const t = today();
  const d = nowDate();
  $('#kd').classList.toggle('portrait', innerHeight > innerWidth * 1.05);
  // Side column
  $('#kd-date').textContent = K.longDate(d);
  const who = names();
  $('#kd-greet').textContent = K.greeting(d) + (who ? `, ${who}` : '');
  $('#kd-wxmini').innerHTML = wxMini();
  $('#kd-notes').innerHTML = notesHtml(t);
  // Scenes
  for (const el of $$('.kd-scene')) {
    const id = el.dataset.scene;
    el.innerHTML = id === 'tonight' ? sceneTonight(t) : id === 'groceries' ? sceneGroceries() : id === 'week' ? sceneWeek(t) : sceneWeather(t);
    el.classList.toggle('disabled', !c.scenes.includes(id));
  }
  fitAll();
  renderNight();
  D.scene = null; D.minute = '';
  tick();
  if (D.settings) D.settings.refresh();
  if (D.cook) D.cook.draw();
}

function updateBadge() {
  const b = $('#kd-badge');
  if (!b) return;
  const bad = !online() || D.offline || D.status === 'offline' || D.status === 'error';
  b.classList.toggle('hidden', !bad);
}

/* ---------- Side column ---------- */
function wxMini() {
  const w = D.weather;
  if (!w) return `<span class="kd-wxmini-empty">${K.weatherIcon('partly', 34)}<span>Weather loading…</span></span>`;
  return `${K.weatherIcon(w.current.icon, 44)}<span class="kd-wxmini-t">${w.current.temp}°</span><span class="kd-wxmini-l">${esc(w.current.label)}${w.today ? `<small>H ${w.today.hi}° · L ${w.today.lo}°</small>` : ''}</span>`;
}

function notesHtml(t) {
  const notes = K.activeNotes(live(D.doc.notes), t);
  if (!notes.length) return '';
  return notes.slice(0, 4).map((n, i) => `<div class="kd-note n${hash(n.id) % 4}" style="--tilt:${(i % 2 ? 1 : -1) * (0.4 + (hash(n.id) % 5) / 10)}deg">
    <p>${esc(n.text)}</p><span>— ${esc(memberName(n.by) || 'Someone')}${n.expires ? ` · until ${n.expires === t ? 'tonight' : K.shortDate(n.expires)}` : ''}</span></div>`).join('');
}

/* ---------- Scene: Tonight ---------- */
function mealRows(date) {
  const list = entriesOn(date);
  if (!list.length) return `<div class="kd-empty-line">Nothing planned</div>`;
  return list.map(e => {
    const x = describe(e);
    return `<div class="kd-meal"><span class="kd-meal-slot">${SLOT_LABEL[e.slot] || ''}</span><span class="kd-meal-emoji">${esc(x.emoji)}</span>
      <span class="kd-meal-title">${esc(x.title)}${x.leftover ? ' <span class="kd-lo">Leftovers</span>' : ''}</span>${avatar(e.cook)}</div>`;
  }).join('');
}

function sceneTonight(t) {
  const dinners = entriesOn(t).filter(e => e.slot === 'dinner');
  const main = dinners.find(e => recipe(e.recipeId)) || dinners.find(e => recipe(e.leftoverOf)) || dinners[0];
  let hero;
  if (main) {
    const x = describe(main);
    const r = x.recipe;
    const mins = r ? (+r.prepMin || 0) + (+r.cookMin || 0) : 0;
    const img = photo(r);
    hero = `<article class="kd-hero ${img ? 'has-photo' : 'g' + hash(r ? r.id : main.id) % 6}">
      ${img ? `<img class="kd-hero-img" src="${img}" alt="">` : `<span class="kd-hero-emoji">${esc(x.emoji)}</span>`}
      <div class="kd-hero-body">
        <div class="kd-eyebrow">Tonight's dinner${dinners.length > 1 ? ` · +${dinners.length - 1} more` : ''}</div>
        <h2>${esc(x.title)}</h2>
        <div class="kd-hero-meta">
          ${x.leftover ? '<span class="kd-pill">🍲 Leftovers</span>' : ''}
          ${mins ? `<span class="kd-pill">${ic('clock', 18)} ${esc(fmtMin(mins))}</span>` : ''}
          ${r && main.servings ? `<span class="kd-pill">${ic('users', 18)} ${main.servings} servings</span>` : ''}
          ${main.cook ? `<span class="kd-pill">${avatar(main.cook)} ${esc(main.cook === 'together' ? 'Cooking together' : memberName(main.cook) + ' is cooking')}</span>` : ''}
        </div>
        ${r && !x.leftover ? `<button class="kd-btn accent big" data-act="cook" data-id="${esc(r.id)}" data-serv="${+main.servings || ''}">${ic('flame', 22)} Start cooking</button>` : ''}
      </div>
    </article>`;
  } else {
    hero = `<article class="kd-hero g0 empty"><span class="kd-hero-emoji">🍽️</span><div class="kd-hero-body">
      <div class="kd-eyebrow">Tonight's dinner</div><h2>Nothing planned yet</h2><p class="kd-hero-sub">Add dinner from Meal Planner on your phone and it shows up here.</p></div></article>`;
  }
  const tm = addDays(t, 1);
  return `<div class="kd-tonight">${hero}
    <div class="kd-days">
      <div class="kd-card"><h3>Today <small>${esc(DAY_SHORT[parseDate(t).getDay()])} ${esc(K.shortDate(t))}</small></h3>${mealRows(t)}</div>
      <div class="kd-card"><h3>Tomorrow <small>${esc(DAY_SHORT[parseDate(tm).getDay()])} ${esc(K.shortDate(tm))}</small></h3>${mealRows(tm)}</div>
    </div></div>`;
}

/* ---------- Scene: Groceries ---------- */
function sceneGroceries() {
  const items = groceryVisible();
  const recent = now() - 10 * 60000;
  const need = items.filter(g => !g.have && (!g.checked || (g._f && g._f.checked || g.updatedAt || 0) > recent));
  const left = items.filter(g => !g.checked && !g.have);
  const est = groceryTotalEst(left, book());
  const hideCost = readSetting(D.doc.settings, 'hideCost');
  const order = sectionOrder();
  const by = new Map();
  for (const g of need) { const s = sectionFor(g); if (!by.has(s)) by.set(s, []); by.get(s).push(g); }
  const secs = [...by.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  const head = `<header class="kd-scene-head"><h2>Groceries</h2>
    <span class="kd-stat"><b>${left.length}</b> to get</span>
    ${!hideCost && left.length && est.total ? `<span class="kd-stat"><b>${esc(money(est.total))}</b> ${est.user && !est.estimated ? '' : 'est.'}</span>` : ''}</header>`;
  if (!left.length && !need.length) return `${head}<div class="kd-bigempty"><span>🧺</span><h3>${items.length ? 'All done — everything is in the cart!' : 'The list is empty'}</h3><p>Add things from your phone and they appear here instantly.</p></div>`;
  return `${head}<div class="kd-groc" id="kd-groc">${secs.map(s => `<div class="kd-gsec"><h4>${esc(s)}</h4>${by.get(s).sort((a, b) => (a.checked ? 1 : 0) - (b.checked ? 1 : 0) || a.name.localeCompare(b.name)).map(g => `
      <button class="kd-gi ${g.checked ? 'on' : ''}" data-act="check" data-id="${esc(g.id)}" aria-pressed="${!!g.checked}"><span class="kd-box">${ic('check', 20)}</span>
        <span class="kd-gname">${g.qty != null ? `<span class="kd-gqty">${esc(amountText(g.qty, g.unit))}</span> ` : ''}${esc(g.name)}</span></button>`).join('')}</div>`).join('')}</div>
    <div class="kd-more hidden" id="kd-groc-more"></div>`;
}

/* ---------- Scene: Week ---------- */
function sceneWeek(t) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, i));
  const pantry = live(D.doc.pantry).map(readPantry);
  const soon = expiringSoon(pantry, t, 3);
  const low = pantry.filter(p => p.low);
  const expText = p => { const n = Math.round((parseDate(p.expires) - parseDate(t)) / 86400000); return n < 0 ? 'expired' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `${n} days`; };
  return `<header class="kd-scene-head"><h2>This week</h2></header>
  <div class="kd-week">${days.map((d, i) => {
    const list = entriesOn(d);
    const dinner = list.filter(e => e.slot === 'dinner');
    const other = list.filter(e => e.slot !== 'dinner');
    const main = dinner[0] && describe(dinner[0]);
    const img = main && photo(main.recipe);
    return `<div class="kd-day ${i === 0 ? 'today' : ''}">
      <div class="kd-day-h"><b>${i === 0 ? 'Today' : i === 1 ? 'Tmrw' : DAY_SHORT[parseDate(d).getDay()]}</b><span>${parseDate(d).getDate()}</span></div>
      <div class="kd-day-dinner">${main ? `<span class="kd-day-thumb">${img ? `<img src="${img}" alt="">` : esc(main.emoji)}</span><span class="kd-day-title">${esc(main.title)}${main.leftover ? ' <span class="kd-lo">Leftovers</span>' : ''}</span>` : '<span class="kd-day-none">—</span>'}</div>
      ${other.length ? `<div class="kd-day-other">${other.slice(0, 3).map(e => { const x = describe(e); return `<span>${esc(x.emoji)} ${esc(x.title)}${x.leftover ? ' (leftovers)' : ''}</span>`; }).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div>
  <div class="kd-pantry">
    <div class="kd-card"><h3>${ic('timer', 20)} Use soon</h3>${soon.length ? `<div class="kd-chips">${soon.slice(0, 8).map(p => `<span class="kd-chip warn">${esc(p.name)} · ${expText(p)}</span>`).join('')}</div>` : '<div class="kd-empty-line">Nothing expiring in the next 3 days</div>'}</div>
    <div class="kd-card"><h3>${ic('jar', 20)} Running low</h3>${low.length ? `<div class="kd-chips">${low.slice(0, 10).map(p => `<span class="kd-chip">${esc(p.name)}</span>`).join('')}</div>` : '<div class="kd-empty-line">Fully stocked</div>'}</div>
  </div>`;
}

/* ---------- Scene: Weather & countdowns ---------- */
function updatedText(at) {
  const m = K.ageMinutes(at, now());
  const clock = K.formatClock(new Date(at), cfg().clock24);
  return m < 1 ? 'Updated just now' : `Updated ${clock.time}${clock.ampm ? ' ' + clock.ampm : ''}`;
}
// "2026-09-28T19:12" (local time at the place) -> "7:12 PM"
function sunTime(v) {
  const m = typeof v === 'string' && v.match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  const c = K.formatClock(new Date(2000, 0, 1, +m[1], +m[2]), cfg().clock24);
  return c.time + (c.ampm ? ' ' + c.ampm : '');
}
function sceneWeather(t) {
  const c = cfg();
  const w = D.weather;
  const cds = K.upcomingCountdowns(live(D.doc.countdowns), t, 6);
  const wx = w ? `<div class="kd-wx">
      <div class="kd-wx-now">${K.weatherIcon(w.current.icon, 120)}
        <div><div class="kd-wx-temp">${w.current.temp}°<small>${w.unit}</small></div><div class="kd-wx-label">${esc(w.current.label)}</div>
        <div class="kd-wx-meta">${w.current.feels != null ? `Feels ${w.current.feels}°` : ''}${w.today ? ` · H ${w.today.hi}° L ${w.today.lo}°` : ''}</div></div></div>
      <div class="kd-wx-facts">${[['Humidity', w.current.humidity != null ? Math.round(w.current.humidity) + '%' : ''], ['Wind', w.current.wind != null ? `${w.current.wind} ${w.windUnit}` : ''], ['Sunrise', sunTime(w.sunrise)], ['Sunset', sunTime(w.sunset)]].filter(x => x[1]).map(([l, v]) => `<div><span>${l}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <div class="kd-wx-days">${w.days.slice(0, 5).map((d, i) => `<div class="kd-wx-day"><b>${i === 0 ? 'Today' : DAY_SHORT[parseDate(d.date).getDay()]}</b>${K.weatherIcon(d.icon, 46)}<span class="hi">${d.hi}°</span><span class="lo">${d.lo}°</span>${d.pop ? `<span class="pop">${d.pop}%</span>` : '<span class="pop"></span>'}</div>`).join('')}</div>
      <div class="kd-wx-foot">${ic('home', 14)} ${esc(c.place.name)} · ${esc(updatedText(w.at))}</div>
    </div>`
    : `<div class="kd-wx kd-wx-none">${K.weatherIcon('cloudy', 90)}<p>Weather will appear once this screen is online.</p><div class="kd-wx-foot">${esc(c.place.name)}</div></div>`;
  const money = c.money && D.money ? `<div class="kd-card kd-money-card"><h3>${ic('chart', 20)} Money HQ</h3>${K.moneyPanelHtml(D.money, { privacy: c.moneyPrivacy })}</div>` : '';
  return `<div class="kd-wxscene">
    ${wx}
    <div class="kd-side-stack">
      <div class="kd-card kd-cds"><h3>${ic('sparkle', 20)} Coming up</h3>
        ${cds.length ? cds.map(x => `<div class="kd-cd ${x.days <= 1 ? 'soon' : ''}"><span class="kd-cd-emoji">${esc(x.emoji)}</span>
          <span class="kd-cd-main"><b>${esc(x.title)}</b><small>${esc(K.shortDate(x.next))}${x.milestone ? ` · ${esc(x.milestone)}` : ''}</small></span>
          <span class="kd-cd-when">${x.days > 1 ? `<b>${x.days}</b> days` : esc(x.when)}</span></div>`).join('')
        : '<div class="kd-empty-line">Add trips, birthdays and anniversaries from More → Countdowns on your phone.</div>'}
      </div>
      ${money}
    </div></div>`;
}

/* ---------- Night mode ---------- */
function renderNight() {
  const el = $('#kd-night');
  if (!el) return;
  const d = nowDate();
  const bd = K.breakfastDate(d);
  const b = entriesOn(bd).filter(e => e.slot === 'breakfast').map(describe);
  const w = D.weather;
  const html = `<div class="kd-night-in">
    <div class="kd-night-clock"><span data-night-time></span><small data-night-ampm></small></div>
    <div class="kd-night-date">${esc(K.longDate(d))}</div>
    ${w ? `<div class="kd-night-wx">${K.weatherIcon(w.current.icon, 40)} ${w.current.temp}° · ${esc(w.current.label)}${w.days[bd === isoDate(d) ? 0 : 1] ? ` · tomorrow ${w.days[bd === isoDate(d) ? 0 : 1].hi}°/${w.days[bd === isoDate(d) ? 0 : 1].lo}°` : ''}</div>` : ''}
    <div class="kd-night-bf">${b.length ? `${bd === isoDate(d) ? 'Breakfast' : "Tomorrow's breakfast"}: <b>${esc(b.map(x => x.title).join(', '))}</b>` : 'No breakfast planned'}</div>
  </div>`;
  if (el._html !== html) { el._html = html; el.innerHTML = html; } // keep the node stable under a tap
}

/* ---------- Fitting content without scrolling ---------- */
function over(el) { return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1; }
function fitAll() {
  const g = $('#kd-groc');
  if (g) {
    const items = $$('.kd-gi', g);
    let hidden = 0;
    for (let i = items.length - 1; i >= 0 && over(g); i--) { items[i].remove(); hidden++; }
    $$('.kd-gsec', g).forEach(s => { if (!s.querySelector('.kd-gi')) s.remove(); });
    const more = $('#kd-groc-more');
    if (more) { more.textContent = hidden ? `+ ${plural(hidden, 'more item')} on your phone` : ''; more.classList.toggle('hidden', !hidden); }
  }
  for (const box of $$('.kd-notes, .kd-cds, .kd-days .kd-card, .kd-pantry .kd-card')) {
    if (over(box)) box.classList.add('tight'); // one-line titles, less padding — before dropping anything
    const kids = [...box.children].filter(k => !/^H3$/.test(k.tagName));
    for (let i = kids.length - 1; i > 0 && over(box); i--) kids[i].remove();
  }
}

/* ================================================================== *
 * Clock tick: scenes, night mode, burn-in, timers, housekeeping
 * ================================================================== */
function tick() {
  if (!D.built) return;
  const t = now();
  const d = new Date(t);
  const c = cfg();
  const clock = K.formatClock(d, c.clock24);
  const te = $('#kd-time'); if (te && te.textContent !== clock.time) te.textContent = clock.time;
  const ae = $('#kd-ampm'); if (ae) ae.textContent = clock.ampm;
  const nt = $('[data-night-time]'); if (nt) { nt.textContent = clock.time; $('[data-night-ampm]').textContent = clock.ampm; }
  // Minute changed: date-dependent content (midnight rollover, expiring notes) and burn-in shift
  const minute = `${isoDate(d)} ${d.getHours()}:${d.getMinutes()}`;
  if (minute !== D.minute) {
    const first = !D.minute;
    D.minute = minute;
    if (!first && d.getMinutes() % 5 === 0) { renderAll(); return; }
    const [dx, dy] = K.burnInShift(t);
    $('#kd-frame').style.transform = `translate(${dx}px, ${dy}px)`;
    $('#kd-night').style.setProperty('--sx', `${dx * 6}px`); $('#kd-night').style.setProperty('--sy', `${dy * 6}px`);
    applyTheme();
  }
  // Night mode
  const night = isNight();
  if (night !== D.night) { D.night = night; $('#kd').classList.toggle('is-night', night); $('#kd-night').setAttribute('aria-hidden', String(!night)); if (night) renderNight(); applyTheme(); }
  // Scene rotation (clock-based) with tap-to-pin
  if (D.pin && D.pin.until <= t) D.pin = null;
  const scene = K.sceneAt(t, c.scenes, c.rotateSec, D.pin);
  if (scene !== D.scene) {
    D.scene = scene;
    for (const el of $$('.kd-scene')) el.classList.toggle('on', el.dataset.scene === scene);
  }
  const dots = $('#kd-dots');
  if (dots) {
    const html = c.scenes.map(id => { const label = K.SCENES.find(s => s[0] === id)[1]; return `<button class="kd-dot ${id === scene ? 'on' : ''}" data-act="dot" data-scene="${id}" aria-label="Show ${label}"><span>${esc(label)}</span></button>`; }).join('')
      + (D.pin ? `<button class="kd-pinned" data-act="unpin" aria-label="Resume rotation">${svg('pin', 16)} ${Math.ceil((D.pin.until - t) / 1000 / 60)} min</button>` : '');
    if (dots._html !== html) { dots._html = html; dots.innerHTML = html; }
  }
  // Timers in cook mode
  if (D.cook) D.cook.tick();
  // Housekeeping (cheap checks)
  if (t >= D.reloadAt) nightlyReload();
  if (t - D.lastPull > 5 * 60000 && D.sync && online() && !D.offline) { D.lastPull = t; D.sync.pull(); }
  maybeWeather();
  maybeMoney();
}

function nightlyReload() {
  if (!D.reloadAt) { D.reloadAt = now() + K.msUntilHour(now(), 3); return; }
  if (D.cook || D.settings) { D.reloadAt = now() + 30 * 60000; return; } // don't yank the screen mid-use
  D.reloadAt = Infinity;
  Promise.resolve(D.sync && D.sync.dirty ? D.sync.flush() : null).catch(() => {}).finally(() => location.reload());
}

/* ================================================================== *
 * Wake lock, fullscreen, sleep/wake + connection handling
 * ================================================================== */
let wakeLock = null;
async function lockScreen() {
  try {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener && wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* not allowed right now (e.g. battery saver); retried on the next tap */ }
}

function toggleFullscreen() {
  const de = document.documentElement;
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  try {
    if (fs) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else { const p = (de.requestFullscreen || de.webkitRequestFullscreen).call(de); if (p && p.catch) p.catch(() => {}); }
  } catch { /* ignore */ }
}
function onFullscreen() { const b = $('#kd-fs'); if (b) { const fs = !!(document.fullscreenElement || document.webkitFullscreenElement); b.innerHTML = svg(fs ? 'shrink' : 'expand'); b.setAttribute('aria-label', fs ? 'Exit full screen' : 'Full screen'); } }
document.addEventListener('fullscreenchange', onFullscreen);
document.addEventListener('webkitfullscreenchange', onFullscreen);

async function resume() {
  lockScreen();
  if (!D.user || D.offline) { if (D.offline && online()) location.reload(); return; }
  const away = D.hiddenAt ? now() - D.hiddenAt : 0;
  D.hiddenAt = 0;
  try {
    if (D.sb && D.sb.auth.startAutoRefresh) D.sb.auth.startAutoRefresh();
    // Refreshes an expired access token after a long sleep before we talk to the database.
    if (D.sb) await D.sb.auth.getSession();
  } catch { /* offline: sync retries */ }
  if (D.sync) {
    if (away > 60000) D.sync.subscribe(); // realtime sockets rarely survive a long sleep
    D.sync.pull();
    D.lastPull = now();
  }
  renderAll();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resume();
  else { D.hiddenAt = now(); if (D.sync && D.sync.dirty) D.sync.flush(); }
});
window.addEventListener('online', () => { updateBadge(); if (D.user) resume(); });
window.addEventListener('offline', () => { D.status = 'offline'; updateBadge(); });
window.addEventListener('pageshow', e => { if (e.persisted) resume(); });
window.addEventListener('resize', () => { clearTimeout(window.__kdRz); window.__kdRz = setTimeout(renderAll, 200); });

/* ================================================================== *
 * Cook mode (on the display)
 * ================================================================== */
let audioCtx = null;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [0, .25, .5].forEach((dd, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = [880, 1175, 1480][i]; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t0 + dd); g.gain.exponentialRampToValueAtTime(0.3, t0 + dd + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dd + .35);
      o.connect(g).connect(audioCtx.destination); o.start(t0 + dd); o.stop(t0 + dd + .4);
    });
  } catch { /* no audio */ }
}
const fmtTimer = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

function openCook(id, servings) {
  const r = recipe(id);
  if (!r) return;
  const st = { step: 0, done: new Set(), servings: servings || r.servings, timers: [] };
  const steps = Array.isArray(r.steps) && r.steps.length ? r.steps : ['No steps written yet — just cook it your way!'];
  const ings = scaleIngredients(Array.isArray(r.ingredients) ? r.ingredients : [], r.servings, st.servings);
  const el = document.createElement('div');
  el.className = 'kd-cook';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Cook mode: ' + r.title);
  const timersHtml = () => st.timers.map(t => `<span class="kd-timer ${t.done ? 'done' : ''}">${ic('timer', 20)} ${t.done ? "Time's up!" : fmtTimer((t.end - now()) / 1000)} <small>${esc(t.label)}</small><button data-act="ck-timer-x" data-id="${t.id}" aria-label="Dismiss timer">${ic('x', 18)}</button></span>`).join('');
  const draw = () => {
    const last = st.step === steps.length - 1;
    const timers = findTimers(steps[st.step]);
    el.innerHTML = `
      <header class="kd-cook-head">
        <button class="kd-tool" data-act="ck-close" aria-label="Exit cook mode">${ic('x', 24)}</button>
        <h2>${esc(r.title)}</h2><span class="kd-cook-step">Step ${st.step + 1} of ${steps.length}</span>
      </header>
      <div class="kd-cook-progress"><i style="width:${(st.step + 1) / steps.length * 100}%"></i></div>
      <div class="kd-cook-body">
        <aside class="kd-cook-ings"><h3>Ingredients <small>${st.servings} servings</small></h3>
          <ul>${ings.map((i, n) => `<li class="${st.done.has(n) ? 'done' : ''}"><button data-act="ck-ing" data-n="${n}"><span class="kd-box">${ic('check', 16)}</span><span><b>${esc(amountText(i.qty, i.unit))}</b> ${esc(i.item)}</span></button></li>`).join('') || '<li class="kd-empty-line">No ingredients listed</li>'}</ul></aside>
        <div class="kd-cook-main">
          <p class="kd-cook-text" aria-live="polite">${esc(steps[st.step])}</p>
          <div class="kd-cook-tbtns">${timers.map(t => `<button class="kd-btn soft" data-act="ck-timer" data-s="${t.seconds}" data-l="${esc(t.label)}">${ic('timer', 20)} Start ${esc(t.label)} timer</button>`).join('')}</div>
          <div class="kd-timers" id="kd-timers">${timersHtml()}</div>
        </div>
      </div>
      <footer class="kd-cook-foot">
        <button class="kd-btn ghost big" data-act="ck-prev" ${st.step === 0 ? 'disabled' : ''}>${ic('left', 24)} Back</button>
        ${last ? `<button class="kd-btn accent big" data-act="ck-finish">${ic('check', 24)} Done — we ate!</button>` : `<button class="kd-btn primary big" data-act="ck-next">Next ${ic('right', 24)}</button>`}
      </footer>`;
  };
  const close = () => { el.remove(); D.cook = null; document.removeEventListener('keydown', onKey); renderAll(); };
  const onKey = e => {
    if (e.key === 'ArrowRight' && st.step < steps.length - 1) { st.step++; draw(); }
    else if (e.key === 'ArrowLeft' && st.step > 0) { st.step--; draw(); }
    else if (e.key === 'Escape') close();
  };
  let sx = null;
  el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 80) { if (dx < 0 && st.step < steps.length - 1) st.step++; else if (dx > 0 && st.step > 0) st.step--; draw(); }
  }, { passive: true });
  el._acts = {
    'ck-close': close,
    'ck-next': () => { st.step = Math.min(steps.length - 1, st.step + 1); draw(); },
    'ck-prev': () => { st.step = Math.max(0, st.step - 1); draw(); },
    'ck-ing': b => { const n = +b.dataset.n; st.done.has(n) ? st.done.delete(n) : st.done.add(n); draw(); },
    'ck-timer': b => { st.timers.push({ id: uid('t'), label: b.dataset.l, end: now() + +b.dataset.s * 1000, done: false }); draw(); },
    'ck-timer-x': b => { st.timers = st.timers.filter(t => t.id !== b.dataset.id); draw(); },
    'ck-finish': () => { put('history', uid('h_'), { recipeId: r.id, date: today(), servings: st.servings }); commit(); toast(`Nice! ${r.title} logged to your history`); close(); },
  };
  D.cook = {
    draw: () => {},
    tick: () => {
      let rang = false;
      for (const t of st.timers) if (!t.done && now() >= t.end) { t.done = true; rang = true; }
      if (rang) chime();
      const te = $('#kd-timers', el); if (te) te.innerHTML = timersHtml();
    },
  };
  document.addEventListener('keydown', onKey);
  draw();
  $('#kd').appendChild(el);
  lockScreen();
}

/* ================================================================== *
 * Display settings (gear)
 * ================================================================== */
function openSettings() {
  if (D.settings) return;
  const st = { results: null, searching: false, err: '' };
  const el = document.createElement('div');
  el.className = 'kd-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Display settings');
  const seg = (key, cur, opts) => `<div class="kd-seg">${opts.map(([v, l]) => `<button class="${String(cur) === String(v) ? 'on' : ''}" data-act="set" data-k="${key}" data-v="${esc(String(v))}">${esc(l)}</button>`).join('')}</div>`;
  const sw = (key, on, label, sub = '') => `<div class="kd-pref"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><button class="kd-switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-act="toggle" data-k="${key}"></button></div>`;
  const draw = () => {
    const c = cfg();
    el.innerHTML = `<div class="kd-modal-card">
      <header><h2>Display settings</h2><button class="kd-tool" data-act="set-close" aria-label="Close">${ic('x', 24)}</button></header>
      <div class="kd-modal-body">
        <section><h3>Weather location</h3>
          <p class="kd-muted">Now: <b>${esc(c.place.name)}</b> (${c.place.lat.toFixed(3)}, ${c.place.lon.toFixed(3)})</p>
          <form data-submit="geo" class="kd-row"><input class="kd-input" name="q" placeholder="Search a city — e.g. Charlotte" autocomplete="off" aria-label="City"><button class="kd-btn primary" type="submit">${ic('search', 18)} Search</button></form>
          ${st.searching ? '<p class="kd-muted">Searching…</p>' : ''}${st.err ? `<p class="kd-muted">${esc(st.err)}</p>` : ''}
          ${st.results ? `<div class="kd-results">${st.results.map((p, i) => `<button class="kd-chip-btn" data-act="place" data-i="${i}">${esc(p.name)}</button>`).join('') || '<span class="kd-muted">No places found</span>'}</div>` : ''}
          <div class="kd-row wrap">${'geolocation' in navigator ? `<button class="kd-btn ghost" data-act="geo-here">${ic('home', 18)} Use this device's location</button>` : ''}<button class="kd-btn ghost" data-act="geo-reset">Reset to Charlotte, NC</button></div>
        </section>
        <section><h3>Screens</h3>
          <div class="kd-row wrap">${K.SCENES.map(([id, l]) => `<button class="kd-chip-btn ${c.scenes.includes(id) ? 'on' : ''}" data-act="scene-toggle" data-v="${id}" aria-pressed="${c.scenes.includes(id)}">${esc(l)}</button>`).join('')}</div>
          <label class="kd-label">Change screens every</label>${seg('rotateSec', c.rotateSec, [[0, 'Off'], [10, '10s'], [20, '20s'], [30, '30s'], [60, '1 min']])}
        </section>
        <section><h3>Night mode</h3>
          ${sw('nightOn', c.nightOn, 'Night mode', 'Very dim: just the clock, weather and breakfast')}
          <div class="kd-row"><label class="kd-label grow">From <input class="kd-input" type="time" data-change="nightStart" value="${c.nightStart}"></label><label class="kd-label grow">Until <input class="kd-input" type="time" data-change="nightEnd" value="${c.nightEnd}"></label></div>
        </section>
        <section><h3>Units & clock</h3>
          <label class="kd-label">Temperature</label>${seg('temp', c.temp, [['f', '°F'], ['c', '°C']])}
          <label class="kd-label">Clock</label>${seg('clock24', c.clock24 ? 'true' : 'false', [['false', '12-hour'], ['true', '24-hour']])}
        </section>
        <section><h3>Money HQ</h3>
          ${sw('money', c.money, 'Show Money HQ panel', 'Read-only debt-free progress. Only appears for the account that can see it.')}
          ${c.money ? sw('moneyPrivacy', c.moneyPrivacy, 'Privacy mode', 'Progress, percent and debt-free month only — no dollar amounts') : ''}
        </section>
        <section><h3>This screen</h3>
          ${D.households.length > 1 ? `<label class="kd-label">Kitchen</label><select class="kd-input" data-change="kitchen">${D.households.map(h => `<option value="${esc(h.id)}" ${h.id === D.hid ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select>` : ''}
          <p class="kd-muted">Signed in as ${esc(D.user.email || '')}. Settings are shared with your kitchen, so you can change them from the phone app too (More → Kitchen display).</p>
          <div class="kd-row wrap"><a class="kd-btn ghost" href="../">${ic('left', 18)} Open Meal Planner</a><button class="kd-btn ghost" data-act="reload">${ic('refresh', 18)} Reload</button><button class="kd-btn ghost" data-act="sign-out">${ic('logout', 18)} Sign out</button></div>
        </section>
      </div></div>`;
  };
  const close = () => { el.remove(); D.settings = null; };
  const search = async q => {
    if (!q) return;
    st.searching = true; st.err = ''; draw();
    try { const res = await fetch(K.geocodeUrl(q)); st.results = K.parseGeocode(await res.json()); }
    catch { st.results = null; st.err = "Couldn't search right now — check the connection."; }
    st.searching = false; draw();
  };
  const setPlace = p => { putSetting('place', p); D.weather = null; D.weatherTry = 0; st.results = null; maybeWeather(true); toast(`Weather for ${p.name}`); };
  el._acts = {
    'set-close': close,
    set: b => { const k = b.dataset.k; const v = b.dataset.v; putSetting(k, k === 'rotateSec' ? +v : k === 'clock24' ? v === 'true' : v); if (k === 'temp') { D.weatherTry = 0; maybeWeather(true); } },
    toggle: b => { const k = b.dataset.k; putSetting(k, !cfg()[k]); if (k === 'money') { D.moneyAt = 0; maybeMoney(true); } },
    'scene-toggle': b => { const c = cfg(); const id = b.dataset.v; const next = c.scenes.includes(id) ? c.scenes.filter(x => x !== id) : [...c.scenes, id]; if (!next.length) { toast('Keep at least one screen'); return; } putSetting('scenes', K.SCENES.map(s => s[0]).filter(x => next.includes(x))); },
    place: b => setPlace(st.results[+b.dataset.i]),
    'geo-reset': () => setPlace(K.DEFAULT_PLACE),
    'geo-here': () => navigator.geolocation.getCurrentPosition(pos => setPlace({ name: 'This location', lat: Math.round(pos.coords.latitude * 1e4) / 1e4, lon: Math.round(pos.coords.longitude * 1e4) / 1e4 }), () => toast("Couldn't get this device's location"), { timeout: 10000 }),
    reload: () => location.reload(),
  };
  el._submit = { geo: f => search(f.q.value.trim()) };
  el._change = {
    nightStart: i => { if (/^\d{2}:\d{2}$/.test(i.value)) putSetting('nightStart', i.value); },
    nightEnd: i => { if (/^\d{2}:\d{2}$/.test(i.value)) putSetting('nightEnd', i.value); },
    kitchen: s => { close(); openKitchen(s.value); },
  };
  D.settings = { refresh: () => { if (!el.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') draw(); } };
  draw();
  $('#kd').appendChild(el);
}

/* ================================================================== *
 * Events
 * ================================================================== */
const ACT = {
  check: el => toggleCheck(el.dataset.id),
  cook: el => openCook(el.dataset.id, +el.dataset.serv || null),
  dot: el => { D.pin = { scene: el.dataset.scene, until: now() + K.PIN_MS }; tick(); },
  unpin: () => { D.pin = null; tick(); },
  fs: () => toggleFullscreen(),
  gear: () => openSettings(),
  wake: () => { D.wakeUntil = now() + K.PIN_MS; D.pin = null; tick(); },
  'auth-back': () => renderAuth(),
  'sign-out': async () => {
    if (!confirm('Sign this display out?')) return;
    try { if (D.sync) await D.sync.flush(); } catch { /* ignore */ }
    try { if (D.sb) await D.sb.auth.signOut(); } catch { /* ignore */ }
    if (D.settings) $('.kd-modal') && $('.kd-modal').remove(); D.settings = null;
    stop();
  },
};

document.addEventListener('click', e => {
  lockScreen(); // some browsers only grant the wake lock after a tap
  const el = e.target.closest('[data-act]');
  const owner = e.target.closest('.kd-cook, .kd-modal');
  if (el) {
    const act = el.dataset.act;
    const h = (owner && owner._acts && owner._acts[act]) || ACT[act];
    if (h) { if (el.tagName === 'A') e.preventDefault(); h(el, e); }
    return;
  }
  // Tapping a scene pins it for two minutes.
  if (!owner && e.target.closest('.kd-stage') && D.scene) { D.pin = { scene: D.scene, until: now() + K.PIN_MS }; tick(); }
  if (e.target.classList && e.target.classList.contains('kd-modal')) { D.settings = null; e.target.remove(); }
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  const owner = form.closest('.kd-modal');
  if (form.dataset.submit === 'signin') return signIn(form);
  const h = owner && owner._submit && owner._submit[form.dataset.submit];
  if (h) h(form);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  const owner = el && el.closest('.kd-modal');
  const h = owner && owner._change && owner._change[el.dataset.change];
  if (h) h(el);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && D.settings) { $('.kd-modal') && $('.kd-modal').remove(); D.settings = null; } });

function registerSW() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.__MP_NO_SW__) {
    navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => { /* ignore */ });
  }
}

setInterval(tick, 1000);
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
boot();
