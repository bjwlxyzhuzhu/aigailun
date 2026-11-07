import { q, tx, P, J, getSetting, KEY_SECRET, audit } from './db.js';
import { get, post, put, patch, del, bad, forbid, notFound, HttpError } from './http.js';
import { hashPasswordAsync, verifyPasswordAsync, signToken, encrypt, maskKey, shuffle } from './lib.js';
import { JWT_SECRET } from './db.js';
import { getQ, getQs, judge, view, composePaper, recordResult, points, TYPE_LABEL, TYPE_ORDER, ComposeError } from './core.js';
import * as AI from './ai.js';
import { MODULES, art } from './seed.js';

const ALL = ['student', 'teacher', 'admin'];
const STU = ['student'];
const MIN90 = 90 * 60 * 1000;

/* ---------- shared helpers (also used by teacher.js) ---------- */
export const classOf = (uid) => q.get('SELECT s.class_id, c.name class_name, s.student_no FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.user_id=?', uid) || {};

export function recompute(attId) {
  const att = q.get('SELECT * FROM attempts WHERE id=?', attId);
  const paper = q.get('SELECT * FROM papers WHERE id=?', att.paper_id);
  const qs = getQs(P(paper.question_ids, []));
  const rows = new Map(q.all('SELECT * FROM answers WHERE attempt_id=?', attId).map((r) => [r.question_id, r]));
  let obj = 0, sub = 0;
  for (const qu of qs) {
    const r = rows.get(qu.id);
    if (!r) continue;
    if (qu.type === 'essay') sub += r.teacher_score ?? r.ai_score ?? r.self_score ?? 0;
    else obj += r.score || 0;
  }
  q.run('UPDATE attempts SET objective_score=?, subjective_score=?, total_score=? WHERE id=?', obj, sub, obj + sub, attId);
  return { obj, sub };
}

export function ownAttempt(user, id) {
  const att = q.get('SELECT * FROM attempts WHERE id=?', id);
  if (!att) throw notFound('答卷不存在');
  if (att.user_id !== user.id && user.role === 'student') throw forbid();
  return att;
}

export function submitAttempt(attId) {
  const att = q.get('SELECT * FROM attempts WHERE id=?', attId);
  if (!att || att.status === 'submitted') return att;
  const paper = q.get('SELECT * FROM papers WHERE id=?', att.paper_id);
  const qs = getQs(P(paper.question_ids, []));
  let needEssay = false;
  tx(() => {
    for (const qu of qs) {
      let r = q.get('SELECT * FROM answers WHERE attempt_id=? AND question_id=?', attId, qu.id);
      const resp = r ? P(r.response) : null;
      if (qu.type === 'essay') {
        if (!r) q.run('INSERT INTO answers(attempt_id,question_id,response,updated_at) VALUES(?,?,?,?)', attId, qu.id, J(''), Date.now());
        needEssay = true;
        continue;
      }
      const j = judge(qu, resp);
      if (!r) q.run('INSERT INTO answers(attempt_id,question_id,response,is_correct,score,updated_at) VALUES(?,?,?,?,?,?)', attId, qu.id, J(resp), j.correct ? 1 : 0, j.got, Date.now());
      else q.run('UPDATE answers SET is_correct=?, score=? WHERE attempt_id=? AND question_id=?', j.correct ? 1 : 0, j.got, attId, qu.id);
      if (att.kind !== 'practice') recordResult(att.user_id, qu, j.correct, resp, att.kind);
    }
    q.run("UPDATE attempts SET status='submitted', submitted_at=?, grading=? WHERE id=?", Date.now(), needEssay ? 'pending' : 'none', attId);
    recompute(attId);
  });
  if (needEssay) startEssayGrading(attId);
  return q.get('SELECT * FROM attempts WHERE id=?', attId);
}

export function startEssayGrading(attId) {
  const att = q.get('SELECT * FROM attempts WHERE id=?', attId);
  const user = q.get('SELECT id,role FROM users WHERE id=?', att.user_id);
  const key = AI.resolveKey(user, { classId: classOf(att.user_id).class_id, preferClass: !!att.exam_id });
  if (!key) { q.run("UPDATE attempts SET grading='manual' WHERE id=?", attId); return; }
  (async () => {
    let failed = false;
    const rows = q.all("SELECT a.*, qu.id qid FROM answers a JOIN questions qu ON qu.id=a.question_id WHERE a.attempt_id=? AND qu.type='essay'", attId);
    await Promise.all(rows.map(async (r) => {
      const qu = getQ(r.question_id);
      try {
        const g = await AI.gradeEssay(key, att.user_id, qu, P(r.response, ''));
        q.run('UPDATE answers SET ai_score=?, ai_feedback=?, flagged=? WHERE attempt_id=? AND question_id=?', g.score, J(g), g.needs_review ? 1 : 0, attId, r.question_id);
        recordResult(att.user_id, qu, g.score >= 6, P(r.response), att.kind);
      } catch (e) {
        failed = true;
        q.run('UPDATE answers SET ai_feedback=? WHERE attempt_id=? AND question_id=?', J({ error: e.message }), attId, r.question_id);
      }
    }));
    recompute(attId);
    q.run('UPDATE attempts SET grading=? WHERE id=?', failed ? 'error' : 'done', attId);
  })().catch((e) => { console.error('[grading]', e); q.run("UPDATE attempts SET grading='error' WHERE id=?", attId); });
}
export function expireIfNeeded(att) {
  if (att.status === 'doing' && att.kind !== 'practice' && att.deadline_at && Date.now() > att.deadline_at + 3000) return submitAttempt(att.id);
  return att;
}
export function sweepExpired() {
  for (const a of q.all("SELECT * FROM attempts WHERE status='doing' AND kind!='practice' AND deadline_at<?", Date.now() - 3000)) submitAttempt(a.id);
}

