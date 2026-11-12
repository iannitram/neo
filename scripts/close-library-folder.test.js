'use strict';

// B08: every library-folder restart waits for the renderer's flush barrier, as
// closing the window does. The three ways to change the folder (Move Books into
// a folder the writer picks, Leave Them, and NEO Pocket's iCloud folder) each
// run against a settled, a failed and a stalled flush. main.js runs in a sandbox
// against temporary folders; the window is a fake that answers flush:request and
// writes the last edit to disk when it settles, as the renderer does.

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

const realSetImmediate = setImmediate;
const yieldNow = () => new Promise((resolve) => realSetImmediate(resolve));
// how long the fake window takes to answer a flush
const REPLY_MS = 5;
// main gives up on a renderer that never answers after 8 s (FLUSH_REPLY_MS)
const STALL_MS = 8000;
// the last words typed, right before the library folder changes
const LAST_EDIT = 'The last sentence, typed just before the move.';

function book(lib, id, words = 'The stairs went down.') {
  fs.mkdirSync(path.join(lib, id, 'chapters'), { recursive: true });
  fs.writeFileSync(path.join(lib, id, 'book.json'), JSON.stringify({ id, title: id, chapterOrder: ['ch-1'] }));
  fs.writeFileSync(path.join(lib, id, 'chapters', 'ch-1.html'), `<p>${words}</p>`);
}

// a Mac with a library in Documents and, if `pocket`, NEO Pocket's iCloud folder
function mac({ pocket = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-close-library-'));
  const home = path.join(base, 'home');
  const userData = path.join(base, 'userData');
  const docs = path.join(home, 'Documents');
  const lib = path.join(docs, 'NeoCraft Library');
  fs.mkdirSync(userData, { recursive: true });
  book(lib, 'book-wool-1');
  book(lib, 'book-shift-2');
  fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
    authorName: 'Hugh Howey', penNames: [], firstRunDone: true,
    authors: [{ id: 'a1', name: 'Hugh Howey' }],
    shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: ['book-wool-1'] }]
  }));
  const cloudDocs = path.join(home, 'Library', 'Mobile Documents', 'iCloud~com~hughhowey~neo~pocket', 'Documents');
  if (pocket) fs.mkdirSync(cloudDocs, { recursive: true });
  return { base, home, userData, docs, lib, cloud: path.join(cloudDocs, 'NEO Library'), dropbox: path.join(home, 'Dropbox', 'NEO') };
}

// Any property the test does not name answers with another stub.
function mock(overrides = {}) {
  return new Proxy(() => {}, {
    get: (_t, k) => {
      if (k === 'then') return undefined;
      if (k in overrides) return overrides[k];
      return mock();
    },
    apply: () => mock()
  });
}

