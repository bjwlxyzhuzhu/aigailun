// Populate a running dev server with demo accounts (NOT for production).
// node tools/demo_seed.mjs [baseUrl]   -> admin / teacher01 / student 2026100101 with known passwords.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || 'http://localhost:3000';
const api = async (m, u, b, t) => { const r = await fetch(base + '/api' + u, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const login = async (u, p) => (await api('POST', '/auth/login', { username: u, password: p })).j.token;

const ADMIN = 'Admin@2026x', TEACHER = 'Teacher@2026', STUDENT = 'Student@2026';
let adm = await login('admin', ADMIN);
if (!adm) { adm = await login('admin', 'Admin@2026'); await api('POST', '/auth/password', { old: 'Admin@2026', new: ADMIN }, adm); adm = await login('admin', ADMIN); }
let t = await login('teacher01', TEACHER);
if (!t) {
  const c = await api('POST', '/admin/teachers', { username: 'teacher01', name: '示范教师' }, adm);
  t = await login('teacher01', c.j.initial_password);
  await api('POST', '/auth/password', { old: c.j.initial_password, new: TEACHER }, t);
  t = await login('teacher01', TEACHER);
  const data = fs.readFileSync(path.join(ROOT, 'data/sample_students_gbk.csv')).toString('base64');
  await api('POST', '/teacher/students/import', { filename: 'sample.csv', data, college: '机械工程学院', commit: true }, t);
}
let s = await login('2026100101', STUDENT);
if (!s) { s = await login('2026100101', '100101'); if (s) { await api('POST', '/auth/password', { old: '100101', new: STUDENT }, s); } }
console.log(`管理员 admin / ${ADMIN}\n教师 teacher01 / ${TEACHER}\n学生 2026100101 / ${STUDENT}（另有 15 名示范学生，初始密码为学号后6位）`);
