// Tiny UI toolkit: hyperscript, api client, toast/modal (slide+clip, never opacity), formatting.
// append/prepend/replaceChildren would print "null"/"false" and "[object]" lists; make them ignore empty values and flatten arrays.
for (const m of ['append', 'prepend', 'replaceChildren']) {
  for (const P of [Element.prototype, DocumentFragment.prototype]) {
    const orig = P[m];
    P[m] = function (...a) { return orig.apply(this, a.flat(9).filter((x) => x != null && x !== false)); };
  }
}
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const EASE = 'cubic-bezier(.2,.8,.2,1)';
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run fn when an animation ends, or after ms anyway (animations stall in background/hidden tabs; the UI must never wait on them). */
export function whenDone(anim, fn, ms = 600) {
  let done = false;
  const run = () => { if (!done) { done = true; fn(); } };
  anim.onfinish = run;
  setTimeout(run, ms + 150);
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? (k.startsWith('aria-') ? 'true' : '') : v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
export const html = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstElementChild; };

/* ---------- api ---------- */
export const session = {
  get token() { return localStorage.getItem('tk'); },
  set token(v) { v ? localStorage.setItem('tk', v) : localStorage.removeItem('tk'); },
  user: null,
};
export class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data || {}; } }
export async function api(method, url, body, opts = {}) {
  const res = await fetch('/api' + url, {
    method, headers: { 'content-type': 'application/json', ...(session.token ? { authorization: 'Bearer ' + session.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !opts.quiet) { session.token = null; location.hash = '#/login'; }
    if (res.status === 403 && data?.must_change_pwd) location.hash = '#/password';
    throw new ApiError(data?.error || `请求失败(${res.status})`, res.status, data);
  }
  return data;
}
export const GET = (u) => api('GET', u);
export const POST = (u, b = {}) => api('POST', u, b);
export const PUT = (u, b = {}) => api('PUT', u, b);
export const PATCH = (u, b = {}) => api('PATCH', u, b);
export const DEL = (u) => api('DELETE', u);
export const qs = (o) => '?' + Object.entries(o).filter(([, v]) => v !== '' && v != null && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export function fileToB64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
}
export async function download(url, name) {
  const res = await fetch('/api' + url, { headers: { authorization: 'Bearer ' + session.token } });
  if (!res.ok) { toast('导出失败', true); return; }
  const blob = await res.blob();
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
}
export async function openHtml(url) { // print-ready pages need the auth header, so fetch then write into a new tab
  const w = window.open('', '_blank');
  const res = await fetch('/api' + url, { headers: { authorization: 'Bearer ' + session.token } });
  const text = await res.text();
  if (!res.ok) { w?.close(); toast('生成失败', true); return; }
  w.document.open(); w.document.write(text); w.document.close();
}

/* ---------- toast / modal ---------- */
export function toast(msg, isErr = false) {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, h('span', {}, msg));
  box.append(t);
  const inner = t.firstChild;
  if (!RM()) inner.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }], { duration: 500, easing: EASE });
  setTimeout(() => {
    if (RM()) return t.remove();
    whenDone(inner.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-110%)' }], { duration: 400, easing: EASE, fill: 'both' }), () => t.remove(), 400);
  }, isErr ? 4200 : 2400);
}
export const fail = (e) => toast(e?.message || String(e), true);

export function modal(content, { wide = false, onClose } = {}) {
  const bg = h('div', { class: 'modal-bg', role: 'dialog', 'aria-modal': 'true' });
  const box = h('div', { class: 'modal' + (wide ? ' wide' : '') });
  const x = h('button', { class: 'x box lbl', 'aria-label': '关闭' }, '关闭');
  box.append(x, content); bg.append(box); document.body.append(bg);
  const prevFocus = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', key);
    const done = () => { bg.remove(); prevFocus?.focus?.(); onClose?.(); };
    if (RM()) return done();
    whenDone(box.animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 100% 0)' }], { duration: 280, easing: EASE, fill: 'both' }), done, 280);
  };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  x.addEventListener('click', close);
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(); });
  if (!RM()) box.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 380, easing: EASE });
  setTimeout(() => (box.querySelector('input,textarea,select,.btn.pri,button:not(.x)') || x).focus({ preventScroll: true }), 60);
  return { close, box };
}
export function confirmBox(title, text, { ok = '确定', cancel = '取消', danger = false } = {}) {
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    const m = modal(h('div', {}, h('h2', {}, title), h('p', { class: 'cn' }, text),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:20px' },
        h('button', { class: 'btn', onclick: () => { finish(false); m.close(); } }, cancel),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'pri'), onclick: () => { finish(true); m.close(); } }, ok))), { onClose: () => finish(false) });
  });
}

/* ---------- animations: text rises through a mask (the caption/detail idiom) ---------- */
export function riseIn(els, { delay = 0, gap = 60, dur = 800 } = {}) {
  if (RM()) return;
  [...els].forEach((e, i) => e.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }], { duration: dur, delay: delay + i * gap, easing: EASE, fill: 'backwards' }));
}
export function slideSwap(mask, build, dir = 1) {
  const fresh = build();
  if (RM() || !mask.firstElementChild) { mask.replaceChildren(fresh); return; }
  const old = mask.firstElementChild;
  mask.style.position = 'relative';
  old.style.position = 'absolute'; old.style.left = 0; old.style.right = 0; old.style.top = 0;
  mask.append(fresh);
  fresh.animate([{ transform: `translateY(${dir * 105}%)` }, { transform: 'translateY(0)' }], { duration: 560, easing: EASE });
  whenDone(old.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-dir * 105}%)` }], { duration: 560, easing: EASE, fill: 'both' }), () => old.remove(), 560);
}
export function barGrow(root) {
  if (RM()) return;
  $$('.bar-meter i', root).forEach((i, k) => i.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 900, delay: k * 40, easing: EASE, fill: 'backwards' }));
}

/* ---------- format ---------- */
export const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (t) => { if (!t) return '—'; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtFull = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
export const fmtMin = (ms) => `${Math.round(ms / 60000)} 分钟`;
export const yuan = (n) => (n < 0.01 && n > 0 ? '<¥0.01' : `¥${Number(n || 0).toFixed(n >= 1 ? 2 : 3)}`);
export const TYPE = { single: '单选题', fill: '填空题', tf: '判断题', essay: '综合分析题' };
export const LETTERS = 'ABCDEFGH';
export const toLocalInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function meter(pct, color) { return h('div', { class: 'bar-meter' }, h('i', { style: `width:${Math.max(0, Math.min(100, pct || 0))}%${color ? ';background:' + color : ''}` })); }
