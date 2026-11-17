'use strict';

// Files iCloud has taken off a Mac ("Optimize Mac Storage") are placeholders:
// a read waits on iCloud, forever when iCloud is stuck, and NEO froze at
// launch with no window. The real main.js runs against a temporary library,
// with iCloud played by the test through an injected placeholder check.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test, afterEach, after } = require('node:test');

const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

const activeChildren = new Set();
const activeTimers = new Set();
const activeIntervals = new Set();
const tempDirs = new Set();

const trackedSetTimeout = (fn, ms, ...args) => {
  const t = setTimeout(() => {
    activeTimers.delete(t);
    fn(...args);
  }, ms);
  activeTimers.add(t);
  return t;
};
const trackedClearTimeout = (t) => {
  activeTimers.delete(t);
  clearTimeout(t);
};
const trackedSetInterval = (fn, ms, ...args) => {
  const t = setInterval(fn, ms, ...args);
  activeIntervals.add(t);
  return t;
};
const trackedClearInterval = (t) => {
  activeIntervals.delete(t);
  clearInterval(t);
};

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
    dialog: { showMessageBox: () => Promise.resolve({}) },
    // the backup's own process: the real backup-worker.js, as a Node child
    utilityProcess: {
      fork: (file) => {
        const child = require('node:child_process').fork(file, [], { env: {
          ...process.env,
          NEO_TEST_CLOUD_FILES: JSON.stringify([...context.cloudFiles]),
          NEO_TEST_STUCK_FILE: context.stuckFile || ''
        } });
        activeChildren.add(child);
        child.on('exit', () => activeChildren.delete(child));
        return {
          on: (ev, fn) => child.on(ev, ev === 'exit' ? (code) => fn(code || 0) : fn),
          postMessage: (m) => child.send(m),
          kill: () => {
            activeChildren.delete(child);
            try { child.kill('SIGTERM'); } catch { /* ignore */ }
          }
        };
      }
    },
    screen: {}
  };
  const asked = [];
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: 'darwin', on() {} },
    console,
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout,
    setInterval: trackedSetInterval,
    clearInterval: trackedClearInterval,
    libraryRoot: os.tmpdir(),
    asked,
    arrivals: new Map(), // file → words iCloud brings down when asked
    cloudFiles: new Set(),
    stuckFile: ''
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  // The test injects which paths are placeholders; production's Darwin check
  // still runs unchanged when this hook is unset.
  vm.runInContext(`
    cloudPlaceholderCheck = (f) => cloudFiles.has(f);
    requestDownload = (files) => {
      for (const f of files) {
        asked.push(f);
        if (arrivals.has(f)) setTimeout(() => {
          fs.writeFileSync(f, arrivals.get(f));
          cloudFiles.delete(f);
        }, 50);
      }
    };
    CLOUD_WAIT = 600;
    BACKUP_LIMIT_MS = 3000;
  `, context);
  return {
    context,
    asked,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    run: (code) => vm.runInContext(code, context),
    pointAt(dir) {
      context.libraryRoot = dir;
      vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    }
  };
}

const main = loadMain();

// If this file is still running well after its tests should have ended, say
// what is holding it open and stop (#175): a hang then fails in seconds, with
// the culprit named, not at `npm test`'s outer limit. unref'd, so a run that
// ends on its own never sees it.
setTimeout(() => {
  console.error('icloud.test.js still running after 60 s; open: ' + JSON.stringify(process.getActiveResourcesInfo()) +
    '; backup children: ' + activeChildren.size);
  process.exit(1);
}, 60000).unref();

// Keep a normal file in place and mark it unavailable through the injected
// platform check. A download can replace its contents when requested.
function sendToICloud(file) {
  main.context.cloudFiles.add(file);
}

function libraryWithBook() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-icloud-'));
  tempDirs.add(dir);
  main.pointAt(dir);
  const lib = main.call('library:read');
  const book = main.call('book:create', { title: 'Salt Roads' });
  main.call('chapter:write', book.id, 'ch-aaa', '<p>The harbor was empty.</p>');
  book.chapterOrder = ['ch-aaa'];
  main.call('book:writeMeta', book.id, book);
  main.call('book:writeMeta', book.id, book); // a .bak, as a real library has
  main.call('aux:write', book.id, 'notes', '<p>Ferry at dawn.</p>');
  lib.firstRunDone = true;
  lib.shelves[0].bookIds.push(book.id);
  main.call('library:write', lib);
  main.call('library:write', lib);
  return { dir, book, bookDir: path.join(dir, book.id) };
}

