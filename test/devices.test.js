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
const { SRC, STYLES, SCRIPTS } = require('../scripts/build');

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
  assert.ok(rules.some(rule => rule.context.some(query => /min-width:\s*900px/.test(query))), 'media queries are followed');
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

/* ---------- iPhone Duo (Apple's foldable iPhone) ---------- */

const has = (context, ...parts) => context.some(query => parts.every(part => part.test(query)));
const BOOK = [/min-width:\s*900px/, /max-height:\s*700px/, /orientation:\s*landscape/];     // the inner display open sideways: 951 x 585
const SHORT_LANDSCAPE = [/max-height:\s*700px/, /orientation:\s*landscape/];
const inBook = selector => rules.filter(rule => rule.selector === selector && has(rule.context, ...BOOK)).map(rule => rule.body).join('');

test('the iPhone Duo sheet is built in, and last, so that it can override the others', () => {
  assert.equal(STYLES[STYLES.length - 1], 'styles/05-iphone-duo.css');
});

test('open sideways, the inner display shows a worksheet as two pages with the gutter in the middle', () => {
  const pages = inBook('.pl[id^=sec-]');
  assert.match(pages, /display:\s*grid/);
  assert.match(pages, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, 'two equal pages');
  assert.match(pages, /column-gap:\s*var\(--gutter\)/);
  assert.match(pages, /padding-left:\s*max\(14px,\s*var\(--sal\),\s*var\(--sar\)\)/, 'both sides take the larger inset, so the gutter stays on the fold');
  assert.match(pages, /padding-right:\s*max\(14px,\s*var\(--sal\),\s*var\(--sar\)\)/);
  assert.match(pages, /align-items:\s*start/, 'a card keeps its own height when its neighbour grows');
  const wide = inBook('.pl[id^=sec-]>h3,.pl[id^=sec-]>.sub,.pl[id^=sec-]>details.bank');
  assert.match(wide, /grid-column:\s*1\s*\/\s*-1/, 'title, instructions and word bank use the full width');
  assert.match(inBook(':root'), /--col:\s*940px/);
});

test('a reading text takes the left page and stays in view, below the score bar, while the questions scroll on the right', () => {
  const passage = inBook('.pl[id^=sec-]:has(>.passage)>.passage');
  assert.match(passage, /grid-column:\s*1(?![\d/])/);
  assert.match(passage, /position:\s*sticky/);
  assert.match(passage, /top:\s*calc\(var\(--barh\)/, 'it sits under the score bar');
  assert.match(passage, /max-height:\s*calc\(100dvh/, 'a long text scrolls inside its page');
  assert.match(passage, /overflow:\s*auto/);
  assert.match(inBook('.pl[id^=sec-]:has(>.passage)>details.bank,.pl[id^=sec-]:has(>.passage)>.card'), /grid-column:\s*2/);
});

test('a short window held sideways puts the score and the progress bar on one line, and the reading text knows how tall that is', () => {
  const shortRules = selector => rules.filter(rule => rule.selector === selector && has(rule.context, ...SHORT_LANDSCAPE) && !has(rule.context, /min-width/));
  const bar = shortRules('.bar').map(rule => rule.body).join('');
  assert.match(bar, /display:\s*flex/);
  assert.match(bar, /min-height:\s*var\(--barh\)/);
  assert.ok(rules.some(rule => rule.selector === ':root' && /--barh:/.test(rule.body) && has(rule.context, ...SHORT_LANDSCAPE)));
  assert.match(shortRules('.prog').map(rule => rule.body).join(''), /flex:\s*1/);
});

test('a short window held upright (the outer display, a half-width window) gets a tighter header and tighter cards', () => {
  const upright = rules.filter(rule => has(rule.context, /max-width:\s*480px/, /max-height:\s*640px/, /orientation:\s*portrait/));
  ['.hero', '.top', '.card', '.bar'].forEach(selector => assert.ok(upright.some(rule => rule.selector === selector), selector));
});

test('the teacher\'s wide layouts start at 900px, so they also fit the inner display open sideways (951px)', () => {
  ['.up', '.it', '.share'].forEach(selector => {
    const wide = named(selector).filter(rule => /grid-template-columns/.test(rule.body));
    assert.ok(wide.length && wide.every(rule => has(rule.context, /min-width:\s*900px/)), selector);
  });
  assert.ok(uses('.teacher', '--col:960px'));
  rules.forEach(rule => rule.context.forEach(query => assert.doesNotMatch(query, /min-width:\s*1000px/, rule.selector)));
});

test('the preview in the share step scrolls inside its frame on a small screen, so Edit and New PDF stay within reach', () => {
  const small = named('.share-preview .phone').find(rule => rule.context.length === 0);
  assert.ok(small, 'a rule for every screen size');
  assert.match(small.body, /max-height:\s*60dvh/);
  assert.match(small.body, /overflow:\s*auto/);
});

test('the listen button is at least 44px on a touch screen', () => {
  const touch = rules.filter(rule => rule.selector === '.say' && has(rule.context, /pointer:\s*coarse/));
  assert.ok(touch.some(rule => /width:\s*44px/.test(rule.body) && /height:\s*44px/.test(rule.body) && /min-height:\s*44px/.test(rule.body)));
});

test('the fold is optional: viewport-segment values need their media query and always have a fallback', () => {
  const fold = rules.filter(rule => /env\(viewport-segment/.test(rule.body));
  assert.ok(fold.length >= 2, 'rules that use the fold: ' + fold.length);
  fold.forEach(rule => assert.ok(has(rule.context, /(horizontal|vertical)-viewport-segments:\s*2/), rule.selector + ' is outside a viewport-segments query'));
  const uses = STYLES.map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').match(/env\(viewport-segment-[a-z]+ \d+ \d+[^)]*\)/g) || [];
  assert.ok(uses.length >= 3, 'values found: ' + uses.length);
  uses.forEach(use => assert.match(use, /,\s*[^)\s][^)]*\)$/, use + ' has no fallback'));
  // the page works without them: the defaults sit in :root
  const root = named(':root').map(rule => rule.body).join('');
  ['--fold:0px', '--lower:0px', '--gutter:32px'].forEach(setting => assert.ok(root.includes(setting), setting));
});

