import {
  live, stamp, emptyDoc, normalizeDoc, itemKey, combineLines, scaleIngredients, parseIngredient, parseRecipeText, parseQty,
  formatAmount, formatQty, normUnit, unitDim, UNITS, recipeCost, planCost, groceryTotal, lineCost, findPrice, budgetProgress, money,
  guessSection, DEFAULT_SECTIONS, isoDate, parseDate, addDays, weekStartOf, daysBetween, uid, findTimers,
} from './core.js';
import { SEED_RECIPES, SEED_PANTRY } from './seed.js';
import { DocSync, kvGet, kvSet } from './sync.js';
import { $, $$, esc, ic, toast, openSheet, confirmSheet, initDrag, compressImage, pushOverlay } from './ui.js';

const SUPABASE_URL = 'https://fnkdyhmogylbibgsbhgc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZua2R5aG1vZ3lsYmliZ3NiaGdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyODQ2NjgsImV4cCI6MjEwNTg2MDY2OH0.yFa-0if7Xy5wAOYq_itlmi6P9wYQ6F3a3xQqMLTcXIM'; // public anon key; RLS protects the data
const SITE_URL = 'https://wealthsheethq.github.io/meal-planner/';

const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
const QUICK_NOTES = [['Leftovers', '🍲'], ['Eat out', '🍽️'], ['Takeout', '🥡'], ['Fend for yourselves', '🥪'], ['Freezer meal', '🧊'], ['Date night', '🕯️']];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMOJIS = ['🍽️', '🍝', '🍛', '🥘', '🍲', '🥗', '🌮', '🌯', '🍔', '🍕', '🍣', '🍜', '🥪', '🍳', '🥞', '🥣', '🍗', '🥩', '🐟', '🍤', '🥦', '🍅', '🧆', '🍰'];
const AV_COLORS = ['#C1603A', '#3D6139', '#8B5A7A', '#B8841E', '#3E7C8C', '#6B7F3E'];
const PRICE_UNITS = [['', 'each'], ['lb', 'lb'], ['oz', 'oz'], ['kg', 'kg'], ['g', 'g'], ['package', 'package'], ['can', 'can'], ['jar', 'jar'], ['bottle', 'bottle'], ['bag', 'bag'], ['box', 'box'], ['bunch', 'bunch'], ['head', 'head'], ['gallon', 'gallon'], ['quart', 'quart'], ['fl oz', 'fl oz'], ['cup', 'cup'], ['l', 'liter']];

const S = {
  sb: null, user: null, households: [], hid: null, members: [], invites: [], sync: null,
  doc: emptyDoc(), tab: 'plan', week: null, status: 'idle',
  rq: '', rtag: 'All', rsort: 'az', pantryFilter: 'all', openCart: false, openHave: false,
  timers: [], offlineUser: false, pendingRender: false, booted: false,
};
window.__mp = S; // handy for debugging from the console

/* ================================================================== *
 * Helpers
 * ================================================================== */
const today = () => isoDate(new Date());
const setting = (id, def) => { const e = S.doc.settings[id]; return e && !e.deleted && e.value !== undefined && e.value !== null ? e.value : def; };
const kitchen = () => S.households.find(h => h.id === S.hid);
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const grad = r => 'g' + (hash(r && r.id || 'x') % 6);
// Photos come from the shared doc — only ever render our own compressed data URLs.
const photo = r => r && typeof r.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.photo) ? r.photo : '';
const fmtDate = s => { const d = parseDate(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const fmtDay = s => DAY_NAMES[parseDate(s).getDay()];
const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;
const fmtMin = m => !m ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
const recipes = () => live(S.doc.recipes);
const recipe = id => { const r = S.doc.recipes[id]; return r && !r.deleted ? r : null; };
const sectionOrder = () => { const o = setting('sectionOrder', null); const base = Array.isArray(o) && o.length ? o.slice() : DEFAULT_SECTIONS.slice(); for (const s of DEFAULT_SECTIONS) if (!base.includes(s)) base.push(s); return base; };
const sectionFor = (key, name) => { const a = S.doc.aisles[key]; return a && !a.deleted && a.section ? a.section : guessSection(name); };
const isFav = r => !!r.fav || (r.rating || 0) >= 4;

function relDays(date) {
  const n = daysBetween(date, today());
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 0) return n === -1 ? 'tomorrow' : `in ${-n} days`;
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  return `${Math.round(n / 30)} months ago`;
}

function memberName(id) {
  if (!id) return '';
  if (id === 'together') return 'Together';
  const custom = setting('name:' + id, '');
  if (custom) return custom;
  const m = S.members.find(x => x.user_id === id);
  const email = m ? m.email : (S.user && S.user.id === id ? S.user.email : '');
  if (!email) return 'Someone';
  const local = email.split('@')[0].split(/[._+-]/)[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}
function avatar(id, cls = '') {
  if (!id) return '';
  if (id === 'together') return `<span class="avatar together ${cls}" title="Together">${ic('heart', 12)}</span>`;
  const n = memberName(id);
  return `<span class="avatar ${cls}" style="background:${AV_COLORS[hash(id) % AV_COLORS.length]}" title="${esc(n)}">${esc(n.slice(0, 2).toUpperCase())}</span>`;
}
function thumb(r, cls = '') {
  if (!r) return `<div class="thumb ${cls}">🍽️</div>`;
  return `<div class="thumb ${grad(r)} ${cls}">${photo(r) ? `<img src="${photo(r)}" alt="" loading="lazy">` : esc(r.emoji || '🍽️')}</div>`;
}
function cover(r, cls = '') {
  return `<div class="cover ${grad(r)} ${cls}">${photo(r) ? `<img src="${photo(r)}" alt="">` : `<span class="emoji">${esc(r.emoji || '🍽️')}</span>`}</div>`;
}

// Latest date each recipe was eaten (history log + past plan entries).
function lastHadMap() {
  const t = today();
  const m = new Map();
  const bump = (id, d) => { if (id && d <= t && (!m.has(id) || m.get(id) < d)) m.set(id, d); };
  for (const h of live(S.doc.history)) bump(h.recipeId, h.date);
  for (const p of live(S.doc.plan)) bump(p.recipeId, p.date);
  return m;
}

/* ================================================================== *
 * Mutations (with undo)
 * ================================================================== */
const META = ['id', 'updatedAt', 'updatedBy', '_f'];
function mutate(fn, { toast: msg, undo = true } = {}) {
  const before = [];
  const seen = new Set();
  const api = {
    put(col, id, patch) {
      const k = col + '\u0000' + id;
      if (!seen.has(k)) { seen.add(k); before.push([col, id, S.doc[col][id] || null]); }
      S.doc[col][id] = stamp(S.doc[col][id], { ...patch, id }, S.user && S.user.id);
      return S.doc[col][id];
    },
    del(col, id) { const e = S.doc[col][id]; if (e && !e.deleted) api.put(col, id, { deleted: true }); },
  };
  const result = fn(api);
  if (before.length) {
    if (S.sync) S.sync.touched(S.doc);
    render();
    if (msg) toast(msg, undo ? () => revert(before) : null);
  } else if (msg) toast(msg);
  return result;
}
function revert(before) {
  mutate(api => {
    for (const [col, id, prev] of before) {
      const cur = S.doc[col][id];
      if (!prev) { api.del(col, id); continue; }
      const patch = {};
      for (const k of Object.keys(prev)) if (!META.includes(k)) patch[k] = prev[k];
      if (cur) for (const k of Object.keys(cur)) if (!(k in prev) && !META.includes(k)) patch[k] = null;
      api.put(col, id, patch);
    }
  });
  toast('Undone');
}
const setSetting = (api, id, value) => api.put('settings', id, { value });

function seedIfNeeded() {
  if (setting('seeded', false)) return;
  // Ancient clock (1) so real edits/deletes always win and double-seeding is harmless.
  for (const r of SEED_RECIPES) if (!S.doc.recipes[r.id]) S.doc.recipes[r.id] = stamp(null, { ...r, createdAt: 1 }, 'seed', 1);
  for (const p of SEED_PANTRY) if (!S.doc.pantry[p.id]) S.doc.pantry[p.id] = stamp(null, { ...p, key: itemKey(p.name) }, 'seed', 1);
  S.doc.settings.seeded = stamp(null, { id: 'seeded', value: true }, 'seed', 1);
  if (S.sync) S.sync.touched(S.doc);
}

/* ================================================================== *
 * Boot + auth
 * ================================================================== */
const app = () => $('#app');

function applyTheme() {
  let t = 'system';
  try { t = localStorage.getItem('mp:theme') || 'system'; } catch { /* ignore */ }
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#12150F' : '#FAF6EE';
}

function redirectUrl() {
  return /github\.io$/.test(location.hostname) ? SITE_URL : location.origin + location.pathname;
}

function renderAuth({ msg = '', kind = '', sent = '' } = {}) {
  S.booted = true;
  app().innerHTML = `
  <div class="auth">
    <div class="auth-hero">
      <div class="brand"><span class="brand-mark">${ic('utensils', 20)}</span>Meal Planner</div>
      <h1>Dinner, decided. Together.</h1>
      <p>Plan the week, build the grocery list in one tap, and cook without the scramble.</p>
      <div class="auth-plate" aria-hidden="true"></div>
    </div>
    <div class="auth-card">
      ${sent ? `
        <div class="empty-art" style="margin:8px 0 18px">📬</div>
        <h2>Check your inbox</h2>
        <p class="muted">We sent a sign-in link to <b>${esc(sent)}</b>. Open it on this device and you'll land right back here.</p>
        <button class="btn btn-line" data-act="auth-back" style="margin-top:12px">Use a different email</button>
      ` : `
        <h2>Welcome back</h2>
        <p class="muted" style="margin:0 0 18px">Sign in with a magic link — no password needed.</p>
        <form data-submit="signin" class="stack">
          <label class="field"><span>Email</span>
            <input class="input" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required></label>
          <button class="btn btn-primary btn-block" type="submit">${ic('mail', 18)} Email me a sign-in link</button>
        </form>
        ${msg ? `<div class="auth-msg ${kind}">${esc(msg)}</div>` : ''}
        <div class="auth-features">
          <div>${ic('plan', 18)} A shared week plan you both can edit</div>
          <div>${ic('cart', 18)} Grocery lists that check off live on both phones</div>
          <div>${ic('cloud', 18)} Works offline, syncs when you're back</div>
        </div>
      `}
    </div>
  </div>`;
}

async function signIn(form) {
  const email = form.email.value.trim().toLowerCase();
  if (!email) return;
  const btn = form.querySelector('button');
  btn.disabled = true; btn.textContent = 'Sending…';
  if (!S.sb) { renderAuth({ msg: "You're offline. Connect to the internet to sign in.", kind: 'err' }); return; }
  try {
    const { error } = await S.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl(), shouldCreateUser: false } });
    if (error) throw error;
    renderAuth({ sent: email });
  } catch (e) {
    const m = String(e && e.message || e);
    const friendly = /signup|sign up|not allowed|not found|otp_disabled|user/i.test(m)
      ? "We couldn't sign you in with that email. New sign-ups are closed — ask whoever set up your kitchen to create an account for you, then try again."
      : /rate|seconds|too many/i.test(m) ? 'Too many attempts — please wait a minute and try again.'
        : navigator.onLine === false ? "You're offline. Connect to the internet to sign in." : "Sign-in didn't work just now. Please try again in a moment.";
    renderAuth({ msg: friendly, kind: 'err' });
  }
}

async function boot() {
  applyTheme();
  registerSW();
  app().innerHTML = `<div class="boot"><div class="boot-mark">${ic('utensils', 30)}</div></div>`;
  if (!window.supabase || !window.supabase.createClient) {
    const last = await kvGet('last-user');
    if (last) return startApp(last, { offline: true });
    return renderAuth({ msg: "You're offline. Connect once to sign in — after that the app works offline.", kind: 'err' });
  }
  S.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'meal-planner-auth' },
  });
  const params = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
  const hashErr = params.get('error_description');
  S.sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (session && session.user) { if (!S.user || S.user.id !== session.user.id || S.offlineUser) startApp(session.user); }
      else if (event === 'SIGNED_OUT') stopApp();
    }, 0);
  });
  let session = null;
  try { const { data } = await S.sb.auth.getSession(); session = data && data.session; } catch { /* offline */ }
  if (session) {
    if (!S.user) startApp(session.user);
    if (/access_token|code=/.test(location.href)) history.replaceState(null, '', location.pathname);
  } else if (navigator.onLine === false) {
    const last = await kvGet('last-user');
    if (last) startApp(last, { offline: true }); else renderAuth({ msg: "You're offline. Connect to sign in.", kind: 'err' });
  } else {
    renderAuth(hashErr ? { msg: /expired|invalid/i.test(hashErr) ? 'That sign-in link has expired. Send yourself a fresh one.' : hashErr.replace(/\+/g, ' '), kind: 'err' } : {});
    if (hashErr) history.replaceState(null, '', location.pathname);
  }
}

function stopApp() {
  if (S.sync) S.sync.stop();
  Object.assign(S, { user: null, households: [], hid: null, members: [], invites: [], sync: null, doc: emptyDoc(), shell: false });
  renderAuth();
}

async function startApp(user, { offline = false } = {}) {
  S.user = { id: user.id, email: user.email };
  S.offlineUser = offline;
  kvSet('last-user', S.user);
  if (!S.shell) app().innerHTML = `<div class="boot"><div class="boot-mark">${ic('utensils', 30)}</div></div>`;
  const cached = await kvGet('households:' + user.id);
  if (!offline && S.sb && navigator.onLine !== false) {
    try { await S.sb.rpc('accept_meal_invites'); } catch { /* not fatal */ }
    try { await loadHouseholds(); } catch (e) { console.warn(e); S.households = cached || []; }
  } else S.households = cached || [];
  if (!S.households.length) return renderOnboarding();
  let hid = null;
  try { hid = localStorage.getItem('mp:hid'); } catch { /* ignore */ }
  openKitchen(S.households.some(h => h.id === hid) ? hid : S.households[0].id);
}

async function loadHouseholds() {
  const { data, error } = await S.sb.from('meal_households').select('id, name, created_by, created_at').order('created_at');
  if (error) throw error;
  S.households = data || [];
  kvSet('households:' + S.user.id, S.households);
}

function renderOnboarding(msg = '') {
  S.booted = true; S.shell = false;
  app().innerHTML = `
  <div class="auth">
    <div class="auth-hero">
      <div class="brand"><span class="brand-mark">${ic('utensils', 20)}</span>Meal Planner</div>
      <h1>Let's set up your kitchen.</h1>
      <p>Your kitchen holds your recipes, week plan, pantry and grocery list — shared with whoever you invite.</p>
      <div class="auth-plate" aria-hidden="true"></div>
    </div>
    <div class="auth-card">
      <h2>Name your kitchen</h2>
      <p class="muted" style="margin:0 0 18px">You can rename it any time.</p>
      <form data-submit="create-kitchen" class="stack">
        <label class="field"><span>Kitchen name</span><input class="input" name="name" value="Our Kitchen" maxlength="60" required></label>
        <button class="btn btn-primary btn-block" type="submit">${ic('home', 18)} Create kitchen</button>
      </form>
      ${msg ? `<div class="auth-msg err">${esc(msg)}</div>` : ''}
      <p class="small muted" style="margin-top:18px">Waiting on an invite instead? Ask your partner to invite <b>${esc(S.user.email || 'your email')}</b> from <i>More → Kitchen</i>, then <a href="#" data-act="recheck-invites">check again</a>.</p>
      <button class="btn btn-ghost btn-sm" data-act="sign-out" style="margin-top:8px">${ic('logout', 16)} Sign out</button>
    </div>
  </div>`;
}

async function createKitchen(name) {
  if (!S.sb || navigator.onLine === false) { toast("You're offline — connect to create a kitchen"); return; }
  const { data, error } = await S.sb.rpc('create_meal_household', { p_name: name || 'Our Kitchen' });
  if (error) { toast("Couldn't create the kitchen. Please try again."); return false; }
  await loadHouseholds();
  const id = typeof data === 'string' ? data : (data && (data.id || data[0])) || S.households[S.households.length - 1].id;
  openKitchen(id);
  return true;
}

