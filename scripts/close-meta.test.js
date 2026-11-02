'use strict';

// #133: a close, quit or update restart (settleSaves) waits for book metadata
// writes that are already running: the title, the chapter order and the rest
// of book.json. writeBookMeta is the one door those writes go through.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// A book in memory with the real save code: chapters (persistChapter,
// scheduleChapterSave), book metadata (metaSig, saveMeta, writeBookMeta),
// notes on stickies and the sidecars, and flushAllSaves / settleSaves. The
// disk is the test's: every write is held until the test releases it, and
// the 800 ms / 600 ms save timers run only when the test says so.
const SLICES = [
  ['const bookMetaCache = new Map();', 'async function renderShelves('],
  ['const diskKnown = {};', '// Another device\'s version of a chapter'],
  ['function scheduleChapterSave(', '// book.json minus the parts'],
  ['function metaSig(', 'function flushAllSaves('],
  ['function writeSidecar(', 'function renderDarlings('],
  ['function scheduleStickiesSave(', '// Pair every mark'],
  ['function flushAllSaves(', '/*  SNAPSHOTS']
];
function bookOnHeldDisk(chapters) {
  const disk = { chapters: [], meta: [], json: [] };
  const logged = [];
  const held = [];
  // each write waits in `held` until release() (or fail()) lets it through
  const hold = (record) => new Promise((resolve, reject) => {
    held.push({ ok: () => { record(); resolve(true); }, fail: () => reject(new Error('disk full')) });
  });
  const timers = new Map();
  let seq = 0;
  const page = vm.createContext({
    window: { neo: {
      writeChapter: (bookId, chId, html) => hold(() => disk.chapters.push({ chId, html })),
      writeBookMeta: (bookId, meta) => { const copy = JSON.parse(JSON.stringify(meta)); return hold(() => disk.meta.push(copy)); },
      readBookMeta: async () => null,
      writeJSON: (bookId, name, data) => { const copy = JSON.parse(JSON.stringify(data)); return hold(() => disk.json.push({ name, data: copy })); },
      logError: (m) => logged.push(String(m))
    } },
    // lastPosition as a flush would leave it, so a flush has no place to save
    book: { id: 'b', title: 'Old Title', chapterOrder: Object.keys(chapters), lastPosition: { chapterId: null, scroll: 0, tab: 'manuscript' } },
    chapterHTML: { ...chapters },
    savedHTML: { ...chapters },
    savedMetaSig: '',
    writing: {},
    saveTimers: {}, stickies: [],
    tabPlaces: {},
    currentTab: 'manuscript',
    currentChapterId: null,
    shelfExport: false,
    console,
    setTimeout: (fn) => { timers.set(++seq, fn); return seq; },
    clearTimeout: (id) => { timers.delete(id); },
    $: () => ({ scrollTop: 0 }),
    captureCaret: () => null,
    maybeDailySnapshot() {},
    flushAux() {},
    sidecarBase: {}, auxQueue: {}, auxPending: {}, sidecarPending: {},
    NeoCraft_FlushBarrier: require('../flush-barrier.js')
  });
  for (const [from, to] of SLICES) {
    const at = app.indexOf(from);
    assert.ok(at >= 0, 'app.js still has ' + from);
    vm.runInContext(app.slice(at, app.indexOf(to, at)), page);
  }
  page.savedMetaSig = page.metaSig(page.book);
  const turn = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };
  return {
    page, disk, turn, logged,
    held: () => held.length,
    // lets the oldest held write reach the disk (or fail)
    async release() { held.shift().ok(); await turn(); },
    async fail() { held.shift().fail(); await turn(); },
    // lets every held write but the oldest through
    async releaseAllButFirst() { for (const w of held.splice(1)) w.ok(); await turn(); },
    async releaseAll() { while (held.length) { held.shift().ok(); await turn(); } },
    // fires the save timers that are due, as 800 ms passing would
    async runTimers() { const fns = [...timers.values()]; timers.clear(); fns.forEach((fn) => fn()); await turn(); return fns.length; }
  };
}
// settleSaves, with whether it has answered yet
// and what the disk held at the moment it answered
function settle(page, disk) {
  const s = { done: false, result: null, diskAtAnswer: null };
  s.promise = page.settleSaves().then((r) => {
    s.done = true; s.result = r; s.diskAtAnswer = JSON.parse(JSON.stringify(disk));
    return r;
  });
  return s;
}

