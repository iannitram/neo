'use strict';

// Exercise both real hosts: two devices read N, one writes N+1, and the
// other's stale save must merge against what it originally read.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const merge = require('../meta-merge');
const root = path.join(__dirname, '..');
const readSource = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const mainSource = readSource('main.js');
const bridgeSource = readSource('pocket/www/pocket-bridge.js');
const localRequire = createRequire(path.join(root, 'main.js'));
const plain = (o) => JSON.parse(JSON.stringify(o));
const seed = () => ({ revision: 3, authorName: 'A', penNames: [], firstRunDone: true,
  authors: [{ id: 'a1', name: 'A' }], pageTheme: 'night',
  shelves: [{ id: 's1', name: 'Drafts', bookIds: ['book-one'] }] });

function desktop(t, initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-library-revisions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'library.json');
  fs.writeFileSync(file, JSON.stringify(initial));
  const handlers = new Map();
  const electron = {
    app: { commandLine: { appendSwitch() {} }, getPath: () => dir, getLocale: () => 'en',
      requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) }, screen: {}
  };
  const ctx = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root, process: { platform: process.platform, on() {} }, console, dir
  });
  vm.runInContext(mainSource, ctx, { filename: path.join(root, 'main.js') });
  vm.runInContext('LIBRARY_DIR = dir; LIBRARY_FILE = require("path").join(dir, "library.json");', ctx);
  const call = (name, ...args) => plain(handlers.get(name)(null, ...plain(args)));
  // A library save must leave the book's bookkeeping alone, byte for byte.
  const book = call('book:create', { title: 'One' });
  book.dailyCounts = { '2026-10-28': { start: 100, end: 350 } };
  book.lastPosition = { chapterId: 'c1', pIdx: 2, off: 4, at: 123, scroll: 20 };
  call('book:writeMeta', book.id, book);
  const bookFile = path.join(dir, book.id, 'book.json');
  const before = fs.readFileSync(bookFile, 'utf8');
  return {
    read: () => call('library:read'), write: (lib) => call('library:write', lib),
    disk: () => JSON.parse(fs.readFileSync(file, 'utf8')),
    checkBook: () => assert.equal(fs.readFileSync(bookFile, 'utf8'), before)
  };
}

function pocket(_t, initial) {
  const store = new Map([['NEO Library/library.json', JSON.stringify(initial)]]);
  const bookPath = 'NEO Library/book-one/book.json';
  const before = JSON.stringify({ dailyCounts: { d: { start: 100, end: 350 } },
    lastPosition: { chapterId: 'c1', pIdx: 2, off: 4, at: 123, scroll: 20 } });
  store.set(bookPath, before);
  const Filesystem = {
    async readFile({ path: file }) {
      if (!store.has(file)) throw new Error('File does not exist.');
      return { data: store.get(file) };
    },
    async writeFile({ path: file, data }) { store.set(file, data); },
    async rename({ from, to }) { store.set(to, store.get(from)); store.delete(from); },
    async mkdir() {}, async readdir() { return { files: ['library.json'] }; }
  };
  const element = () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, appendChild() {} });
  const document = { ...element(), body: element(), documentElement: element(),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: element };
  const window = { Capacitor: { getPlatform: () => 'android', Plugins: { Filesystem } },
    NeoCraft_MetaMerge: merge, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  vm.runInNewContext(bridgeSource, { window, document, console, setTimeout, clearTimeout }, { filename: 'pocket-bridge.js' });
  return {
    read: async () => plain(await window.neo.readLibrary()),
    write: async (lib) => plain(await window.neo.writeLibrary(plain(lib))),
    disk: () => JSON.parse(store.get('NEO Library/library.json')),
    checkBook: () => assert.equal(store.get(bookPath), before)
  };
}

for (const [name, host] of [['desktop', desktop], ['Pocket', pocket]]) {
  test(`${name}: a stale save keeps remote shelves, membership and author changes`, async (t) => {
    const h = host(t, seed());
    const a = await h.read();
    const b = await h.read();
    a.shelves.push({ id: 's2', name: 'New shelf', bookIds: ['book-three'] });
    a.shelves[0].bookIds.push('book-two');
    a.authorName = 'B';
    a.authors[0].name = 'B';
    a.penNames.push('P');
    assert.equal((await h.write(a)).revision, 4);
    // A refresh may read N+1 while the page still has N. Keep both bases.
    await h.read();
    b.shelves[0].name = 'Renamed here';
    const before = plain(b);
    const saved = await h.write(b);
    assert.deepEqual(b, before, 'the host does not mutate the submitted value');
    assert.equal(saved.revision, 5);
    assert.equal(saved.authorName, 'B');
    assert.equal(saved.authors[0].name, 'B');
    assert.deepEqual(saved.penNames, ['P']);
    assert.deepEqual(saved.shelves, [
      { id: 's1', name: 'Renamed here', bookIds: ['book-one', 'book-two'] },
      { id: 's2', name: 'New shelf', bookIds: ['book-three'] }
    ]);
    assert.deepEqual(h.disk(), saved);
    const retry = await h.write(b);
    assert.deepEqual({ ...retry, revision: 5 }, saved, 'a retry adds no duplicate books or shelves');
    assert.equal(retry.revision, 6);
    // Adopting the result makes a deliberate later removal stick.
    retry.shelves.pop();
    retry.shelves[0].bookIds.pop();
    delete retry.authorName;
    const removed = await h.write(retry);
    assert.equal(removed.revision, 7);
    assert.equal(removed.shelves.length, 1);
    assert.deepEqual(removed.shelves[0].bookIds, ['book-one']);
    assert.equal(Object.hasOwn(removed, 'authorName'), false);
    h.checkBook();
  });

  test(`${name}: a legacy library loads revision zero and a current save writes one`, async (t) => {
    const initial = seed();
    delete initial.revision;
    const h = host(t, initial);
    const lib = await h.read();
    assert.equal(lib.revision, 0);
    assert.equal(h.disk().revision, undefined, 'reading alone does not rewrite the library');
    lib.shelves = [];
    const saved = await h.write(lib);
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.shelves, []);
    assert.deepEqual(h.disk(), saved);
  });

  test(`${name}: stale removals stick while a remotely changed shelf remains recoverable`, async (t) => {
    const initial = seed();
    initial.shelves[0].bookIds.push('book-remove');
    initial.shelves.push({ id: 's2', name: 'Empty', bookIds: [] });
    const h = host(t, initial);
    const local = await h.read();
    const remote = await h.read();
    remote.shelves[0].bookIds.push('book-two');
    remote.shelves[1].bookIds.push('book-three');
    await h.write(remote);
    local.shelves[0].bookIds.pop();
    local.shelves.pop();
    const saved = await h.write(local);
    assert.deepEqual(saved.shelves[0].bookIds, ['book-one', 'book-two']);
    assert.deepEqual(saved.shelves[1].bookIds, ['book-three'], 'deleting a shelf cannot hide a remotely added book');
    h.checkBook();
  });
}

test('revision merge without a retained base keeps remote additions', () => {
  const local = seed();
  const disk = seed();
  disk.revision++;
  disk.shelves[0].bookIds.push('book-two');
  disk.shelves.push({ id: 's2', name: 'Remote', bookIds: [] });
  const saved = merge.reviseLibrary(null, local, disk);
  assert.equal(saved.revision, 5);
  assert.deepEqual(saved.shelves, disk.shelves);
});
