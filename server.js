'use strict';
// Tiny local dev server (no dependencies): node server.js  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

// load .env if present
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}

const handler = require('./api/convert.js');
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/convert') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { req.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { req.body = null; }
      handler(req, res).catch(e => { console.error(e); res.statusCode = 500; res.end('{"error":"Server error"}'); });
    });
    return;
  }
  let f = path.normalize(path.join(PUB, url === '/' ? 'index.html' : url));
  if (!f.startsWith(PUB)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(f, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(process.env.PORT || 3000, () => console.log('Vocabloom running on http://localhost:' + (process.env.PORT || 3000)));
