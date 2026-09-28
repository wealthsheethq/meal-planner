import test from 'node:test';
import assert from 'node:assert/strict';
import { stamp, mergeDocs, emptyDoc, needsPush, normalizeDoc, readCountdown, readNote } from '../js/core.js';
import {
  nextOccurrence, countdownText, upcomingCountdowns, sceneAt, isNightTime, themeFor, dayPart, greeting, breakfastDate,
  msUntilHour, burnInShift, formatClock, parseWeather, describeWeather, weatherUrl, parseGeocode, noteActive, activeNotes,
  readDisplaySettings, DISPLAY_DEFAULTS, PIN_MS, parseTracker, loadMoneyHQ, moneyPanelHtml, weatherIcon,
} from '../js/display-core.js';

const at = (s, h = 12, m = 0) => { const [y, mo, d] = s.split('-').map(Number); return new Date(y, mo - 1, d, h, m); };

/* ---------- Countdowns ---------- */
test('one-off countdowns count down and disappear once passed', () => {
  const trip = { id: 'c1', title: 'Beach trip', date: '2026-10-10', emoji: '🏖️', yearly: false };
  assert.deepEqual(nextOccurrence(trip, '2026-09-28'), { date: '2026-10-10', days: 12, years: null });
  assert.equal(nextOccurrence(trip, '2026-10-10').days, 0);
  assert.equal(nextOccurrence(trip, '2026-10-11'), null);
});

test('yearly countdowns roll to next year and count the years', () => {
  const bday = { id: 'b', title: "Sam's birthday", date: '1994-03-15', yearly: true };
  assert.deepEqual(nextOccurrence(bday, '2026-09-28'), { date: '2027-03-15', days: 168, years: 33 });
  assert.deepEqual(nextOccurrence(bday, '2026-03-15'), { date: '2026-03-15', days: 0, years: 32 });
  assert.equal(nextOccurrence(bday, '2026-03-16').date, '2027-03-15');
  // Across the new year
  const nye = { id: 'n', title: 'Anniversary', date: '2020-01-02', yearly: true };
  assert.deepEqual(nextOccurrence(nye, '2026-12-31'), { date: '2027-01-02', days: 2, years: 7 });
  // A yearly event whose first date is still in the future counts down to it
  assert.deepEqual(nextOccurrence({ title: 'Wedding', date: '2027-06-05', yearly: true }, '2026-09-28'), { date: '2027-06-05', days: 250, years: 0 });
});

test('leap day birthdays fall on Feb 28 in non-leap years', () => {
  const leap = { id: 'l', title: 'Leap baby', date: '2000-02-29', yearly: true };
  assert.equal(nextOccurrence(leap, '2026-09-28').date, '2027-02-28');
  assert.equal(nextOccurrence(leap, '2027-03-01').date, '2028-02-29');
  assert.equal(nextOccurrence(leap, '2028-02-29').days, 0);
  assert.equal(nextOccurrence(leap, '2100-01-01').date, '2100-02-28'); // 2100 is not a leap year
});

test('today / tomorrow wording', () => {
  assert.equal(countdownText(0), 'Today');
  assert.equal(countdownText(1), 'Tomorrow');
  assert.equal(countdownText(2), 'in 2 days');
  assert.equal(countdownText(9), 'in 1 week');
  assert.equal(countdownText(21), 'in 3 weeks');
  assert.equal(countdownText(120), 'in 120 days');
  const list = upcomingCountdowns([
    { id: 'a', title: 'Trip', date: '2026-09-29' },
    { id: 'b', title: 'Mom', date: '1960-09-28', yearly: true, emoji: '🎂' },
    { id: 'c', title: 'Old', date: '2026-01-01' },
    { id: 'd', title: 'Gone', date: '2026-10-01', deleted: true },
    { id: 'e', title: '', date: '2026-10-01' },
    { id: 'f', title: 'Bad date', date: '2026-13-01' },
  ], '2026-09-28');
  assert.deepEqual(list.map(c => [c.title, c.when, c.milestone]), [['Mom', 'Today', '66th'], ['Trip', 'Tomorrow', '']]);
  assert.equal(readCountdown({ title: 'x', date: '2026-01-01' }).emoji, '📅');
});

