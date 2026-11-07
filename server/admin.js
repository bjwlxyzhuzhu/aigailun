import crypto from 'node:crypto';
import { q, tx, P, J, getSetting, setSetting, audit } from './db.js';
import { get, post, put, patch, del, bad, notFound } from './http.js';
import { hashPassword, pptxSlides } from './lib.js';
import { saveKey, keyOut } from './student.js';
import * as AI from './ai.js';

const ADM = ['admin'];
const SETTINGS = { final_exam_date: 'string', allow_global_key_for_students: 'bool', global_daily_limit_cny: 'number', default_password_digits: 'number', college_default: 'string', semester: 'string', ai_concurrency: 'number', rewrite_enabled: 'bool' };

/* ---------- teachers ---------- */
get('/api/admin/teachers', ADM, () => q.all(`SELECT u.id,u.username,u.name,u.status,u.last_login,
  (SELECT COUNT(*) FROM classes c WHERE c.teacher_id=u.id) classes FROM users u WHERE role='teacher' ORDER BY u.id`));
post('/api/admin/teachers', ADM, ({ user, body, ip }) => {
  const username = String(body.username || '').trim(), name = String(body.name || '').trim();
  if (!username || !name) throw bad('请填写工号和姓名');
  if (q.get('SELECT 1 x FROM users WHERE username=?', username)) throw bad('该工号已存在');
  const pw = String(body.password || '') || crypto.randomBytes(5).toString('hex') + 'A1';
  q.run('INSERT INTO users(role,username,name,password_hash,must_change_pwd,created_at) VALUES(?,?,?,?,1,?)', 'teacher', username, name, hashPassword(pw), Date.now());
  audit(user.id, 'create_teacher', username, ip);
  return { ok: true, initial_password: pw };
});
patch('/api/admin/teachers/:id', ADM, ({ user, params, body, ip }) => {
  const t = q.get("SELECT * FROM users WHERE id=? AND role='teacher'", params.id);
  if (!t) throw notFound();
  if (body.status) q.run('UPDATE users SET status=? WHERE id=?', body.status === 'disabled' ? 'disabled' : 'active', t.id);
  if (body.name) q.run('UPDATE users SET name=? WHERE id=?', String(body.name), t.id);
  let pw = null;
  if (body.reset) { pw = crypto.randomBytes(5).toString('hex') + 'A1'; q.run('UPDATE users SET password_hash=?, must_change_pwd=1, fail_count=0, locked_until=0 WHERE id=?', hashPassword(pw), t.id); }
  audit(user.id, 'edit_teacher', t.username, ip);
  return { ok: true, initial_password: pw };
});

/* ---------- global key, settings, prices ---------- */
get('/api/admin/global-key', ADM, () => ({ key: keyOut(q.get("SELECT * FROM api_keys WHERE scope='global'")) }));
put('/api/admin/global-key', ADM, ({ user, body }) => keyOut(saveKey('global', 0, { ...body, ack: true }, user.id)));
del('/api/admin/global-key', ADM, ({ user }) => { q.run("DELETE FROM api_keys WHERE scope='global'"); audit(user.id, 'delete_key', 'global'); return { ok: true }; });
post('/api/admin/global-key/test', ADM, async ({ body }) => {
  let k = q.get("SELECT * FROM api_keys WHERE scope='global'");
  if (!k) throw bad('请先保存全局 Key');
  try { return await AI.testKey(k); } catch (e) { throw Object.assign(bad(e.message), { code: e.code }); }
});
get('/api/admin/settings', ADM, () => Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, getSetting(k, SETTINGS[k] === 'bool' ? false : SETTINGS[k] === 'number' ? 0 : '')])));
put('/api/admin/settings', ADM, ({ user, body }) => {
  for (const [k, t] of Object.entries(SETTINGS)) if (k in body) setSetting(k, t === 'bool' ? !!body[k] : t === 'number' ? +body[k] || 0 : String(body[k] ?? ''));
  audit(user.id, 'settings', Object.keys(body).join(','));
  return { ok: true };
});
get('/api/admin/prices', ADM, () => q.all('SELECT * FROM model_prices ORDER BY provider, model'));
put('/api/admin/prices', ADM, ({ user, body }) => {
  for (const p of body.prices || []) {
    if (!p.provider || !p.model) continue;
    q.run(`INSERT INTO model_prices VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider,model) DO UPDATE SET input_per_m=excluded.input_per_m,output_per_m=excluded.output_per_m,currency=excluded.currency,fx_rate=excluded.fx_rate,updated_at=excluded.updated_at`,
      p.provider, p.model, +p.input_per_m || 0, +p.output_per_m || 0, p.currency === 'CNY' ? 'CNY' : 'USD', +p.fx_rate || 7.1, Date.now());
  }
  audit(user.id, 'update_prices', String((body.prices || []).length));
  return { ok: true };
});

/* ---------- knowledge base (PPT) ---------- */
get('/api/admin/kb', ADM, () => q.all('SELECT c.id, c.title, (SELECT COUNT(*) FROM kb_chunks k WHERE k.chapter_id=c.id) chunks FROM chapters c ORDER BY c.id'));
post('/api/admin/kb/import', ADM, ({ user, body, ip }) => {
  const ch = +body.chapter;
  if (!q.get('SELECT 1 x FROM chapters WHERE id=?', ch)) throw bad('章节无效');
  let slides;
  try { slides = pptxSlides(Buffer.from(body.data, 'base64')); } catch (e) { throw bad('无法解析该 PPTX：' + e.message); }
  tx(() => {
    q.run('DELETE FROM kb_chunks WHERE chapter_id=?', ch);
    slides.forEach((t, i) => { if (t.length > 8) q.run('INSERT INTO kb_chunks(chapter_id,slide_no,text) VALUES(?,?,?)', ch, i + 1, t.slice(0, 1500)); });
  });
  audit(user.id, 'kb_import', `${ch}:${slides.length}`, ip);
  return { slides: slides.length };
}, { limit: 150 * 1024 * 1024 });

/* ---------- usage & audit ---------- */
get('/api/admin/usage', ADM, () => ({
  total: q.get('SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COALESCE(SUM(actual_cost),0) c, COUNT(*) n FROM ai_usage'),
  by_feature: q.all('SELECT feature, COUNT(*) n, SUM(input_tokens+output_tokens) tokens, SUM(actual_cost) cost FROM ai_usage GROUP BY feature ORDER BY cost DESC'),
  by_user: q.all(`SELECT u.username, u.name, u.role, COUNT(*) n, SUM(a.input_tokens+a.output_tokens) tokens, SUM(a.actual_cost) cost FROM ai_usage a LEFT JOIN users u ON u.id=a.user_id GROUP BY a.user_id ORDER BY cost DESC LIMIT 30`),
  by_day: q.all(`SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') d, COUNT(*) n, SUM(actual_cost) cost FROM ai_usage GROUP BY d ORDER BY d DESC LIMIT 14`),
}));
get('/api/admin/audit', ADM, ({ query }) => q.all(`SELECT l.*, u.username FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.id DESC LIMIT ?`, Math.min(300, +query.limit || 100)));
get('/api/admin/overview', ADM, () => ({
  users: q.all('SELECT role, COUNT(*) n FROM users GROUP BY role'), questions: q.get("SELECT COUNT(*) n FROM questions WHERE status='active' AND scope='all'").n,
  drafts: q.get("SELECT COUNT(*) n FROM questions WHERE status='draft'").n, attempts: q.get('SELECT COUNT(*) n FROM attempts').n,
}));
