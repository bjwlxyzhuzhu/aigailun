import { whenDone, h, GET, POST, PUT, DEL, toast, fail, slideSwap, modal, confirmBox, meter, barGrow, riseIn, yuan, fmtDate, fmtFull, fmtDur, fmtMin, TYPE, openHtml, EASE, $$ } from '../ui.js';
import { questionBlock, typeTag } from './qui.js';
import { aiStatus, callAI } from './aihelp.js';
import { essayModal } from './essay.js';

const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- wizard: standard / custom / AI ---------- */
export async function wizardPage(query, ctx) {
  const main = ctx.shell({ back: '#/', backLabel: '返回书架' });
  const shelf = await GET('/shelf');
  const st = await aiStatus();
  const chapters = shelf.tapes.filter((t) => t.kind === 'chapter');
  let tab = query.tab === 'custom' ? 'custom' : query.tab === 'ai' ? 'ai' : 'standard';
  const body = h('div', {});
  const tabs = h('div', { class: 'nav-tabs' });
  const previewBox = h('div', { style: 'margin-top:24px' });

  const paintTabs = () => tabs.replaceChildren(...[['standard', '一键标准卷'], ['custom', '自定义卷'], ['ai', 'AI 新出题']].map(([k, l]) => h('a', { href: 'javascript:void 0', class: tab === k ? 'on' : '', onclick: () => { tab = k; previewBox.replaceChildren(); paintTabs(); paint(); } }, l)));

  function showPreview(res) {
    const dist = Object.entries(res.chapter_dist || {});
    const mx = Math.max(1, ...dist.map(([, n]) => n));
    previewBox.replaceChildren(h('div', { class: 'card' },
      h('h3', {}, `${res.title} · 预览`),
      h('div', { class: 'grid4' },
        ['single', 'fill', 'tf', 'essay'].filter((t) => res.summary[t]).map((t) => h('div', {}, h('div', { class: 'stat' }, `${res.summary[t].n}`, h('small', {}, t === 'fill' ? '题' : '题')), h('div', { class: 'lbl muted', style: 'margin-top:6px' }, `${TYPE[t]} · ${res.summary[t].points} 分`))),
        h('div', {}, h('div', { class: 'stat cobalt' }, `${res.total}`, h('small', {}, '分')), h('div', { class: 'lbl muted', style: 'margin-top:6px' }, `总分 · ${res.duration_min || 90} 分钟`))),
      h('div', { style: 'margin:20px 0 6px' }, h('span', { class: 'lbl' }, '章节分布（题数）')),
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 18px' }, dist.map(([c, n]) => h('div', { class: 'cn', style: 'font-size:13px' }, `第${c}章 ${n} 题`, meter((100 * n) / mx)))),
      h('div', { class: 'row', style: 'margin-top:22px' },
        h('button', { class: 'btn pri', onclick: async () => { try { const r = await POST('/attempts', { paper_id: res.paper_id }); location.hash = `#/exam/${r.attempt_id}`; } catch (e) { fail(e); } } }, `开始 ${res.duration_min || 90} 分钟模拟考`),
        h('button', { class: 'btn', onclick: () => openHtml(`/papers/${res.paper_id}/print`) }, '导出题目卷 + 答案卷（PDF）'),
        h('a', { class: 'btn', href: '#/papers' }, '我的试卷'))));
    barGrow(previewBox);
  }
  const dur = h('select', { class: 'in', style: 'max-width:160px', 'aria-label': '考试时长' }, [[60, '60 分钟'], [90, '90 分钟（与期末一致）'], [120, '120 分钟'], [150, '150 分钟']].map(([v, l]) => h('option', { value: v, selected: v === 90 }, l)));
  const durField = () => h('div', { class: 'field' }, h('label', { class: 'f' }, '考试时长（自己设置）'), dur);
  async function gen(payload, btn) {
    payload = { ...payload, duration_min: +dur.value };
    btn.disabled = true;
    try { showPreview(await POST('/papers/generate', payload)); } catch (e) { fail(e); }
    btn.disabled = false;
  }

  function paint() {
    if (tab === 'standard') {
      const b = h('button', { class: 'btn pri', onclick: () => gen({ mode: 'standard' }, b) }, '生成标准卷');
      body.replaceChildren(h('div', { class: 'card' },
        h('p', { class: 'cn', style: 'margin-top:0' }, '与期末笔试同结构：73 道题、100 分。时长由你自己设置（默认 90 分钟）。每次抽题都会打乱题目与选项顺序，同卷不会出现高度相似的两道题。'),
        h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['题型', '数量', '每题', '小计', '范围'].map((x) => h('th', {}, x)))),
          h('tbody', {}, [['单选题', '50 道', '1 分', '50', '第 1–11 章'], ['填空题', '10 空', '1 分/空', '10', '第 1–11 章'], ['判断题', '10 道', '1 分', '10', '第 1–11 章'], ['综合分析题', '3 道', '10 分', '30', '第 7–11 章（3 个不同章节）']].map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))),
        durField(), h('div', { style: 'margin-top:20px' }, b)));
    } else if (tab === 'custom') {
      const sel = new Set(), counts = { single: 20, fill: 5, tf: 5, essay: 0 };
      const pills = chapters.map((c) => { const p = h('button', { class: 'pill', type: 'button', 'aria-pressed': 'false', onclick: () => { sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); p.setAttribute('aria-pressed', sel.has(c.id)); } }, `第${c.id}章 ${c.title}`); return p; });
      const num = (k, label, max, hint) => { const i = h('input', { class: 'in', type: 'number', min: 0, max, value: counts[k], style: 'max-width:110px', 'aria-label': label, oninput: () => (counts[k] = Math.max(0, Math.min(max, +i.value || 0))) }); return h('div', {}, h('label', { class: 'f' }, label), i, h('p', { class: 'hint' }, hint)); };
      const prefer = h('select', { class: 'in', style: 'max-width:260px' }, h('option', { value: '' }, '不偏好'), h('option', { value: 'weak' }, '我的薄弱章节优先'), h('option', { value: 'wrong' }, '错题优先'));
      const b = h('button', { class: 'btn pri', onclick: () => gen({ mode: 'custom', chapters: [...sel], counts, prefer: prefer.value || null }, b) }, '生成预览');
      body.replaceChildren(h('div', { class: 'card' },
        h('div', { class: 'field' }, h('label', { class: 'f' }, '章节（不选＝全部）'), h('div', { class: 'pills' }, pills)),
        h('div', { class: 'grid4 field' }, num('single', '单选题（道）', 80, '每题 1 分'), num('fill', '填空题（空）', 30, '每空 1 分'), num('tf', '判断题（道）', 40, '每题 1 分'), num('essay', '综合分析（道）', 5, '每题 10 分，仅第 7–11 章')),
        h('div', { class: 'field' }, h('label', { class: 'f' }, '偏好'), prefer), durField(), b));
    } else {
      const ch = h('select', { class: 'in', style: 'max-width:280px' }, chapters.map((c) => h('option', { value: c.id }, `第${c.id}章 ${c.title}`)));
      const ty = h('select', { class: 'in', style: 'max-width:200px' }, [['single', '单选题'], ['tf', '判断题'], ['fill', '填空题']].map(([k, l]) => h('option', { value: k }, l)));
      const nn = h('input', { class: 'in', type: 'number', min: 1, max: 10, value: 5, style: 'max-width:100px' });
      const note = h('p', { class: 'hint' }, st.has_key ? `预估花费约 ${yuan(st.estimates?.generate_each * 5 || 0)}（每 5 题）；调用前会再次确认。` : '需要先在【我的 → AI 设置】填写 API Key。');
      const b = h('button', { class: 'btn pri', disabled: !st.has_key, title: st.has_key ? '' : '在【我的 → AI 设置】填写 API Key 后可用', onclick: async () => {
        b.disabled = true;
        try { const r = await callAI('/ai/generate', { chapter: +ch.value, type: ty.value, count: +nn.value }); if (r) { toast(`已生成 ${r.count} 题，开始练习`); location.hash = `#/practice/${r.attempt_id}`; } } catch (e) { fail(e); }
        b.disabled = !st.has_key;
      } }, '生成并开始练习');
      body.replaceChildren(h('div', { class: 'card' },
        h('p', { class: 'cn', style: 'margin-top:0' }, '以讲义内容为依据，由 AI 为你原创新题，带“AI 生成”标记，只存在于你自己的试卷里，不进公共题库。如发现题目有误，可在练习时点“题目有误？”。'),
        h('div', { class: 'row' }, h('div', {}, h('label', { class: 'f' }, '章节'), ch), h('div', {}, h('label', { class: 'f' }, '题型'), ty), h('div', {}, h('label', { class: 'f' }, '数量（1–10）'), nn)), note, b));
    }
  }
  main.append(h('h1', {}, '组卷'), h('p', { class: 'sub cn muted' }, '不配 API Key 也能一键生成标准卷；AI 新出题需要 Key。'), tabs, body, previewBox);
  paintTabs(); paint();
  riseIn([main.querySelector('h1')]);
}

