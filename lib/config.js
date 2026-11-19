'use strict';
/** Every setting the server reads, in one place. Nothing else touches process.env. */

const MB = 1024 * 1024;

const LIMITS = Object.freeze({
  // Vercel serverless request bodies are limited to 4.5 MB, and base64 adds a third.
  maxPdfBase64Chars: 4.2 * MB,
  // Wrong access codes: 5 tries per 15 minutes.
  wrongCodes: { limit: 5, windowMs: 15 * 60 * 1000 },
  // Conversions cost money: 20 per hour per address.
  conversions: { limit: 20, windowMs: 60 * 60 * 1000 }
});

/** Read at request time so tests (and a redeploy with new variables) see the current values. */
function readConfig(env = process.env) {
  return {
    accessCode: env.ACCESS_CODE || '',
    apiKey: env.ANTHROPIC_API_KEY || '',
    apiUrl: env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages',
    model: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
    mock: env.MOCK === '1'
  };
}

module.exports = { LIMITS, readConfig };
