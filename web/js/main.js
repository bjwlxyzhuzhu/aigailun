import { h, $, api, GET, POST, session, toast, fail, riseIn, ApiError, esc } from './ui.js';

const app = $('#app');
let cleanup = null;
let me = null;

/* ---------- shell used by every inner page ---------- */
export function shell({ back = '#/', backLabel = '返回书架', calm = true, wide = false } = {}) {
  document.body.classList.toggle('calm', calm);
  const main = h('main', { class: 'page', style: wide ? 'max-width:1320px' : '' });
  const bar = h('header', { class: 'bar no-print' },
    h('div', { class: 'l' }, h('a', { class: 'box lbl', href: back }, backLabel)),
    h('a', { class: 'logo', href: me?.user.role === 'student' ? '#/' : me?.user.role === 'admin' ? '#/a' : '#/t' }, h('b', {}, '人工智能概论'), h('i', {}, 'AI LITERACY')),
    h('div', { class: 'r row hide-m', style: 'justify-content:flex-end;gap:8px' },
      me ? h('span', { class: 'lbl' }, me.user.name) : null,
      me ? h('button', { class: 'box lbl', onclick: logout }, '退出') : null));
  app.replaceChildren(bar, main);
  window.scrollTo(0, 0);
  return main;
}
export function logout() { session.token = null; me = null; location.hash = '#/login'; }
export const getMe = () => me;
export async function refreshMe() { me = await GET('/me'); session.user = me.user; return me; }

/* ---------- login / forced password change ---------- */
function loginPage() {
  document.body.classList.add('calm');
  const err = h('p', { class: 'cn', style: 'color:var(--bad);min-height:24px;margin:0' });
  const form = h('form', { class: 'card', style: 'width:min(420px,100%);padding:32px', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      const r = await POST('/auth/login', { username: form.u.value, password: form.p.value });
      session.token = r.token; me = null;
      location.hash = r.user.must_change_pwd ? '#/password' : '#/';
      route();
    } catch (x) { err.textContent = x.message; }
  } },
  h('a', { class: 'logo', style: 'margin-bottom:28px', href: '#/login' }, h('b', { style: 'font-size:30px' }, '人工智能概论'), h('i', {}, 'AI LITERACY · 智能练考平台')),
  h('div', { class: 'field' }, h('label', { class: 'f', for: 'u' }, '学号 / 工号'), h('input', { class: 'in', id: 'u', name: 'u', autocomplete: 'username', required: true, autofocus: true })),
  h('div', { class: 'field' }, h('label', { class: 'f', for: 'p' }, '密码'), h('input', { class: 'in', id: 'p', name: 'p', type: 'password', autocomplete: 'current-password', required: true })),
  err,
  h('button', { class: 'btn pri', style: 'width:100%;margin-top:12px' }, '登录'),
  h('p', { class: 'hint', style: 'text-align:center;margin-top:18px' }, '初始密码为学号后 6 位，首次登录需修改。不能自行注册，请联系任课教师导入。'));
  app.replaceChildren(h('div', { style: 'min-height:100vh;display:grid;place-items:center;padding:20px;position:relative;z-index:1' }, form));
  riseIn([form.querySelector('.logo')], { dur: 700 });
}

function passwordPage() {
  const main = shell({ back: '#/login', backLabel: '返回登录' });
  const err = h('p', { class: 'cn', style: 'color:var(--bad);min-height:22px;margin:0' });
  const f = h('form', { class: 'card', style: 'max-width:460px', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (f.n.value !== f.n2.value) { err.textContent = '两次输入的新密码不一致'; return; }
    try { await POST('/auth/password', { old: f.o.value, new: f.n.value }); toast('密码已更新'); await refreshMe(); location.hash = '#/'; } catch (x) { err.textContent = x.message; }
  } },
  h('div', { class: 'field' }, h('label', { class: 'f' }, '原密码'), h('input', { class: 'in', name: 'o', type: 'password', required: true, autocomplete: 'current-password' })),
  h('div', { class: 'field' }, h('label', { class: 'f' }, '新密码'), h('input', { class: 'in', name: 'n', type: 'password', required: true, autocomplete: 'new-password' }), h('p', { class: 'hint' }, '至少 8 位，同时包含字母和数字。')),
  h('div', { class: 'field' }, h('label', { class: 'f' }, '再次输入新密码'), h('input', { class: 'in', name: 'n2', type: 'password', required: true, autocomplete: 'new-password' })),
  err, h('button', { class: 'btn pri' }, '保存新密码'));
  main.append(h('h1', {}, '修改密码'), h('p', { class: 'sub cn muted' }, '为了账号安全，首次登录请先修改初始密码。'), f);
}

