import { h, GET, POST, PUT, PATCH, DEL, qs, toast, fail, modal, confirmBox, meter, barGrow, riseIn, yuan, fmtDate, fmtFull, TYPE, openHtml, download, fileToB64, toLocalInput, LETTERS } from '../ui.js';

const typeName = TYPE;
export function tnav(active, role) {
  const items = [['/t', '班级总览'], ['/t/import', '导入学生'], ['/t/questions', '题库管理'], ['/t/analysis', '题目分析'], ['/t/exams', '班级模拟考试']];
  if (role === 'admin') items.push(['/a', '管理后台']);
  return h('div', { class: 'nav-tabs' }, items.map(([p, l]) => h('a', { href: '#' + p, class: active === p ? 'on' : '' }, l)));
}
const head = (main, ctx, active, title, sub) => {
  main.append(tnav(active, ctx.me.user.role), h('h1', {}, title), sub ? h('p', { class: 'sub cn muted' }, sub) : null);
  riseIn([main.querySelector('h1')]);
};
const dash = (v, f = (x) => x) => (v == null ? '—' : f(v));
const pct = (v) => dash(v, (x) => x + '%');
const sparkline = (arr) => {
  const mx = Math.max(1, ...arr.map((x) => x.n));
  return h('div', { style: 'display:flex;align-items:flex-end;gap:3px;height:36px', 'aria-label': '近14天答题量' }, arr.map((x) => h('i', { title: `${x.d}：${x.n} 题`, style: `display:block;flex:1;background:var(--cobalt);height:${Math.max(2, (36 * x.n) / mx)}px` })));
};

/* ---------- overview ---------- */
export async function overviewPage(query, ctx) {
  const main = ctx.shell({ back: '#/t', backLabel: '后台首页', wide: true });
  head(main, ctx, '/t', '班级总览', '近 7 天活跃、人均练习量、平均正确率与模拟考平均分，用于考前讲评。');
  const cls = await GET('/teacher/classes');
  if (!cls.length) { main.append(h('div', { class: 'card cn' }, '还没有班级。', h('a', { class: 'btn pri', style: 'margin-left:12px', href: '#/t/import' }, '导入学生名单'))); return; }
  main.append(h('div', { class: 'grid3' }, cls.map((c) => h('a', { class: 'card', href: `#/t/class/${c.id}`, style: 'text-decoration:none;display:block' },
    h('div', { class: 'row' }, h('h3', { class: 'grow', style: 'margin:0;font:400 20px var(--cn);text-transform:none;letter-spacing:0' }, c.name), c.has_key ? h('span', { class: 'tag ok' }, '已配班级 Key') : h('span', { class: 'tag' }, '无班级 Key')),
    ctx.me.user.role === 'admin' ? h('div', { class: 'hint' }, `教师：${c.teacher}`) : null,
    h('div', { class: 'grid2', style: 'margin:14px 0;gap:12px' },
      [['人数', c.students], ['近7天活跃', c.active7], ['人均答题', c.per_capita], ['平均正确率', pct(c.acc)], ['模考均分', dash(c.mock_avg)]].map(([l, v]) => h('div', {}, h('div', { class: 'stat', style: 'font-size:30px' }, String(v)), h('div', { class: 'lbl muted', style: 'margin-top:4px' }, l)))),
    sparkline(c.trend)))));
  main.append(h('p', { class: 'hint', style: 'margin-top:24px' }, '点击班级查看学生列表与各章掌握度。'));
}

