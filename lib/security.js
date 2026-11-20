'use strict';
/** HTTP security headers, access-code check and client fingerprints. */
const crypto = require('crypto');

// Scripts: only the page's own inline script may run, identified by its hash (scripts/build.js
// computes the hashes and keeps lib/csp-hashes.json and vercel.json in step). Injected scripts,
// inline event handlers and anything from other websites are blocked.
// Styles stay 'unsafe-inline' because the page sets style attributes (for example blank widths).
// worker-src and manifest-src let the page install its own service worker and manifest (offline mode).
const { scripts: SCRIPT_HASHES } = require('./csp-hashes.json');

function buildCsp(scriptHashes) {
  return [
    "default-src 'none'",
    "script-src " + scriptHashes.map(hash => "'sha256-" + hash + "'").join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join('; ');
}
const CSP = buildCsp(SCRIPT_HASHES);

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

function applySecurityHeaders(res) {
  Object.keys(SECURITY_HEADERS).forEach(name => res.setHeader(name, SECURITY_HEADERS[name]));
}

/** Constant-time comparison (hashing first makes both buffers the same length). */
function sameCode(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * The teacher whose code this is, or null. Every code is compared, whichever one matches first,
 * so the time taken does not reveal how many characters were right or which teacher it was.
 */
function findTeacher(code, teachers) {
  let found = null;
  teachers.forEach(teacher => {
    const same = sameCode(code, teacher.code);
    if (same && !found) found = teacher;
  });
  return found;
}

/**
 * A stable fingerprint of a client address, for rate limits. The address itself is never stored:
 * it is mixed with a server secret first, so the stored value cannot be turned back into an IP.
 */
function hashClient(ip, secret) {
  return crypto.createHmac('sha256', String(secret)).update('vocabloom:client:' + ip).digest('hex').slice(0, 32);
}

/** Behind Vercel the first x-forwarded-for entry is the real client address. */
function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { CSP, buildCsp, SECURITY_HEADERS, applySecurityHeaders, sameCode, findTeacher, hashClient, clientIp };
