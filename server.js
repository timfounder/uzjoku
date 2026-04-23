// Minimal static server for Railway / Node hosts.
// Serves index.html, assets/, and any other project files.
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif' : 'image/gif',
  '.ico' : 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf' : 'font/ttf',
  '.txt' : 'text/plain; charset=utf-8',
};

function safeJoin(root, reqPath){
  const p = path.normalize(path.join(root, reqPath));
  if (!p.startsWith(root)) return null;
  return p;
}

http.createServer((req, res) => {
  try {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/' || url === '') url = '/index.html';
    let fp = safeJoin(ROOT, url);
    if (!fp) { res.writeHead(403); return res.end('forbidden'); }

    fs.stat(fp, (err, st) => {
      if (err || !st) {
        // SPA fallback → index.html
        fp = path.join(ROOT, 'index.html');
      } else if (st.isDirectory()) {
        fp = path.join(fp, 'index.html');
      }
      fs.readFile(fp, (e, data) => {
        if (e) { res.writeHead(404); return res.end('not found'); }
        const ext = path.extname(fp).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(data);
      });
    });
  } catch (e) {
    res.writeHead(500); res.end('server error');
  }
}).listen(PORT, () => {
  console.log('UZJOKU site listening on :' + PORT);
});
