import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { q, tx, P, J, getSetting, ROOT, audit } from './db.js';
import { get, post, put, patch, del, bad, forbid, notFound, HttpError } from './http.js';
import { hashPasswordAsync, decodeText, parseCSV, parseXlsx, toCSV } from './lib.js';
import { getQ, getQs, composePaper, TYPE_LABEL, recordResult, ComposeError } from './core.js';
import { newPaper, attemptView, recompute, examState, saveKey, keyOut, startEssayGrading } from './student.js';
import { importQuestion } from './seed.js';

const TCH = ['teacher', 'admin'];

/* ---------- scoping ---------- */
const myClasses = (u) => (u.role === 'admin' ? q.all('SELECT * FROM classes ORDER BY name') : q.all('SELECT * FROM classes WHERE teacher_id=? ORDER BY name', u.id));
function ownClass(u, id) {
  const c = q.get('SELECT * FROM classes WHERE id=?', id);
  if (!c) throw notFound('班级不存在');
  if (u.role !== 'admin' && c.teacher_id !== u.id) throw forbid('不是你的班级');
  return c;
}
function ownStudent(u, uid) {
  const s = q.get('SELECT u.id,u.name,u.username,u.status,u.last_login,s.* FROM users u JOIN students s ON s.user_id=u.id WHERE u.id=?', uid);
  if (!s) throw notFound('学生不存在');
  if (u.role !== 'admin') ownClass(u, s.class_id);
  return s;
}
const idsIn = (arr) => (arr.length ? arr.map(() => '?').join(',') : 'NULL');
const DAY = 86400000;

/* ---------- student import ---------- */
const COLS = {
  student_no: ['学号', '登录名', '账号', '用户名', 'studentno', 'student_no', 'id', 'no'],
  name: ['姓名', '学生姓名', 'name'],
  class_name: ['班级', '班级名称', '行政班', '教学班', 'class'],
  college: ['学院', '院系', '所属学院', 'college'],
  major: ['专业', '所属专业', 'major'],
  grade: ['年级', 'grade'],
};
function mapHeader(h) {
  const m = {};
  h.forEach((x, i) => {
    const k = String(x).replace(/\s/g, '').toLowerCase();
    for (const [f, names] of Object.entries(COLS)) if (m[f] === undefined && names.includes(k)) m[f] = i;
  });
  return m;
}
function readSheet(body) {
  const buf = Buffer.from(String(body.data || ''), 'base64');
  if (!buf.length) throw bad('文件为空');
  const rows = /\.xlsx$/i.test(body.filename || '') ? parseXlsx(buf) : parseCSV(decodeText(buf));
  if (!rows.length) throw bad('文件里没有数据');
  return rows;
}
post('/api/teacher/students/import', TCH, async ({ user, body, ip }) => {
  const rows = readSheet(body);
  let map = body.mapping && Object.keys(body.mapping).length ? body.mapping : mapHeader(rows[0]);
  let data = rows.slice(1);
  if (map.student_no === undefined || map.name === undefined) { // headerless file: 学号,姓名,班级,专业
    if (Object.keys(mapHeader(rows[0])).length < 2 && !body.mapping) { map = { student_no: 0, name: 1, class_name: 2, major: 3 }; data = rows; }
    else throw bad('没有识别到“学号”“姓名”列，请检查表头', { header: rows[0] });
  }
  const college = String(body.college || getSetting('college_default', '') || '').trim();
  const teacherId = user.role === 'admin' && body.teacher_id ? +body.teacher_id : user.id;
  const seen = new Set(), issues = [], ok = [];
  data.forEach((r, i) => {
    const g = (f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim());
    const rec = { row: i + 2, student_no: g('student_no'), name: g('name'), class_name: g('class_name'), college: g('college') || college, major: g('major'), grade: g('grade') };
    if (!rec.student_no || !rec.name || !rec.class_name) return issues.push({ row: rec.row, msg: '学号、姓名、班级不能为空', rec });
    if (seen.has(rec.student_no)) return issues.push({ row: rec.row, msg: `文件内学号重复：${rec.student_no}`, rec });
    seen.add(rec.student_no);
    const ex = q.get('SELECT id, role FROM users WHERE username=?', rec.student_no);
    if (ex && ex.role !== 'student') return issues.push({ row: rec.row, msg: '学号与教师/管理员账号冲突', rec });
    if (ex && user.role !== 'admin') {
      const sc = q.get('SELECT c.teacher_id t FROM students s JOIN classes c ON c.id=s.class_id WHERE s.user_id=?', ex.id);
      if (sc && sc.t !== teacherId) return issues.push({ row: rec.row, msg: '该学号已属于其他教师的班级', rec });
    }
    rec.exists = !!ex;
    if (!rec.grade) rec.grade = /(\d{4})级/.exec(rec.class_name)?.[1] || '';
    ok.push(rec);
  });
  const summary = { total: data.length, ok: ok.length, skipped: issues.length, create: ok.filter((x) => !x.exists).length, update: ok.filter((x) => x.exists).length, classes: [...new Set(ok.map((x) => x.class_name))] };
  if (!body.commit) return { preview: ok.slice(0, 15), summary, issues: issues.slice(0, 50), mapping: map, header: rows[0] };
  const digits = +getSetting('default_password_digits', 6) || 6;
  const hashes = new Map(await Promise.all(ok.filter((r) => !r.exists).map(async (r) => [r.student_no, await hashPasswordAsync(r.student_no.slice(-digits))])));
  tx(() => {
    const cls = {};
    for (const r of ok) {
      if (!cls[r.class_name]) {
        const c = q.get('SELECT id FROM classes WHERE name=? AND teacher_id=?', r.class_name, teacherId);
        cls[r.class_name] = c ? c.id : q.run('INSERT INTO classes(name,college,teacher_id,semester) VALUES(?,?,?,?)', r.class_name, r.college, teacherId, getSetting('semester', '2026-2027-1')).lastInsertRowid;
      }
      const cid = cls[r.class_name];
      const ex = q.get('SELECT id FROM users WHERE username=?', r.student_no);
      if (ex) {
        q.run('UPDATE users SET name=? WHERE id=?', r.name, ex.id);
        q.run('UPDATE students SET student_no=?, college=?, major=?, grade=?, class_id=? WHERE user_id=?', r.student_no, r.college, r.major, r.grade, cid, ex.id);
      } else {
        const uid = q.run('INSERT INTO users(role,username,name,password_hash,must_change_pwd,created_at) VALUES(?,?,?,?,1,?)', 'student', r.student_no, r.name, hashes.get(r.student_no) || (() => { throw new Error('missing hash'); })(), Date.now()).lastInsertRowid;
        q.run('INSERT INTO students(user_id,student_no,college,major,grade,class_id) VALUES(?,?,?,?,?,?)', uid, r.student_no, r.college, r.major, r.grade, cid);
      }
    }
  });
  audit(user.id, 'import_students', `${summary.ok}/${summary.total}`, ip);
  return { committed: true, summary, issues: issues.slice(0, 50), initial_password_hint: `学号后 ${digits} 位` };
}, { limit: 20 * 1024 * 1024 });