async function openKitchen(hid) {
  if (S.sync) S.sync.stop();
  S.hid = hid;
  try { localStorage.setItem('mp:hid', hid); } catch { /* ignore */ }
  S.doc = emptyDoc();
  S.members = (await kvGet('members:' + hid)) || [{ user_id: S.user.id, email: S.user.email, role: 'owner' }];
  const sync = new DocSync({
    sb: S.offlineUser ? null : S.sb, householdId: hid, userId: S.user.id,
    onChange: (doc) => { if (S.sync !== sync) return; S.doc = doc; if (sync.loaded) seedIfNeeded(); renderSoon(); },
    onStatus: (st) => { S.status = st; updateSyncDot(); },
  });
  S.sync = sync;
  const hadCache = await sync.loadCache();
  S.doc = sync.doc;
  S.week = weekStartOf(today(), setting('weekStart', 0));
  if (hadCache || S.offlineUser || navigator.onLine === false) seedIfNeeded();
  buildShell();
  render();
  if (!S.offlineUser && S.sb) {
    sync.pull().then(() => { if (!hadCache) seedIfNeeded(); });
    sync.subscribe();
    loadMembers();
  } else { S.status = 'offline'; updateSyncDot(); }
}

async function loadMembers() {
  if (!S.sb || S.offlineUser) return;
  try {
    const { data, error } = await S.sb.from('meal_members').select('household_id, user_id, email, role, joined_at').eq('household_id', S.hid).order('joined_at');
    if (error) throw error;
    if (data && data.length) { S.members = data; kvSet('members:' + S.hid, data); render(); }
  } catch (e) { console.warn('members', e); }
}

/* ================================================================== *
 * Shell + rendering
 * ================================================================== */
const TABS = [['plan', 'Plan', 'plan'], ['recipes', 'Recipes', 'book'], ['groceries', 'Groceries', 'cart'], ['pantry', 'Pantry', 'jar'], ['more', 'More', 'more']];

function buildShell() {
  S.shell = true; S.booted = true;
  app().innerHTML = `
    <div class="shell">
      <div id="offline" class="offline-banner hidden">${ic('wifioff', 15)} Offline — changes are saved on this device and will sync</div>
      <header class="topbar" id="topbar"></header>
      <main class="main" id="view"></main>
    </div>
    <nav class="tabbar" aria-label="Main"><div class="tabbar-in">
      <div class="rail-brand brand"><span class="brand-mark" style="background:var(--primary);color:var(--on-primary)">${ic('utensils', 18)}</span>Meal Planner</div>
      ${TABS.map(([id, label, icon]) => `<button class="tab" data-act="tab" data-tab="${id}" aria-label="${label}">${ic(icon, 23)}<span>${label}</span><i class="badge hidden" data-badge="${id}"></i></button>`).join('')}
    </div></nav>`;
  onScroll();
}