/* ---------- Scenes + night mode ---------- */
test('scenes rotate on the clock and a tap pins one for two minutes', () => {
  const scenes = ['tonight', 'groceries', 'week', 'weather'];
  assert.equal(sceneAt(0, scenes, 20), 'tonight');
  assert.equal(sceneAt(19999, scenes, 20), 'tonight');
  assert.equal(sceneAt(20000, scenes, 20), 'groceries');
  assert.equal(sceneAt(60000, scenes, 20), 'weather');
  assert.equal(sceneAt(80000, scenes, 20), 'tonight');
  const pin = { scene: 'week', until: 1000 + PIN_MS };
  assert.equal(sceneAt(1000, scenes, 20, pin), 'week');
  assert.equal(sceneAt(1000 + PIN_MS - 1, scenes, 20, pin), 'week');
  assert.equal(sceneAt(1000 + PIN_MS, scenes, 20, pin), sceneAt(1000 + PIN_MS, scenes, 20));
  assert.equal(sceneAt(5000, ['groceries'], 20), 'groceries');
  assert.equal(sceneAt(999999, scenes, 0), 'tonight'); // rotation off
  assert.equal(sceneAt(0, scenes, 20, { scene: 'nope', until: 1e12 }), 'tonight'); // pin to a hidden scene is ignored
  assert.equal(PIN_MS, 120000);
});

test('night mode windows, including ones that wrap past midnight', () => {
  const s = { nightOn: true, nightStart: '22:00', nightEnd: '06:00' };
  assert.equal(isNightTime(at('2026-09-28', 21, 59), s), false);
  assert.equal(isNightTime(at('2026-09-28', 22, 0), s), true);
  assert.equal(isNightTime(at('2026-09-28', 2, 30), s), true);
  assert.equal(isNightTime(at('2026-09-28', 5, 59), s), true);
  assert.equal(isNightTime(at('2026-09-28', 6, 0), s), false);
  const day = { nightOn: true, nightStart: '01:00', nightEnd: '05:30' };
  assert.equal(isNightTime(at('2026-09-28', 0, 59), day), false);
  assert.equal(isNightTime(at('2026-09-28', 3, 0), day), true);
  assert.equal(isNightTime(at('2026-09-28', 5, 30), day), false);
  assert.equal(isNightTime(at('2026-09-28', 23, 0), { ...s, nightOn: false }), false);
  assert.equal(isNightTime(at('2026-09-28', 23, 0), { nightOn: true, nightStart: '22:00', nightEnd: '22:00' }), false);
});

test('time-of-day themes, greetings and the breakfast shown at night', () => {
  const s = DISPLAY_DEFAULTS;
  assert.deepEqual([7, 13, 19, 23, 3].map(h => themeFor(at('2026-09-28', h), s)), ['morning', 'afternoon', 'evening', 'night', 'night']);
  assert.equal(themeFor(at('2026-09-28', 23), { ...s, nightOn: false }), 'evening');
  assert.deepEqual([7, 13, 19, 23].map(h => dayPart(at('2026-09-28', h))), ['morning', 'afternoon', 'evening', 'late']);
  assert.equal(greeting(at('2026-09-28', 8)), 'Good morning');
  assert.equal(greeting(at('2026-09-28', 18)), 'Good evening');
  assert.equal(breakfastDate(at('2026-09-28', 22)), '2026-09-29');
  assert.equal(breakfastDate(at('2026-09-29', 2)), '2026-09-29');
});

test('nightly reload, burn-in shift and clock formatting', () => {
  assert.equal(msUntilHour(at('2026-09-28', 2, 0).getTime(), 3), 3600000);
  assert.equal(msUntilHour(at('2026-09-28', 3, 0).getTime(), 3), 86400000);
  assert.equal(msUntilHour(at('2026-09-28', 23, 0).getTime(), 3), 4 * 3600000);
  const a = burnInShift(0), b = burnInShift(3 * 60000);
  assert.notDeepEqual(a, b);
  for (let t = 0; t < 24 * 3600000; t += 97 * 60000) { const [x, y] = burnInShift(t); assert.ok(Math.abs(x) <= 6 && Math.abs(y) <= 6); }
  assert.deepEqual(formatClock(at('2026-09-28', 0, 5), false), { time: '12:05', ampm: 'AM' });
  assert.deepEqual(formatClock(at('2026-09-28', 13, 7), false), { time: '1:07', ampm: 'PM' });
  assert.deepEqual(formatClock(at('2026-09-28', 9, 30), true), { time: '09:30', ampm: '' });
});

test('display settings read with safe defaults', () => {
  assert.deepEqual(readDisplaySettings({}), DISPLAY_DEFAULTS);
  const set = (id, value) => ({ ['display.' + id]: { id: 'display.' + id, value } });
  const s = readDisplaySettings({ ...set('place', { name: 'Asheville, NC', lat: 35.6, lon: -82.55 }), ...set('rotateSec', 30), ...set('scenes', ['week', 'bogus']), ...set('nightStart', '9pm'), ...set('clock24', true), ...set('money', true), ...set('temp', 'c') });
  assert.deepEqual([s.place.name, s.rotateSec, s.scenes, s.nightStart, s.clock24, s.money, s.moneyPrivacy, s.temp], ['Asheville, NC', 30, ['week'], '22:00', true, true, true, 'c']);
  assert.deepEqual(readDisplaySettings({ ...set('place', { lat: 999, lon: 0 }), ...set('scenes', []), ...set('rotateSec', 7) }).place, DISPLAY_DEFAULTS.place);
  assert.deepEqual(readDisplaySettings({ ...set('scenes', []) }).scenes, DISPLAY_DEFAULTS.scenes);
});