/* ---------- classes & stats ---------- */
function classRows(classIds) {
  if (!classIds.length) return {};
  const ph = idsIn(classIds);
  const out = {};
  for (const id of classIds) out[id] = { students: 0, active7: 0, answers: 0, correct: 0, judged: 0, mock_avg: null, trend: [] };
  for (const r of q.all(`SELECT class_id c, COUNT(*) n FROM students WHERE class_id IN (${ph}) GROUP BY class_id`, ...classIds)) out[r.c].students = r.n;
  const since = Date.now() - 7 * DAY;
  for (const r of q.all(`SELECT s.class_id c, COUNT(DISTINCT t.user_id) n FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN students s ON s.user_id=t.user_id
    WHERE s.class_id IN (${ph}) AND a.updated_at>=? GROUP BY s.class_id`, ...classIds, since)) out[r.c].active7 = r.n;
  for (const r of q.all(`SELECT s.class_id c, COUNT(*) n, COUNT(a.is_correct) j, SUM(COALESCE(a.is_correct,0)) ok FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN students s ON s.user_id=t.user_id
    WHERE s.class_id IN (${ph}) GROUP BY s.class_id`, ...classIds)) Object.assign(out[r.c], { answers: r.n, judged: r.j, correct: r.ok });
  for (const r of q.all(`SELECT s.class_id c, AVG(t.total_score) a FROM attempts t JOIN students s ON s.user_id=t.user_id WHERE s.class_id IN (${ph}) AND t.kind!='practice' AND t.status='submitted' GROUP BY s.class_id`, ...classIds)) out[r.c].mock_avg = r.a;
  const from = Date.now() - 13 * DAY;
  const rows = q.all(`SELECT s.class_id c, strftime('%m-%d', a.updated_at/1000, 'unixepoch', 'localtime') d, COUNT(*) n FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN students s ON s.user_id=t.user_id
    WHERE s.class_id IN (${ph}) AND a.updated_at>=? GROUP BY s.class_id, d`, ...classIds, from);
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() - (13 - i) * DAY); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  for (const id of classIds) out[id].trend = days.map((d) => ({ d, n: rows.find((r) => r.c === id && r.d === d)?.n || 0 }));
  return out;
}
get('/api/teacher/classes', TCH, ({ user }) => {
  const cls = myClasses(user);
  const st = classRows(cls.map((c) => c.id));
  return cls.map((c) => {
    const s = st[c.id];
    const k = q.get("SELECT provider,model,key_last4 FROM api_keys WHERE scope='class' AND owner_id=?", c.id);
    return { id: c.id, name: c.name, college: c.college, teacher: q.get('SELECT name FROM users WHERE id=?', c.teacher_id)?.name, students: s.students, active7: s.active7,
      per_capita: s.students ? Math.round(s.answers / s.students) : 0, acc: s.judged ? Math.round((100 * s.correct) / s.judged) : null, mock_avg: s.mock_avg == null ? null : Math.round(s.mock_avg * 10) / 10, trend: s.trend, has_key: !!k };
  });
});
function studentTable(classId) {
  const base = q.all('SELECT u.id,u.name,u.username,u.last_login,s.major,s.grade FROM students s JOIN users u ON u.id=s.user_id WHERE s.class_id=? ORDER BY u.username', classId);
  const ids = base.map((b) => b.id);
  if (!ids.length) return [];
  const ph = idsIn(ids);
  const A = Object.fromEntries(q.all(`SELECT t.user_id u, COUNT(*) n, COUNT(a.is_correct) j, SUM(COALESCE(a.is_correct,0)) ok FROM answers a JOIN attempts t ON t.id=a.attempt_id WHERE t.user_id IN (${ph}) GROUP BY t.user_id`, ...ids).map((r) => [r.u, r]));
  const M = Object.fromEntries(q.all(`SELECT user_id u, COUNT(*) n, MAX(total_score) best FROM attempts WHERE user_id IN (${ph}) AND kind!='practice' AND status='submitted' GROUP BY user_id`, ...ids).map((r) => [r.u, r]));
  const W = Object.fromEntries(q.all(`SELECT user_id u, COUNT(*) n FROM wrong_book WHERE user_id IN (${ph}) AND mastered=0 GROUP BY user_id`, ...ids).map((r) => [r.u, r.n]));
  const C = {};
  for (const r of q.all(`SELECT t.user_id u, qu.chapter_id c, COUNT(a.is_correct) j, SUM(COALESCE(a.is_correct,0)) ok FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN questions qu ON qu.id=a.question_id
    WHERE t.user_id IN (${ph}) AND a.is_correct IS NOT NULL GROUP BY t.user_id, qu.chapter_id`, ...ids)) (C[r.u] ||= []).push(r);
  return base.map((b) => {
    const a = A[b.id] || { n: 0, j: 0, ok: 0 }, m = M[b.id] || { n: 0, best: null };
    const weak = (C[b.id] || []).filter((x) => x.j >= 3).map((x) => ({ c: x.c, acc: x.ok / x.j })).sort((x, y) => x.acc - y.acc)[0];
    return { id: b.id, student_no: b.username, name: b.name, major: b.major, last_login: b.last_login, answered: a.n, acc: a.j ? Math.round((100 * a.ok) / a.j) : null, mocks: m.n, best: m.best, wrong: W[b.id] || 0, weak: weak ? `第${weak.c}章 (${Math.round(weak.acc * 100)}%)` : null };
  });
}
get('/api/teacher/classes/:id/students', TCH, ({ user, params }) => { ownClass(user, +params.id); return studentTable(+params.id); });
get('/api/teacher/classes/:id/chapters', TCH, ({ user, params }) => {
  ownClass(user, +params.id);
  return q.all(`SELECT qu.chapter_id c, COUNT(a.is_correct) j, SUM(COALESCE(a.is_correct,0)) ok FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN students s ON s.user_id=t.user_id JOIN questions qu ON qu.id=a.question_id
    WHERE s.class_id=? AND a.is_correct IS NOT NULL GROUP BY qu.chapter_id ORDER BY qu.chapter_id`, +params.id).map((r) => ({ chapter: r.c, answered: r.j, acc: Math.round((100 * r.ok) / r.j) }));
});
get('/api/teacher/students/:id', TCH, ({ user, params }) => {
  const s = ownStudent(user, +params.id);
  const chapters = q.all(`SELECT qu.chapter_id c, c.title, COUNT(a.is_correct) j, SUM(COALESCE(a.is_correct,0)) ok FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN questions qu ON qu.id=a.question_id JOIN chapters c ON c.id=qu.chapter_id
    WHERE t.user_id=? AND a.is_correct IS NOT NULL GROUP BY qu.chapter_id ORDER BY qu.chapter_id`, s.id).map((r) => ({ chapter: r.c, title: r.title, answered: r.j, acc: Math.round((100 * r.ok) / r.j) }));
  const attempts = q.all(`SELECT t.id,t.kind,t.status,t.started_at,t.submitted_at,t.total_score,t.grading,p.title FROM attempts t JOIN papers p ON p.id=t.paper_id WHERE t.user_id=? ORDER BY t.id DESC LIMIT 40`, s.id);
  const wrong = q.all(`SELECT w.wrong_count, qu.id, qu.stem, qu.chapter_id FROM wrong_book w JOIN questions qu ON qu.id=w.question_id WHERE w.user_id=? AND w.mastered=0 ORDER BY w.wrong_count DESC LIMIT 20`, s.id);
  const ai = q.get('SELECT COALESCE(SUM(input_tokens+output_tokens),0) tokens, COALESCE(SUM(actual_cost),0) cost, COUNT(*) n FROM ai_usage WHERE user_id=?', s.id);
  const cls = q.get('SELECT name FROM classes WHERE id=?', s.class_id);
  return { student: { id: s.id, name: s.name, student_no: s.username, class_name: cls?.name, major: s.major, last_login: s.last_login }, chapters, attempts, wrong, ai };
});
post('/api/teacher/students/:id/reset-password', TCH, async ({ user, params, ip }) => {
  const s = ownStudent(user, +params.id);
  const digits = +getSetting('default_password_digits', 6) || 6;
  q.run('UPDATE users SET password_hash=?, must_change_pwd=1, fail_count=0, locked_until=0 WHERE id=?', await hashPasswordAsync(s.username.slice(-digits)), s.id);
  audit(user.id, 'reset_password', s.username, ip);
  return { ok: true, hint: `已重置为学号后 ${digits} 位` };
});
post('/api/teacher/classes/:id/reset-passwords', TCH, async ({ user, params, ip }) => {
  ownClass(user, +params.id);
  const digits = +getSetting('default_password_digits', 6) || 6;
  const rows = q.all('SELECT u.id, u.username FROM students s JOIN users u ON u.id=s.user_id WHERE s.class_id=?', +params.id);
  const hs = await Promise.all(rows.map((r) => hashPasswordAsync(r.username.slice(-digits))));
  tx(() => rows.forEach((r, i) => q.run('UPDATE users SET password_hash=?, must_change_pwd=1, fail_count=0, locked_until=0 WHERE id=?', hs[i], r.id)));
  audit(user.id, 'reset_password_class', params.id, ip);
  return { ok: true, count: rows.length };
});
patch('/api/teacher/students/:id', TCH, ({ user, params, body }) => {
  const s = ownStudent(user, +params.id);
  if (body.name) q.run('UPDATE users SET name=? WHERE id=?', String(body.name).trim(), s.id);
  if (body.status) q.run('UPDATE users SET status=? WHERE id=?', body.status === 'disabled' ? 'disabled' : 'active', s.id);
  if (body.class_id) { ownClass(user, +body.class_id); q.run('UPDATE students SET class_id=? WHERE user_id=?', +body.class_id, s.id); }
  return { ok: true };
});
put('/api/teacher/classes/:id/key', TCH, ({ user, params, body }) => { ownClass(user, +params.id); return keyOut(saveKey('class', +params.id, { ...body, ack: true }, user.id)); });
get('/api/teacher/classes/:id/key', TCH, ({ user, params }) => { ownClass(user, +params.id); return { key: keyOut(q.get("SELECT * FROM api_keys WHERE scope='class' AND owner_id=?", +params.id)) }; });
del('/api/teacher/classes/:id/key', TCH, ({ user, params }) => { ownClass(user, +params.id); q.run("DELETE FROM api_keys WHERE scope='class' AND owner_id=?", +params.id); return { ok: true }; });
get('/api/teacher/class-usage', TCH, ({ user }) => {
  const cls = myClasses(user);
  return cls.map((c) => ({ id: c.id, name: c.name, ...q.get(`SELECT COALESCE(SUM(u.input_tokens+u.output_tokens),0) tokens, COALESCE(SUM(u.actual_cost),0) cost, COUNT(*) calls FROM ai_usage u JOIN students s ON s.user_id=u.user_id WHERE s.class_id=?`, c.id) }));
});

