'use strict';
/**
 * POST /api/convert
 * Body:   { pdf: "<base64 of the PDF>", fresh?: true }
 * Header: x-access-code (when an access code is configured on the server)
 * Reply:  { worksheet: {...}, cached?: true }
 *
 * This file only orchestrates one request: who is asking, is the PDF acceptable, may this
 * conversion be paid for, then convert. The details live in lib/.
 */
const fs = require('fs');
const path = require('path');

const { LIMITS, readConfig } = require('../lib/config');
const { findPdfProblem } = require('../lib/pdf');
const { convertPdf, ConversionError } = require('../lib/claude');
const { normalize } = require('../lib/normalize');
const { hashClient, clientIp } = require('../lib/security');
const { sendJson, sendTooManyRequests, readJsonBody } = require('../lib/http');
const { storeFor } = require('../lib/store');
const { createLimiter, createDailyBudget } = require('../lib/limits');
const { authenticate } = require('../lib/access');
const { readCached, writeCached } = require('../lib/cache');

function readDemoWorksheet() {
  const file = path.join(__dirname, '..', 'public', 'demo.json');
  return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function respondWithDemo(res) {
  try {
    sendJson(res, 200, { worksheet: readDemoWorksheet(), mock: true });
  } catch (error) {
    sendJson(res, 500, { error: 'Mock data missing.' });
  }
}

/** The server cannot convert: no API key, or it would be open to everyone on the live site. */
const isMisconfigured = config => !config.apiKey || (config.production && !config.requireCode);

/** Recording usage must never lose a worksheet that has already been paid for. */
const bestEffort = promises => Promise.allSettled(promises);

/**
 * `deps` exists for tests: a store, the conversion function and the clock can be replaced.
 */
function createHandler(deps = {}) {
  const convert = deps.convert || convertPdf;
  const now = deps.now || Date.now;

  return async function handler(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });

    const config = readConfig();
    const store = deps.store || storeFor(config);
    const client = hashClient(clientIp(req), config.clientSecret);

    const teacher = await authenticate({ req, res, config, store, client });
    if (!teacher) return;

    const body = readJsonBody(req);
    const pdf = body && typeof body.pdf === 'string' ? body.pdf : '';
    const problem = findPdfProblem(pdf);
    if (problem) return sendJson(res, problem.status, { error: problem.message });

    const burst = await createLimiter(store, { name: 'convert', ...LIMITS.conversions }).hit(client);
    if (burst.limited) return sendTooManyRequests(res, burst.retryAfter, 'Too many conversions. Try again later.');

    if (config.mock) return respondWithDemo(res);
    if (isMisconfigured(config)) return sendJson(res, 500, { error: 'The server is not configured yet.' });

    // The same PDF as a recent conversion: reuse it. It costs nothing and does not use up the daily budget.
    if (body.fresh !== true && config.cacheTtlSeconds > 0) {
      const cached = await readCached(store, pdf, config.model);
      if (cached) return sendJson(res, 200, { worksheet: cached, cached: true });
    }

    // Is there money left for today? A shared code counts against the school total only.
    const budget = createDailyBudget(store, { now });
    const room = await budget.check(teacher.name, {
      perTeacher: teacher.shared ? 0 : config.dailyLimitPerTeacher,
      total: config.dailyLimitTotal
    });
    if (!room.allowed) {
      const message = room.scope === 'teacher'
        ? 'You have reached your daily limit of conversions. Try again tomorrow.'
        : 'The school has reached its daily limit of conversions. Try again tomorrow.';
      return sendTooManyRequests(res, room.retryAfter, message);
    }

    try {
      const worksheet = await convert(pdf, config);
      await bestEffort([budget.spend(teacher.name), writeCached(store, pdf, config.model, worksheet, config.cacheTtlSeconds)]);
      sendJson(res, 200, { worksheet });
    } catch (error) {
      if (!(error instanceof ConversionError)) throw error;
      // "No exercises" and "too long" mean the AI did read the PDF, so they are paid for. A provider
      // that is down or busy (502, 503) did no work and costs nothing.
      if (error.status === 422) await bestEffort([budget.spend(teacher.name)]);
      sendJson(res, error.status, { error: error.publicMessage });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.normalize = normalize;