export function attemptView(att, { forceReveal = false } = {}) {
  const paper = q.get('SELECT * FROM papers WHERE id=?', att.paper_id);
  const layout = P(paper.layout, {});
  const qs = getQs(P(paper.question_ids, []));
  const rows = new Map(q.all('SELECT * FROM answers WHERE attempt_id=?', att.id).map((r) => [r.question_id, r]));
  const done = att.status === 'submitted' || forceReveal;
  const questions = qs.map((qu) => {
    const r = rows.get(qu.id);
    const reveal = done || (att.kind === 'practice' && r && r.is_correct !== null && qu.type !== 'essay') || (att.kind === 'practice' && r && qu.type === 'essay');
    const v = view(qu, layout, reveal);
    if (r) {
      v.response = P(r.response);
      if (reveal) { v.is_correct = r.is_correct === null ? null : !!r.is_correct; v.score = r.score; }
      if (done && qu.type === 'essay') {
        v.ai = P(r.ai_feedback); v.ai_score = r.ai_score; v.teacher_score = r.teacher_score; v.self_score = r.self_score; v.flagged = !!r.flagged;
      }
    }
    return v;
  });
  const exam = att.exam_id ? q.get('SELECT id,title FROM exams WHERE id=?', att.exam_id) : null;
  return {
    attempt: { id: att.id, kind: att.kind, status: att.status, started_at: att.started_at, deadline_at: att.deadline_at, submitted_at: att.submitted_at, cur_index: att.cur_index, flags: P(att.flags, []), grading: att.grading,
      objective_score: att.objective_score, subjective_score: att.subjective_score, total_score: att.total_score },
    paper: { id: paper.id, title: paper.title, kind: paper.kind, total_score: paper.total_score, config: P(paper.config, {}) },
    exam, questions, now: Date.now(),
  };
}

export function newPaper(ownerId, kind, title, comp, config, examId = null) {
  return q.run('INSERT INTO papers(owner_id,kind,title,config,question_ids,layout,total_score,exam_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ownerId, kind, title, J(config), J(comp.ids), J(comp.layout), comp.total, examId, Date.now()).lastInsertRowid;
}
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`; };

/* ---------- print HTML ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function paperHtml(paper, { answers = true, studentName = '' } = {}) {
  const layout = P(paper.layout, {});
  const qs = getQs(P(paper.question_ids, []));
  const letters = 'ABCDEFGH';
  const groups = TYPE_ORDER.map((t) => [t, qs.filter((x) => x.type === t)]).filter(([, a]) => a.length);
  const cn = '一二三四五六';
  let n = 0;
  const body = (ans) => groups.map(([t, arr], gi) => {
    const pt = arr.reduce((s, x) => s + points(x), 0);
    return `<h2>${cn[gi]}、${TYPE_LABEL[t]}（共 ${arr.length} 题，${pt} 分）</h2>` + arr.map((qu) => {
      n++;
      let h = `<div class="q"><p><b>${n}.</b> ${esc(qu.stem)}${qu.type === 'tf' ? ' （　　）' : ''}${qu.type === 'essay' ? '（10分）' : ''}</p>`;
      if (qu.type === 'single') {
        const order = (layout[qu.id] || qu.options.map((o) => o.key)).map((k) => qu.options.find((o) => o.key === k));
        h += '<ol class="opts">' + order.map((o, i) => `<li>${letters[i]}．${esc(o.text)}</li>`).join('') + '</ol>';
        if (ans) h += `<p class="ans">答案：${letters[order.findIndex((o) => [].concat(qu.answer).includes(o.key))]}</p>`;
      } else if (qu.type === 'tf' && ans) h += `<p class="ans">答案：${qu.answer ? '√' : '×'}</p>`;
      else if (qu.type === 'fill' && ans) h += `<p class="ans">答案：${(qu.answer || []).map((s) => s.join(' / ')).join('；')}</p>`;
      else if (qu.type === 'essay') h += ans ? `<p class="ans">参考要点：${esc(qu.analysis)}</p>` : '<div class="lines"></div>';
      if (ans && qu.analysis && qu.type !== 'essay') h += `<p class="ana">解析：${esc(qu.analysis)}</p>`;
      return h + '</div>';
    }).join('');
  }).join('');
  const sections = [`<section><h1>《人工智能概论》${esc(paper.title)} · 题目卷</h1><p class="meta">总分 ${paper.total_score} 分　时间 90 分钟　姓名：${esc(studentName)}　学号：________</p>${(n = 0, body(false))}</section>`];
  if (answers) sections.push(`<section class="brk"><h1>《人工智能概论》${esc(paper.title)} · 答案卷</h1>${(n = 0, body(true))}</section>`);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(paper.title)}</title><style>
  body{font:14px/1.7 "Microsoft YaHei","PingFang SC",serif;color:#111;max-width:760px;margin:24px auto;padding:0 20px}
  h1{font-size:20px;text-align:center;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px;border-bottom:1px solid #111}
  .meta{text-align:center;color:#444;margin:0 0 12px}.q{margin:0 0 8px;break-inside:avoid}.q p{margin:2px 0}
  .opts{list-style:none;padding:0 0 0 18px;margin:2px 0;display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
  .ans{color:#1F3FB0;margin:2px 0}.ana{color:#555;font-size:12.5px;margin:2px 0}.lines{height:150px;border-bottom:1px dashed #999}
  .brk{break-before:page}.bar{position:fixed;right:16px;top:12px}@media print{.bar{display:none}body{margin:0}}
  </style><div class="bar"><button onclick="print()">打印 / 另存为 PDF</button></div>${sections.join('')}</html>`;
}

/* ---------- auth ---------- */
post('/api/auth/login', false, async ({ body, ip }) => {
  const u = q.get('SELECT * FROM users WHERE username=?', String(body.username || '').trim());
  if (!u || u.status !== 'active') throw new HttpError(401, '账号或密码错误');
  if (u.locked_until > Date.now()) throw new HttpError(429, `登录失败次数过多，请 ${Math.ceil((u.locked_until - Date.now()) / 60000)} 分钟后再试`);
  if (!(await verifyPasswordAsync(String(body.password || ''), u.password_hash))) {
    const f = (q.get('SELECT fail_count FROM users WHERE id=?', u.id)?.fail_count ?? u.fail_count) + 1;
    q.run('UPDATE users SET fail_count=?, locked_until=? WHERE id=?', f >= 5 ? 0 : f, f >= 5 ? Date.now() + 15 * 60000 : 0, u.id);
    audit(u.id, 'login_fail', u.username, ip);
    throw new HttpError(401, f >= 5 ? '连续失败 5 次，账号已锁定 15 分钟' : '账号或密码错误');
  }
  q.run('UPDATE users SET fail_count=0, locked_until=0, last_login=? WHERE id=?', Date.now(), u.id);
  audit(u.id, 'login', u.username, ip);
  return { token: signToken({ uid: u.id, role: u.role }, JWT_SECRET), user: { id: u.id, name: u.name, role: u.role, username: u.username, must_change_pwd: !!u.must_change_pwd } };
});
post('/api/auth/password', ALL, async ({ body, user, ip }) => {
  const u = q.get('SELECT * FROM users WHERE id=?', user.id);
  if (!(await verifyPasswordAsync(String(body.old || ''), u.password_hash))) throw bad('原密码不正确');
  const np = String(body.new || '');
  if (np.length < 8 || !/[A-Za-z]/.test(np) || !/\d/.test(np)) throw bad('新密码至少 8 位，且同时包含字母和数字');
  if (np === body.old) throw bad('新密码不能与原密码相同');
  q.run('UPDATE users SET password_hash=?, must_change_pwd=0 WHERE id=?', await hashPasswordAsync(np), user.id);
  audit(user.id, 'change_password', user.username, ip);
  return { ok: true };
}, { allowMustChange: true });