/* ---------- question analysis ---------- */
get('/api/teacher/question-stats', TCH, ({ user, query }) => {
  const clsIds = query.class ? (ownClass(user, +query.class), [+query.class]) : myClasses(user).map((c) => c.id);
  if (!clsIds.length) return [];
  const rows = q.all(`SELECT a.question_id id, a.response, a.is_correct FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN students s ON s.user_id=t.user_id
    WHERE s.class_id IN (${idsIn(clsIds)}) AND a.is_correct IS NOT NULL`, ...clsIds);
  const by = {};
  for (const r of rows) { const x = (by[r.id] ||= { n: 0, ok: 0, dist: {} }); x.n++; x.ok += r.is_correct; const v = P(r.response); const k = typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? '√' : '×') : '填空'; x.dist[k] = (x.dist[k] || 0) + 1; }
  const min = +query.min || 3;
  const ids = Object.keys(by).filter((i) => by[i].n >= min).sort((a, b) => by[a].ok / by[a].n - by[b].ok / by[b].n).slice(0, +query.limit || 20);
  const qs = new Map(getQs(ids.map(Number)).map((x) => [x.id, x]));
  return ids.map((i) => { const x = by[i], qu = qs.get(+i); return { id: +i, chapter: qu.chapter_id, type: qu.type, stem: qu.stem, answer: qu.answer, options: qu.options, n: x.n, rate: Math.round((100 * x.ok) / x.n), dist: x.dist }; });
});

