'use strict';
/** Small helpers for JSON responses, shared by every API route. */
const { applySecurityHeaders } = require('./security');

function sendJson(res, status, body, extraHeaders) {
  applySecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.keys(extraHeaders || {}).forEach(name => res.setHeader(name, extraHeaders[name]));
  res.end(JSON.stringify(body));
}

function sendTooManyRequests(res, limiter, key, message) {
  sendJson(res, 429, { error: message }, { 'Retry-After': String(limiter.retryAfterSeconds(key)) });
}

/** Vercel parses JSON bodies for us; the local server does the same. Returns an object or null. */
function readJsonBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = null; }
  }
  return body && typeof body === 'object' ? body : null;
}

module.exports = { sendJson, sendTooManyRequests, readJsonBody };
