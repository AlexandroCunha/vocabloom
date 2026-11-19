'use strict';
/** HTTP security headers, access-code check and a small in-memory rate limiter. */
const crypto = require('crypto');

// Scripts: only the page's own inline script may run, identified by its hash (scripts/build.js
// computes the hashes and keeps lib/csp-hashes.json and vercel.json in step). Injected scripts,
// inline event handlers and anything from other websites are blocked.
// Styles stay 'unsafe-inline' because the page sets style attributes (for example blank widths).
const { scripts: SCRIPT_HASHES } = require('./csp-hashes.json');

function buildCsp(scriptHashes) {
  return [
    "default-src 'none'",
    "script-src " + scriptHashes.map(hash => "'sha256-" + hash + "'").join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
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
 * Fixed-window limiter kept in memory. On serverless hosting each instance has its own
 * memory, so this slows abuse down but is not a guarantee: pair it with the host's
 * firewall / rate limiting for a hard limit.
 */
function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const entries = new Map();

  function current(key) {
    const entry = entries.get(key);
    if (!entry || entry.resetAt <= now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  }
  function prune() {
    if (entries.size < 5000) return;
    entries.forEach((entry, key) => { if (entry.resetAt <= now()) entries.delete(key); });
  }

  return {
    isLimited(key) {
      const entry = current(key);
      return !!entry && entry.count >= limit;
    },
    retryAfterSeconds(key) {
      const entry = current(key);
      return entry ? Math.max(1, Math.ceil((entry.resetAt - now()) / 1000)) : 0;
    },
    hit(key) {
      prune();
      const entry = current(key);
      if (entry) entry.count += 1;
      else entries.set(key, { count: 1, resetAt: now() + windowMs });
    },
    reset(key) { entries.delete(key); }
  };
}

/** Behind Vercel the first x-forwarded-for entry is the real client address. */
function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { CSP, buildCsp, SECURITY_HEADERS, applySecurityHeaders, sameCode, createRateLimiter, clientIp };
