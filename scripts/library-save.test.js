'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const merge = require('../meta-merge');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const plain = (o) => JSON.parse(JSON.stringify(o));
const turn = () => new Promise((resolve) => setImmediate(resolve));

function page(write) {
  const storage = new Map();
  const ctx = vm.createContext({
    library: { revision: 3, firstRunDone: true, pageTheme: 'night',
      shelves: [{ id: 's1', name: 'Drafts', bookIds: ['b1'] }] },
    window: { neo: { writeLibrary: write }, NeoCraft_MetaMerge: merge },
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) }
  });
  const from = app.indexOf('let libraryGeneration =');
  vm.runInContext(app.slice(from, app.indexOf('const $ =', from)), ctx);
  return ctx;
}

test('the renderer adopts merged shelves, deletions and revision, keeping its device look', async () => {
  const ctx = page(async (sent) => {
    const saved = plain(sent);
    saved.revision++;
    saved.pageTheme = 'day';
    saved.shelves[0].bookIds.push('b2');
    saved.shelves.push({ id: 's2', name: 'Remote', bookIds: [] });
    delete saved.authorName;
    return saved;
  });
  ctx.library.authorName = 'Old';
  const sameObject = ctx.library;
  const sameShelf = ctx.library.shelves[0];
  await ctx.writeLibrary();
  assert.equal(ctx.library, sameObject);
  assert.equal(ctx.library.revision, 4);
  assert.equal(ctx.library.pageTheme, 'night');
  assert.equal(Object.hasOwn(ctx.library, 'authorName'), false);
  assert.deepEqual(plain(ctx.library.shelves[0].bookIds), ['b1', 'b2']);
  assert.equal(ctx.library.shelves[1].id, 's2');
  assert.equal(ctx.library.shelves[0], sameShelf, 'existing shelf controls still edit the live shelf');
  assert.equal(vm.runInContext('libraryWritesPending', ctx), 0);
});

test('a current save preserves a newer local reorder while its reply waits', async () => {
  let finish;
  let sent;
  const ctx = page((data) => { sent = plain(data); return new Promise((resolve) => { finish = resolve; }); });
  ctx.library.shelves[0].bookIds.push('b2');
  const saved = ctx.writeLibrary();
  await turn();
  const generation = vm.runInContext('libraryGeneration', ctx);
  ctx.library.shelves[0].bookIds.reverse();
  finish({ ...sent, revision: 4 });
  await saved;
  assert.deepEqual(plain(ctx.library.shelves[0].bookIds), ['b2', 'b1']);
  assert.ok(vm.runInContext('libraryGeneration', ctx) > generation, 'a refresh spanning the reply is stale');
});

test('queued saves use the acknowledged base and keep edits made while a save waits', async () => {
  let finish;
  const sent = [];
  const ctx = page((data) => {
    sent.push(plain(data));
    if (sent.length === 1) return new Promise((resolve) => { finish = resolve; });
    return Promise.resolve({ ...plain(data), revision: data.revision + 1 });
  });
  const first = ctx.writeLibrary();
  await turn();
  ctx.library.shelves[0].name = 'New local name';
  const second = ctx.writeLibrary();
  assert.equal(sent.length, 1);
  const remote = plain(sent[0]);
  remote.revision = 4;
  remote.shelves[0].bookIds.push('b2');
  finish(remote);
  await Promise.all([first, second]);
  assert.equal(sent[1].revision, 4);
  assert.equal(sent[1].shelves[0].name, 'New local name');
  assert.deepEqual(sent[1].shelves[0].bookIds, ['b1', 'b2']);
  assert.equal(ctx.library.revision, 5);
});

test('a rejected save does not advance the base or block a retry', async () => {
  let failed = false;
  const ctx = page(async (data) => {
    if (!failed) { failed = true; throw new Error('disk full'); }
    return { ...plain(data), revision: 4 };
  });
  await assert.rejects(ctx.writeLibrary(), /disk full/);
  assert.equal(ctx.library.revision, 3);
  assert.equal(vm.runInContext('libraryWritesPending', ctx), 0);
  await ctx.writeLibrary();
  assert.equal(ctx.library.revision, 4);
});

test('library adoption leaves daily word accounting and scroll-only position timestamps valid', async () => {
  const ctx = page(async (data) => ({ ...plain(data), revision: 4, authorName: 'Remote' }));
  // These are the actual counting and flush rules, with drawing left out.
  const rules = app.indexOf('// ---- daily words rules:');
  vm.runInContext(app.slice(rules, app.indexOf('// ---- end of daily words rules ----', rules)), ctx);
  Object.assign(ctx, {
    book: { id: 'b1', chapterOrder: [], lastPosition: { chapterId: 'c1', pIdx: 2, off: 3, scroll: 0, at: 123, tab: 'manuscript' },
      dailyCounts: { d: { start: 100, end: 350 } } },
    shelfExport: false, currentTab: 'manuscript', currentChapterId: 'c1', tabPlaces: {},
    chapterHTML: {}, savedHTML: {}, chapterChain: {}, auxQueue: {}, savedMetaSig: 'same',
    captureCaret: () => ({ chId: 'c1', pIdx: 2, off: 3 }), $: () => ({ scrollTop: 100 }),
    metaSig: () => 'same', saveMeta: async () => {}, flushAux() {}, flushSidecars: () => [], flushStickiesSave: () => null
  });
  const from = app.indexOf('function flushAllSaves(');
  vm.runInContext(app.slice(from, app.indexOf('// B08:', from)), ctx);
  await ctx.writeLibrary();
  const days = vm.runInContext('mergeDayCounts(book.dailyCounts, { d: { start: 0, end: 300 } })', ctx);
  assert.deepEqual(plain(days.d), { start: 50, end: 350 }, 'larger remote daily tally wins');
  assert.deepEqual(plain(ctx.nextDayCount(days.d, 1350, 1350)), { start: 1050, end: 1350 }, 'disk words do not count as typing');
  await Promise.all(ctx.flushAllSaves('tick'));
  assert.equal(ctx.book.lastPosition.scroll, 100);
  assert.equal(ctx.book.lastPosition.at, 123, 'scrolling alone does not claim a newer caret position');
  assert.deepEqual(plain(ctx.book.dailyCounts.d), { start: 100, end: 350 });
});