/* ---------- my papers & records ---------- */
export async function papersPage(query, ctx) {
  const main = ctx.shell({ back: '#/', backLabel: '返回书架' });
  const [papers, records] = await Promise.all([GET('/papers'), GET('/attempts')]);
  const kindName = { mock: '标准卷', custom: '自定义', ai: 'AI 出题', wrong: '错题卷' };
  main.append(h('h1', {}, '我的试卷'), h('p', { class: 'sub cn muted' }, '生成过的试卷都在这里，可重做、可导出打印。'),
    h('div', { class: 'row', style: 'margin-bottom:16px' }, h('a', { class: 'btn pri', href: '#/wizard' }, '一键标准卷'), h('a', { class: 'btn', href: '#/wizard?tab=custom' }, '自定义组卷')),
    papers.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['试卷', '类型', '题数/总分', '作答', '最高分', '生成于', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, papers.map((p) => h('tr', {}, h('td', { class: 'cn' }, p.title), h('td', {}, h('span', { class: 'tag' }, kindName[p.kind] || p.kind)), h('td', {}, `${p.count} 题 / ${p.total_score} 分`), h('td', {}, `${p.tries} 次`), h('td', {}, p.best == null ? '—' : p.best),
        h('td', {}, fmtDate(p.created_at)),
        h('td', { style: 'white-space:nowrap' }, h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn sm pri', onclick: async () => { try { const r = await POST('/attempts', { paper_id: p.id }); location.hash = `#/exam/${r.attempt_id}`; } catch (e) { fail(e); } } }, p.doing_id ? '继续' : p.tries ? '重做' : '开始'),
          h('button', { class: 'btn sm', onclick: () => openHtml(`/papers/${p.id}/print`) }, '打印'),
          !p.tries ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('删除试卷', '确定删除这张试卷吗？', { danger: true, ok: '删除' })) { try { await DEL(`/papers/${p.id}`); papersPage(query, ctx); } catch (e) { fail(e); } } } }, '删') : null)))))))
      : h('p', { class: 'cn muted' }, '还没有试卷，去生成一张吧。'),
    h('h2', { style: 'margin-top:40px' }, '成绩记录'),
    records.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['试卷', '状态', '得分', '交卷时间', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, records.map((r) => h('tr', {}, h('td', { class: 'cn' }, r.title, r.kind === 'class_mock' ? h('span', { class: 'tag blue', style: 'margin-left:8px' }, '班级考试') : null),
        h('td', {}, r.status === 'submitted' ? (r.grading === 'pending' ? h('span', { class: 'tag warn' }, 'AI 批改中') : r.grading === 'manual' ? h('span', { class: 'tag warn' }, '主观题待自评') : '已交卷') : h('span', { class: 'tag blue' }, '作答中')),
        h('td', {}, r.status === 'submitted' ? `${r.total_score} / ${r.paper_total}` : '—'), h('td', {}, fmtDate(r.submitted_at)),
        h('td', {}, r.status === 'submitted' ? h('a', { class: 'btn sm', href: `#/report/${r.id}` }, '成绩报告') : h('a', { class: 'btn sm pri', href: `#/exam/${r.id}` }, '继续作答'))))))) : h('p', { class: 'cn muted' }, '暂无成绩记录。'));
}

