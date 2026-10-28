'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'pocket', 'www', 'pocket-bridge.js'), 'utf8');

const SLICES = [
  ["const diskKnown = {};", "// Another device's version of a chapter"],
  ['function scheduleChapterSave(', '// book.json minus the parts'],
  ['function metaSig(', 'function scheduleMetaSave('],
  ['function flushAllSaves(', '/*  SNAPSHOTS'],
  ["document.addEventListener('visibilitychange'", 'async function backToShelf']
];

function memoryStorage(items = {}) {
  const m = new Map(Object.entries(items));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }
  };
}

// One run of the page over a device's localStorage. failWrites makes the
// disk never answer (an app killed before the write finishes); timers are held
// by the test and never run on their own.
function pageOver(storage, { chapters, failWrites = false }) {
  const listeners = { window: {}, document: {} };
  const timers = [];
  const writes = [];
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, f) => { listeners.document[type] = f; },
    createElement: () => ({ textContent: '', set innerHTML(v) { this.textContent = v.replace(/<[^>]*>/g, ''); }, get innerHTML() { return this.textContent; } })
  };
  const page = vm.createContext({
    window: {
      localStorage: storage,
      addEventListener: (type, f) => { listeners.window[type] = f; },
      neo: {
        writeChapter: async (bookId, chId, html) => {
          if (failWrites) return new Promise(() => {}); // the process dies mid-write
          writes.push({ chId, html });
          return true;
        }
      }
    },
    document: doc,
    book: { id: 'b', chapterOrder: Object.keys(chapters) },
    chapterHTML: { ...chapters },
    savedHTML: { ...chapters },
    savedMetaSig: '', writing: {}, saveTimers: {}, tabPlaces: {},
    currentTab: 'manuscript', currentChapterId: null, shelfExport: false,
    console,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout() {}, setInterval() {}, refreshFromDisk() {},
    $: () => ({ scrollTop: 0 }),
    t: (s) => s,
    captureCaret: () => null, saveMeta: async () => {},
    maybeDailySnapshot() {}, flushAux() {}, flushStickiesSave() {}, flushSidecars() {}
  });
  for (const [from, to] of SLICES) {
    const at = app.indexOf(from);
    vm.runInContext(app.slice(at, app.indexOf(to, at)), page);
  }
  page.savedMetaSig = page.metaSig(page.book);
  vm.runInContext('for (const c of Object.keys(chapterHTML)) knowDisk("b", c, chapterHTML[c]);', page);
  return { page, listeners, doc, timers, writes };
}
const key = 'neo-draft:b/c1';
const draftOf = (storage) => JSON.parse(storage.getItem(key));
const settled = (page) => vm.runInContext('Promise.all(Object.values(chapterChain))', page);
const recover = (page, darlings) => {
  page.darlingsIn = darlings;
  return vm.runInContext('recoverDrafts("b", ["c1"], chapterHTML, darlingsIn)', page);
};

