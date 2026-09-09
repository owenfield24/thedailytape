// Local static file server for public/, standing in for `vercel dev`. Mirrors
// vercel.json's "cleanUrls": true — a request for /pods/energy-power serves
// public/pods/energy-power.html — so local testing matches how the real
// Vercel deployment resolves URLs. No dependencies, per this project's
// zero-npm-dependency constraint.
//
// Usage: node scripts/dev-server.js [port]

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 4173;
const ROOT = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const safePath = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const requested = path.join(ROOT, safePath);

  // Exact file match first (covers /css/style.css, /data/*.json, etc.).
  if (fs.existsSync(requested) && fs.statSync(requested).isFile()) return requested;

  // Directory -> index.html, matching Vercel's static handling.
  if (fs.existsSync(requested) && fs.statSync(requested).isDirectory()) {
    const indexFile = path.join(requested, 'index.html');
    if (fs.existsSync(indexFile)) return indexFile;
  }

  // Clean URLs: /pods/energy-power -> public/pods/energy-power.html.
  const withHtml = `${requested}.html`;
  if (fs.existsSync(withHtml) && fs.statSync(withHtml).isFile()) return withHtml;

  return null;
}

const server = http.createServer((req, res) => {
  const filePath = resolveFile(req.url);

  if (!filePath) {
    const notFoundPath = path.join(ROOT, '404.html');
    if (fs.existsSync(notFoundPath)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(notFoundPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Serving public/ at http://localhost:${PORT} (clean URLs enabled, matching vercel.json)`);
});
