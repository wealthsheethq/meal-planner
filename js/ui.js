// Small UI toolkit: escaping, icons, sheets, toasts and pointer-based drag & drop.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Icons (24px grid, stroke) ---------- */
const P = {
  plan: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h3M7.5 16.5h6"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 22h13"/><path d="M9 7h6"/>',
  cart: '<path d="M3 3.5h2.2l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L21 7.5H6.2"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  jar: '<path d="M7 3.5h10M8 3.5v3M16 3.5v3"/><path d="M6.5 6.5h11A1.5 1.5 0 0 1 19 8v11a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19V8a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.1 3.6 4.5 7.2 4.5c2 0 3.5 1.1 4.8 2.8 1.3-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.6 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.7 2.5 3 5.2"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5M12 2.5V6"/>',
  flame: '<path d="M12 21.5c4 0 7-2.8 7-6.8 0-4.3-3.5-6.5-4.3-10.7C12.5 5.6 11 8 11 10.5 9.6 9.8 8.8 8.4 8.6 7 6.4 9 5 11.6 5 14.7c0 4 3 6.8 7 6.8Z"/>',
  shuffle: '<path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21"/><path d="M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M13.3 8.4C14.1 7.5 15.1 7 16.5 7H21"/><path d="m18 4 3 3-3 3M18 14l3 3-3 3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z"/><circle cx="8" cy="8" r="1.5"/>',
  dollar: '<path d="M12 2.5v19M16.5 6.5c-.8-1.4-2.5-2-4.5-2-2.6 0-4.5 1.3-4.5 3.4 0 4.9 9.5 2.5 9.5 7.7 0 2.1-2 3.5-4.8 3.5-2.2 0-4-.8-4.8-2.4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h1.5l1.5-2h6l1.5 2H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  wifioff: '<path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.6-1.8M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8a15 15 0 0 0-11.1-3.7"/><circle cx="12" cy="20" r=".8"/>',
  sparkle: '<path d="M12 3.5 13.8 9l5.7 1.9-5.7 1.9L12 18.5l-1.8-5.7L4.5 11l5.7-1.9Z"/><path d="M19 3v3M17.5 4.5h3"/>',
  chef: '<path d="M7 14.5V20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5.5"/><path d="M7 14.5a4 4 0 0 1-1.3-7.8A5 5 0 0 1 12 3a5 5 0 0 1 6.3 3.7A4 4 0 0 1 17 14.5Z"/><path d="M7 17.5h10"/>',
  utensils: '<path d="M7 2.5v19M4 2.5v5a3 3 0 0 0 6 0v-5M17 21.5v-19c-2.5 1.4-3.5 4-3.5 7.5 0 2 1.5 3 3.5 3"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  home: '<path d="M3 11 12 3.5 21 11"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9"/><path d="M10 20.5v-5h4v5"/>',
  import: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M4 16.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-4M4 13a8 8 0 0 0 14.8 4"/><path d="M4 3v4h4M20 21v-4h-4"/>',
  store: '<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16v1a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 13.5a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 10.5Z"/><path d="M5.5 13v7.5h13V13"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15Z"/><path d="M5 19 13 11"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 10Z"/>',
};

