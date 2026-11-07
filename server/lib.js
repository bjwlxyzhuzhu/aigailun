// Zero-dependency helpers: crypto, tokens, CSV/XLSX parsing, text similarity.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

/* ---------- passwords / tokens / key encryption ---------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32);
  return `s1$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [, s, h] = stored.split('$');
    const x = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32);
    return crypto.timingSafeEqual(x, Buffer.from(h, 'hex'));
  } catch { return false; }
}
/* Async variants run scrypt on the libuv threadpool so a 300-student login burst does not freeze the event loop.
   Concurrency is capped below the pool size so file reads (static assets) never starve behind hashing. */
const POOL = +process.env.UV_THREADPOOL_SIZE || 4;
const MAX_SCRYPT = Math.max(1, POOL - 2);
let running = 0; const waiting = [];
const scryptAsync = (pw, salt) => new Promise((resolve, reject) => {
  const go = () => {
    running++;
    crypto.scrypt(pw, salt, 32, (err, key) => {
      running--; if (waiting.length) waiting.shift()();
      err ? reject(err) : resolve(key);
    });
  };
  running < MAX_SCRYPT ? go() : waiting.push(go);
});
export async function hashPasswordAsync(pw) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('hex')}$${(await scryptAsync(pw, salt)).toString('hex')}`;
}
export async function verifyPasswordAsync(pw, stored) {
  try {
    const [, s, h] = stored.split('$');
    return crypto.timingSafeEqual(await scryptAsync(pw, Buffer.from(s, 'hex')), Buffer.from(h, 'hex'));
  } catch { return false; }
}
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signToken(payload, secret, ttlSec = 7 * 86400) {
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken(tok, secret) {
  if (!tok || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  const exp = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
export function encrypt(text, key32) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key32, iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob, key32) {
  const [iv, tag, ct] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key32, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
export const maskKey = (k) => (k && k.length > 8 ? `${k.slice(0, 3)}****${k.slice(-4)}` : '****');

/* ---------- text ---------- */
export function normAnswer(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s，,。.、;；:：!！?？"'“”‘’（）()\[\]【】《》\-_]/g, '');
}
function bigrams(s) {
  const t = normAnswer(s), set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}
export function similarity(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------- CSV / XLSX ---------- */
export function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('gbk').decode(buf); }
}
export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}
export function toCSV(rows) {
  const esc = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
/** Minimal zip reader (central directory) for .xlsx / .pptx / .docx. */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 zip 文件');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lh = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(lh, lh + csize);
    files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export function parseXlsx(buf) {
  const z = unzip(buf);
  const ss = [];
  if (z.has('xl/sharedStrings.xml')) {
    for (const m of z.get('xl/sharedStrings.xml').toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g))
      ss.push(unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  }
  const sheetName = [...z.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  const xml = z.get(sheetName).toString('utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const r = [];
    for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(cm[1])?.[1] || 'A';
      let col = 0; for (const ch of ref) col = col * 26 + ch.charCodeAt(0) - 64; col--;
      const t = /t="(\w+)"/.exec(cm[1])?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(cm[2] || '')?.[1];
      const is = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[2] || '')?.[1];
      r[col] = t === 's' ? ss[+v] : t === 'inlineStr' ? unxml(is || '') : unxml(v ?? '');
    }
    rows.push(Array.from(r, (x) => String(x ?? '').trim()));
  }
  return rows.filter((r) => r.some((x) => x));
}
export function pptxSlides(buf) {
  const z = unzip(buf);
  return [...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1]) - parseInt(b.match(/(\d+)\.xml/)[1]))
    .map((k) => [...z.get(k).toString('utf8').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unxml(m[1])).join(' ').replace(/\s+/g, ' ').trim());
}
