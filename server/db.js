import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, role TEXT NOT NULL, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, must_change_pwd INTEGER DEFAULT 1, status TEXT DEFAULT 'active',
  fail_count INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0, last_login INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS classes(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, college TEXT, teacher_id INTEGER, semester TEXT, class_key_id INTEGER,
  UNIQUE(name, teacher_id));
CREATE TABLE IF NOT EXISTS students(
  user_id INTEGER PRIMARY KEY, student_no TEXT, college TEXT, major TEXT, grade TEXT, class_id INTEGER);
CREATE TABLE IF NOT EXISTS chapters(
  id INTEGER PRIMARY KEY, title TEXT, title_en TEXT, module TEXT, cover_url TEXT, spine_url TEXT, summary TEXT, points TEXT);
CREATE TABLE IF NOT EXISTS questions(
  id INTEGER PRIMARY KEY, chapter_id INTEGER, type TEXT NOT NULL, stem TEXT NOT NULL, options TEXT, answer TEXT,
  blank_count INTEGER DEFAULT 0, analysis TEXT, rubric TEXT, source TEXT DEFAULT 'textbook',
  scope TEXT DEFAULT 'all', owner_id INTEGER, status TEXT DEFAULT 'active', no INTEGER, reports INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS q_ch ON questions(chapter_id, type, status);
CREATE TABLE IF NOT EXISTS kb_chunks(id INTEGER PRIMARY KEY, chapter_id INTEGER, slide_no INTEGER, text TEXT);
CREATE TABLE IF NOT EXISTS papers(
  id INTEGER PRIMARY KEY, owner_id INTEGER, kind TEXT, title TEXT, config TEXT, question_ids TEXT, layout TEXT,
  total_score INTEGER, exam_id INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS exams(
  id INTEGER PRIMARY KEY, teacher_id INTEGER, title TEXT, paper_policy TEXT, class_ids TEXT, start_at INTEGER, end_at INTEGER,
  duration_min INTEGER DEFAULT 90, max_attempts INTEGER DEFAULT 1, unified_paper_id INTEGER, config TEXT, status TEXT DEFAULT 'published', created_at INTEGER);
CREATE TABLE IF NOT EXISTS attempts(
  id INTEGER PRIMARY KEY, user_id INTEGER, paper_id INTEGER, exam_id INTEGER, kind TEXT, started_at INTEGER, deadline_at INTEGER,
  submitted_at INTEGER, objective_score REAL DEFAULT 0, subjective_score REAL DEFAULT 0, total_score REAL DEFAULT 0,
  status TEXT DEFAULT 'doing', grading TEXT DEFAULT 'none', cur_index INTEGER DEFAULT 0, flags TEXT);
CREATE INDEX IF NOT EXISTS at_u ON attempts(user_id, kind, status);
CREATE TABLE IF NOT EXISTS answers(
  attempt_id INTEGER, question_id INTEGER, response TEXT, is_correct INTEGER, score REAL, ai_score REAL, ai_feedback TEXT,
  teacher_score REAL, self_score REAL, reviewed_by INTEGER, flagged INTEGER DEFAULT 0, updated_at INTEGER,
  PRIMARY KEY(attempt_id, question_id));
CREATE TABLE IF NOT EXISTS wrong_book(
  user_id INTEGER, question_id INTEGER, wrong_count INTEGER DEFAULT 0, last_wrong_at INTEGER, last_answer TEXT, source TEXT,
  streak_correct INTEGER DEFAULT 0, mastered INTEGER DEFAULT 0, starred INTEGER DEFAULT 0, PRIMARY KEY(user_id, question_id));
CREATE TABLE IF NOT EXISTS api_keys(
  id INTEGER PRIMARY KEY, scope TEXT, owner_id INTEGER, provider TEXT, base_url TEXT, model TEXT, key_cipher TEXT, key_last4 TEXT,
  daily_limit_cny REAL DEFAULT 0, acked INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, updated_at INTEGER,
  UNIQUE(scope, owner_id));
CREATE TABLE IF NOT EXISTS model_prices(
  provider TEXT, model TEXT, input_per_m REAL, output_per_m REAL, currency TEXT DEFAULT 'USD', fx_rate REAL DEFAULT 7.1,
  updated_at INTEGER, PRIMARY KEY(provider, model));
CREATE TABLE IF NOT EXISTS ai_usage(
  id INTEGER PRIMARY KEY, user_id INTEGER, key_id INTEGER, feature TEXT, input_tokens INTEGER, output_tokens INTEGER,
  est_cost REAL, actual_cost REAL, created_at INTEGER);
CREATE INDEX IF NOT EXISTS usage_u ON ai_usage(user_id, created_at);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT, target TEXT, ip TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, user_id INTEGER, question_id INTEGER, note TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS import_issues(id INTEGER PRIMARY KEY, chapter_id INTEGER, sec TEXT, no INTEGER, raw TEXT, created_at INTEGER);
`);

// Prepared statements are cached by SQL text (parsing/planning on every request was a visible cost under load).
// Dynamic SQL with variable IN (...) lists is bounded by the cap below.
const stmts = new Map();
const stmt = (sql) => {
  let s = stmts.get(sql);
  if (!s) { if (stmts.size > 500) stmts.clear(); s = db.prepare(sql); stmts.set(sql, s); }
  return s;
};
export const q = {
  all: (sql, ...p) => stmt(sql).all(...p),
  get: (sql, ...p) => stmt(sql).get(...p),
  run: (sql, ...p) => stmt(sql).run(...p),
};
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const J = (v) => (v === undefined ? null : JSON.stringify(v));
export const P = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

export function getSetting(k, d = null) { const r = q.get('SELECT v FROM settings WHERE k=?', k); return r ? P(r.v, d) : d; }
export function setSetting(k, v) { q.run('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, J(v)); }

/* secrets persisted beside the DB so tokens and encrypted keys survive restarts */
function secret(name) {
  const f = path.join(DATA_DIR, name);
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}
export const JWT_SECRET = process.env.JWT_SECRET || secret('.jwt_secret');
export const KEY_SECRET = crypto.createHash('sha256').update(process.env.KEY_SECRET || secret('.key_secret')).digest();
export const audit = (actor, action, target, ip = '') =>
  q.run('INSERT INTO audit_logs(actor_id,action,target,ip,created_at) VALUES(?,?,?,?,?)', actor ?? null, action, String(target ?? ''), ip, Date.now());
