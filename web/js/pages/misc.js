import { h, GET, POST, PUT, DEL, toast, fail, riseIn, yuan, fmtDate, confirmBox, esc } from '../ui.js';
import { resetAiStatus } from './aihelp.js';

/* ---------- 复习范围提示页 ---------- */
export async function scopePage(query, ctx) {
  const main = ctx.shell({ back: '#/', backLabel: '返回书架' });
  const d = await GET('/scope');
  const teacher = ctx.me.user.role !== 'student';
  main.append(h('h1', {}, '复习范围'), h('p', { class: 'sub cn' }, d.note),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', {}, '期末笔试结构（100 分 / 90 分钟）'),
        h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['题型', '数量', '每题', '小计'].map((x) => h('th', {}, x)))), h('tbody', {}, d.structure.map((r) => h('tr', {}, r.map((c) => h('td', {}, String(c)))))))),
      h('div', { class: 'card' }, h('h3', {}, '综合分析题答题框架'), h('ol', { class: 'cn', style: 'margin:0;padding-left:20px;line-height:2' }, d.framework.map((x) => h('li', {}, x))), h('p', { class: 'hint' }, '评分口径“言之有理即可”：观点明确、知识准确、有论证和举例、有伦理/影响分析即可得分。'))),
    h('h2', { style: 'margin-top:36px' }, '第 1–11 章核心知识点卡'),
    h('div', { class: 'grid3' }, d.chapters.map((c) => {
      const card = h('div', { class: 'card' }, h('div', { class: 'lbl muted' }, `第 ${c.id} 章 · ${c.title_en}`), h('h3', { style: 'font:400 22px var(--cn);text-transform:none;letter-spacing:0;margin:6px 0 8px' }, c.title), h('p', { class: 'cn', style: 'font-size:14px;margin:0 0 8px' }, c.summary),
        h('ul', { class: 'cn', style: 'padding-left:18px;margin:0;font-size:14px;line-height:1.9' }, c.points.map((p) => h('li', {}, p))),
        c.id >= 7 ? h('span', { class: 'tag blue', style: 'margin-top:10px' }, '含综合分析题') : null);
      if (teacher) card.append(h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: async () => {
        const ta = h('textarea', { class: 'in', value: c.points.join('\n') }); ta.value = c.points.join('\n');
        const { modal } = await import('../ui.js');
        const m = modal(h('div', {}, h('h2', {}, `编辑第 ${c.id} 章知识点卡`), h('p', { class: 'hint' }, '每行一个知识点。'), ta, h('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end' }, h('button', { class: 'btn pri', onclick: async () => { try { await (await import('../ui.js')).PATCH(`/chapters/${c.id}`, { points: ta.value.split('\n').map((x) => x.trim()).filter(Boolean) }); toast('已保存'); m.close(); scopePage(query, ctx); } catch (e) { fail(e); } } }, '保存'))));
      } }, '编辑'));
      return card;
    })));
  riseIn([main.querySelector('h1')]);
}

