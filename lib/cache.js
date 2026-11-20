'use strict';
/**
 * Remembers converted worksheets by the hash of the PDF, so the same PDF is never paid for twice.
 * Only the finished worksheet is kept (never the PDF), and it expires after CACHE_TTL_DAYS.
 */
const crypto = require('crypto');
const { SYSTEM } = require('./prompt');
const { TOOL } = require('./worksheet-schema');
const { normalize } = require('./normalize');

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

/** Changes whenever the prompt, the tool schema or the model changes, so an old result is never reused. */
const recipeId = model => sha256(JSON.stringify([SYSTEM, TOOL, model])).slice(0, 12);

const cacheKey = (pdf, model) => 'vb:cache:' + recipeId(model) + ':' + sha256(pdf);

/** The worksheet converted earlier from this exact PDF, or null. */
async function readCached(store, pdf, model) {
  const saved = await store.getJson(cacheKey(pdf, model));
  return saved ? normalize(saved) : null;
}

async function writeCached(store, pdf, model, worksheet, ttlSeconds) {
  if (ttlSeconds > 0) await store.putJson(cacheKey(pdf, model), worksheet, ttlSeconds);
}

module.exports = { readCached, writeCached, cacheKey };
