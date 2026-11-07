import { h, GET, POST, PUT, PATCH, DEL, toast, fail, modal, confirmBox, riseIn, yuan, fmtDate, fmtFull, fileToB64 } from '../ui.js';

const SECTIONS = [['teachers', '教师账号'], ['ai', '全局 Key · 模型 · 价格 · 设置'], ['kb', '知识库（PPT）'], ['usage', 'AI 用量'], ['audit', '操作日志']];
const dash = (v) => (v == null ? '—' : v);

export async function adminPage(...args) {
  const ctx = args[args.length - 1];
  const sub = args.length === 3 ? args[0] : 'teachers';
  const main = ctx.shell({ back: '#/a', backLabel: '管理后台', wide: true });
  main.append(h('div', { class: 'nav-tabs' }, ...SECTIONS.map(([k, l]) => h('a', { href: `#/a/${k}`, class: sub === k ? 'on' : '' }, l)), h('a', { href: '#/t' }, '→ 班级总览 / 题库'),
    h('a', { href: '#/me' }, '我的账号')), h('h1', {}, SECTIONS.find((s) => s[0] === sub)[1]));
  riseIn([main.querySelector('h1')]);
  const body = h('div', {});
  main.append(body);
  await ({ teachers, ai, kb, usage, audit }[sub])(body, ctx);
}

async function teachers(box) {
  const list = await GET('/admin/teachers');
  const reveal = (title, pw) => modal(h('div', {}, h('h2', {}, title), h('p', { class: 'cn' }, '初始密码仅显示这一次，请告知教师（首次登录需修改）：'), h('div', { class: 'ai-box', style: 'font:600 22px var(--sans);letter-spacing:.08em;user-select:all' }, pw)));
  const u = h('input', { class: 'in', placeholder: '工号', style: 'max-width:180px' }), n = h('input', { class: 'in', placeholder: '姓名', style: 'max-width:180px' });
  box.append(h('div', { class: 'card', style: 'margin-bottom:20px' }, h('h3', {}, '新增教师'), h('div', { class: 'row' }, u, n, h('button', { class: 'btn pri', onclick: async () => { try { const r = await POST('/admin/teachers', { username: u.value, name: n.value }); reveal('教师账号已创建', r.initial_password); u.value = n.value = ''; box.replaceChildren(); teachers(box); } catch (e) { fail(e); } } }, '创建'))),
    h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['工号', '姓名', '班级数', '状态', '最近登录', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((t) => h('tr', {}, h('td', {}, t.username), h('td', {}, t.name), h('td', {}, t.classes), h('td', {}, h('span', { class: 'tag ' + (t.status === 'active' ? 'ok' : 'bad') }, t.status === 'active' ? '启用' : '停用')), h('td', {}, t.last_login ? fmtDate(t.last_login) : '从未'),
        h('td', {}, h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn sm', onclick: async () => { if (await confirmBox('重置密码', `重置 ${t.name} 的密码？`, { ok: '重置', danger: true })) { const r = await PATCH(`/admin/teachers/${t.id}`, { reset: true }); reveal('密码已重置', r.initial_password); } } }, '重置密码'),
          h('button', { class: 'btn sm', onclick: async () => { await PATCH(`/admin/teachers/${t.id}`, { status: t.status === 'active' ? 'disabled' : 'active' }); box.replaceChildren(); teachers(box); } }, t.status === 'active' ? '停用' : '启用')))))))));
}