/* ---------- class exams ---------- */
export async function examsPage(query, ctx) {
  const main = ctx.shell({ back: '#/', backLabel: '返回书架' });
  const list = await GET('/exams');
  const stateTag = { upcoming: ['warn', '未开始'], open: ['ok', '进行中'], closed: ['bad', '已结束'] };
  main.append(h('h1', {}, '班级模拟考试'), h('p', { class: 'sub cn muted' }, '教师发布的统一演练：计时从你进入开始，到时自动交卷；成绩只作练习参考，不计入课程成绩。'),
    list.length ? h('div', { class: 'grid2' }, list.map((e) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h3', { class: 'grow', style: 'margin:0' }, e.title), h('span', { class: 'tag ' + stateTag[e.state][0] }, stateTag[e.state][1])),
      h('p', { class: 'cn', style: 'margin:12px 0' }, `开放时间：${fmtFull(e.start_at)} ～ ${fmtFull(e.end_at)}`, h('br'), `时长 ${e.duration_min} 分钟 · 可作答 ${e.max_attempts} 次 · 已用 ${e.tries.length} 次`),
      h('div', { class: 'row' },
        e.doing ? h('a', { class: 'btn pri', href: `#/exam/${e.doing}` }, '继续作答') : h('button', { class: 'btn pri', disabled: e.state !== 'open' || e.tries.length >= e.max_attempts, onclick: async () => { try { const r = await POST('/attempts', { exam_id: e.id }); location.hash = `#/exam/${r.attempt_id}`; } catch (x) { fail(x); } } }, '进入考试'),
        e.tries.filter((t) => t.status === 'submitted').map((t) => h('a', { class: 'btn sm', href: `#/report/${t.id}` }, `成绩 ${t.total_score}`)))))) : h('p', { class: 'cn muted' }, '目前没有发布给你的班级考试。'));
}

