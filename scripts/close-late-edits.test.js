'use strict';

// #134: words typed while a close, quit or update restart waits (settleSaves)
// are either on the disk before settleSaves answers ok, or settleSaves
// answers not ok so the window stays. It never answers ok without them.

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

// gives the held disk writes as settleSaves goes on asking for more, until it answers
async function untilAnswered(t, s) {
  for (let i = 0; i < 20 && !s.done; i++) await t.releaseAll();
  return s.promise;
}

test('words typed during the wait reach the disk before an ok', async () => {
  const t = bookOnHeldDisk({ x: F });
  t.page.chapterHTML.x = F + '<p>Typed.</p>';
  const s = settle(t.page, t.disk);
  await t.turn();
  assert.equal(t.held(), 1, 'the first batch is on its way');
  // the editor stays editable while main waits: more words, and their 800 ms save
  t.page.chapterHTML.x += '<p>Late.</p>';
  t.page.scheduleChapterSave('x');
  // the first write lands before the 800 ms save comes due
  await t.release();
  const r = await untilAnswered(t, s);
  if (r.ok) {
    const last = s.diskAtAnswer.chapters.filter((w) => w.chId === 'x').at(-1);
    assert.equal(last && last.html, F + '<p>Typed.</p><p>Late.</p>', 'ok means the late words are on disk');
  } else {
    assert.ok(r.failed.length > 0, 'a close that is held names what is unsaved');
  }
});

test('a sticky note typed during the wait reaches the disk before an ok', async () => {
  const t = bookOnHeldDisk({ x: F });
  t.page.chapterHTML.x = F + '<p>Typed.</p>';
  const s = settle(t.page, t.disk);
  await t.turn();
  t.page.stickies.push({ id: 's1', text: 'late note' });
  t.page.scheduleStickiesSave();
  await t.release();
  const r = await untilAnswered(t, s);
  if (r.ok) {
    const last = s.diskAtAnswer.json.filter((w) => w.name === 'stickies').at(-1);
    assert.deepEqual(last && last.data, [{ id: 's1', text: 'late note' }], 'ok means the note is on disk');
  } else {
    assert.ok(r.failed.length > 0);
  }
});

test('a title changed during the wait reaches the disk before an ok', async () => {
  const t = bookOnHeldDisk({ x: F });
  t.page.chapterHTML.x = F + '<p>Typed.</p>';
  const s = settle(t.page, t.disk);
  await t.turn();
  t.page.book.title = 'Late Title';
  t.page.scheduleMetaSave();
  await t.release();
  const r = await untilAnswered(t, s);
  if (r.ok) {
    const last = s.diskAtAnswer.meta.at(-1);
    assert.equal(last && last.title, 'Late Title', 'ok means the title is on disk');
  } else {
    assert.ok(r.failed.length > 0);
  }
});

test('with nothing typed during the wait, one batch is enough and the answer is ok', async () => {
  const t = bookOnHeldDisk({ x: F });
  t.page.chapterHTML.x = F + '<p>Typed.</p>';
  const s = settle(t.page, t.disk);
  await t.turn();
  await t.release();
  const r = await untilAnswered(t, s);
  assert.equal(r.ok, true);
  assert.equal(t.disk.chapters.length, 1, 'the words were written once');
});
