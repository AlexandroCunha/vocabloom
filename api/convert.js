'use strict';
/**
 * POST /api/convert
 * Body:   { pdf: "<base64 of the PDF>" }
 * Header: x-access-code (when ACCESS_CODE is set on the server)
 * Reply:  { worksheet: {...} }
 *
 * This file only orchestrates: guard the request, then delegate to the lib/ modules.
 */
const fs = require('fs');
const path = require('path');

const { LIMITS, readConfig } = require('../lib/config');
const { findPdfProblem } = require('../lib/pdf');
const { convertPdf, ConversionError } = require('../lib/claude');
const { normalize } = require('../lib/normalize');
const { sameCode, createRateLimiter, clientIp } = require('../lib/security');
const { sendJson, sendTooManyRequests, readJsonBody } = require('../lib/http');

const wrongCodes = createRateLimiter(LIMITS.wrongCodes);
const conversions = createRateLimiter(LIMITS.conversions);

function readDemoWorksheet() {
  const file = path.join(__dirname, '..', 'public', 'demo.json');
  return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Returns true when the request may continue. Otherwise the response has already been sent. */
function passesAccessCheck(req, res, config, ip) {
  if (!config.accessCode) return true;
  if (wrongCodes.isLimited(ip)) {
    sendTooManyRequests(res, wrongCodes, ip, 'Too many wrong access codes. Try again later.');
    return false;
  }
  if (!sameCode(req.headers['x-access-code'] || '', config.accessCode)) {
    wrongCodes.hit(ip);
    sendJson(res, 401, { error: 'Wrong or missing access code.' });
    return false;
  }
  wrongCodes.reset(ip);
  return true;
}

function respondWithDemo(res) {
  try {
    sendJson(res, 200, { worksheet: readDemoWorksheet(), mock: true });
  } catch (error) {
    sendJson(res, 500, { error: 'Mock data missing.' });
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });

  const config = readConfig();
  const ip = clientIp(req);
  if (!passesAccessCheck(req, res, config, ip)) return;

  const body = readJsonBody(req);
  const pdf = body && typeof body.pdf === 'string' ? body.pdf : '';
  const problem = findPdfProblem(pdf);
  if (problem) return sendJson(res, problem.status, { error: problem.message });

  if (conversions.isLimited(ip)) {
    return sendTooManyRequests(res, conversions, ip, 'Too many conversions. Try again later.');
  }
  conversions.hit(ip);

  if (config.mock) return respondWithDemo(res);
  if (!config.apiKey) return sendJson(res, 500, { error: 'The server is not configured yet.' });

  try {
    const worksheet = await convertPdf(pdf, config);
    sendJson(res, 200, { worksheet });
  } catch (error) {
    if (!(error instanceof ConversionError)) throw error;
    sendJson(res, error.status, { error: error.publicMessage });
  }
}

module.exports = handler;
module.exports.normalize = normalize;
