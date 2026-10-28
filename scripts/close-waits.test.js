'use strict';

// Closing the window, quitting and an update's restart wait until the
// renderer's flush barrier has settled. main.js is loaded the way
// scripts/filesystem.test.js loads it; the window is a fake that records what
// main sends it and lets the test answer as the renderer would.

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

// Time is the test's own: main.js and the fake window set their timers on a
// virtual clock (loadMain), and each test moves it with advance(). Nothing here
// sleeps, so the order of the saves and replies never depends on machine load.
const realSetImmediate = setImmediate;
const yieldNow = () => new Promise((resolve) => realSetImmediate(resolve));
// how long the fake window takes to answer a flush (its timer below)
const REPLY_MS = 5;
// time for every reply the fake window makes to arrive
const SETTLE = 50;
// main gives up on a renderer that never answers after 8 s (FLUSH_REPLY_MS); a stalled test runs past that
const STALL_MS = 8000;

// Any property the test does not name answers with another stub, so the parts of
// main.js this test is not about can run without the real Electron.
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

function loadMain() {
  const ipcHandlers = new Map();
  const ipcOn = new Map();
  const appHandlers = new Map();
  const state = { win: null, dialogs: [], responses: [], quits: 0 };

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
  // runs the timers due within ms, earliest first (ties in the order they were set);
  // each one's promise callbacks run before the next timer does
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
      getPath: () => os.tmpdir(),
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
      static getAllWindows() { return state.win && !state.win.isDestroyed() ? [state.win] : []; }
      static getFocusedWindow() { return state.win; }
    },
    Menu: mock({ buildFromTemplate: (items) => items, setApplicationMenu() {} }),
    dialog: mock({
      showMessageBox: async (_win, opts) => {
        state.dialogs.push(opts);
        return { response: state.responses.length ? state.responses.shift() : 1 };
      }
    }),
    utilityProcess: mock({ fork: () => mock({ on() {}, postMessage() {} }) }),
    screen: mock({ getAllDisplays: () => [] }),
    nativeTheme: mock({ on() {} })
  };

  const context = vm.createContext({
    require: (name) => (name === 'electron' ? electron : localRequire(name)),
    __dirname: root,
    process: { platform: process.platform, env: process.env, on() {} },
    console,
    libraryRoot: os.tmpdir(),
    setImmediate,
    setTimeout: vSetTimeout,
    clearTimeout: vClearTimeout
  });
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });

  // a fake BrowserWindow: close() emits 'close' the way Electron does, and a
  // listener may cancel it with event.preventDefault()
  function fakeWindow({ answer = 'ok', failed = [], answers = [] } = {}) {
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
            // the renderer answers once its writes are done
            vSetTimeout(() => ipcOn.get('flush:reply')({}, id, { ok: true, failed: [] }), REPLY_MS);
          } else if (next === 'failed') {
            vSetTimeout(() => ipcOn.get('flush:reply')({}, id, { ok: false, failed, timedOut: [] }), REPLY_MS);
          }
          // answer === 'stall': the renderer never replies
        }
      })
    };
    // any other window call (loadFile, setMenuBarVisibility, ...) does nothing
    const win = new Proxy(methods, { get: (t, k) => (k in t ? t[k] : () => undefined) });
    return { win, listeners, sent, isClosed: () => destroyed, fire: (ev, e) => listeners.forEach((fn) => fn(e)) };
  }

  return {
    context,
    ipcHandlers,
    ipcOn,
    appHandlers,
    state,
    advance,
    // makes a window and creates the way main does, returning its fake
    open(opts) {
      const w = fakeWindow(opts);
      state.win = w.win;
      context.createWindow();
      return w;
    }
  };
}

