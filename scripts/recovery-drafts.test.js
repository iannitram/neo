'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const SLICES = [
  ['const sidecarPending = {};', 'function renderDarlings('],
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
function pageOver(storage, { chapters, failWrites = false, failJSON = false }) {
  const listeners = { window: {}, document: {} };
  const timers = [];
  const writes = [];
  const jsonWrites = [];
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
        },
        writeJSON: async (bookId, name, data) => {
          if (failJSON) throw new Error('disk full');
          jsonWrites.push({ bookId, name, data: JSON.parse(JSON.stringify(data)) });
          return true;
        },
        logError() {}
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
  return { page, listeners, doc, timers, writes, jsonWrites };
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

  test('a killed app: the draft comes back on reopen and stays until the restored text is saved', async () => {
    const storage = memoryStorage();
    const first = pageOver(storage, { chapters: { c1: '<p>old</p>' }, failWrites: true });
    first.page.chapterHTML.c1 = '<p>old and words typed before the kill</p>';
    first.page.scheduleChapterSave('c1'); // the process dies; its timer never runs
    const second = pageOver(storage, { chapters: { c1: '<p>old</p>' } });
    const darlings = [];
    const got = await recover(second.page, darlings);
    assert.equal(got.restored, 1);
    assert.equal(second.page.chapterHTML.c1, '<p>old and words typed before the kill</p>');
    assert.equal(second.page.savedHTML.c1, '<p>old</p>'); // so the next flush writes it
    assert.equal(darlings.length, 0);
    // a crash here must still find the draft
    assert.equal(draftOf(storage).html, '<p>old and words typed before the kill</p>');
    await vm.runInContext('persistChapter("c1")', second.page);
    assert.equal(second.writes.length, 1);
    assert.equal(storage.getItem(key), null); // gone once the save is confirmed
  });

  test('a restored draft whose save never lands is still there', async () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ html: '<p>new</p>', base: '<p>old</p>', at: 1 }));
    const { page } = pageOver(storage, { chapters: { c1: '<p>old</p>' }, failWrites: true });
    await recover(page, []);
    vm.runInContext('persistChapter("c1")', page); // never answers
    await Promise.resolve();
    assert.equal(draftOf(storage).html, '<p>new</p>');
  });

  test('a file changed on another device since stays; the draft goes to Darlings and is written', async () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ html: '<p>local draft</p>', base: '<p>old</p>', at: 1 }));
    const { page, jsonWrites } = pageOver(storage, { chapters: { c1: '<p>other device</p>' } });
    const darlings = [];
    const got = await recover(page, darlings);
    assert.equal(got.darlings, 1);
    assert.equal(got.restored, 0);
    assert.equal(page.chapterHTML.c1, '<p>other device</p>');
    assert.equal(darlings.length, 1);
    assert.equal(darlings[0].html, '<p>local draft</p>');
    assert.equal(jsonWrites.length, 1);
    assert.equal(jsonWrites[0].name, 'darlings');
    assert.equal(jsonWrites[0].data[0].html, '<p>local draft</p>');
    assert.equal(storage.getItem(key), null);
  });

  test('if darlings.json cannot be written, the draft stays', async () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ html: '<p>local draft</p>', base: '<p>old</p>', at: 1 }));
    const { page } = pageOver(storage, { chapters: { c1: '<p>other device</p>' }, failJSON: true });
    const got = await recover(page, []);
    assert.equal(got.darlings, 0);
    assert.equal(draftOf(storage).html, '<p>local draft</p>');
  });

  test('a recovered Darling keeps at most 2000 characters of text', async () => {
    const storage = memoryStorage();
    const long = 'a'.repeat(5000);
    storage.setItem(key, JSON.stringify({ html: '<p>' + long + '</p>', base: '<p>old</p>', at: 1 }));
    const { page } = pageOver(storage, { chapters: { c1: '<p>other device</p>' } });
    const darlings = [];
    await recover(page, darlings);
    assert.equal(darlings[0].text.length, 2000);
    assert.equal(darlings[0].html, '<p>' + long + '</p>');
  });

  test('a draft that cannot be stored clears the older one', () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ html: '<p>stale</p>', base: '<p>old</p>', at: 1 }));
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const { page } = pageOver(storage, { chapters: { c1: '<p>old</p>' } });
    page.chapterHTML.c1 = '<p>newer</p>';
    page.scheduleChapterSave('c1');
    assert.equal(storage.getItem(key), null);
  });

  test('a draft equal to the file is dropped; openBook calls the recovery', async () => {
    const storage = memoryStorage();
    storage.setItem(key, JSON.stringify({ html: '<p>same</p>', base: '<p>same</p>', at: 1 }));
    const { page } = pageOver(storage, { chapters: { c1: '<p>same</p>' } });
    const got = await recover(page, []);
    assert.equal(got.restored + got.darlings, 0);
    assert.equal(storage.getItem(key), null);
    assert.match(app, /await recoverDrafts\(bookId, meta\.chapterOrder, chapterHTML, darlings\)/);
  });
});
