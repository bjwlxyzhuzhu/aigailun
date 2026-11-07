// The VHS course shelf (attachment A). Plain DOM + one rAF loop + Web Animations API. No libraries, no CSS keyframes, no opacity fades.
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const SHEET_EASE = 'cubic-bezier(.76,0,.18,1)';
const TILT_Z = -4.5;
const smooth = (x) => x * x * (3 - 2 * x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mod = (a, b) => ((a % b) + b) % b;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function progressLine(t) {
  if (t.kind === 'mock') return t.done ? `已完成 ${t.done} 次 · 最高 ${t.acc ?? '—'} 分` : '73 题 · 100 分 · 90 分钟';
  if (t.kind === 'wrong') return t.total ? `未掌握 ${t.total} 题` : '暂无错题 · 继续保持';
  return `已练 ${t.done}/${t.total} · 正确率 ${t.acc == null ? '—' : t.acc + '%'}`;
}

const ACTIONS = {
  chapter: [['practice', '开始练习', 'START', true], ['wrong-chapter', '本章错题', 'REVIEW', false], ['outline', 'AI 章节提纲', 'OUTLINE', false]],
  mock: [['standard', '一键标准卷', 'MOCK', true], ['custom', '自定义组卷', 'CUSTOM', false], ['papers', '我的试卷', 'PAPERS', false]],
  wrong: [['wrong', '进入错题本', 'OPEN', true], ['wrong-practice', '错题重练', 'RETRY', false]],
};

export function mountShelf(host, opts) {
  const { tapes, modules, user, finalDate, exams = 0, onAction, onLogout, onNav } = opts;
  const n = tapes.length, COPIES = 3, N = n * COPIES;
  const RM = reduced();
  const tabsDef = [{ id: 'all', label: '全部', en: 'ALL', first: 0 }].concat(
    modules.map((m) => ({ id: m.id, label: m.label, en: m.id.toUpperCase(), first: tapes.findIndex((t) => t.module === m.id) })).filter((m) => m.first >= 0));

  const daysLeft = finalDate ? Math.ceil((new Date(finalDate + 'T00:00:00') - Date.now()) / 86400000) : null;
  host.classList.add('shelf-root');
  host.innerHTML = `
  <header class="s-bar">
    <div class="l"><button class="box lbl" data-act="logout">退出</button><a class="box lbl" href="#/me">个人中心</a></div>
    <a class="logo" href="#/" aria-label="人工智能概论"><b>人工智能概论</b><i>AI LITERACY</i></a>
    <div class="r lbl">${daysLeft != null && daysLeft >= 0 ? `距期末考试 ${daysLeft} 天` : '期末前 · 自测 · 模考 · 错题'}</div>
  </header>
  <nav class="s-tabs" aria-label="模块"><span class="ind"></span>${tabsDef.map((t, i) => `<button class="lbl" data-tab="${i}">${esc(t.label)}${t.id === 'all' ? ' / ALL' : ''}</button>`).join('')}</nav>
  <section class="s-shelf" aria-label="课程书架"><div class="s-stage"></div></section>
  <button class="s-play" aria-label="打开"></button>
  <div class="s-cap" aria-live="polite"><div class="m t"></div><div class="m sb lbl"></div><div class="m yr"></div></div>
  <button class="s-arrow l" aria-label="上一个"><svg viewBox="0 0 18 10"><path d="M5 1 L1 5 L5 9 M1 5 H17"/></svg></button>
  <button class="s-arrow r" aria-label="下一个"><svg viewBox="0 0 18 10"><path d="M13 1 L17 5 L13 9 M17 5 H1"/></svg></button>
  <div class="s-hint lbl">拖动 · 滚轮 · ← → 切换　点击封面打开</div>
  <a class="s-qr" href="https://aigailun.app.tokenone.work" target="_blank" rel="noopener" aria-label="扫码访问本平台"><img src="/assets/qr.svg" width="72" height="72" alt="平台地址二维码"><span class="lbl">扫码访问</span></a>
  <footer class="s-foot"><span class="lbl">© 《人工智能概论》智能练考平台</span><span class="lbl"><a href="#/scope">复习范围</a> / <a href="#/papers">我的试卷</a></span></footer>
  <div class="s-cursor" aria-hidden="true"><div class="ring"></div><div class="dot"></div><div class="txt">OPEN<br>打开</div></div>
  <div class="s-detail" role="dialog" aria-modal="true" aria-label="详情">
    <div class="dtop"><a class="logo" href="#/"><b>人工智能概论</b><i>AI LITERACY</i></a></div>
    <button class="box lbl dclose">关闭 / CLOSE</button>
    <div class="dleft"></div>
    <div class="dright"></div>
  </div>`;
  const $ = (s) => host.querySelector(s);
  const stage = $('.s-stage'), shelf = $('.s-shelf'), playEl = $('.s-play'), cursorEl = $('.s-cursor'), detail = $('.s-detail');
  const tabsNav = $('.s-tabs'), ind = $('.ind'), tabBtns = [...host.querySelectorAll('[data-tab]')];
  const capT = $('.s-cap .t'), capS = $('.s-cap .sb'), capY = $('.s-cap .yr');
  document.documentElement.classList.add('shelf-mode');
  document.body.classList.add('noscroll');

  /* ---------- build 3 copies of the shelf ---------- */
  const els = [];
  for (let v = 0; v < N; v++) {
    const t = tapes[v % n];
    const el = document.createElement('div');
    el.className = 'tape';
    el.dataset.v = v;
    el.innerHTML = `<div class="face sp" style="background-image:url('${t.spine_url}')"></div><div class="face cv" style="background-image:url('${t.cover_url}')"></div>`;
    stage.appendChild(el);
    els.push({ el, sp: el.firstChild, cv: el.lastChild, hidden: false, lift: 0, last: '' });
  }
  tapes.forEach((t) => { const i = new Image(); i.src = t.cover_url; const j = new Image(); j.src = t.spine_url; }); // preload

  /* ---------- geometry ---------- */
  let W = innerWidth, H = 400, ws = 68, d = 210, gap = 12;
  function measure() {
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;visibility:hidden;width:1px;height:var(--H)';
    host.appendChild(p); H = p.getBoundingClientRect().height; p.remove();
    ws = (H * 142) / 840; d = (H * 474) / 900; gap = H * 0.03; W = innerWidth;
    stage.style.setProperty('--Hp', H + 'px'); stage.style.setProperty('--ws', ws + 'px'); stage.style.setProperty('--d', d + 'px');
    layoutTabInd(true);
  }
  const B = (r) => (Math.abs(r) < 1 ? (r + Math.sin(Math.PI * r) / Math.PI) / 2 : Math.sign(r) * 0.5);
  const F = (r) => r * (ws + gap) + (d - ws + 1.6 * gap) * B(r);
  const rel = (v, s) => mod(v - s + N / 2, N) - N / 2;

  /* ---------- state ---------- */
  const saved = +localStorage.getItem('shelf-idx');
  let T = n + (Number.isFinite(saved) && saved >= 0 && saved < n ? saved : 0);
  let s = T, active = -1, hover = -1, dir = 1, tiltX = 0, tiltY = 0, onCover = false;
  let mx = -200, my = -200, cx = -200, cy = -200, dragging = false, drag = null, wheelTimer = 0, isOpen = false, lastTarget = null;
  let rafId = 0, destroyed = false;

  /* ---------- caption & tabs ---------- */
  function swap(mask, text, dr) {
    if (RM) { mask.textContent = text; return; }
    const sp = document.createElement('span'); sp.textContent = text; mask.appendChild(sp);
    sp.animate([{ transform: `translateY(${dr * 105}%)` }, { transform: 'translateY(0)' }], { duration: 650, easing: EASE, fill: 'both' });
    [...mask.children].forEach((o) => {
      if (o === sp || o.dataset.leaving) return;
      o.dataset.leaving = 1;
      const cur = getComputedStyle(o).transform;
      o.getAnimations().forEach((a) => a.cancel());
      const a = o.animate([{ transform: cur === 'none' ? 'translateY(0)' : cur }, { transform: `translateY(${-dr * 105}%)` }], { duration: 650, easing: EASE, fill: 'both' });
      let gone = false; const rm = () => { if (!gone) { gone = true; o.remove(); } };
      a.onfinish = rm; setTimeout(rm, 900); // never leave a stale caption if animations stall
    });
  }
  function layoutTabInd(instant) {
    const t = tapes[mod(active < 0 ? 0 : active, n)];
    const idx = Math.max(0, tabsDef.findIndex((x) => x.id === t.module));
    const b = tabBtns[idx];
    tabBtns.forEach((x, i) => x.classList.toggle('on', i === idx && tabsDef[idx].id !== 'all'));
    if (instant) { const tr = ind.style.transition; ind.style.transition = 'none'; ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`; ind.offsetWidth; ind.style.transition = tr; }
    else { ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`; }
  }
  function setActive(i, dr) {
    const first = active < 0;
    active = i;
    const t = tapes[i];
    localStorage.setItem('shelf-idx', i);
    const dd = first ? 1 : dr;
    swap(capT, t.title, dd); swap(capS, `${t.en} / ${t.label}`, dd); swap(capY, progressLine(t), dd);
    layoutTabInd(first);
  }

  /* ---------- navigation ---------- */
  const go = (target) => { T = target; };
  const step = (k) => go(Math.round(T) + k);
  function jumpTo(idx) { // shortest way round the loop
    let delta = idx - mod(Math.round(T), n);
    if (delta > n / 2) delta -= n; if (delta < -n / 2) delta += n;
    go(Math.round(T) + delta);
  }
  tabBtns.forEach((b, i) => b.addEventListener('click', () => jumpTo(tabsDef[i].first)));
  $('.s-arrow.l').addEventListener('click', () => step(-1));
  $('.s-arrow.r').addEventListener('click', () => step(1));
  playEl.addEventListener('click', () => openDetail());
  host.querySelector('[data-act=logout]').addEventListener('click', () => onLogout?.());

  window.addEventListener('keydown', onKey);
  function onKey(e) {
    if (destroyed || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' && isOpen) { closeDetail(); return; }
    if (isOpen) return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    else if (e.key === 'Enter' && (document.activeElement === document.body || !document.activeElement)) openDetail();
  }
  window.addEventListener('wheel', onWheel, { passive: false });
  function onWheel(e) {
    if (destroyed) return;
    if (isOpen) return;
    e.preventDefault();
    const dl = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    T += (dl / (ws + gap)) * 0.5;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { T = Math.round(T); }, 160);
  }
  shelf.addEventListener('pointerdown', (e) => {
    if (isOpen || e.button > 0) return;
    drag = { x: e.clientX, T0: T, moved: false, hit: e.target.closest?.('.tape')?.dataset.v ?? null };
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  function onMove(e) {
    mx = e.clientX; my = e.clientY; lastTarget = e.target;
    if (cx === -200) { cx = mx; cy = my; }
    if (drag) {
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 5) { drag.moved = true; dragging = true; }
      if (drag.moved) T = drag.T0 - dx / (ws + gap);
    }
  }
  function onUp() {
    if (!drag) return;
    const dr = drag; drag = null; dragging = false;
    if (dr.moved) { T = Math.round(T); return; }
    if (dr.hit != null) {
      const r = rel(+dr.hit, s);
      if (Math.abs(r) < 0.5) openDetail(); else go(Math.round(T + r));
    }
  }
  shelf.addEventListener('click', (e) => e.stopPropagation());

  /* ---------- detail sheet ---------- */
  const dleft = $('.dleft'), dright = $('.dright');
  const BLOBS = [[150, 330, 0], [340, 600, 120], [250, 120, 220], [90, 760, 300], [400, 250, 360], [260, 860, 420], [230, 470, 180]];
  let blobEls = [], inkRaf = 0, lines = [];
  function fillDetail(t) {
    const acts = ACTIONS[t.kind] || ACTIONS.chapter;
    dleft.innerHTML = `
      <div class="dl"><span class="d-sub lbl">${esc(t.en)} / ${esc(t.label)}</span></div>
      <div class="dl"><h2 class="d-title">${esc(t.title)}</h2></div>
      <div class="dl"><span class="d-meta lbl">${esc(progressLine(t))}${t.kind === 'chapter' ? ` / 错题 ${t.wrong}` : ''}</span></div>
      <div class="dl"><p class="d-syn">${esc(t.summary)}</p></div>
      <div class="dl"><ul class="d-pts">${(t.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
      <div class="dl"><p class="d-credit">${t.kind === 'chapter' ? '课件：林子雨《人工智能通识：零基础学AI》（2025.12）' : '练习仅供考前自测，不计入课程成绩。'}</p></div>
      <div class="dl"><div class="d-actions">${acts.map(([a, zh, en, fill]) => `<button class="dbtn lbl${fill ? ' fill' : ''}" data-do="${a}">${zh} / ${en}</button>`).join('')}</div></div>`;
    lines = [...dleft.querySelectorAll('.dl > *')];
    dright.innerHTML = `<svg viewBox="0 0 474 900" aria-hidden="true"><defs>
      <filter id="inkf" filterUnits="userSpaceOnUse" x="-200" y="-200" width="874" height="1300"><feTurbulence type="fractalNoise" baseFrequency=".011" numOctaves="3" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="120" xChannelSelector="R" yChannelSelector="G"/></filter>
      <mask id="inkm" maskUnits="userSpaceOnUse" x="-200" y="-200" width="874" height="1300"><g fill="#fff" ${document.documentElement.classList.contains('lite') ? '' : 'filter="url(#inkf)"'}>${BLOBS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0"/>`).join('')}</g></mask></defs>
      <image href="${t.cover_url}" width="474" height="900" preserveAspectRatio="none" mask="url(#inkm)"/></svg>`;
    blobEls = [...dright.querySelectorAll('circle')];
    dleft.querySelectorAll('[data-do]').forEach((b) => b.addEventListener('click', () => onAction?.(t, b.dataset.do)));
  }
  const coverEl = () => { let best = 0, bv = 1e9; for (let v = 0; v < N; v++) { const a = Math.abs(rel(v, s)); if (a < bv) { bv = a; best = v; } } return els[best].cv; };
  const insetFor = (r) => `inset(${Math.max(0, r.top)}px ${Math.max(0, innerWidth - r.right)}px ${Math.max(0, innerHeight - r.bottom)}px ${Math.max(0, r.left)}px round 3px)`;
  function openDetail() {
    if (isOpen || destroyed) return;
    T = Math.round(T);
    isOpen = true;
    const t = tapes[mod(T, n)];
    fillDetail(t);
    const r = coverEl().getBoundingClientRect();
    detail.style.visibility = 'visible';
    detail.style.transformOrigin = `${r.left + r.width / 2}px ${r.top + r.height / 2}px`;
    const dur = RM ? 1 : 1050;
    detail.animate([{ clipPath: insetFor(r), transform: `rotate(${TILT_Z}deg)` }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', transform: 'rotate(0deg)' }], { duration: dur, easing: SHEET_EASE, fill: 'both' });
    lines.forEach((l, i) => l.animate([{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }], { duration: RM ? 1 : 900, delay: RM ? 0 : 620 + i * 75, easing: EASE, fill: 'both' }));
    const t0 = performance.now() + (RM ? -5000 : 520);
    cancelAnimationFrame(inkRaf);
    const tick = (now) => {
      const el = now - t0;
      BLOBS.forEach(([, , dl], i) => { const p = clamp((el - dl) / 1250, 0, 1); blobEls[i]?.setAttribute('r', 720 * (1 - (1 - p) ** 3)); });
      if (el < 2400) inkRaf = requestAnimationFrame(tick);
    };
    inkRaf = requestAnimationFrame(tick);
    detail.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('.dclose').focus({ preventScroll: true }), 50);
  }
  function closeDetail() {
    if (!isOpen) return;
    const r = coverEl().getBoundingClientRect();
    detail.style.transformOrigin = `${r.left + r.width / 2}px ${r.top + r.height / 2}px`;
    const a = detail.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)', transform: 'rotate(0deg)' }, { clipPath: insetFor(r), transform: `rotate(${TILT_Z}deg)` }], { duration: RM ? 1 : 850, easing: SHEET_EASE, fill: 'both' });
    let closed = false;
    const fin = () => {
      if (closed) return; closed = true;
      detail.style.visibility = 'hidden';
      detail.getAnimations({ subtree: true }).forEach((x) => x.cancel());
      isOpen = false;
      document.activeElement?.blur?.();
    };
    a.onfinish = fin; setTimeout(fin, (RM ? 1 : 850) + 200);
  }
  $('.dclose').addEventListener('click', closeDetail);

  /* ---------- the one loop ---------- */
  let last = performance.now(), fpsN = 0, fpsT = 0, fpsWin = 0, tick6 = 0;
  function frame(now) {
    if (destroyed) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // adaptive: <30fps for a 2s window drops grain/ink filter (PRD 6.5)
    fpsN++; fpsT += now - (frame.prev || now); frame.prev = now;
    if (fpsT >= 2000) { if (fpsWin++ > 0 && fpsN / (fpsT / 1000) < 30 && !document.documentElement.classList.contains('lite')) document.documentElement.classList.add('lite'); fpsN = 0; fpsT = 0; }

    // scroll spring
    if (Math.abs(T - s) > 1e-4) s += (T - s) * (RM ? 1 : 1 - Math.exp(-(dragging ? 18 : 5.2) * dt)); else s = T;
    if (Math.abs(s) > 4 * N) { const sh = Math.round(s / N) * N; s -= sh; T -= sh; if (drag) drag.T0 -= sh; }
    const a = mod(Math.round(s), n);
    if (a !== active) setActive(a, Math.sign(T - s) || dir);
    if (Math.sign(T - s)) dir = Math.sign(T - s);

    // cursor-on-cover test + tilt
    const sr = shelf.getBoundingClientRect(), scy = sr.top + sr.height / 2;
    const settled = Math.abs(T - s) < 0.3;
    onCover = !isOpen && settled && Math.abs(mx - W / 2) < 0.55 * d && Math.abs(my - scy) < 0.55 * H;
    const tyT = onCover ? ((mx - W / 2) / (0.55 * d)) * 9 : ((mx - W / 2) / W) * 5;
    const txT = onCover ? (-(my - scy) / (H / 2)) * 6 : 0;
    const kt = RM ? 1 : 1 - Math.exp(-7 * dt);
    tiltY += (tyT - tiltY) * kt; tiltX += (txT - tiltX) * kt;

    // periodic hover refresh (tapes move under a still pointer)
    if ((tick6++ % 6) === 0 && mx > -100 && !dragging) lastTarget = document.elementFromPoint(mx, my);
    const hv = !isOpen && lastTarget?.closest ? lastTarget.closest('.tape') : null;
    hover = hv ? +hv.dataset.v : -1;

    for (let v = 0; v < N; v++) {
      const t = els[v];
      const r = rel(v, s);
      const x = F(r);
      if (Math.abs(x) > W / 2 + 1.5 * d) { if (!t.hidden) { t.el.style.visibility = 'hidden'; t.hidden = true; } continue; }
      if (t.hidden) { t.el.style.visibility = 'visible'; t.hidden = false; }
      const ar = Math.abs(r);
      const o = smooth(Math.max(0, 1 - ar));
      const tl = hover === v && ar > 0.5 ? 1 : 0;
      t.lift += (tl - t.lift) * (RM ? 1 : 1 - Math.exp(-12 * dt));
      const tr = `translate3d(${x.toFixed(2)}px,${(-o * 0.025 * H - t.lift * 0.045 * H).toFixed(2)}px,${(o * 0.2 * H).toFixed(2)}px) rotateZ(${(TILT_Z * o).toFixed(3)}deg) rotateX(${(tiltX * o).toFixed(3)}deg) rotateY(${(-90 * o + tiltY * o).toFixed(3)}deg)`;
      if (tr !== t.last) {
        t.last = tr; t.el.style.transform = tr; t.el.style.zIndex = Math.round(100 - ar * 4);
        t.sp.style.setProperty('--shade', (o * 0.55).toFixed(3)); t.cv.style.setProperty('--shade', ((1 - o) * 0.5).toFixed(3));
      }
    }

    // play ring on the cover's lower-left corner
    const ps = isOpen ? 0 : smooth(Math.max(0, 1 - Math.abs(T - s) * 3));
    playEl.style.transform = `scale(${ps.toFixed(3)})`;
    playEl.style.pointerEvents = ps > 0.6 ? 'auto' : 'none';
    playEl.style.left = (W / 2 - 0.5 * d - 6) + 'px';
    playEl.style.top = (scy + 0.36 * H) + 'px';

    // cursor
    cx += (mx - cx) * (1 - Math.exp(-16 * dt)); cy += (my - cy) * (1 - Math.exp(-16 * dt));
    cursorEl.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0)`;
    const onBtn = lastTarget?.closest?.('button,a') && (isOpen || !shelf.contains(lastTarget));
    const cls = onCover ? 'open' : (!isOpen && hover >= 0 && Math.abs(rel(hover, s)) > 0.5) ? 'spine' : onBtn ? 'btn' : '';
    if (cursorEl.dataset.c !== cls) { cursorEl.dataset.c = cls; cursorEl.className = 's-cursor ' + cls; }
  }
  measure();
  s = T;
  setActive(mod(Math.round(s), n), 1);
  const onResize = () => { measure(); };
  window.addEventListener('resize', onResize);
  rafId = requestAnimationFrame(frame);

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId); cancelAnimationFrame(inkRaf);
      ['keydown', 'wheel', 'pointermove', 'pointerup', 'pointercancel', 'resize'].forEach((ev) => window.removeEventListener(ev, { keydown: onKey, wheel: onWheel, pointermove: onMove, pointerup: onUp, pointercancel: onUp, resize: onResize }[ev]));
      document.documentElement.classList.remove('shelf-mode'); document.body.classList.remove('noscroll');
      host.classList.remove('shelf-root'); host.innerHTML = '';
    },
    open: openDetail, close: closeDetail,
    get isOpen() { return isOpen; },
    openChapter(id) { const i = tapes.findIndex((t) => t.id === id); if (i >= 0) { T = n + i; s = T; } },
  };
}
