// Load test: N students (default 300) hit a throw-away server at once, like the start of a class mock exam.
//   node tools/loadtest.mjs [N] [saveRounds]
// Phases per student: login -> shelf/me -> generate standard paper -> start attempt -> load questions
//   -> autosave x saveRounds (with jitter) -> submit -> report. Prints p50/p95/p99 and errors per endpoint.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const N = +process.argv[2] || 300;
const ROUNDS = +process.argv[3] || 6;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-load-'));
for (const f of ['questions.json', 'essays_seed.json', 'kb.json']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(tmp, f));
const PORT = 4100 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'server/index.js')], { env: { ...process.env, PORT, DATA_DIR: tmp }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('[ready]') && r()));
const base = `http://localhost:${PORT}`;

const lat = new Map(); // label -> [ms]
const errs = new Map();
async function api(label, method, url, body, token) {
  const t0 = performance.now();
  let s = 0, j = null;
  try {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    s = r.status; const t = await r.text(); try { j = JSON.parse(t); } catch { j = t; }
  } catch (e) { s = 'ERR:' + (e.cause?.code || e.message); }
  if (label) {
    (lat.get(label) || lat.set(label, []).get(label)).push(performance.now() - t0);
    if (s !== 200) errs.set(label + ' ' + s, (errs.get(label + ' ' + s) || 0) + 1);
  }
  return { s, j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

try {
  // ---- setup: admin -> teacher -> N students (setup is not measured)
  let t0 = performance.now();
  let adm = (await api('', 'POST', '/api/auth/login', { username: 'admin', password: 'Admin@2026' })).j.token;
  await api('', 'POST', '/api/auth/password', { old: 'Admin@2026', new: 'Admin@2026x1' }, adm);
  adm = (await api('', 'POST', '/api/auth/login', { username: 'admin', password: 'Admin@2026x1' })).j.token;
  const t = (await api('', 'POST', '/api/admin/teachers', { username: 't1', name: '压测教师' }, adm)).j;
  let tch = (await api('', 'POST', '/api/auth/login', { username: 't1', password: t.initial_password })).j.token;
  await api('', 'POST', '/api/auth/password', { old: t.initial_password, new: 'Teacher2026a' }, tch);
  tch = (await api('', 'POST', '/api/auth/login', { username: 't1', password: 'Teacher2026a' })).j.token;
  const lines = ['学号,姓名,班级'];
  for (let i = 0; i < N; i++) lines.push(`2026${String(100000 + i)},学生${i},机械${1 + (i % 6)}班`);
  const data = Buffer.from('﻿' + lines.join('\n')).toString('base64');
  const imp = await api('', 'POST', '/api/teacher/students/import', { filename: 's.csv', data, college: '机械工程学院', commit: true }, tch);
  console.log(`setup: ${imp.j.committed ? 'imported ' + N + ' students' : 'IMPORT FAILED ' + JSON.stringify(imp.j).slice(0, 200)} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  if (!imp.j.committed) throw new Error('import failed');

  // ---- event-loop lag probe lives in the client too, but server-side lag shows up as latency on a cheap endpoint
  const probe = [];
  let probing = true;
  (async () => { while (probing) { const a = performance.now(); await api('', 'GET', '/index.html'); probe.push(performance.now() - a); await sleep(250); } })();

  // ---- the stampede
  const T0 = performance.now();
  const done = { n: 0 };
  async function student(i) {
    const no = `2026${String(100000 + i)}`;
    const lg = await api('login', 'POST', '/api/auth/login', { username: no, password: no.slice(-6) });
    if (lg.s !== 200) return;
    let tok = lg.j.token;
    // first login forces a password change (production behaviour)
    await api('chgpwd', 'POST', '/api/auth/password', { old: no.slice(-6), new: 'Stu' + no, }, tok);
    const lg2 = await api('login', 'POST', '/api/auth/login', { username: no, password: 'Stu' + no });
    if (lg2.s !== 200) return; tok = lg2.j.token;
    await Promise.all([api('shelf', 'GET', '/api/shelf', null, tok), api('me', 'GET', '/api/me', null, tok), api('static', 'GET', '/js/main.js')]);
    const gen = await api('generate', 'POST', '/api/papers/generate', { mode: 'standard' }, tok);
    if (gen.s !== 200) return;
    const st = await api('start', 'POST', '/api/attempts', { paper_id: gen.j.paper_id }, tok);
    if (st.s !== 200) return;
    const ex = await api('attempt', 'GET', `/api/attempts/${st.j.attempt_id}`, null, tok);
    if (ex.s !== 200) return;
    const answers = {};
    for (const x of ex.j.questions) answers[x.id] = x.type === 'single' ? x.options[0].key : x.type === 'tf' ? true : x.type === 'fill' ? Array(x.blank_count).fill('x') : '大模型存在幻觉问题，需要结合 RAG 与人工复核来缓解，并且应当注意隐私与伦理风险。';
    const ids = Object.keys(answers);
    for (let r = 0; r < ROUNDS; r++) {
      await sleep(800 + Math.random() * 1200);
      // incremental autosave: a handful of changed answers, plus one full save at the end of the round block
      const part = {}; for (let k = 0; k < 5; k++) { const id = ids[(r * 5 + k) % ids.length]; part[id] = answers[id]; }
      await api('autosave', 'PUT', `/api/attempts/${st.j.attempt_id}/answers`, { answers: r === ROUNDS - 1 ? answers : part, cur_index: r }, tok);
    }
    const sub = await api('submit', 'POST', `/api/attempts/${st.j.attempt_id}/submit`, {}, tok);
    if (sub.s !== 200) return;
    await api('report', 'GET', `/api/attempts/${st.j.attempt_id}/report`, null, tok);
    done.n++;
  }
  await Promise.all(Array.from({ length: N }, (_, i) => student(i)));
  probing = false;
  const wall = (performance.now() - T0) / 1000;

  console.log(`\n${N} students, ${ROUNDS} autosave rounds, wall ${wall.toFixed(1)}s, completed ${done.n}/${N}`);
  console.log('endpoint'.padEnd(10), 'n'.padStart(5), 'p50'.padStart(8), 'p95'.padStart(8), 'p99'.padStart(8), 'max'.padStart(8));
  for (const [k, v] of lat) { v.sort((a, b) => a - b); console.log(k.padEnd(10), String(v.length).padStart(5), ...[pct(v, .5), pct(v, .95), pct(v, .99), v.at(-1)].map((x) => (x.toFixed(0) + 'ms').padStart(8))); }
  probe.sort((a, b) => a - b);
  console.log('\nstatic probe (event-loop stall proxy): p50 %dms p95 %dms max %dms', pct(probe, .5).toFixed(0), pct(probe, .95).toFixed(0), probe.at(-1).toFixed(0));
  console.log('errors:', errs.size ? Object.fromEntries(errs) : 'none');
  const m = await fetch(base + '/index.html'); void m;
  const rss = (await import('node:child_process')).execSync(process.platform === 'win32' ? `powershell -NoProfile -Command "(Get-Process -Id ${srv.pid}).WorkingSet64/1MB"` : `ps -o rss= -p ${srv.pid}`).toString().trim();
  console.log('server memory:', process.platform === 'win32' ? (+rss).toFixed(0) + ' MB' : (+rss / 1024).toFixed(0) + ' MB');
} finally {
  srv.kill();
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true });
}
