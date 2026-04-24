// Static + admin server for OʻzJOKU.
// Serves index.html / assets/, plus a password-protected admin API
// for editing translations and uploading photos. Zero runtime deps.

const http   = require('http');
const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');

const PORT   = process.env.PORT || 3000;
const ROOT   = __dirname;
const I18N_PATH    = path.join(ROOT, 'assets', 'i18n.js');
const UPLOADS_DIR  = process.env.UPLOADS_DIR || path.join(ROOT, 'assets', 'uploads');
const ADMIN_PASS   = process.env.ADMIN_PASSWORD || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET   || '';

const COOKIE_NAME = 'uzj_admin';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;        // 12h
const MAX_BODY_BYTES = 25 * 1024 * 1024;            // 25 MB upload cap
const ALLOWED_IMG = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif'
]);
const IMG_EXT = {
  'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp',
  'image/gif':'.gif','image/svg+xml':'.svg','image/avif':'.avif'
};

const MIME = {
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.avif':'image/avif',
  '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8',
};

/* -------------------- helpers -------------------- */

function safeJoin(root, reqPath){
  const p = path.normalize(path.join(root, reqPath));
  if (!p.startsWith(root)) return null;
  return p;
}

function send(res, status, body, headers = {}){
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj){
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function readBody(req, limit = MAX_BODY_BYTES){
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseCookies(header){
  const out = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

function signSession(payload){
  if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET not configured');
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', ADMIN_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySession(token){
  if (!token || !ADMIN_SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(data).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function isAuthed(req){
  const cookies = parseCookies(req.headers.cookie);
  return Boolean(verifySession(cookies[COOKIE_NAME]));
}

function adminConfigured(){
  return Boolean(ADMIN_PASS && ADMIN_SECRET);
}

/* -------------------- i18n storage --------------------
 * Source of truth is assets/i18n.js. We parse the literal
 * `window.I18N = {...};` by `eval` in a sandboxed Function to
 * preserve template literals (e.g. art_body) without bringing
 * a parser dependency. On write, we serialize as a tidy JS file.
 */

async function loadI18n(){
  const src = await fsp.readFile(I18N_PATH, 'utf8');
  const fn  = new Function('const window={}; ' + src + '; return window.I18N;');
  return fn();
}

function quote(value){
  // Use template literal for multi-line strings (preserves newlines /
  // existing HTML article body); otherwise double-quoted JSON-style.
  if (typeof value !== 'string') return JSON.stringify(value);
  if (value.includes('\n')) {
    return '`' + value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
  }
  return JSON.stringify(value);
}

function serializeI18n(dict){
  const langs = Object.keys(dict);
  const lines = ['/* UZJOKU — i18n dictionary */', 'window.I18N = {'];
  langs.forEach((lang, li) => {
    lines.push(`  ${lang}: {`);
    const keys = Object.keys(dict[lang]);
    keys.forEach((k, ki) => {
      const comma = ki < keys.length - 1 ? ',' : '';
      lines.push(`    ${k}: ${quote(dict[lang][k])}${comma}`);
    });
    lines.push(li < langs.length - 1 ? '  },' : '  }');
  });
  lines.push('};', '');
  return lines.join('\n');
}

async function saveI18n(dict){
  const out = serializeI18n(dict);
  // Sanity-check by parsing back before overwriting.
  // eslint-disable-next-line no-new-func
  const fn = new Function('const window={}; ' + out + '; return window.I18N;');
  const parsed = fn();
  if (!parsed || !parsed.ru || !parsed.uz || !parsed.en) {
    throw new Error('serialization sanity check failed');
  }
  // Backup current file once per save.
  try { await fsp.copyFile(I18N_PATH, I18N_PATH + '.bak'); } catch {}
  await fsp.writeFile(I18N_PATH, out, 'utf8');
}

/* -------------------- uploads -------------------- */

async function ensureUploads(){
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
}

function safeUploadName(name, contentType){
  const base = (name || 'image').toString()
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
  let ext = path.extname(base).toLowerCase();
  if (!ext && IMG_EXT[contentType]) ext = IMG_EXT[contentType];
  const stem = ext ? base.slice(0, -ext.length) : base;
  const stamp = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  return `${stem || 'image'}-${stamp}${ext || '.bin'}`;
}

async function listUploads(){
  await ensureUploads();
  const entries = await fsp.readdir(UPLOADS_DIR, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    const stat = await fsp.stat(path.join(UPLOADS_DIR, e.name));
    files.push({ name: e.name, url: `/assets/uploads/${encodeURIComponent(e.name)}`,
                 size: stat.size, mtime: stat.mtimeMs });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

/* -------------------- routing -------------------- */

async function handleApi(req, res, url){
  // Login is the only public endpoint.
  if (url === '/api/login' && req.method === 'POST') {
    if (!adminConfigured()) return sendJson(res, 503, { error: 'admin_not_configured' });
    let body; try { body = JSON.parse((await readBody(req, 1024)).toString('utf8') || '{}'); }
    catch { return sendJson(res, 400, { error: 'bad_json' }); }
    if (typeof body.password !== 'string') return sendJson(res, 400, { error: 'missing_password' });
    const a = Buffer.from(body.password); const b = Buffer.from(ADMIN_PASS);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return sendJson(res, 401, { error: 'bad_password' });
    const token = signSession({ sub: 'admin', exp: Date.now() + SESSION_TTL_MS });
    res.setHeader('Set-Cookie',
      `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}`);
    return sendJson(res, 200, { ok: true });
  }

  if (url === '/api/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return sendJson(res, 200, { ok: true });
  }

  if (url === '/api/me' && req.method === 'GET') {
    return sendJson(res, 200, {
      authed: isAuthed(req),
      configured: adminConfigured(),
    });
  }

  // All other /api/* require auth.
  if (!isAuthed(req)) return sendJson(res, 401, { error: 'unauthorized' });

  if (url === '/api/i18n' && req.method === 'GET') {
    const dict = await loadI18n();
    return sendJson(res, 200, dict);
  }

  if (url === '/api/i18n' && req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
    catch { return sendJson(res, 400, { error: 'bad_json' }); }
    if (!body || typeof body !== 'object' || !body.ru || !body.uz || !body.en) {
      return sendJson(res, 400, { error: 'expected_ru_uz_en' });
    }
    // Coerce all values to strings, drop unknown shapes.
    const clean = {};
    for (const lang of ['ru','uz','en']) {
      clean[lang] = {};
      for (const k of Object.keys(body[lang])) {
        const v = body[lang][k];
        clean[lang][k] = (v === null || v === undefined) ? '' : String(v);
      }
    }
    await saveI18n(clean);
    return sendJson(res, 200, { ok: true });
  }

  if (url === '/api/uploads' && req.method === 'GET') {
    return sendJson(res, 200, { files: await listUploads() });
  }

  if (url === '/api/upload' && req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
    catch { return sendJson(res, 400, { error: 'bad_json' }); }
    const { name, contentType, dataBase64 } = body || {};
    if (typeof contentType !== 'string' || !ALLOWED_IMG.has(contentType)) {
      return sendJson(res, 400, { error: 'unsupported_type' });
    }
    if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
      return sendJson(res, 400, { error: 'missing_data' });
    }
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length === 0 || buf.length > MAX_BODY_BYTES) {
      return sendJson(res, 400, { error: 'bad_size' });
    }
    await ensureUploads();
    const filename = safeUploadName(name, contentType);
    await fsp.writeFile(path.join(UPLOADS_DIR, filename), buf);
    return sendJson(res, 200, {
      ok: true, name: filename, url: `/assets/uploads/${encodeURIComponent(filename)}`, size: buf.length
    });
  }

  if (url.startsWith('/api/upload/') && req.method === 'DELETE') {
    const name = decodeURIComponent(url.slice('/api/upload/'.length));
    if (!/^[\w.\-]+$/.test(name)) return sendJson(res, 400, { error: 'bad_name' });
    const fp = path.join(UPLOADS_DIR, name);
    if (!fp.startsWith(UPLOADS_DIR)) return sendJson(res, 400, { error: 'bad_path' });
    try { await fsp.unlink(fp); } catch (e) {
      if (e.code === 'ENOENT') return sendJson(res, 404, { error: 'not_found' });
      throw e;
    }
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'not_found' });
}

function serveStatic(req, res, urlPath){
  // Special case: /assets/uploads/* may live outside ROOT when UPLOADS_DIR is set.
  if (urlPath.startsWith('/assets/uploads/')) {
    const name = decodeURIComponent(urlPath.slice('/assets/uploads/'.length));
    if (!/^[\w.\-]+$/.test(name)) return send(res, 400, 'bad name');
    const fp = path.join(UPLOADS_DIR, name);
    if (!fp.startsWith(UPLOADS_DIR)) return send(res, 403, 'forbidden');
    return fs.readFile(fp, (e, data) => {
      if (e) return send(res, 404, 'not found');
      const ext = path.extname(fp).toLowerCase();
      send(res, 200, data, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      });
    });
  }

  let fp = safeJoin(ROOT, urlPath);
  if (!fp) return send(res, 403, 'forbidden');

  fs.stat(fp, (err, st) => {
    if (err || !st) {
      // SPA fallback → index.html (skip for /admin assets etc.)
      fp = path.join(ROOT, 'index.html');
    } else if (st.isDirectory()) {
      fp = path.join(fp, 'index.html');
    }
    fs.readFile(fp, (e, data) => {
      if (e) return send(res, 404, 'not found');
      const ext = path.extname(fp).toLowerCase();
      send(res, 200, data, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      });
    });
  });
}

http.createServer(async (req, res) => {
  try {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/' || url === '') url = '/index.html';

    // Admin UI
    if (url === '/admin' || url === '/admin/') {
      const fp = path.join(ROOT, 'assets', 'admin.html');
      return fs.readFile(fp, (e, data) => {
        if (e) return send(res, 404, 'admin not found');
        send(res, 200, data, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
      });
    }

    // API
    if (url.startsWith('/api/')) {
      try { await handleApi(req, res, url); }
      catch (err) {
        if (!res.headersSent) sendJson(res, 500, { error: 'server_error', detail: err.message });
      }
      return;
    }

    // Static
    serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, 500, 'server error');
  }
}).listen(PORT, () => {
  console.log(`UZJOKU site listening on :${PORT}`);
  if (!adminConfigured()) {
    console.log('Admin disabled — set ADMIN_PASSWORD and ADMIN_SECRET to enable /admin.');
  } else {
    console.log('Admin enabled at /admin');
  }
});
