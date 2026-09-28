// Kitchen display: pure logic shared by display.js, the phone app and the tests.
// No DOM, no network (loadMoneyHQ only calls the Supabase client it is given).
import { isoDate, parseDate, addDays, daysBetween, validDate, readCountdown, readNote } from './core.js';

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ *
 * Display settings (synced in the kitchen doc as settings "display.*",
 * so the phone app can change them too)
 * ------------------------------------------------------------------ */

export const SCENES = [['tonight', 'Tonight'], ['groceries', 'Groceries'], ['week', 'Week'], ['weather', 'Weather & countdowns']];
export const DEFAULT_PLACE = { name: 'Charlotte, NC', lat: 35.2271, lon: -80.8431 };
export const DISPLAY_DEFAULTS = {
  place: DEFAULT_PLACE, rotateSec: 20, scenes: SCENES.map(s => s[0]),
  nightOn: true, nightStart: '22:00', nightEnd: '06:00',
  temp: 'f', clock24: false, money: false, moneyPrivacy: true,
};
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function readDisplaySettings(settings) {
  const get = k => { const e = settings && settings['display.' + k]; return e && !e.deleted && e.value !== undefined && e.value !== null ? e.value : undefined; };
  const D = DISPLAY_DEFAULTS;
  const p = get('place');
  const place = p && typeof p === 'object' && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
    ? { name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `${(+p.lat).toFixed(2)}, ${(+p.lon).toFixed(2)}`, lat: +p.lat, lon: +p.lon } : D.place;
  const r = +get('rotateSec');
  const sc = get('scenes');
  const scenes = Array.isArray(sc) ? SCENES.map(s => s[0]).filter(id => sc.includes(id)) : D.scenes;
  const bool = (k) => { const v = get(k); return v === undefined ? D[k] : v === true || v === 'true'; };
  const time = k => { const v = get(k); return TIME_RE.test(v) ? v : D[k]; };
  return {
    place, rotateSec: [0, 10, 20, 30, 60].includes(r) ? r : D.rotateSec,
    scenes: scenes.length ? scenes : D.scenes,
    nightOn: bool('nightOn'), nightStart: time('nightStart'), nightEnd: time('nightEnd'),
    temp: get('temp') === 'c' ? 'c' : 'f', clock24: bool('clock24'), money: bool('money'), moneyPrivacy: bool('moneyPrivacy'),
  };
}

/* ------------------------------------------------------------------ *
 * Time of day, night mode, scenes
 * ------------------------------------------------------------------ */

const minutesOf = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Night window [start, end), wrapping past midnight when start > end. start === end means never.
export function isNightTime(date, { nightOn = true, nightStart = '22:00', nightEnd = '06:00' } = {}) {
  if (!nightOn) return false;
  const s = minutesOf(nightStart), e = minutesOf(nightEnd);
  if (s === e) return false;
  const m = date.getHours() * 60 + date.getMinutes();
  return s < e ? m >= s && m < e : m >= s || m < e;
}

export function dayPart(date) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'late';
}

export function greeting(date) {
  return { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', late: 'Good night' }[dayPart(date)];
}

// Visual theme: bright morning, warm afternoon, dim evening, very dim night mode.
export function themeFor(date, settings) {
  if (isNightTime(date, settings)) return 'night';
  const p = dayPart(date);
  return p === 'late' ? 'evening' : p;
}

// Which scene is on screen. Rotation is tied to the clock so it never drifts;
// a tap pins a scene until pin.until.
export function sceneAt(now, scenes, rotateSec = 20, pin = null) {
  const list = scenes && scenes.length ? scenes : DISPLAY_DEFAULTS.scenes;
  if (pin && pin.until > now && list.includes(pin.scene)) return pin.scene;
  if (!rotateSec) return list[0];
  return list[Math.floor(now / (rotateSec * 1000)) % list.length];
}
export const PIN_MS = 2 * 60 * 1000;

// Date whose breakfast night mode shows: after noon that's tomorrow, after midnight it's today.
export function breakfastDate(date) {
  const t = isoDate(date);
  return date.getHours() >= 12 ? addDays(t, 1) : t;
}

// Milliseconds until the next hh:00 local (the nightly reload at 3am).
export function msUntilHour(now, hour = 3) {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0);
  if (next <= d) next.setDate(next.getDate() + 1);
  return next - d;
}

