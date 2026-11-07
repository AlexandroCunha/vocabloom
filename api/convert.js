'use strict';
/**
 * POST /api/convert
 * Body: { pdf: "<base64 of the PDF>" }
 * Header: x-access-code (only if ACCESS_CODE is set on the server)
 * Returns: { worksheet: {...} }
 *
 * Claude reads the PDF (text AND layout/images) and fills the create_worksheet tool,
 * so the answer always arrives as structured JSON.
 */
const fs = require('fs');
const path = require('path');

const { TOOL } = require('../lib/worksheet-schema');
const { SYSTEM } = require('../lib/prompt');
const { normalize } = require('../lib/normalize');
const { applySecurityHeaders, sameCode, createRateLimiter, clientIp } = require('../lib/security');

const API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_B64 = 4.2 * 1024 * 1024; // Vercel serverless request bodies are limited to 4.5 MB
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Wrong access codes: 5 tries per 15 minutes. Conversions: 20 per hour (each one costs money).
const failedCodes = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 });
const conversions = createRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000 });

function send(res, code, obj, headers) {
  applySecurityHeaders(res);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.keys(headers || {}).forEach(name => res.setHeader(name, headers[name]));
  res.end(JSON.stringify(obj));
}

function tooManyRequests(res, limiter, ip, message) {
  send(res, 429, { error: message }, { 'Retry-After': String(limiter.retryAfterSeconds(ip)) });
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  return body && typeof body === 'object' ? body : null;
}

/** Returns an error response description, or null when the PDF looks acceptable. */
function checkPdf(pdf) {
  if (!pdf) return { code: 400, error: 'No PDF received.' };
  if (pdf.length > MAX_B64) return { code: 413, error: 'The PDF is too large (limit about 3 MB). Compress it and try again.' };
  if (!pdf.startsWith('JVBER') || !BASE64.test(pdf)) return { code: 400, error: 'That file is not a PDF.' };
  return null;
}

function readDemoWorksheet() {
  const file = path.join(__dirname, '..', 'public', 'demo.json');
  return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
}

async function askClaude(pdf, key) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
          { type: 'text', text: 'Convert this PDF worksheet into interactive exercises. Reply only by calling the create_worksheet tool.' }
        ]
      }]
    })
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });

  const ip = clientIp(req);
  const requiredCode = process.env.ACCESS_CODE;
  if (requiredCode) {
    if (failedCodes.isLimited(ip)) return tooManyRequests(res, failedCodes, ip, 'Too many wrong access codes. Try again later.');
    if (!sameCode(req.headers['x-access-code'] || '', requiredCode)) {
      failedCodes.hit(ip);
      return send(res, 401, { error: 'Wrong or missing access code.' });
    }
    failedCodes.reset(ip);
  }

  const body = parseBody(req);
  const pdf = body && typeof body.pdf === 'string' ? body.pdf : '';
  const problem = checkPdf(pdf);
  if (problem) return send(res, problem.code, { error: problem.error });

  if (conversions.isLimited(ip)) return tooManyRequests(res, conversions, ip, 'Too many conversions. Try again later.');
  conversions.hit(ip);

  if (process.env.MOCK === '1') {
    try { return send(res, 200, { worksheet: readDemoWorksheet(), mock: true }); }
    catch (e) { return send(res, 500, { error: 'Mock data missing.' }); }
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return send(res, 500, { error: 'The server is not configured yet.' });

  let upstream, data;
  try {
    upstream = await askClaude(pdf, key);
    data = await upstream.json();
  } catch (e) {
    return send(res, 502, { error: 'Could not reach the AI service. Please try again.' });
  }

  if (!upstream.ok) {
    // The provider's message stays in the server log only: it is never shown to users.
    console.error('AI service error', upstream.status);
    if (upstream.status === 429 || upstream.status === 529) {
      return send(res, 503, { error: 'The AI service is busy. Try again in a minute.' });
    }
    return send(res, 502, { error: 'The AI service returned an error. Please try again.' });
  }
  if (data.stop_reason === 'max_tokens') {
    return send(res, 422, { error: 'This PDF is too long to convert in one go. Split it into smaller parts.' });
  }
  const toolUse = (data.content || []).find(c => c.type === 'tool_use');
  if (!toolUse) return send(res, 502, { error: 'The AI did not return a worksheet. Please try again.' });

  const worksheet = normalize(toolUse.input);
  if (!worksheet.sections.length) return send(res, 422, { error: 'No exercises were found in this PDF.' });
  return send(res, 200, { worksheet });
}

module.exports = handler;
module.exports.normalize = normalize;
