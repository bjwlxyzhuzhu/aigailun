import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { ROOT, JWT_SECRET, q } from './db.js';
import { verifyToken } from './lib.js';

export class HttpError extends Error { constructor(status, msg, extra = {}) { super(msg); this.status = status; this.extra = extra; } }
export const bad = (m, extra) => new HttpError(400, m, extra);
export const forbid = (m = '无权限') => new HttpError(403, m);
export const notFound = (m = '不存在') => new HttpError(404, m);

const routes = [];
export function route(method, pattern, roles, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, roles, handler, opts });
}
export const get = (p, r, h, o) => route('GET', p, r, h, o);
export const post = (p, r, h, o) => route('POST', p, r, h, o);
export const put = (p, r, h, o) => route('PUT', p, r, h, o);
export const patch = (p, r, h, o) => route('PATCH', p, r, h, o);
export const del = (p, r, h, o) => route('DELETE', p, r, h, o);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const WEB = path.join(ROOT, 'web');

function readBody(req, limit) {
  return new Promise((res, rej) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { rej(new HttpError(413, '请求体过大')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

export function authUser(req) {
  const h = req.headers.authorization || '';
  const p = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '', JWT_SECRET);
  if (!p) return null;
  const u = q.get('SELECT id,role,username,name,status,must_change_pwd FROM users WHERE id=?', p.uid);
  return u && u.status === 'active' ? u : null;
}

async function handleApi(req, res, url) {
  const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!route) throw new HttpError(404, '接口不存在');
  const m = route.re.exec(url.pathname);
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const user = authUser(req);
  if (route.roles) {
    if (!user) throw new HttpError(401, '请先登录');
    if (Array.isArray(route.roles) && !route.roles.includes(user.role)) throw forbid();
    if (user.must_change_pwd && !route.opts.allowMustChange) throw new HttpError(403, '请先修改初始密码', { must_change_pwd: true });
  }
  let body = {};
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const raw = await readBody(req, route.opts.limit || 4 * 1024 * 1024);
    if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { throw bad('请求格式错误'); } }
  }
  const query = Object.fromEntries(url.searchParams);
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0];
  const out = await route.handler({ req, res, params, query, body, user, ip });
  if (res.writableEnded) return;
  if (out && out.__html) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(out.__html); }
  if (out && out.__csv) {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.name)}` });
    return res.end(out.__csv);
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(out ?? { ok: true }));
}

/* Static files are tiny (<1MB total): keep them in memory with a precomputed gzip + ETag so a 300-student
   page-load burst costs no disk reads or compression. Cache is filled lazily and invalidated by mtime. */
const staticCache = new Map();
function loadStatic(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile()) return null;
  const hit = staticCache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const raw = fs.readFileSync(file);
  const ext = path.extname(file);
  const textual = ['.html', '.js', '.css', '.json', '.svg', '.txt'].includes(ext);
  const e = { mtime: st.mtimeMs, raw, gz: textual && raw.length > 512 ? zlib.gzipSync(raw, { level: 9 }) : null,
    etag: '"' + crypto.createHash('md5').update(raw).digest('hex').slice(0, 16) + '"', ext, checked: Date.now() };
  staticCache.set(file, e);
  return e;
}
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  let e = loadStatic(file);
  if (!e) {
    if (path.extname(rel)) { res.writeHead(404); return res.end('Not found'); }
    e = loadStatic(path.join(WEB, 'index.html')); // SPA fallback
    if (!e) { res.writeHead(404); return res.end(); }
  }
  const immutable = e.ext === '.woff2' || e.ext === '.webp';
  const headers = { 'content-type': MIME[e.ext] || 'application/octet-stream', etag: e.etag, vary: 'accept-encoding',
    'cache-control': immutable ? 'public, max-age=604800' : 'no-cache' };
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); return res.end(); }
  const gz = e.gz && /gzip/.test(req.headers['accept-encoding'] || '');
  if (gz) headers['content-encoding'] = 'gzip';
  const body = gz ? e.gz : e.raw;
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function startServer(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      if (res.headersSent) return res.end();
      const status = e.status || 500;
      if (status === 500) console.error('[error]', req.method, url.pathname, e);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? '服务器内部错误' : e.message, ...(e.extra || {}), ...(e.code ? { code: e.code } : {}) }));
    }
  });
  server.keepAliveTimeout = 65000; // keep-alive across autosave intervals
  server.listen({ port, backlog: 2048 }, () => console.log(`[ready] http://localhost:${port}`));
  return server;
}