get('/api/me', ALL, ({ user }) => {
  const c = classOf(user.id);
  const key = q.get("SELECT * FROM api_keys WHERE scope='user' AND owner_id=?", user.id);
  const eff = AI.resolveKey(user, { classId: c.class_id });
  return {
    user: { ...user, must_change_pwd: !!user.must_change_pwd }, class_name: c.class_name || null, student_no: c.student_no || null,
    final_exam_date: getSetting('final_exam_date', ''), ai: { has_key: !!eff, source: eff?.scope || null, own: AI.keyBrief(key) },
  };
}, { allowMustChange: true });

/* ---------- shelf & chapters ---------- */
function progressFor(uid) {
  const tot = Object.fromEntries(q.all("SELECT chapter_id c, COUNT(*) n FROM questions WHERE status='active' AND scope='all' GROUP BY chapter_id").map((r) => [r.c, r.n]));
  const done = Object.fromEntries(q.all(`SELECT qu.chapter_id c, COUNT(DISTINCT a.question_id) d, SUM(COALESCE(a.is_correct,0)) ok, COUNT(a.is_correct) n
    FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN questions qu ON qu.id=a.question_id WHERE t.user_id=? AND qu.scope='all' GROUP BY qu.chapter_id`, uid).map((r) => [r.c, r]));
  const wrong = Object.fromEntries(q.all(`SELECT qu.chapter_id c, COUNT(*) n FROM wrong_book w JOIN questions qu ON qu.id=w.question_id WHERE w.user_id=? AND w.mastered=0 GROUP BY qu.chapter_id`, uid).map((r) => [r.c, r.n]));
  return { tot, done, wrong };
}
get('/api/shelf', ALL, ({ user }) => {
  const p = progressFor(user.id);
  const chapters = q.all('SELECT * FROM chapters ORDER BY id');
  const tapes = chapters.map((c) => {
    const d = p.done[c.id] || { d: 0, ok: 0, n: 0 };
    return { id: c.id, kind: 'chapter', title: c.title, en: c.title_en, label: `第 ${c.id} 章`, module: c.module, spine_url: c.spine_url, cover_url: c.cover_url,
      summary: c.summary, points: P(c.points, []), total: p.tot[c.id] || 0, done: d.d, acc: d.n ? Math.round((100 * d.ok) / d.n) : null, wrong: p.wrong[c.id] || 0 };
  });
  const wrongAll = Object.values(p.wrong).reduce((a, b) => a + b, 0);
  const mock = q.get("SELECT COUNT(*) n, MAX(total_score) best FROM attempts WHERE user_id=? AND kind!='practice' AND status='submitted'", user.id);
  tapes.push({ id: 12, kind: 'mock', title: '模拟考试', en: 'MOCK EXAM', label: '备考', module: 'exam', ...art(11), summary: '与期末笔试同结构：50 单选 + 10 填空 + 10 判断 + 3 综合分析，100 分、90 分钟。', points: ['一键标准卷', '自定义组卷', '班级模拟考试', '成绩报告与打印'], total: 73, done: mock.n, acc: mock.best == null ? null : Math.round(mock.best), wrong: 0 });
  tapes.push({ id: 13, kind: 'wrong', title: '我的错题本', en: 'ERROR BOOK', label: '备考', module: 'exam', ...art(12), summary: '练习与模拟考试中答错的题自动收录，连续答对 2 次视为掌握。', points: ['按章节/题型筛选', '错题重练', '错题组卷', '导出打印'], total: wrongAll, done: 0, acc: null, wrong: wrongAll });
  const exams = examsFor(user);
  return { tapes, modules: MODULES, exams: exams.filter((e) => e.state === 'open').length, final_exam_date: getSetting('final_exam_date', '') };
});

get('/api/chapters/:id', ALL, ({ params, user }) => {
  const c = q.get('SELECT * FROM chapters WHERE id=?', params.id);
  if (!c) throw notFound();
  const types = q.all("SELECT type, COUNT(*) n FROM questions WHERE chapter_id=? AND status='active' AND scope='all' GROUP BY type", c.id);
  return { ...c, points: P(c.points, []), types: Object.fromEntries(types.map((t) => [t.type, t.n])) };
});
patch('/api/chapters/:id', ['teacher', 'admin'], ({ params, body }) => {
  if (Array.isArray(body.points)) q.run('UPDATE chapters SET points=? WHERE id=?', J(body.points.map(String)), params.id);
  if (typeof body.summary === 'string') q.run('UPDATE chapters SET summary=? WHERE id=?', body.summary.slice(0, 500), params.id);
  return { ok: true };
});
get('/api/scope', ALL, () => ({
  note: '单选、判断、填空主要取自第 1–11 章课后习题；综合分析题出自第 7–11 章，侧重前沿技术与伦理问题，言之有理即可。',
  framework: ['观点：开门见山，给出明确立场', '技术原理或事实：说明相关技术如何工作、有什么依据', '案例：结合一个具体应用或新闻', '影响与伦理风险：分析正反两方面影响', '建议 / 结论：提出可行建议并收束'],
  chapters: q.all('SELECT id,title,title_en,module,summary,points FROM chapters WHERE id>=1 ORDER BY id').map((c) => ({ ...c, points: P(c.points, []) })),
  structure: [['单选题', 50, 1, 50], ['填空题', 10, 1, 10], ['判断题', 10, 1, 10], ['综合分析题', 3, 10, 30]],
}));

