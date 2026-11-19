'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, outOfDate, inlineScriptHashes } = require('../scripts/build');
const { CSP } = require('../lib/security');

test('generated files are up to date with src/ (run: npm run build)', () => {
  assert.deepEqual(outOfDate().map(entry => entry.file), []);
});

test('the built page keeps the data tag the standalone download depends on', () => {
  assert.equal(build().split('<script id="ws-data" type="application/json">null</script>').length, 2);
});

test('scripts are allowed by hash only: no unsafe-inline, no other websites', () => {
  const scriptPolicy = CSP.split('; ').find(part => part.startsWith('script-src '));
  assert.match(scriptPolicy, /^script-src 'sha256-[A-Za-z0-9+/=]+'$/);
  assert.doesNotMatch(scriptPolicy, /unsafe-inline|unsafe-eval|https?:/);
});

test('the page has exactly one runnable inline script, and its hash is in the policy', () => {
  const hashes = inlineScriptHashes(build());
  assert.equal(hashes.length, 1);
  assert.ok(CSP.includes("'sha256-" + hashes[0] + "'"));
});

test('the page uses no inline event handler attributes (they would be blocked)', () => {
  assert.doesNotMatch(build(), /\son(click|input|change|load|error|keydown)=["']/i);
});