/* ---------- exams ---------- */
post('/api/teacher/exams', TCH, ({ user, body, ip }) => {
  const classIds = (body.class_ids || []).map(Number);
  if (!classIds.length) throw bad('请选择班级');
  classIds.forEach((id) => ownClass(user, id));
  const start = +body.start_at, end = +body.end_at;
  if (!start || !end || end <= start) throw bad('请设置有效的开放时间窗');
  const title = String(body.title || '').trim() || `班级模拟考试 · ${new Date(start).toLocaleDateString('zh-CN')}`;
  const policy = body.paper_policy === 'per_student' ? 'per_student' : 'unified';
  const cfg = { mode: 'standard' };
  let paperId = null;
  try {
    if (policy === 'unified') paperId = newPaper(user.id, 'class_mock', title, composePaper(null, cfg), cfg);
  } catch (e) { if (e instanceof ComposeError) throw bad(e.message); throw e; }
  const id = q.run('INSERT INTO exams(teacher_id,title,paper_policy,class_ids,start_at,end_at,duration_min,max_attempts,unified_paper_id,config,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    user.id, title, policy, J(classIds), start, end, Math.max(10, Math.min(180, +body.duration_min || 90)), Math.max(1, Math.min(10, +body.max_attempts || 1)), paperId, J(cfg), Date.now()).lastInsertRowid;
  if (paperId) q.run('UPDATE papers SET exam_id=? WHERE id=?', id, paperId);
  audit(user.id, 'create_exam', id, ip);
  return { id };
});
get('/api/teacher/exams', TCH, ({ user }) => {
  const rows = user.role === 'admin' ? q.all('SELECT * FROM exams ORDER BY start_at DESC') : q.all('SELECT * FROM exams WHERE teacher_id=? ORDER BY start_at DESC', user.id);
  return rows.map((e) => {
    const ids = P(e.class_ids, []);
    const names = ids.map((i) => q.get('SELECT name FROM classes WHERE id=?', i)?.name).filter(Boolean);
    const total = ids.length ? q.get(`SELECT COUNT(*) n FROM students WHERE class_id IN (${idsIn(ids)})`, ...ids).n : 0;
    const a = q.get("SELECT COUNT(DISTINCT user_id) entered, COUNT(DISTINCT CASE WHEN status='submitted' THEN user_id END) done FROM attempts WHERE exam_id=?", e.id);
    return { id: e.id, title: e.title, classes: names, start_at: e.start_at, end_at: e.end_at, duration_min: e.duration_min, policy: e.paper_policy, state: examState(e), total, entered: a.entered, done: a.done, paper_id: e.unified_paper_id, max_attempts: e.max_attempts };
  });
});
function examOf(user, id) {
  const e = q.get('SELECT * FROM exams WHERE id=?', id);
  if (!e) throw notFound();
  if (user.role !== 'admin' && e.teacher_id !== user.id) throw forbid();
  return e;
}
get('/api/teacher/exams/:id/stats', TCH, ({ user, params }) => {
  const e = examOf(user, +params.id);
  const ids = P(e.class_ids, []);
  const students = q.all(`SELECT u.id,u.name,u.username,c.name class_name FROM students s JOIN users u ON u.id=s.user_id JOIN classes c ON c.id=s.class_id WHERE s.class_id IN (${idsIn(ids)}) ORDER BY c.name,u.username`, ...ids);
  const atts = q.all('SELECT * FROM attempts WHERE exam_id=? ORDER BY id', e.id);
  const best = {};
  for (const a of atts) { const b = best[a.user_id]; if (!b || (a.status === 'submitted' && (b.status !== 'submitted' || a.total_score > b.total_score))) best[a.user_id] = a; }
  const done = Object.values(best).filter((a) => a.status === 'submitted');
  const buckets = [['<60', 0, 60], ['60-69', 60, 70], ['70-79', 70, 80], ['80-89', 80, 90], ['90-100', 90, 101]].map(([label, lo, hi]) => ({ label, n: done.filter((a) => a.total_score >= lo && a.total_score < hi).length }));
  const perQ = q.all(`SELECT a.question_id id, qu.chapter_id c, qu.type, qu.stem, COUNT(*) n, SUM(CASE WHEN qu.type='essay' THEN COALESCE(a.teacher_score,a.ai_score,a.self_score,0) ELSE a.score END) got
    FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN questions qu ON qu.id=a.question_id WHERE t.exam_id=? AND t.status='submitted' GROUP BY a.question_id`, e.id)
    .map((r) => ({ ...r, rate: r.type === 'essay' ? Math.round((10 * r.got) / r.n) / 10 : Math.round((100 * r.got) / (r.n * (r.type === 'fill' ? Math.max(1, getQ(r.id).blank_count) : 1))) }));
  const extra = P(e.config, {}).extra_attempts || {};
  return {
    exam: { id: e.id, title: e.title, start_at: e.start_at, end_at: e.end_at, duration_min: e.duration_min, state: examState(e), policy: e.paper_policy, paper_id: e.unified_paper_id },
    total: students.length, entered: Object.keys(best).length, done: done.length, avg: done.length ? Math.round((done.reduce((s, a) => s + a.total_score, 0) / done.length) * 10) / 10 : null, buckets,
    low_questions: perQ.filter((r) => r.type !== 'essay').sort((a, b) => a.rate - b.rate).slice(0, 15), essay: perQ.filter((r) => r.type === 'essay'),
    rows: students.map((s) => { const a = best[s.id]; return { id: s.id, name: s.name, student_no: s.username, class_name: s.class_name, attempt_id: a?.id || null, status: a?.status || 'none', total: a?.status === 'submitted' ? a.total_score : null, obj: a?.objective_score, sub: a?.subjective_score, grading: a?.grading, extra: extra[s.id] || 0 }; }),
  };
});
get('/api/teacher/attempts/:aid', TCH, ({ user, params }) => {
  const a = q.get('SELECT * FROM attempts WHERE id=?', +params.aid);
  if (!a) throw notFound();
  if (a.exam_id) examOf(user, a.exam_id); else ownStudent(user, a.user_id);
  const s = q.get('SELECT name, username FROM users WHERE id=?', a.user_id);
  return { ...attemptView(a, { forceReveal: true }), student: { name: s.name, student_no: s.username } };
});
put('/api/teacher/attempts/:aid/answers/:qid', TCH, ({ user, params, body, ip }) => {
  const a = q.get('SELECT * FROM attempts WHERE id=?', +params.aid);
  if (!a) throw notFound();
  if (a.exam_id) examOf(user, a.exam_id); else ownStudent(user, a.user_id);
  const s = body.teacher_score === null || body.teacher_score === '' ? null : Math.max(0, Math.min(10, +body.teacher_score));
  q.run('UPDATE answers SET teacher_score=?, reviewed_by=?, flagged=0 WHERE attempt_id=? AND question_id=?', s, user.id, a.id, +params.qid);
  recompute(a.id);
  if (s !== null) recordResult(a.user_id, getQ(+params.qid), s >= 6, null, 'teacher');
  audit(user.id, 'adjust_score', `${a.id}/${params.qid}=${s}`, ip);
  return { ok: true };
});
post('/api/teacher/exams/:id/reopen', TCH, ({ user, params, body }) => {
  const e = examOf(user, +params.id);
  const cfg = P(e.config, {});
  cfg.extra_attempts = cfg.extra_attempts || {};
  cfg.extra_attempts[body.user_id] = (cfg.extra_attempts[body.user_id] || 0) + 1;
  q.run('UPDATE exams SET config=? WHERE id=?', J(cfg), e.id);
  return { ok: true };
});
post('/api/teacher/exams/:id/regrade', TCH, ({ user, params }) => {
  const e = examOf(user, +params.id);
  const list = q.all("SELECT id FROM attempts WHERE exam_id=? AND status='submitted' AND grading IN ('manual','error','pending')", e.id);
  list.forEach((a) => { q.run("UPDATE answers SET ai_feedback=NULL WHERE attempt_id=? AND ai_score IS NULL", a.id); startEssayGrading(a.id); });
  return { queued: list.length };
});
del('/api/teacher/exams/:id', TCH, ({ user, params }) => {
  const e = examOf(user, +params.id);
  if (q.get('SELECT 1 x FROM attempts WHERE exam_id=?', e.id)) q.run("UPDATE exams SET status='cancelled' WHERE id=?", e.id);
  else q.run('DELETE FROM exams WHERE id=?', e.id);
  return { ok: true };
});
post('/api/teacher/papers/standard', TCH, ({ user }) => {
  const comp = composePaper(null, { mode: 'standard' });
  const d = new Date();
  return { paper_id: newPaper(user.id, 'mock', `标准模拟卷 · ${d.getMonth() + 1}月${d.getDate()}日`, comp, { mode: 'standard' }), total: comp.total };
});

/* ---------- exports (CSV opens in Excel) ---------- */
get('/api/teacher/exams/:id/export', TCH, ({ user, params }) => {
  const e = examOf(user, +params.id);
  const ids = P(e.class_ids, []);
  const students = q.all(`SELECT u.id,u.name,u.username,c.name class_name FROM students s JOIN users u ON u.id=s.user_id JOIN classes c ON c.id=s.class_id WHERE s.class_id IN (${idsIn(ids)}) ORDER BY c.name,u.username`, ...ids);
  const rows = [['学号', '姓名', '班级', '单选', '填空', '判断', '综合分析', '总分', '状态']];
  for (const s of students) {
    const a = q.get("SELECT * FROM attempts WHERE exam_id=? AND user_id=? ORDER BY (status='submitted') DESC, total_score DESC LIMIT 1", e.id, s.id);
    const by = { single: 0, fill: 0, tf: 0, essay: 0 };
    if (a?.status === 'submitted') for (const r of q.all('SELECT a.score, a.teacher_score, a.ai_score, a.self_score, qu.type FROM answers a JOIN questions qu ON qu.id=a.question_id WHERE a.attempt_id=?', a.id))
      by[r.type] += r.type === 'essay' ? (r.teacher_score ?? r.ai_score ?? r.self_score ?? 0) : r.score || 0;
    rows.push([s.username, s.name, s.class_name, by.single, by.fill, by.tf, by.essay, a?.status === 'submitted' ? a.total_score : '', !a ? '未参加' : a.status === 'submitted' ? '已交卷' : '作答中']);
  }
  return { __csv: toCSV(rows), name: `${e.title}-成绩表.csv` };
});
get('/api/teacher/classes/:id/export', TCH, ({ user, params }) => {
  const c = ownClass(user, +params.id);
  const rows = [['学号', '姓名', '专业', '累计答题', '正确率%', '模拟考次数', '最高分', '未掌握错题', '最近登录', '薄弱章节']];
  for (const s of studentTable(c.id)) rows.push([s.student_no, s.name, s.major, s.answered, s.acc ?? '', s.mocks, s.best ?? '', s.wrong, s.last_login ? new Date(s.last_login).toLocaleString('zh-CN') : '从未登录', s.weak || '']);
  return { __csv: toCSV(rows), name: `${c.name}-练习情况.csv` };
});
get('/api/teacher/research-export', TCH, ({ user, query }) => {
  const clsIds = query.class ? (ownClass(user, +query.class), [+query.class]) : myClasses(user).map((c) => c.id);
  const salt = getSetting('research_salt') || (() => { const s = crypto.randomBytes(8).toString('hex'); q.run("INSERT OR REPLACE INTO settings(k,v) VALUES('research_salt',?)", J(s)); return s; })();
  const from = query.from ? new Date(query.from).getTime() : 0, to = query.to ? new Date(query.to).getTime() + DAY : Date.now() + DAY;
  const rows = [['匿名编号', '班级', '答卷ID', '答卷类型', '题目ID', '章节', '题型', '是否正确', '得分', '时间']];
  if (clsIds.length) for (const r of q.all(`SELECT t.user_id u, s.class_id cl, t.id aid, t.kind, a.question_id qid, qu.chapter_id ch, qu.type ty, a.is_correct ok, COALESCE(a.teacher_score,a.ai_score,a.self_score,a.score) sc, a.updated_at ts
    FROM answers a JOIN attempts t ON t.id=a.attempt_id JOIN students s ON s.user_id=t.user_id JOIN questions qu ON qu.id=a.question_id
    WHERE s.class_id IN (${idsIn(clsIds)}) AND a.updated_at BETWEEN ? AND ? ORDER BY a.updated_at`, ...clsIds, from, to))
    rows.push([crypto.createHash('sha256').update(salt + r.u).digest('hex').slice(0, 10), r.cl, r.aid, r.kind, r.qid, r.ch, TYPE_LABEL[r.ty], r.ok ?? '', r.sc ?? '', new Date(r.ts).toISOString()]);
  return { __csv: toCSV(rows), name: '作答日志-匿名.csv' };
});

/* ---------- question bank ---------- */
get('/api/questions', TCH, ({ query }) => {
  let sql = 'SELECT * FROM questions WHERE 1=1';
  const a = [];
  if (query.chapter) { sql += ' AND chapter_id=?'; a.push(+query.chapter); }
  if (query.type) { sql += ' AND type=?'; a.push(query.type); }
  if (query.status) { sql += ' AND status=?'; a.push(query.status); }
  if (query.source) { sql += ' AND source=?'; a.push(query.source); }
  if (query.reported === '1') sql += ' AND reports>0';
  if (query.q) { sql += ' AND stem LIKE ?'; a.push(`%${query.q}%`); }
  const total = q.get(sql.replace('SELECT *', 'SELECT COUNT(*) n'), ...a).n;
  const size = Math.min(100, +query.size || 30), page = Math.max(1, +query.page || 1);
  const items = q.all(sql + ' ORDER BY chapter_id, type, no, id LIMIT ? OFFSET ?', ...a, size, (page - 1) * size).map((r) => ({ ...r, options: P(r.options, []), answer: P(r.answer) }));
  const counts = q.all("SELECT chapter_id c, type t, COUNT(*) n FROM questions WHERE status='active' AND scope='all' GROUP BY chapter_id, type");
  return { total, page, size, items, counts, drafts: q.get("SELECT COUNT(*) n FROM questions WHERE status='draft'").n, issues: q.get('SELECT COUNT(*) n FROM import_issues').n };
});
get('/api/questions/issues', TCH, () => ({ issues: q.all('SELECT * FROM import_issues ORDER BY id DESC LIMIT 100').map((r) => ({ ...r, raw: P(r.raw) })), reports: q.all('SELECT r.*, qu.stem FROM reports r JOIN questions qu ON qu.id=r.question_id ORDER BY r.id DESC LIMIT 50') }));
function sanitize(b, base = {}) {
  const t = b.type || base.type;
  const out = { chapter_id: +(b.chapter_id ?? base.chapter_id), type: t, stem: String(b.stem ?? base.stem ?? '').trim(), analysis: String(b.analysis ?? base.analysis ?? '') };
  if (!out.stem || !(out.chapter_id >= 1 && out.chapter_id <= 11)) throw bad('请填写题干和章节');
  if (t === 'single') {
    const opts = (b.options ?? base.options ?? []).map((o, i) => ({ key: o.key || 'ABCDEFGH'[i], text: String(o.text ?? o).trim() })).filter((o) => o.text);
    const ans = String(b.answer ?? base.answer ?? '').toUpperCase().replace(/[^A-H]/g, '');
    if (opts.length < 2 || !ans || ![...ans].every((c) => opts.some((o) => o.key === c))) throw bad('单选题需要至少 2 个选项和有效答案');
    out.options = J(opts); out.answer = J(ans); out.blank_count = 0;
  } else if (t === 'tf') { out.options = null; out.answer = J(b.answer === true || b.answer === 'true' || (b.answer === undefined && base.answer === true) || b.answer === '√'); out.blank_count = 0; }
  else if (t === 'fill') {
    let ans = b.answer ?? base.answer;
    if (typeof ans === 'string') ans = ans.split(/[;；\n]/).map((s) => s.split(/[/／]/).map((x) => x.trim()).filter(Boolean)).filter((a) => a.length);
    if (!Array.isArray(ans) || !ans.length) throw bad('填空题需要至少一个答案（多个空用分号分隔，同义答案用斜杠）');
    out.options = null; out.answer = J(ans); out.blank_count = ans.length;
  } else if (t === 'essay') { out.options = null; out.answer = null; out.blank_count = 0; if (out.chapter_id < 7) throw bad('综合分析题只出自第 7–11 章'); }
  else throw bad('题型无效');
  return out;
}
post('/api/questions', TCH, ({ user, body }) => {
  const x = sanitize(body);
  const id = q.run(`INSERT INTO questions(chapter_id,type,stem,options,answer,blank_count,analysis,source,scope,status,owner_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    x.chapter_id, x.type, x.stem, x.options, x.answer, x.blank_count, x.analysis, 'teacher', 'all', 'active', user.id).lastInsertRowid;
  return { id };
});
patch('/api/questions/:id', TCH, ({ user, params, body, ip }) => {
  const cur = getQ(+params.id);
  if (!cur) throw notFound();
  if (body.status && Object.keys(body).length === 1) { q.run('UPDATE questions SET status=? WHERE id=?', body.status, cur.id); return { ok: true }; }
  if (body.promote) { q.run("UPDATE questions SET scope='all', source='ai-reviewed', status='active' WHERE id=?", cur.id); return { ok: true }; }
  const x = sanitize(body, cur);
  q.run('UPDATE questions SET chapter_id=?, stem=?, options=?, answer=?, blank_count=?, analysis=?, status=? WHERE id=?', x.chapter_id, x.stem, x.options, x.answer, x.blank_count, x.analysis, body.status || (cur.status === 'draft' ? 'active' : cur.status), cur.id);
  audit(user.id, 'edit_question', cur.id, ip);
  return { ok: true };
});
post('/api/questions/upload', TCH, async ({ user, body, ip }) => {
  const files = body.files || [];
  if (!files.length) throw bad('请选择 Word 文件（文件名需包含“第N章”）');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qimp-'));
  try {
    for (const f of files) fs.writeFileSync(path.join(dir, path.basename(f.filename)), Buffer.from(f.data, 'base64'));
    const out = path.join(dir, 'out.json');
    await new Promise((res, rej) => execFile(process.env.PYTHON || 'python', ['-I', path.join(ROOT, 'tools', 'import_questions.py'), dir, out], { timeout: 120000 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));
    const { questions, issues } = JSON.parse(fs.readFileSync(out, 'utf8'));
    let added = 0, dup = 0, draft = 0;
    tx(() => {
      for (const x of questions) {
        if (q.get('SELECT 1 x FROM questions WHERE chapter_id=? AND type=? AND stem=?', x.chapter, x.type, x.stem)) { dup++; continue; }
        importQuestion(x, 'textbook'); added++; if (!x.ok) draft++;
      }
      for (const s of issues) q.run('INSERT INTO import_issues(chapter_id,sec,no,raw,created_at) VALUES(?,?,?,?,?)', s.chapter, s.sec, s.no, J(s.raw), Date.now());
    });
    audit(user.id, 'import_questions', `${added}+${dup}dup`, ip);
    return { parsed: questions.length, added, duplicates: dup, to_review: draft + issues.length };
  } catch (e) { throw new HttpError(400, `解析失败：${String(e.message).slice(0, 200)}`); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}, { limit: 40 * 1024 * 1024 });