/* ---------- practice ---------- */
post('/api/practice/start', STU, ({ user, body }) => {
  const types = (body.types?.length ? body.types : ['single', 'tf', 'fill']).filter((t) => TYPE_ORDER.includes(t));
  const chapters = (body.chapters || []).map(Number).filter(Boolean);
  const order = ['seq', 'random', 'undone', 'wrong'].includes(body.order) ? body.order : 'random';
  const count = Math.max(5, Math.min(100, +body.count || 20));
  let sql = `SELECT * FROM questions WHERE status='active' AND (scope='all' OR owner_id=?) AND type IN (${types.map(() => '?').join(',')})`;
  const args = [user.id, ...types];
  if (chapters.length) { sql += ` AND chapter_id IN (${chapters.map(() => '?').join(',')})`; args.push(...chapters); }
  if (order === 'undone') sql += ' AND id NOT IN (SELECT a.question_id FROM answers a JOIN attempts t ON t.id=a.attempt_id WHERE t.user_id=?)', args.push(user.id);
  if (order === 'wrong') sql += ' AND id IN (SELECT question_id FROM wrong_book WHERE user_id=? AND mastered=0)', args.push(user.id);
  let pool = q.all(sql, ...args).map((r) => ({ ...r, options: P(r.options, []) }));
  if (!pool.length) throw bad(order === 'undone' ? '这个范围内的题你已经全部做过了，试试“随机”或“只练做错”' : order === 'wrong' ? '这个范围内没有未掌握的错题' : '该范围没有可用题目');
  const tOrder = Object.fromEntries(TYPE_ORDER.map((t, i) => [t, i]));
  pool = order === 'seq' ? pool.sort((a, b) => a.chapter_id - b.chapter_id || tOrder[a.type] - tOrder[b.type] || (a.no ?? 0) - (b.no ?? 0)) : shuffle(pool);
  const sel = pool.slice(0, count);
  const layout = {};
  for (const x of sel) if (x.type === 'single') layout[x.id] = shuffle(x.options.map((o) => o.key));
  const cfg = { chapters, types, order, count };
  const title = `自测练习 · ${chapters.length === 1 ? `第${chapters[0]}章` : chapters.length ? '多章' : '全部章节'} · ${stamp()}`;
  const pid = newPaper(user.id, 'practice', title, { ids: sel.map((x) => x.id), layout, total: sel.reduce((s, x) => s + points(x), 0) }, cfg);
  const aid = q.run('INSERT INTO attempts(user_id,paper_id,kind,started_at,status) VALUES(?,?,?,?,?)', user.id, pid, 'practice', Date.now(), 'doing').lastInsertRowid;
  return { attempt_id: aid };
});
get('/api/practice/unfinished', STU, ({ user }) => {
  const rows = q.all(`SELECT t.id, t.started_at, p.title, p.question_ids, (SELECT COUNT(*) FROM answers a WHERE a.attempt_id=t.id) answered
    FROM attempts t JOIN papers p ON p.id=t.paper_id WHERE t.user_id=? AND t.kind='practice' AND t.status='doing' ORDER BY t.id DESC LIMIT 5`, user.id);
  return rows.map((r) => ({ id: r.id, title: r.title, started_at: r.started_at, total: P(r.question_ids, []).length, answered: r.answered })).filter((r) => r.answered < r.total);
});
get('/api/attempts/:id', ALL, ({ params, user }) => {
  const att = expireIfNeeded(ownAttempt(user, +params.id));
  return attemptView(att);
});
post('/api/practice/:id/answer', STU, ({ params, user, body }) => {
  const att = ownAttempt(user, +params.id);
  if (att.kind !== 'practice') throw bad('该答卷不是练习');
  const paper = q.get('SELECT * FROM papers WHERE id=?', att.paper_id);
  if (!P(paper.question_ids, []).includes(+body.qid)) throw bad('题目不在本次练习中');
  const qu = getQ(+body.qid);
  q.run('UPDATE attempts SET cur_index=? WHERE id=?', Math.max(0, +body.index || 0), att.id);
  if (qu.type === 'essay') {
    q.run(`INSERT INTO answers(attempt_id,question_id,response,updated_at) VALUES(?,?,?,?) ON CONFLICT(attempt_id,question_id) DO UPDATE SET response=excluded.response, updated_at=excluded.updated_at`, att.id, qu.id, J(body.response ?? ''), Date.now());
    return { type: 'essay', answer: null, analysis: qu.analysis };
  }
  const j = judge(qu, body.response);
  q.run(`INSERT INTO answers(attempt_id,question_id,response,is_correct,score,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(attempt_id,question_id) DO UPDATE SET response=excluded.response,is_correct=excluded.is_correct,score=excluded.score,updated_at=excluded.updated_at`,
  att.id, qu.id, J(body.response), j.correct ? 1 : 0, j.got, Date.now());
  recordResult(user.id, qu, j.correct, body.response, 'practice');
  return { correct: j.correct, got: j.got, of: j.of, answer: qu.answer, analysis: qu.analysis };
});
post('/api/practice/:id/finish', STU, ({ params, user }) => {
  const att = ownAttempt(user, +params.id);
  const rows = q.all('SELECT a.*, qu.type FROM answers a JOIN questions qu ON qu.id=a.question_id WHERE a.attempt_id=?', att.id);
  const objective = rows.filter((r) => r.type !== 'essay');
  const got = objective.reduce((s, r) => s + (r.score || 0), 0);
  q.run("UPDATE attempts SET status='submitted', submitted_at=?, objective_score=?, total_score=? WHERE id=?", Date.now(), got, got, att.id);
  const total = P(q.get('SELECT question_ids FROM papers WHERE id=?', att.paper_id).question_ids, []).length;
  return { answered: rows.length, total, correct: objective.filter((r) => r.is_correct).length, judged: objective.length };
});

/* ---------- papers & exams ---------- */
post('/api/papers/generate', STU, ({ user, body }) => {
  try {
    const cfg = body.mode === 'custom' ? { mode: 'custom', chapters: body.chapters || [], counts: body.counts || {}, prefer: body.prefer || null } : { mode: 'standard' };
    const comp = composePaper(user.id, cfg);
    const title = `${cfg.mode === 'standard' ? '标准模拟卷' : '自定义卷'} · ${stamp()}`;
    const id = newPaper(user.id, cfg.mode === 'standard' ? 'mock' : 'custom', title, comp, cfg);
    return { paper_id: id, title, total: comp.total, summary: comp.summary, chapter_dist: comp.chapterDist, count: comp.ids.length };
  } catch (e) { if (e instanceof ComposeError) throw bad(e.message); throw e; }
});
get('/api/papers', STU, ({ user }) => q.all(`SELECT p.id,p.title,p.kind,p.total_score,p.created_at,p.question_ids,
    (SELECT COUNT(*) FROM attempts t WHERE t.paper_id=p.id AND t.status='submitted') tries,
    (SELECT MAX(total_score) FROM attempts t WHERE t.paper_id=p.id AND t.status='submitted') best,
    (SELECT id FROM attempts t WHERE t.paper_id=p.id AND t.status='doing' ORDER BY id DESC LIMIT 1) doing_id
    FROM papers p WHERE p.owner_id=? AND p.kind IN ('mock','custom','ai','wrong') ORDER BY p.id DESC LIMIT 60`, user.id)
  .map((r) => ({ ...r, count: P(r.question_ids, []).length, question_ids: undefined })));
