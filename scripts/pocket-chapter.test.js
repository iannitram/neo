'use strict';

// Loads pocket/www/pocket-bridge.js in a vm with a stub window, document and
// an in-memory Capacitor Filesystem, then drives window.neo.writeChapter the
// way the page does. The Filesystem errors use Capacitor's wording.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(root, 'pocket', 'www', 'pocket-bridge.js'), 'utf8');

function element() {
  return {
    style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, appendChild() {}, addEventListener() {}, removeChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [], matches: () => false, closest: () => null,
    textContent: '', innerHTML: ''
  };
}

// files: relative path -> text. readErrors: relative path -> error message to
// reject a read with (a permission, a lock, an I/O failure).
function loadBridge({ files = {}, readErrors = {} }) {
  const store = new Map(Object.entries(files));
  const key = (opts) => String(opts.path).replace(/^NEO Library\//, '');
  const fakeFs = {
    async readFile(opts) {
      const k = key(opts);
      if (readErrors[k]) throw new Error(readErrors[k]);
      if (!store.has(k)) throw new Error('File does not exist.');
      return { data: store.get(k) };
    },
    async writeFile(opts) { store.set(key(opts), opts.data); },
    async rename(opts) { store.set(key({ path: opts.to }), store.get(key({ path: opts.from }))); store.delete(key({ path: opts.from })); },
    async deleteFile(opts) { store.delete(key(opts)); },
    async mkdir() {},
    async readdir() { return { files: [] }; },
    async stat() { throw new Error('File does not exist.'); }
  };
  const doc = element();
  doc.body = element();
  doc.documentElement = element();
  Object.assign(doc, {
    addEventListener() {}, createElement: element, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [], activeElement: null
  });
  const win = {
    Capacitor: { getPlatform: () => 'android', Plugins: { Filesystem: fakeFs } },
    addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {}
  };
  const context = vm.createContext({ window: win, document: doc, console, setTimeout, clearTimeout, Promise, Error, String, JSON });
  vm.runInContext(bridgeSource, context, { filename: path.join(root, 'pocket', 'www', 'pocket-bridge.js') });
  return { neo: win.neo, store };
}

describe('pocket chapter writes', { concurrency: 1 }, () => {
  const chapter = 'book-x/chapters/c1.html';

  test('a chapter the phone cannot read is refused, not taken as empty', async () => {
    for (const message of ['Permission denied.', 'The file is being used by another process.', 'I/O error']) {
      const { neo, store } = loadBridge({
        files: { [chapter]: '<p>real words</p>' },
        readErrors: { [chapter]: message }
      });
      await assert.rejects(
        neo.writeChapter('book-x', 'c1', '<p>replaces</p>', '<p>real words</p>'),
        (err) => /Could not read chapter c1/.test(err.message) && err.message.includes(message),
        message
      );
      assert.equal(store.get(chapter), '<p>real words</p>', message);
      assert.equal(store.has(chapter + '.tmp'), false, message);
    }
  });

  test('a chapter file that does not exist is still a new chapter', async () => {
    const { neo, store } = loadBridge({ files: {} });
    assert.equal(await neo.writeChapter('book-x', 'c1', '<p>first</p>', '<p>old</p>'), true);
    assert.equal(store.get(chapter), '<p>first</p>');
  });

  test('a readable chapter that diverged still returns the conflict', async () => {
    const { neo, store } = loadBridge({ files: { [chapter]: '<p>other device</p>' } });
    // JSON, because the bridge's objects come from the vm realm
    assert.equal(
      JSON.stringify(await neo.writeChapter('book-x', 'c1', '<p>mine</p>', '<p>old</p>')),
      JSON.stringify({ conflict: '<p>other device</p>' })
    );
    assert.equal(store.get(chapter), '<p>other device</p>');
  });
test('an interrupted save leaves a .tmp: writeChapter compares with it, and keeps it as a twin', async () => {
    // a save the system cut short leaves only the .tmp, which readChapter shows
    const { neo, store } = loadBridge({ files: { [chapter + '.tmp']: '<p>saved only in tmp</p>' } });
    assert.equal(
      JSON.stringify(await neo.writeChapter('book-x', 'c1', '<p>mine</p>', '<p>old</p>')),
      JSON.stringify({ conflict: '<p>saved only in tmp</p>' })
    );
    assert.equal(store.has(chapter), false);
    // the window last read that text: the write goes through
    assert.equal(await neo.writeChapter('book-x', 'c1', '<p>mine</p>', '<p>saved only in tmp</p>'), true);
    assert.equal(store.get(chapter), '<p>mine</p>');
  });

  test('readChapter reads the .tmp only when the chapter is missing, and throws on other read errors', async () => {
    const tmpOnly = loadBridge({ files: { [chapter + '.tmp']: '<p>tmp</p>' } });
    assert.equal(await tmpOnly.neo.readChapter('book-x', 'c1'), '<p>tmp</p>');
    const none = loadBridge({ files: {} });
    assert.equal(await none.neo.readChapter('book-x', 'c1'), '');
    const denied = loadBridge({ files: {}, readErrors: { [chapter]: 'Permission denied.' } });
    await assert.rejects(denied.neo.readChapter('book-x', 'c1'), /Could not read chapter c1.*Permission denied/);
  });
});