export function ic(name, size = 22, extra = '') {
  const fill = name === 'more' || name === 'grip' ? 'currentColor' : 'none';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ''}</svg>`;
}

/* ---------- Toasts ---------- */
let toastWrap;
export function toast(msg, undo, ms = 5000) {
  if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className = 'toasts'; toastWrap.setAttribute('role', 'status'); toastWrap.setAttribute('aria-live', 'polite'); document.body.appendChild(toastWrap); }
  for (const old of [...toastWrap.children]) { old.classList.add('out'); setTimeout(() => old.remove(), 200); }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 260); };
  if (undo) t.querySelector('button').onclick = () => { kill(); undo(); };
  toastWrap.appendChild(t);
  setTimeout(kill, undo ? Math.max(ms, 6000) : ms);
}

/* ---------- Sheets (bottom sheet on phones, dialog on desktop) ---------- */
const stack = [];
let popping = false;
let selfBacks = 0; // history.back() calls we made ourselves; their popstate is ignored

function goBack() { selfBacks++; try { history.back(); } catch { selfBacks--; } }

window.addEventListener('popstate', () => {
  if (selfBacks > 0) { selfBacks--; return; }
  const top = stack[stack.length - 1];
  if (top) { popping = true; top.close(true); popping = false; }
});

export function sheetOpen() { return stack.length > 0; }
export function topSheet() { return stack[stack.length - 1]; }

// opts: { title, body: () => html, foot: () => html, full, narrow, actions, onClose, onMount, head }
export function openSheet(opts) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('section');
  el.className = 'sheet' + (opts.full ? ' full' : '') + (opts.narrow ? ' narrow' : '');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (opts.title) el.setAttribute('aria-label', opts.title);
  const sheet = {
    el, opts, actions: opts.actions || {}, closed: false,
    render() {
      const head = opts.head ? opts.head() : `<h2>${esc(typeof opts.title === 'function' ? opts.title() : opts.title || '')}</h2>`;
      el.innerHTML = `<div class="sheet-grab"></div>
        <header class="sheet-head">${head}<button class="icon-btn" data-act="sheet-close" aria-label="Close">${ic('x')}</button></header>
        <div class="sheet-body">${opts.body()}</div>
        ${opts.foot ? `<footer class="sheet-foot">${opts.foot()}</footer>` : ''}`;
      opts.onRender && opts.onRender(sheet);
    },
    refreshBody() {
      const body = el.querySelector('.sheet-body');
      if (!body) return sheet.render();
      const top = body.scrollTop;
      body.innerHTML = opts.body();
      body.scrollTop = top;
      if (opts.foot) { const f = el.querySelector('.sheet-foot'); if (f) f.innerHTML = opts.foot(); }
      const h = el.querySelector('.sheet-head h2');
      if (h && typeof opts.title === 'function') h.textContent = opts.title();
      opts.onRender && opts.onRender(sheet);
    },
    close(fromPop) {
      if (sheet.closed) return;
      sheet.closed = true;
      const i = stack.indexOf(sheet);
      if (i > -1) stack.splice(i, 1);
      el.classList.remove('in');
      scrim.classList.remove('in');
      setTimeout(() => { el.remove(); scrim.remove(); }, 320);
      if (!stack.length) document.body.classList.remove('lock');
      opts.onClose && opts.onClose();
      if (!fromPop && !popping) goBack();
    },
  };
  el._sheet = sheet;
  scrim.addEventListener('click', () => sheet.close());
  sheet.render();
  document.body.append(scrim, el);
  document.body.classList.add('lock');
  stack.push(sheet);
  try { history.pushState({ sheet: stack.length }, ''); } catch { /* ignore */ }
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('in'); scrim.classList.add('in'); }));
  opts.onMount && opts.onMount(sheet);
  return sheet;
}

// Registers a non-sheet overlay (cook mode) so the back button closes it.
export function pushOverlay(close) {
  const o = { closed: false, close(fromPop) { if (o.closed) return; o.closed = true; const i = stack.indexOf(o); if (i > -1) stack.splice(i, 1); close(); if (!fromPop && !popping) goBack(); } };
  stack.push(o);
  try { history.pushState({ overlay: 1 }, ''); } catch { /* ignore */ }
  return o;
}

export function confirmSheet({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet({
      title, narrow: true,
      body: () => `<p class="muted" style="margin:0 0 6px">${esc(message)}</p>`,
      foot: () => `<button class="btn btn-line grow" data-act="no">Cancel</button><button class="btn ${danger ? 'btn-accent' : 'btn-primary'} grow" data-act="yes">${esc(confirm)}</button>`,
      actions: { yes: () => { answered = true; resolve(true); s.close(); }, no: () => { answered = true; resolve(false); s.close(); } },
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/* ---------- Drag & drop (mouse + touch long-press) ---------- */
// Elements with [data-drag="kind:id"] can be dropped on [data-drop="payload"].
export function initDrag(onDrop) {
  let pending = null, drag = null, suppressClick = false;

  const cleanup = () => {
    if (pending && pending.timer) clearTimeout(pending.timer);
    pending = null;
    if (drag) {
      drag.ghost.remove();
      drag.src.classList.remove('dragging-src');
      document.querySelectorAll('.drop-hover').forEach(n => n.classList.remove('drop-hover'));
      document.body.classList.remove('dragging');
      cancelAnimationFrame(drag.raf);
    }
    drag = null;
  };

  const start = (p) => {
    const src = p.el;
    const r = src.getBoundingClientRect();
    const ghost = src.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = Math.min(r.width, 240) + 'px';
    ghost.removeAttribute('data-drag');
    document.body.appendChild(ghost);
    src.classList.add('dragging-src');
    document.body.classList.add('dragging');
    drag = { src, ghost, payload: p.payload, x: p.x, y: p.y, target: null, raf: 0 };
    if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* ignore */ }
    move(p.x, p.y);
    const scrollLoop = () => {
      if (!drag) return;
      const edge = 70, h = window.innerHeight;
      if (drag.y < edge) window.scrollBy(0, -Math.ceil((edge - drag.y) / 5));
      else if (drag.y > h - edge - 60) window.scrollBy(0, Math.ceil((drag.y - (h - edge - 60)) / 5));
      drag.raf = requestAnimationFrame(scrollLoop);
    };
    drag.raf = requestAnimationFrame(scrollLoop);
  };

  const move = (x, y) => {
    drag.x = x; drag.y = y;
    drag.ghost.style.left = x + 'px';
    drag.ghost.style.top = y + 'px';
    const under = document.elementFromPoint(x, y);
    const t = under && under.closest('[data-drop]');
    if (t !== drag.target) {
      if (drag.target) drag.target.classList.remove('drop-hover');
      if (t) t.classList.add('drop-hover');
      drag.target = t;
    }
  };

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('[data-drag]');
    if (!el || e.target.closest('input,textarea,select')) return;
    pending = { el, payload: el.dataset.drag, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, touch: e.pointerType !== 'mouse' };
    if (pending.touch) pending.timer = setTimeout(() => { if (pending) { start(pending); pending = null; } }, 380);
  });
  document.addEventListener('pointermove', (e) => {
    if (drag) { e.preventDefault(); move(e.clientX, e.clientY); return; }
    if (!pending) return;
    const dx = e.clientX - pending.sx, dy = e.clientY - pending.sy;
    const dist = Math.hypot(dx, dy);
    if (pending.touch) { if (dist > 10) cleanup(); return; } // user is scrolling
    if (dist > 6) { pending.x = e.clientX; pending.y = e.clientY; start(pending); pending = null; }
  }, { passive: false });
  // Stop the page from scrolling while a touch drag is active.
  document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (drag || (pending && pending.touch)) e.preventDefault(); });
  const end = (e, cancelled) => {
    if (drag) {
      const target = drag.target, payload = drag.payload;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 60);
      cleanup();
      if (!cancelled && target) onDrop(payload, target.dataset.drop);
      return;
    }
    cleanup();
  };
  document.addEventListener('pointerup', e => end(e, false));
  document.addEventListener('pointercancel', e => end(e, true));
  document.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
}

/* ---------- Image compression for recipe photos ---------- */
export async function compressImage(file, maxBytes = 150 * 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    let maxDim = 1000, q = 0.82, out = '';
    for (let i = 0; i < 14; i++) {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      out = c.toDataURL('image/jpeg', q);
      if (out.length <= maxBytes) return out;
      if (q > 0.55) q -= 0.08; else maxDim = Math.round(maxDim * 0.8);
    }
    return out.length <= maxBytes ? out : '';
  } finally { URL.revokeObjectURL(url); }
}
