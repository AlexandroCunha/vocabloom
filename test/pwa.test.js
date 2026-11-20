'use strict';
/** The installable app: manifest, icons and the service worker that makes it work offline. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { APP_FILES, PUBLIC } = require('../scripts/build');
const { resolvePublicFile } = require('../server');

const ORIGIN = 'https://school.example';
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const indexHtml = read('index.html');

test('the manifest describes an installable app that opens on the student\'s home page', () => {
  assert.equal(manifest.name, 'Vocabloom');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.start_url, '/#review');
  assert.equal(manifest.lang, 'en-GB');
  assert.equal(manifest.theme_color, indexHtml.match(/<meta name="theme-color" content="([^"]+)"/)[1]);
  assert.match(manifest.background_color, /^#[0-9A-Fa-f]{6}$/);
});

test('every icon exists, is a real PNG of the declared size, and the install sizes are all there', () => {
  manifest.icons.forEach(icon => {
    const bytes = fs.readFileSync(path.join(PUBLIC, icon.src));
    assert.deepEqual(Array.from(bytes.subarray(0, 8)), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], icon.src + ' is a PNG');
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
    assert.equal(icon.sizes, bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20), icon.src + ' size');
    assert.equal(icon.type, 'image/png');
  });
  const has = (size, purpose) => manifest.icons.some(icon => icon.sizes === size && icon.purpose === purpose);
  assert.ok(has('192x192', 'any'));
  assert.ok(has('512x512', 'any'));
  assert.ok(has('512x512', 'maskable'));
  const apple = fs.readFileSync(path.join(PUBLIC, 'icons', 'apple-touch-icon.png'));
  assert.equal(apple.readUInt32BE(16), 180);
});

test('the page links the manifest and the iOS icon, and both files exist', () => {
  assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(indexHtml, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
  assert.ok(fs.existsSync(path.join(PUBLIC, 'icons', 'apple-touch-icon.png')));
});

test('everything the service worker keeps is a real file the server can serve', () => {
  APP_FILES.forEach(url => {
    const file = resolvePublicFile(url);
    assert.ok(file && fs.existsSync(file), url);
  });
  assert.ok(APP_FILES.includes('/'));
});

test('browsers are told to re-check the service worker every time', () => {
  const rule = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8')).headers.find(entry => entry.source === '/sw.js');
  assert.ok(rule, 'a header rule for /sw.js');
  assert.equal(rule.headers.find(header => header.key === 'Cache-Control').value, 'no-cache');
});

/* ---------- the service worker itself, run in a sandbox with fake browser parts ---------- */

function makeWorker() {
  const handlers = {};
  const calls = { skipWaiting: 0, claim: 0, network: [] };
  const stores = new Map();
  const network = { online: true, status: {}, bodies: {} };

  const keyOf = request => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;
  async function fakeFetch(request) {
    const url = keyOf(request);
    calls.network.push(url);
    if (!network.online) throw new TypeError('Failed to fetch');
    return new Response(network.bodies[url] || 'body of ' + url, { status: network.status[url] || 200 });
  }
  const caches = {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) { const kept = store.get(keyOf(request)); return kept ? kept.clone() : undefined; },
        async put(request, response) { store.delete(keyOf(request)); store.set(keyOf(request), response); },
        async delete(request) { return store.delete(keyOf(request)); },
        async keys() { return Array.from(store.keys()).map(url => ({ url })); },
        async addAll(urls) {
          for (const url of urls) {
            const response = await fakeFetch(url);
            if (!response.ok) throw new TypeError('Request failed: ' + url);
            store.set(keyOf(url), response);
          }
        }
      };
    },
    async keys() { return Array.from(stores.keys()); },
    async delete(name) { return stores.delete(name); }
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, handler) { handlers[type] = handler; },
    skipWaiting() { calls.skipWaiting += 1; },
    clients: { claim() { calls.claim += 1; return Promise.resolve(); } }
  };
  const code = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8') + '\n({ VERSION, APP_CACHE, WORKSHEET_CACHE, APP_FILES, MAX_WORKSHEETS })';
  const constants = vm.runInNewContext(code, { self, caches, fetch: fakeFetch, URL, Promise, Math });

  /** Sends a fetch event. Returns { handled, response }: whether the worker answered, and with what. */
  async function send(url, init) {
    init = init || {};
    let answer = null;
    const waits = [];
    const event = {
      request: { url: new URL(url, ORIGIN).href, method: init.method || 'GET', mode: init.mode || 'cors' },
      respondWith(promise) { answer = promise; },
      waitUntil(promise) { waits.push(promise); }
    };
    handlers.fetch(event);
    const response = answer ? await answer : null;
    await Promise.all(waits);
    return { handled: answer !== null, response };
  }

  async function lifecycle(type) {
    const waits = [];
    handlers[type]({ waitUntil: promise => waits.push(promise) });
    await Promise.all(waits);
  }

  return { constants, caches, network, calls, send, install: () => lifecycle('install'), activate: () => lifecycle('activate') };
}

