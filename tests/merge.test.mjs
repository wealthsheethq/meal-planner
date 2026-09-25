import test from 'node:test';
import assert from 'node:assert/strict';
import { stamp, mergeDocs, mergeEntity, needsPush, emptyDoc, normalizeDoc, purgeTombstones, live } from '../js/core.js';

const doc = (col, ...ents) => { const d = emptyDoc(); for (const e of ents) d[col][e.id] = e; return d; };

test('new entities from both sides are kept', () => {
  const a = doc('recipes', stamp(null, { id: 'r1', title: 'Tacos' }, 'me', 1000));
  const b = doc('recipes', stamp(null, { id: 'r2', title: 'Soup' }, 'her', 1001));
  const m = mergeDocs(a, b);
  assert.deepEqual(Object.keys(m.recipes).sort(), ['r1', 'r2']);
});

test('same field edited on both phones: newer write wins', () => {
  const base = stamp(null, { id: 'r1', title: 'Tacos', servings: 4 }, 'me', 1000);
  const mine = stamp(base, { title: 'Fish Tacos' }, 'me', 2000);
  const hers = stamp(base, { title: 'Shrimp Tacos' }, 'her', 3000);
  assert.equal(mergeEntity(mine, hers).title, 'Shrimp Tacos');
  assert.equal(mergeEntity(hers, mine).title, 'Shrimp Tacos');
});

test('different fields edited concurrently: both edits survive', () => {
  const base = stamp(null, { id: 'g1', name: 'Milk', qty: 1, checked: false }, 'me', 1000);
  const mine = stamp(base, { qty: 2 }, 'me', 2000);        // I bump the qty
  const hers = stamp(base, { checked: true }, 'her', 1500);  // she checks it off (older clock)
  const m = mergeEntity(mine, hers);
  assert.equal(m.qty, 2);
  assert.equal(m.checked, true);
  assert.equal(m.updatedAt, 2000);
  assert.equal(m.updatedBy, 'me');
});

test('merge is commutative, associative and idempotent', () => {
  const base = stamp(null, { id: 'x', a: 1, b: 1, c: 1 }, 'me', 10);
  const e1 = stamp(base, { a: 2 }, 'me', 20);
  const e2 = stamp(base, { b: 3 }, 'her', 30);
  const e3 = stamp(base, { c: 4, a: 9 }, 'her', 15);
  const d = e => doc('plan', e);
  const ab = mergeDocs(d(e1), d(e2)), ba = mergeDocs(d(e2), d(e1));
  assert.deepEqual(ab, ba);
  const abc = mergeDocs(mergeDocs(d(e1), d(e2)), d(e3));
  assert.deepEqual(abc, mergeDocs(d(e1), mergeDocs(d(e2), d(e3))));
  assert.deepEqual(mergeDocs(ab, ab), ab);
  const x = abc.plan.x;
  assert.equal(x.a, 2); assert.equal(x.b, 3); assert.equal(x.c, 4);
});

test('equal clocks resolve deterministically', () => {
  const a = stamp(null, { id: 'e', title: 'A' }, 'me', 50);
  const b = stamp(null, { id: 'e', title: 'B' }, 'her', 50);
  assert.deepEqual(mergeEntity(a, b), mergeEntity(b, a));
});

test('deletes are tombstones that win over older edits', () => {
  const base = stamp(null, { id: 'r1', title: 'Chili' }, 'me', 1000);
  const deleted = stamp(base, { deleted: true }, 'me', 3000);
  const stale = stamp(base, { title: 'Chili!' }, 'her', 2000);
  const m = mergeDocs(doc('recipes', deleted), doc('recipes', stale));
  assert.equal(m.recipes.r1.deleted, true);
  assert.equal(live(m.recipes).length, 0);
  // a tombstone missing on one side is still carried over
  assert.equal(mergeDocs(doc('recipes', deleted), emptyDoc()).recipes.r1.deleted, true);
});

