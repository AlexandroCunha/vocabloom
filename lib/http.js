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

function sendTooManyRequests(res, retryAfterSeconds, message) {
  sendJson(res, 429, { error: message }, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds || 1))) });
}

/** Vercel parses JSON bodies for us; the local server does the same. Returns an object or null. */
function readJsonBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (error) { body = null; }
  }
  return body && typeof body === 'object' ? body : null;
}

/** One query-string value (for example ?id=...) from the request URL, or ''. */
function readQuery(req, name) {
  try {
    return new URL(req.url || '', 'http://localhost').searchParams.get(name) || '';
  } catch (error) {
    return '';
  }
}

module.exports = { sendJson, sendTooManyRequests, readJsonBody, readQuery };
