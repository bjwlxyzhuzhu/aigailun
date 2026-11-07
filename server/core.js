// Question model, grading, paper composition (PRD §2) and wrong-book rules (PRD §3.5).
import { q, P, J } from './db.js';
import { normAnswer, similarity, shuffle } from './lib.js';

export const TYPE_ORDER = ['single', 'fill', 'tf', 'essay'];
export const TYPE_LABEL = { single: '单选题', fill: '填空题', tf: '判断题', essay: '综合分析题' };
export const STD = { single: 50, fill: 10, tf: 10, essay: 3 };
export const points = (qu) => (qu.type === 'fill' ? Math.max(1, qu.blank_count) : qu.type === 'essay' ? 10 : 1);

export function parseQ(r) {
  if (!r) return null;
  return { ...r, options: P(r.options, []), answer: P(r.answer), rubric: P(r.rubric) };
}
export const getQ = (id) => parseQ(q.get('SELECT * FROM questions WHERE id=?', id));
export function getQs(ids) {
  if (!ids.length) return [];
  const rows = q.all(`SELECT * FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map(parseQ);
  const m = new Map(rows.map((r) => [r.id, r]));
  return ids.map((i) => m.get(i)).filter(Boolean);
}

/* ---------- grading ---------- */
export function judge(qu, resp) {
  if (qu.type === 'single') {
    const a = [].concat(qu.answer || []).join('').split('').sort().join('');
    const r = [].concat(resp ?? []).join('').split('').sort().join('');
    const ok = !!r && a === r;
    return { got: ok ? 1 : 0, of: 1, correct: ok };
  }
  if (qu.type === 'tf') {
    const ok = typeof resp === 'boolean' && resp === qu.answer;
    return { got: ok ? 1 : 0, of: 1, correct: ok };
  }
  if (qu.type === 'fill') {
    const sets = (qu.answer || []).map((syn) => syn.map(normAnswer));
    const used = new Set();
    let got = 0;
    for (const r of [].concat(resp ?? []).map(normAnswer)) {
      if (!r) continue;
      const j = sets.findIndex((s, i) => !used.has(i) && s.includes(r));
      if (j >= 0) { used.add(j); got++; }
    }
    return { got, of: sets.length, correct: got === sets.length };
  }
  return { got: 0, of: 10, correct: null };
}

/** Question as sent to the browser. `reveal` adds answer + analysis. */
export function view(qu, layout, reveal = false) {
  const opts = qu.type === 'single'
    ? (layout?.[qu.id] || qu.options.map((o) => o.key)).map((k) => qu.options.find((o) => o.key === k)).filter(Boolean)
    : undefined;
  const v = { id: qu.id, type: qu.type, chapter: qu.chapter_id, stem: qu.stem, options: opts, blank_count: qu.blank_count, points: points(qu), source: qu.source };
  if (reveal) {
    v.answer = qu.answer;
    v.analysis = qu.analysis;
  }
  return v;
}

/* ---------- paper composition ---------- */
function allocate(total, avail, min = 0) {
  const chs = Object.keys(avail).filter((c) => avail[c] > 0);
  const out = Object.fromEntries(chs.map((c) => [c, 0]));
  let left = Math.min(total, chs.reduce((s, c) => s + avail[c], 0));
  for (const c of chs) { const m = Math.min(min, avail[c], left); out[c] = m; left -= m; }
  while (left > 0) {
    const room = chs.filter((c) => out[c] < avail[c]);
    if (!room.length) break;
    const sum = room.reduce((s, c) => s + avail[c], 0);
    const shares = room.map((c) => ({ c, x: (left * avail[c]) / sum }));
    let given = 0;
    for (const s of shares) { const g = Math.min(Math.floor(s.x), avail[s.c] - out[s.c]); out[s.c] += g; given += g; }
    left -= given;
    if (left > 0 && given === 0) {
      shares.sort((a, b) => (b.x % 1) - (a.x % 1));
      for (const s of shares) { if (left <= 0) break; if (out[s.c] < avail[s.c]) { out[s.c]++; left--; } }
    }
  }
  return out;
}

function weightedSample(pool, n, weightOf, chosenStems, budget = null) {
  const items = pool.slice();
  const picked = [];
  let blanks = 0;
  while (picked.length < n && items.length) {
    const ws = items.map(weightOf);
    const tot = ws.reduce((a, b) => a + b, 0);
    let r = Math.random() * tot, i = 0;
    for (; i < items.length - 1; i++) { r -= ws[i]; if (r <= 0) break; }
    const it = items.splice(i, 1)[0];
    if (chosenStems.some((s) => similarity(s, it.stem) > 0.8)) continue; // PRD: same-paper de-dup
    if (budget !== null && blanks + it.blank_count > budget) continue;
    picked.push(it);
    chosenStems.push(it.stem);
    blanks += it.blank_count;
    if (budget !== null && blanks >= budget) break;
  }
  return picked;
}

function weightsFor(userId, prefer) {
  const wrong = new Set(userId ? q.all('SELECT question_id FROM wrong_book WHERE user_id=? AND mastered=0', userId).map((r) => r.question_id) : []);
  const acc = {};
  if (userId && prefer === 'weak') {
    for (const r of q.all(`SELECT qu.chapter_id c, SUM(a.is_correct) ok, COUNT(*) n FROM answers a JOIN attempts t ON t.id=a.attempt_id
      JOIN questions qu ON qu.id=a.question_id WHERE t.user_id=? AND a.is_correct IS NOT NULL GROUP BY qu.chapter_id`, userId)) acc[r.c] = r.ok / r.n;
  }
  return (it) => {
    let w = 1;
    if (prefer === 'wrong' && wrong.has(it.id)) w += 6;
    if (prefer === 'weak') w += 4 * (1 - (acc[it.chapter_id] ?? 0.5));
    return w;
  };
}

export class ComposeError extends Error {}

/** config: {mode:'standard'|'custom', chapters?:number[], counts?:{single,fill,tf,essay}, prefer?:'weak'|'wrong'} */
export function composePaper(userId, config = {}) {
  const std = config.mode !== 'custom';
  const counts = std ? { ...STD } : { single: 0, fill: 0, tf: 0, essay: 0, ...(config.counts || {}) };
  const chapters = std ? null : (config.chapters?.length ? config.chapters.map(Number) : null);
  const wf = weightsFor(userId, config.prefer);
  const base = `SELECT * FROM questions WHERE status='active' AND (scope='all' OR owner_id=?)`;
  const all = q.all(base, userId ?? -1).map(parseQ);
  const usable = (t) => all.filter((x) => x.type === t && (!chapters || chapters.includes(x.chapter_id)));
  const stems = [];
  const chosen = {};
  const layout = {};

  for (const t of ['single', 'tf']) {
    const need = Math.max(0, counts[t] | 0);
    if (!need) { chosen[t] = []; continue; }
    const pool = usable(t);
    const byCh = {};
    for (const x of pool) (byCh[x.chapter_id] ||= []).push(x);
    const avail = Object.fromEntries(Object.entries(byCh).map(([c, a]) => [c, a.length]));
    const al = allocate(need, avail, t === 'single' && std ? 2 : 0);
    let out = [];
    for (const [c, n] of Object.entries(al)) out.push(...weightedSample(byCh[c], n, wf, stems));
    if (out.length < Math.min(need, pool.length)) { // de-dup skipped some: top up from the rest
      const have = new Set(out.map((x) => x.id));
      out.push(...weightedSample(pool.filter((x) => !have.has(x.id)), need - out.length, wf, stems));
    }
    chosen[t] = out;
  }

  // fill: allocate by blank count so the paper totals exactly the requested blanks
  const needBlanks = Math.max(0, counts.fill | 0);
  chosen.fill = [];
  if (needBlanks) {
    const pool = usable('fill');
    const byCh = {};
    for (const x of pool) (byCh[x.chapter_id] ||= []).push(x);
    const avail = Object.fromEntries(Object.entries(byCh).map(([c, a]) => [c, a.reduce((s, x) => s + x.blank_count, 0)]));
    const al = allocate(needBlanks, avail, 0);
    let got = 0;
    for (const [c, n] of Object.entries(al)) {
      const pk = weightedSample(byCh[c], 99, wf, stems, n);
      chosen.fill.push(...pk);
      got += pk.reduce((s, x) => s + x.blank_count, 0);
    }
    for (let guard = 0; got < needBlanks && guard < 50; guard++) {
      const have = new Set(chosen.fill.map((x) => x.id));
      const pk = weightedSample(pool.filter((x) => !have.has(x.id) && x.blank_count <= needBlanks - got), 1, wf, stems, needBlanks - got);
      if (!pk.length) break;
      chosen.fill.push(...pk);
      got += pk[0].blank_count;
    }
  }

  // essays: from chapters 7-11, distinct chapters first
  const needEssay = Math.max(0, counts.essay | 0);
  chosen.essay = [];
  if (needEssay) {
    let pool = usable('essay').filter((x) => x.chapter_id >= 7 && x.chapter_id <= 11);
    if (!pool.length) pool = all.filter((x) => x.type === 'essay' && x.chapter_id >= 7);
    const byCh = {};
    for (const x of pool) (byCh[x.chapter_id] ||= []).push(x);
    let chs = shuffle(Object.keys(byCh));
    while (chosen.essay.length < needEssay && pool.length) {
      if (!chs.length) chs = shuffle(Object.keys(byCh));
      const c = chs.shift();
      const cand = shuffle(byCh[c]).find((x) => !chosen.essay.includes(x) && !stems.some((s) => similarity(s, x.stem) > 0.8));
      if (cand) { chosen.essay.push(cand); stems.push(cand.stem); }
      if (chosen.essay.length >= pool.length) break;
    }
  }

  const ordered = [];
  for (const t of TYPE_ORDER) {
    const arr = shuffle(chosen[t] || []);
    for (const x of arr) {
      ordered.push(x);
      if (x.type === 'single') layout[x.id] = shuffle(x.options.map((o) => o.key));
    }
  }
  if (!ordered.length) throw new ComposeError('题库中没有符合条件的题目');
  const total = ordered.reduce((s, x) => s + points(x), 0);
  const summary = {};
  for (const x of ordered) {
    const s = (summary[x.type] ||= { n: 0, points: 0 });
    s.n++;
    s.points += points(x);
  }
  const chapterDist = {};
  for (const x of ordered) chapterDist[x.chapter_id] = (chapterDist[x.chapter_id] || 0) + 1;
  return { ids: ordered.map((x) => x.id), layout, total, summary, chapterDist };
}

/* ---------- wrong book ---------- */
export function recordResult(userId, qu, correct, answer, source) {
  if (correct === null || correct === undefined) return;
  const now = Date.now();
  const row = q.get('SELECT * FROM wrong_book WHERE user_id=? AND question_id=?', userId, qu.id);
  if (!correct) {
    if (row) q.run('UPDATE wrong_book SET wrong_count=wrong_count+1,last_wrong_at=?,last_answer=?,source=?,streak_correct=0,mastered=0 WHERE user_id=? AND question_id=?', now, J(answer), source, userId, qu.id);
    else q.run('INSERT INTO wrong_book(user_id,question_id,wrong_count,last_wrong_at,last_answer,source) VALUES(?,?,?,?,?,?)', userId, qu.id, 1, now, J(answer), source);
  } else if (row && !row.mastered) {
    const s = row.streak_correct + 1; // PRD: two correct answers in a row -> mastered
    q.run('UPDATE wrong_book SET streak_correct=?, mastered=? WHERE user_id=? AND question_id=?', s, s >= 2 ? 1 : 0, userId, qu.id);
  }
}