/* ---------- class detail ---------- */
export async function classPage(id, query, ctx) {
  const main = ctx.shell({ back: '#/t', backLabel: '班级总览', wide: true });
  const [clsAll, students, chs] = await Promise.all([GET('/teacher/classes'), GET(`/teacher/classes/${id}/students`), GET(`/teacher/classes/${id}/chapters`)]);
  const c = clsAll.find((x) => x.id === +id);
  if (!c) { main.append(h('p', {}, '班级不存在')); return; }
  head(main, ctx, '/t', c.name, `${c.students} 人 · 近 7 天活跃 ${c.active7} 人 · 平均正确率 ${pct(c.acc)}`);
  let sort = 'student_no', desc = false, kw = '', flt = '';
  const tbody = h('tbody', {});
  const cols = [['student_no', '学号'], ['name', '姓名'], ['last_login', '最近登录'], ['answered', '累计答题'], ['acc', '正确率'], ['mocks', '模考次数'], ['best', '最高分'], ['wrong', '未掌握错题'], ['weak', '薄弱章节']];
  const ths = cols.map(([k, l]) => h('th', { style: 'cursor:pointer', onclick: () => { desc = sort === k ? !desc : false; sort = k; draw(); } }, l));
  const draw = () => {
    let rows = students.filter((s) => (!kw || s.name.includes(kw) || s.student_no.includes(kw)) && (flt === '' || (flt === 'never' ? !s.last_login : flt === 'low' ? s.answered < 30 : true)));
    rows = rows.slice().sort((a, b) => { const x = a[sort] ?? -1, y = b[sort] ?? -1; return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1); });
    tbody.replaceChildren(...rows.map((s) => h('tr', { style: 'cursor:pointer', onclick: () => studentModal(s.id) },
      h('td', {}, s.student_no), h('td', {}, s.name), h('td', {}, s.last_login ? fmtDate(s.last_login) : h('span', { class: 'tag warn' }, '从未登录')), h('td', { class: 'num' }, s.answered), h('td', { class: 'num' }, pct(s.acc)), h('td', { class: 'num' }, s.mocks), h('td', { class: 'num' }, dash(s.best)), h('td', { class: 'num' }, s.wrong), h('td', {}, s.weak || '—'))));
  };
  const search = h('input', { class: 'in', placeholder: '搜索姓名/学号', style: 'max-width:200px', oninput: () => { kw = search.value.trim(); draw(); } });
  const fsel = h('select', { class: 'in', style: 'width:auto', onchange: () => { flt = fsel.value; draw(); } }, [['', '全部学生'], ['never', '从未登录'], ['low', '练习少于 30 题']].map(([v, l]) => h('option', { value: v }, l)));
  main.append(
    h('div', { class: 'row', style: 'margin-bottom:16px' }, search, fsel, h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => keyModal(+id, c.name) }, '班级 Key'),
      h('button', { class: 'btn', onclick: async () => { if (await confirmBox('重置全班密码', '全班学生的密码将重置为学号后 6 位，并要求下次登录修改。', { ok: '重置', danger: true })) { try { const r = await POST(`/teacher/classes/${id}/reset-passwords`); toast(`已重置 ${r.count} 人`); } catch (e) { fail(e); } } } }, '重置全班密码'),
      h('button', { class: 'btn', onclick: () => download(`/teacher/classes/${id}/export`, `${c.name}-练习情况.csv`) }, '导出 Excel(CSV)'),
      h('a', { class: 'btn pri', href: '#/t/import' }, '导入学生')),
    h('div', { class: 'grid2', style: 'grid-template-columns:minmax(0,2.2fr) minmax(0,1fr);align-items:start' },
      h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ths)), tbody)),
      h('div', { class: 'card' }, h('h3', {}, '各章正确率（全班）'), chs.length ? chs.map((x) => h('div', { style: 'margin:10px 0' }, h('div', { class: 'row' }, h('span', { class: 'grow cn', style: 'font-size:13px' }, `第${x.chapter}章`), h('b', {}, `${x.acc}%`), h('span', { class: 'hint', style: 'margin:0' }, `(${x.answered})`)), meter(x.acc, x.acc < 60 ? 'var(--bad)' : undefined))) : h('p', { class: 'hint' }, '暂无练习数据。'),
        h('p', { class: 'hint' }, '正确率低于 60% 的章节标红，可作为考前讲评重点。'))));
  draw(); barGrow(main);
}

async function studentModal(uid) {
  try {
    const d = await GET(`/teacher/students/${uid}`);
    const kind = { practice: '练习', mock: '自主模考', custom: '自定义卷', class_mock: '班级考试', ai: 'AI 出题', wrong: '错题卷' };
    const m = modal(h('div', {}, h('h2', {}, `${d.student.name}　${d.student.student_no}`), h('p', { class: 'hint' }, `${d.student.class_name} · ${d.student.major || ''} · 最近登录 ${d.student.last_login ? fmtDate(d.student.last_login) : '从未'}`),
      h('div', { class: 'grid2' },
        h('div', {}, h('h3', { class: 'lbl' }, '各章掌握度'), d.chapters.length ? d.chapters.map((x) => h('div', { style: 'margin:8px 0' }, h('div', { class: 'row cn', style: 'font-size:13px' }, h('span', { class: 'grow' }, `第${x.chapter}章 ${x.title}`), h('b', {}, `${x.acc}%`)), meter(x.acc, x.acc < 60 ? 'var(--bad)' : undefined))) : h('p', { class: 'hint' }, '尚无练习数据')),
        h('div', {}, h('h3', { class: 'lbl' }, 'AI 用量'), h('p', { class: 'cn' }, `${d.ai.n} 次 · ${d.ai.tokens} tokens · ${yuan(d.ai.cost)}`), h('h3', { class: 'lbl', style: 'margin-top:16px' }, '高频错题'), d.wrong.length ? d.wrong.slice(0, 6).map((w) => h('p', { class: 'cn', style: 'font-size:13px;margin:4px 0' }, `[第${w.chapter_id}章·错${w.wrong_count}次] ${w.stem.slice(0, 40)}`)) : h('p', { class: 'hint' }, '暂无'))),
      h('h3', { class: 'lbl', style: 'margin-top:18px' }, '作答记录'),
      d.attempts.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('tbody', {}, d.attempts.slice(0, 12).map((a) => h('tr', {}, h('td', { class: 'cn' }, a.title), h('td', {}, kind[a.kind] || a.kind), h('td', {}, a.status === 'submitted' ? a.total_score + ' 分' : '进行中'), h('td', {}, fmtDate(a.started_at)), h('td', {}, a.kind !== 'practice' && a.status === 'submitted' ? h('button', { class: 'btn sm', onclick: () => attemptModal(a.id) }, '查看') : null)))))) : h('p', { class: 'hint' }, '暂无'),
      h('div', { class: 'row', style: 'margin-top:18px' }, h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('重置密码', `将 ${d.student.name} 的密码重置为学号后 6 位？`, { ok: '重置', danger: true })) { try { const r = await POST(`/teacher/students/${uid}/reset-password`); toast(r.hint); } catch (e) { fail(e); } } } }, '重置密码'))), { wide: true });
    barGrow(m.box);
  } catch (e) { fail(e); }
}