/* ---------- Weather ---------- */
const OPEN_METEO = {
  latitude: 35.23, longitude: -80.84, timezone: 'America/New_York',
  current_units: { temperature_2m: '°F', wind_speed_10m: 'mp/h' },
  current: { time: '2026-09-28T19:45', temperature_2m: 71.6, apparent_temperature: 72.4, relative_humidity_2m: 64, weather_code: 2, is_day: 0, wind_speed_10m: 5.8 },
  daily: {
    time: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'],
    weather_code: [2, 61, 95, 0, 3, 71],
    temperature_2m_max: [78.1, 70.2, 68.9, 75.5, 74, 40],
    temperature_2m_min: [60.4, 58.9, 55.1, 52, 54.6, 30],
    precipitation_probability_max: [10, 80, 65, 0, 5, 50],
    sunrise: ['2026-09-28T07:13'], sunset: ['2026-09-28T19:12'],
  },
};

test('weather response parsing', () => {
  const w = parseWeather(OPEN_METEO, 123);
  assert.deepEqual(w.current, { temp: 72, feels: 72, humidity: 64, wind: 6, code: 2, isDay: false, label: 'Partly cloudy', icon: 'partly-night' });
  assert.equal(w.days.length, 6);
  assert.deepEqual(w.days[1], { date: '2026-09-29', hi: 70, lo: 59, pop: 80, code: 61, label: 'Light rain', icon: 'rain' });
  assert.equal(w.days[2].icon, 'storm');
  assert.equal(w.days[5].icon, 'snow');
  assert.deepEqual([w.unit, w.windUnit, w.at, w.sunset], ['F', 'mph', 123, '2026-09-28T19:12']);
  assert.equal(parseWeather(null), null);
  assert.equal(parseWeather({ error: true, reason: 'bad' }), null);
  assert.equal(parseWeather({ current: {} }), null);
  // Missing daily values are skipped, unknown codes don't crash
  const partial = parseWeather({ current: { temperature_2m: 20, weather_code: 42 }, current_units: { temperature_2m: '°C' }, daily: { time: ['2026-09-28', 'junk'], temperature_2m_max: [25, 1], temperature_2m_min: [null, 1] } });
  assert.deepEqual([partial.current.label, partial.days.length, partial.unit, partial.windUnit], ['—', 0, 'C', 'km/h']);
  assert.deepEqual(describeWeather(0, true), { label: 'Clear', icon: 'clear' });
  assert.match(weatherUrl({ lat: 35.2271, lon: -80.8431 }), /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=35\.2271&longitude=-80\.8431.*temperature_unit=fahrenheit/);
  assert.match(weatherUrl({ lat: 1, lon: 2 }, 'c'), /temperature_unit=celsius/);
  for (const k of ['clear', 'clear-night', 'partly', 'partly-night', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'storm']) assert.match(weatherIcon(k), /^<svg[^>]*>.+<\/svg>$/);
  assert.deepEqual(parseGeocode({ results: [{ name: 'Charlotte', latitude: 35.22709, longitude: -80.84313, admin1_code: 'NC', country_code: 'US' }, { name: 'x' }] }), [{ name: 'Charlotte, NC', lat: 35.2271, lon: -80.8431 }]);
  assert.deepEqual(parseGeocode({}), []);
});

/* ---------- Notes ---------- */
test('notes show through their expiry day, then hide', () => {
  const n = { id: 'n1', text: 'Pizza Friday!', expires: '2026-09-30', createdAt: 5 };
  assert.equal(noteActive(n, '2026-09-29'), true);
  assert.equal(noteActive(n, '2026-09-30'), true);
  assert.equal(noteActive(n, '2026-10-01'), false);
  assert.equal(noteActive({ id: 'n2', text: 'No expiry' }, '2030-01-01'), true);
  assert.equal(noteActive({ id: 'n3', text: 'bad date', expires: 'soon' }, '2030-01-01'), true);
  assert.equal(noteActive({ id: 'n4', text: '   ' }, '2026-09-29'), false);
  assert.equal(noteActive({ id: 'n5', text: 'gone', deleted: true }, '2026-09-29'), false);
  const list = activeNotes([n, { id: 'n6', text: 'Newer', createdAt: 9 }, { id: 'n7', text: 'Old', expires: '2026-01-01' }], '2026-09-29');
  assert.deepEqual(list.map(x => x.text), ['Newer', 'Pizza Friday!']);
  assert.equal(readNote({ text: 'hi', updatedBy: 'u1' }).by, 'u1');
});