async function ai(box) {
  const [gk, settings, prices, info] = await Promise.all([GET('/admin/global-key'), GET('/admin/settings'), GET('/admin/prices'), GET('/me/api-key')]);
  const key = gk.key;
  let provider = key?.provider || 'deepseek';
  const sel = h('select', { class: 'in', onchange: () => { provider = sel.value; draw(); } }, info.providers.map((p) => h('option', { value: p.id, selected: p.id === provider }, p.label)));
  const f = h('div', {});
  let base, model, k;
  const limit = h('input', { class: 'in', type: 'number', min: 0, step: 1, value: key?.daily_limit_cny || 0, style: 'max-width:160px' });
  const draw = () => {
    const P = info.providers.find((p) => p.id === provider);
    base = h('input', { class: 'in', value: key?.provider === provider ? key.base_url : P.base });
    model = P.models.length ? h('select', { class: 'in' }, P.models.map((x) => h('option', { value: x, selected: key?.model === x }, x))) : h('input', { class: 'in', value: key?.model || '', placeholder: '模型名（待确认）' });
    k = h('input', { class: 'in', type: 'password', autocomplete: 'off', placeholder: key && key.provider === provider ? `已保存 ${key.masked}（留空不修改）` : 'sk-…' });
    f.replaceChildren(provider === 'tokenone' ? h('div', { class: 'field' }, h('label', { class: 'f' }, '接口地址（待确认）'), base) : null, provider !== 'mock' ? h('div', { class: 'field' }, h('label', { class: 'f' }, '模型'), model) : null, provider !== 'mock' ? h('div', { class: 'field' }, h('label', { class: 'f' }, 'API Key'), k) : null);
  };
  draw();
  const gcard = h('div', { class: 'card' }, h('h3', {}, '全局 Key'), h('p', { class: 'cn muted', style: 'margin-top:0' }, '最低优先级：学生个人 Key → 班级 Key → 全局 Key。是否允许学生练习使用全局 Key 见右侧设置。'),
    h('div', { class: 'field' }, h('label', { class: 'f' }, '服务商'), sel), f, h('div', { class: 'field' }, h('label', { class: 'f' }, '全局 Key 每日花费上限（元，0＝不限）'), limit),
    h('div', { class: 'row' },
      h('button', { class: 'btn pri', onclick: async () => { try { await PUT('/admin/global-key', { provider, base_url: base.value, model: model.value, key: k?.value || '', daily_limit_cny: +limit.value || 0 }); toast('已保存'); location.reload(); } catch (e) { fail(e); } } }, '保存'),
      key ? h('button', { class: 'btn', onclick: async (e) => { e.currentTarget.disabled = true; try { const r = await POST('/admin/global-key/test'); toast(`连接成功（${r.usage.input_tokens + r.usage.output_tokens} tokens）`); } catch (x) { fail(x); } e.currentTarget.disabled = false; } }, '测试连接') : null,
      key ? h('button', { class: 'btn danger', onclick: async () => { await DEL('/admin/global-key'); location.reload(); } }, '删除') : null));
  const S = {};
  const inp = (kk, label, type = 'text', hint) => { const i = h('input', { class: 'in', type: type === 'bool' ? 'checkbox' : type, value: settings[kk], checked: type === 'bool' ? !!settings[kk] : undefined, style: type === 'bool' ? '' : 'max-width:240px' }); S[kk] = { i, type }; return h('div', { class: 'field' }, type === 'bool' ? h('label', { class: 'chk' }, i, label) : [h('label', { class: 'f' }, label), i], hint ? h('p', { class: 'hint' }, hint) : null); };
  const scard = h('div', { class: 'card' }, h('h3', {}, '平台设置'),
    inp('final_exam_date', '期末笔试日期（书架首页倒计时）', 'date', '日期待确认，留空则不显示倒计时。'), inp('allow_global_key_for_students', '允许学生练习使用全局 Key', 'bool'), inp('global_daily_limit_cny', '全局 Key 每人每日限额（元）', 'number'),
    inp('default_password_digits', '初始密码取学号后几位', 'number'), inp('college_default', '导入时默认学院'), inp('semester', '学期标识'), inp('ai_concurrency', 'AI 批改并发上限', 'number'),
    h('button', { class: 'btn pri', onclick: async () => { const b = {}; for (const [kk, { i, type }] of Object.entries(S)) b[kk] = type === 'bool' ? i.checked : type === 'number' ? +i.value : i.value; try { await PUT('/admin/settings', b); toast('设置已保存'); } catch (e) { fail(e); } } }, '保存设置'));
  const rows = prices.map((p) => ({ ...p }));
  const num = (p, kk) => h('input', { class: 'in', type: 'number', step: 0.01, value: p[kk], style: 'min-height:32px;padding:4px 8px', oninput: (e) => (p[kk] = +e.target.value) });
  const pcard = h('div', { class: 'card', style: 'grid-column:1/-1' }, h('h3', {}, '价格表（每百万 tokens）'), h('p', { class: 'hint' }, '价格不写死在代码里；中转站价格不同时单独配置。deepseek-v4-pro 的价格为估算值，请按官方定价核对：https://api-docs.deepseek.com/quick_start/pricing'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['服务商', '模型', '输入单价', '输出单价', '币种', '汇率'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((p) => h('tr', {}, h('td', {}, p.provider), h('td', {}, p.model), h('td', {}, num(p, 'input_per_m')), h('td', {}, num(p, 'output_per_m')),
        h('td', {}, h('select', { class: 'in', style: 'min-height:32px;padding:4px 8px', onchange: (e) => (p.currency = e.target.value) }, ['USD', 'CNY'].map((c) => h('option', { value: c, selected: p.currency === c }, c)))), h('td', {}, num(p, 'fx_rate'))))))),
    h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn pri', onclick: async () => { try { await PUT('/admin/prices', { prices: rows }); toast('价格已保存'); } catch (e) { fail(e); } } }, '保存价格')));
  box.append(h('div', { class: 'grid2', style: 'align-items:start' }, gcard, scard, pcard));
}