del('/api/papers/:id', STU, ({ params, user }) => {
  const p = q.get('SELECT * FROM papers WHERE id=? AND owner_id=?', params.id, user.id);
  if (!p) throw notFound();
  if (q.get('SELECT 1 x FROM attempts WHERE paper_id=?', p.id)) throw bad('这张卷已有作答记录，不能删除');
  q.run('DELETE FROM papers WHERE id=?', p.id);
  return { ok: true };
});
get('/api/papers/:id/print', ALL, ({ params, user, query }) => {
  const p = q.get('SELECT * FROM papers WHERE id=?', params.id);
  if (!p) throw notFound();
  if (user.role === 'student' && p.owner_id !== user.id) throw forbid();
  return { __html: paperHtml(p, { answers: query.answers !== '0', studentName: user.role === 'student' ? user.name : '' }) };
});

export function examState(e, now = Date.now()) { return now < e.start_at ? 'upcoming' : now > e.end_at ? 'closed' : 'open'; }
function examsFor(user) {
  const c = classOf(user.id);
  if (!c.class_id) return [];
  return q.all("SELECT * FROM exams WHERE status='published' ORDER BY start_at DESC").filter((e) => P(e.class_ids, []).includes(c.class_id)).map((e) => {
    const tries = q.all("SELECT id,status,total_score FROM attempts WHERE user_id=? AND exam_id=? ORDER BY id", user.id, e.id);
    return { id: e.id, title: e.title, start_at: e.start_at, end_at: e.end_at, duration_min: e.duration_min, max_attempts: e.max_attempts, state: examState(e), tries,
      doing: tries.find((t) => t.status === 'doing')?.id || null };
  });
}
get('/api/exams', STU, ({ user }) => examsFor(user));

post('/api/attempts', STU, ({ user, body }) => {
  let paper, exam = null, limit = MIN90;
  if (body.exam_id) {
    exam = q.get("SELECT * FROM exams WHERE id=? AND status='published'", body.exam_id);
    const c = classOf(user.id);
    if (!exam || !P(exam.class_ids, []).includes(c.class_id)) throw forbid('你不在该考试的范围内');
    const st = examState(exam);
    const doing = q.get("SELECT * FROM attempts WHERE user_id=? AND exam_id=? AND status='doing'", user.id, exam.id);
    if (doing) { expireIfNeeded(doing); const again = q.get('SELECT * FROM attempts WHERE id=?', doing.id); if (again.status === 'doing') return { attempt_id: doing.id }; }
    if (st === 'upcoming') throw bad('考试尚未开始');
    if (st === 'closed') throw bad('考试已结束');
    const extra = P(exam.config, {}).extra_attempts?.[user.id] || 0;
    if (q.get("SELECT COUNT(*) n FROM attempts WHERE user_id=? AND exam_id=?", user.id, exam.id).n >= exam.max_attempts + extra) throw bad('已达到允许的作答次数');
    limit = exam.duration_min * 60000;
    if (exam.paper_policy === 'unified') paper = q.get('SELECT * FROM papers WHERE id=?', exam.unified_paper_id);
    else {
      const comp = composePaper(user.id, P(exam.config, { mode: 'standard' }));
      paper = q.get('SELECT * FROM papers WHERE id=?', newPaper(user.id, 'class_mock', exam.title, comp, { mode: 'standard' }, exam.id));
    }
  } else {
    paper = q.get('SELECT * FROM papers WHERE id=? AND owner_id=?', body.paper_id, user.id);
    if (!paper) throw notFound('试卷不存在');
    const doing = q.get("SELECT * FROM attempts WHERE user_id=? AND paper_id=? AND status='doing'", user.id, paper.id);
    if (doing) { expireIfNeeded(doing); if (q.get('SELECT status FROM attempts WHERE id=?', doing.id).status === 'doing') return { attempt_id: doing.id }; }
  }
  const now = Date.now();
  const id = q.run('INSERT INTO attempts(user_id,paper_id,exam_id,kind,started_at,deadline_at,status) VALUES(?,?,?,?,?,?,?)',
    user.id, paper.id, exam?.id ?? null, exam ? 'class_mock' : 'mock', now, now + limit, 'doing').lastInsertRowid;
  return { attempt_id: id };
});
put('/api/attempts/:id/answers', STU, ({ params, user, body }) => {
  let att = expireIfNeeded(ownAttempt(user, +params.id));
  if (att.status !== 'doing') return { submitted: true, attempt_id: att.id };
  const paper = q.get('SELECT * FROM papers WHERE id=?', att.paper_id);
  const ids = new Set(P(paper.question_ids, []));
  tx(() => {
    for (const [qid, resp] of Object.entries(body.answers || {})) {
      if (!ids.has(+qid)) continue;
      q.run(`INSERT INTO answers(attempt_id,question_id,response,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(attempt_id,question_id) DO UPDATE SET response=excluded.response, updated_at=excluded.updated_at`, att.id, +qid, J(resp), Date.now());
    }
    q.run('UPDATE attempts SET cur_index=?, flags=? WHERE id=?', Math.max(0, +body.cur_index || 0), J(body.flags || []), att.id);
  });
  return { saved: true, now: Date.now(), deadline_at: att.deadline_at };
});
post('/api/attempts/:id/submit', STU, ({ params, user, body }) => {
  const att = ownAttempt(user, +params.id);
  if (att.status === 'doing' && body.answers) {
    const ids = new Set(P(q.get('SELECT question_ids FROM papers WHERE id=?', att.paper_id).question_ids, []));
    for (const [qid, resp] of Object.entries(body.answers)) if (ids.has(+qid))
      q.run(`INSERT INTO answers(attempt_id,question_id,response,updated_at) VALUES(?,?,?,?) ON CONFLICT(attempt_id,question_id) DO UPDATE SET response=excluded.response, updated_at=excluded.updated_at`, att.id, +qid, J(resp), Date.now());
  }
  submitAttempt(att.id);
  return { ok: true, attempt_id: att.id };
});
post('/api/attempts/:id/self-score', STU, ({ params, user, body }) => {
  const att = ownAttempt(user, +params.id);
  if (att.status !== 'submitted') throw bad('请先交卷');
  const s = Math.max(0, Math.min(10, +body.score || 0));
  q.run('UPDATE answers SET self_score=? WHERE attempt_id=? AND question_id=?', s, att.id, +body.qid);
  recompute(att.id);
  recordResult(user.id, getQ(+body.qid), s >= 6, null, 'self');
  return { ok: true, score: s };
});
get('/api/attempts/:id/report', ALL, ({ params, user }) => {
  const att = ownAttempt(user, +params.id);
  if (att.status !== 'submitted') throw bad('尚未交卷');
  const v = attemptView(att);
  const byType = {}, byChapter = {};
  for (const x of v.questions) {
    const t = (byType[x.type] ||= { label: TYPE_LABEL[x.type], got: 0, of: 0 });
    const c = (byChapter[x.chapter] ||= { got: 0, of: 0 });
    const earned = x.type === 'essay' ? (x.teacher_score ?? x.ai_score ?? x.self_score ?? 0) : (x.score || 0);
    t.got += earned; t.of += x.points;
    if (x.type !== 'essay') { c.got += earned; c.of += x.points; }
  }
  const titles = Object.fromEntries(q.all('SELECT id,title FROM chapters').map((c) => [c.id, c.title]));
  return { ...v, report: { by_type: byType, by_chapter: Object.entries(byChapter).map(([c, r]) => ({ chapter: +c, title: titles[c], ...r })).sort((a, b) => a.chapter - b.chapter), used_ms: (att.submitted_at || Date.now()) - att.started_at } };
});
get('/api/attempts', STU, ({ user, query }) => q.all(`SELECT t.id,t.kind,t.status,t.started_at,t.submitted_at,t.total_score,t.objective_score,t.grading,p.title,p.total_score paper_total
  FROM attempts t JOIN papers p ON p.id=t.paper_id WHERE t.user_id=? AND t.kind${query.kind === 'practice' ? '=' : '!='}'practice' ORDER BY t.id DESC LIMIT 50`, user.id));