export async function attemptModal(aid) {
  try {
    const d = await GET(`/teacher/attempts/${aid}`);
    const essays = d.questions.filter((q) => q.type === 'essay');
    const wrongs = d.questions.filter((q) => q.type !== 'essay' && q.is_correct === false);
    const m = modal(h('div', {}, h('h2', {}, `${d.student.name} · ${d.exam?.title || d.paper.title}`),
      h('p', { class: 'cn' }, `总分 ${d.attempt.total_score}（客观 ${d.attempt.objective_score} + 主观 ${d.attempt.subjective_score}） · 答错 ${wrongs.length} 题`),
      essays.map((q, i) => {
        const inp = h('input', { class: 'in', type: 'number', min: 0, max: 10, step: 1, style: 'max-width:90px', value: q.teacher_score ?? q.ai_score ?? q.self_score ?? '' });
        return h('div', { class: 'card', style: 'margin-bottom:12px' }, h('div', { class: 'lbl' }, `综合题 ${i + 1} · 第${q.chapter}章`), h('p', { class: 'cn' }, q.stem),
          h('div', { class: 'analysis', style: 'border-color:var(--ink);background:none' }, h('b', {}, '学生答案\n'), q.response || '（未作答）'),
          q.ai?.reasons ? h('div', { class: 'ai-box' }, h('b', {}, `AI 评分 ${q.ai_score} 分　`), (q.ai.dimensions || []).map((x) => `${x.name} ${x.score}/${x.max}`).join(' · '), '\n', q.ai.reasons, q.flagged ? '\n⚠ 答案含异常指令，需人工复核' : '') : h('p', { class: 'hint' }, q.ai?.error ? `AI 批改失败：${q.ai.error}` : '尚无 AI 评分'),
          h('div', { class: 'row' }, h('span', { class: 'lbl' }, '教师评分'), inp, h('button', { class: 'btn sm pri', onclick: async () => { try { await PUT(`/teacher/attempts/${aid}/answers/${q.id}`, { teacher_score: inp.value }); toast('已保存评分'); } catch (e) { fail(e); } } }, '保存'), h('span', { class: 'hint' }, '保存后总分自动重算')));
      }),
      wrongs.length ? h('h3', { class: 'lbl' }, '答错的客观题') : null,
      wrongs.slice(0, 30).map((q) => h('p', { class: 'cn', style: 'font-size:13px;margin:4px 0' }, `[第${q.chapter}章·${typeName[q.type]}] ${q.stem.slice(0, 60)}`))), { wide: true });
    return m;
  } catch (e) { fail(e); }
}

function keyModal(classId, name) {
  GET(`/teacher/classes/${classId}/key`).then(async ({ key }) => {
    const info = await GET('/me/api-key');
    let provider = key?.provider || 'deepseek';
    const sel = h('select', { class: 'in', onchange: () => { provider = sel.value; draw(); } }, info.providers.map((p) => h('option', { value: p.id, selected: p.id === provider }, p.label)));
    const f = h('div', {});
    let base, model, k;
    const limit = h('input', { class: 'in', type: 'number', min: 0, step: 0.5, value: key?.daily_limit_cny || 0, style: 'max-width:160px' });
    const draw = () => {
      const P = info.providers.find((p) => p.id === provider);
      base = h('input', { class: 'in', value: key?.provider === provider ? key.base_url : P.base });
      model = P.models.length ? h('select', { class: 'in' }, P.models.map((x) => h('option', { value: x, selected: key?.model === x }, x))) : h('input', { class: 'in', value: key?.model || '' });
      k = h('input', { class: 'in', type: 'password', placeholder: key && key.provider === provider ? `已保存 ${key.masked}（留空不修改）` : 'sk-…', autocomplete: 'off' });
      f.replaceChildren(provider === 'tokenone' ? h('div', { class: 'field' }, h('label', { class: 'f' }, '接口地址'), base) : null, provider !== 'mock' ? h('div', { class: 'field' }, h('label', { class: 'f' }, '模型'), model) : null, provider !== 'mock' ? h('div', { class: 'field' }, h('label', { class: 'f' }, 'API Key'), k) : h('p', { class: 'hint' }, '演示模式不联网，仅展示流程。'));
    };
    draw();
    const m = modal(h('div', {}, h('h2', {}, `班级 Key · ${name}`), h('p', { class: 'cn muted' }, '班级模拟考试的主观题优先使用班级 Key 批改，保证全班口径一致。未配置时，学生对照要点自评。费用由此 Key 所属账户承担。'),
      h('div', { class: 'field' }, h('label', { class: 'f' }, '服务商'), sel), f, h('div', { class: 'field' }, h('label', { class: 'f' }, '每日花费上限（元，0＝不限）'), limit),
      h('div', { class: 'row' }, h('button', { class: 'btn pri', onclick: async () => { try { await PUT(`/teacher/classes/${classId}/key`, { provider, base_url: base.value, model: model.value, key: k?.value || '', daily_limit_cny: +limit.value || 0 }); toast('已保存班级 Key'); m.close(); } catch (e) { fail(e); } } }, '保存'),
        key ? h('button', { class: 'btn danger', onclick: async () => { await DEL(`/teacher/classes/${classId}/key`); toast('已删除'); m.close(); } }, '删除') : null)));
  }).catch(fail);
}