async function kb(box) {
  const rows = await GET('/admin/kb');
  box.append(h('p', { class: 'cn muted' }, '上传各章讲义 PPTX，抽取文字作为 AI 讲解、出题和提纲的知识库（按页切片）。大文件建议用命令行：node tools/import_kb.mjs <章节号> <pptx路径>。'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['章节', '已入库页数', '上传 PPTX'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => {
        const fi = h('input', { type: 'file', accept: '.pptx', style: 'max-width:240px' });
        const btn = h('button', { class: 'btn sm pri', onclick: async () => {
          if (!fi.files[0]) return toast('请选择 PPTX');
          btn.disabled = true;
          try { const x = await POST('/admin/kb/import', { chapter: r.id, filename: fi.files[0].name, data: await fileToB64(fi.files[0]) }); toast(`第${r.id}章：入库 ${x.slides} 页`); location.reload(); } catch (e) { fail(e); btn.disabled = false; }
        } }, '上传');
        return h('tr', {}, h('td', { class: 'cn' }, `第${r.id}章 ${r.title}`), h('td', {}, r.chunks ? `${r.chunks} 页` : h('span', { class: 'tag warn' }, '未入库')), h('td', {}, h('div', { class: 'row', style: 'gap:8px' }, fi, btn)));
      })))));
}

async function usage(box) {
  const d = await GET('/admin/usage');
  box.append(h('div', { class: 'grid4' }, [['调用次数', d.total.n], ['输入 tokens', d.total.i], ['输出 tokens', d.total.o], ['累计花费', yuan(d.total.c)]].map(([l, v]) => h('div', { class: 'card' }, h('div', { class: 'stat' }, String(v)), h('div', { class: 'lbl muted', style: 'margin-top:6px' }, l)))),
    h('div', { class: 'grid2', style: 'margin-top:20px;align-items:start' },
      h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['功能', '次数', 'tokens', '花费'].map((x) => h('th', {}, x)))), h('tbody', {}, d.by_feature.map((r) => h('tr', {}, h('td', {}, r.feature), h('td', { class: 'num' }, r.n), h('td', { class: 'num' }, r.tokens), h('td', { class: 'num' }, yuan(r.cost))))))),
      h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['日期', '次数', '花费'].map((x) => h('th', {}, x)))), h('tbody', {}, d.by_day.map((r) => h('tr', {}, h('td', {}, r.d), h('td', { class: 'num' }, r.n), h('td', { class: 'num' }, yuan(r.cost)))))))),
    h('h2', { style: 'margin-top:28px' }, '用量最高的用户'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['账号', '姓名', '角色', '次数', 'tokens', '花费'].map((x) => h('th', {}, x)))), h('tbody', {}, d.by_user.map((r) => h('tr', {}, h('td', {}, dash(r.username)), h('td', {}, dash(r.name)), h('td', {}, r.role), h('td', { class: 'num' }, r.n), h('td', { class: 'num' }, r.tokens), h('td', { class: 'num' }, yuan(r.cost))))))));
}

async function audit(box) {
  const rows = await GET('/admin/audit?limit=200');
  box.append(h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['时间', '账号', '操作', '对象', 'IP'].map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, fmtFull(r.created_at)), h('td', {}, dash(r.username)), h('td', {}, r.action), h('td', {}, r.target), h('td', {}, r.ip)))))));
}