/* ---------- wrong book ---------- */
function wrongRows(uid, f) {
  let sql = `SELECT w.*, qu.chapter_id, qu.type FROM wrong_book w JOIN questions qu ON qu.id=w.question_id WHERE w.user_id=?`;
  const a = [uid];
  if (f.mastered === '1') sql += ' AND w.mastered=1'; else if (f.mastered !== 'all') sql += ' AND w.mastered=0';
  if (f.chapter) { sql += ' AND qu.chapter_id=?'; a.push(+f.chapter); }
  if (f.type) { sql += ' AND qu.type=?'; a.push(f.type); }
  if (f.min) { sql += ' AND w.wrong_count>=?'; a.push(+f.min); }
  if (f.starred === '1') sql += ' AND w.starred=1';
  return q.all(sql + ' ORDER BY w.last_wrong_at DESC', ...a);
}
get('/api/wrong-book', STU, ({ user, query }) => {
  const rows = wrongRows(user.id, query);
  const qs = new Map(getQs(rows.map((r) => r.question_id)).map((x) => [x.id, x]));
  const counts = { open: q.get('SELECT COUNT(*) n FROM wrong_book WHERE user_id=? AND mastered=0', user.id).n, mastered: q.get('SELECT COUNT(*) n FROM wrong_book WHERE user_id=? AND mastered=1', user.id).n };
  return { counts, items: rows.map((r) => ({ ...view(qs.get(r.question_id), null, true), wrong_count: r.wrong_count, last_wrong_at: r.last_wrong_at, last_answer: P(r.last_answer), source: r.source, streak: r.streak_correct, mastered: !!r.mastered, starred: !!r.starred })) };
});
post('/api/wrong-book/:qid', STU, ({ params, user, body }) => {
  const a = body.action;
  if (a === 'star' || a === 'unstar') q.run('UPDATE wrong_book SET starred=? WHERE user_id=? AND question_id=?', a === 'star' ? 1 : 0, user.id, params.qid);
  else if (a === 'master') q.run('UPDATE wrong_book SET mastered=1 WHERE user_id=? AND question_id=?', user.id, params.qid);
  else if (a === 'restore') q.run('UPDATE wrong_book SET mastered=0, streak_correct=0 WHERE user_id=? AND question_id=?', user.id, params.qid);
  else if (a === 'remove') q.run('DELETE FROM wrong_book WHERE user_id=? AND question_id=?', user.id, params.qid);
  else if (a === 'add') {
    q.run('INSERT INTO wrong_book(user_id,question_id,wrong_count,last_wrong_at,source,starred) VALUES(?,?,0,?,?,1) ON CONFLICT DO NOTHING', user.id, params.qid, Date.now(), 'manual');
  } else throw bad('未知操作');
  return { ok: true };
});
function fromWrong(user, body, kind) {
  const rows = wrongRows(user.id, body.filter || {});
  if (!rows.length) throw bad('没有符合条件的错题');
  const ids = shuffle(rows.map((r) => r.question_id)).slice(0, Math.min(100, +body.count || 50));
  const qs = getQs(ids);
  const layout = {};
  for (const x of qs) if (x.type === 'single') layout[x.id] = shuffle(x.options.map((o) => o.key));
  const total = qs.reduce((s, x) => s + points(x), 0);
  const pid = newPaper(user.id, kind === 'practice' ? 'practice' : 'wrong', `${kind === 'practice' ? '错题重练' : '错题组卷'} · ${stamp()}`, { ids, layout, total }, { from: 'wrong_book' });
  return pid;
}
post('/api/wrong-book/practice', STU, ({ user, body }) => {
  const pid = fromWrong(user, body, 'practice');
  return { attempt_id: q.run('INSERT INTO attempts(user_id,paper_id,kind,started_at,status) VALUES(?,?,?,?,?)', user.id, pid, 'practice', Date.now(), 'doing').lastInsertRowid };
});
post('/api/wrong-book/paper', STU, ({ user, body }) => ({ paper_id: fromWrong(user, body, 'paper') }));
get('/api/wrong-book/print', STU, ({ user, query }) => {
  const rows = wrongRows(user.id, query);
  const qs = new Map(getQs(rows.map((r) => r.question_id)).map((x) => [x.id, x]));
  const letters = 'ABCDEFGH';
  const items = rows.map((r, i) => {
    const qu = qs.get(r.question_id), la = P(r.last_answer);
    let h = `<div class="q"><p><b>${i + 1}.</b> [第${qu.chapter_id}章 · ${TYPE_LABEL[qu.type]} · 错${r.wrong_count}次] ${esc(qu.stem)}</p>`;
    if (qu.type === 'single') h += '<ol class="opts">' + qu.options.map((o) => `<li>${o.key}．${esc(o.text)}</li>`).join('') + '</ol>';
    const myAns = qu.type === 'tf' ? (la === true ? '√' : la === false ? '×' : '') : Array.isArray(la) ? la.join('、') : la ?? '';
    h += `<p>我的答案：${esc(myAns) || '—'}</p><p class="ans">${esc(AI.answerText(qu))}</p>`;
    if (qu.analysis && qu.type !== 'essay') h += `<p class="ana">解析：${esc(qu.analysis)}</p>`;
    return h + '</div>';
  }).join('');
  void letters;
  return { __html: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>错题本</title><style>body{font:14px/1.7 "Microsoft YaHei",serif;max-width:760px;margin:24px auto;padding:0 20px}h1{text-align:center}.q{margin:0 0 10px;break-inside:avoid;border-bottom:1px dotted #aaa;padding-bottom:6px}.q p{margin:2px 0}.opts{list-style:none;padding-left:18px;margin:2px 0}.ans{color:#1F3FB0}.ana{color:#555;font-size:12.5px}.bar{position:fixed;right:16px;top:12px}@media print{.bar{display:none}}</style><div class="bar"><button onclick="print()">打印 / 另存为 PDF</button></div><h1>《人工智能概论》错题本（${esc(user.name)}）</h1>${items || '<p>暂无错题</p>'}</html>` };
});

/* ---------- reports on questions ---------- */
post('/api/questions/:id/report', STU, ({ params, user, body }) => {
  q.run('INSERT INTO reports(user_id,question_id,note,created_at) VALUES(?,?,?,?)', user.id, params.id, String(body.note || '').slice(0, 300), Date.now());
  q.run('UPDATE questions SET reports=reports+1 WHERE id=?', params.id);
  return { ok: true };
});

/* ---------- AI: keys, usage, features ---------- */
export function saveKey(scope, ownerId, body, actor) {
  const old = q.get('SELECT * FROM api_keys WHERE scope=? AND owner_id=?', scope, ownerId);
  const provider = AI.PROVIDERS[body.provider] ? body.provider : 'deepseek';
  const model = String(body.model || AI.PROVIDERS[provider].models[0] || 'default').trim();
  const base = provider === 'mock' ? 'mock://' : String(body.base_url || AI.PROVIDERS[provider].base || '').trim();
  if (provider === 'tokenone' && !/^https?:\/\//.test(base)) throw bad('请填写中转站接口地址（需以 https:// 开头）');
  let cipher = old?.key_cipher, last4 = old?.key_last4;
  if (body.key) {
    cipher = encrypt(String(body.key).trim(), KEY_SECRET);
    last4 = String(body.key).trim().slice(-4);
  } else if (provider === 'mock') { cipher = cipher || encrypt('mock', KEY_SECRET); last4 = 'mock'; }
  if (!cipher) throw bad('请填写 API Key');
  if (scope === 'user' && !old?.acked && !body.ack) throw bad('请先勾选“我已知晓调用会消耗我的 tokens”');
  q.run(`INSERT INTO api_keys(scope,owner_id,provider,base_url,model,key_cipher,key_last4,daily_limit_cny,acked,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?)
    ON CONFLICT(scope,owner_id) DO UPDATE SET provider=excluded.provider,base_url=excluded.base_url,model=excluded.model,key_cipher=excluded.key_cipher,key_last4=excluded.key_last4,
    daily_limit_cny=excluded.daily_limit_cny,acked=MAX(api_keys.acked,excluded.acked),enabled=1,updated_at=excluded.updated_at`,
  scope, ownerId, provider, base, model, cipher, last4, Math.max(0, +body.daily_limit_cny || 0), body.ack || old?.acked ? 1 : 0, Date.now());
  audit(actor, 'save_key', `${scope}:${ownerId}`);
  return q.get('SELECT * FROM api_keys WHERE scope=? AND owner_id=?', scope, ownerId);
}
const keyOut = (k) => (k ? { provider: k.provider, base_url: k.base_url, model: k.model, masked: k.provider === 'mock' ? '演示模式' : maskKey(`sk-xxxx${k.key_last4}`).replace('sk-', 'sk-'), last4: k.key_last4, daily_limit_cny: k.daily_limit_cny, acked: !!k.acked } : null);
export { keyOut };
get('/api/me/api-key', ALL, ({ user }) => ({
  key: keyOut(q.get("SELECT * FROM api_keys WHERE scope='user' AND owner_id=?", user.id)),
  providers: Object.entries(AI.PROVIDERS).map(([id, p]) => ({ id, label: p.label, base: p.base, models: p.models })),
  prices: q.all('SELECT * FROM model_prices'), global_allowed: !!getSetting('allow_global_key_for_students', false) && !!q.get("SELECT 1 x FROM api_keys WHERE scope='global'"),
}));
put('/api/me/api-key', ALL, ({ user, body }) => keyOut(saveKey('user', user.id, body, user.id)));
del('/api/me/api-key', ALL, ({ user }) => { q.run("DELETE FROM api_keys WHERE scope='user' AND owner_id=?", user.id); audit(user.id, 'delete_key', 'user'); return { ok: true }; });
post('/api/me/api-key/test', ALL, async ({ user, body }) => {
  let k = q.get("SELECT * FROM api_keys WHERE scope='user' AND owner_id=?", user.id);
  if (body.key || body.provider) { // test unsaved input
    const provider = AI.PROVIDERS[body.provider] ? body.provider : 'deepseek';
    k = { id: 0, scope: 'test', provider, base_url: body.base_url || AI.PROVIDERS[provider].base, model: body.model || AI.PROVIDERS[provider].models[0] || 'default', daily_limit_cny: 0,
      key_cipher: provider === 'mock' ? encrypt('mock', KEY_SECRET) : encrypt(String(body.key || ''), KEY_SECRET) };
    if (provider !== 'mock' && !body.key) k = q.get("SELECT * FROM api_keys WHERE scope='user' AND owner_id=?", user.id) || k;
  }
  if (!k) throw bad('请先填写 Key');
  try { return await AI.testKey(k); } catch (e) { throw new HttpError(400, e.message || '连接失败', { code: e.code }); }
});
get('/api/me/ai-usage', ALL, ({ user }) => {
  const total = q.get('SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COALESCE(SUM(actual_cost),0) c, COUNT(*) n FROM ai_usage WHERE user_id=?', user.id);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = q.get('SELECT COALESCE(SUM(actual_cost),0) c FROM ai_usage WHERE user_id=? AND created_at>=?', user.id, today.getTime());
  return { total, today_cost: t.c, recent: q.all('SELECT feature,input_tokens,output_tokens,actual_cost,created_at FROM ai_usage WHERE user_id=? ORDER BY id DESC LIMIT 30', user.id) };
});

function prep(user, feature, opts = {}, body = {}) {
  const key = AI.resolveKey(user, { classId: classOf(user.id).class_id });
  if (!key) throw new HttpError(400, '未配置 API Key，请在【我的 → AI 设置】填写后使用', { code: 'no_key' });
  const est = AI.estimate(feature, key, opts);
  if (est.cost_cny > 0.1 && !body.confirm) throw new HttpError(409, `本次预估花费约 ¥${est.cost_cny.toFixed(3)}，需要确认`, { need_confirm: true, estimate: est });
  return { key, est };
}
const aiWrap = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof AI.AIError) throw new HttpError(e.status, e.message, { code: e.code }); throw e; } };