describe('files still in iCloud', { concurrency: 1 }, () => {
  afterEach(() => {
    for (const t of activeTimers) clearTimeout(t);
    activeTimers.clear();
    for (const t of activeIntervals) clearInterval(t);
    activeIntervals.clear();
    for (const child of activeChildren) {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
    activeChildren.clear();
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tempDirs.clear();
    try {
      main.run('backupRunning = false; BACKUP_FILE_LIMIT_MS = 20000; BACKUP_LIMIT_MS = 3000;');
      main.asked.length = 0;
      main.context.arrivals.clear();
      main.context.cloudFiles.clear();
      main.context.stuckFile = '';
    } catch { /* ignore */ }
  });

  after(() => {
    for (const child of activeChildren) {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
    activeChildren.clear();
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tempDirs.clear();
  });

  test('everything on this Mac: reads answer at once, as before', { timeout: 5000 }, () => {
    const { book } = libraryWithBook();
    assert.equal(main.call('chapter:read', book.id, 'ch-aaa'), '<p>The harbor was empty.</p>');
    assert.equal(main.call('book:readMeta', book.id).title, 'Salt Roads');
  });

  test('a chapter in iCloud is waited for without holding NEO up, then read', { timeout: 5000 }, async () => {
    const { book, bookDir } = libraryWithBook();
    const file = path.join(bookDir, 'chapters', 'ch-aaa.html');
    const words = fs.readFileSync(file, 'utf8');
    sendToICloud(file);
    main.context.arrivals.set(file, words);
    const answer = main.call('chapter:read', book.id, 'ch-aaa');
    assert.ok(answer instanceof Promise || typeof answer.then === 'function', 'not read on the spot');
    assert.equal(await answer, words);
    assert.ok(main.asked.includes(file), 'iCloud was asked for it');
  });

  test('library.json in iCloud arrives and the shelf is read', { timeout: 5000 }, async () => {
    const { dir, book } = libraryWithBook();
    const file = path.join(dir, 'library.json');
    const words = fs.readFileSync(file, 'utf8');
    sendToICloud(file);
    main.context.arrivals.set(file, words);
    const lib = await main.call('library:read');
    assert.ok(lib.shelves[0].bookIds.includes(book.id));
  });

  test('library.json iCloud never sends: an error, and no new shelf written over it', { timeout: 5000 }, async () => {
    const { dir } = libraryWithBook();
    const file = path.join(dir, 'library.json');
    sendToICloud(file);
    await assert.rejects(Promise.resolve(main.call('library:read')), (err) => err.code === 'ECLOUD');
    assert.ok(fs.readFileSync(file, 'utf8').length > 0, 'left as it was');
  });

  test('book.json iCloud never sends: the book waits, never rebuilt or rolled back to .bak', { timeout: 5000 }, async () => {
    const { book, bookDir } = libraryWithBook();
    const file = path.join(bookDir, 'book.json');
    sendToICloud(file);
    assert.equal(await main.call('book:readMeta', book.id), null);
    assert.ok(fs.readFileSync(file, 'utf8').length > 0, 'not written over');
  });

  test('a save never goes over a chapter or notes still in iCloud', { timeout: 5000 }, () => {
    const { book, bookDir } = libraryWithBook();
    const ch = path.join(bookDir, 'chapters', 'ch-aaa.html');
    const notes = path.join(bookDir, 'notes.html');
    sendToICloud(ch);
    sendToICloud(notes);
    assert.throws(() => main.call('chapter:write', book.id, 'ch-aaa', '<p>new</p>', ''), (err) => err.code === 'ECLOUD');
    assert.throws(() => main.call('aux:write', book.id, 'notes', '<p>new</p>'), (err) => err.code === 'ECLOUD');
    assert.ok(fs.readFileSync(ch, 'utf8').includes('harbor'), 'chapter was not overwritten');
    assert.ok(fs.readFileSync(notes, 'utf8').includes('Ferry'), 'notes were not overwritten');
  });

  test("the daily backup leaves out what's in iCloud and says so, instead of waiting on it", { timeout: 5000 }, async () => {
    const { dir, bookDir } = libraryWithBook();
    sendToICloud(path.join(bookDir, 'chapters', 'ch-aaa.html'));
    await main.run('backupRunning = false; dailyBackup()');
    const zips = fs.readdirSync(path.join(dir, 'Backups')).filter((f) => f.endsWith('.zip'));
    assert.equal(zips.length, 1);
    const JSZip = localRequire('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, 'Backups', zips[0])));
    const note = await zip.file('_left-out-of-this-backup.txt').async('string');
    assert.match(note, /ch-aaa\.html \(in iCloud, not on this Mac\)/);
    assert.ok(zip.file(path.basename(bookDir) + '/notes.html'), 'the rest is backed up');
  });

  // A worker hook makes one ordinary file's read never settle, as a stuck
  // iCloud file does, without relying on named pipes.
  test('a file that never answers is left out of the backup, and NEO goes on meanwhile', { timeout: 10000 }, async () => {
    const { dir, bookDir } = libraryWithBook();
    const stuck = path.join(bookDir, 'stickies.json');
    fs.writeFileSync(stuck, '{"stuck":true}');
    main.context.stuckFile = stuck;
    main.run('BACKUP_FILE_LIMIT_MS = 300');
    let ticks = 0;
    let beat = null;
    try {
      beat = trackedSetInterval(() => { ticks++; }, 20);
      const t0 = Date.now();
      await main.run('backupRunning = false; dailyBackup()');
      if (beat) { trackedClearInterval(beat); beat = null; }
      assert.ok(Date.now() - t0 < 10000, 'the backup finished');
      assert.ok(ticks > 5, 'this process kept running while the backup waited');
      const zips = fs.readdirSync(path.join(dir, 'Backups')).filter((f) => f.endsWith('.zip'));
      assert.equal(zips.length, 1);
      const JSZip = localRequire('jszip');
      const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, 'Backups', zips[0])));
      assert.match(await zip.file('_left-out-of-this-backup.txt').async('string'), /stickies\.json \(not handed over in time\)/);
      assert.ok(zip.file(path.basename(bookDir) + '/book.json'), 'the rest is backed up');
    } finally {
      if (beat) trackedClearInterval(beat);
      main.run('BACKUP_FILE_LIMIT_MS = 20000');
    }
  });
});