describe('closing waits for the renderer to flush', () => {
  test('the close is held until the renderer reports its saves settled, then goes through', async () => {
    const main = loadMain();
    const w = main.open({ answer: 'ok' });
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    w.fire('close', event);
    assert.equal(event.prevented, true, 'the first close is cancelled');
    assert.equal(w.isClosed(), false);
    await main.advance(SETTLE);
    assert.deepEqual(w.sent.map((s) => s[0]), ['flush:request']);
    assert.equal(w.isClosed(), true, 'the window closes once the renderer answered ok');
    assert.equal(main.state.dialogs.length, 0);
  });

  test('a close right after typing keeps the last edit: the answer is waited for, not assumed', async () => {
    const main = loadMain();
    // the renderer's answer comes late, as it does while the last chapter write is in flight
    const w = main.open({ answer: 'stall' });
    w.fire('close', { preventDefault() {} });
    await main.advance(5);
    assert.equal(w.isClosed(), false, 'nothing closes before the answer');
    main.ipcOn.get('flush:reply')({}, w.sent[0][1], { ok: true, failed: [] });
    await main.advance(SETTLE);
    assert.equal(w.isClosed(), true);
  });

  test('a second close while the first waits does not ask the renderer again', async () => {
    const main = loadMain();
    const w = main.open({ answer: 'stall' });
    w.fire('close', { preventDefault() {} });
    w.fire('close', { preventDefault() {} });
    await main.advance(5);
    assert.equal(w.sent.filter((s) => s[0] === 'flush:request').length, 1);
  });

  test('a stalled save keeps the window open and offers Try Again, Keep Open and Close Anyway', async () => {
    const main = loadMain();
    main.state.responses.push(1); // Keep Open
    const w = main.open({ answer: 'stall' });
    w.fire('close', { preventDefault() {} });
    await main.advance(STALL_MS + 30);
    assert.equal(main.state.dialogs.length, 1);
    assert.deepEqual([...main.state.dialogs[0].buttons], ['Try Again', 'Keep Open', 'Close Anyway']);
    assert.equal(main.state.dialogs[0].cancelId, 1);
    assert.equal(w.isClosed(), false, 'Keep Open leaves the window as it is');
  });

  test('a failed flush shows the choice, and Close Anyway closes', async () => {
    const main = loadMain();
    main.state.responses.push(2); // Close Anyway
    const w = main.open({ answer: 'failed', failed: ['chapter:c1'] });
    w.fire('close', { preventDefault() {} });
    await main.advance(SETTLE);
    assert.equal(main.state.dialogs.length, 1);
    assert.equal(w.isClosed(), true);
  });

  test('Try Again asks the renderer once more and closes when that answer is ok', async () => {
    const main = loadMain();
    main.state.responses.push(0); // Try Again
    // the first answer is a failure, the second (after Try Again) is ok
    const w = main.open({ answers: ['failed', 'ok'], failed: ['save'] });
    w.fire('close', { preventDefault() {} });
    await main.advance(SETTLE);
    assert.equal(w.sent.filter((s) => s[0] === 'flush:request').length, 2, 'asked again');
    assert.equal(main.state.dialogs.length, 1);
    assert.equal(w.isClosed(), true);
  });

  test('quit: the window closing for a Quit waits the same way, then the app quits', async () => {
    const main = loadMain();
    const w = main.open({ answer: 'ok' });
    main.appHandlers.get('before-quit')();
    w.fire('close', { preventDefault() {} });
    await main.advance(SETTLE);
    assert.equal(w.isClosed(), true);
    assert.equal(main.state.quits, 1, 'app.quit runs after the window is gone');
  });

  test('quit: a stalled save on Quit keeps NEO running', async () => {
    const main = loadMain();
    main.state.responses.push(1); // Keep Open
    const w = main.open({ answer: 'stall' });
    main.appHandlers.get('before-quit')();
    w.fire('close', { preventDefault() {} });
    await main.advance(STALL_MS + 30);
    assert.equal(w.isClosed(), false);
    assert.equal(main.state.quits, 0);
  });

  test('update restart: the install waits for the window and only then quits', async () => {
    const main = loadMain();
    const calls = [];
    vm.runInContext('updater = { quitAndInstall: (a, b) => { __calls.push([a, b]); } }; updaterReady = true;',
      Object.assign(main.context, { __calls: calls }));
    const w = main.open({ answer: 'ok' });
    const pending = main.ipcHandlers.get('update:install')({});
    await main.advance(SETTLE);
    assert.equal(await pending, true);
    assert.equal(calls.length, 1, 'quitAndInstall ran once');
    assert.deepEqual(w.sent.map((s) => s[0]), ['flush:request'], 'the renderer was asked before the restart');
  });

  test('update restart: a stalled save keeps NEO open and does not restart', async () => {
    const main = loadMain();
    const calls = [];
    vm.runInContext('updater = { quitAndInstall: () => { __calls.push(1); } }; updaterReady = true;',
      Object.assign(main.context, { __calls: calls }));
    main.state.responses.push(1); // Keep Open
    main.open({ answer: 'stall' });
    const pending = main.ipcHandlers.get('update:install')({});
    await main.advance(STALL_MS + 30);
    assert.equal(await pending, false);
    assert.equal(calls.length, 0);
  });
});

describe('preload forwards the flush handshake', () => {
  function loadPreload() {
    const sent = [];
    const listeners = new Map();
    let api = null;
    const ipcRenderer = {
      invoke: () => Promise.resolve(),
      send: (...a) => sent.push(a),
      sendSync: () => ({}),
      on: (ch, fn) => listeners.set(ch, fn)
    };
    const electron = {
      contextBridge: { exposeInMainWorld: (_n, o) => { api = o; } },
      ipcRenderer,
      webUtils: {}
    };
    const src = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    vm.runInNewContext(src, { require: () => electron, process: { platform: 'test' } });
    return { api, sent, listeners };
  }

  test('flushReply sends the request id and the whole result to main', () => {
    const { api, sent } = loadPreload();
    const result = { ok: false, failed: ['chapter:c1', 'meta'], timedOut: ['c2'] };
    api.flushReply(7, result);
    assert.deepEqual(sent[0], ['flush:reply', 7, result]);
  });

  test('onFlushRequest hands the renderer the id main asked with', () => {
    const { api, listeners } = loadPreload();
    let got = null;
    api.onFlushRequest((id) => { got = id; });
    listeners.get('flush:request')({}, 9);
    assert.equal(got, 9);
  });
});
