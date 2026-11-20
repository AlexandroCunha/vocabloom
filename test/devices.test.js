'use strict';
/**
 * Phones and computers. Static checks on the page head and the style sheets, so that the work for iPhone
 * (notch, home indicator, zoom on focus, hover that sticks) and for computers cannot be undone by accident.
 * How the screens really look is checked in a browser (see docs/ARCHITECTURE.md).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SRC, STYLES } = require('../scripts/build');

const read = file => fs.readFileSync(path.join(SRC, file), 'utf8');
const head = read('index.template.html');

/** Every ordinary rule as { context: [the @media / @supports queries around it], selector, body }. */
function parseRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  let i = 0;
  function block(context) {
    while (i < text.length) {
      const open = text.indexOf('{', i);
      const close = text.indexOf('}', i);
      if (open === -1 && close === -1) return;
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }   // end of the enclosing block
      const prelude = text.slice(i, open).trim();
      i = open + 1;
      if (/^@(media|supports)/.test(prelude)) {
        block(context.concat(prelude));
      } else if (prelude.startsWith('@')) {                                           // @keyframes and the like: skip
        let depth = 1;
        while (depth && i < text.length) { const char = text[i++]; if (char === '{') depth++; else if (char === '}') depth--; }
      } else {
        const end = text.indexOf('}', i);
        found.push({ context, selector: prelude, body: text.slice(i, end) });
        i = end + 1;
      }
    }
  }
  block([]);
  return found;
}

const rules = parseRules(STYLES.map(read).join('\n'));
const named = selector => rules.filter(rule => rule.selector === selector);
const uses = (selector, token) => named(selector).some(rule => rule.body.includes(token));

test('the page head asks for edge-to-edge drawing and keeps iOS from rewriting the content', () => {
  assert.match(head, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(head, /<meta name="format-detection" content="telephone=no">/, 'numbers in a worksheet must not become phone links');
  assert.match(head, /<meta name="color-scheme" content="light">/);
  assert.match(head, /<meta name="apple-mobile-web-app-status-bar-style"/);
});

test('the parser used by these tests understands the style sheets', () => {
  assert.ok(rules.length > 150, 'rules found: ' + rules.length);
  assert.ok(rules.some(rule => rule.context.some(query => /min-width:\s*1000px/.test(query))), 'media queries are followed');
});

test('hover styles exist only for devices that have a mouse (a tap must not leave a button stuck in its hover colour)', () => {
  const hovers = rules.filter(rule => /:hover/.test(rule.selector));
  assert.ok(hovers.length >= 8, 'hover rules found: ' + hovers.length);
  hovers.forEach(rule => {
    assert.ok(rule.context.some(query => /\(hover:\s*hover\)/.test(query)), rule.selector + ' is not inside @media (hover:hover)');
  });
});

test('the notch and the home indicator are respected', () => {
  const root = named(':root').map(rule => rule.body).join('');
  ['top', 'right', 'bottom', 'left'].forEach(side => assert.match(root, new RegExp('env\\(safe-area-inset-' + side)));
  ['.top', '.hero', '.bar'].forEach(selector => assert.ok(uses(selector, 'var(--sat)'), selector + ' clears the top inset'));
  ['.net', '.toast', '.wrap', '.foot', '.ov'].forEach(selector => assert.ok(uses(selector, 'var(--sab)'), selector + ' clears the bottom inset'));
  ['.top', '.hero', '.bar', '.wrap', '.pl', '.namebar', '.steps', '.net', '.ov'].forEach(selector => {
    assert.ok(uses(selector, 'var(--sal)') && uses(selector, 'var(--sar)'), selector + ' clears the side insets in landscape');
  });
});

test('the width of the page column is one setting, so the wide layouts can change it', () => {
  rules.forEach(rule => assert.doesNotMatch(rule.body, /max-width:\s*720px/, rule.selector));
  assert.ok(named(':root').some(rule => /--col:720px/.test(rule.body)));
  const wider = rules.filter(rule => rule.context.length && /--col:\s*\d+px/.test(rule.body));
  assert.ok(wider.length >= 2, 'wider columns for bigger screens: ' + wider.length);
});

test('a viewport-height unit always has a dynamic-height twin (iPhone toolbars change the height)', () => {
  rules.filter(rule => /(?<![a-z])vh\b/.test(rule.body)).forEach(rule => {
    assert.match(rule.body, /dvh/, rule.selector + ' uses vh without dvh');
  });
});

test('text fields are 16px or more on touch screens (Safari on iPhone zooms in on anything smaller)', () => {
  const fontSize = rule => Number((rule.body.match(/font-size:\s*(\d+(?:\.\d+)?)px/) || [0, 0])[1]);
  const isField = selector => /(^|[\s>])(input|textarea|select)\b/.test(selector);
  const fixedOnTouch = new Set();
  rules.filter(rule => rule.context.some(query => /\(pointer:\s*coarse\)/.test(query)) && fontSize(rule) >= 16)
    .forEach(rule => rule.selector.split(',').forEach(selector => fixedOnTouch.add(selector.trim())));
  let checked = 0;
  rules.filter(rule => fontSize(rule) > 0 && fontSize(rule) < 16).forEach(rule => {
    rule.selector.split(',').map(selector => selector.trim()).filter(isField).forEach(selector => {
      checked += 1;
      assert.ok(fixedOnTouch.has(selector), selector + ' is below 16px on touch screens');
    });
  });
  assert.ok(checked >= 2, 'small fields found: ' + checked);
});

test('everything that can be pressed is free of double-tap zoom, and overlays can scroll on a short screen', () => {
  assert.ok(rules.some(rule => /touch-action:\s*manipulation/.test(rule.body) && /(^|,)button(,|$)/.test(rule.selector)));
  assert.match(named('.ov').map(rule => rule.body).join(''), /overflow-y:\s*auto/);
});

test('the file input of the upload box can be reached with the keyboard', () => {
  const body = named('.drop input').map(rule => rule.body).join('');
  assert.doesNotMatch(body, /display:\s*none/);
  assert.ok(rules.some(rule => /\.drop:has\(input:focus-visible\)/.test(rule.selector)), 'a focus ring for the box');
});
