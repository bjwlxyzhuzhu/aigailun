import { h, GET, POST, qs, toast, fail, TYPE, fmtDate, openHtml, riseIn, yuan, confirmBox } from '../ui.js';
import { questionBlock, typeTag } from './qui.js';
import { aiStatus, callAI, textModal } from './aihelp.js';

export async function wrongPage(query, ctx) {
  const main = ctx.shell({ back: '#/', backLabel: '返回书架' });
  const shelf = await GET('/shelf');
  const st = await aiStatus();
  const f = { chapter: '', type: '', min: '', mastered: '0', starred: '' };
  const list = h('div', {});
  const head = h('div', { class: 'row', style: 'margin-bottom:6px' });
  const filterBar = h('div', { class: 'row', style: 'margin:18px 0' });

  const sel = (key, opts, label) => {
    const s = h('select', { class: 'in', style: 'width:auto;min-width:130px', 'aria-label': label, onchange: () => { f[key] = s.value; load(); } }, opts.map(([v, l]) => h('option', { value: v }, l)));
    return s;
  };
  filterBar.append(
    sel('chapter', [['', '全部章节'], ...shelf.tapes.filter((t) => t.kind === 'chapter').map((t) => [t.id, `第${t.id}章 ${t.title}`])], '章节'),
    sel('type', [['', '全部题型'], ['single', '单选题'], ['tf', '判断题'], ['fill', '填空题'], ['essay', '综合分析题']], '题型'),
    sel('min', [['', '错误次数不限'], ['2', '错 ≥ 2 次'], ['3', '错 ≥ 3 次']], '错误次数'),
    sel('mastered', [['0', '未掌握'], ['1', '已掌握'], ['all', '全部']], '掌握状态'),
    sel('starred', [['', '全部'], ['1', '仅收藏']], '收藏'));

  async function load() {
    const d = await GET('/wrong-book' + qs(f));
    head.replaceChildren(h('div', { class: 'cn muted' }, `未掌握 ${d.counts.open} 题 · 已掌握 ${d.counts.mastered} 题 · 当前筛选 ${d.items.length} 题`));
    list.replaceChildren(...(d.items.length ? d.items.map((q) => card(q)) : [h('div', { class: 'card cn' }, f.mastered === '0' ? '这里没有错题了，干得漂亮！可以去做一份模拟卷检验一下。' : '没有符合条件的题目。')]));
  }
  function card(q) {
    const b = questionBlock(q, { mode: 'review', resp: q.last_answer, revealed: { answer: q.answer, analysis: q.analysis, is_correct: false } });
    b.el.querySelector('.verdict')?.remove();
    const act = (a, msg) => async () => { try { await POST(`/wrong-book/${q.id}`, { action: a }); toast(msg); load(); } catch (e) { fail(e); } };
    return h('div', { class: 'card', style: 'margin-bottom:14px' },
      h('div', { class: 'qmeta' }, typeTag(q), h('span', { class: 'tag' }, `第${q.chapter}章`), h('span', { class: 'tag bad' }, `错 ${q.wrong_count} 次`), h('span', { class: 'muted cn', style: 'font-size:13px' }, `最近 ${fmtDate(q.last_wrong_at)}`),
        q.mastered ? h('span', { class: 'tag ok' }, '已掌握') : h('span', { class: 'tag' }, `连对 ${q.streak}/2`), q.starred ? h('span', { class: 'tag warn' }, '★ 收藏') : null),
      b.el,
      h('div', { class: 'row', style: 'margin-top:12px' },
        q.mastered ? h('button', { class: 'btn sm', onclick: act('restore', '已移回未掌握') }, '移回未掌握') : h('button', { class: 'btn sm', onclick: act('master', '已标记掌握') }, '标记已掌握'),
        h('button', { class: 'btn sm', onclick: act(q.starred ? 'unstar' : 'star', q.starred ? '已取消收藏' : '已收藏') }, q.starred ? '取消收藏' : '收藏'),
        h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('移除这道错题？', '移除后不再出现在错题本中（之后再答错会重新收录）。', { danger: true, ok: '移除' })) act('remove', '已移除')(); } }, '移除')));
  }
  const retry = h('button', { class: 'btn pri', onclick: async () => { try { const r = await POST('/wrong-book/practice', { filter: { ...f, mastered: '0' } }); location.hash = `#/practice/${r.attempt_id}`; } catch (e) { fail(e); } } }, '错题重练');
  const paper = h('button', { class: 'btn', onclick: async () => { try { const r = await POST('/wrong-book/paper', { filter: { ...f, mastered: '0' } }); toast('已生成错题卷，在“我的试卷”中'); location.hash = '#/papers'; } catch (e) { fail(e); } } }, '错题组卷');
  const diag = h('button', { class: 'btn', disabled: !st.has_key, title: st.has_key ? '' : '在【我的 → AI 设置】填写 API Key 后可用', onclick: async () => {
    diag.disabled = true;
    try { const r = await callAI('/ai/diagnose', {}); if (r) textModal('AI 错题诊断', r.text, h('p', { class: 'hint' }, `本次用量 ${r.usage.input_tokens + r.usage.output_tokens} tokens ≈ ${yuan(r.usage.cost_cny)}`)); } catch (e) { fail(e); }
    diag.disabled = !st.has_key;
  } }, 'AI 错题诊断', st.has_key ? h('span', { class: 'muted', style: 'text-transform:none;letter-spacing:0' }, ` ≈${yuan(st.estimates?.diagnose)}`) : null);
  main.append(h('h1', {}, '我的错题本'), h('p', { class: 'sub cn muted' }, '答错的题自动收录；同一道题连续答对 2 次，视为已掌握并移出。'),
    h('div', { class: 'row' }, retry, paper, h('button', { class: 'btn', onclick: () => openHtml('/wrong-book/print' + qs({ ...f, mastered: '0' })) }, '导出打印（PDF）'), diag),
    filterBar, head, h('div', { style: 'height:12px' }), list);
  await load();
  riseIn([main.querySelector('h1')]);
}
