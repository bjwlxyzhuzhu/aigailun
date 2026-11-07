import { h, GET, POST, toast, fail, slideSwap, TYPE, modal, meter, barGrow, riseIn, yuan, $ } from '../ui.js';
import { questionBlock, typeTag } from './qui.js';
import { aiStatus, callAI, aiButton } from './aihelp.js';
import { essayModal } from './essay.js';

/* ---------- setup ---------- */
export async function setupPage(query, ctx) {
  const main = ctx.shell({ back: '#/', backLabel: '返回书架' });
  const [shelf, unfinished] = await Promise.all([GET('/shelf'), GET('/practice/unfinished').catch(() => [])]);
  const chapters = shelf.tapes.filter((t) => t.kind === 'chapter');
  const sel = new Set(query.chapter ? [+query.chapter] : []);
  const types = new Set(['single', 'tf', 'fill']);
  let order = query.order || 'random', count = 20;

  const chapPills = chapters.map((c) => {
    const p = h('button', { class: 'pill', type: 'button', 'aria-pressed': sel.has(c.id), onclick: () => { sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); p.setAttribute('aria-pressed', sel.has(c.id)); info(); } }, `第${c.id}章 ${c.title}`, h('span', { class: 'muted', style: 'margin-left:6px;font-size:11px' }, `${c.done}/${c.total}`));
    return p;
  });
  const typePills = [['single', '单选题'], ['tf', '判断题'], ['fill', '填空题'], ['essay', '综合分析题（第7–11章）']].map(([k, label]) => {
    const p = h('button', { class: 'pill', type: 'button', 'aria-pressed': types.has(k), onclick: () => { types.has(k) ? types.delete(k) : types.add(k); p.setAttribute('aria-pressed', types.has(k)); } }, label);
    return p;
  });
  const orders = [['seq', '顺序'], ['random', '随机'], ['undone', '只练未做'], ['wrong', '只练做错']].map(([k, label]) => {
    const p = h('button', { class: 'pill', type: 'button', 'aria-pressed': order === k, onclick: () => { order = k; orders.forEach((x) => x[1].setAttribute('aria-pressed', x[0] === order)); } }, label);
    return [k, p];
  });
  const rng = h('input', { type: 'range', min: 5, max: 100, step: 5, value: count, style: 'width:240px;accent-color:var(--cobalt)', 'aria-label': '题量', oninput: () => { count = +rng.value; lab.textContent = `${count} 题`; } });
  const lab = h('b', { style: 'min-width:60px' }, `${count} 题`);
  const infoEl = h('p', { class: 'hint' });
  const info = () => { const t = chapters.filter((c) => !sel.size || sel.has(c.id)).reduce((s, c) => s + c.total, 0); infoEl.textContent = `所选范围题库约 ${t} 题（含单选/判断/填空/综合）。`; };
  info();
  const start = h('button', { class: 'btn pri', onclick: async () => {
    if (!types.size) return toast('请至少选择一种题型');
    start.disabled = true;
    try { const r = await POST('/practice/start', { chapters: [...sel], types: [...types], count, order }); location.hash = `#/practice/${r.attempt_id}`; } catch (e) { fail(e); start.disabled = false; }
  } }, '开始练习');

  const resume = unfinished.length ? h('div', { class: 'card' }, h('h3', {}, '继续上次'), unfinished.map((u) => h('div', { class: 'row', style: 'margin:8px 0' }, h('div', { class: 'grow cn' }, u.title, h('div', { class: 'hint' }, `已答 ${u.answered}/${u.total}`)), h('a', { class: 'btn sm line', href: `#/practice/${u.id}` }, '继续')))) : null;
  main.append(
    h('h1', {}, '自测练习'), h('p', { class: 'sub cn muted' }, '点选即判，答完立刻看答案与解析；进度自动保存，不限时、不计成绩。'),
    h('div', { class: 'grid2', style: 'grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);align-items:start' },
      h('div', { class: 'card' },
        h('div', { class: 'field' }, h('label', { class: 'f' }, '章节（不选＝全部）'), h('div', { class: 'pills' }, chapPills), infoEl),
        h('div', { class: 'field' }, h('label', { class: 'f' }, '题型'), h('div', { class: 'pills' }, typePills)),
        h('div', { class: 'field' }, h('label', { class: 'f' }, '出题方式'), h('div', { class: 'pills' }, orders.map((x) => x[1]))),
        h('div', { class: 'field' }, h('label', { class: 'f' }, '题量（5–100）'), h('div', { class: 'row' }, rng, lab)),
        start),
      h('div', { class: 'row', style: 'flex-direction:column;align-items:stretch' }, resume,
        h('div', { class: 'card' }, h('h3', {}, '提示'), h('p', { class: 'cn', style: 'margin:0' }, '每次出题都会打乱题目顺序和选项顺序，避免只记住“选 B”。答错的题会自动进入错题本，连续答对 2 次视为掌握。')))));
  riseIn([main.querySelector('h1')]);
}

