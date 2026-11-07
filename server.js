'use strict';
// Tiny local dev server (no dependencies): node server.js  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { applySecurityHeaders } = require('./lib/security');

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function loadEnvFile() {
  try {
    fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* no .env file: use the real environment */ }
}
loadEnvFile();

const handler = require('./api/convert.js');

function reply(res, code, text) {
  applySecurityHeaders(res);
  res.statusCode = code;
  res.end(text);
}

/** Maps a URL to a file inside public/, or returns null when it would escape that folder. */
function resolvePublicFile(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (e) { return null; }
  const file = path.normalize(path.join(PUBLIC_DIR, decoded === '/' ? 'index.html' : decoded));
  return file.startsWith(PUBLIC_DIR + path.sep) ? file : null;
}

function handleApi(req, res) {
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) { reply(res, 413, '{"error":"Request too large"}'); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    try { req.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { req.body = null; }
    handler(req, res).catch(err => { console.error(err); reply(res, 500, '{"error":"Server error"}'); });
  });
}

function handleStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');
  const file = resolvePublicFile(urlPath);
  if (!file) return reply(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return reply(res, 404, 'Not found');
    applySecurityHeaders(res);
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    if (urlPath === '/api/convert') return handleApi(req, res);
    handleStatic(req, res, urlPath);
  }).listen(port, () => console.log('Vocabloom running on http://localhost:' + port));
}

module.exports = { resolvePublicFile };