test('an undo (undelete) newer than the delete restores the entity', () => {
  const base = stamp(null, { id: 'r1', title: 'Chili' }, 'me', 1000);
  const del = stamp(base, { deleted: true }, 'me', 2000);
  const undo = stamp(del, { deleted: false }, 'me', 2500);
  const m = mergeDocs(doc('recipes', del), doc('recipes', undo));
  assert.equal(m.recipes.r1.deleted, false);
  assert.equal(m.recipes.r1.title, 'Chili');
});

test('stamp always moves the clock forward even if the phone clock is behind', () => {
  const e = stamp(null, { id: 'a', v: 1 }, 'me', 5000);
  const e2 = stamp(e, { v: 2 }, 'me', 100); // clock skew
  assert.ok(e2.updatedAt > e.updatedAt);
  assert.equal(mergeEntity(e, e2).v, 2);
});

test('legacy entities without field clocks merge by updatedAt', () => {
  const a = { id: 'p', name: 'Rice', updatedAt: 10, updatedBy: 'me', deleted: false };
  const b = { id: 'p', name: 'Brown rice', updatedAt: 20, updatedBy: 'her', deleted: false };
  assert.equal(mergeEntity(a, b).name, 'Brown rice');
  const c = stamp(a, { low: true }, 'me', 30);
  const m = mergeEntity(c, b);
  assert.equal(m.name, 'Brown rice');
  assert.equal(m.low, true);
});

test('needsPush detects local-only changes and converges after merge', () => {
  const remote = doc('grocery', stamp(null, { id: 'g', name: 'Eggs', checked: false }, 'her', 100));
  assert.equal(needsPush(remote, remote), false);
  const local = mergeDocs(remote, emptyDoc());
  local.grocery.g = stamp(local.grocery.g, { checked: true }, 'me', 200);
  assert.equal(needsPush(local, remote), true);
  const merged = mergeDocs(local, remote);
  assert.equal(needsPush(remote, merged), false);
  assert.equal(needsPush(merged, merged), false);
});

test('simulated concurrent session: nothing is lost', () => {
  // Both phones start from the same server doc, edit offline, then sync in either order.
  let server = emptyDoc();
  server.recipes.r = stamp(null, { id: 'r', title: 'Pasta', rating: 3 }, 'me', 10);
  let me = structuredClone(server), her = structuredClone(server);
  me.recipes.r = stamp(me.recipes.r, { rating: 5 }, 'me', 20);
  me.plan.p1 = stamp(null, { id: 'p1', date: '2026-09-27', slot: 'dinner', recipeId: 'r' }, 'me', 21);
  her.recipes.r = stamp(her.recipes.r, { notes: 'extra garlic' }, 'her', 22);
  her.grocery.g1 = stamp(null, { id: 'g1', name: 'Basil' }, 'her', 23);
  // me saves: fetch latest, merge, write
  server = mergeDocs(server, me);
  // her save happened against an older fetch; she merges with the latest before writing
  server = mergeDocs(server, her);
  // me receives the realtime update
  me = mergeDocs(me, server);
  her = mergeDocs(her, server);
  assert.deepEqual(me, her);
  assert.equal(server.recipes.r.rating, 5);
  assert.equal(server.recipes.r.notes, 'extra garlic');
  assert.ok(server.plan.p1 && server.grocery.g1);
});

test('normalizeDoc repairs missing or array collections', () => {
  const d = normalizeDoc({ recipes: [{ id: 'a', title: 'x' }], plan: null });
  assert.equal(d.recipes.a.title, 'x');
  assert.deepEqual(d.plan, {});
  assert.deepEqual(normalizeDoc(null).grocery, {});
});

test('old tombstones are purged, recent ones kept', () => {
  const d = emptyDoc();
  d.recipes.old = { id: 'old', deleted: true, updatedAt: 0 };
  d.recipes.recent = { id: 'recent', deleted: true, updatedAt: Date.now() };
  const p = purgeTombstones(d);
  assert.ok(!p.recipes.old);
  assert.ok(p.recipes.recent);
});
