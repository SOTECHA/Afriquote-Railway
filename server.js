/**
 * AfriQuote — Railway-Ready Server
 * Serves:
 *  - Static HTML frontend at / and /public/
 *  - REST API at /api/
 *  - Health check at /health
 *
 * Railway auto-detects PORT from environment.
 * Zero npm dependencies.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

// ── Load .env (Railway provides env vars natively; this covers local dev) ──
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  });
}

const { dispatch, corsHeaders } = require('./src/routes/router');

const PORT   = parseInt(process.env.PORT, 10) || 4000;
const HOST   = '0.0.0.0';  // Railway requires binding to 0.0.0.0
const PUBLIC = path.join(__dirname, 'public');

// ── MIME types ────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

// ── Serve a static file ───────────────────────────────────────────
function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) return false;
  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type':   mime,
    'Content-Length': body.length,
    'Cache-Control':  ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  res.end(body);
  return true;
}

// ── Main request handler ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // Attach CORS headers to all responses
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  const method = req.method.toUpperCase();
  const url    = req.url.split('?')[0];

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204); return res.end();
  }

  // ── API routes (/api/* and /health) ────────────────────────────
  if (url.startsWith('/api/') || url === '/health' || url === '/health/') {
    return dispatch(req, res);
  }

  // ── Static file serving ────────────────────────────────────────
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405); return res.end('Method Not Allowed');
  }

  // Route map: URL prefix → public subdirectory
  const routes = [
    { prefix: '/mvps/',    dir: path.join(PUBLIC, 'mvps') },
    { prefix: '/assets/',  dir: path.join(PUBLIC, 'assets') },
    { prefix: '/frontend/',dir: path.join(PUBLIC, 'frontend') },
  ];

  for (const { prefix, dir } of routes) {
    if (url.startsWith(prefix)) {
      const file = path.join(dir, url.slice(prefix.length));
      if (serveStatic(res, file)) return;
    }
  }

  // Root URL map
  const PAGE_MAP = {
    '/':             path.join(PUBLIC, 'frontend', 'index.html'),
    '/app':          path.join(PUBLIC, 'frontend', 'app.html'),
    '/app.html':     path.join(PUBLIC, 'frontend', 'app.html'),
    '/pricing':      path.join(PUBLIC, 'frontend', 'sales.html'),
    '/sales':        path.join(PUBLIC, 'frontend', 'sales.html'),
    '/templates':    path.join(PUBLIC, 'frontend', 'templates.html'),
    '/compare':      path.join(PUBLIC, 'frontend', 'compare.html'),
    '/invoice':      path.join(PUBLIC, 'mvps', 'mvp1-invoice-sender.html'),
    '/tax':          path.join(PUBLIC, 'mvps', 'mvp3-tax-calculator.html'),
    '/quote':        path.join(PUBLIC, 'mvps', 'mvp4-quote-builder.html'),
    '/site-report':  path.join(PUBLIC, 'mvps', 'mvp5-site-report.html'),
    '/health-score': path.join(PUBLIC, 'mvps', 'mvp6-health-score.html'),
    '/favicon.ico':  path.join(PUBLIC, 'assets', 'afriquote-icon.png'),
  };

  const mapped = PAGE_MAP[url];
  if (mapped && serveStatic(res, mapped)) return;

  // Try the public directory directly
  const direct = path.join(PUBLIC, url);
  if (serveStatic(res, direct)) return;

  // 404
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
    <h2>Page not found</h2>
    <p><a href="/">← Back to AfriQuote</a></p>
  </body></html>`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') { console.error(`Port ${PORT} in use`); process.exit(1); }
  throw err;
});

server.listen(PORT, HOST, () => {
  const env = process.env.NODE_ENV || 'development';
  console.log('\n  ╔══════════════════════════════════════════════╗');
  console.log(`  ║  AfriQuote  ·  ${env.padEnd(29)}║`);
  console.log(`  ║  http://${HOST}:${PORT.toString().padEnd(35)}║`);
  console.log('  ║                                              ║');
  console.log('  ║  /              → Marketing website          ║');
  console.log('  ║  /app           → Full platform              ║');
  console.log('  ║  /pricing       → Sales page                 ║');
  console.log('  ║  /invoice       → Invoice MVP                ║');
  console.log('  ║  /tax           → Tax calculator             ║');
  console.log('  ║  /quote         → Quote builder              ║');
  console.log('  ║  /api/auth/...  → Authentication API         ║');
  console.log('  ║  /health        → Health check               ║');
  console.log('  ╚══════════════════════════════════════════════╝\n');
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });

module.exports = server;