function loadMain({ home, userData, platform = 'darwin' }) {
  const ipcHandlers = new Map();
  const ipcOn = new Map();
  const appHandlers = new Map();
  const state = { win: null, extra: [], dialogs: [], responses: [], trashed: [], quits: 0, relaunches: 0, exits: 0, pickFolder: null };

  // the virtual clock: timers wait in clock.timers until advance() reaches them
  const clock = { now: 0, seq: 0, timers: [] };
  const vSetTimeout = (fn, ms = 0, ...args) => {
    const timer = { at: clock.now + Math.max(0, Number(ms) || 0), seq: ++clock.seq, fn, args, unref() { return this; } };
    clock.timers.push(timer);
    return timer;
  };
  const vClearTimeout = (timer) => {
    const i = clock.timers.indexOf(timer);
    if (i >= 0) clock.timers.splice(i, 1);
  };
  async function advance(ms) {
    const target = clock.now + ms;
    for (;;) {
      await yieldNow();
      let next = null;
      for (const t of clock.timers) {
        if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq))) next = t;
      }
      if (!next) break;
      vClearTimeout(next);
      clock.now = next.at;
      next.fn(...next.args);
    }
    await yieldNow();
    await yieldNow();
    clock.now = target;
  }

  const electron = {
    app: mock({
      on: (ev, fn) => appHandlers.set(ev, fn),
      quit: () => { state.quits++; },
      relaunch: () => { state.relaunches++; },
      exit: () => { state.exits++; },
      getPath: (name) => ({ home, userData, documents: path.join(home, 'Documents') })[name] || os.tmpdir(),
      getLocale: () => 'en',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      isPackaged: false
    }),
    ipcMain: mock({
      on: (ev, fn) => ipcOn.set(ev, fn),
      handle: (ev, fn) => ipcHandlers.set(ev, fn)
    }),
    BrowserWindow: class {
      constructor() { return state.win; }
      static getAllWindows() { return [...(state.win && !state.win.isDestroyed() ? [state.win] : []), ...state.extra]; }
      static getFocusedWindow() { return state.win; }
    },
    Menu: mock({ buildFromTemplate: (items) => items, setApplicationMenu() {} }),
    dialog: mock({
      showMessageBox: async (winOrOpts, opts) => {
        if (opts === undefined && winOrOpts && (Object.hasOwn(winOrOpts, 'buttons') || Object.hasOwn(winOrOpts, 'message'))) {
          opts = winOrOpts;
        }
        state.dialogs.push(opts);
        return { response: state.responses.length ? state.responses.shift() : 1 };
      },
      showOpenDialog: async () => ({ canceled: !state.pickFolder, filePaths: state.pickFolder ? [state.pickFolder] : [] })
    }),
    shell: mock({
      trashItem: async (p) => { state.trashed.push(p); fs.rmSync(p, { recursive: true, force: true }); },
      openExternal: async () => {}
    }),
    utilityProcess: mock({ fork: () => mock({ on() {}, postMessage() {} }) }),
    screen: mock({ getAllDisplays: () => [] }),
    nativeTheme: mock({ on() {} })
  };

  const context = vm.createContext({
    require: (name) => (name === 'electron' ? electron : localRequire(name)),
    __dirname: root,
    process: { platform, env: process.env, on() {} },
    console,
    libraryRoot: os.tmpdir(),
    setImmediate,
    setTimeout: vSetTimeout,
    clearTimeout: vClearTimeout
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });

  // a fake editor window: close() emits 'close' the way Electron does; destroy()
  // emits nothing. Its last edit lands on disk when the renderer settles.
  function fakeWindow({ answer = 'ok', answers = [], failed = [], lib } = {}) {
    const listeners = [];
    const sent = [];
    let destroyed = false;
    const methods = {
      on(ev, fn) { if (ev === 'close') listeners.push(fn); },
      close() {
        const event = { prevented: false, preventDefault() { this.prevented = true; } };
        for (const fn of listeners) fn(event);
        if (!event.prevented) destroyed = true;
      },
      destroy() { destroyed = true; },
      isDestroyed: () => destroyed,
      isFullScreen: () => false,
      isMinimized: () => false,
      getNormalBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      webContents: mock({
        on() {},
        send(channel, id) {
          sent.push([channel, id]);
          if (channel !== 'flush:request') return;
          const next = answers.length ? answers.shift() : answer;
          if (next === 'ok') {
            fs.writeFileSync(path.join(lib, 'book-wool-1', 'chapters', 'ch-1.html'), `<p>${LAST_EDIT}</p>`);
            vSetTimeout(() => ipcOn.get('flush:reply')({}, id, { ok: true, failed: [] }), REPLY_MS);
          } else if (next === 'failed') {
            vSetTimeout(() => ipcOn.get('flush:reply')({}, id, { ok: false, failed, timedOut: [] }), REPLY_MS);
          }
          // answer === 'stall': the renderer never replies
        }
      })
    };
    const win = new Proxy(methods, { get: (t, k) => (k in t ? t[k] : () => undefined) });
    return { win, sent, isClosed: () => destroyed };
  }

  return {
    context,
    ipcHandlers,
    state,
    advance,
    run: (code) => vm.runInContext(code, context),
    call: (name, ...args) => ipcHandlers.get(name)(null, ...args),
    open(opts) {
      const w = fakeWindow(opts);
      state.win = w.win;
      context.createWindow();
      return w;
    }
  };
}

// the three ways to change the folder, with the answers that pick each one
const PATHS = {
  // File → Library Folder… → Choose Folder…, a folder in Dropbox, Move Books
  move: { pocket: false, choices: [0, 0], folder: (m) => m.dropbox, dest: (m) => m.dropbox },
  // the same, Leave Them: the folder changes and the books stay
  leave: { pocket: false, choices: [0, 1], folder: (m) => m.dropbox, dest: (m) => m.dropbox },
  // Use iCloud Drive into NEO Pocket's folder
  cloud: { pocket: true, choices: [0], folder: (m) => m.cloud, dest: (m) => m.cloud }
};

// the library folder is changed the way the writer does it: the window is open
// with its last edit, and the answers queue up the dialogs in the order main asks
function changeLibrary(name, { answers = ['ok'], extra = [] } = {}) {
  const spec = PATHS[name];
  const m = mac({ pocket: spec.pocket });
  const main = loadMain({ home: m.home, userData: m.userData });
  main.run(`LIBRARY_DIR = ${JSON.stringify(m.lib)}; LIBRARY_FILE = require("path").join(LIBRARY_DIR, "library.json");`);
  const w = main.open({ answers, failed: ['chapter:ch-1'], lib: m.lib });
  main.state.pickFolder = spec.folder(m);
  main.state.responses.push(...spec.choices, ...extra);
  const pending = main.run('chooseLibraryFolder()');
  // a flush (or a stall) and its timers all run inside this advance
  const done = async () => {
    await main.advance(STALL_MS + 30);
    await pending;
  };
  const cleanup = () => fs.rmSync(m.base, { recursive: true, force: true });
  return { m, main, w, spec, done, cleanup, dest: spec.dest(m) };
}