describe('recovery drafts', () => {
  test('an edit keeps a draft before the 800 ms save runs', () => {
    const storage = memoryStorage();
    const { page, timers } = pageOver(storage, { chapters: { c1: '<p>old</p>' } });
    page.chapterHTML.c1 = '<p>old and new</p>';
    page.scheduleChapterSave('c1');
    assert.equal(draftOf(storage).html, '<p>old and new</p>');
    assert.equal(draftOf(storage).base, '<p>old</p>');
    assert.equal(timers.length, 1); // the disk write has not run
  });

  test('a confirmed save clears the draft; a failed one keeps it', async () => {
    const storage = memoryStorage();
    const ok = pageOver(storage, { chapters: { c1: '<p>old</p>' } });
    ok.page.chapterHTML.c1 = '<p>new</p>';
    ok.page.scheduleChapterSave('c1');
    ok.timers[0].f();
    await settled(ok.page);
    assert.equal(ok.writes.length, 1);
    assert.equal(storage.getItem(key), null);

    const bad = pageOver(storage, { chapters: { c1: '<p>old</p>' }, failWrites: true });
    bad.page.chapterHTML.c1 = '<p>newer</p>';
    bad.page.scheduleChapterSave('c1');
    bad.timers[0].f();
    await Promise.resolve();
    assert.equal(bad.writes.length, 0);
    assert.equal(draftOf(storage).html, '<p>newer</p>');
  });

  test('typing during a write leaves the newer draft', async () => {
    const storage = memoryStorage();
    const { page, timers } = pageOver(storage, { chapters: { c1: '<p>old</p>' } });
    page.chapterHTML.c1 = '<p>one</p>';
    page.scheduleChapterSave('c1');
    timers[0].f();
    page.chapterHTML.c1 = '<p>one two</p>';
    page.scheduleChapterSave('c1');
    await settled(page);
    assert.equal(draftOf(storage).html, '<p>one two</p>');
  });

  test('backgrounding writes drafts at once (visibilitychange, pagehide, pause)', () => {
    for (const how of ['visibility', 'pagehide', 'pause']) {
      const storage = memoryStorage();
      const { page, listeners, doc } = pageOver(storage, { chapters: { c1: '<p>old</p>', c2: '<p>two</p>' }, failWrites: true });
      page.chapterHTML.c1 = '<p>typed just now</p>'; // the event alone must keep it
      if (how === 'visibility') { doc.visibilityState = 'hidden'; listeners.document.visibilitychange(); }
      else if (how === 'pagehide') listeners.window.pagehide();
      else listeners.document.pause();
      assert.equal(draftOf(storage).html, '<p>typed just now</p>', how);
      assert.equal(storage.getItem('neo-draft:b/c2'), null, how); // an unchanged chapter gets none
    }
  });

  test('a killed app: the draft comes back on reopen when newer than the file', () => {
    const storage = memoryStorage();
    const first = pageOver(storage, { chapters: { c1: '<p>old</p>' }, failWrites: true });
    first.page.chapterHTML.c1 = '<p>old and words typed before the kill</p>';
    first.page.scheduleChapterSave('c1'); // the process dies; its timer never runs
    const second = pageOver(storage, { chapters: { c1: '<p>old</p>' } });
    const darlings = [];
    assert.equal(recover(second.page, darlings), 1);
    assert.equal(second.page.chapterHTML.c1, '<p>old and words typed before the kill</p>');
    assert.equal(second.page.savedHTML.c1, '<p>old</p>'); // so the next flush writes it
    assert.equal(darlings.length, 0);
    assert.equal(storage.getItem(key), null);
  });

  test('a file changed on another device since stays; the draft goes to Darlings', () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ html: '<p>local draft</p>', base: '<p>old</p>', at: 1 }));
    const { page } = pageOver(storage, { chapters: { c1: '<p>other device</p>' } });
    const darlings = [];
    recover(page, darlings);
    assert.equal(page.chapterHTML.c1, '<p>other device</p>');
    assert.equal(darlings.length, 1);
    assert.equal(darlings[0].html, '<p>local draft</p>');
    assert.equal(storage.getItem(key), null);
  });

  test('a draft equal to the file is dropped; openBook calls the recovery', () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ html: '<p>same</p>', base: '<p>same</p>', at: 1 }));
    const { page } = pageOver(storage, { chapters: { c1: '<p>same</p>' } });
    assert.equal(recover(page, []), 0);
    assert.equal(storage.getItem(key), null);
    assert.match(app, /recoverDrafts\(bookId, meta\.chapterOrder, chapterHTML, darlings\)/);
  });
});

describe('pocket pause', () => {
  test('the bridge raises pause on the document when the App plugin says so', () => {
    const handlers = {};
    const events = [];
    const el = () => ({
      style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
      setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], matches: () => false
    });
    const doc = Object.assign(el(), { body: el(), documentElement: el(), createElement: el, getElementById: () => null, dispatchEvent: (e) => events.push(e.type) });
    const win = {
      Capacitor: { getPlatform: () => 'android', Plugins: { Filesystem: {}, App: { addListener: (n, f) => { handlers[n] = f; } } } },
      addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
      Event: class { constructor(type) { this.type = type; } }
    };
    win.window = win;
    const ctx = vm.createContext({ window: win, document: doc, console, setTimeout, clearTimeout, Promise, Error, String, JSON });
    vm.runInContext(bridgeSource, ctx);
    handlers.pause();
    handlers.appStateChange({ isActive: true });
    handlers.appStateChange({ isActive: false });
    assert.deepEqual(events, ['pause', 'pause']);
  });
});