test('with the two halves side by side, no heading, instruction or word bank runs across the crease', () => {
  const left = rules.filter(rule => has(rule.context, /horizontal-viewport-segments:\s*2/, ...BOOK) && /max-width:\s*calc\(50%/.test(rule.body));
  assert.ok(left.length >= 1);
  ['h3', '.sub', 'details.bank'].forEach(part => assert.ok(left.some(rule => rule.selector.includes('>' + part)), part));
});

test('half open like a laptop, scrolling, pop-ups and messages stay in the upper half', () => {
  const laptop = rules.filter(rule => has(rule.context, /vertical-viewport-segments:\s*2/));
  const body = selector => laptop.filter(rule => rule.selector === selector).map(rule => rule.body).join('');
  assert.match(body(':root'), /--lower:\s*calc\(100dvh - env\(viewport-segment-bottom 0 0,\s*100dvh\)\)/);
  assert.match(body('html'), /scroll-padding-bottom:\s*calc\(var\(--lower\)/);
  assert.match(body('.toast'), /var\(--lower\)/);
  assert.match(body('.ov'), /var\(--lower\)/);
  assert.match(body('.load'), /var\(--lower\)/);
});

test('people who ask for less motion do not get smooth scrolling either', () => {
  assert.ok(rules.some(rule => rule.selector === 'html' && /scroll-behavior:\s*auto/.test(rule.body) && has(rule.context, /prefers-reduced-motion:\s*reduce/)));
});

test('the player keeps the student\'s place when the window changes shape', () => {
  assert.ok(SCRIPTS.indexOf('js/player/keep-place.js') >= 0, 'the script is part of the build');
  assert.ok(SCRIPTS.indexOf('js/player/keep-place.js') < SCRIPTS.indexOf('js/player/player.js'), 'and comes before the player');
  const main = read('js/main.js');
  assert.match(main, /keepPlace\(\$\('#app'\), window\)/, 'the page that shows the real worksheet starts it');
  assert.match(main, /stopKeepingPlace\(\)/, 'and every other view stops it');
  assert.doesNotMatch(read('js/player/player.js'), /keepPlace\(/, 'the preview in the teacher\'s share step is drawn by the same player and must not keep a place');
});