// Burn-in protection: a slow walk around a small square, one step every few minutes.
const SHIFTS = [[0, 0], [3, 2], [5, -1], [2, -4], [-2, -3], [-4, 1], [-3, 4], [1, 5]];
export function burnInShift(now, everyMin = 3) {
  return SHIFTS[Math.floor(now / (everyMin * 60000)) % SHIFTS.length];
}

export function formatClock(date, clock24) {
  const h = date.getHours(), m = String(date.getMinutes()).padStart(2, '0');
  if (clock24) return { time: `${String(h).padStart(2, '0')}:${m}`, ampm: '' };
  return { time: `${h % 12 || 12}:${m}`, ampm: h < 12 ? 'AM' : 'PM' };
}

/* ------------------------------------------------------------------ *
 * Countdowns
 * ------------------------------------------------------------------ */

const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
// A yearly date in a given year. Feb 29 falls on Feb 28 in non-leap years.
function inYear(date, year) {
  const [, m, d] = date.split('-').map(Number);
  const day = m === 2 && d === 29 && !isLeap(year) ? 28 : d;
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Next time a countdown happens on or after `today`: { date, days, years } or null when it has passed.
export function nextOccurrence(cd, today) {
  const c = readCountdown(cd);
  if (!c || !validDate(today)) return null;
  if (!c.yearly) {
    const days = daysBetween(today, c.date);
    return days >= 0 ? { date: c.date, days, years: null } : null;
  }
  const y0 = +c.date.slice(0, 4), ty = +today.slice(0, 4);
  let year = Math.max(ty, y0);
  let date = inYear(c.date, year);
  if (date < today) { year++; date = inYear(c.date, year); }
  return { date, days: daysBetween(today, date), years: year - y0 };
}

export function countdownText(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 0) return days === -1 ? 'Yesterday' : `${-days} days ago`;
  if (days < 7) return `in ${days} days`;
  if (days < 14) return 'in 1 week';
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${days} days`;
}

const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
export const ordinalOf = ordinal;

export function upcomingCountdowns(list, today, limit = 6) {
  const out = [];
  for (const raw of list) {
    const c = readCountdown(raw);
    if (!c) continue;
    const n = nextOccurrence(c, today);
    if (!n) continue;
    out.push({ ...c, next: n.date, days: n.days, years: n.years, when: countdownText(n.days), milestone: c.yearly && n.years > 0 ? ordinal(n.years) : '' });
  }
  return out.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title)).slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Notes (message board)
 * ------------------------------------------------------------------ */

// Shown through the end of their expiry day.
export const noteActive = (n, today) => { const x = readNote(n); return !!x && (!x.expires || x.expires >= today); };
export function activeNotes(list, today) {
  return list.filter(n => noteActive(n, today)).map(readNote)
    .sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
}

/* ------------------------------------------------------------------ *
 * Weather (Open-Meteo, free, no key)
 * ------------------------------------------------------------------ */

export function weatherUrl({ lat, lon }, temp = 'f') {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    temperature_unit: temp === 'c' ? 'celsius' : 'fahrenheit', wind_speed_unit: temp === 'c' ? 'kmh' : 'mph',
    timezone: 'auto', forecast_days: '6',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + q;
}

export function geocodeUrl(name) {
  return 'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name, count: '6', language: 'en', format: 'json' });
}
export function parseGeocode(json) {
  const list = json && Array.isArray(json.results) ? json.results : [];
  return list.filter(r => r && isFinite(r.latitude) && isFinite(r.longitude)).map(r => ({
    name: [r.name, r.admin1_code && r.country_code === 'US' ? r.admin1_code : r.admin1, r.country_code !== 'US' ? r.country : ''].filter(Boolean).join(', '),
    lat: Math.round(r.latitude * 1e4) / 1e4, lon: Math.round(r.longitude * 1e4) / 1e4,
  }));
}

// WMO weather codes -> [label, icon kind]
const WMO = {
  0: ['Clear', 'clear'], 1: ['Mostly clear', 'clear'], 2: ['Partly cloudy', 'partly'], 3: ['Cloudy', 'cloudy'],
  45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'], 56: ['Freezing drizzle', 'drizzle'], 57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'], 66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Heavy showers', 'rain'], 85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'],
  95: ['Thunderstorms', 'storm'], 96: ['Storms with hail', 'storm'], 99: ['Storms with hail', 'storm'],
};
export function describeWeather(code, isDay = true) {
  const [label, kind] = WMO[code] || ['—', 'cloudy'];
  return { label, icon: !isDay && (kind === 'clear' || kind === 'partly') ? kind + '-night' : kind };
}

const n = v => (typeof v === 'number' && isFinite(v) ? v : null);
// Open-Meteo response -> { current, days[], units, at } or null when it isn't usable.
export function parseWeather(json, now = Date.now()) {
  if (!json || typeof json !== 'object' || json.error) return null;
  const c = json.current || {};
  const d = json.daily || {};
  const temp = n(c.temperature_2m);
  if (temp == null) return null;
  const isDay = c.is_day !== 0;
  const days = [];
  const times = Array.isArray(d.time) ? d.time : [];
  for (let i = 0; i < times.length && days.length < 6; i++) {
    if (!validDate(times[i])) continue;
    const code = n(d.weather_code && d.weather_code[i]);
    const hi = n(d.temperature_2m_max && d.temperature_2m_max[i]), lo = n(d.temperature_2m_min && d.temperature_2m_min[i]);
    if (hi == null || lo == null) continue;
    days.push({ date: times[i], hi: Math.round(hi), lo: Math.round(lo), pop: n(d.precipitation_probability_max && d.precipitation_probability_max[i]), code, ...describeWeather(code, true) });
  }
  const unit = /F/.test(json.current_units && json.current_units.temperature_2m || '°F') ? 'F' : 'C';
  const sun = (k) => { const v = d[k] && d[k][0]; return typeof v === 'string' ? v : null; };
  return {
    current: {
      temp: Math.round(temp), feels: n(c.apparent_temperature) == null ? null : Math.round(c.apparent_temperature),
      humidity: n(c.relative_humidity_2m), wind: n(c.wind_speed_10m) == null ? null : Math.round(c.wind_speed_10m),
      code: n(c.weather_code), isDay, ...describeWeather(n(c.weather_code), isDay),
    },
    today: days[0] || null,
    days: days.slice(0, 6),
    sunrise: sun('sunrise'), sunset: sun('sunset'),
    unit, windUnit: unit === 'F' ? 'mph' : 'km/h', at: now,
  };
}
export const WEATHER_EVERY = 30 * 60 * 1000;

// Simple inline SVG weather icons (colors come from CSS classes).
export function weatherIcon(kind, size = 48) {
  const sun = '<g class="wi-sun"><circle cx="24" cy="24" r="9"/><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M11.3 36.7l3.5-3.5M33.2 14.8l3.5-3.5"/></g>';
  const moon = '<path class="wi-moon" d="M31 30.5A12 12 0 0 1 19.5 13 12 12 0 1 0 31 30.5Z"/>';
  const cloud = (y = 0, cls = 'wi-cloud') => `<path class="${cls}" transform="translate(0 ${y})" d="M15 38h19a8 8 0 0 0 1-15.9A11 11 0 0 0 14 24.5 6.8 6.8 0 0 0 15 38Z"/>`;
  const smallSun = '<g class="wi-sun" transform="translate(-6 -7) scale(.78)"><circle cx="24" cy="24" r="8"/><path d="M24 8v4M8 24h4M12.7 12.7l2.8 2.8M35.3 12.7l-2.8 2.8"/></g>';
  const smallMoon = '<path class="wi-moon" transform="translate(-5 -6) scale(.8)" d="M31 30.5A12 12 0 0 1 19.5 13 12 12 0 1 0 31 30.5Z"/>';
  const drops = (k) => `<g class="wi-rain">${(k === 'drizzle' ? [[17, 41], [25, 43], [33, 41]] : [[16, 40], [23, 43], [30, 40], [37, 43]]).map(([x, y]) => `<path d="M${x} ${y}l-2 ${k === 'drizzle' ? 3 : 5}"/>`).join('')}</g>`;
  const flakes = '<g class="wi-snow"><circle cx="17" cy="43" r="1.6"/><circle cx="25" cy="45" r="1.6"/><circle cx="33" cy="43" r="1.6"/></g>';
  const bolt = '<path class="wi-bolt" d="m25 33-5 8h5l-3 7 8-10h-5l3-5Z"/>';
  const fog = '<g class="wi-fog"><path d="M10 30h28M13 36h24M10 42h26"/></g>';
  const body = {
    clear: sun, 'clear-night': moon,
    partly: smallSun + cloud(2), 'partly-night': smallMoon + cloud(2),
    cloudy: cloud(-1, 'wi-cloud wi-cloud-back') + cloud(1),
    fog: cloud(-8) + fog,
    drizzle: cloud(-5) + drops('drizzle'), rain: cloud(-5) + drops('rain'),
    snow: cloud(-5) + flakes, storm: cloud(-6) + bolt,
  }[kind] || cloud();
  return `<svg class="wi" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ------------------------------------------------------------------ *
 * Money HQ (read-only peek at public.tracker_state)
 *
 * That table is protected by RLS and only one account can read it. For
 * anyone else the query is denied or comes back empty, and the panel stays
 * hidden. This code only ever selects from it.
 * ------------------------------------------------------------------ */

const pick = (o, keys) => { for (const k of keys) { if (o && o[k] != null && o[k] !== '') { const v = typeof o[k] === 'string' ? parseFloat(o[k].replace(/[$,]/g, '')) : o[k]; if (typeof v === 'number' && isFinite(v)) return v; } } return null; };
const BAL = ['balance', 'currentBalance', 'current_balance', 'remaining', 'remainingBalance', 'owed', 'amountOwed', 'amount'];
const ORIG = ['originalBalance', 'original_balance', 'startingBalance', 'starting_balance', 'startBalance', 'start_balance', 'initialBalance', 'initial_balance', 'original', 'principal', 'initial'];
const APR = ['apr', 'APR', 'rate', 'interestRate', 'interest_rate', 'interest'];
const PAY = ['minPayment', 'min_payment', 'minimumPayment', 'minimum_payment', 'payment', 'monthlyPayment', 'monthly_payment'];

function monthOf(v) {
  if (typeof v === 'string') { const m = v.match(/^(\d{4})-(\d{2})/); if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}`; }
  if (typeof v === 'number' && v > 1e11) { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  return null;
}

// Months to pay off with a fixed monthly payment (avalanche order), or null if it never ends.
function payoffMonths(debts, monthly) {
  const list = debts.filter(d => d.bal > 0).map(d => ({ ...d }));
  if (!list.length) return 0;
  if (!(monthly > 0)) return null;
  list.sort((a, b) => b.apr - a.apr);
  for (let m = 1; m <= 600; m++) {
    let budget = monthly;
    for (const d of list) d.bal += d.bal * d.apr / 12;
    for (const d of list) { const p = Math.min(d.bal, d.min || 0, budget); d.bal -= p; budget -= p; }
    for (const d of list) { if (budget <= 0) break; const p = Math.min(d.bal, budget); d.bal -= p; budget -= p; }
    if (list.every(d => d.bal <= 0.005)) return m;
  }
  return null;
}

export function parseTracker(row, now = new Date()) {
  let s = row && typeof row === 'object' ? (row.data ?? row.state ?? row.value ?? row.doc ?? row) : null;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return null; } }
  if (!s || typeof s !== 'object') return null;
  if (s.state && typeof s.state === 'object' && !Array.isArray(s.state)) s = s.state;
  let arr = null;
  for (const k of ['debts', 'accounts', 'loans', 'cards', 'items']) {
    const v = s[k];
    const vals = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : null;
    if (vals && vals.some(x => x && typeof x === 'object' && pick(x, BAL) != null)) { arr = vals; break; }
  }
  let remaining = null, start = null, debts = [];
  if (arr) {
    debts = arr.filter(x => x && typeof x === 'object' && !x.deleted && !x.archived).map(x => {
      const closed = x.paidOff === true || x.paid_off === true || x.closed === true;
      const bal = closed ? 0 : Math.max(0, pick(x, BAL) ?? 0);
      const orig = pick(x, ORIG);
      let apr = pick(x, APR) ?? 0; if (apr > 1) apr /= 100;
      return { bal, orig: orig != null && orig >= bal ? orig : null, apr: Math.max(0, Math.min(apr, 1)), min: Math.max(0, pick(x, PAY) ?? 0) };
    });
    remaining = debts.reduce((a, d) => a + d.bal, 0);
    if (debts.length && debts.every(d => d.orig != null)) start = debts.reduce((a, d) => a + d.orig, 0);
  }
  const topRem = pick(s, ['totalDebt', 'total_debt', 'currentDebt', 'current_debt', 'remainingDebt', 'totalBalance']);
  const topStart = pick(s, ['startingDebt', 'starting_debt', 'originalDebt', 'original_debt', 'startDebt', 'start_debt', 'initialDebt', 'totalOriginal']);
  if (remaining == null) remaining = topRem;
  if (start == null || (topStart != null && topStart > start)) start = topStart ?? start;
  if (remaining == null || start == null || !(start > 0)) return null;
  remaining = Math.min(remaining, start);
  const paid = start - remaining;
  const pct = Math.max(0, Math.min(100, Math.round(paid / start * 1000) / 10));
  let debtFree = monthOf(s.debtFreeDate ?? s.debt_free_date ?? s.debtFreeMonth ?? s.payoffDate ?? s.payoff_date ?? s.projectedPayoff ?? s.projected_payoff);
  if (!debtFree && debts.length) {
    const extra = Math.max(0, pick(s, ['extraPayment', 'extra_payment', 'extra', 'snowball']) ?? 0);
    const budget = pick(s, ['monthlyBudget', 'monthly_budget', 'monthlyPayment', 'budget']);
    const monthly = budget != null && budget > 0 ? budget : debts.reduce((a, d) => a + d.min, 0) + extra;
    const m = payoffMonths(debts, monthly);
    if (m != null) { const d = new Date(now.getFullYear(), now.getMonth() + m, 1); debtFree = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  }
  if (remaining <= 0) debtFree = debtFree || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { pct, paid: Math.round(paid * 100) / 100, start: Math.round(start * 100) / 100, remaining: Math.round(remaining * 100) / 100, debtFree, count: debts.length || null };
}

// Returns the summary, or null (panel hidden) when the query is denied, empty,
// throws, or holds nothing we can read.
export async function loadMoneyHQ(sb) {
  try {
    if (!sb || typeof sb.from !== 'function') return null;
    const { data, error } = await sb.from('tracker_state').select('*').limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    return parseTracker(data[0]);
  } catch { return null; }
}

const usd = v => '$' + Math.round(v).toLocaleString('en-US');
export const monthLabel = ym => { if (!ym) return ''; const [y, m] = ym.split('-').map(Number); return `${MONTHS_LONG[m - 1]} ${y}`; };

// Privacy mode (default): progress, percent and debt-free month only — never dollar amounts.
export function moneyPanelHtml(sum, { privacy = true } = {}) {
  if (!sum) return '';
  const pct = sum.pct;
  return `<div class="money">
    <div class="money-top"><span class="money-pct">${pct % 1 ? pct.toFixed(1) : pct}%</span><span class="money-lbl">paid off</span></div>
    <div class="money-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    <div class="money-sub">${sum.remaining <= 0 ? 'Debt-free! 🎉' : sum.debtFree ? `Debt-free by <b>${esc(monthLabel(sum.debtFree))}</b>` : 'Keep going'}${privacy ? '' : ` · ${esc(usd(sum.remaining))} left of ${esc(usd(sum.start))}`}</div>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * Small date helpers for the display
 * ------------------------------------------------------------------ */
export const shortDate = s => { const d = parseDate(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
export const longDate = date => `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()]}, ${MONTHS_LONG[date.getMonth()]} ${date.getDate()}`;
export const ageMinutes = (at, now = Date.now()) => Math.max(0, Math.round((now - at) / 60000));
export { DAY };
