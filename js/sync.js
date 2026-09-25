// Offline cache + Supabase sync for the single meal_state JSON document.
//
// Save:     fetch latest row -> merge by entity id -> conditional update (retry on race)
// Pull:     fetch row -> merge into local -> push back if we still hold newer edits
// Realtime: any change to our kitchen's row triggers a pull
import { mergeDocs, needsPush, normalizeDoc, purgeTombstones, emptyDoc } from './core.js';

/* ---------- Tiny IndexedDB key/value store (localStorage fallback) ---------- */
const DB_NAME = 'meal-planner';
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbp;
}
export async function kvGet(key) {
  const d = await db();
  if (!d) { try { const v = localStorage.getItem('mp:' + key); return v ? JSON.parse(v) : undefined; } catch { return undefined; } }
  return new Promise((resolve) => {
    try {
      const req = d.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
export async function kvSet(key, value) {
  const d = await db();
  if (!d) { try { localStorage.setItem('mp:' + key, JSON.stringify(value)); } catch { /* quota */ } return; }
  return new Promise((resolve) => {
    try {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}

/* ---------- Sync engine ---------- */
export class DocSync {
  constructor({ sb, householdId, userId, onChange, onStatus }) {
    this.sb = sb;
    this.hid = householdId;
    this.uid = userId;
    this.onChange = onChange;   // (doc, {remote}) => void
    this.onStatus = onStatus;   // (status) => void
    this.doc = emptyDoc();
    this.dirty = false;
    this.loaded = false;        // true once we've seen the server copy
    this.pushing = null;
    this.pushTimer = null;
    this.pullTimer = null;
    this.channel = null;
    this.status = 'idle';
    this.stopped = false;
  }

  setStatus(s) { if (s !== this.status) { this.status = s; this.onStatus && this.onStatus(s); } }
  get online() { return !!this.sb && (typeof navigator === 'undefined' || navigator.onLine !== false); }

  async loadCache() {
    const c = await kvGet('doc:' + this.hid);
    if (c && c.doc) { this.doc = normalizeDoc(c.doc); this.dirty = !!c.dirty; return true; }
    return false;
  }

  saveCache() {
    clearTimeout(this.cacheTimer);
    this.cacheTimer = setTimeout(() => kvSet('doc:' + this.hid, { doc: this.doc, dirty: this.dirty, at: Date.now() }), 250);
  }

  // Local edit happened: cache it and schedule a save.
  touched(doc) {
    this.doc = doc;
    this.dirty = true;
    this.saveCache();
    this.schedulePush();
  }

  schedulePush(delay = 700) {
    clearTimeout(this.pushTimer);
    if (!this.online) { this.setStatus('offline'); return; }
    this.setStatus('pending');
    this.pushTimer = setTimeout(() => this.push(), delay);
  }

  async fetchRow() {
    const { data, error } = await this.sb.from('meal_state').select('data, updated_at, updated_by').eq('household_id', this.hid).maybeSingle();
    if (error) throw error;
    return data;
  }

  applyRemote(remoteDoc) {
    const merged = purgeTombstones(mergeDocs(this.doc, remoteDoc));
    this.doc = merged;
    this.loaded = true;
    this.dirty = needsPush(merged, remoteDoc);
    this.saveCache();
    this.onChange && this.onChange(merged, { remote: true });
    return this.dirty;
  }

  async pull() {
    if (this.stopped) return;
    if (!this.online) { this.setStatus('offline'); return; }
    if (this.pushing) { this.pullAgain = true; return; }
    try {
      this.setStatus('syncing');
      const row = await this.fetchRow();
      if (this.stopped) return;
      const remote = normalizeDoc(row && row.data);
      if (this.applyRemote(remote)) this.schedulePush(50);
      else this.setStatus('synced');
    } catch (e) {
      console.warn('pull failed', e);
      this.setStatus(this.online ? 'error' : 'offline');
    }
  }

  schedulePull(delay = 250) {
    clearTimeout(this.pullTimer);
    this.pullTimer = setTimeout(() => this.pull(), delay);
  }

  async push() {
    if (this.stopped) return;
    if (this.pushing) { this.pushAgain = true; return this.pushing; }
    if (!this.online) { this.setStatus('offline'); return; }
    this.pushing = (async () => {
      this.setStatus('syncing');
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const row = await this.fetchRow();
          const remote = normalizeDoc(row && row.data);
          const merged = purgeTombstones(mergeDocs(this.doc, remote));
          if (!needsPush(merged, remote)) { this.applyRemote(remote); break; }
          const now = new Date().toISOString();
          let q = this.sb.from('meal_state').update({ data: merged, updated_at: now, updated_by: this.uid }).eq('household_id', this.hid);
          // Compare-and-swap on updated_at so a concurrent save can't be overwritten blindly.
          if (row && row.updated_at && attempt < 4) q = q.eq('updated_at', row.updated_at);
          const { data, error } = await q.select('updated_at');
          if (error) throw error;
          if (!data || !data.length) {
            if (!row) { // no row yet (shouldn't happen: the RPC creates it) — try inserting
              const ins = await this.sb.from('meal_state').insert({ household_id: this.hid, data: merged, updated_at: now, updated_by: this.uid });
              if (ins.error && attempt >= 3) throw ins.error;
            }
            continue; // someone saved in between: fetch + merge again
          }
          // Keep anything edited locally while the request was in flight.
          this.doc = purgeTombstones(mergeDocs(this.doc, merged));
          this.dirty = needsPush(this.doc, merged);
          this.loaded = true;
          this.saveCache();
          this.onChange && this.onChange(this.doc, { remote: true });
          break;
        }
        this.setStatus(this.dirty ? 'pending' : 'synced');
      } catch (e) {
        console.warn('push failed', e);
        this.setStatus(this.online ? 'error' : 'offline');
        if (this.online) { clearTimeout(this.pushTimer); this.pushTimer = setTimeout(() => this.push(), 8000); }
      } finally {
        this.pushing = null;
        if (this.pushAgain || (this.dirty && this.status === 'pending')) { this.pushAgain = false; if (this.dirty) this.schedulePush(300); }
        if (this.pullAgain) { this.pullAgain = false; this.schedulePull(100); }
      }
    })();
    return this.pushing;
  }

  subscribe() {
    if (!this.sb || !this.sb.channel) return;
    this.unsubscribe();
    this.channel = this.sb.channel('meal_state:' + this.hid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_state', filter: `household_id=eq.${this.hid}` }, (payload) => {
        const row = payload && payload.new;
        // Large docs may arrive without data in the payload — fall back to a fetch.
        if (row && row.data && typeof row.data === 'object' && !this.pushing) {
          if (this.applyRemote(normalizeDoc(row.data))) this.schedulePush(200);
          else this.setStatus('synced');
        } else this.schedulePull(150);
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') this.schedulePull(50); });
  }

  unsubscribe() {
    if (this.channel && this.sb) { try { this.sb.removeChannel(this.channel); } catch { /* ignore */ } }
    this.channel = null;
  }

  async flush() { if (this.dirty && this.online) { clearTimeout(this.pushTimer); await this.push(); } }

  stop() {
    this.stopped = true;
    clearTimeout(this.pushTimer); clearTimeout(this.pullTimer);
    this.unsubscribe();
  }
}
