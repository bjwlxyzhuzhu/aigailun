// The 4-option dialog for a comprehensive-analysis question (PRD §5.4).
import { h, modal, toast, fail, yuan } from '../ui.js';
import { aiStatus, callAI } from './aihelp.js';

export async function essayModal(q, myAnswer = '') {
  const st = await aiStatus();
  const est = st.estimates || {};
  const out = h('div', { class: 'cn', style: 'min-height:160px' });
  const tabs = [];
  let current = 'ref';
  const history = [];
  const tabDefs = [
    ['ref', '1 参考要点', '免费'],
    ['review', '2 AI 点评我的答案', st.has_key ? `≈${yuan(est.review)}` : '需 Key'],
    ['model', '3 AI 示范作答', st.has_key ? `≈${yuan(est.model)}` : '需 Key'],
    ['ask', '4 追问 AI', st.has_key ? `≈${yuan(est.ask)}/轮` : '需 Key'],
  ];
  const bar = h('div', { class: 'pills', style: 'margin:0 0 16px' }, tabDefs.map(([id, label, cost]) => {
    const b = h('button', { class: 'pill', type: 'button', disabled: id !== 'ref' && !st.has_key, title: id !== 'ref' && !st.has_key ? '在【我的 → AI 设置】填写 API Key 后可用' : '', onclick: () => show(id) }, `${label}　${cost}`);
    b.style.opacity = '1';
    if (id !== 'ref' && !st.has_key) b.style.color = '#9a968d';
    tabs.push([id, b]);
    return b;
  }));
  const busy = (el, on) => { el.disabled = on; el.dataset.t = el.dataset.t || el.textContent; el.textContent = on ? '处理中…' : el.dataset.t; };

  function show(id) {
    current = id;
    tabs.forEach(([k, b]) => b.classList.toggle('on', k === id));
    out.replaceChildren();
    if (id === 'ref') {
      out.append(h('div', { class: 'analysis' }, q.analysis || '本题暂无参考要点。'),
        h('p', { class: 'hint' }, '评分口径“言之有理即可”：参考要点只作提示，不做关键词硬匹配。答题框架：观点 → 技术原理或事实 → 案例 → 影响与伦理风险 → 建议/结论。'));
    } else if (id === 'review') {
      const btn = h('button', { class: 'btn pri', onclick: async () => {
        busy(btn, true);
        try {
          const r = await callAI('/ai/essay', { qid: q.id, action: 'review', answer: myAnswer });
          if (r) renderGrade(r.grade, r.usage);
        } catch (e) { fail(e); }
        busy(btn, false);
      } }, '开始点评');
      out.append(h('p', {}, myAnswer ? `将点评你刚才写的 ${myAnswer.length} 字答案。AI 分数仅供练习参考，期末笔试由教师人工评分。` : '你还没有写答案，请先在题目下方作答并提交。'), myAnswer ? btn : null);
    } else if (id === 'model') {
      const btn = h('button', { class: 'btn pri', onclick: async () => {
        busy(btn, true);
        try { const r = await callAI('/ai/essay', { qid: q.id, action: 'model' }); if (r) { out.replaceChildren(h('div', { class: 'ai-box' }, r.text), h('p', { class: 'hint' }, `本次用量：输入 ${r.usage.input_tokens} / 输出 ${r.usage.output_tokens} tokens，约 ${yuan(r.usage.cost_cny)}。示范仅供学习思路，请用自己的话写。`)); } } catch (e) { fail(e); }
        busy(btn, false);
      } }, '生成示范作答');
      out.append(h('p', {}, '按“观点–原理–案例–伦理–结论”结构写一份 300–500 字范文。'), btn);
    } else {
      const log = h('div', {});
      const inp = h('input', { class: 'in', placeholder: '就本题向 AI 提问（最多 5 轮）' });
      const send = h('button', { class: 'btn pri', onclick: async () => {
        const text = inp.value.trim(); if (!text) return;
        if (history.filter((x) => x.role === 'user').length >= 5) return toast('追问最多 5 轮');
        busy(send, true);
        try {
          const r = await callAI('/ai/essay', { qid: q.id, action: 'ask', question: text, history, answer: myAnswer });
          if (r) { log.append(h('p', { class: 'muted' }, '你：' + text), h('div', { class: 'ai-box' }, r.text)); history.push({ role: 'user', content: text }, { role: 'assistant', content: r.text }); inp.value = ''; }
        } catch (e) { fail(e); }
        busy(send, false);
      } }, '发送');
      out.append(log, h('div', { class: 'row' }, h('div', { class: 'grow' }, inp), send));
    }
  }
  function renderGrade(g) {
    out.replaceChildren(
      h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', { class: 'stat' }, String(g.score), h('small', {}, '/ 10 分')), g.needs_review ? h('span', { class: 'tag warn' }, '需人工复核') : null),
      h('div', { style: 'margin:12px 0' }, (g.dimensions || []).map((d) => h('div', { style: 'margin:6px 0' }, h('div', { class: 'row' }, h('span', { class: 'grow' }, d.name), h('span', {}, `${d.score}/${d.max}`)), h('div', { class: 'bar-meter' }, h('i', { style: `width:${(100 * d.score) / (d.max || 1)}%` }))))),
      h('div', { class: 'analysis' }, h('b', {}, '评语\n'), g.reasons),
      h('div', { class: 'analysis' }, h('b', {}, '改进建议\n'), g.suggestions),
      g.usage ? h('p', { class: 'hint' }, `本次用量：${g.usage.input_tokens + g.usage.output_tokens} tokens，约 ${yuan(g.usage.cost_cny)}。`) : null);
  }
  modal(h('div', {}, h('h2', {}, '综合分析题解析'), h('p', { class: 'cn muted', style: 'margin:0 0 14px' }, q.stem), bar, out), { wide: true });
  show('ref');
}