/* ---------- exam runner ---------- */
export async function examRunPage(id, query, ctx) {
  const data = await GET(`/attempts/${id}`);
  if (data.attempt.status === 'submitted') { location.hash = `#/report/${id}`; return; }
  const main = ctx.shell({ back: '#/papers', backLabel: '离开（自动保存）', calm: true });
  const qs = data.questions;
  const answers = {};
  qs.forEach((q) => { if (q.response !== undefined && q.response !== null && q.response !== '' && !(Array.isArray(q.response) && !q.response.some((x) => x))) answers[q.id] = q.response; });
  const lk = `exam-${id}`;
  try { const loc = JSON.parse(localStorage.getItem(lk) || '{}'); for (const [k, v] of Object.entries(loc)) if (answers[k] === undefined) answers[k] = v; } catch { /* ignore */ }
  const flags = new Set(data.attempt.flags || []);
  let idx = Math.min(qs.length - 1, data.attempt.cur_index || 0), dir = 1, dirty = false, saving = false, offset = data.now - Date.now(), deadline = data.attempt.deadline_at, done = false;
  const sections = ['single', 'fill', 'tf', 'essay'].filter((t) => qs.some((q) => q.type === t));

  const timer = h('div', { class: 'timer', role: 'timer', 'aria-label': '剩余时间' }, '--:--:--');
  const saveState = h('span', { class: 'hint', style: 'margin:0' }, '已保存');
  const mask = h('div', { class: 'qmask' });
  const meta = h('div', { class: 'qmeta' });
  const secBar = h('div', { class: 'pills', style: 'margin-bottom:14px' });
  const grid = h('div', { class: 'qgrid' });
  const flagBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => { const q = qs[idx]; flags.has(q.id) ? flags.delete(q.id) : flags.add(q.id); dirty = true; paintSide(); } }, '标记');
  const prev = h('button', { class: 'btn', onclick: () => go(idx - 1, -1) }, '← 上一题');
  const next = h('button', { class: 'btn pri', onclick: () => go(idx + 1, 1) }, '下一题 →');
  const submitBtn = h('button', { class: 'btn line', onclick: () => submit(false) }, '交卷');
  let block = null;

  const has = (q) => { const a = answers[q.id]; return a !== undefined && a !== null && a !== '' && !(Array.isArray(a) && !a.some((x) => String(x).trim())); };
  function paintSide() {
    grid.replaceChildren(...qs.map((q, i) => h('button', { type: 'button', class: [i === idx ? 'cur' : '', has(q) ? 'done' : '', flags.has(q.id) ? 'flag' : ''].join(' '), 'aria-label': `第${i + 1}题${has(q) ? '，已答' : '，未答'}${flags.has(q.id) ? '，已标记' : ''}`, onclick: () => go(i, i > idx ? 1 : -1) }, i + 1)));
    secBar.replaceChildren(...sections.map((t) => {
      const list = qs.filter((q) => q.type === t);
      return h('button', { class: 'pill' + (qs[idx].type === t ? ' on' : ''), type: 'button', onclick: () => go(qs.findIndex((q) => q.type === t), 1) }, `${TYPE[t]} ${list.filter(has).length}/${list.length}`);
    }));
    flagBtn.textContent = flags.has(qs[idx].id) ? '取消标记' : '标记本题';
  }
  function go(i, d) { if (i < 0 || i >= qs.length) return; dir = d || 1; idx = i; dirty = true; render(); }
  function render() {
    const q = qs[idx];
    meta.replaceChildren(h('span', { class: 'lbl' }, `第 ${idx + 1} / ${qs.length} 题`), typeTag(q), h('span', { class: 'tag' }, `${q.points} 分`), flagBtn);
    slideSwap(mask, () => {
      block = questionBlock(q, { mode: 'exam', resp: answers[q.id], onChange: (r) => { answers[q.id] = r; dirty = true; schedule(); paintSide(); } });
      return h('div', {}, block.el);
    }, dir);
    prev.disabled = idx === 0; next.disabled = idx === qs.length - 1;
    paintSide();
  }

  let t1 = 0;
  const schedule = () => { saveState.textContent = '未保存…'; clearTimeout(t1); t1 = setTimeout(save, 1200); };
  async function save() {
    if (saving || done) return;
    saving = true;
    try {
      localStorage.setItem(lk, JSON.stringify(answers));
      const r = await PUT(`/attempts/${id}/answers`, { answers, cur_index: idx, flags: [...flags] });
      if (r.submitted) { done = true; location.hash = `#/report/${id}`; return; }
      offset = r.now - Date.now(); deadline = r.deadline_at; dirty = false; saveState.textContent = '已保存 ' + new Date().toTimeString().slice(0, 8);
    } catch { saveState.textContent = '保存失败，将自动重试'; }
    saving = false;
  }
  const iv30 = setInterval(() => dirty && save(), 30000);
  const tick = setInterval(() => {
    const left = deadline - (Date.now() + offset);
    timer.textContent = fmtDur(left);
    timer.classList.toggle('low', left < 5 * 60000);
    if (left <= 0 && !done) submit(true);
  }, 500);

  async function submit(auto) {
    if (done) return;
    const un = qs.filter((q) => !has(q)).length;
    if (!auto) {
      const ok = await confirmBox('确认交卷？', un ? `还有 ${un} 题未作答（${flags.size ? `另有 ${flags.size} 题已标记` : '未标记题目'}）。交卷后不能再修改。` : '所有题目均已作答，交卷后不能再修改。', { ok: '交卷' });
      if (!ok) return;
    } else toast('时间到，已自动交卷');
    done = true; clearTimeout(t1);
    try {
      await POST(`/attempts/${id}/submit`, { answers });
      localStorage.removeItem(lk);
      await unfold();
      location.hash = `#/report/${id}`;
    } catch (e) { done = false; fail(e); }
  }
  function unfold() { // the "paper unfolds" transition into the result sheet (PRD 6.5)
    if (RM()) return Promise.resolve();
    const s = h('div', { class: 'unfold', style: 'position:fixed;inset:0;z-index:150;background:var(--sheet)' });
    document.body.append(s);
    return new Promise((res) => whenDone(s.animate([{ clipPath: 'inset(46% 40% 46% 40% round 3px)' }, { clipPath: 'inset(0% 0% 0% 0% round 0px)' }], { duration: 650, easing: 'cubic-bezier(.76,0,.18,1)', fill: 'both' }), res, 650));
  }
  const onKey = (e) => {
    if (e.target.matches('input,textarea') || e.ctrlKey || e.metaKey || document.querySelector('.modal-bg')) return;
    if (e.key === 'ArrowRight') go(idx + 1, 1); else if (e.key === 'ArrowLeft') go(idx - 1, -1);
    else if (/^[a-dA-D]$/.test(e.key) && qs[idx].type === 'single') block?.el.querySelectorAll('.opt')[e.key.toUpperCase().charCodeAt(0) - 65]?.click();
  };
  document.addEventListener('keydown', onKey);
  const bu = (e) => { if (!done) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', bu);

  main.append(h('div', { class: 'qwrap' },
    h('div', {}, secBar, meta, mask, h('div', { class: 'footbar' }, prev, next)),
    h('aside', { class: 'qcard-side card' }, h('div', { class: 'lbl muted' }, data.exam?.title || data.paper.title), timer, h('div', { style: 'margin:6px 0 14px' }, saveState),
      grid, h('div', { class: 'legend' }, h('span', {}, '■ 蓝＝已答'), h('span', {}, '▲ 红角＝已标记')), h('div', { style: 'margin-top:18px' }, submitBtn))));
  render();
  timer.textContent = fmtDur(deadline - (Date.now() + offset));
  return () => { clearInterval(iv30); clearInterval(tick); clearTimeout(t1); document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', bu); if (dirty && !done) save(); };
}

/* ---------- report ---------- */
function radar(items) {
  const R = 100, cx = 130, cy = 120, n = items.length;
  if (n < 3) return h('p', { class: 'hint' }, '题目覆盖章节不足 3 个，无法绘制雷达图。');
  const pt = (i, v) => { const a = (-Math.PI / 2) + (2 * Math.PI * i) / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 260 240'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '各章正确率雷达图'); svg.style.cssText = 'width:100%;max-width:340px';
  const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text) e.textContent = text; svg.append(e); return e; };
  [0.25, 0.5, 0.75, 1].forEach((k) => add('polygon', { points: items.map((_, i) => pt(i, k).join(',')).join(' '), fill: 'none', stroke: 'rgba(20,20,20,.25)', 'stroke-width': 1 }));
  items.forEach((it, i) => { const [x, y] = pt(i, 1); add('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: 'rgba(20,20,20,.2)' }); const [tx, ty] = pt(i, 1.17); add('text', { x: tx, y: ty + 3, 'text-anchor': 'middle', 'font-size': 9, fill: '#141414', 'font-family': 'Inter Tight, sans-serif' }, `${it.chapter}`); });
  const poly = add('polygon', { points: items.map((it, i) => pt(i, it.of ? it.got / it.of : 0).join(',')).join(' '), fill: 'rgba(31,63,176,.22)', stroke: '#1F3FB0', 'stroke-width': 1.6 });
  poly.style.transformOrigin = `${cx}px ${cy}px`;
  if (!RM()) poly.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 900, easing: EASE });
  return svg;
}

export async function reportPage(id, query, ctx) {
  const main = ctx.shell({ back: '#/papers', backLabel: '试卷与成绩' });
  let timer = 0, stopped = false;
  const st = await aiStatus();
  const un = document.querySelector('.unfold');
  async function load(first) {
    const d = await GET(`/attempts/${id}/report`);
    if (stopped) return;
    paint(d);
    if (first && un) whenDone(un.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], { duration: 700, easing: EASE, fill: 'both' }), () => un.remove(), 700);
    if (d.attempt.grading === 'pending') timer = setTimeout(() => load(false), 2500);
  }
  function paint(d) {
    const a = d.attempt, r = d.report;
    const essayQs = d.questions.filter((q) => q.type === 'essay');
    const wrongList = d.questions.filter((q) => q.type !== 'essay' && q.is_correct === false);
    const filter = { v: 'all' };
    const list = h('div', {});
    const drawList = () => {
      list.replaceChildren(...d.questions.map((q, i) => ({ q, i })).filter(({ q }) => filter.v === 'all' || (q.type !== 'essay' && q.is_correct === false)).map(({ q, i }) => {
        const b = questionBlock(q, { mode: 'review', resp: q.response, revealed: { answer: q.answer, analysis: q.analysis, is_correct: q.is_correct, score: q.score } });
        return h('div', { class: 'card', style: 'margin-bottom:14px' }, h('div', { class: 'qmeta' }, h('span', { class: 'lbl' }, `第 ${i + 1} 题`), typeTag(q), h('span', { class: 'tag' }, `第${q.chapter}章`)), b.el);
      }));
    };
    const gradeNote = a.grading === 'pending' ? h('span', { class: 'tag warn' }, 'AI 正在批改主观题…') : a.grading === 'manual' ? h('span', { class: 'tag warn' }, '主观题未评分：请对照参考要点自评') : a.grading === 'error' ? h('span', { class: 'tag bad' }, '部分主观题批改失败') : null;
    main.replaceChildren(
      h('div', { class: 'row', style: 'align-items:flex-end' },
        h('div', {}, h('div', { class: 'lbl muted' }, d.exam?.title || d.paper.title), h('h1', { style: 'margin:6px 0 0' }, `${a.total_score}`, h('small', { class: 'lbl muted', style: 'margin-left:10px' }, `/ ${d.paper.total_score} 分`))),
        h('div', { class: 'grow' }), gradeNote),
      h('p', { class: 'cn muted' }, `客观题 ${a.objective_score} 分 · 主观题 ${a.subjective_score} 分 · 用时 ${fmtMin(r.used_ms)} · 交卷于 ${fmtFull(a.submitted_at)}。成绩仅供练习参考，期末笔试由教师人工评分。`),
      h('div', { class: 'grid2', style: 'margin:24px 0' },
        h('div', { class: 'card' }, h('h3', {}, '各题型得分率'), Object.values(r.by_type).map((t) => h('div', { style: 'margin:12px 0' }, h('div', { class: 'row' }, h('span', { class: 'grow cn' }, t.label), h('b', {}, `${t.got} / ${t.of}`)), meter((100 * t.got) / (t.of || 1))))),
        h('div', { class: 'card' }, h('h3', {}, '各章正确率雷达（客观题）'), radar(r.by_chapter), h('p', { class: 'hint' }, r.by_chapter.map((c) => `${c.chapter}.${c.title} ${c.of ? Math.round((100 * c.got) / c.of) : '—'}%`).join('　')))),
      essayQs.length ? h('div', { style: 'margin:8px 0 24px' }, h('h2', {}, '综合分析题'), essayQs.map((q, i) => essayCard(q, i, d, st, () => load(false)))) : null,
      h('div', { class: 'row', style: 'margin:30px 0 14px' }, h('h2', { style: 'margin:0' }, '逐题回看'), h('div', { class: 'grow' }),
        h('button', { class: 'pill on', id: 'f-all', onclick: (e) => { filter.v = 'all'; sw(e.currentTarget); } }, `全部 ${d.questions.length}`),
        h('button', { class: 'pill', onclick: (e) => { filter.v = 'wrong'; sw(e.currentTarget); } }, `只看错题 ${wrongList.length}`)),
      list,
      h('div', { class: 'row', style: 'margin-top:28px' }, h('a', { class: 'btn pri', href: '#/wizard' }, '再组一卷'), h('button', { class: 'btn', onclick: () => openHtml(`/papers/${d.paper.id}/print`) }, '导出试卷与答案'), h('a', { class: 'btn', href: '#/wrong' }, '错题本'), h('a', { class: 'btn', href: '#/' }, '回书架')));
    function sw(btn) { btn.parentElement.querySelectorAll('.pill').forEach((p) => p.classList.toggle('on', p === btn)); drawList(); }
    drawList();
    barGrow(main);
  }
  await load(true);
  return () => { stopped = true; clearTimeout(timer); document.querySelector('.unfold')?.remove(); };
}