/* ---------- import ---------- */
export async function importPage(query, ctx) {
  const main = ctx.shell({ back: '#/t', backLabel: '后台首页', wide: true });
  head(main, ctx, '/t/import', '导入学生', '支持 CSV（自动识别 GBK / UTF-8）和 Excel(.xlsx)。表头：学号、姓名、班级、专业，可选学院、年级。初始密码为学号后 6 位。');
  let teachers = [];
  if (ctx.me.user.role === 'admin') teachers = await GET('/admin/teachers');
  const file = h('input', { type: 'file', accept: '.csv,.xlsx,.txt', class: 'in' });
  const college = h('input', { class: 'in', value: '机械工程学院', style: 'max-width:260px' });
  const tsel = teachers.length ? h('select', { class: 'in', style: 'max-width:260px' }, h('option', { value: '' }, '归属于我自己'), teachers.map((t) => h('option', { value: t.id }, `${t.name}（${t.username}）`))) : null;
  const out = h('div', { style: 'margin-top:24px' });
  let payload = null;
  const run = async (commit) => {
    if (!file.files[0] && !payload) return toast('请选择文件');
    if (file.files[0]) payload = { filename: file.files[0].name, data: await fileToB64(file.files[0]) };
    const body = { ...payload, college: college.value, teacher_id: tsel?.value || undefined, commit };
    try {
      const r = await POST('/teacher/students/import', body);
      if (r.committed) {
        out.replaceChildren(h('div', { class: 'card' }, h('h3', {}, '导入完成'), h('p', { class: 'cn' }, `成功 ${r.summary.ok} 人（新建 ${r.summary.create}，更新 ${r.summary.update}），跳过 ${r.summary.skipped} 人。班级：${r.summary.classes.join('、')}。初始密码：${r.initial_password_hint}。`), h('div', { class: 'row' }, h('a', { class: 'btn pri', href: '#/t' }, '查看班级'))), r.issues?.length ? issues(r.issues) : null);
        return;
      }
      out.replaceChildren(
        h('div', { class: 'card' }, h('h3', {}, '预览与校验'),
          h('div', { class: 'grid4' }, [['总行数', r.summary.total], ['可导入', r.summary.ok], ['新建账号', r.summary.create], ['更新已有', r.summary.update]].map(([l, v]) => h('div', {}, h('div', { class: 'stat' }, String(v)), h('div', { class: 'lbl muted' }, l)))),
          h('p', { class: 'cn' }, `识别到的班级（将自动创建）：${r.summary.classes.join('、') || '无'}`),
          h('p', { class: 'hint' }, `列映射：${Object.entries(r.mapping).map(([k, i]) => `${{ student_no: '学号', name: '姓名', class_name: '班级', college: '学院', major: '专业', grade: '年级' }[k]}←「${r.header[i] ?? '第' + (i + 1) + '列'}」`).join('　')}`),
          h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['行', '学号', '姓名', '班级', '专业', '状态'].map((x) => h('th', {}, x)))), h('tbody', {}, r.preview.map((p) => h('tr', {}, h('td', {}, p.row), h('td', {}, p.student_no), h('td', {}, p.name), h('td', {}, p.class_name), h('td', {}, p.major), h('td', {}, h('span', { class: 'tag ' + (p.exists ? 'warn' : 'ok') }, p.exists ? '更新' : '新建'))))))),
          r.summary.ok > 15 ? h('p', { class: 'hint' }, `仅显示前 15 行，共 ${r.summary.ok} 行。`) : null,
          h('div', { class: 'row', style: 'margin-top:16px' }, h('button', { class: 'btn pri', disabled: !r.summary.ok, onclick: () => run(true) }, `确认导入 ${r.summary.ok} 人`))),
        r.issues.length ? issues(r.issues) : null);
    } catch (e) { fail(e); }
  };
  const issues = (list) => h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', {}, `问题行（${list.length}，已跳过）`), list.map((i) => h('p', { class: 'cn', style: 'margin:4px 0;color:var(--bad)' }, `第 ${i.row} 行：${i.msg}`)));
  main.append(h('div', { class: 'card' },
    h('div', { class: 'field' }, h('label', { class: 'f' }, '名单文件'), file),
    h('div', { class: 'field' }, h('label', { class: 'f' }, '统一学院（文件无“学院”列时使用）'), college),
    tsel ? h('div', { class: 'field' }, h('label', { class: 'f' }, '班级归属教师'), tsel) : null,
    h('button', { class: 'btn pri', onclick: () => { payload = null; run(false); } }, '上传并预览'),
    h('p', { class: 'hint' }, '已存在的学号会更新姓名/班级，不会重置密码和学习记录。')), out);
}