const F = '<p>First line.</p>';

test('a metadata write started just before back-to-shelf is waited for', async () => {
  const t = bookOnHeldDisk({ x: F });
  t.page.book.title = 'New Title';
  t.page.flushAllSaves(); // as backToShelf does, before it sets book to null
  vm.runInContext('book = null', t.page);
  await t.turn();
  assert.equal(t.held(), 1, 'the title is on its way to the disk');
  const s = settle(t.page, t.disk);
  await t.turn();
  assert.equal(s.done, false, 'the answer waits for the title');
  await t.releaseAll();
  const r = await s.promise;
  assert.equal(r.ok, true);
  assert.equal(s.diskAtAnswer.meta.at(-1).title, 'New Title');
});

test('a metadata write that fails after back-to-shelf is reported, not called saved', async () => {
  const t = bookOnHeldDisk({ x: F });
  t.page.book.title = 'New Title';
  t.page.flushAllSaves();
  vm.runInContext('book = null', t.page);
  await t.turn();
  const s = settle(t.page, t.disk);
  await t.turn();
  assert.equal(s.done, false, 'the answer waits for the write');
  await t.fail();
  const r = await s.promise;
  assert.equal(r.ok, false);
  assert.ok(r.failed.length > 0, 'the failure is named');
});

test('a metadata save already running when the close asks is waited for, with the book open', async () => {
  const t = bookOnHeldDisk({ x: F });
  t.page.book.title = 'New Title';
  t.page.scheduleMetaSave();
  assert.equal(await t.runTimers(), 1, 'the 800 ms metadata save came due');
  assert.equal(t.held(), 1, 'and is on its way');
  const s = settle(t.page, t.disk);
  await t.turn();
  // any later write the close started may land; the first one is still out
  await t.releaseAllButFirst();
  assert.equal(s.done, false, 'the answer waits for the write that was already running');
  await t.releaseAll();
  const r = await s.promise;
  assert.equal(r.ok, true);
  assert.equal(s.diskAtAnswer.meta.length >= 1, true);
  assert.equal(s.diskAtAnswer.meta.at(-1).title, 'New Title');
});

test('a chapter order written from the shelf (writeBookMeta, no book open) is waited for', async () => {
  const t = bookOnHeldDisk({ x: F });
  vm.runInContext('book = null', t.page);
  t.page.writeBookMeta('b2', { id: 'b2', title: 'Other', chapterOrder: ['c2', 'c1'] });
  const s = settle(t.page, t.disk);
  await t.turn();
  assert.equal(s.done, false, 'the answer waits for the chapter order');
  await t.releaseAll();
  const r = await s.promise;
  assert.equal(r.ok, true);
  assert.deepEqual(s.diskAtAnswer.meta.at(-1).chapterOrder, ['c2', 'c1']);
});

test('a failing metadata write on a plain flush is logged and leaves no unhandled rejection', async () => {
  const t = bookOnHeldDisk({ x: F });
  const loose = [];
  const onLoose = (e) => loose.push(e);
  process.on('unhandledRejection', onLoose);
  try {
    t.page.book.title = 'New Title';
    t.page.flushAllSaves('tick'); // the 20 s tick drops what the flush returns
    await t.turn();
    await t.fail();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onLoose);
  }
  assert.deepEqual(loose.map(String), []);
  assert.ok(t.logged.length >= 1, 'the failed write is logged');
});