const settingsOf = (userData) => {
  try { return JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')); } catch { return {}; }
};
const chapterText = (dir, id) => fs.readFileSync(path.join(dir, id, 'chapters', 'ch-1.html'), 'utf8');
const LAST = `<p>${LAST_EDIT}</p>`;
const BEFORE = '<p>The stairs went down.</p>';

describe('changing the library folder waits for the saves', () => {
  for (const name of Object.keys(PATHS)) {
    test(`${name}: a settled flush keeps the last edit, moves what the path moves, and restarts`, async () => {
      const r = changeLibrary(name, { answers: ['ok'] });
      try {
        await r.done();
        const flushDialogs = r.main.state.dialogs.filter((d) => d.buttons.includes('Try Again'));
        assert.equal(flushDialogs.length, 0, 'no save dialog when the saves settled');
        assert.equal(r.main.state.relaunches, 1);
        assert.equal(r.main.state.exits, 1);
        // a move closes the window first; Leave Them restarts with it open, as an update does
        if (name !== 'leave') assert.equal(r.w.isClosed(), true, 'the window is closed for the move');
        assert.equal(settingsOf(r.m.userData).libraryDir, r.dest);
        if (name === 'leave') {
          assert.equal(chapterText(r.m.lib, 'book-wool-1'), LAST, 'the books stayed, with the last edit');
          assert.equal(fs.existsSync(path.join(r.dest, 'book-wool-1')), false);
        } else {
          assert.equal(chapterText(r.dest, 'book-wool-1'), LAST, 'the last edit moved with the book');
          assert.equal(fs.existsSync(r.m.lib), false, 'the old folder went to the Trash');
        }
      } finally {
        r.cleanup();
      }
    });

    for (const outcome of ['failed', 'stall']) {
      test(`${name}: a ${outcome === 'failed' ? 'failed' : 'stalled'} flush offers the choice, and Keep Open moves nothing`, async () => {
        const r = changeLibrary(name, { answers: [outcome], extra: [1] }); // Keep Open
        try {
          await r.done();
          const flush = r.main.state.dialogs[r.main.state.dialogs.length - 1];
          assert.deepEqual([...flush.buttons], ['Try Again', 'Keep Open', 'Close Anyway']);
          assert.equal(flush.cancelId, 1);
          assert.equal(r.main.state.relaunches, 0, 'no restart');
          assert.equal(r.main.state.exits, 0);
          assert.equal(r.w.isClosed(), false, 'the window is kept');
          assert.equal(chapterText(r.m.lib, 'book-wool-1'), BEFORE, 'the books stayed where they were');
          assert.equal(fs.existsSync(r.dest), false, 'nothing went to the new folder');
          assert.equal(settingsOf(r.m.userData).libraryDir, undefined, 'the library folder did not change');
        } finally {
          r.cleanup();
        }
      });
    }
  }

  test('move: Close Anyway after a failed flush moves the books as they are on disk, and restarts', async () => {
    const r = changeLibrary('move', { answers: ['failed'], extra: [2] }); // Close Anyway
    try {
      await r.done();
      assert.equal(r.main.state.relaunches, 1);
      assert.equal(chapterText(r.dest, 'book-wool-1'), BEFORE);
      assert.equal(fs.existsSync(r.m.lib), false);
    } finally {
      r.cleanup();
    }
  });

  test('move: Try Again asks the renderer once more, and the move goes ahead once it settles', async () => {
    const r = changeLibrary('move', { answers: ['failed', 'ok'], extra: [0] }); // Try Again
    try {
      await r.done();
      assert.equal(r.w.sent.filter((s) => s[0] === 'flush:request').length, 2, 'asked again');
      assert.equal(chapterText(r.dest, 'book-wool-1'), LAST);
      assert.equal(r.main.state.relaunches, 1);
    } finally {
      r.cleanup();
    }
  });
});

test('dialog fake records options passed through Electron’s one-argument overload on Windows', async () => {
  const m = mac();
  const main = loadMain({ home: m.home, userData: m.userData, platform: 'win32' });
  try {
    await main.run('require("electron").dialog.showMessageBox({ message: "one argument", buttons: ["OK"] })');
    assert.equal(main.state.dialogs[0].message, 'one argument');
    assert.deepEqual([...main.state.dialogs[0].buttons], ['OK']);
  } finally {
    fs.rmSync(m.base, { recursive: true, force: true });
  }
});
