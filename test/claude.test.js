'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { convertPdf, ConversionError, buildRequest } = require('../lib/claude');

const SETTINGS = { apiUrl: 'https://example.invalid/v1/messages', apiKey: 'test-key', model: 'test-model' };
const WORKSHEET = { title: 'T', answerKeyFound: true, sections: [{ type: 'short', title: 'A', items: [{ prompt: 'Q?', answers: ['a'] }] }] };

/** Replaces fetch for the duration of one test. */
async function withFetch(fake, run) {
  const original = global.fetch;
  global.fetch = fake;
  const silenced = console.error;
  console.error = () => {};
  try { return await run(); } finally { global.fetch = original; console.error = silenced; }
}
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const toolReply = input => reply(200, { stop_reason: 'tool_use', content: [{ type: 'tool_use', input }] });

async function failure(fake) {
  return withFetch(fake, async () => {
    try { await convertPdf('JVBER', SETTINGS); } catch (error) { return error; }
    assert.fail('expected convertPdf to throw');
  });
}

test('returns a normalised worksheet from the tool call', async () => {
  const ws = await withFetch(toolReply(WORKSHEET), () => convertPdf('JVBER', SETTINGS));
  assert.equal(ws.sections[0].items[0].answers[0], 'a');
});

test('sends the key and the model in the request, and never forces a tool', async () => {
  let seen;
  await withFetch(async (url, init) => { seen = { url, init }; return toolReply(WORKSHEET)(); }, () => convertPdf('JVBER', SETTINGS));
  assert.equal(seen.url, SETTINGS.apiUrl);
  assert.equal(seen.init.headers['x-api-key'], 'test-key');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'test-model');
  assert.deepEqual(body.tool_choice, { type: 'auto' });
  assert.deepEqual(buildRequest('JVBER', 'm').tools.map(t => t.name), ['create_worksheet']);
});

test('maps provider overload to a friendly 503', async () => {
  const error = await failure(reply(429, { error: { message: 'secret provider detail' } }));
  assert.ok(error instanceof ConversionError);
  assert.equal(error.status, 503);
});

test('never leaks provider messages to users', async () => {
  const error = await failure(reply(500, { error: { message: 'secret provider detail' } }));
  assert.equal(error.status, 502);
  assert.doesNotMatch(error.publicMessage, /secret/);
});

test('reports a network failure as 502', async () => {
  const error = await failure(async () => { throw new Error('offline'); });
  assert.equal(error.status, 502);
});

test('asks the teacher to split PDFs that run out of tokens', async () => {
  const error = await failure(reply(200, { stop_reason: 'max_tokens', content: [] }));
  assert.equal(error.status, 422);
});

test('fails clearly when the AI does not call the tool', async () => {
  const error = await failure(reply(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello' }] }));
  assert.equal(error.status, 502);
});

test('fails clearly when no exercises were found', async () => {
  const error = await failure(toolReply({ title: 'T', sections: [] }));
  assert.equal(error.status, 422);
});

test('says so, in plain words, when the monthly spend limit has been reached', async () => {
  const custom = await failure(reply(400, { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.' } }));
  assert.equal(custom.status, 503);
  assert.match(custom.publicMessage, /budget/);
  assert.doesNotMatch(custom.publicMessage, /2026|UTC|specified/);   // the provider's own words stay in the log

  const cap = await failure(reply(429, { type: 'error', error: { type: 'rate_limit_error', error_code: 'enforced_spend_limit_reached', message: 'secret provider detail' } }));
  assert.equal(cap.status, 503);
  assert.match(cap.publicMessage, /budget/);
  assert.doesNotMatch(cap.publicMessage, /secret/);
});

test('an ordinary bad request is still a generic error, not a budget message', async () => {
  const error = await failure(reply(400, { error: { type: 'invalid_request_error', message: 'messages: text content blocks must be non-empty' } }));
  assert.equal(error.status, 502);
  assert.doesNotMatch(error.publicMessage, /budget/);
});