/* ---------- question bank ---------- */
export async function questionsPage(query, ctx) {
  const main = ctx.shell({ back: '#/t', backLabel: '后台首页', wide: true });
  head(main, ctx, '/t/questions', '题库管理', '课后习题入库后可在线校对、停用、增补；综合分析题第 7–11 章每章建议 ≥ 6 道。');
  const f = { chapter: '', type: '', status: '', source: '', q: '', reported: '', page: 1 };
  const box = h('div', {}), matrix = h('div', {});
  const sel = (key, opts) => { const s = h('select', { class: 'in', style: 'width:auto', onchange: () => { f[key] = s.value; f.page = 1; load(); } }, opts.map(([v, l]) => h('option', { value: v }, l))); return s; };
  const bar = h('div', { class: 'row', style: 'margin:16px 0' },
    sel('chapter', [['', '全部章节'], ...Array.from({ length: 11 }, (_, i) => [i + 1, `第${i + 1}章`])]), sel('type', [['', '全部题型'], ['single', '单选'], ['tf', '判断'], ['fill', '填空'], ['essay', '综合分析']]),
    sel('status', [['', '全部状态'], ['active', '启用'], ['draft', '待校对'], ['disabled', '停用']]), sel('source', [['', '全部来源'], ['textbook', '课后习题'], ['seed', '补充种子题'], ['teacher', '教师录入'], ['ai', 'AI 生成']]),
    sel('reported', [['', '全部'], ['1', '仅被举报']]),
    h('input', { class: 'in', placeholder: '搜索题干', style: 'max-width:200px', onkeydown: (e) => { if (e.key === 'Enter') { f.q = e.target.value; f.page = 1; load(); } } }),
    h('div', { class: 'grow' }),
    h('button', { class: 'btn', onclick: uploadModal }, '上传习题 Word'), h('button', { class: 'btn pri', onclick: () => editModal(null) }, '新增题目'));
  main.append(matrix, bar, box);

  async function load() {
    const d = await GET('/questions' + qs(f));
    const cnt = {};
    d.counts.forEach((c) => ((cnt[c.c] ||= {})[c.t] = c.n));
    matrix.replaceChildren(h('div', { class: 'tablewrap' }, h('table', { class: 'tbl', style: 'font-size:13px' }, h('thead', {}, h('tr', {}, ['章', ...Object.values(['单选', '判断', '填空', '综合'])].map((x) => h('th', {}, x)))),
      h('tbody', {}, Array.from({ length: 11 }, (_, i) => i + 1).map((c) => h('tr', {}, h('td', {}, `第${c}章`), ['single', 'tf', 'fill', 'essay'].map((t) => { const n = cnt[c]?.[t] || 0; const need = t === 'essay' && c >= 7 && n < 6; return h('td', { style: need ? 'color:var(--bad);font-weight:700' : '' }, String(n) + (need ? ' ⚠' : '')); })))))),
    h('p', { class: 'hint' }, `待校对 ${d.drafts} 题 · 解析失败记录 ${d.issues} 条 · ⚠ 表示第 7–11 章综合分析题不足 6 道`));
    box.replaceChildren(h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['#', '章', '题型', '题干', '答案', '状态', '来源', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, d.items.map((q) => h('tr', {}, h('td', {}, q.id), h('td', {}, q.chapter_id), h('td', {}, typeName[q.type]), h('td', { class: 'cn', style: 'max-width:480px' }, q.stem.slice(0, 90), q.reports ? h('span', { class: 'tag bad', style: 'margin-left:6px' }, `被举报${q.reports}`) : null),
        h('td', { class: 'cn' }, q.type === 'single' ? q.answer : q.type === 'tf' ? (q.answer ? '√' : '×') : q.type === 'fill' ? (q.answer || []).map((a) => a.join('/')).join('；') : '—'),
        h('td', {}, h('span', { class: 'tag ' + (q.status === 'active' ? 'ok' : q.status === 'draft' ? 'warn' : 'bad') }, { active: '启用', draft: '待校对', disabled: '停用' }[q.status]), q.scope === 'private' ? h('span', { class: 'tag', style: 'margin-left:4px' }, '私有') : null),
        h('td', {}, { textbook: '习题', seed: '补充', teacher: '教师', ai: 'AI', 'ai-reviewed': 'AI已审' }[q.source] || q.source),
        h('td', { style: 'white-space:nowrap' }, h('button', { class: 'btn sm', onclick: () => editModal(q) }, '编辑'), ' ',
          q.scope === 'private' ? h('button', { class: 'btn sm line', onclick: async () => { await PATCH(`/questions/${q.id}`, { promote: true }); toast('已收入公共题库'); load(); } }, '入库') : h('button', { class: 'btn sm', onclick: async () => { await PATCH(`/questions/${q.id}`, { status: q.status === 'disabled' ? 'active' : 'disabled' }); load(); } }, q.status === 'disabled' ? '启用' : '停用'))))))),
    h('div', { class: 'row', style: 'margin-top:14px' }, h('span', { class: 'hint', style: 'margin:0' }, `共 ${d.total} 题 · 第 ${d.page} 页`),
      h('button', { class: 'btn sm', disabled: d.page <= 1, onclick: () => { f.page--; load(); } }, '上一页'), h('button', { class: 'btn sm', disabled: d.page * d.size >= d.total, onclick: () => { f.page++; load(); } }, '下一页')));
  }
  function editModal(q) {
    const t = q?.type || 'single';
    const ty = h('select', { class: 'in', disabled: !!q }, [['single', '单选题'], ['tf', '判断题'], ['fill', '填空题'], ['essay', '综合分析题']].map(([v, l]) => h('option', { value: v, selected: v === t }, l)));
    const ch = h('select', { class: 'in' }, Array.from({ length: 11 }, (_, i) => h('option', { value: i + 1, selected: q?.chapter_id === i + 1 }, `第${i + 1}章`)));
    const stem = h('textarea', { class: 'in', style: 'min-height:90px' }); stem.value = q?.stem || '';
    const opts = h('textarea', { class: 'in', style: 'min-height:110px', placeholder: '每行一个选项，不要带 A. 前缀' }); opts.value = (q?.options || []).map((o) => o.text).join('\n');
    const ans = h('input', { class: 'in', placeholder: '单选：A/B/C/D；判断：对 或 错；填空：答案1/同义词;答案2' });
    ans.value = q ? (q.type === 'single' ? q.answer : q.type === 'tf' ? (q.answer ? '对' : '错') : q.type === 'fill' ? (q.answer || []).map((a) => a.join('/')).join(';') : '') : '';
    const ana = h('textarea', { class: 'in', style: 'min-height:90px' }); ana.value = q?.analysis || '';
    const stat = h('select', { class: 'in' }, [['active', '启用'], ['draft', '待校对'], ['disabled', '停用']].map(([v, l]) => h('option', { value: v, selected: (q?.status || 'active') === v }, l)));
    const m = modal(h('div', {}, h('h2', {}, q ? `编辑题目 #${q.id}` : '新增题目'),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { class: 'f' }, '题型'), ty), h('div', { class: 'field' }, h('label', { class: 'f' }, '章节'), ch)),
      h('div', { class: 'field' }, h('label', { class: 'f' }, '题干（填空用 ____ 表示空）'), stem),
      h('div', { class: 'field' }, h('label', { class: 'f' }, '选项（仅单选）'), opts),
      h('div', { class: 'field' }, h('label', { class: 'f' }, '答案'), ans),
      h('div', { class: 'field' }, h('label', { class: 'f' }, '解析 / 参考要点'), ana),
      q ? h('div', { class: 'field' }, h('label', { class: 'f' }, '状态'), stat) : null,
      h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn pri', onclick: async () => {
        const type = ty.value;
        const body = { type, chapter_id: +ch.value, stem: stem.value, analysis: ana.value, status: q ? stat.value : undefined };
        if (type === 'single') { body.options = opts.value.split('\n').map((x) => x.trim()).filter(Boolean).map((text, i) => ({ key: LETTERS[i], text })); body.answer = ans.value; }
        else if (type === 'tf') body.answer = /^(对|√|正确|true|t)$/i.test(ans.value.trim());
        else if (type === 'fill') body.answer = ans.value;
        try { q ? await PATCH(`/questions/${q.id}`, body) : await POST('/questions', body); toast('已保存'); m.close(); load(); } catch (e) { fail(e); }
      } }, '保存'))), { wide: true });
  }
  function uploadModal() {
    const fi = h('input', { type: 'file', accept: '.docx', multiple: true, class: 'in' });
    const m = modal(h('div', {}, h('h2', {}, '上传课后习题 Word'), h('p', { class: 'cn muted' }, '文件名需包含“第N章”（如“第7章 大模型.docx”）。按“单选/判断/填空/简答”小节标题识别，已存在的相同题目会跳过；无法解析的进入“待校对”。'), fi,
      h('div', { class: 'row', style: 'margin-top:16px;justify-content:flex-end' }, h('button', { class: 'btn pri', onclick: async (e) => {
        if (!fi.files.length) return toast('请选择文件');
        e.currentTarget.disabled = true;
        try { const files = await Promise.all([...fi.files].map(async (f) => ({ filename: f.name, data: await fileToB64(f) }))); const r = await POST('/questions/upload', { files }); toast(`解析 ${r.parsed} 题：新增 ${r.added}，重复 ${r.duplicates}，待校对 ${r.to_review}`); m.close(); load(); } catch (x) { fail(x); e.currentTarget.disabled = false; }
      } }, '上传并入库'))));
  }
  await load();
}