/* ---------- router ---------- */
const R = [];
const add = (re, load, auth = true) => R.push({ re, load, auth });
const page = (file, fn) => async (...a) => (await import(`./pages/${file}.js`))[fn](...a);

add(/^\/login$/, () => loginPage(), false);
add(/^\/password$/, () => passwordPage());
add(/^\/$/, page('home', 'homePage'));
add(/^\/practice\/setup$/, page('practice', 'setupPage'));
add(/^\/practice\/(\d+)$/, page('practice', 'runPage'));
add(/^\/wizard$/, page('exam', 'wizardPage'));
add(/^\/papers$/, page('exam', 'papersPage'));
add(/^\/exams$/, page('exam', 'examsPage'));
add(/^\/exam\/(\d+)$/, page('exam', 'examRunPage'));
add(/^\/report\/(\d+)$/, page('exam', 'reportPage'));
add(/^\/wrong$/, page('wrong', 'wrongPage'));
add(/^\/scope$/, page('misc', 'scopePage'));
add(/^\/me$/, page('misc', 'mePage'));
add(/^\/t$/, page('teacher', 'overviewPage'));
add(/^\/t\/class\/(\d+)$/, page('teacher', 'classPage'));
add(/^\/t\/import$/, page('teacher', 'importPage'));
add(/^\/t\/questions$/, page('teacher', 'questionsPage'));
add(/^\/t\/analysis$/, page('teacher', 'analysisPage'));
add(/^\/t\/exams$/, page('teacher', 'examsPage'));
add(/^\/t\/exam\/(\d+)$/, page('teacher', 'examDetailPage'));
add(/^\/a$/, page('admin', 'adminPage'));
add(/^\/a\/(teachers|ai|kb|usage|audit)$/, page('admin', 'adminPage'));

let navToken = 0;
async function route() {
  const tok = ++navToken;
  const full = location.hash.slice(1) || '/';
  const [path, qsr] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(qsr || ''));
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  document.documentElement.classList.remove('shelf-mode'); document.body.classList.remove('noscroll');
  const r = R.find((x) => x.re.test(path));
  if (!r) { location.hash = '#/'; return; }
  if (r.auth) {
    if (!session.token) { location.hash = '#/login'; return; }
    if (!me) { try { await refreshMe(); } catch { return; } }
    if (tok !== navToken) return;
    if (me.user.must_change_pwd && path !== '/password') { location.hash = '#/password'; return; }
    if (path === '/' && me.user.role !== 'student') { location.hash = me.user.role === 'admin' ? '#/a' : '#/t'; return; }
    if (path.startsWith('/t') && me.user.role === 'student') { location.hash = '#/'; return; }
    if (path.startsWith('/a') && me.user.role !== 'admin') { location.hash = '#/'; return; }
  } else if (session.token && path === '/login') { /* allow re-login */ }
  try {
    const m = r.re.exec(path);
    const out = await r.load(...m.slice(1), query, { shell, me, app });
    if (tok === navToken) cleanup = typeof out === 'function' ? out : out?.destroy ? () => out.destroy() : null;
    else if (typeof out === 'function') out();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return;
    console.error(e);
    const main = shell();
    main.append(h('h1', {}, '出错了'), h('p', { class: 'cn' }, e.message || String(e)), h('a', { class: 'btn', href: '#/' }, '回到首页'));
  }
}
window.addEventListener('hashchange', route);
route();
