'use strict';

// book.json carries a revision. A save from a page that loaded revision N
// merges with the disk when the disk has moved on, and every save writes one
// revision more. Loads main.js the way filesystem.test.js does: Electron is
// replaced, the real disk functions run, and LIBRARY_DIR is a temporary folder.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function loadMain() {
  const handlers = new Map();
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      getPath: () => os.tmpdir(),
      getLocale: () => 'en',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      on() {}
    },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    libraryRoot: os.tmpdir()
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  return {
    context,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    pointAt(dir) {
      context.libraryRoot = dir;
      vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    }
  };
}

const main = loadMain();
const clone = (o) => JSON.parse(JSON.stringify(o));

function tempLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-book-revisions-'));
  main.pointAt(dir);
  return dir;
}

// A book folder with book.json as it would be on disk. revision undefined
// means a legacy file that has no revision field at all.
function seedBook(dir, fields) {
  const id = 'book-revisions-test';
  const folder = path.join(dir, id);
  fs.mkdirSync(path.join(folder, 'chapters'), { recursive: true });
  const meta = { id, title: 'Old', author: 'Ada', chapterOrder: ['c1'], ...fields };
  if (meta.revision === undefined) delete meta.revision;
  fs.writeFileSync(path.join(folder, 'book.json'), JSON.stringify(meta, null, 2));
  return id;
}

const onDisk = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, id, 'book.json'), 'utf8'));

describe('book.json revisions', { concurrency: 1 }, () => {
  test('a. two writers at N: A adds c2, then B renames from stale N; both survive at N+2', () => {
    const dir = tempLibrary();
    try {
      const id = seedBook(dir, { revision: 3 });
      const a = main.call('book:readMeta', id);
      const b = main.call('book:readMeta', id);
      assert.equal(a.revision, 3);
      assert.equal(b.revision, 3);

      a.chapterOrder.push('c2');
      const adopted = main.call('book:writeMeta', id, a);
      assert.equal(adopted.revision, 4);
      assert.deepEqual(onDisk(dir, id).chapterOrder, ['c1', 'c2']);

      b.title = 'Renamed';
      const r = main.call('book:writeMeta', id, b);
      assert.equal(r.title, 'Renamed');
      assert.deepEqual(r.chapterOrder, ['c1', 'c2']);
      assert.equal(r.revision, 5);
      const disk = onDisk(dir, id);
      assert.equal(disk.title, 'Renamed');
      assert.deepEqual(disk.chapterOrder, ['c1', 'c2']);
      assert.equal(disk.revision, 5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('b1. two writers editing different fields both survive', () => {
    const dir = tempLibrary();
    try {
      const id = seedBook(dir, { revision: 3 });
      const a = main.call('book:readMeta', id);
      const b = main.call('book:readMeta', id);
      a.author = 'Bea';
      main.call('book:writeMeta', id, a);
      b.title = 'New';
      const r = main.call('book:writeMeta', id, b);
      assert.equal(r.title, 'New');
      assert.equal(r.author, 'Bea');
      assert.equal(r.revision, 5);
      assert.equal(onDisk(dir, id).author, 'Bea');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('b2. two writers both reordering chapterOrder: the disk order wins, the stale reorder is dropped, its other edits kept', () => {
    // Merge rule (meta-merge.js mergeOrder): the result starts from the disk
    // order, and only a chapter added or removed on the stale side changes it.
    // A pure reorder on the stale side therefore loses to what is on disk.
    const dir = tempLibrary();
    try {
      const id = seedBook(dir, { revision: 3, chapterOrder: ['c1', 'c2', 'c3'] });
      const a = main.call('book:readMeta', id);
      const b = main.call('book:readMeta', id);
      a.chapterOrder = ['c3', 'c1', 'c2'];
      main.call('book:writeMeta', id, a);
      b.chapterOrder = ['c2', 'c3', 'c1'];
      b.title = 'Renamed';
      const r = main.call('book:writeMeta', id, b);
      assert.deepEqual(r.chapterOrder, ['c3', 'c1', 'c2']);
      assert.deepEqual(onDisk(dir, id).chapterOrder, ['c3', 'c1', 'c2']);
      assert.equal(r.title, 'Renamed');
      assert.equal(r.revision, 5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('c. the same stale save sent again: no duplicate chapters, same content, revision N+3', () => {
    // Pinned: every save writes one revision more, even an identical retry.
    // Only the content is idempotent.
    const dir = tempLibrary();
    try {
      const id = seedBook(dir, { revision: 3 });
      const a = main.call('book:readMeta', id);
      const b = main.call('book:readMeta', id);
      a.chapterOrder.push('c2');
      main.call('book:writeMeta', id, a);
      b.title = 'Renamed';
      const stale = clone(b);
      const first = main.call('book:writeMeta', id, clone(stale));
      const second = main.call('book:writeMeta', id, clone(stale));
      const third = main.call('book:writeMeta', id, clone(stale));
      for (const r of [first, second, third]) {
        assert.equal(r.title, 'Renamed');
        assert.deepEqual(r.chapterOrder, ['c1', 'c2']);
      }
      assert.equal(first.revision, 5);
      assert.equal(second.revision, 6);
      assert.equal(third.revision, 7);
      const disk = onDisk(dir, id);
      assert.deepEqual(disk.chapterOrder, ['c1', 'c2']);
      assert.equal(disk.title, 'Renamed');
      assert.equal(disk.revision, 7);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('d. a legacy book.json with no revision loads as revision 0 and writes 1', () => {
    const dir = tempLibrary();
    try {
      const id = seedBook(dir, {});
      assert.equal(onDisk(dir, id).revision, undefined);
      const m = main.call('book:readMeta', id);
      assert.equal(m.revision, 0);
      m.title = 'Renamed';
      const r = main.call('book:writeMeta', id, m);
      assert.equal(r.revision, 1);
      assert.equal(onDisk(dir, id).revision, 1);
      assert.equal(onDisk(dir, id).title, 'Renamed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('e. a save from the current revision writes N+1 with no merge, so a removal sticks', () => {
    const dir = tempLibrary();
    try {
      const id = seedBook(dir, { revision: 3 });
      const m = main.call('book:readMeta', id);
      m.chapterOrder = [];
      const r = main.call('book:writeMeta', id, m);
      assert.equal(r.revision, 4);
      assert.deepEqual(r.chapterOrder, []);
      assert.deepEqual(onDisk(dir, id).chapterOrder, []);
      assert.equal(onDisk(dir, id).revision, 4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