/* ---------- question analysis ---------- */
export async function analysisPage(query, ctx) {
  const main = ctx.shell({ back: '#/t', backLabel: '后台首页', wide: true });
  head(main, ctx, '/t/analysis', '题目分析', '高错题 Top 20：答题人次、正确率与选项分布。若某个错误选项占比异常高，请检查答案是否有误。');
  const cls = await GET('/teacher/classes');
  const sel = h('select', { class: 'in', style: 'width:auto', onchange: () => load() }, h('option', { value: '' }, '全部班级'), cls.map((c) => h('option', { value: c.id }, c.name)));
  const box = h('div', {});
  main.append(h('div', { style: 'margin-bottom:16px' }, sel), box);
  async function load() {
    const rows = await GET('/teacher/question-stats' + qs({ class: sel.value, limit: 20, min: 3 }));
    box.replaceChildren(rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['章', '题型', '题干', '人次', '正确率', '选项分布 / 正确答案'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.chapter), h('td', {}, typeName[r.type]), h('td', { class: 'cn', style: 'max-width:420px' }, r.stem.slice(0, 80)), h('td', { class: 'num' }, r.n), h('td', { class: 'num' }, h('b', { style: r.rate < 50 ? 'color:var(--bad)' : '' }, r.rate + '%')),
        h('td', { class: 'cn', style: 'font-size:13px' }, r.type === 'single' ? [].concat(r.options.map((o) => `${o.key}:${r.dist[o.key] || 0}${[].concat(r.answer).includes(o.key) ? '✓' : ''}`)).join('　') : r.type === 'tf' ? `√:${r.dist['√'] || 0}　×:${r.dist['×'] || 0}　答案 ${r.answer ? '√' : '×'}` : `参考：${(r.answer || []).map((a) => a.join('/')).join('；')}`)))))) : h('div', { class: 'card cn' }, '作答样本还不够（每题至少 3 人次）。'));
  }
  await load();
}