get('/api/ai/status', ALL, ({ user }) => {
  const k = AI.resolveKey(user, { classId: classOf(user.id).class_id });
  const est = (f, o) => AI.estimate(f, k, o).cost_cny;
  return { has_key: !!k, key: AI.keyBrief(k), estimates: { explain: est('explain', {}), review: est('grade', {}), model: est('model', {}), ask: est('ask', {}), diagnose: est('diagnose', {}), outline: est('outline', {}), generate_each: est('generate', { n: 0.2 }) } };
});
post('/api/ai/estimate', ALL, ({ user, body }) => {
  const k = AI.resolveKey(user, { classId: classOf(user.id).class_id });
  return { has_key: !!k, ...AI.estimate(body.feature || 'explain', k, { chars: +body.chars || 0, n: +body.n || 1 }) };
});
post('/api/ai/explain', ALL, ({ user, body }) => aiWrap(async () => {
  const qu = getQ(+body.qid);
  if (!qu) throw notFound();
  const { key, est } = prep(user, 'explain', { chars: qu.stem.length }, body);
  const r = await AI.explain(key, user.id, qu, body.answer, est.cost_cny);
  return { text: r.text, usage: r.usage, estimate: est };
}));
post('/api/ai/essay', ALL, ({ user, body }) => aiWrap(async () => {
  const qu = getQ(+body.qid);
  if (!qu || qu.type !== 'essay') throw notFound();
  const action = ['review', 'model', 'ask'].includes(body.action) ? body.action : 'review';
  const { key, est } = prep(user, action === 'review' ? 'grade' : action, { chars: String(body.answer || '').length }, body);
  if (action === 'review') {
    const g = await AI.gradeEssay(key, user.id, qu, body.answer, { estCost: est.cost_cny });
    return { grade: g, usage: g.usage, estimate: est };
  }
  if (action === 'ask' && (body.history || []).filter((h) => h.role === 'user').length >= 5) throw bad('追问最多 5 轮');
  const history = [...(body.history || []), { role: 'user', content: String(body.question || '') }];
  const r = await AI.essayAssist(key, user.id, qu, action, body.answer, action === 'ask' ? history : [], est.cost_cny);
  return { text: r.text, usage: r.usage, estimate: est };
}));
post('/api/ai/diagnose', STU, ({ user, body }) => aiWrap(async () => {
  const items = q.all(`SELECT w.wrong_count, qu.stem, qu.chapter_id, c.title FROM wrong_book w JOIN questions qu ON qu.id=w.question_id JOIN chapters c ON c.id=qu.chapter_id
    WHERE w.user_id=? AND w.mastered=0 ORDER BY w.wrong_count DESC, w.last_wrong_at DESC LIMIT 30`, user.id);
  if (!items.length) throw bad('错题本里还没有未掌握的题');
  const { key, est } = prep(user, 'diagnose', { chars: items.length * 40 }, body);
  const r = await AI.diagnose(key, user.id, items, est.cost_cny);
  return { text: r.text, usage: r.usage, estimate: est };
}));
post('/api/ai/outline', ALL, ({ user, body }) => aiWrap(async () => {
  const c = q.get('SELECT * FROM chapters WHERE id=?', +body.chapter);
  if (!c) throw notFound();
  const { key, est } = prep(user, 'outline', {}, body);
  const r = await AI.outline(key, user.id, c, est.cost_cny);
  return { text: r.text, usage: r.usage, estimate: est };
}));
post('/api/ai/generate', STU, ({ user, body }) => aiWrap(async () => {
  const c = q.get('SELECT * FROM chapters WHERE id=?', +body.chapter);
  const type = ['single', 'tf', 'fill'].includes(body.type) ? body.type : 'single';
  const n = Math.max(1, Math.min(10, +body.count || 5));
  if (!c) throw notFound();
  const { key, est } = prep(user, 'generate', { n: n / 5 }, body);
  const { items, usage } = await AI.generateQuestions(key, user.id, c, type, n, est.cost_cny);
  const ids = [];
  tx(() => {
    for (const it of items.slice(0, n)) {
      try {
        let x;
        if (type === 'single') {
          const keys = 'ABCD'; if (!Array.isArray(it.options) || it.options.length < 3) continue;
          x = { chapter: c.id, type, stem: String(it.stem), options: it.options.slice(0, 4).map((t, i) => [keys[i], String(t)]), answer: String(it.answer).trim().toUpperCase()[0], analysis: it.analysis, ok: true };
        } else if (type === 'tf') x = { chapter: c.id, type, stem: String(it.stem), answer: !!it.answer, analysis: it.analysis, ok: true };
        else x = { chapter: c.id, type, stem: String(it.stem), answers: (it.answers || []).map((a) => [].concat(a).map(String)), analysis: it.analysis, ok: !!(it.answers || []).length };
        if (!x.stem || x.ok === false) continue;
        ids.push(importQ(x, user.id));
      } catch { /* skip malformed item */ }
    }
  });
  if (!ids.length) throw bad('AI 没有生成可用题目，请重试');
  const qs = getQs(ids);
  const layout = {};
  for (const x of qs) if (x.type === 'single') layout[x.id] = shuffle(x.options.map((o) => o.key));
  const pid = newPaper(user.id, 'ai', `AI 出题 · 第${c.id}章 · ${stamp()}`, { ids, layout, total: qs.reduce((s, x) => s + points(x), 0) }, { mode: 'ai', chapter: c.id, type });
  const aid = q.run('INSERT INTO attempts(user_id,paper_id,kind,started_at,status) VALUES(?,?,?,?,?)', user.id, pid, 'practice', Date.now(), 'doing').lastInsertRowid;
  return { attempt_id: aid, paper_id: pid, count: ids.length, usage, estimate: est };
}));
import { importQuestion } from './seed.js';
function importQ(x, ownerId) { return importQuestion(x, 'ai', { owner_id: ownerId, scope: 'private' }); }

/* ---------- announcements for the home page ---------- */
get('/api/stats/me', STU, ({ user }) => {
  const a = q.get(`SELECT COUNT(*) n, COALESCE(SUM(is_correct),0) ok FROM answers a JOIN attempts t ON t.id=a.attempt_id WHERE t.user_id=? AND a.is_correct IS NOT NULL`, user.id);
  const m = q.get("SELECT COUNT(*) n, MAX(total_score) best FROM attempts WHERE user_id=? AND kind!='practice' AND status='submitted'", user.id);
  return { answered: a.n, correct: a.ok, mocks: m.n, best: m.best };
});
