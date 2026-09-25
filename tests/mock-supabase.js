// In-browser mock of the bits of supabase-js v2 the app uses. The "database"
// lives in localStorage so two tabs in one browser context behave like two phones,
// and BroadcastChannel stands in for Realtime.
(function () {
  const ME = { id: 'user-me', email: 'kendall@example.com' };
  const HER = { id: 'user-her', email: 'sam@example.com' };
  const HID = 'kitchen-1';
  const cfg = JSON.parse(localStorage.getItem('mockcfg') || '{}');
  const load = () => {
    let db = JSON.parse(localStorage.getItem('mockdb') || 'null');
    if (!db) {
      db = cfg.noKitchen ? { meal_households: [], meal_members: [], meal_state: [], meal_invites: [] } : {
        meal_households: [{ id: HID, name: 'Our Kitchen', created_by: ME.id, created_at: '2026-09-01T00:00:00Z' }],
        meal_members: [
          { household_id: HID, user_id: ME.id, email: ME.email, role: 'owner', joined_at: '2026-09-01T00:00:00Z' },
          { household_id: HID, user_id: HER.id, email: HER.email, role: 'member', joined_at: '2026-09-02T00:00:00Z' },
        ],
        meal_state: [{ household_id: HID, data: {}, updated_at: '2026-09-01T00:00:00.000Z', updated_by: ME.id }],
        meal_invites: [{ household_id: HID, email: 'friend@example.com', invited_by: ME.id, created_at: '2026-09-20T00:00:00Z' }],
      };
      localStorage.setItem('mockdb', JSON.stringify(db));
    }
    return db;
  };
  const save = db => localStorage.setItem('mockdb', JSON.stringify(db));
  const rt = new BroadcastChannel('mock-realtime');
  const delay = v => new Promise(r => setTimeout(() => r(v), 15));
  window.__mockStats = { updates: 0, selects: 0 };

  class Query {
    constructor(table) { this.t = table; this.f = []; this.op = 'select'; this.ret = false; this.one = false; }
    select() { if (this.op !== 'select') this.ret = true; return this; }
    eq(c, v) { this.f.push([c, v]); return this; }
    order() { return this; }
    maybeSingle() { this.one = true; return this; }
    update(p) { this.op = 'update'; this.p = p; return this; }
    insert(p) { this.op = 'insert'; this.p = p; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return delay().then(() => this.exec()).then(res, rej); }
    exec() {
      const db = load();
      const rows = db[this.t] || [];
      const match = r => this.f.every(([c, v]) => r[c] === v);
      if (this.op === 'select') {
        window.__mockStats.selects++;
        const out = rows.filter(match).map(r => JSON.parse(JSON.stringify(r)));
        return { data: this.one ? (out[0] || null) : out, error: null };
      }
      if (this.op === 'update') {
        const hit = rows.filter(match);
        hit.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(this.p))));
        save(db);
        if (this.t === 'meal_state') { window.__mockStats.updates++; hit.forEach(r => rt.postMessage({ table: this.t, new: r })); }
        return { data: this.ret ? hit : null, error: null };
      }
      if (this.op === 'insert') {
        const list = Array.isArray(this.p) ? this.p : [this.p];
        if (this.t === 'meal_invites' && list.some(n => rows.some(r => r.household_id === n.household_id && r.email === n.email))) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        list.forEach(n => rows.push({ created_at: new Date().toISOString(), ...n }));
        db[this.t] = rows; save(db);
        return { data: this.ret ? list : null, error: null };
      }
      if (this.op === 'delete') {
        db[this.t] = rows.filter(r => !match(r)); save(db);
        return { data: null, error: null };
      }
    }
  }

  function createClient() {
    const listeners = [];
    const user = cfg.signedOut ? null : ME;
    return {
      auth: {
        getSession: async () => ({ data: { session: user ? { user } : null }, error: null }),
        onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOtp: async ({ email }) => delay(email.includes('nobody') ? { error: { message: 'Signups not allowed for otp' } } : { error: null }),
        signOut: async () => { listeners.forEach(cb => cb('SIGNED_OUT', null)); return { error: null }; },
      },
      from: (t) => new Query(t),
      rpc: async (name, args) => {
        await delay();
        const db = load();
        if (name === 'accept_meal_invites') return { data: [], error: null };
        if (name === 'create_meal_household') {
          const id = 'kitchen-' + Math.random().toString(36).slice(2, 8);
          db.meal_households.push({ id, name: args.p_name, created_by: ME.id, created_at: new Date().toISOString() });
          db.meal_members.push({ household_id: id, user_id: ME.id, email: ME.email, role: 'owner', joined_at: new Date().toISOString() });
          db.meal_state.push({ household_id: id, data: {}, updated_at: new Date().toISOString(), updated_by: ME.id });
          save(db);
          return { data: id, error: null };
        }
        return { data: null, error: { message: 'unknown rpc' } };
      },
      channel: (name) => {
        const ch = { handlers: [], bc: null,
          on(type, filter, cb) { this.handlers.push({ filter, cb }); return this; },
          subscribe(cb) {
            this.bc = new BroadcastChannel('mock-realtime');
            this.bc.onmessage = (ev) => {
              for (const h of this.handlers) {
                const want = (h.filter.filter || '').split('=eq.')[1];
                if (ev.data.table === h.filter.table && (!want || ev.data.new.household_id === want)) h.cb({ eventType: 'UPDATE', new: ev.data.new });
              }
            };
            setTimeout(() => cb && cb('SUBSCRIBED'), 10);
            return this;
          },
        };
        return ch;
      },
      removeChannel: (ch) => { if (ch && ch.bc) ch.bc.close(); },
    };
  }
  window.supabase = { createClient };
})();