/* ---------- runner ---------- */
export async function runPage(id, query, ctx) {
  const main = ctx.shell({ back: '#/', backLabel: '返回书架' });
  const data = await GET(`/attempts/${id}`);
  const st = await aiStatus();
  const qs = data.questions;
  if (data.attempt.status === 'submitted') { location.hash = '#/'; return; }
  const answered = (q) => q.response !== undefined && (q.answer !== undefined);
  let idx = Math.min(qs.length - 1, Math.max(0, qs.findIndex((q) => !answered(q))));
  if (idx < 0) idx = 0;
  let block = null, dir = 1;

  const mask = h('div', { class: 'qmask' });
  const meta = h('div', { class: 'qmeta' });
  const grid = h('div', { class: 'qgrid' });
  const prog = h('div', {});
  const prev = h('button', { class: 'btn', onclick: () => go(idx - 1, -1) }, '← 上一题');
  const next = h('button', { class: 'btn pri', onclick: () => (idx === qs.length - 1 ? finish() : go(idx + 1, 1)) }, '下一题 →');
  const fin = h('button', { class: 'btn line', onclick: finish }, '结束练习');

  function refreshSide() {
    const nDone = qs.filter(answered).length, nOk = qs.filter((q) => q.is_correct).length;
    prog.replaceChildren(h('div', { class: 'stat' }, `${nDone}`, h('small', {}, `/ ${qs.length} 已答`)), meter((100 * nDone) / qs.length), h('p', { class: 'hint' }, nDone ? `已判 ${qs.filter((q) => q.is_correct !== undefined && q.type !== 'essay').length} 题，答对 ${nOk} 题` : '开始作答吧'));
    grid.replaceChildren(...qs.map((q, i) => h('button', { type: 'button', class: [i === idx ? 'cur' : '', answered(q) ? (q.type === 'essay' ? 'done' : q.is_correct ? 'right' : 'wrong') : ''].join(' '), 'aria-label': `第${i + 1}题`, onclick: () => go(i, i > idx ? 1 : -1) }, i + 1)));
  }
  function go(i, d) {
    if (i < 0 || i >= qs.length) return;
    dir = d || 1; idx = i; render();
  }
  function render() {
    const q = qs[idx];
    meta.replaceChildren(h('span', { class: 'lbl' }, `第 ${idx + 1} / ${qs.length} 题`), typeTag(q), h('span', { class: 'tag' }, `第${q.chapter}章`), q.source === 'ai' ? h('span', { class: 'tag warn' }, 'AI 生成') : null);
    slideSwap(mask, () => {
      const wrap = h('div', {});
      const done = answered(q);
      block = questionBlock(q, {
        mode: 'practice', resp: q.response,
        revealed: done ? { answer: q.answer, analysis: q.analysis, is_correct: q.is_correct, score: q.score } : null,
        onPick: (r) => submitAnswer(q, r), onSubmit: (r) => submitAnswer(q, r),
      });
      wrap.append(block.el);
      if (done) addExtras(q, block);
      setTimeout(() => block.focus?.(), 30);
      return wrap;
    }, dir);
    prev.disabled = idx === 0;
    next.textContent = idx === qs.length - 1 ? '完成练习' : '下一题 →';
    refreshSide();
  }
  async function submitAnswer(q, resp) {
    try {
      const r = await POST(`/practice/${id}/answer`, { qid: q.id, response: resp, index: idx });
      Object.assign(q, { response: resp, answer: r.answer ?? q.answer, analysis: r.analysis, is_correct: r.correct === undefined ? undefined : r.correct, score: r.got });
      if (q.type === 'essay') { q.answer = null; q.is_correct = null; q.response = resp; }
      block.reveal({ answer: r.answer, analysis: r.analysis, correct: r.correct, got: r.got });
      addExtras(q, block);
      refreshSide();
    } catch (e) { fail(e); }
  }
  function addExtras(q, b) {
    const x = b.extra; x.replaceChildren();
    const row = h('div', { class: 'row', style: 'margin-top:8px' });
    if (q.type === 'essay') {
      row.append(h('button', { class: 'btn pri', onclick: () => essayModal(q, q.response || '') }, '解析 · AI 点评 / 示范 / 追问'));
    } else {
      row.append(aiButton('AI 讲解', st.estimates?.explain, st, async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try { const r = await callAI('/ai/explain', { qid: q.id, answer: q.response }); if (r) x.append(h('div', { class: 'ai-box' }, h('b', {}, 'AI 讲解\n'), r.text, h('div', { class: 'hint' }, `用量 ${r.usage.input_tokens + r.usage.output_tokens} tokens ≈ ${yuan(r.usage.cost_cny)}`))); } catch (err) { fail(err); }
        btn.disabled = false;
      }));
      row.append(h('button', { class: 'btn sm', onclick: async () => { try { await POST(`/wrong-book/${q.id}`, { action: 'add' }); toast('已收藏到错题本'); } catch (e) { fail(e); } } }, '收藏'));
    }
    row.append(h('button', { class: 'btn sm', onclick: async () => { try { await POST(`/questions/${q.id}/report`, { note: '题目或答案有误' }); toast('已反馈给教师，谢谢'); } catch (e) { fail(e); } } }, '题目有误？'));
    x.append(row);
  }
  async function finish() {
    try {
      const r = await POST(`/practice/${id}/finish`);
      const m = modal(h('div', {}, h('h2', {}, '本组练习完成'),
        h('div', { class: 'grid3' }, h('div', {}, h('div', { class: 'stat' }, `${r.answered}`, h('small', {}, `/ ${r.total} 已答`))), h('div', {}, h('div', { class: 'stat' }, `${r.correct}`, h('small', {}, `/ ${r.judged} 答对`))), h('div', {}, h('div', { class: 'stat' }, r.judged ? `${Math.round((100 * r.correct) / r.judged)}%` : '—', h('small', {}, '正确率')))),
        h('div', { class: 'row', style: 'margin-top:24px' }, h('a', { class: 'btn pri', href: '#/practice/setup' }, '再来一组'), h('a', { class: 'btn', href: '#/wrong' }, '查看错题本'), h('a', { class: 'btn', href: '#/' }, '回书架'))));
    } catch (e) { fail(e); }
  }
  const onKey = (e) => {
    if (e.target.matches('input,textarea') || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') go(idx + 1, 1);
    else if (e.key === 'ArrowLeft') go(idx - 1, -1);
    else if (/^[a-dA-D]$/.test(e.key) && qs[idx].type === 'single') $$opt(e.key.toUpperCase().charCodeAt(0) - 65);
    else if (qs[idx].type === 'tf' && (e.key === 'j' || e.key === 'f')) $$opt(e.key === 'j' ? 0 : 1);
  };
  const $$opt = (i) => block?.el.querySelectorAll('.opt')[i]?.click();
  document.addEventListener('keydown', onKey);

  main.append(h('div', { class: 'qwrap' },
    h('div', {}, meta, mask, h('div', { class: 'footbar' }, prev, h('div', { class: 'row' }, fin, next))),
    h('aside', { class: 'qcard-side card' }, h('h3', {}, data.paper.title), prog, h('hr', { class: 'rule' }), grid,
      h('div', { class: 'legend' }, h('span', {}, '■ 绿＝对 ✓'), h('span', {}, '■ 红＝错 ✗'), h('span', {}, '键盘：A–D 选择，← → 切题')))));
  render();
  barGrow(main);
  return () => document.removeEventListener('keydown', onKey);
}
