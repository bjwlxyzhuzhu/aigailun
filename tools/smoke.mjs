// End-to-end smoke test: boots a throw-away server (own DATA_DIR) and walks the PRD acceptance paths.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-smoke-'));
for (const f of ['questions.json', 'essays_seed.json', 'kb.json', 'sample_students_gbk.csv']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(tmp, f));
const PORT = 3900 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'server/index.js')], { env: { ...process.env, PORT, DATA_DIR: tmp }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('[ready]') && r()));

const base = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL', m); } };
async function api(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
async function login(u, p) { const r = await api('POST', '/api/auth/login', { username: u, password: p }); return r.j.token; }

try {
  console.log('# 账号');
  let adm = await login('admin', 'Admin@2026');
  ok(!!adm, 'admin 登录');
  ok((await api('GET', '/api/shelf', null, adm)).s === 403, '未改密前被拦截');
  ok((await api('POST', '/api/auth/password', { old: 'Admin@2026', new: 'Admin@2026x1' }, adm)).s === 200, '管理员改密');
  adm = await login('admin', 'Admin@2026x1');
  const t = await api('POST', '/api/admin/teachers', { username: 't001', name: '测试教师' }, adm);
  ok(t.s === 200 && t.j.initial_password, '创建教师');
  let tch = await login('t001', t.j.initial_password);
  await api('POST', '/api/auth/password', { old: t.j.initial_password, new: 'Teacher2026a' }, tch);
  tch = await login('t001', 'Teacher2026a');

  console.log('# 学生导入（GBK CSV）');
  const csv = fs.readFileSync(path.join(tmp, 'sample_students_gbk.csv')).toString('base64');
  const pv = await api('POST', '/api/teacher/students/import', { filename: 's.csv', data: csv, college: '机械工程学院' }, tch);
  ok(pv.j.summary?.ok === 16 && pv.j.summary.classes.length === 2, `预览识别 16 人 2 班 (${JSON.stringify(pv.j.summary)})`);
  const cm = await api('POST', '/api/teacher/students/import', { filename: 's.csv', data: csv, college: '机械工程学院', commit: true }, tch);
  ok(cm.j.committed, '确认导入');
  const again = await api('POST', '/api/teacher/students/import', { filename: 's.csv', data: csv, commit: true }, tch);
  ok(again.j.summary.update === 16 && again.j.summary.create === 0, '重复导入为更新');
  const classes = (await api('GET', '/api/teacher/classes', null, tch)).j;
  ok(classes.length === 2 && classes[0].students > 0, '班级自动创建');

  console.log('# 学生练习');
  let stu = await login('2026100101', 'wrong');
  ok(!stu, '错误密码被拒');
  stu = await login('2026100101', '100101');
  ok(!!stu, '初始密码=学号后6位');
  ok((await api('POST', '/api/auth/password', { old: '100101', new: 'weak' }, stu)).s === 400, '弱密码被拒');
  await api('POST', '/api/auth/password', { old: '100101', new: 'Student2026a' }, stu);
  stu = await login('2026100101', 'Student2026a');
  const shelf = (await api('GET', '/api/shelf', null, stu)).j;
  ok(shelf.tapes.length === 13 && shelf.tapes[6].total > 40, `书架 13 盒带子，第7章题量 ${shelf.tapes[6].total}`);
  const ps = await api('POST', '/api/practice/start', { chapters: [7], types: ['single', 'tf'], count: 10, order: 'random' }, stu);
  const att = (await api('GET', `/api/attempts/${ps.j.attempt_id}`, null, stu)).j;
  ok(att.questions.length === 10 && !('answer' in att.questions[0]), '练习 10 题且不泄露答案');
  const first = att.questions[0];
  const wrongResp = first.type === 'tf' ? null : first.options[0].key;
  const a1 = await api('POST', `/api/practice/${ps.j.attempt_id}/answer`, { qid: first.id, response: first.type === 'tf' ? true : wrongResp }, stu);
  ok(a1.s === 200 && 'answer' in a1.j, '提交后立即判分并返回答案');
  for (const x of att.questions.slice(1, 4)) await api('POST', `/api/practice/${ps.j.attempt_id}/answer`, { qid: x.id, response: x.type === 'tf' ? true : x.options[1].key }, stu);
  const wb = (await api('GET', '/api/wrong-book', null, stu)).j;
  ok(wb.counts.open >= 0, `错题本可读（未掌握 ${wb.counts.open}）`);

  console.log('# 标准卷');
  const gen = await api('POST', '/api/papers/generate', { mode: 'standard' }, stu);
  ok(gen.j.total === 100 && gen.j.count === 73, `标准卷 73 题 100 分 (${gen.j.count}/${gen.j.total})`);
  ok(gen.j.summary.single.n === 50 && gen.j.summary.fill.points === 10 && gen.j.summary.tf.n === 10 && gen.j.summary.essay.n === 3, '50 单选 + 10 空 + 10 判断 + 3 综合');
  for (let i = 0; i < 6; i++) {
    const g = await api('POST', '/api/papers/generate', { mode: 'standard' }, stu);
    if (g.j.total !== 100) { ok(false, '多次组卷总分恒为 100'); break; }
    if (i === 5) ok(true, '多次组卷总分恒为 100');
  }
  const st = await api('POST', '/api/attempts', { paper_id: gen.j.paper_id }, stu);
  const ex = (await api('GET', `/api/attempts/${st.j.attempt_id}`, null, stu)).j;
  ok(ex.questions.every((x) => !('answer' in x)), '考试中不下发答案');
  const essayChapters = new Set(ex.questions.filter((x) => x.type === 'essay').map((x) => x.chapter));
  ok(essayChapters.size === 3 && [...essayChapters].every((c) => c >= 7 && c <= 11), `综合题来自第7-11章三个不同章节 (${[...essayChapters]})`);
  const answers = {};
  for (const x of ex.questions) answers[x.id] = x.type === 'single' ? x.options[0].key : x.type === 'tf' ? true : x.type === 'fill' ? Array(x.blank_count).fill('x') : '大模型存在幻觉问题，需要结合 RAG 与人工复核来缓解，并且应当注意隐私与伦理风险。';
  const sv = await api('PUT', `/api/attempts/${st.j.attempt_id}/answers`, { answers, cur_index: 5 }, stu);
  ok(sv.j.saved, '自动保存');
  const re = (await api('GET', `/api/attempts/${st.j.attempt_id}`, null, stu)).j;
  ok(Object.keys(re.questions.filter((x) => x.response !== undefined)).length === 73 && re.attempt.cur_index === 5, '刷新后可续答');
  const sub = await api('POST', `/api/attempts/${st.j.attempt_id}/submit`, {}, stu);
  ok(sub.j.ok, '交卷');
  const rep = (await api('GET', `/api/attempts/${st.j.attempt_id}/report`, null, stu)).j;
  ok(rep.attempt.status === 'submitted' && rep.questions[0].answer !== undefined, '交卷后可见答案与解析');
  ok(rep.attempt.grading === 'manual', '无 Key 时主观题为“待自评”');
  ok((await api('POST', `/api/attempts/${st.j.attempt_id}/self-score`, { qid: rep.questions.find((x) => x.type === 'essay').id, score: 7 }, stu)).s === 200, '主观题自评');
  const pr = await api('GET', `/api/papers/${gen.j.paper_id}/print`, null, stu);
  ok(typeof pr.j === 'string' && pr.j.includes('答案卷'), '可导出题目卷+答案卷');

  console.log('# AI（演示模式）');
  ok((await api('POST', '/api/ai/explain', { qid: first.id }, stu)).j.code === 'no_key', '无 Key 时 AI 不可用');
  ok((await api('PUT', '/api/me/api-key', { provider: 'mock' }, stu)).s === 400, '未勾选知晓不可保存');
  ok((await api('PUT', '/api/me/api-key', { provider: 'mock', ack: true }, stu)).s === 200, '保存个人 Key');
  ok((await api('POST', '/api/me/api-key/test', {}, stu)).j.ok, '测试连接');
  const exp = await api('POST', '/api/ai/explain', { qid: first.id }, stu);
  ok(exp.s === 200 && exp.j.text, 'AI 讲解');
  const essayQ = rep.questions.find((x) => x.type === 'essay');
  const rv = await api('POST', '/api/ai/essay', { qid: essayQ.id, action: 'review', answer: '大模型的幻觉问题很重要，需要用检索增强生成来缓解，同时要关注隐私与伦理风险，并结合真实案例分析。' }, stu);
  ok(rv.j.grade?.score >= 0 && rv.j.grade.dimensions.length === 4, `AI 点评 ${rv.j.grade?.score} 分`);
  ok((await api('GET', '/api/me/ai-usage', null, stu)).j.total.n >= 2, '用量记账');
  const short = await api('POST', '/api/ai/essay', { qid: essayQ.id, action: 'review', answer: '太短' }, stu);
  ok(short.j.grade.score === 0, '少于 20 字直接 0 分');
  const gq = await api('POST', '/api/ai/generate', { chapter: 7, type: 'single', count: 2 }, stu);
  ok(gq.s === 200 && gq.j.count >= 1, 'AI 出题');

  console.log('# AI 批改主观题（有 Key 的模考）');
  const g2 = await api('POST', '/api/papers/generate', { mode: 'standard' }, stu);
  const a2 = await api('POST', '/api/attempts', { paper_id: g2.j.paper_id }, stu);
  const v2 = (await api('GET', `/api/attempts/${a2.j.attempt_id}`, null, stu)).j; if (!v2.questions) console.log('DEBUG', JSON.stringify(a2), JSON.stringify(v2).slice(0, 200));
  const ans2 = {};
  for (const x of v2.questions.filter((y) => y.type === 'essay')) ans2[x.id] = '大模型会产生幻觉，需要通过检索增强生成和人工核验来缓解，同时必须关注隐私、公平和责任归属等伦理风险，并举出真实案例加以说明。';
  await api('POST', `/api/attempts/${a2.j.attempt_id}/submit`, { answers: ans2 }, stu);
  let rep2;
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 400)); rep2 = (await api('GET', `/api/attempts/${a2.j.attempt_id}/report`, null, stu)).j; if (rep2.attempt.grading !== 'pending') break; }
  ok(rep2.attempt.grading === 'done', `AI 批改完成 (grading=${rep2.attempt.grading})`);
  ok(rep2.questions.filter((q) => q.type === 'essay').every((q) => q.ai_score > 0 && q.ai?.dimensions?.length === 4), '三道综合题均有 AI 分与四维度');
  ok(rep2.attempt.subjective_score > 0 && rep2.attempt.total_score === rep2.attempt.objective_score + rep2.attempt.subjective_score, `总分 = 客观 + 主观 (${rep2.attempt.total_score})`);
  ok(rep2.questions.some((q) => q.type === 'essay' && q.ai_score != null), '主观题分数写入答卷');

  console.log('# 模拟考试由学生自行设置 / 密码规则 / 密钥');
  ok(t.j.initial_password === '123456', '教师默认密码为 123456');
  ok((await api('POST', '/api/teacher/exams', { title: 'x', class_ids: [1], start_at: 1, end_at: 2 }, tch)).s === 410, '后台不再发布班级考试');
  const g45 = await api('POST', '/api/papers/generate', { mode: 'standard', duration_min: 45 }, stu);
  ok(g45.j.duration_min === 45, '学生自选考试时长 45 分钟');
  const a45 = await api('POST', '/api/attempts', { paper_id: g45.j.paper_id }, stu);
  const v45 = (await api('GET', `/api/attempts/${a45.j.attempt_id}`, null, stu)).j;
  ok(Math.abs((v45.attempt.deadline_at - v45.attempt.started_at) - 45 * 60000) < 2000, '截止时间按所选时长计算');
  ok((await api('GET', '/api/admin/global-key', null, adm)).s === 404, '管理员不再设置全局 Key');
  const prov = (await api('GET', '/api/me/api-key', null, stu)).j.providers.find((x) => x.id === 'tokenone');
  ok(prov.base === 'https://token.agentone.work/v1' && prov.models.includes('deepseek-v4.1-flash'), '中转站默认地址与模型');
  ok(!prov.models.some((m) => /flash-p/.test(m)), '不提供越狱类模型');
  const kbRows = (await api('GET', '/api/admin/kb', null, adm)).j;
  ok(kbRows.find((c) => c.id === 8).chunks > 60 + 50, '知识库含第9章 WorkBuddy 新内容');
  ok(kbRows.reduce((s, c) => s + c.chunks, 0) > 811 + 599, '知识库含课后习题');
  const cls0 = (await api('GET', '/api/teacher/classes', null, tch)).j[0];
  ok((await api('POST', `/api/teacher/classes/${cls0.id}/reset-passwords`, {}, tch)).j.count > 0, '教师可重置班级学生密码');
  ok(!!(await login('2026100101', '100101')), '重置后学生可用学号后 6 位登录');


  console.log('# 题库');
  const qs = (await api('GET', '/api/questions?type=essay&size=100', null, tch)).j;
  const byCh = {};
  qs.items.filter((x) => x.status === 'active').forEach((x) => (byCh[x.chapter_id] = (byCh[x.chapter_id] || 0) + 1));
  ok([7, 8, 9, 10, 11].every((c) => byCh[c] >= 6), `第7-11章综合题均≥6 (${JSON.stringify(byCh)})`);
  ok(Object.values(byCh).reduce((a, b) => a + b, 0) >= 30, '综合分析题合计 ≥ 30');
} catch (e) { fail++; console.error('EXCEPTION', e); }
console.log(`\n${pass} passed, ${fail} failed`);
srv.kill();
await new Promise((r) => srv.on('exit', r));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* sqlite handle may linger on Windows; temp dir is disposable */ }
process.exit(fail ? 1 : 0);