/* ---------- class mock exams ---------- */
export async function examsPage(query, ctx) {
  const main = ctx.shell({ back: '#/t', backLabel: '后台首页', wide: true });
  head(main, ctx, '/t/exams', '班级模拟考试', '考前统一演练：选班级、设时间窗，统一卷或每人一卷；成绩只作练习参考。');
  const [list, cls] = await Promise.all([GET('/teacher/exams'), GET('/teacher/classes')]);
  const st = { upcoming: ['warn', '未开始'], open: ['ok', '进行中'], closed: ['', '已结束'] };
  main.append(h('div', { class: 'row', style: 'margin-bottom:16px' }, h('button', { class: 'btn pri', onclick: createModal }, '发布班级模拟考试'),
    h('button', { class: 'btn', onclick: async () => { try { const r = await POST('/teacher/papers/standard'); openHtml(`/papers/${r.paper_id}/print`); } catch (e) { fail(e); } } }, '生成并打印一张标准卷（纸质练习）')),
    list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['考试', '班级', '时间窗', '时长', '试卷', '参加/交卷/总数', '状态', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((e) => h('tr', {}, h('td', { class: 'cn' }, e.title), h('td', { class: 'cn' }, e.classes.join('、')), h('td', {}, `${fmtFull(e.start_at)} ～ ${fmtFull(e.end_at)}`), h('td', {}, `${e.duration_min}'`), h('td', {}, e.policy === 'unified' ? '统一卷' : '每人一卷'), h('td', {}, `${e.entered} / ${e.done} / ${e.total}`), h('td', {}, h('span', { class: 'tag ' + st[e.state][0] }, st[e.state][1])),
        h('td', { style: 'white-space:nowrap' }, h('a', { class: 'btn sm pri', href: `#/t/exam/${e.id}` }, '统计'), ' ', e.paper_id ? h('button', { class: 'btn sm', onclick: () => openHtml(`/papers/${e.paper_id}/print`) }, '打印') : null, ' ',
          h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('删除/取消考试', '已有作答记录的考试将被标记为取消。', { danger: true, ok: '确定' })) { await DEL(`/teacher/exams/${e.id}`); examsPage(query, ctx); } } }, '删除'))))))) : h('div', { class: 'card cn' }, '还没有发布过考试。'));
  function createModal() {
    if (!cls.length) return toast('请先导入学生/创建班级');
    const now = new Date(); now.setMinutes(0, 0, 0);
    const title = h('input', { class: 'in', value: '期末考前模拟演练' });
    const start = h('input', { class: 'in', type: 'datetime-local', value: toLocalInput(Date.now() + 3600e3) }), end = h('input', { class: 'in', type: 'datetime-local', value: toLocalInput(Date.now() + 3600e3 * 24 * 3) });
    const dur = h('input', { class: 'in', type: 'number', value: 90, min: 10, max: 180 }), tries = h('input', { class: 'in', type: 'number', value: 1, min: 1, max: 10 });
    const pol = h('select', { class: 'in' }, h('option', { value: 'unified' }, '统一卷（全班同一张）'), h('option', { value: 'per_student' }, '每人一卷（随机抽题）'));
    const picks = cls.map((c) => ({ c, b: h('input', { type: 'checkbox', checked: true }) }));
    const m = modal(h('div', {}, h('h2', {}, '发布班级模拟考试'),
      h('div', { class: 'field' }, h('label', { class: 'f' }, '名称'), title),
      h('div', { class: 'field' }, h('label', { class: 'f' }, '班级'), picks.map((p) => h('label', { class: 'chk' }, p.b, p.c.name))),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { class: 'f' }, '开放开始'), start), h('div', { class: 'field' }, h('label', { class: 'f' }, '开放截止'), end)),
      h('div', { class: 'grid3' }, h('div', { class: 'field' }, h('label', { class: 'f' }, '时长（分钟）'), dur), h('div', { class: 'field' }, h('label', { class: 'f' }, '可作答次数'), tries), h('div', { class: 'field' }, h('label', { class: 'f' }, '试卷方式'), pol)),
      h('p', { class: 'hint' }, '试卷结构固定为 50 单选 + 10 填空 + 10 判断 + 3 综合分析 = 100 分。主观题优先用班级 Key 批改，未配则学生自评。'),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn pri', onclick: async () => {
        try { await POST('/teacher/exams', { title: title.value, class_ids: picks.filter((p) => p.b.checked).map((p) => p.c.id), start_at: new Date(start.value).getTime(), end_at: new Date(end.value).getTime(), duration_min: +dur.value, max_attempts: +tries.value, paper_policy: pol.value }); toast('已发布'); m.close(); examsPage(query, ctx); } catch (e) { fail(e); }
      } }, '发布'))), { wide: true });
  }
}