function render() {
  if (!S.shell || !S.user) return;
  S.pendingRender = false;
  $$('.tab').forEach(t => { const on = t.dataset.tab === S.tab; t.classList.toggle('on', on); t.setAttribute('aria-current', on ? 'page' : 'false'); });
  const need = groceryVisible().filter(g => !g.checked && !g.have).length;
  const b = $('[data-badge="groceries"]');
  if (b) { b.textContent = need; b.classList.toggle('hidden', !need); }
  const views = { plan: viewPlan, recipes: viewRecipes, groceries: viewGroceries, pantry: viewPantry, more: viewMore };
  const [top, body] = views[S.tab]();
  $('#topbar').innerHTML = `<div class="topbar-in">${top}</div>`;
  const v = $('#view');
  if (v.dataset.tab !== S.tab) { v.dataset.tab = S.tab; v.innerHTML = `<div class="view">${body}</div>`; }
  else v.firstElementChild ? (v.firstElementChild.innerHTML = body) : (v.innerHTML = `<div class="view">${body}</div>`);
  updateSyncDot();
  // Refresh open sheets that show live data (unless the user is typing in them).
  $$('.sheet').forEach(el => {
    const s = el._sheet;
    if (s && s.opts.live && !s.closed && !(el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) s.refreshBody();
  });
}

function isEditing() {
  const a = document.activeElement;
  return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'file';
}
function renderSoon() {
  if (!S.shell) return;
  if (isEditing() && ($('#view').contains(document.activeElement))) { S.pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => setTimeout(() => { if (S.pendingRender && !isEditing()) render(); }, 0));

function updateSyncDot() {
  const map = { synced: 'Synced', syncing: 'Syncing…', pending: 'Saving…', offline: 'Offline', error: 'Sync issue — retrying', idle: '' };
  $$('.sync-dot').forEach(d => { d.className = 'sync-dot ' + S.status; d.title = map[S.status] || ''; });
  $$('[data-sync-text]').forEach(d => { d.textContent = map[S.status] || ''; });
  const off = $('#offline');
  if (off) off.classList.toggle('hidden', !(S.status === 'offline' || navigator.onLine === false));
}

function onScroll() { const t = $('#topbar'); if (t) t.classList.toggle('scrolled', window.scrollY > 4); }
window.addEventListener('scroll', onScroll, { passive: true });

function kitchenPill() {
  const k = kitchen();
  return `<div class="kitchen-pill"><span class="sync-dot ${S.status}"></span><span class="ellipsis" style="max-width:52vw">${esc(k ? k.name : 'Kitchen')}</span></div>`;
}

function setTab(tab) {
  if (S.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  S.tab = tab;
  render();
  window.scrollTo(0, 0);
}

/* ================================================================== *
 * PLAN
 * ================================================================== */
function weekEntries(ws = S.week) { const we = addDays(ws, 6); return live(S.doc.plan).filter(e => e.date >= ws && e.date <= we); }
const sortEntries = list => list.sort((a, b) => (a.order || 0) - (b.order || 0));

function weekLabel() {
  const cur = weekStartOf(today(), setting('weekStart', 0));
  const diff = daysBetween(cur, S.week) / 7;
  return diff === 0 ? 'This week' : diff === 1 ? 'Next week' : diff === -1 ? 'Last week' : `Week of ${fmtDate(S.week)}`;
}

function viewPlan() {
  const ws = S.week, we = addDays(ws, 6), t = today();
  const cur = weekStartOf(t, setting('weekStart', 0));
  const entries = weekEntries();
  const budget = +setting('budget', 0) || 0;
  const cost = planCost(entries, S.doc.recipes, S.doc.prices);
  const bp = budgetProgress(cost, budget);
  const meals = entries.filter(e => e.recipeId || e.note).length;
  const range = `${fmtDate(ws)} – ${parseDate(ws).getMonth() === parseDate(we).getMonth() ? parseDate(we).getDate() : fmtDate(we)}`;

  const top = `
    <div class="grow">${kitchenPill()}<h1>${weekLabel()}</h1></div>
    <div class="week-nav">
      ${ws !== cur ? `<button class="chip" data-act="week-today">Today</button>` : ''}
      <button class="icon-btn filled" data-act="week-prev" aria-label="Previous week">${ic('left')}</button>
      <button class="icon-btn filled" data-act="week-next" aria-label="Next week">${ic('right')}</button>
    </div>`;

  // Tonight card
  const tonightEntries = sortEntries(live(S.doc.plan).filter(e => e.date === t && e.slot === 'dinner'));
  const tonight = tonightEntries.find(e => e.recipeId && recipe(e.recipeId)) || tonightEntries[0];
  const tr = tonight && tonight.recipeId && recipe(tonight.recipeId);
  const tonightCard = `
    <div class="card summary-card">
      <div class="eyebrow">Tonight · ${fmtDay(t)}</div>
      ${tr ? `<div class="row">${thumb(tr, '').replace('class="thumb', 'style="width:52px;height:52px;border-radius:14px;font-size:26px" class="thumb')}
          <div class="grow"><h3 class="display" style="font-size:19px">${esc(tr.title)}</h3><div class="small muted">${[fmtMin((tr.prepMin || 0) + (tr.cookMin || 0)), tonight.cook ? memberName(tonight.cook) + ' cooking' : ''].filter(Boolean).join(' · ')}</div></div></div>
          <div class="row"><button class="btn btn-accent btn-sm" data-act="cook" data-id="${tr.id}" data-serv="${tonight.servings || tr.servings}">${ic('play', 16)} Start cooking</button><button class="btn btn-ghost btn-sm" data-act="open-recipe" data-id="${tr.id}">View recipe</button></div>`
      : tonight ? `<h3 class="display" style="font-size:19px">${esc(tonight.note || 'Planned')}</h3>`
        : `<h3 class="display" style="font-size:19px">Nothing planned yet</h3><div class="row"><button class="btn btn-soft btn-sm" data-act="pick">${ic('shuffle', 16)} Pick for us</button><button class="btn btn-ghost btn-sm" data-act="add" data-date="${t}" data-slot="dinner">${ic('plus', 16)} Add dinner</button></div>`}
    </div>`;

  const summary = `
    <div class="plan-summary">
      <div class="card summary-card">
        <div class="summary-stats">
          <div class="stat"><b>${meals}</b><span>${meals === 1 ? 'meal' : 'meals'} planned</span></div>
          <div class="stat"><b>${cost ? money(cost) : '—'}</b><span>est. meal cost</span></div>
          ${budget ? `<div class="stat"><b>${money(budget)}</b><span>weekly budget</span></div>` : ''}
        </div>
        ${budget ? `<div class="bar ${bp.over ? 'over' : ''}"><i style="width:${bp.pct}%"></i></div><div class="tiny muted">${bp.over ? `${money(-bp.remaining)} over budget` : `${money(bp.remaining)} left in budget`}</div>`
      : `<button class="btn btn-ghost btn-sm" style="align-self:flex-start;margin-left:-10px" data-act="open-prices">${ic('dollar', 16)} Set a weekly budget</button>`}
      </div>
      ${ws === cur ? tonightCard : ''}
    </div>
    <div class="plan-actions">
      <button class="btn btn-primary btn-sm" data-act="build-list">${ic('cart', 17)} Build grocery list</button>
      <button class="btn btn-line btn-sm" data-act="copy-week">${ic('copy', 17)} Copy last week</button>
      <button class="btn btn-line btn-sm" data-act="pick">${ic('shuffle', 17)} What should we eat?</button>
    </div>`;

  // Recipe shelf (drag onto a day)
  const lh = lastHadMap();
  const shelfRecipes = recipes().sort((a, b) => (isFav(b) - isFav(a)) || ((lh.get(b.id) || '').localeCompare(lh.get(a.id) || '')) || a.title.localeCompare(b.title)).slice(0, 14);
  const shelf = shelfRecipes.length ? `
    <div class="shelf">
      <div class="shelf-head"><span class="eyebrow">Recipe shelf</span><span class="tiny muted ellipsis">${matchMedia('(pointer: coarse)').matches ? 'Hold & drag onto a meal, or tap' : 'Drag onto a meal, or click'}</span></div>
      <div class="shelf-list">${shelfRecipes.map(r => `<button class="shelf-item" data-drag="recipe:${r.id}" data-act="plan-recipe" data-id="${r.id}">${thumb(r)}<span>${esc(r.title)}</span></button>`).join('')}</div>
    </div>` : '';

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const dayEntries = entries.filter(e => e.date === d);
    const dayCost = planCost(dayEntries, S.doc.recipes, S.doc.prices);
    days.push(`
      <section class="day ${d === t ? 'today' : ''} ${d < t ? 'past' : ''}" aria-label="${fmtDay(d)}">
        <div class="day-head"><span class="day-name">${fmtDay(d).slice(0, 3)}</span><span class="day-date">${fmtDate(d)}</span>${d === t ? '<span class="today-badge">Today</span>' : ''}${dayCost ? `<span class="day-cost">${money(dayCost)}</span>` : ''}</div>
        ${SLOTS.map(([slot, label]) => {
      const list = sortEntries(dayEntries.filter(e => e.slot === slot));
      return `<div class="slot" data-slot="${slot}" data-drop="${d}|${slot}">
            <div class="slot-label"><i></i>${label}</div>
            <div class="slot-items">
              ${list.map(entryHtml).join('')}
              <button class="add-slot" data-act="add" data-date="${d}" data-slot="${slot}" aria-label="Add ${label.toLowerCase()} on ${fmtDay(d)}">${ic('plus', 16)}${list.length ? '' : 'Add'}</button>
            </div>
          </div>`;
    }).join('')}
      </section>`);
  }
  const body = `${summary}${shelf}
    <div class="section-head"><h2>${range}</h2><span class="muted small">${plural(meals, 'meal')}</span></div>
    <div class="days wide">${days.join('')}</div>`;
  return [top, body];
}

function entryHtml(e) {
  const r = e.recipeId && recipe(e.recipeId);
  if (r) {
    const serv = e.servings || r.servings;
    const c = recipeCost(r, S.doc.prices, serv);
    return `<button class="entry" data-act="entry" data-id="${e.id}" data-drag="entry:${e.id}">
      ${thumb(r)}
      <div class="grow"><div class="entry-title">${esc(r.title)}</div><div class="entry-meta"><span>${serv} serv</span>${c.priced ? `<span>${money(c.total)}</span>` : ''}</div></div>
      ${avatar(e.cook)}
    </button>`;
  }
  const qn = QUICK_NOTES.find(q => q[0].toLowerCase() === String(e.note || '').toLowerCase());
  return `<button class="entry note" data-act="entry" data-id="${e.id}" data-drag="entry:${e.id}">
    <div class="thumb">${qn ? qn[1] : '📝'}</div>
    <div class="grow"><div class="entry-title">${esc(e.note || (e.recipeId ? 'Deleted recipe' : 'Note'))}</div></div>
    ${avatar(e.cook)}
  </button>`;
}

function addEntry(api, { date, slot, recipeId = null, note = '', servings = null, cook = '' }) {
  const r = recipeId && recipe(recipeId);
  const id = uid('p_');
  api.put('plan', id, { date, slot, recipeId, note, servings: servings || (r ? r.servings : null), cook, order: Date.now(), createdAt: Date.now() });
  return id;
}

function openAddSheet(date, slot) {
  const st = { mode: 'recipe', q: '', servings: +setting('defaultServings', 0) || 0, cook: '', note: '' };
  const slotLabel = SLOTS.find(s => s[0] === slot)[1];
  const results = () => {
    const q = st.q.trim().toLowerCase();
    const lh = lastHadMap();
    let list = recipes();
    if (q) list = list.filter(r => searchRecipe(r, q));
    list.sort((a, b) => (isFav(b) - isFav(a)) || a.title.localeCompare(b.title));
    if (!list.length) return `<div class="empty" style="padding:24px 0"><p>No recipes match “${esc(st.q)}”.</p><button class="btn btn-soft btn-sm" data-act="as-note-from-q">Add “${esc(st.q)}” as a note</button></div>`;
    return `<div class="list">${list.slice(0, 60).map(r => `
      <button class="list-item" data-act="pick-recipe" data-id="${r.id}">
        ${thumb(r).replace('class="thumb', 'style="width:44px;height:44px;border-radius:12px;font-size:22px" class="thumb')}
        <div class="grow"><div class="li-title ellipsis">${esc(r.title)}</div>
        <div class="li-sub">${[fmtMin((r.prepMin || 0) + (r.cookMin || 0)), isFav(r) ? '♥ favorite' : '', lh.get(r.id) ? 'had ' + relDays(lh.get(r.id)) : ''].filter(Boolean).join(' · ')}</div></div>
        <span class="icon-btn sm filled">${ic('plus', 18)}</span>
      </button>`).join('')}</div>`;
  };
  const who = () => `<div class="chips wrap">${[['', 'Anyone'], ...S.members.map(m => [m.user_id, memberName(m.user_id)]), ['together', 'Together']].map(([id, n]) => `<button class="chip ${st.cook === id ? 'on' : ''}" data-act="as-cook" data-id="${id}">${id ? avatar(id) : ''}${esc(n)}</button>`).join('')}</div>`;
  const s = openSheet({
    title: `${slotLabel} · ${fmtDay(date).slice(0, 3)} ${fmtDate(date)}`,
    body: () => `
      <div class="seg" style="margin-bottom:14px"><button class="${st.mode === 'recipe' ? 'on' : ''}" data-act="as-mode" data-mode="recipe">Recipe</button><button class="${st.mode === 'note' ? 'on' : ''}" data-act="as-mode" data-mode="note">Quick note</button></div>
      <div class="row wrap" style="margin-bottom:12px;justify-content:space-between">
        <div class="row"><span class="small muted" style="font-weight:600">Servings</span>
          <div class="stepper"><button data-act="as-serv" data-d="-1" aria-label="Fewer">${ic('minus', 16)}</button><output>${st.servings || 'Recipe'}</output><button data-act="as-serv" data-d="1" aria-label="More">${ic('plus', 16)}</button></div></div>
      </div>
      <div style="margin-bottom:14px"><div class="small muted" style="font-weight:600;margin-bottom:6px">Who's cooking</div>${who()}</div>
      ${st.mode === 'recipe' ? `
        <div class="input-icon" style="margin-bottom:12px">${ic('search', 18)}<input class="input" data-input="as-q" placeholder="Search recipes or ingredients" value="${esc(st.q)}" autocomplete="off"></div>
        <div class="add-results">${results()}</div>`
      : `<div class="chips wrap" style="margin-bottom:14px">${QUICK_NOTES.map(([n, e]) => `<button class="chip" data-act="as-quick" data-note="${esc(n)}">${e} ${esc(n)}</button>`).join('')}</div>
        <form data-submit="as-note" class="row"><input class="input grow" name="note" placeholder="Or write your own…" maxlength="80" value="${esc(st.note)}"><button class="btn btn-primary" type="submit">Add</button></form>`}`,
    actions: {
      'as-mode': el => { st.mode = el.dataset.mode; s.refreshBody(); },
      'as-serv': el => { const n = (st.servings || 0) + +el.dataset.d; st.servings = Math.max(0, Math.min(40, n)); s.el.querySelector('.stepper output').textContent = st.servings || 'Recipe'; },
      'as-cook': el => { st.cook = el.dataset.id; s.refreshBody(); },
      'as-q': el => { st.q = el.value; s.el.querySelector('.add-results').innerHTML = results(); },
      'pick-recipe': el => {
        const r = recipe(el.dataset.id);
        mutate(api => addEntry(api, { date, slot, recipeId: r.id, servings: st.servings || r.servings, cook: st.cook }), { toast: `Added ${r.title} to ${fmtDay(date)}` });
        s.close();
      },
      'as-quick': el => { mutate(api => addEntry(api, { date, slot, note: el.dataset.note, cook: st.cook }), { toast: `Added “${el.dataset.note}”` }); s.close(); },
      'as-note-from-q': () => { const n = st.q.trim(); if (!n) return; mutate(api => addEntry(api, { date, slot, note: n, cook: st.cook }), { toast: `Added “${n}”` }); s.close(); },
      'as-note': form => { const n = form.note.value.trim(); if (!n) return; mutate(api => addEntry(api, { date, slot, note: n, cook: st.cook }), { toast: `Added “${n}”` }); s.close(); },
    },
  });
}

function openEntrySheet(id) {
  const s = openSheet({
    live: true,
    title: () => { const e = S.doc.plan[id]; return e ? `${SLOTS.find(x => x[0] === e.slot)[1]} · ${fmtDay(e.date).slice(0, 3)} ${fmtDate(e.date)}` : 'Meal'; },
    body: () => {
      const e = S.doc.plan[id];
      if (!e || e.deleted) return `<div class="empty"><p>This meal was removed.</p></div>`;
      const r = e.recipeId && recipe(e.recipeId);
      const serv = e.servings || (r && r.servings) || 1;
      const c = r ? recipeCost(r, S.doc.prices, serv) : null;
      const days = []; for (let i = -7; i < 14; i++) days.push(addDays(S.week, i));
      if (!days.includes(e.date)) days.unshift(e.date);
      return `
        ${r ? `<button class="list" style="width:100%;margin-bottom:16px" data-act="open-recipe" data-id="${r.id}">
            <div class="list-item">${thumb(r).replace('class="thumb', 'style="width:56px;height:56px;border-radius:14px;font-size:28px" class="thumb')}
            <div class="grow"><div class="li-title">${esc(r.title)}</div><div class="li-sub">${[fmtMin((r.prepMin || 0) + (r.cookMin || 0)), c && c.priced ? `${money(c.total)} · ${money(c.perServing)}/serving` : ''].filter(Boolean).join(' · ')}</div></div>${ic('right', 18, 'class="chev"')}</div></button>`
          : `<label class="field" style="margin-bottom:16px"><span>Note</span><input class="input" data-change="en-note" value="${esc(e.note || '')}" maxlength="80"></label>`}
        ${r ? `<div class="row" style="justify-content:space-between;margin-bottom:16px"><span style="font-weight:600">Servings</span>
          <div class="stepper"><button data-act="en-serv" data-d="-1" aria-label="Fewer">${ic('minus', 16)}</button><output>${serv}</output><button data-act="en-serv" data-d="1" aria-label="More">${ic('plus', 16)}</button></div></div>` : ''}
        <div style="margin-bottom:16px"><div style="font-weight:600;margin-bottom:8px">Who's cooking</div>
          <div class="chips wrap">${[['', 'Anyone'], ...S.members.map(m => [m.user_id, memberName(m.user_id)]), ['together', 'Together']].map(([mid, n]) => `<button class="chip ${(e.cook || '') === mid ? 'on' : ''}" data-act="en-cook" data-id="${mid}">${mid ? avatar(mid) : ''}${esc(n)}</button>`).join('')}</div></div>
        <div class="grid-2" style="margin-bottom:18px">
          <label class="field"><span>Day</span><select class="select" data-change="en-date">${days.map(d => `<option value="${d}" ${d === e.date ? 'selected' : ''}>${fmtDay(d).slice(0, 3)} ${fmtDate(d)}</option>`).join('')}</select></label>
          <label class="field"><span>Meal</span><select class="select" data-change="en-slot">${SLOTS.map(([v, l]) => `<option value="${v}" ${v === e.slot ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div class="action-list">
          ${r ? `<button class="action" data-act="cook" data-id="${r.id}" data-serv="${serv}">${ic('play', 20)} Start cook mode</button>` : ''}
          ${r ? `<button class="action" data-act="en-swap">${ic('refresh', 20)} Swap for another recipe</button>` : ''}
          <button class="action" data-act="en-dup">${ic('copy', 20)} Duplicate to tomorrow</button>
          <button class="action danger" data-act="en-del">${ic('trash', 20)} Remove from plan</button>
        </div>`;
    },
    actions: {
      'en-serv': el => { const e = S.doc.plan[id]; const r = recipe(e.recipeId); const cur = e.servings || (r && r.servings) || 1; mutate(api => api.put('plan', id, { servings: Math.max(1, Math.min(40, cur + +el.dataset.d)) })); },
      'en-cook': el => mutate(api => api.put('plan', id, { cook: el.dataset.id })),
      'en-note': el => mutate(api => api.put('plan', id, { note: el.value.trim() })),
      'en-date': el => mutate(api => api.put('plan', id, { date: el.value, order: Date.now() })),
      'en-slot': el => mutate(api => api.put('plan', id, { slot: el.value, order: Date.now() })),
      'en-dup': () => { const e = S.doc.plan[id]; mutate(api => addEntry(api, { ...e, date: addDays(e.date, 1) }), { toast: `Duplicated to ${fmtDay(addDays(e.date, 1))}` }); },
      'en-del': () => { const e = S.doc.plan[id]; const r = recipe(e.recipeId); s.close(); mutate(api => api.del('plan', id), { toast: `Removed ${r ? r.title : e.note || 'meal'}` }); },
      'en-swap': () => { const e = S.doc.plan[id]; s.close(); setTimeout(() => openSwap(id, e), 50); },
    },
  });
}

function openSwap(id, e) {
  const st = { q: '' };
  const list = () => {
    const q = st.q.trim().toLowerCase();
    const rs = recipes().filter(r => !q || searchRecipe(r, q)).sort((a, b) => a.title.localeCompare(b.title));
    return `<div class="list">${rs.map(r => `<button class="list-item" data-act="sw-pick" data-id="${r.id}">${thumb(r).replace('class="thumb', 'style="width:40px;height:40px;border-radius:10px;font-size:20px" class="thumb')}<div class="grow li-title ellipsis">${esc(r.title)}</div></button>`).join('')}</div>`;
  };
  const s = openSheet({
    title: 'Swap recipe',
    body: () => `<div class="input-icon" style="margin-bottom:12px">${ic('search', 18)}<input class="input" data-input="sw-q" placeholder="Search recipes" autocomplete="off"></div><div class="sw-list">${list()}</div>`,
    actions: {
      'sw-q': el => { st.q = el.value; s.el.querySelector('.sw-list').innerHTML = list(); },
      'sw-pick': el => { const r = recipe(el.dataset.id); mutate(api => api.put('plan', id, { recipeId: r.id, note: '', servings: e.servings || r.servings }), { toast: `Swapped in ${r.title}` }); s.close(); },
    },
  });
}

// Choose a day + meal for a recipe (from recipe detail, shelf tap, history, picker)
function openPlanPicker(recipeId, { defaultSlot } = {}) {
  const r = recipe(recipeId);
  if (!r) return;
  const tags = (r.tags || []).map(t => t.toLowerCase());
  const st = { slot: defaultSlot || (tags.includes('breakfast') ? 'breakfast' : tags.includes('lunch') ? 'lunch' : 'dinner'), servings: r.servings || 2, week: S.week };
  const s = openSheet({
    title: `Plan ${r.title}`,
    narrow: true,
    body: () => {
      const t = today();
      const days = []; for (let i = 0; i < 7; i++) days.push(addDays(st.week, i));
      return `
        <div class="seg" style="margin-bottom:14px">${SLOTS.map(([v, l]) => `<button class="${st.slot === v ? 'on' : ''}" data-act="pp-slot" data-slot="${v}">${l}</button>`).join('')}</div>
        <div class="row" style="justify-content:space-between;margin-bottom:12px"><span style="font-weight:600">Servings</span>
          <div class="stepper"><button data-act="pp-serv" data-d="-1" aria-label="Fewer">${ic('minus', 16)}</button><output>${st.servings}</output><button data-act="pp-serv" data-d="1" aria-label="More">${ic('plus', 16)}</button></div></div>
        <div class="row" style="justify-content:space-between;margin:6px 0 8px">
          <button class="icon-btn sm" data-act="pp-week" data-d="-7" aria-label="Previous week">${ic('left', 18)}</button>
          <span class="small" style="font-weight:600">Week of ${fmtDate(st.week)}</span>
          <button class="icon-btn sm" data-act="pp-week" data-d="7" aria-label="Next week">${ic('right', 18)}</button></div>
        <div class="list">${days.map(d => {
        const n = live(S.doc.plan).filter(e => e.date === d && e.slot === st.slot).map(e => (recipe(e.recipeId) || {}).title || e.note).filter(Boolean);
        return `<button class="list-item" data-act="pp-day" data-date="${d}" ${d < t ? 'style="opacity:.6"' : ''}>
            <div class="grow"><div class="li-title">${fmtDay(d)}${d === t ? ' <span class="tag terra">Today</span>' : ''}</div><div class="li-sub ellipsis">${fmtDate(d)}${n.length ? ' · ' + esc(n.join(', ')) : ''}</div></div>${ic('plus', 18, 'class="chev"')}</button>`;
      }).join('')}</div>`;
    },
    actions: {
      'pp-slot': el => { st.slot = el.dataset.slot; s.refreshBody(); },
      'pp-serv': el => { st.servings = Math.max(1, Math.min(40, st.servings + +el.dataset.d)); s.el.querySelector('.stepper output').textContent = st.servings; },
      'pp-week': el => { st.week = addDays(st.week, +el.dataset.d); s.refreshBody(); },
      'pp-day': el => {
        const d = el.dataset.date;
        mutate(api => addEntry(api, { date: d, slot: st.slot, recipeId: r.id, servings: st.servings }), { toast: `Planned for ${fmtDay(d)} ${SLOTS.find(x => x[0] === st.slot)[1].toLowerCase()}` });
        s.close();
      },
    },
  });
}

function copyLastWeek() {
  const prev = weekEntries(addDays(S.week, -7));
  if (!prev.length) { toast('Nothing was planned last week'); return; }
  mutate(api => { for (const e of prev) addEntry(api, { ...e, date: addDays(e.date, 7) }); }, { toast: `Copied ${plural(prev.length, 'meal')} from last week` });
}

function handleDrop(payload, target) {
  const [kind, id] = payload.split(':');
  const [date, slot] = target.split('|');
  if (kind === 'entry') {
    const e = S.doc.plan[id];
    if (!e || (e.date === date && e.slot === slot)) return;
    mutate(api => api.put('plan', id, { date, slot, order: Date.now() }), { toast: `Moved to ${fmtDay(date)} ${slot}` });
  } else if (kind === 'recipe') {
    const r = recipe(id);
    if (!r) return;
    mutate(api => addEntry(api, { date, slot, recipeId: id, servings: +setting('defaultServings', 0) || r.servings }), { toast: `Added ${r.title} to ${fmtDay(date)}` });
  }
}

/* ================================================================== *
 * RECIPES
 * ================================================================== */
function searchRecipe(r, q) {
  if (!q) return { hit: true };
  if (r.title.toLowerCase().includes(q)) return { hit: 'title' };
  if ((r.tags || []).some(t => t.toLowerCase().includes(q))) return { hit: 'tag' };
  const ing = (r.ingredients || []).find(i => (i.item || '').toLowerCase().includes(q));
  if (ing) return { hit: 'ing', text: ing.item };
  if ((r.notes || '').toLowerCase().includes(q) || (r.steps || []).some(s => s.toLowerCase().includes(q))) return { hit: 'text' };
  return null;
}

function viewRecipes() {
  const all = recipes();
  const q = S.rq.trim().toLowerCase();
  const lh = lastHadMap();
  const tagCounts = {};
  for (const r of all) for (const t of r.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const extra = Object.keys(tagCounts).filter(t => !['Breakfast', 'Lunch', 'Dinner', 'Vegetarian'].includes(t)).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 8);
  const filters = ['All', 'Favorites', 'Breakfast', 'Lunch', 'Dinner', 'Quick', 'Vegetarian', ...extra.filter(t => t !== 'Quick')];
  let list = all.map(r => ({ r, m: searchRecipe(r, q) })).filter(x => x.m);
  const tf = S.rtag;
  if (tf === 'Favorites') list = list.filter(x => isFav(x.r));
  else if (tf === 'Quick') list = list.filter(x => ((x.r.prepMin || 0) + (x.r.cookMin || 0)) <= 30 || (x.r.tags || []).includes('Quick'));
  else if (tf !== 'All') list = list.filter(x => (x.r.tags || []).includes(tf));
  const sorters = {
    az: (a, b) => a.r.title.localeCompare(b.r.title),
    new: (a, b) => (b.r.createdAt || 0) - (a.r.createdAt || 0),
    rating: (a, b) => (b.r.rating || 0) - (a.r.rating || 0) || a.r.title.localeCompare(b.r.title),
    quick: (a, b) => ((a.r.prepMin || 0) + (a.r.cookMin || 0)) - ((b.r.prepMin || 0) + (b.r.cookMin || 0)),
    stale: (a, b) => (lh.get(a.r.id) || '0').localeCompare(lh.get(b.r.id) || '0'),
  };
  list.sort(sorters[S.rsort] || sorters.az);

  const top = `<div class="grow">${kitchenPill()}<h1>Recipes</h1></div>
    <button class="btn btn-line btn-sm" data-act="paste-recipe">${ic('import', 17)}<span>Paste</span></button>
    <button class="btn btn-primary btn-sm" data-act="new-recipe">${ic('plus', 17)}<span>New</span></button>`;

  const cards = list.map(({ r, m }) => {
    const c = recipeCost(r, S.doc.prices, r.servings);
    const total = (r.prepMin || 0) + (r.cookMin || 0);
    return `<div class="rcard">
      <button class="fav-btn ${r.fav ? 'on' : ''}" data-act="fav" data-id="${r.id}" aria-label="${r.fav ? 'Remove from favorites' : 'Add to favorites'}">${ic('heart', 18, r.fav ? 'fill="currentColor"' : '')}</button>
      <button data-act="open-recipe" data-id="${r.id}" style="text-align:left;display:flex;flex-direction:column;flex:1">
        ${cover(r)}
        <div class="rcard-body">
          <div class="rcard-title">${esc(r.title)}</div>
          ${m.hit === 'ing' ? `<div class="rcard-match">Uses ${esc(m.text)}</div>` : ''}
          <div class="rcard-meta">
            ${total ? `<span>${ic('clock', 13)}${fmtMin(total)}</span>` : ''}
            ${r.rating ? `<span style="color:var(--gold)">${ic('star', 13, 'fill="currentColor"')}${r.rating}</span>` : ''}
            ${c.priced ? `<span>${money(c.perServing)}/serv</span>` : ''}
          </div>
        </div>
      </button>
    </div>`;
  }).join('');

  const body = `
    <div class="search-row">
      <div class="input-icon grow">${ic('search', 18)}<input class="input" type="search" data-input="rq" placeholder="Search recipes & ingredients" value="${esc(S.rq)}" autocomplete="off" aria-label="Search recipes"></div>
      <select class="select" data-change="rsort" aria-label="Sort">
        ${[['az', 'A–Z'], ['new', 'Newest'], ['rating', 'Top rated'], ['quick', 'Quickest'], ['stale', 'Not had lately']].map(([v, l]) => `<option value="${v}" ${S.rsort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="chips">${filters.map(f => `<button class="chip ${S.rtag === f ? 'on' : ''}" data-act="rtag" data-tag="${esc(f)}">${f === 'Favorites' ? ic('heart', 14) : ''}${esc(f)}</button>`).join('')}</div>
    <div class="recipe-results">${list.length ? `<div class="recipe-grid">${cards}</div>` : all.length ? `
      <div class="empty"><div class="empty-art">🔍</div><h3>No matches</h3><p>Nothing matches ${q ? `“${esc(S.rq)}”` : 'that filter'}. Try another search, or add it as a new recipe.</p>
      <button class="btn btn-soft" data-act="clear-recipe-filter">Clear filters</button></div>` : `
      <div class="empty"><div class="empty-art">📖</div><h3>Your recipe box is empty</h3><p>Add a favorite, or paste one from anywhere and we'll tidy it up.</p>
      <div class="row" style="justify-content:center"><button class="btn btn-primary" data-act="new-recipe">${ic('plus', 18)} New recipe</button><button class="btn btn-line" data-act="paste-recipe">Paste text</button></div></div>`}</div>`;
  return [top, body];
}

function openRecipe(id, { servings } = {}) {
  const r0 = recipe(id);
  if (!r0) return;
  const st = { servings: servings || r0.servings || 2, checked: new Set() };
  const s = openSheet({
    full: true, live: true, title: r0.title,
    head: () => `<div class="grow"></div>
      <button class="icon-btn" data-act="rd-fav" aria-label="Favorite">${ic('heart', 21, (recipe(id) || {}).fav ? 'fill="currentColor" style="color:var(--accent)"' : '')}</button>
      <button class="icon-btn" data-act="rd-edit" aria-label="Edit">${ic('edit', 21)}</button>
      <button class="icon-btn" data-act="rd-menu" aria-label="More">${ic('more', 21)}</button>`,
    body: () => {
      const r = recipe(id);
      if (!r) return `<div class="empty"><div class="empty-art">🗑️</div><h3>Recipe deleted</h3></div>`;
      const ings = scaleIngredients(r.ingredients, r.servings, st.servings);
      const c = recipeCost(r, S.doc.prices, st.servings);
      const last = lastHadMap().get(r.id);
      const count = live(S.doc.history).filter(h => h.recipeId === r.id).length + live(S.doc.plan).filter(p => p.recipeId === r.id && p.date <= today()).length;
      return `
        ${cover(r, 'detail-cover')}
        <h1 class="detail-title">${esc(r.title)}</h1>
        <div class="row wrap" style="gap:6px">${(r.tags || []).map(t => `<span class="tag green">${esc(t)}</span>`).join('')}</div>
        <div class="row" style="margin-top:12px;justify-content:space-between">
          <div class="stars" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map(n => `<button class="${(r.rating || 0) >= n ? 'on' : ''}" data-act="rd-rate" data-n="${n}" aria-label="${n} stars">${ic('star', 22, 'fill="currentColor"')}</button>`).join('')}</div>
          <span class="small muted">${last ? `Last had ${relDays(last)}` : 'Not cooked yet'}${count > 1 ? ` · ${count}×` : ''}</span>
        </div>
        <div class="meta-row">
          <div><span>Prep</span><b>${fmtMin(r.prepMin) || '—'}</b></div>
          <div><span>Cook</span><b>${fmtMin(r.cookMin) || '—'}</b></div>
          <div><span>Serves</span><b>${r.servings || '—'}</b></div>
        </div>
        <div class="cost-card">
          ${ic('dollar', 22)}
          <div class="grow">${c.priced ? `<b>${money(c.perServing)}</b> <span class="small">per serving · ${money(c.total)} total${c.approx ? ' (approx.)' : ''}</span>` : '<b style="font-size:16px">Cost unknown</b>'}
            ${c.missing ? `<div class="tiny" style="opacity:.8">${plural(c.missing, 'ingredient')} without a price — tap a price chip on your grocery list to add one.</div>` : ''}</div>
        </div>
        <div class="row" style="margin:26px 0 8px;justify-content:space-between">
          <h2>Ingredients</h2>
          <div class="stepper" aria-label="Servings"><button data-act="rd-serv" data-d="-1" aria-label="Fewer servings">${ic('minus', 16)}</button><output>${st.servings}</output><button data-act="rd-serv" data-d="1" aria-label="More servings">${ic('plus', 16)}</button></div>
        </div>
        ${st.servings !== r.servings ? `<div class="tiny muted" style="margin-bottom:6px">Scaled from ${r.servings} to ${st.servings} servings · <a href="#" data-act="rd-reset">reset</a></div>` : ''}
        <ul class="ing-list">${ings.map((i, n) => `<li style="cursor:pointer;${st.checked.has(n) ? 'opacity:.45;text-decoration:line-through' : ''}" data-act="rd-check" data-n="${n}"><span class="ing-amt">${esc(formatAmount(i.qty, i.unit))}</span><span>${esc(i.item)}${i.note ? `<span class="ing-note">, ${esc(i.note)}</span>` : ''}</span></li>`).join('') || '<li class="muted">No ingredients yet.</li>'}</ul>
        <h2 style="margin:28px 0 14px">Steps</h2>
        <ol class="steps">${(r.steps || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li class="muted">No steps yet.</li>'}</ol>
        ${r.notes ? `<h2 style="margin:18px 0 10px">Notes</h2><p style="white-space:pre-wrap;margin:0" class="muted">${esc(r.notes)}</p>` : ''}`;
    },
    foot: () => `<button class="btn btn-line grow" data-act="rd-plan">${ic('plan', 18)} Add to plan</button><button class="btn btn-accent grow" data-act="rd-cook">${ic('play', 18)} Cook</button>`,
    actions: {
      'rd-serv': el => { st.servings = Math.max(1, Math.min(60, st.servings + +el.dataset.d)); s.refreshBody(); },
      'rd-reset': () => { st.servings = recipe(id).servings; s.refreshBody(); },
      'rd-check': el => { const n = +el.dataset.n; st.checked.has(n) ? st.checked.delete(n) : st.checked.add(n); s.refreshBody(); },
      'rd-rate': el => { const r = recipe(id); const n = +el.dataset.n; mutate(api => api.put('recipes', id, { rating: r.rating === n ? 0 : n })); },
      'rd-fav': () => { const r = recipe(id); mutate(api => api.put('recipes', id, { fav: !r.fav })); s.render(); },
      'rd-edit': () => openEditor(recipe(id)),
      'rd-cook': () => openCook(id, st.servings),
      'rd-plan': () => openPlanPicker(id),
      'rd-menu': () => {
        const m = openSheet({
          title: 'Recipe', narrow: true,
          body: () => `<div class="action-list">
            <button class="action" data-act="m-dup">${ic('copy', 20)} Duplicate</button>
            <button class="action" data-act="m-share">${ic('share', 20)} Share as text</button>
            <button class="action danger" data-act="m-del">${ic('trash', 20)} Delete recipe</button></div>`,
          actions: {
            'm-dup': () => { const r = recipe(id); const nid = uid('r_'); m.close(); mutate(api => { const copy = {}; for (const k of Object.keys(r)) if (!META.includes(k)) copy[k] = r[k]; api.put('recipes', nid, { ...copy, title: r.title + ' (copy)', seeded: false, createdAt: Date.now() }); }, { toast: 'Recipe duplicated' }); },
            'm-share': () => { m.close(); shareText(recipeText(recipe(id)), recipe(id).title); },
            'm-del': async () => {
              const r = recipe(id);
              m.close();
              s.close();
              mutate(api => api.del('recipes', id), { toast: `Deleted ${r.title}` });
            },
          },
        });
      },
    },
  });
}

function recipeText(r) {
  return `${r.title}\nServes ${r.servings || ''}${r.prepMin ? `\nPrep: ${fmtMin(r.prepMin)}` : ''}${r.cookMin ? `\nCook: ${fmtMin(r.cookMin)}` : ''}\n\nIngredients\n${(r.ingredients || []).map(i => `- ${[formatAmount(i.qty, i.unit), i.item].filter(Boolean).join(' ')}${i.note ? ', ' + i.note : ''}`).join('\n')}\n\nSteps\n${(r.steps || []).map((x, n) => `${n + 1}. ${x}`).join('\n')}${r.notes ? `\n\nNotes\n${r.notes}` : ''}`;
}

/* ---------- Recipe editor ---------- */
function openEditor(r, { parsed } = {}) {
  const isNew = !r || !r.id || !recipe(r.id);
  const d = {
    id: r && r.id || null, title: r && r.title || '', emoji: r && r.emoji || '🍽️', photo: r && r.photo || '',
    servings: r && r.servings || 4, prepMin: r && r.prepMin || '', cookMin: r && r.cookMin || '',
    tags: (r && r.tags || []).join(', '), rating: r && r.rating || 0, notes: r && r.notes || '', fav: !!(r && r.fav),
    ingredients: (r && r.ingredients || []).map(i => ({ qty: i.qty == null ? '' : formatQty(i.qty), unit: i.unit || '', item: i.item || '', note: i.note || '' })),
    steps: (r && r.steps || []).slice(),
  };
  if (!d.ingredients.length) d.ingredients.push({ qty: '', unit: '', item: '', note: '' });
  if (!d.steps.length) d.steps.push('');
  let dirty = !!parsed;
  const s = openSheet({
    full: true,
    title: isNew ? 'New recipe' : 'Edit recipe',
    body: () => `
      <label class="editor-photo" aria-label="Recipe photo">
        ${photo(d) ? `<img src="${photo(d)}" alt=""><div class="cover-actions"><button class="btn btn-line btn-sm" data-act="ed-photo-rm" type="button">${ic('trash', 16)} Remove</button></div>`
      : `<div>${ic('camera', 30)}<div style="font-weight:600;margin-top:6px">Add a photo</div><div class="tiny">We'll shrink it to keep things fast</div></div>`}
        <input type="file" accept="image/*" data-change="ed-photo" class="sr-only">
      </label>
      <div class="stack" style="margin-top:16px">
        <label class="field"><span>Title</span><input class="input" data-input="ed" data-f="title" value="${esc(d.title)}" placeholder="e.g. Sunday Night Lasagna" maxlength="120"></label>
        <div><div class="field"><span>Icon (shown when there's no photo)</span></div>
          <div class="chips">${EMOJIS.map(e => `<button type="button" class="chip ${d.emoji === e ? 'on' : ''}" data-act="ed-emoji" data-e="${e}" style="font-size:18px;padding:4px 10px">${e}</button>`).join('')}</div></div>
        <div class="grid-3">
          <label class="field"><span>Servings</span><input class="input" type="number" min="1" max="60" inputmode="numeric" data-input="ed" data-f="servings" value="${esc(d.servings)}"></label>
          <label class="field"><span>Prep (min)</span><input class="input" type="number" min="0" inputmode="numeric" data-input="ed" data-f="prepMin" value="${esc(d.prepMin)}"></label>
          <label class="field"><span>Cook (min)</span><input class="input" type="number" min="0" inputmode="numeric" data-input="ed" data-f="cookMin" value="${esc(d.cookMin)}"></label>
        </div>
        <label class="field"><span>Tags (comma separated)</span><input class="input" data-input="ed" data-f="tags" value="${esc(d.tags)}" placeholder="Dinner, Quick, Vegetarian"></label>
      </div>
      <div class="row" style="margin:26px 0 4px"><h2 class="grow">Ingredients</h2><button class="btn btn-ghost btn-sm" type="button" data-act="ed-bulk">${ic('import', 16)} Paste list</button></div>
      <datalist id="unit-list">${UNITS.map(u => `<option value="${u}">`).join('')}</datalist>
      <div>${d.ingredients.map((i, n) => `
        <div class="ing-row">
          <input class="input" data-input="ed-ing" data-n="${n}" data-k="qty" value="${esc(i.qty)}" placeholder="Qty" inputmode="decimal" aria-label="Quantity">
          <input class="input" data-input="ed-ing" data-n="${n}" data-k="unit" value="${esc(i.unit)}" placeholder="Unit" list="unit-list" aria-label="Unit" autocapitalize="off">
          <input class="input" data-input="ed-ing" data-n="${n}" data-k="item" value="${esc(i.item)}" placeholder="Ingredient" aria-label="Ingredient">
          <input class="input note" data-input="ed-ing" data-n="${n}" data-k="note" value="${esc(i.note)}" placeholder="Prep note (diced…)" aria-label="Prep note">
          <button class="icon-btn sm" type="button" data-act="ed-ing-rm" data-n="${n}" aria-label="Remove ingredient">${ic('x', 18)}</button>
        </div>`).join('')}</div>
      <button class="btn btn-soft btn-sm" type="button" data-act="ed-ing-add" style="margin-top:10px">${ic('plus', 16)} Add ingredient</button>
      <h2 style="margin:26px 0 10px">Steps</h2>
      <div>${d.steps.map((x, n) => `
        <div class="step-row"><span class="num">${n + 1}</span>
          <textarea class="textarea" data-input="ed-step" data-n="${n}" placeholder="Describe this step…" rows="2">${esc(x)}</textarea>
          <div style="display:flex;flex-direction:column">
            <button class="icon-btn sm" type="button" data-act="ed-step-rm" data-n="${n}" aria-label="Remove step">${ic('x', 18)}</button>
            ${n ? `<button class="icon-btn sm" type="button" data-act="ed-step-up" data-n="${n}" aria-label="Move up">${ic('up', 18)}</button>` : ''}
          </div></div>`).join('')}</div>
      <button class="btn btn-soft btn-sm" type="button" data-act="ed-step-add">${ic('plus', 16)} Add step</button>
      <label class="field" style="margin-top:26px"><span>Notes</span><textarea class="textarea" data-input="ed" data-f="notes" placeholder="Swaps, tips, who loved it…">${esc(d.notes)}</textarea></label>`,
    foot: () => `<button class="btn btn-line grow" data-act="ed-cancel">Cancel</button><button class="btn btn-primary grow" data-act="ed-save">${ic('check', 18)} Save recipe</button>`,
    actions: {
      ed: el => { d[el.dataset.f] = el.value; dirty = true; },
      'ed-ing': el => { d.ingredients[+el.dataset.n][el.dataset.k] = el.value; dirty = true; },
      'ed-step': el => { d.steps[+el.dataset.n] = el.value; dirty = true; },
      'ed-emoji': el => { d.emoji = el.dataset.e; dirty = true; s.refreshBody(); },
      'ed-ing-add': () => { d.ingredients.push({ qty: '', unit: '', item: '', note: '' }); s.refreshBody(); const rows = $$('.ing-row', s.el); rows[rows.length - 1].querySelector('input').focus(); },
      'ed-ing-rm': el => { d.ingredients.splice(+el.dataset.n, 1); dirty = true; s.refreshBody(); },
      'ed-step-add': () => { d.steps.push(''); s.refreshBody(); const t = $$('.step-row textarea', s.el); t[t.length - 1].focus(); },
      'ed-step-rm': el => { d.steps.splice(+el.dataset.n, 1); dirty = true; s.refreshBody(); },
      'ed-step-up': el => { const n = +el.dataset.n; [d.steps[n - 1], d.steps[n]] = [d.steps[n], d.steps[n - 1]]; dirty = true; s.refreshBody(); },
      'ed-photo': async el => {
        const f = el.files && el.files[0];
        if (!f) return;
        try {
          const url = await compressImage(f);
          if (!url) { toast("That photo is too large to shrink — try another"); return; }
          d.photo = url; dirty = true; s.refreshBody();
          toast(`Photo added (${Math.round(url.length / 1024)} KB)`);
        } catch { toast("Couldn't read that image"); }
      },
      'ed-photo-rm': (el, ev) => { ev.preventDefault(); d.photo = ''; dirty = true; s.refreshBody(); },
      'ed-bulk': () => {
        const b = openSheet({
          title: 'Paste ingredients', narrow: true,
          body: () => `<p class="small muted" style="margin-top:0">One per line, like “2 cups flour, sifted”. We'll split out the amounts.</p><textarea class="textarea" id="bulk-ing" rows="8" placeholder="1 lb chicken thighs\n2 tbsp olive oil\n3 cloves garlic, minced"></textarea>`,
          foot: () => `<button class="btn btn-primary btn-block" data-act="bulk-add">Add ingredients</button>`,
          actions: {
            'bulk-add': () => {
              const lines = $('#bulk-ing', b.el).value.split('\n').map(x => x.trim()).filter(Boolean);
              d.ingredients = d.ingredients.filter(i => i.item.trim() || i.qty);
              for (const l of lines) { const p = parseIngredient(l); if (p.item) d.ingredients.push({ qty: p.qty == null ? '' : formatQty(p.qty), unit: p.unit, item: p.item, note: p.note }); }
              if (!d.ingredients.length) d.ingredients.push({ qty: '', unit: '', item: '', note: '' });
              dirty = true; b.close(); s.refreshBody();
            },
          },
        });
      },
      'ed-cancel': async () => {
        if (dirty && !(await confirmSheet({ title: 'Discard changes?', message: "Your edits to this recipe won't be saved.", confirm: 'Discard', danger: true }))) return;
        s.close();
      },
      'ed-save': () => {
        const title = d.title.trim();
        if (!title) { toast('Give your recipe a name first'); $('[data-f="title"]', s.el).focus(); return; }
        const ingredients = d.ingredients.filter(i => i.item.trim()).map((i, n) => ({ id: 'i' + n, qty: String(i.qty).trim() ? parseQty(String(i.qty)) : null, unit: normUnit(i.unit), item: i.item.trim(), note: i.note.trim() }));
        const data = {
          title, emoji: d.emoji, photo: d.photo, servings: Math.max(1, parseInt(d.servings, 10) || 1),
          prepMin: parseInt(d.prepMin, 10) || 0, cookMin: parseInt(d.cookMin, 10) || 0,
          tags: [...new Set(String(d.tags).split(',').map(t => t.trim()).filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1)))],
          notes: d.notes.trim(), ingredients, steps: d.steps.map(x => x.trim()).filter(Boolean),
        };
        const id = d.id && recipe(d.id) ? d.id : uid('r_');
        if (!recipe(id)) Object.assign(data, { createdAt: Date.now(), rating: d.rating || 0, fav: d.fav });
        mutate(api => api.put('recipes', id, data), { toast: isNew ? `Saved ${title}` : 'Recipe updated' });
        s.close();
        if (isNew) setTimeout(() => openRecipe(id), 60);
      },
    },
  });
}

function openPasteImport() {
  const s = openSheet({
    title: 'Paste a recipe',
    body: () => `
      <p class="muted" style="margin-top:0">Paste any recipe — from a website, a note or a text. We'll pick out the title, servings, times, ingredients and steps for you to review.</p>
      <textarea class="textarea" id="paste-text" rows="12" placeholder="Grandma's Chili\nServes 6\n\nIngredients\n1 lb ground beef\n1 onion, diced\n…\n\nInstructions\n1. Brown the beef…"></textarea>`,
    foot: () => `<button class="btn btn-primary btn-block" data-act="pi-parse">${ic('sparkle', 18)} Tidy it up</button>`,
    actions: {
      'pi-parse': () => {
        const text = $('#paste-text', s.el).value;
        if (!text.trim()) { toast('Paste a recipe first'); return; }
        const p = parseRecipeText(text);
        s.close();
        setTimeout(() => {
          openEditor({ title: p.title, servings: p.servings || 4, prepMin: p.prepMin, cookMin: p.cookMin, ingredients: p.ingredients, steps: p.steps, notes: p.notes, tags: [] }, { parsed: true });
          toast(`Found ${plural(p.ingredients.length, 'ingredient')} and ${plural(p.steps.length, 'step')} — review, then save`);
        }, 80);
      },
    },
  });
}

/* ================================================================== *
 * GROCERIES
 * ================================================================== */
function groceryVisible() {
  const items = live(S.doc.grocery);
  const planKeys = new Set(items.filter(g => g.source !== 'pantry').map(g => g.key));
  return items.filter(g => !(g.source === 'pantry' && planKeys.has(g.key)));
}
const pantryByKey = () => { const m = new Map(); for (const p of live(S.doc.pantry)) m.set(p.key || itemKey(p.name), p); return m; };

function priceFor(g) { return findPrice(S.doc.prices, g.name); }
function itemCost(g) { const p = priceFor(g); return p ? lineCost({ qty: g.qty == null ? 1 : g.qty, unit: g.unit }, p) : null; }

function buildGrocery() {
  const ws = S.week;
  const entries = weekEntries(ws).filter(e => e.recipeId && recipe(e.recipeId));
  if (!entries.length) { toast(`Add some recipes to ${weekLabel().toLowerCase()} first`); return; }
  const lines = [];
  for (const e of entries) {
    const r = recipe(e.recipeId);
    for (const i of scaleIngredients(r.ingredients, r.servings, e.servings || r.servings)) if (i.item) lines.push({ name: i.item, qty: i.qty, unit: i.unit, source: r.title });
  }
  const combined = combineLines(lines);
  const pantry = pantryByKey();
  let added = 0;
  mutate(api => {
    const keep = new Set();
    for (const c of combined) {
      const id = 'gp|' + c.key + '|' + c.bucket;
      keep.add(id);
      const prev = S.doc.grocery[id];
      const p = pantry.get(c.key);
      const patch = { name: c.name.charAt(0).toUpperCase() + c.name.slice(1), key: c.key, qty: c.qty, unit: c.unit, sources: c.sources, source: 'plan', week: ws, section: sectionFor(c.key, c.name) };
      if (!prev || prev.deleted) { Object.assign(patch, { checked: false, have: !!(p && !p.low), deleted: false }); added++; }
      else if (['name', 'qty', 'unit', 'week', 'section'].every(k => prev[k] === patch[k]) && JSON.stringify(prev.sources) === JSON.stringify(patch.sources)) continue;
      api.put('grocery', id, patch);
    }
    for (const g of live(S.doc.grocery)) if (g.source === 'plan' && !keep.has(g.id)) api.del('grocery', g.id);
  }, { toast: `List built from ${plural(entries.length, 'meal')} · ${plural(combined.length, 'item')}` });
  S.tab = 'groceries';
  render();
  window.scrollTo(0, 0);
}

function groceryRow(g, running) {
  const c = itemCost(g);
  const amt = g.qty != null ? formatAmount(g.qty, g.unit) : (g.unit || '');
  const sub = [g.sources && g.sources.length ? g.sources.join(' · ') : '', g.source === 'pantry' ? 'Running low in pantry' : '', running ? 'Running low' : '', g.note || '', g.checked && g.checkedBy && g.checkedBy !== S.user.id ? `✓ ${memberName(g.checkedBy)}` : ''].filter(Boolean).join(' · ');
  return `<div class="gitem ${g.checked ? 'checked' : ''}" data-gid="${esc(g.id)}">
    <button class="gcheck" data-act="gcheck" data-id="${esc(g.id)}" aria-label="${g.checked ? 'Uncheck' : 'Check off'} ${esc(g.name)}" aria-pressed="${!!g.checked}">${ic('check', 16)}</button>
    <button class="gmain" data-act="gcheck" data-id="${esc(g.id)}" tabindex="-1">
      <span class="gname">${amt ? `<span class="gqty">${esc(amt)}</span>` : ''}${esc(g.name)}</span>
      ${sub ? `<span class="gsub">${esc(sub)}</span>` : ''}
    </button>
    <button class="price-chip ${c ? '' : 'empty'}" data-act="gprice" data-id="${esc(g.id)}" aria-label="Price for ${esc(g.name)}">${c ? (c.approx ? '~' : '') + money(c.cost) : '+ $'}</button>
    <button class="icon-btn sm" data-act="gitem" data-id="${esc(g.id)}" aria-label="More for ${esc(g.name)}">${ic('more', 18)}</button>
  </div>`;
}

function viewGroceries() {
  const items = groceryVisible();
  const pantry = pantryByKey();
  const need = items.filter(g => !g.checked && !g.have);
  const cart = items.filter(g => g.checked && !g.have);
  const have = items.filter(g => g.have);
  const budget = +setting('budget', 0) || 0;
  const est = groceryTotal(items.filter(g => !g.have), S.doc.prices);
  const bp = budgetProgress(est.total, budget);
  const inCart = groceryTotal(cart, S.doc.prices).total;
  const top = `<div class="grow">${kitchenPill()}<h1>Groceries</h1></div>
    <button class="icon-btn filled" data-act="share-list" aria-label="Share list">${ic('share', 20)}</button>
    <button class="icon-btn filled" data-act="grocery-menu" aria-label="List options">${ic('more', 20)}</button>`;

  if (!items.length) {
    return [top, `
      <div class="empty" style="padding-top:56px"><div class="empty-art">🧺</div><h3>Your list is empty</h3>
        <p>Build it from ${weekLabel().toLowerCase()}'s meal plan in one tap — duplicates get combined and pantry staples are set aside.</p>
        <button class="btn btn-primary" data-act="build-list">${ic('cart', 18)} Build from ${weekLabel().toLowerCase()}</button>
        <form data-submit="gadd" class="add-bar" style="margin-top:26px"><input class="input" name="item" placeholder="Or add an item — e.g. 2 lb apples" autocomplete="off" aria-label="Add item"><button class="btn btn-soft" type="submit" aria-label="Add">${ic('plus', 18)}</button></form>
      </div>`];
  }

  const order = sectionOrder();
  const bySec = new Map();
  for (const g of need) { const sec = g.section || sectionFor(g.key || itemKey(g.name), g.name); if (!bySec.has(sec)) bySec.set(sec, []); bySec.get(sec).push(g); }
  const secs = [...bySec.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  const nameSort = (a, b) => a.name.localeCompare(b.name);

  const body = `
    <div class="card budget-card" >
      <div class="budget-top"><b>${est.total || !est.missing ? money(est.total) : '—'}</b><span class="muted small">${est.total || !est.missing ? 'estimated' : 'no prices yet'}${budget ? ` · ${money(budget)} budget` : ''}</span><span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" data-act="open-prices">${budget ? 'Edit' : 'Set budget'}</button></div>
      ${budget ? `<div class="bar ${bp.over ? 'over' : ''}"><i style="width:${bp.pct}%"></i></div>` : ''}
      <div class="tiny muted" style="margin-top:8px">${[`${cart.length} of ${need.length + cart.length} in cart${inCart ? ` (${money(inCart)})` : ''}`, est.missing ? `${plural(est.missing, 'item')} unpriced — tap “+ $” to add a price` : '', budget && bp.over ? `<span style="color:var(--danger)">${money(-bp.remaining)} over budget</span>` : budget ? `${money(bp.remaining)} left` : ''].filter(Boolean).join(' · ')}</div>
    </div>
    <form data-submit="gadd" class="add-bar"><input class="input" name="item" placeholder="Add an item — e.g. 2 lb apples" autocomplete="off" aria-label="Add item"><button class="btn btn-primary" type="submit" aria-label="Add">${ic('plus', 18)}</button></form>
    ${need.length ? '' : `<div class="empty" style="padding:10px 0 24px"><div class="empty-art" style="background:var(--primary-soft)">🎉</div><h3>All done!</h3><p>Everything's in the cart.</p><button class="btn btn-soft" data-act="clear-checked">Clear checked items</button></div>`}
    ${secs.map(sec => `
      <section class="gsec">
        <div class="gsec-head"><h3>${esc(sec)}</h3><span class="count">${bySec.get(sec).length}</span></div>
        <div class="list">${bySec.get(sec).sort(nameSort).map(g => groceryRow(g, g.source !== 'pantry' && pantry.get(g.key) && pantry.get(g.key).low)).join('')}</div>
      </section>`).join('')}
    ${cart.length ? `
      <button class="collapse-head ${S.openCart ? 'open' : ''}" data-act="toggle-cart">${ic('right', 18, 'class="rot"')} In the cart <span class="tag green">${cart.length}</span><span class="spacer"></span><span class="btn btn-ghost btn-sm" data-act="clear-checked">Clear</span></button>
      ${S.openCart ? `<div class="list">${cart.sort(nameSort).map(g => groceryRow(g)).join('')}</div>` : ''}` : ''}
    ${have.length ? `
      <button class="collapse-head ${S.openHave ? 'open' : ''}" data-act="toggle-have">${ic('right', 18, 'class="rot"')} Already have <span class="tag">${have.length}</span></button>
      ${S.openHave ? `<div class="list">${have.sort(nameSort).map(g => `<div class="gitem"><div class="gmain"><span class="gname">${g.qty != null ? `<span class="gqty">${esc(formatAmount(g.qty, g.unit))}</span>` : ''}${esc(g.name)}</span><span class="gsub">In your pantry</span></div><button class="btn btn-soft btn-sm" data-act="need-it" data-id="${esc(g.id)}">Need it</button></div>`).join('')}</div>` : ''}` : ''}
    <p class="tiny muted" style="text-align:center;margin:26px 0 0">Sorted in your store order · <a href="#" data-act="open-sections">change order</a></p>`;
  return [top, body];
}

function toggleCheck(id) {
  const g = S.doc.grocery[id];
  if (!g) return;
  const now = !g.checked;
  mutate(api => {
    api.put('grocery', id, { checked: now, checkedBy: now ? S.user.id : null });
    if (now) { const p = pantryByKey().get(g.key); if (p && p.low) api.put('pantry', p.id, { low: false }); }
  });
  if (now) { const row = document.querySelector(`[data-gid="${CSS.escape(id)}"]`); if (row) row.classList.add('just-checked'); if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* ignore */ } }
}

function addGroceryText(text) {
  const p = parseIngredient(text);
  if (!p.item) return;
  const key = itemKey(p.item);
  const name = p.item.charAt(0).toUpperCase() + p.item.slice(1);
  const existing = live(S.doc.grocery).find(g => g.key === key && !g.checked && !g.have && (unitDim(g.unit) ? unitDim(g.unit) === unitDim(p.unit) : normUnit(g.unit) === normUnit(p.unit)));
  if (existing && existing.qty != null && p.qty != null) {
    const [c] = combineLines([{ name: existing.name, qty: existing.qty, unit: existing.unit }, { name, qty: p.qty, unit: p.unit }]);
    mutate(api => api.put('grocery', existing.id, { qty: c.qty, unit: c.unit }), { toast: `Updated ${existing.name} to ${formatAmount(c.qty, c.unit)}` });
    return;
  }
  if (existing && p.qty == null) { toast(`${existing.name} is already on the list`); return; }
  mutate(api => api.put('grocery', uid('gm_'), { name, key, qty: p.qty, unit: p.unit, note: p.note, section: sectionFor(key, name), source: 'manual', checked: false, have: false }), { toast: `Added ${name}` });
}

function openGroceryItem(id) {
  const g0 = S.doc.grocery[id];
  if (!g0) return;
  const d = { name: g0.name, qty: g0.qty == null ? '' : formatQty(g0.qty), unit: g0.unit || '', note: g0.note || '', section: g0.section || sectionFor(g0.key, g0.name) };
  const s = openSheet({
    title: g0.name, narrow: true,
    body: () => `
      <div class="stack">
        <label class="field"><span>Item</span><input class="input" data-input="gi" data-f="name" value="${esc(d.name)}"></label>
        <div class="grid-2">
          <label class="field"><span>Amount</span><input class="input" data-input="gi" data-f="qty" value="${esc(d.qty)}" inputmode="decimal"></label>
          <label class="field"><span>Unit</span><input class="input" data-input="gi" data-f="unit" value="${esc(d.unit)}" list="unit-list2" autocapitalize="off"></label>
        </div>
        <datalist id="unit-list2">${UNITS.map(u => `<option value="${u}">`).join('')}</datalist>
        <label class="field"><span>Store section</span><select class="select" data-input="gi" data-f="section">${sectionOrder().map(x => `<option ${x === d.section ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label class="field"><span>Note</span><input class="input" data-input="gi" data-f="note" value="${esc(d.note)}" placeholder="Brand, size…"></label>
      </div>
      <div class="action-list" style="margin-top:14px">
        <button class="action" data-act="gi-have">${ic('jar', 20)} Already have it</button>
        <button class="action" data-act="gi-price">${ic('dollar', 20)} Set price</button>
        <button class="action danger" data-act="gi-del">${ic('trash', 20)} Remove from list</button>
      </div>`,
    foot: () => `<button class="btn btn-primary btn-block" data-act="gi-save">Save</button>`,
    actions: {
      gi: el => { d[el.dataset.f] = el.value; },
      'gi-save': () => {
        const name = d.name.trim() || g0.name;
        const key = itemKey(name);
        mutate(api => {
          api.put('grocery', id, { name, key, qty: String(d.qty).trim() ? parseQty(String(d.qty)) : null, unit: normUnit(d.unit), note: d.note.trim(), section: d.section });
          if (d.section !== sectionFor(key, name)) api.put('aisles', key, { section: d.section }); // remember for next time
        });
        s.close();
      },
      'gi-have': () => { s.close(); mutate(api => api.put('grocery', id, { have: true }), { toast: `Moved ${g0.name} to “already have”` }); },
      'gi-price': () => { s.close(); setTimeout(() => openPriceSheet(g0.name, g0), 60); },
      'gi-del': () => { s.close(); mutate(api => api.del('grocery', id), { toast: `Removed ${g0.name}` }); },
    },
  });
}

function openPriceSheet(name, line = null) {
  const key = itemKey(name);
  const p = S.doc.prices[key] && !S.doc.prices[key].deleted ? S.doc.prices[key] : null;
  const dim = line ? unitDim(line.unit) : null;
  const d = { price: p ? p.price.toFixed(2) : '', qty: p ? p.qty : 1, unit: p ? normUnit(p.unit) : dim === 'weight' ? 'lb' : (line && ['can', 'jar', 'bunch', 'head', 'bag', 'box', 'bottle', 'package'].includes(normUnit(line.unit)) ? normUnit(line.unit) : '') };
  const s = openSheet({
    title: `Price · ${name}`, narrow: true,
    body: () => `
      <p class="small muted" style="margin-top:0">We'll remember this and use it to estimate meal costs and your grocery total.</p>
      <div class="grid-3" style="grid-template-columns:1.3fr .7fr 1fr">
        <label class="field"><span>Price</span><div class="money-input"><input class="input" id="pr-price" inputmode="decimal" value="${esc(d.price)}" placeholder="0.00"></div></label>
        <label class="field"><span>For</span><input class="input" id="pr-qty" inputmode="decimal" value="${esc(d.qty)}"></label>
        <label class="field"><span>Unit</span><select class="select" id="pr-unit">${PRICE_UNITS.map(([v, l]) => `<option value="${v}" ${v === d.unit ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${p ? `<p class="tiny muted">Last set by ${esc(memberName(p.updatedBy))} ${relDays(isoDate(new Date(p.updatedAt)))}.</p>` : ''}`,
    foot: () => `${p ? `<button class="btn btn-danger" data-act="pr-del">Forget</button>` : ''}<button class="btn btn-primary grow" data-act="pr-save">Save price</button>`,
    onMount: sh => setTimeout(() => { const i = $('#pr-price', sh.el); if (i) i.focus(); }, 350),
    actions: {
      'pr-save': () => {
        const price = parseFloat(String($('#pr-price', s.el).value).replace(/[$,]/g, ''));
        const qty = parseQty($('#pr-qty', s.el).value) || 1;
        if (!(price >= 0)) { toast('Enter a price like 3.99'); return; }
        mutate(api => api.put('prices', key, { item: name, price: Math.round(price * 100) / 100, qty, unit: $('#pr-unit', s.el).value }), { toast: `Saved ${money(price)} for ${name}` });
        s.close();
      },
      'pr-del': () => { s.close(); mutate(api => api.del('prices', key), { toast: `Forgot price for ${name}` }); },
    },
  });
}

function groceryText() {
  const items = groceryVisible().filter(g => !g.checked && !g.have);
  const order = sectionOrder();
  const by = new Map();
  for (const g of items) { const sec = g.section || 'Other'; if (!by.has(sec)) by.set(sec, []); by.get(sec).push(g); }
  const secs = [...by.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  const k = kitchen();
  return `🛒 Grocery list${k ? ' — ' + k.name : ''}\n` + secs.map(sec => `\n${sec.toUpperCase()}\n` + by.get(sec).sort((a, b) => a.name.localeCompare(b.name)).map(g => `☐ ${g.qty != null ? formatAmount(g.qty, g.unit) + ' ' : ''}${g.name}${g.note ? ` (${g.note})` : ''}`).join('\n')).join('\n');
}

async function shareText(text, title = 'Meal Planner') {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); } catch {
    openSheet({ title: 'Copy text', body: () => `<textarea class="textarea" rows="14" readonly>${esc(text)}</textarea>` });
  }
}

/* ================================================================== *
 * PANTRY
 * ================================================================== */
function viewPantry() {
  const items = live(S.doc.pantry);
  const low = items.filter(p => p.low);
  const shown = S.pantryFilter === 'low' ? low : items;
  const order = sectionOrder();
  const by = new Map();
  for (const p of shown) { const sec = p.section || guessSection(p.name); if (!by.has(sec)) by.set(sec, []); by.get(sec).push(p); }
  const secs = [...by.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  const top = `<div class="grow">${kitchenPill()}<h1>Pantry</h1></div>`;
  const body = `
    <p class="muted" style="margin:0 0 14px">Staples you keep on hand. Flip <b>running low</b> and it lands on the grocery list; planned recipes skip what you already have.</p>
    ${low.length ? `<div class="banner">${ic('cart', 20)}<div class="grow">${plural(low.length, 'staple')} running low — on your grocery list.</div><button class="btn btn-sm btn-line" data-act="tab" data-tab="groceries">View list</button></div>` : ''}
    <form data-submit="padd" class="add-bar"><input class="input" name="item" placeholder="Add a staple — e.g. Basmati rice" autocomplete="off" aria-label="Add pantry item"><button class="btn btn-primary" type="submit" aria-label="Add">${ic('plus', 18)}</button></form>
    <div class="seg" style="margin-bottom:16px;max-width:320px"><button class="${S.pantryFilter === 'all' ? 'on' : ''}" data-act="pfilter" data-f="all">All · ${items.length}</button><button class="${S.pantryFilter === 'low' ? 'on' : ''}" data-act="pfilter" data-f="low">Running low · ${low.length}</button></div>
    ${!shown.length ? (S.pantryFilter === 'low' ? `<div class="empty"><div class="empty-art" style="background:var(--primary-soft)">✨</div><h3>Fully stocked</h3><p>Nothing is running low right now.</p></div>`
      : `<div class="empty"><div class="empty-art">🫙</div><h3>No staples yet</h3><p>Add the things you always keep around — oils, spices, rice — so the grocery list knows to skip them.</p></div>`)
      : secs.map(sec => `
      <section class="gsec">
        <div class="gsec-head"><h3>${esc(sec)}</h3><span class="count">${by.get(sec).length}</span></div>
        <div class="list">${by.get(sec).sort((a, b) => a.name.localeCompare(b.name)).map(p => `
          <div class="pitem ${p.low ? 'low' : ''}">
            <button class="grow" style="text-align:left;min-height:40px" data-act="pedit" data-id="${esc(p.id)}"><div class="li-title">${esc(p.name)}</div></button>
            <span class="low-label">${p.low ? 'Running low' : 'Stocked'}</span>
            <button class="switch ${p.low ? 'on' : ''}" role="switch" aria-checked="${!!p.low}" aria-label="${esc(p.name)} running low" data-act="plow" data-id="${esc(p.id)}"></button>
          </div>`).join('')}</div>
      </section>`).join('')}`;
  return [top, body];
}

function setPantryLow(api, p, low) {
  api.put('pantry', p.id, { low });
  const key = p.key || itemKey(p.name);
  const gid = 'gl|' + key;
  const g = S.doc.grocery[gid];
  if (low) api.put('grocery', gid, { name: p.name, key, qty: null, unit: '', section: p.section || sectionFor(key, p.name), source: 'pantry', checked: false, have: false, deleted: false });
  else if (g && !g.deleted && !g.checked) api.del('grocery', gid);
  // Planned items for this staple should no longer be hidden under "already have".
  for (const x of live(S.doc.grocery)) if (x.key === key && x.source === 'plan') api.put('grocery', x.id, { have: !low });
}

function openPantryItem(id) {
  const p = S.doc.pantry[id];
  if (!p) return;
  const s = openSheet({
    title: p.name, narrow: true,
    body: () => `<div class="stack">
      <label class="field"><span>Name</span><input class="input" id="pe-name" value="${esc(p.name)}"></label>
      <label class="field"><span>Store section</span><select class="select" id="pe-sec">${sectionOrder().map(x => `<option ${x === (p.section || guessSection(p.name)) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label></div>`,
    foot: () => `<button class="btn btn-danger" data-act="pe-del">${ic('trash', 18)}</button><button class="btn btn-primary grow" data-act="pe-save">Save</button>`,
    actions: {
      'pe-save': () => { const name = $('#pe-name', s.el).value.trim() || p.name; mutate(api => api.put('pantry', id, { name, key: itemKey(name), section: $('#pe-sec', s.el).value })); s.close(); },
      'pe-del': () => { s.close(); mutate(api => { if (p.low) setPantryLow(api, p, false); api.del('pantry', id); }, { toast: `Removed ${p.name} from pantry` }); },
    },
  });
}

/* ================================================================== *
 * MORE
 * ================================================================== */
function viewMore() {
  const k = kitchen();
  const theme = (() => { try { return localStorage.getItem('mp:theme') || 'system'; } catch { return 'system'; } })();
  const top = `<div class="grow">${kitchenPill()}<h1>More</h1></div>`;
  const li = (act, icon, color, title, sub) => `<button class="list-item" data-act="${act}"><span class="li-icon ${color}">${ic(icon, 20)}</span><div class="grow"><div class="li-title">${title}</div>${sub ? `<div class="li-sub">${sub}</div>` : ''}</div>${ic('right', 18, 'class="chev"')}</button>`;
  const budget = +setting('budget', 0) || 0;
  const body = `
    <div class="more-grid">
      <div class="stack">
        <div class="hero-card"><h2>What should we eat?</h2><p>Can't decide? Let us pick from your favorites.</p><button class="btn btn-sm" data-act="pick">${ic('shuffle', 17)} Surprise us</button></div>
        <div class="list">
          ${li('open-kitchen', 'users', '', esc(k ? k.name : 'Kitchen'), `${plural(S.members.length || 1, 'member')} · invite, rename, switch`)}
          ${li('open-search', 'search', 'plum', 'Search everything', 'Recipes, ingredients, lists and plans')}
          ${li('open-history', 'history', 'gold', 'Meal history', "What you've cooked and what you haven't had in a while")}
          ${li('open-prices', 'dollar', 'terra', 'Prices & budget', `${plural(live(S.doc.prices).length, 'saved price')}${budget ? ` · ${money(budget)}/week` : ''}`)}
          ${li('open-sections', 'store', '', 'Store section order', 'Match your Harris Teeter aisles')}
        </div>
      </div>
      <div class="stack">
        <div class="card card-pad">
          <h3 style="margin-bottom:12px">Preferences</h3>
          <div class="stack">
            <label class="field"><span>Your name (shown on “who's cooking”)</span><input class="input" data-change="pref-name" value="${esc(setting('name:' + S.user.id, '') || memberName(S.user.id))}" maxlength="30"></label>
            <div class="grid-2">
              <label class="field"><span>Week starts on</span><select class="select" data-change="pref-week">${DAY_NAMES.map((n, i) => `<option value="${i}" ${+setting('weekStart', 0) === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
              <label class="field"><span>Default servings</span><select class="select" data-change="pref-serv"><option value="0">As written</option>${[1, 2, 3, 4, 5, 6, 8].map(n => `<option value="${n}" ${+setting('defaultServings', 0) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            </div>
            <div class="field"><span>Appearance</span><div class="seg">${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button class="${theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
          </div>
        </div>
        <div class="list">
          <div class="list-item"><span class="li-icon">${ic('cloud', 20)}</span><div class="grow"><div class="li-title">Sync</div><div class="li-sub" data-sync-text></div></div><button class="btn btn-ghost btn-sm" data-act="sync-now">Sync now</button></div>
          <div class="list-item"><span class="li-icon gold">${ic('mail', 20)}</span><div class="grow"><div class="li-title">Signed in</div><div class="li-sub ellipsis">${esc(S.user.email || '')}</div></div><button class="btn btn-ghost btn-sm" data-act="sign-out">Sign out</button></div>
        </div>
        <p class="tiny muted" style="text-align:center">Meal Planner · works offline · your data lives in your kitchen only</p>
      </div>
    </div>`;
  return [top, body];
}

function openKitchenSheet() {
  const st = { loading: true, members: S.members, invites: [], err: '' };
  const load = async () => {
    if (!S.sb || S.offlineUser || navigator.onLine === false) { st.loading = false; st.err = "You're offline — members and invites will load when you reconnect."; s.refreshBody(); return; }
    try {
      const [m, i] = await Promise.all([
        S.sb.from('meal_members').select('household_id, user_id, email, role, joined_at').eq('household_id', S.hid).order('joined_at'),
        S.sb.from('meal_invites').select('household_id, email, invited_by, created_at').eq('household_id', S.hid).order('created_at'),
      ]);
      if (m.data) { st.members = m.data; S.members = m.data; kvSet('members:' + S.hid, m.data); }
      st.invites = i.data || [];
      st.err = m.error || i.error ? "Couldn't load everything — pull to refresh later." : '';
    } catch { st.err = "Couldn't load members right now."; }
    st.loading = false;
    if (!s.closed) s.refreshBody();
  };
  const me = () => st.members.find(m => m.user_id === S.user.id);
  const s = openSheet({
    title: 'Kitchen',
    body: () => {
      const k = kitchen();
      return `
      <form data-submit="k-rename" class="row" style="margin-bottom:18px"><label class="field grow"><span>Kitchen name</span><input class="input" name="name" value="${esc(k ? k.name : '')}" maxlength="60"></label><button class="btn btn-soft" type="submit" style="align-self:flex-end">Rename</button></form>
      <h3 style="margin-bottom:8px">Members</h3>
      <div class="list">${st.members.map(m => `<div class="list-item">${avatar(m.user_id, 'lg')}<div class="grow"><div class="li-title">${esc(memberName(m.user_id))}${m.user_id === S.user.id ? ' <span class="tag">You</span>' : ''}</div><div class="li-sub ellipsis">${esc(m.email || '')}</div></div><span class="tag ${m.role === 'owner' ? 'terra' : ''}">${esc(m.role || 'member')}</span></div>`).join('')}</div>
      <h3 style="margin:22px 0 8px">Invite someone</h3>
      <form data-submit="k-invite" class="row"><input class="input grow" type="email" name="email" placeholder="partner@example.com" required autocomplete="off" aria-label="Email to invite"><button class="btn btn-primary" type="submit">Invite</button></form>
      <p class="tiny muted" style="margin:8px 2px 0">Heads up: sign-ups are closed, so the person you invite needs an account created for them first. Once they sign in with that email, they'll join this kitchen automatically.</p>
      ${st.loading ? '<p class="small muted">Loading invites…</p>' : st.invites.length ? `
        <h3 style="margin:22px 0 8px">Pending invites</h3>
        <div class="list">${st.invites.map(i => `<div class="list-item"><span class="li-icon gold">${ic('mail', 18)}</span><div class="grow"><div class="li-title ellipsis">${esc(i.email)}</div><div class="li-sub">Invited ${relDays(isoDate(new Date(i.created_at)))}</div></div><button class="btn btn-ghost btn-sm" data-act="k-cancel" data-email="${esc(i.email)}">Cancel</button></div>`).join('')}</div>` : ''}
      ${st.err ? `<div class="auth-msg err">${esc(st.err)}</div>` : ''}
      ${S.households.length > 1 ? `<h3 style="margin:22px 0 8px">Your kitchens</h3><div class="list">${S.households.map(h => `<button class="list-item" data-act="k-switch" data-id="${h.id}"><span class="li-icon">${ic('home', 18)}</span><div class="grow li-title">${esc(h.name)}</div>${h.id === S.hid ? `<span class="tag green">Open</span>` : ic('right', 18, 'class="chev"')}</button>`).join('')}</div>` : ''}
      <div class="action-list" style="margin-top:18px">
        <button class="action" data-act="k-new">${ic('plus', 20)} Create another kitchen</button>
        <button class="action danger" data-act="k-leave">${ic('logout', 20)} Leave this kitchen</button>
      </div>`;
    },
    actions: {
      'k-rename': async form => {
        const name = form.name.value.trim();
        if (!name) return;
        if (!S.sb || navigator.onLine === false) { toast("You're offline — try renaming when you reconnect"); return; }
        const { data, error } = await S.sb.from('meal_households').update({ name }).eq('id', S.hid).select('id, name');
        if (error || !data || !data.length) { toast(me() && me().role !== 'owner' ? 'Only the kitchen owner can rename it' : "Couldn't rename the kitchen"); return; }
        const k = kitchen(); if (k) k.name = name;
        kvSet('households:' + S.user.id, S.households);
        toast('Kitchen renamed'); render(); s.refreshBody();
      },
      'k-invite': async form => {
        const email = form.email.value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid email'); return; }
        if (st.members.some(m => (m.email || '').toLowerCase() === email)) { toast("They're already in this kitchen"); return; }
        if (!S.sb || navigator.onLine === false) { toast("You're offline — invite when you reconnect"); return; }
        const { error } = await S.sb.from('meal_invites').insert({ household_id: S.hid, email, invited_by: S.user.id });
        if (error) { toast(/duplicate|unique/i.test(error.message || '') ? 'Already invited' : "Couldn't send that invite"); return; }
        toast(`Invited ${email}`);
        load();
      },
      'k-cancel': async el => {
        const { error } = await S.sb.from('meal_invites').delete().eq('household_id', S.hid).eq('email', el.dataset.email);
        if (error) { toast("Couldn't cancel that invite"); return; }
        toast('Invite cancelled');
        load();
      },
      'k-switch': el => { if (el.dataset.id === S.hid) return; s.close(); openKitchen(el.dataset.id); toast(`Switched to ${S.households.find(h => h.id === el.dataset.id).name}`); },
      'k-new': () => {
        const n = openSheet({
          title: 'New kitchen', narrow: true,
          body: () => `<form data-submit="kn-create" class="stack"><label class="field"><span>Name</span><input class="input" name="name" value="Our Kitchen" maxlength="60"></label><button class="btn btn-primary btn-block" type="submit">Create kitchen</button></form>`,
          actions: { 'kn-create': async form => { const ok = await createKitchen(form.name.value.trim()); if (ok) { n.close(); s.close(); toast('Kitchen created'); } } },
        });
      },
      'k-leave': async () => {
        const k = kitchen();
        if (!(await confirmSheet({ title: `Leave ${k ? k.name : 'kitchen'}?`, message: "You'll lose access to its recipes, plans and lists unless someone invites you again.", confirm: 'Leave kitchen', danger: true }))) return;
        if (!S.sb || navigator.onLine === false) { toast("You're offline — try again when you reconnect"); return; }
        const { error } = await S.sb.from('meal_members').delete().eq('household_id', S.hid).eq('user_id', S.user.id);
        if (error) { toast("Couldn't leave the kitchen"); return; }
        s.close();
        if (S.sync) S.sync.stop();
        S.sync = null;
        await loadHouseholds();
        toast(`You left ${k ? k.name : 'the kitchen'}`);
        if (!S.households.length) renderOnboarding(); else openKitchen(S.households[0].id);
      },
    },
  });
  load();
}

function openPrices() {
  const st = { q: '' };
  const list = () => {
    const q = st.q.toLowerCase();
    const ps = live(S.doc.prices).filter(p => !q || (p.item || '').toLowerCase().includes(q)).sort((a, b) => (a.item || '').localeCompare(b.item || ''));
    if (!ps.length) return `<div class="empty" style="padding:24px 0"><div class="empty-art">🏷️</div><h3>No prices yet</h3><p>Tap “+ $” next to anything on your grocery list to remember what it costs.</p></div>`;
    return `<div class="list">${ps.map(p => `<button class="list-item" data-act="pp-edit" data-name="${esc(p.item)}"><div class="grow"><div class="li-title">${esc(p.item)}</div><div class="li-sub">${esc(memberName(p.updatedBy))} · ${relDays(isoDate(new Date(p.updatedAt)))}</div></div><b style="font-variant-numeric:tabular-nums">${money(p.price)}</b><span class="small muted">/ ${p.qty !== 1 ? formatQty(p.qty) + ' ' : ''}${esc(p.unit || 'each')}</span></button>`).join('')}</div>`;
  };
  const s = openSheet({
    title: 'Prices & budget', live: true,
    body: () => `
      <form data-submit="budget" class="card card-pad" style="margin-bottom:18px">
        <label class="field"><span>Weekly grocery budget</span>
          <div class="row"><div class="money-input grow"><input class="input" name="budget" inputmode="decimal" value="${+setting('budget', 0) || ''}" placeholder="150"></div><button class="btn btn-primary" type="submit">Save</button></div></label>
        <p class="tiny muted" style="margin:8px 0 0">Your grocery list and week plan show progress against this.</p>
      </form>
      <div class="input-icon" style="margin-bottom:12px">${ic('search', 18)}<input class="input" data-input="pp-q" placeholder="Search saved prices" value="${esc(st.q)}"></div>
      <div class="pp-list">${list()}</div>`,
    actions: {
      budget: form => { const v = parseFloat(String(form.budget.value).replace(/[$,]/g, '')) || 0; mutate(api => setSetting(api, 'budget', Math.max(0, Math.round(v * 100) / 100)), { toast: v ? `Budget set to ${money(v)} a week` : 'Budget cleared' }); },
      'pp-q': el => { st.q = el.value; s.el.querySelector('.pp-list').innerHTML = list(); },
      'pp-edit': el => openPriceSheet(el.dataset.name),
    },
  });
}

function openSections() {
  const s = openSheet({
    title: 'Store section order', narrow: true, live: true,
    body: () => {
      const order = sectionOrder();
      return `<p class="small muted" style="margin-top:0">Your grocery list follows this order — set it to match how you walk through Harris Teeter.</p>
      <div class="list">${order.map((sec, i) => `<div class="list-item" style="min-height:50px;padding:6px 8px 6px 16px"><span class="small muted" style="width:20px">${i + 1}</span><div class="grow li-title">${esc(sec)}</div>
        <button class="icon-btn sm" data-act="so-move" data-i="${i}" data-d="-1" ${i ? '' : 'disabled style="opacity:.3"'} aria-label="Move ${esc(sec)} up">${ic('up', 18)}</button>
        <button class="icon-btn sm" data-act="so-move" data-i="${i}" data-d="1" ${i < order.length - 1 ? '' : 'disabled style="opacity:.3"'} aria-label="Move ${esc(sec)} down">${ic('down', 18)}</button></div>`).join('')}</div>
      <button class="btn btn-ghost btn-sm" data-act="so-reset" style="margin-top:12px">Reset to default</button>`;
    },
    actions: {
      'so-move': el => { const o = sectionOrder(); const i = +el.dataset.i, j = i + +el.dataset.d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; mutate(api => setSetting(api, 'sectionOrder', o)); },
      'so-reset': () => mutate(api => setSetting(api, 'sectionOrder', DEFAULT_SECTIONS.slice()), { toast: 'Section order reset' }),
    },
  });
}

function openHistory() {
  const t = today();
  const s = openSheet({
    title: 'Meal history', live: true,
    body: () => {
      const events = [];
      const seen = new Set();
      for (const h of live(S.doc.history)) { const k = h.recipeId + h.date; if (!seen.has(k)) { seen.add(k); events.push({ date: h.date, recipeId: h.recipeId, cooked: true }); } }
      for (const p of live(S.doc.plan)) if (p.recipeId && p.date <= t) { const k = p.recipeId + p.date; if (!seen.has(k)) { seen.add(k); events.push({ date: p.date, recipeId: p.recipeId, slot: p.slot }); } }
      events.sort((a, b) => b.date.localeCompare(a.date));
      const lh = lastHadMap();
      const stale = recipes().filter(r => isFav(r) || events.filter(e => e.recipeId === r.id).length >= 2)
        .map(r => ({ r, last: lh.get(r.id) })).filter(x => !x.last || daysBetween(x.last, t) >= 21)
        .sort((a, b) => (a.last || '0').localeCompare(b.last || '0')).slice(0, 8);
      const month = events.filter(e => daysBetween(e.date, t) < 30).length;
      return `
        <div class="summary-stats card card-pad" style="margin-bottom:18px"><div class="stat"><b>${month}</b><span>meals in 30 days</span></div><div class="stat"><b>${new Set(events.map(e => e.recipeId)).size}</b><span>different recipes</span></div></div>
        <h3 style="margin-bottom:4px">Haven't had in a while</h3>
        <p class="tiny muted" style="margin:0 0 10px">Favorites and regulars you haven't eaten in 3+ weeks.</p>
        ${stale.length ? `<div class="list">${stale.map(({ r, last }) => `<div class="list-item">${thumb(r).replace('class="thumb', 'style="width:42px;height:42px;border-radius:12px;font-size:21px" class="thumb')}<button class="grow" style="text-align:left" data-act="open-recipe" data-id="${r.id}"><div class="li-title ellipsis">${esc(r.title)}</div><div class="li-sub">${last ? 'Last had ' + relDays(last) : 'Never cooked'}</div></button><button class="btn btn-soft btn-sm" data-act="plan-recipe" data-id="${r.id}">Plan it</button></div>`).join('')}</div>`
          : `<p class="small muted">Nothing yet — heart a few recipes and we'll nudge you when they've been off the menu for a while.</p>`}
        <h3 style="margin:24px 0 10px">Recently eaten</h3>
        ${events.length ? `<div class="list">${events.slice(0, 60).map(e => { const r = recipe(e.recipeId); return r ? `<button class="list-item" data-act="open-recipe" data-id="${r.id}">${thumb(r).replace('class="thumb', 'style="width:38px;height:38px;border-radius:10px;font-size:19px" class="thumb')}<div class="grow"><div class="li-title ellipsis">${esc(r.title)}</div><div class="li-sub">${fmtDay(e.date).slice(0, 3)} ${fmtDate(e.date)} · ${relDays(e.date)}${e.cooked ? ' · cooked' : ''}</div></div></button>` : ''; }).join('')}</div>`
          : `<div class="empty" style="padding:20px 0"><div class="empty-art">🗓️</div><h3>No history yet</h3><p>Meals you plan (and finish in cook mode) show up here.</p></div>`}`;
    },
  });
}

function openSearch() {
  const st = { q: '' };
  const results = () => {
    const q = st.q.trim().toLowerCase();
    if (q.length < 2) return `<p class="small muted" style="text-align:center;margin-top:30px">Search recipe titles, ingredients, tags, notes, your grocery list, pantry and planned meals.</p>`;
    const rs = recipes().map(r => ({ r, m: searchRecipe(r, q) })).filter(x => x.m).slice(0, 30);
    const gs = groceryVisible().filter(g => g.name.toLowerCase().includes(q)).slice(0, 15);
    const ps = live(S.doc.pantry).filter(p => p.name.toLowerCase().includes(q)).slice(0, 15);
    const plans = live(S.doc.plan).filter(p => (p.note || '').toLowerCase().includes(q) || ((recipe(p.recipeId) || {}).title || '').toLowerCase().includes(q)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    if (!rs.length && !gs.length && !ps.length && !plans.length) return `<div class="empty"><div class="empty-art">🔎</div><h3>Nothing found</h3><p>No matches for “${esc(st.q)}”.</p></div>`;
    return `
      ${rs.length ? `<h3 style="margin:8px 0">Recipes</h3><div class="list">${rs.map(({ r, m }) => `<button class="list-item" data-act="open-recipe" data-id="${r.id}">${thumb(r).replace('class="thumb', 'style="width:40px;height:40px;border-radius:10px;font-size:20px" class="thumb')}<div class="grow"><div class="li-title ellipsis">${esc(r.title)}</div><div class="li-sub">${m.hit === 'ing' ? 'Uses ' + esc(m.text) : m.hit === 'tag' ? 'Tag match' : m.hit === 'text' ? 'Mentioned in steps or notes' : (r.tags || []).join(', ')}</div></div></button>`).join('')}</div>` : ''}
      ${gs.length ? `<h3 style="margin:20px 0 8px">Grocery list</h3><div class="list">${gs.map(g => `<button class="list-item" data-act="goto-groceries"><span class="li-icon terra">${ic('cart', 18)}</span><div class="grow"><div class="li-title">${esc(g.name)}</div><div class="li-sub">${g.checked ? 'In cart' : g.have ? 'Already have' : 'To buy'}${g.qty != null ? ' · ' + esc(formatAmount(g.qty, g.unit)) : ''}</div></div></button>`).join('')}</div>` : ''}
      ${ps.length ? `<h3 style="margin:20px 0 8px">Pantry</h3><div class="list">${ps.map(p => `<button class="list-item" data-act="goto-pantry"><span class="li-icon">${ic('jar', 18)}</span><div class="grow"><div class="li-title">${esc(p.name)}</div><div class="li-sub">${p.low ? 'Running low' : 'Stocked'}</div></div></button>`).join('')}</div>` : ''}
      ${plans.length ? `<h3 style="margin:20px 0 8px">Planned meals</h3><div class="list">${plans.map(p => `<button class="list-item" data-act="goto-week" data-date="${p.date}"><span class="li-icon gold">${ic('plan', 18)}</span><div class="grow"><div class="li-title ellipsis">${esc((recipe(p.recipeId) || {}).title || p.note)}</div><div class="li-sub">${fmtDay(p.date)} ${fmtDate(p.date)} · ${p.slot}</div></div></button>`).join('')}</div>` : ''}`;
  };
  const s = openSheet({
    title: 'Search',
    body: () => `<div class="input-icon" style="margin-bottom:14px">${ic('search', 18)}<input class="input" type="search" data-input="se-q" placeholder="Try “chicken” or “quick”" autocomplete="off"></div><div class="se-res">${results()}</div>`,
    onMount: sh => setTimeout(() => { const i = $('[data-input="se-q"]', sh.el); if (i) i.focus(); }, 300),
    actions: {
      'se-q': el => { st.q = el.value; s.el.querySelector('.se-res').innerHTML = results(); },
      'goto-groceries': () => { s.close(); setTab('groceries'); },
      'goto-pantry': () => { s.close(); setTab('pantry'); },
      'goto-week': el => { s.close(); S.week = weekStartOf(el.dataset.date, setting('weekStart', 0)); S.tab = 'plan'; render(); },
    },
  });
}

/* ---------- What should we eat? ---------- */
function openPicker() {
  const st = { quick: false, current: null, spinning: false };
  const pool = () => {
    let rs = recipes();
    const favs = rs.filter(isFav);
    if (favs.length >= 3) rs = favs;
    if (st.quick) rs = rs.filter(r => ((r.prepMin || 0) + (r.cookMin || 0)) <= 35);
    return rs;
  };
  const choose = () => {
    const rs = pool();
    if (!rs.length) return null;
    const lh = lastHadMap(), t = today();
    // Weighted toward things you haven't had lately.
    const w = rs.map(r => { const l = lh.get(r.id); const days = l ? daysBetween(l, t) : 60; return Math.max(0.2, Math.min(days, 60) / 10) * (r.id === (st.current && st.current.id) ? 0.05 : 1); });
    let x = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < rs.length; i++) { x -= w[i]; if (x <= 0) return rs[i]; }
    return rs[rs.length - 1];
  };
  const spin = () => {
    const rs = pool();
    if (!rs.length) { st.current = null; s.refreshBody(); return; }
    st.spinning = true;
    let n = 0;
    const final = choose();
    const tick = () => {
      n++;
      st.current = n < 9 ? rs[Math.floor(Math.random() * rs.length)] : final;
      s.refreshBody();
      if (n < 9) setTimeout(tick, 60 + n * 18); else { st.spinning = false; s.refreshBody(); }
    };
    tick();
  };
  const s = openSheet({
    title: 'What should we eat?', narrow: true,
    body: () => {
      const r = st.current;
      const lh = r && lastHadMap().get(r.id);
      return `
        <div class="row" style="justify-content:space-between"><span class="small muted">${recipes().filter(isFav).length >= 3 ? 'Picking from your favorites' : 'Picking from all recipes — heart a few to narrow it down'}</span>
          <button class="chip ${st.quick ? 'on' : ''}" data-act="pk-quick">${ic('clock', 14)} Quick only</button></div>
        <div class="pick-stage ${st.spinning ? 'spinning' : ''}">
          ${r ? `<div class="pick-card">${cover(r)}<div class="pick-title">${esc(r.title)}</div></div>
            <p class="small muted" style="margin:12px 0 0">${st.spinning ? '&nbsp;' : [fmtMin((r.prepMin || 0) + (r.cookMin || 0)), lh ? 'last had ' + relDays(lh) : 'not had yet'].filter(Boolean).join(' · ')}</p>`
          : `<div class="empty"><div class="empty-art">🤷</div><h3>Nothing to pick from</h3><p>${st.quick ? 'No quick recipes yet — turn off “Quick only”.' : 'Add a few recipes first.'}</p></div>`}
        </div>`;
    },
    foot: () => `<button class="btn btn-line grow" data-act="pk-spin" ${st.spinning ? 'disabled' : ''}>${ic('shuffle', 18)} Spin again</button><button class="btn btn-primary grow" data-act="pk-plan" ${st.spinning || !st.current ? 'disabled' : ''}>${ic('check', 18)} Tonight!</button>`,
    actions: {
      'pk-quick': () => { st.quick = !st.quick; spin(); },
      'pk-spin': () => spin(),
      'pk-plan': () => {
        const r = st.current; if (!r) return;
        const d = today();
        mutate(api => addEntry(api, { date: d, slot: 'dinner', recipeId: r.id, servings: +setting('defaultServings', 0) || r.servings }), { toast: `${r.title} is tonight's dinner` });
        s.close();
        S.week = weekStartOf(d, setting('weekStart', 0)); S.tab = 'plan'; render();
      },
    },
  });
  spin();
}

/* ================================================================== *
 * COOK MODE
 * ================================================================== */
let wakeLock = null;
async function lockScreen() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); } } catch { /* not allowed */ }
}
function unlockScreen() { try { wakeLock && wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }

let audioCtx = null;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [0, .25, .5].forEach((d, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = [880, 1175, 1480][i]; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.3, t0 + d + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + .35);
      o.connect(g).connect(audioCtx.destination); o.start(t0 + d); o.stop(t0 + d + .4);
    });
  } catch { /* no audio */ }
  if (navigator.vibrate) try { navigator.vibrate([250, 120, 250, 120, 400]); } catch { /* ignore */ }
}
const fmtClock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

setInterval(() => {
  if (!S.timers.length) return;
  const now = Date.now();
  for (const t of S.timers) if (!t.done && now >= t.end) { t.done = true; chime(); toast(`⏰ ${t.label} — time's up!`, null, 8000); }
  const el = $('#cook-timers');
  if (el) el.innerHTML = timersHtml();
}, 500);

function timersHtml() {
  return S.timers.map(t => `<span class="timer ${t.done ? 'done' : ''}">${ic('timer', 18)} ${t.done ? 'Done!' : fmtClock((t.end - Date.now()) / 1000)} <span class="tiny" style="font-weight:600;opacity:.75">${esc(t.label)}</span><button class="icon-btn sm" data-act="ck-timer-x" data-id="${t.id}" aria-label="Dismiss timer">${ic('x', 16)}</button></span>`).join('');
}

function openCook(id, servings) {
  const r = recipe(id);
  if (!r) return;
  const st = { step: 0, tab: 'steps', done: new Set(), servings: servings || r.servings };
  const el = document.createElement('div');
  el.className = 'cook';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Cook mode: ' + r.title);
  const steps = r.steps && r.steps.length ? r.steps : ['No steps written yet — just cook it your way!'];
  const ings = scaleIngredients(r.ingredients, r.servings, st.servings);
  const draw = () => {
    const pct = ((st.step + 1) / steps.length) * 100;
    const timers = findTimers(steps[st.step]);
    const last = st.step === steps.length - 1;
    el.innerHTML = `
      <div class="cook-head">
        <button class="icon-btn" data-act="ck-close" aria-label="Exit cook mode">${ic('x')}</button>
        <h2>${esc(r.title)}</h2>
        <div class="seg" style="width:auto"><button class="${st.tab === 'steps' ? 'on' : ''}" data-act="ck-tab" data-t="steps">Steps</button><button class="${st.tab === 'ing' ? 'on' : ''}" data-act="ck-tab" data-t="ing">Ingredients</button></div>
      </div>
      <div class="cook-progress"><i style="width:${pct}%"></i></div>
      <div class="timers ${S.timers.length ? '' : 'hidden'}" id="cook-timers">${timersHtml()}</div>
      <div class="cook-body">
        ${st.tab === 'steps' ? `
          <div class="cook-step-num">Step ${st.step + 1} of ${steps.length}</div>
          <p class="cook-step" aria-live="polite">${esc(steps[st.step])}</p>
          ${timers.map(t => `<button class="timer-btn" data-act="ck-timer" data-s="${t.seconds}" data-l="${esc(t.label)}">${ic('timer', 20)} Start ${esc(t.label)} timer</button>`).join('')}
          <button class="btn btn-ghost btn-sm" data-act="ck-custom" style="margin-top:6px">${ic('plus', 16)} Custom timer</button>`
        : `<div class="small muted" style="margin-bottom:6px">For ${st.servings} servings · tap to check off</div>
          <ul class="ing-list cook-ing">${ings.map((i, n) => `<li class="${st.done.has(n) ? 'done' : ''}" data-act="ck-ing" data-n="${n}"><span class="gcheck">${ic('check', 16)}</span><span><b>${esc(formatAmount(i.qty, i.unit))}</b> ${esc(i.item)}${i.note ? `<span class="ing-note">, ${esc(i.note)}</span>` : ''}</span></li>`).join('')}</ul>`}
      </div>
      <div class="cook-foot">
        <button class="btn btn-line" data-act="ck-prev" ${st.step === 0 || st.tab !== 'steps' ? 'disabled' : ''}>${ic('left')} Back</button>
        ${st.tab !== 'steps' ? `<button class="btn btn-primary" data-act="ck-tab" data-t="steps">Go to steps ${ic('right')}</button>`
        : last ? `<button class="btn btn-accent" data-act="ck-finish">${ic('check')} Done — we ate!</button>` : `<button class="btn btn-primary" data-act="ck-next">Next ${ic('right')}</button>`}
      </div>`;
    const tEl = $('#cook-timers', el); if (tEl) tEl.classList.toggle('hidden', !S.timers.length);
  };
  const close = () => { unlockScreen(); document.removeEventListener('visibilitychange', onVis); document.removeEventListener('keydown', onKey); el.remove(); document.body.classList.remove('lock'); };
  const overlay = pushOverlay(close);
  const onVis = () => { if (document.visibilityState === 'visible' && !overlay.closed) lockScreen(); };
  const onKey = e => { if (e.key === 'ArrowRight' && st.step < steps.length - 1) { st.step++; draw(); } else if (e.key === 'ArrowLeft' && st.step > 0) { st.step--; draw(); } };
  document.addEventListener('visibilitychange', onVis);
  document.addEventListener('keydown', onKey);
  // Swipe between steps
  let sx = null;
  el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (sx == null || st.tab !== 'steps') return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 70) { if (dx < 0 && st.step < steps.length - 1) st.step++; else if (dx > 0 && st.step > 0) st.step--; draw(); }
  }, { passive: true });
  el._cook = {
    'ck-close': () => overlay.close(),
    'ck-tab': b => { st.tab = b.dataset.t; draw(); },
    'ck-next': () => { st.step = Math.min(steps.length - 1, st.step + 1); draw(); },
    'ck-prev': () => { st.step = Math.max(0, st.step - 1); draw(); },
    'ck-ing': b => { const n = +b.dataset.n; st.done.has(n) ? st.done.delete(n) : st.done.add(n); draw(); },
    'ck-timer': b => { const sec = +b.dataset.s; S.timers.push({ id: uid('t'), label: b.dataset.l, end: Date.now() + sec * 1000, done: false }); draw(); toast(`Timer started · ${b.dataset.l}`); },
    'ck-custom': () => {
      const t = openSheet({
        title: 'Custom timer', narrow: true,
        body: () => `<div class="chips wrap">${[1, 3, 5, 8, 10, 15, 20, 30, 45, 60].map(m => `<button class="chip" data-act="ct-go" data-m="${m}">${m} min</button>`).join('')}</div>`,
        actions: { 'ct-go': b => { const m = +b.dataset.m; S.timers.push({ id: uid('t'), label: `${m} min`, end: Date.now() + m * 60000, done: false }); t.close(); draw(); } },
      });
    },
    'ck-timer-x': b => { S.timers = S.timers.filter(t => t.id !== b.dataset.id); draw(); },
    'ck-finish': () => {
      mutate(api => api.put('history', uid('h_'), { recipeId: r.id, date: today(), servings: st.servings }), { toast: `Nice! ${r.title} logged to your history` });
      overlay.close();
    },
  };
  draw();
  document.body.appendChild(el);
  document.body.classList.add('lock');
  lockScreen();
}

/* ================================================================== *
 * Global event wiring
 * ================================================================== */
const ACT = {
  tab: el => setTab(el.dataset.tab),
  'week-prev': () => { S.week = addDays(S.week, -7); render(); },
  'week-next': () => { S.week = addDays(S.week, 7); render(); },
  'week-today': () => { S.week = weekStartOf(today(), setting('weekStart', 0)); render(); },
  add: el => openAddSheet(el.dataset.date, el.dataset.slot),
  entry: el => openEntrySheet(el.dataset.id),
  'plan-recipe': el => openPlanPicker(el.dataset.id),
  'open-recipe': el => openRecipe(el.dataset.id),
  cook: el => openCook(el.dataset.id, +el.dataset.serv || null),
  'build-list': () => buildGrocery(),
  'copy-week': () => copyLastWeek(),
  pick: () => openPicker(),
  'new-recipe': () => openEditor(null),
  'paste-recipe': () => openPasteImport(),
  rtag: el => { S.rtag = el.dataset.tag; render(); },
  'clear-recipe-filter': () => { S.rq = ''; S.rtag = 'All'; render(); },
  fav: el => { const r = recipe(el.dataset.id); mutate(api => api.put('recipes', r.id, { fav: !r.fav }), { toast: r.fav ? 'Removed from favorites' : `♥ ${r.title} is a favorite`, undo: false }); },
  gcheck: el => toggleCheck(el.dataset.id),
  gitem: el => openGroceryItem(el.dataset.id),
  gprice: el => { const g = S.doc.grocery[el.dataset.id]; if (g) openPriceSheet(g.name, g); },
  'need-it': el => { const g = S.doc.grocery[el.dataset.id]; mutate(api => api.put('grocery', g.id, { have: false }), { toast: `${g.name} is back on the list` }); },
  'toggle-cart': (el, e) => { if (e.target.closest('[data-act="clear-checked"]')) return ACT['clear-checked'](); S.openCart = !S.openCart; render(); },
  'toggle-have': () => { S.openHave = !S.openHave; render(); },
  'clear-checked': () => { const c = live(S.doc.grocery).filter(g => g.checked); if (!c.length) return; mutate(api => c.forEach(g => api.del('grocery', g.id)), { toast: `Cleared ${plural(c.length, 'item')}` }); },
  'share-list': () => { const t = groceryText(); if (!groceryVisible().some(g => !g.checked && !g.have)) { toast('Nothing left to buy'); return; } shareText(t, 'Grocery list'); },
  'grocery-menu': () => {
    const s = openSheet({
      title: 'Grocery list', narrow: true,
      body: () => `<div class="action-list">
        <button class="action" data-act="gm-build">${ic('refresh', 20)} Rebuild from ${weekLabel().toLowerCase()}</button>
        <button class="action" data-act="gm-uncheck">${ic('list', 20)} Uncheck everything</button>
        <button class="action" data-act="gm-clear-checked">${ic('check', 20)} Clear checked items</button>
        <button class="action" data-act="gm-sections">${ic('store', 20)} Store section order</button>
        <button class="action danger" data-act="gm-clear">${ic('trash', 20)} Clear the whole list</button></div>`,
      actions: {
        'gm-build': () => { s.close(); buildGrocery(); },
        'gm-uncheck': () => { s.close(); const c = live(S.doc.grocery).filter(g => g.checked); mutate(api => c.forEach(g => api.put('grocery', g.id, { checked: false })), { toast: 'Unchecked everything' }); },
        'gm-clear-checked': () => { s.close(); ACT['clear-checked'](); },
        'gm-sections': () => { s.close(); setTimeout(openSections, 60); },
        'gm-clear': () => { s.close(); const all = live(S.doc.grocery); if (!all.length) return; mutate(api => all.forEach(g => api.del('grocery', g.id)), { toast: `Cleared ${plural(all.length, 'item')}` }); },
      },
    });
  },
  pfilter: el => { S.pantryFilter = el.dataset.f; render(); },
  plow: el => { const p = S.doc.pantry[el.dataset.id]; mutate(api => setPantryLow(api, p, !p.low), { toast: !p.low ? `${p.name} added to groceries` : `${p.name} restocked`, undo: true }); },
  pedit: el => openPantryItem(el.dataset.id),
  'open-kitchen': () => openKitchenSheet(),
  'open-prices': () => openPrices(),
  'open-sections': (el, e) => { e && e.preventDefault(); openSections(); },
  'open-history': () => openHistory(),
  'open-search': () => openSearch(),
  theme: el => { try { localStorage.setItem('mp:theme', el.dataset.v); } catch { /* ignore */ } applyTheme(); render(); },
  'sync-now': () => { if (S.sync) { S.sync.pull(); toast('Syncing…'); } },
  'sign-out': async () => {
    if (!(await confirmSheet({ title: 'Sign out?', message: 'Your kitchen stays saved. You can sign back in any time with a magic link.', confirm: 'Sign out' }))) return;
    try { if (S.sync) await S.sync.flush(); } catch { /* ignore */ }
    try { if (S.sb) await S.sb.auth.signOut(); } catch { /* ignore */ }
    stopApp();
  },
  'auth-back': () => renderAuth(),
  'recheck-invites': async (el, e) => { e.preventDefault(); if (S.user) startApp(S.user); },
};

const INPUTS = {
  rq: el => { S.rq = el.value; const [, body] = viewRecipes(); const tmp = document.createElement('div'); tmp.innerHTML = body; $('.recipe-results').replaceWith(tmp.querySelector('.recipe-results')); },
  rsort: el => { S.rsort = el.value; render(); },
  'pref-name': el => mutate(api => setSetting(api, 'name:' + S.user.id, el.value.trim()), { toast: 'Name updated', undo: false }),
  'pref-week': el => { mutate(api => setSetting(api, 'weekStart', +el.value)); S.week = weekStartOf(today(), +el.value); render(); },
  'pref-serv': el => mutate(api => setSetting(api, 'defaultServings', +el.value)),
};

const SUBMITS = {
  signin: form => signIn(form),
  'create-kitchen': async form => { const b = form.querySelector('button'); b.disabled = true; const ok = await createKitchen(form.name.value.trim()); if (!ok) b.disabled = false; },
  gadd: form => { const v = form.item.value.trim(); if (!v) return; addGroceryText(v); const i = $('form[data-submit="gadd"] input[name="item"]'); if (i) { i.value = ''; i.focus(); } },
  padd: form => {
    const name = form.item.value.trim(); if (!name) return;
    const key = itemKey(name);
    if (live(S.doc.pantry).some(p => (p.key || itemKey(p.name)) === key)) { toast(`${name} is already in your pantry`); return; }
    mutate(api => api.put('pantry', uid('pa_'), { name: name.charAt(0).toUpperCase() + name.slice(1), key, section: sectionFor(key, name), low: false }), { toast: `Added ${name} to pantry` });
    const i = $('form[data-submit="padd"] input[name="item"]'); if (i) { i.value = ''; i.focus(); }
  },
};

function handlerFor(el, name, table) {
  const sheetEl = el.closest('.sheet');
  if (sheetEl && sheetEl._sheet && sheetEl._sheet.actions[name]) return sheetEl._sheet.actions[name];
  const cook = el.closest('.cook');
  if (cook && cook._cook && cook._cook[name]) return cook._cook[name];
  return table[name];
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'sheet-close') { const s = el.closest('.sheet'); if (s && s._sheet) s._sheet.close(); return; }
  const h = handlerFor(el, act, ACT);
  if (h) { if (el.tagName === 'A') e.preventDefault(); h(el, e); }
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  const h = handlerFor(el, el.dataset.input, INPUTS);
  if (h) h(el, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const h = handlerFor(el, el.dataset.change, INPUTS);
  if (h) h(el, e);
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  const h = handlerFor(form, form.dataset.submit, SUBMITS);
  if (h) h(form, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { const s = $$('.sheet').map(x => x._sheet).filter(x => x && !x.closed).pop(); if (s) s.close(); else { const c = $('.cook'); if (c) c._cook['ck-close'](); } }
});

initDrag(handleDrop);

window.addEventListener('online', () => {
  if (S.offlineUser) { location.reload(); return; }
  if (S.sync) { S.sync.pull(); }
  updateSyncDot();
});
window.addEventListener('offline', () => { S.status = 'offline'; updateSyncDot(); });
document.addEventListener('visibilitychange', () => {
  if (!S.sync) return;
  if (document.visibilityState === 'visible') S.sync.pull();
  else if (S.sync.dirty) S.sync.flush();
});
window.addEventListener('pagehide', () => { if (S.sync && S.sync.dirty) S.sync.flush(); });
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

function registerSW() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !window.__MP_NO_SW__) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* ignore */ });
  }
}

// Midnight rollover: keep "today" fresh for long-lived tabs.
let lastDay = today();
setInterval(() => { const t = today(); if (t !== lastDay) { if (S.week === weekStartOf(lastDay, setting('weekStart', 0))) S.week = weekStartOf(t, setting('weekStart', 0)); lastDay = t; render(); } }, 60000);

boot();