function essayCard(q, i, d, st, reload) {
  const score = q.teacher_score ?? q.ai_score ?? q.self_score;
  const manual = d.attempt.grading === 'manual' && q.ai_score == null && q.teacher_score == null;
  const sc = h('input', { class: 'in', type: 'number', min: 0, max: 10, step: 1, style: 'max-width:90px', value: q.self_score ?? '', 'aria-label': '自评得分' });
  return h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'qmeta' }, h('span', { class: 'lbl' }, `综合题 ${i + 1}`), h('span', { class: 'tag' }, `第${q.chapter}章`), score != null ? h('span', { class: 'tag ok' }, `${score} / 10 分${q.teacher_score != null ? '（教师改分）' : q.ai_score != null ? '（AI 评分）' : '（自评）'}`) : h('span', { class: 'tag warn' }, '未评分'), q.flagged ? h('span', { class: 'tag warn' }, '需人工复核') : null),
    h('p', { class: 'qstem', style: 'font-size:17px' }, q.stem),
    h('div', { class: 'analysis', style: 'border-color:var(--ink);background:none' }, h('b', {}, '我的答案\n'), q.response || '（未作答）'),
    q.ai && q.ai.reasons ? h('div', { class: 'ai-box' }, h('b', {}, `AI 评语（${q.ai_score} 分）\n`), (q.ai.dimensions || []).map((x) => `${x.name} ${x.score}/${x.max}`).join(' · '), '\n', q.ai.reasons, '\n', h('b', {}, '建议：'), q.ai.suggestions) : null,
    q.ai?.error ? h('p', { class: 'hint' }, `AI 批改失败：${q.ai.error}`) : null,
    h('div', { class: 'analysis' }, h('b', {}, '参考要点\n'), q.analysis || '—'),
    h('div', { class: 'row' },
      manual ? [h('span', { class: 'lbl' }, '对照要点自评（0–10）'), sc, h('button', { class: 'btn sm pri', onclick: async () => { try { await POST(`/attempts/${d.attempt.id}/self-score`, { qid: q.id, score: sc.value }); toast('已记录自评'); reload(); } catch (e) { fail(e); } } }, '保存自评')] : null,
      h('button', { class: 'btn sm', onclick: () => essayModal(q, q.response || '') }, '更多解析 · AI 点评 / 示范 / 追问')));
}