export async function examDetailPage(id, query, ctx) {
  const main = ctx.shell({ back: '#/t/exams', backLabel: '考试列表', wide: true });
  const d = await GET(`/teacher/exams/${id}/stats`);
  head(main, ctx, '/t/exams', d.exam.title, `${fmtFull(d.exam.start_at)} ～ ${fmtFull(d.exam.end_at)} · ${d.exam.duration_min} 分钟 · ${d.exam.policy === 'unified' ? '统一卷' : '每人一卷'}`);
  const mx = Math.max(1, ...d.buckets.map((b) => b.n));
  main.append(
    h('div', { class: 'row', style: 'margin-bottom:16px' }, h('button', { class: 'btn pri', onclick: () => download(`/teacher/exams/${id}/export`, `${d.exam.title}-成绩表.csv`) }, '导出成绩表 (Excel/CSV)'),
      h('button', { class: 'btn', onclick: async () => { try { const r = await POST(`/teacher/exams/${id}/regrade`); toast(`已重新排队批改 ${r.queued} 份`); } catch (e) { fail(e); } } }, '批改未评分主观题'),
      d.exam.paper_id ? h('button', { class: 'btn', onclick: () => openHtml(`/papers/${d.exam.paper_id}/print`) }, '打印试卷') : null),
    h('div', { class: 'grid4' }, [['应考', d.total], ['已进入', d.entered], ['已交卷', d.done], ['平均分', dash(d.avg)]].map(([l, v]) => h('div', { class: 'card' }, h('div', { class: 'stat' }, String(v)), h('div', { class: 'lbl muted', style: 'margin-top:6px' }, l)))),
    h('div', { class: 'grid2', style: 'margin:20px 0;align-items:start' },
      h('div', { class: 'card' }, h('h3', {}, '分数分布'), d.buckets.map((b) => h('div', { style: 'margin:10px 0' }, h('div', { class: 'row' }, h('span', { class: 'grow' }, b.label), h('b', {}, `${b.n} 人`)), meter((100 * b.n) / mx)))),
      h('div', { class: 'card' }, h('h3', {}, '正确率最低的题（客观题）'), d.low_questions.length ? d.low_questions.slice(0, 8).map((q) => h('p', { class: 'cn', style: 'font-size:13px;margin:6px 0' }, h('b', { style: 'color:var(--bad)' }, `${q.rate}%　`), `[第${q.c}章·${typeName[q.type]}] ${q.stem.slice(0, 44)}`)) : h('p', { class: 'hint' }, '暂无已交卷数据'),
        d.essay.length ? h('p', { class: 'hint' }, '综合题均分：' + d.essay.map((e) => `第${e.c}章 ${e.rate}`).join('；')) : null)),
    h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['班级', '学号', '姓名', '状态', '客观', '主观', '总分', '主观题批改', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, d.rows.map((r) => h('tr', {}, h('td', {}, r.class_name), h('td', {}, r.student_no), h('td', {}, r.name),
        h('td', {}, h('span', { class: 'tag ' + (r.status === 'submitted' ? 'ok' : r.status === 'doing' ? 'blue' : '') }, { submitted: '已交卷', doing: '作答中', none: '未参加' }[r.status])),
        h('td', { class: 'num' }, dash(r.status === 'submitted' ? r.obj : null)), h('td', { class: 'num' }, dash(r.status === 'submitted' ? r.sub : null)), h('td', { class: 'num' }, h('b', {}, dash(r.total))),
        h('td', {}, r.status === 'submitted' ? ({ pending: 'AI 批改中', done: 'AI 已批', manual: '待自评', error: '失败', none: '—' }[r.grading] || '—') : '—'),
        h('td', { style: 'white-space:nowrap' }, r.attempt_id && r.status === 'submitted' ? h('button', { class: 'btn sm', onclick: () => attemptModal(r.attempt_id) }, '答卷/改分') : null, ' ',
          r.status !== 'none' ? h('button', { class: 'btn sm', onclick: async () => { await POST(`/teacher/exams/${id}/reopen`, { user_id: r.id }); toast(`已允许 ${r.name} 再答一次`); } }, '重开') : null)))))));
  barGrow(main);
}
