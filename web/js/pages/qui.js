// One question as DOM: stem + inputs, with optional reveal (✓/✗ icons plus colour, never colour alone).
import { h, LETTERS, TYPE, esc } from '../ui.js';

export const answerLabel = (q) => {
  if (q.type === 'single') return [].concat(q.answer || []).map((k) => LETTERS[q.options.findIndex((o) => o.key === k)]).join('');
  if (q.type === 'tf') return q.answer ? '正确 √' : '错误 ×';
  if (q.type === 'fill') return (q.answer || []).map((s) => s.join(' / ')).join('；');
  return '';
};

/**
 * o: { mode:'practice'|'exam'|'review', resp, onChange(resp), onPick(resp) (practice: immediate judge), onSubmit(resp) (fill/essay in practice) }
 * returns { el, reveal(result), getResp(), extra }
 */
export function questionBlock(q, o = {}) {
  let resp = o.resp ?? (q.type === 'fill' ? Array(q.blank_count).fill('') : null);
  const root = h('div', { class: 'qblock' });
  const stem = h('p', { class: 'qstem' }, q.stem);
  const extra = h('div', { class: 'q-extra' });
  const body = h('div', { class: 'qbody' });
  root.append(stem, body, extra);
  let locked = false;

  const optBtns = [];
  if (q.type === 'single' || q.type === 'tf') {
    const list = q.type === 'single'
      ? q.options.map((op, i) => ({ key: op.key, text: op.text, tag: LETTERS[i] }))
      : [{ key: true, text: '正确', tag: '√' }, { key: false, text: '错误', tag: '×' }];
    list.forEach((it) => {
      const b = h('button', { class: 'opt', type: 'button', 'aria-pressed': 'false', onclick: () => {
        if (locked) return;
        resp = it.key;
        optBtns.forEach((x) => { x.b.classList.toggle('sel', x.it.key === resp); x.b.setAttribute('aria-pressed', x.it.key === resp); });
        o.onChange?.(resp);
        if (o.mode === 'practice') { locked = true; optBtns.forEach((x) => (x.b.disabled = true)); o.onPick?.(resp); }
      } }, h('b', {}, it.tag), h('span', { class: 'cn grow' }, it.text), h('span', { class: 'mk', 'aria-hidden': 'true' }));
      optBtns.push({ b, it });
      body.append(b);
    });
    if (resp != null) optBtns.forEach((x) => { const on = x.it.key === resp; x.b.classList.toggle('sel', on); x.b.setAttribute('aria-pressed', on); });
  } else if (q.type === 'fill') {
    const wrap = h('div', { class: 'blanks' });
    const ins = [];
    for (let i = 0; i < q.blank_count; i++) {
      const inp = h('input', { class: 'in', placeholder: `第 ${i + 1} 空`, value: resp[i] || '', 'aria-label': `第${i + 1}空`, autocomplete: 'off',
        oninput: () => { resp = ins.map((x) => x.value); o.onChange?.(resp); },
        onkeydown: (e) => { if (e.key === 'Enter' && o.mode === 'practice' && !locked) { e.preventDefault(); submit(); } } });
      ins.push(inp);
      wrap.append(h('div', { class: 'blank' }, h('span', { class: 'lbl muted' }, `空 ${i + 1}`), inp));
    }
    body.append(wrap);
    root._ins = ins;
    if (o.mode === 'practice') {
      const sb = h('button', { class: 'btn pri', type: 'button', onclick: () => submit() }, '提交答案');
      body.append(sb); root._sb = sb;
    }
  } else if (q.type === 'essay') {
    const ta = h('textarea', { class: 'in', placeholder: '写下你的分析：观点 → 技术原理或事实 → 案例 → 影响与伦理风险 → 建议/结论（言之有理即可）', value: resp || '', 'aria-label': '作答内容',
      oninput: () => { resp = ta.value; cnt.textContent = `${ta.value.length} 字`; o.onChange?.(resp); } });
    ta.value = resp || '';
    const cnt = h('span', { class: 'hint' }, `${(resp || '').length} 字`);
    body.append(ta, cnt);
    root._ta = ta;
    if (o.mode === 'practice') { const sb = h('button', { class: 'btn pri', type: 'button', style: 'margin-top:10px', onclick: () => submit() }, '提交并查看参考要点'); body.append(h('div', {}, sb)); root._sb = sb; }
  }
  function submit() {
    if (locked) return;
    if (q.type === 'fill' && !resp.some((x) => x.trim())) return;
    if (q.type === 'essay' && !String(resp || '').trim()) return;
    locked = true;
    root._sb && (root._sb.disabled = true);
    o.onSubmit?.(resp);
  }

  function reveal(r) {
    locked = true;
    root._ins?.forEach((i) => (i.disabled = true));
    root._ta && (root._ta.disabled = true);
    root._sb && root._sb.remove();
    const ans = r.answer ?? q.answer;
    if (q.type === 'single' || q.type === 'tf') {
      const rights = q.type === 'single' ? [].concat(ans || []) : [ans];
      optBtns.forEach((x) => {
        x.b.disabled = true;
        const right = rights.includes(x.it.key), chosen = [].concat(resp ?? []).includes(x.it.key);
        x.b.classList.remove('sel');
        if (right) { x.b.classList.add('right'); x.b.querySelector('.mk').textContent = '✓'; }
        else if (chosen) { x.b.classList.add('wrong'); x.b.querySelector('.mk').textContent = '✗'; }
      });
    }
    const ok = r.correct ?? r.is_correct;
    if (q.type === 'fill') {
      body.append(h('p', { class: 'cn', style: 'margin:0 0 8px' }, h('b', {}, '正确答案：'), (ans || []).map((s) => s.join(' / ')).join('；')));
    }
    if (q.type !== 'essay') {
      const got = r.got ?? r.score;
      root.append(h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad'), role: 'status' },
        h('span', { 'aria-hidden': 'true', style: 'font-size:20px' }, ok ? '✓' : '✗'),
        ok ? '回答正确' : (q.type === 'fill' && got > 0 ? `部分正确（${got}/${q.blank_count}）` : (resp == null || (Array.isArray(resp) && !resp.some((x) => x)) ? '未作答' : '回答错误')),
        !ok && q.type === 'single' ? h('span', { class: 'cn muted', style: 'font-weight:400' }, `　正确答案：${answerLabel({ ...q, answer: ans })}`) : null,
        !ok && q.type === 'tf' ? h('span', { class: 'cn muted', style: 'font-weight:400' }, `　正确答案：${ans ? '正确' : '错误'}`) : null));
    }
    const ana = r.analysis ?? q.analysis;
    if (ana) root.append(h('div', { class: 'analysis' }, q.type === 'essay' ? h('b', {}, '参考要点\n') : h('b', {}, '解析\n'), ana));
    root.insertBefore(extra, null);
    root.append(extra);
  }
  if (o.revealed) reveal(o.revealed);
  return { el: root, reveal, getResp: () => resp, extra, focus: () => (root._ins?.[0] || root._ta || optBtns[0]?.b)?.focus({ preventScroll: true }) };
}

export const typeTag = (q) => h('span', { class: 'tag blue' }, TYPE[q.type]);