/* ---------- Merge of the new collections ---------- */
test('countdowns and notes merge like every other collection', () => {
  const base = stamp(null, { id: 'c1', title: 'Trip', date: '2026-10-10', emoji: '✈️', yearly: false }, 'me', 1000);
  const a = emptyDoc(), b = emptyDoc();
  a.countdowns.c1 = stamp(base, { title: 'Beach trip' }, 'me', 2000);
  b.countdowns.c1 = stamp(base, { emoji: '🏖️' }, 'her', 1500);
  a.notes.n1 = stamp(null, { id: 'n1', text: 'Buy candles', expires: null }, 'me', 1100);
  b.notes.n2 = stamp(null, { id: 'n2', text: 'Dentist 3pm', expires: '2026-09-30' }, 'her', 1200);
  const ab = mergeDocs(a, b), ba = mergeDocs(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual([ab.countdowns.c1.title, ab.countdowns.c1.emoji], ['Beach trip', '🏖️']);
  assert.deepEqual(Object.keys(ab.notes).sort(), ['n1', 'n2']);
  assert.equal(needsPush(ab, b), true);
  assert.equal(needsPush(ab, ab), false);
  // Delete wins over a stale copy; a newer undelete can bring it back
  const del = emptyDoc(); del.notes.n2 = stamp(b.notes.n2, { deleted: true }, 'me', 3000);
  assert.equal(mergeDocs(del, b).notes.n2.deleted, true);
  const undo = emptyDoc(); undo.notes.n2 = stamp(del.notes.n2, { deleted: false }, 'her', 4000);
  assert.equal(mergeDocs(del, undo).notes.n2.deleted, false);
  // Documents from before this version gain empty collections
  const old = normalizeDoc({ recipes: {}, plan: {} });
  assert.deepEqual([old.countdowns, old.notes], [{}, {}]);
});

/* ---------- Money HQ ---------- */
const deniedSb = (resp) => ({ from: (t) => { assert.equal(t, 'tracker_state'); return { select: () => ({ limit: async () => resp }) }; } });

test('Money HQ stays hidden when the query is denied, empty or unreadable', async () => {
  assert.equal(await loadMoneyHQ(deniedSb({ data: null, error: { code: '42501', message: 'permission denied for table tracker_state' } })), null);
  assert.equal(await loadMoneyHQ(deniedSb({ data: [], error: null })), null); // RLS filters every row out
  assert.equal(await loadMoneyHQ(deniedSb({ data: [{ data: { hello: 'world' } }], error: null })), null);
  assert.equal(await loadMoneyHQ({ from: () => { throw new Error('offline'); } }), null);
  assert.equal(await loadMoneyHQ({ from: () => ({ select: () => ({ limit: () => Promise.reject(new Error('network')) }) }) }), null);
  assert.equal(await loadMoneyHQ(null), null);
  assert.equal(moneyPanelHtml(null), '');
});

test('Money HQ reads progress without ever writing, and privacy mode hides dollars', async () => {
  const calls = [];
  const row = { data: { debts: [
    { name: 'Card', balance: 1500, originalBalance: 5000, apr: 22.9, minPayment: 100 },
    { name: 'Car', balance: 6000, startingBalance: 10000, apr: 0.05, minPayment: 300 },
    { name: 'Old card', balance: 0, originalBalance: 1000, paidOff: true },
  ], extraPayment: 200 } };
  const sb = { from: (t) => { calls.push(['from', t]); return { select: (c) => { calls.push(['select', c]); return { limit: async (n) => { calls.push(['limit', n]); return { data: [row], error: null }; } }; }, update: () => { throw new Error('must not write'); }, insert: () => { throw new Error('must not write'); }, upsert: () => { throw new Error('must not write'); } }; } };
  const sum = await loadMoneyHQ(sb);
  assert.deepEqual(calls, [['from', 'tracker_state'], ['select', '*'], ['limit', 1]]);
  assert.deepEqual([sum.start, sum.remaining, sum.pct], [16000, 7500, 53.1]);
  assert.match(sum.debtFree, /^\d{4}-\d{2}$/);
  const priv = moneyPanelHtml(sum, { privacy: true });
  assert.ok(!priv.includes('$'), 'privacy mode shows no dollar amounts');
  assert.match(priv, /53\.1%/);
  assert.match(priv, /Debt-free by/);
  assert.match(moneyPanelHtml(sum, { privacy: false }), /\$7,500 left of \$16,000/);
  // Top-level totals + an explicit debt-free date also work
  const t = parseTracker({ state: JSON.stringify({ totalDebt: 2500, startingDebt: 10000, debtFreeDate: '2027-08-01' }) });
  assert.deepEqual([t.pct, t.debtFree], [75, '2027-08']);
});