/* ---------- 我的：个人信息 / AI 设置 / AI 用量 ---------- */
export async function mePage(query, ctx) {
  const main = ctx.shell({ back: '#/', backLabel: ctx.me.user.role === 'student' ? '返回书架' : '返回后台' });
  const me = ctx.me;
  const [ak, usage] = await Promise.all([GET('/me/api-key'), GET('/me/ai-usage')]);
  const cur = ak.key;
  let provider = cur?.provider || 'deepseek';

  // password
  const pErr = h('p', { class: 'cn', style: 'color:var(--bad);margin:0;min-height:20px' });
  const pf = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); pErr.textContent = '';
    if (pf.n.value !== pf.n2.value) return (pErr.textContent = '两次输入的新密码不一致');
    try { await POST('/auth/password', { old: pf.o.value, new: pf.n.value }); toast('密码已更新'); pf.reset(); } catch (x) { pErr.textContent = x.message; }
  } }, h('h3', {}, '修改密码'),
  h('div', { class: 'field' }, h('label', { class: 'f' }, '原密码'), h('input', { class: 'in', name: 'o', type: 'password', required: true, autocomplete: 'current-password' })),
  h('div', { class: 'field' }, h('label', { class: 'f' }, '新密码（≥8 位，含字母和数字）'), h('input', { class: 'in', name: 'n', type: 'password', required: true, autocomplete: 'new-password' })),
  h('div', { class: 'field' }, h('label', { class: 'f' }, '确认新密码'), h('input', { class: 'in', name: 'n2', type: 'password', required: true, autocomplete: 'new-password' })), pErr, h('button', { class: 'btn' }, '更新密码'));

  // AI settings
  const provSel = h('select', { class: 'in', onchange: () => { provider = provSel.value; paintFields(); } }, ak.providers.map((p) => h('option', { value: p.id, selected: p.id === provider }, p.label)));
  const fields = h('div', {});
  const ack = h('input', { type: 'checkbox', id: 'ack', checked: !!cur?.acked });
  const limit = h('input', { class: 'in', type: 'number', min: 0, step: 0.1, value: cur?.daily_limit_cny || 0, style: 'max-width:160px' });
  let baseI, modelI, keyI;
  function paintFields() {
    const P = ak.providers.find((p) => p.id === provider);
    baseI = h('input', { class: 'in', value: cur?.provider === provider ? cur.base_url : P.base, placeholder: 'https://…/v1' });
    modelI = P.models.length ? h('select', { class: 'in' }, P.models.map((m) => h('option', { value: m, selected: cur?.model === m }, m))) : h('input', { class: 'in', value: cur?.provider === provider ? cur.model : '', placeholder: '模型名' });
    keyI = h('input', { class: 'in', type: 'password', autocomplete: 'off', placeholder: cur && cur.provider === provider ? `已保存 ${cur.masked}（留空则不修改）` : 'sk-…' });
    fields.replaceChildren(
      provider === 'mock' ? h('p', { class: 'hint' }, '演示模式不联网、不花钱，返回模拟结果，用于体验 AI 批改与讲解的流程。') : null,
      provider === 'tokenone' ? h('div', { class: 'field' }, h('label', { class: 'f' }, '接口地址（Base URL）'), baseI, h('p', { class: 'hint' }, '按 OpenAI 兼容协议调用，路径为 {Base URL}/chat/completions。中转站默认地址 https://token.agentone.work/v1，Key 请在中转站个人中心创建；可选模型：deepseek-v4.1-flash（推荐）、deepseek-chat。')) : null,
      provider !== 'mock' ? h('div', { class: 'field' }, h('label', { class: 'f' }, '模型'), modelI) : null,
      provider !== 'mock' ? h('div', { class: 'field' }, h('label', { class: 'f' }, 'API Key'), keyI, h('p', { class: 'hint' }, 'Key 只在服务器端使用并加密保存，页面只显示 sk-****后四位；所有调用由后端代理，浏览器不直连模型。')) : null);
  }
  paintFields();
  const body = () => ({ provider, base_url: baseI.value, model: modelI.value, key: keyI?.value || '', ack: ack.checked, daily_limit_cny: +limit.value || 0 });
  const test = h('button', { class: 'btn', type: 'button', onclick: async () => {
    test.disabled = true;
    try { const r = await POST('/me/api-key/test', body()); toast(`连接成功（用量 ${r.usage.input_tokens + r.usage.output_tokens} tokens）`); } catch (e) { fail(e); }
    test.disabled = false;
  } }, '测试连接');
  const save = h('button', { class: 'btn pri', type: 'button', onclick: async () => {
    try { await PUT('/me/api-key', body()); resetAiStatus(); toast('已保存，AI 功能已解锁'); mePage(query, ctx); } catch (e) { fail(e); }
  } }, '保存');
  const del = cur ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmBox('删除个人 Key', '删除后 AI 功能将不可用（除非教师设置了班级 Key）。', { danger: true, ok: '删除' })) { await DEL('/me/api-key'); resetAiStatus(); toast('已删除'); mePage(query, ctx); } } }, '删除我的 Key') : null;
  const ai = h('div', { class: 'card' }, h('h3', {}, 'AI 设置'),
    h('p', { class: 'cn muted', style: 'margin-top:0' }, me.ai.has_key ? `当前可用：${{ user: '个人 Key', class: '班级 Key', global: '公共 Key' }[me.ai.source] || ''}。` : '不配 Key 也能练习、组卷、模拟考、批改客观题；填写后才解锁主观题 AI 批改、AI 讲解、AI 出题和错题诊断。'),
    h('div', { class: 'field' }, h('label', { class: 'f' }, '服务商'), provSel), fields,
    h('div', { class: 'field' }, h('label', { class: 'f' }, '每日花费上限（元，0＝不限）'), limit),
    h('label', { class: 'chk field' }, ack, h('span', {}, '我已知晓：调用 AI 会消耗我的 tokens，费用由我的 Key 所属账户承担；每次调用前会显示预估花费，单次预估超过 ¥0.1 需二次确认。')),
    h('div', { class: 'row' }, test, save, del));

  // pricing + usage
  const price = h('div', { class: 'card' }, h('h3', {}, '预估花费参考（deepseek-flash）'),
    h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['功能', '单次约'].map((x) => h('th', {}, x)))), h('tbody', {}, [['批改 1 道综合分析题', '¥0.006'], ['批改一张卷的 3 道主观题', '¥0.018'], ['AI 讲解 1 道题', '¥0.008'], ['错题诊断（约 30 题）', '¥0.03'], ['AI 生成整张 73 题试卷', '¥0.17']].map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))),
    h('p', { class: 'hint' }, '整个复习期按 50 次讲解、批 5 张模拟卷、生成 2 张 AI 卷、诊断 2 次计，约 ¥0.9。以服务商账单为准。'));
  const u = usage;
  const usageCard = h('div', { class: 'card' }, h('h3', {}, 'AI 用量'),
    h('div', { class: 'grid3' }, h('div', {}, h('div', { class: 'stat' }, yuan(u.total.c)), h('div', { class: 'lbl muted' }, '累计花费')), h('div', {}, h('div', { class: 'stat' }, `${Math.round((u.total.i + u.total.o) / 1000)}k`), h('div', { class: 'lbl muted' }, 'tokens')), h('div', {}, h('div', { class: 'stat' }, yuan(u.today_cost)), h('div', { class: 'lbl muted' }, '今日'))),
    u.recent.length ? h('div', { class: 'tablewrap', style: 'margin-top:16px' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['时间', '功能', '输入', '输出', '花费'].map((x) => h('th', {}, x)))),
      h('tbody', {}, u.recent.map((r) => h('tr', {}, h('td', {}, fmtDate(r.created_at)), h('td', {}, ({ grade: '主观题批改', explain: 'AI 讲解', model: '示范作答', ask: '追问', diagnose: '错题诊断', outline: '章节提纲', generate: 'AI 出题', test: '连接测试' })[r.feature] || r.feature), h('td', { class: 'num' }, r.input_tokens), h('td', { class: 'num' }, r.output_tokens), h('td', { class: 'num' }, yuan(r.actual_cost))))))) : h('p', { class: 'hint' }, '还没有调用记录。'));

  main.append(h('h1', {}, '我的'), h('p', { class: 'sub cn muted' }, `${me.user.name}${me.student_no ? ` · 学号 ${me.student_no}` : ''}${me.class_name ? ` · ${me.class_name}` : ''}`),
    h('div', { class: 'grid2', style: 'align-items:start' }, h('div', { class: 'row', style: 'flex-direction:column;align-items:stretch' }, ai, pf), h('div', { class: 'row', style: 'flex-direction:column;align-items:stretch' }, usageCard, price)));
  riseIn([main.querySelector('h1')]);
}