const SHEET = '/api/share?id=AbCdEf123456';

test('installing keeps the whole app, and a broken file stops the install so the old version keeps working', async () => {
  const worker = makeWorker();
  await worker.install();
  const kept = Array.from(worker.caches.stores.get(worker.constants.APP_CACHE).keys());
  assert.deepEqual(kept.sort(), APP_FILES.map(url => ORIGIN + url).sort());
  assert.equal(worker.calls.skipWaiting, 1);

  const broken = makeWorker();
  broken.network.status[ORIGIN + '/icons/icon-192.png'] = 404;
  await assert.rejects(() => broken.install(), /Request failed/);
  assert.equal(broken.calls.skipWaiting, 0);
});

test('activating removes older app versions only, then takes over open pages', async () => {
  const worker = makeWorker();
  await worker.caches.open('vocabloom-app-oldversion');
  await worker.caches.open(worker.constants.WORKSHEET_CACHE);
  await worker.caches.open('something-else');
  await worker.install();
  await worker.activate();
  assert.deepEqual((await worker.caches.keys()).sort(), [worker.constants.APP_CACHE, 'something-else', worker.constants.WORKSHEET_CACHE].sort());
  assert.equal(worker.calls.claim, 1);
});

test('the app opens offline: the page, its icons and the privacy notice come from the kept copy', async () => {
  const worker = makeWorker();
  await worker.install();
  worker.network.online = false;
  const page = await worker.send('/', { mode: 'navigate' });
  assert.equal(page.handled, true);
  assert.equal(await page.response.text(), 'body of ' + ORIGIN + '/');
  assert.equal((await worker.send('/?utm_source=chat', { mode: 'navigate' })).handled, true, 'a query string does not break it');
  assert.equal(await (await worker.send('/index.html', { mode: 'navigate' })).response.text(), 'body of ' + ORIGIN + '/');
  assert.equal((await worker.send('/icons/icon-192.png')).handled, true);
  assert.equal((await worker.send('/privacy.html', { mode: 'navigate' })).handled, true);
  assert.equal((await worker.send('/manifest.webmanifest')).handled, true);
});

test('a worksheet opened through a short link is kept and opens again offline', async () => {
  const worker = makeWorker();
  worker.network.bodies[ORIGIN + SHEET] = '{"worksheet":{"title":"Unit 3"}}';
  const first = await worker.send(SHEET);
  assert.equal(first.handled, true);
  assert.equal(await first.response.text(), '{"worksheet":{"title":"Unit 3"}}');
  worker.network.online = false;
  const offline = await worker.send(SHEET);
  assert.equal(await offline.response.text(), '{"worksheet":{"title":"Unit 3"}}');
  assert.equal(worker.calls.network.filter(url => url.endsWith(SHEET)).length, 1, 'the second time needs no network');
});

test('an expired or failed worksheet is never kept, and an unopened one gives a plain network error offline', async () => {
  const worker = makeWorker();
  worker.network.status[ORIGIN + SHEET] = 404;
  const expired = await worker.send(SHEET);
  assert.equal(expired.response.status, 404);
  assert.equal(worker.caches.stores.get(worker.constants.WORKSHEET_CACHE).size, 0);
  worker.network.online = false;
  await assert.rejects(() => worker.send('/api/share?id=ZzZzZzZz1234'), /Failed to fetch/);
});

test('only the newest 40 worksheets are kept', async () => {
  const worker = makeWorker();
  for (let i = 0; i < worker.constants.MAX_WORKSHEETS + 5; i++) await worker.send('/api/share?id=sheet' + String(i).padStart(7, '0'));
  const urls = Array.from(worker.caches.stores.get(worker.constants.WORKSHEET_CACHE).keys());
  assert.equal(urls.length, worker.constants.MAX_WORKSHEETS);
  assert.ok(urls[0].endsWith('sheet0000005'), 'the oldest five were dropped');
});

test('uploads, conversions and everything else on the server never go through the worker', async () => {
  const worker = makeWorker();
  await worker.install();
  const untouched = [
    ['/api/convert', { method: 'POST' }],
    ['/api/convert', {}],
    ['/api/share', { method: 'POST' }],
    ['/api/share', {}],
    ['/api/share?id=short', {}],
    ['/api/share?id=AbCdEf12345!', {}],
    ['/api/other', {}],
    ['/demo.json', {}],
    ['/not-in-the-app', { mode: 'navigate' }],
    ['https://evil.example/', { mode: 'navigate' }],
    [SHEET, { method: 'POST' }]
  ];
  for (const [url, init] of untouched) {
    const result = await worker.send(url, init);
    assert.equal(result.handled, false, url + ' ' + JSON.stringify(init));
  }
});

test('the worker keeps nothing a student typed and talks to no other website', () => {
  const code = read('sw.js');
  assert.doesNotMatch(code, /localStorage|indexedDB|\.body|FormData|postMessage/);
  assert.doesNotMatch(code.replace(/\/\*[\s\S]*?\*\//, ''), /https?:\/\//, 'no other websites');
});
