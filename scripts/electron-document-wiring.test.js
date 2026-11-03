'use strict';

// main.js routing for the desktop document host (#72), run against a stub
// Electron so no binary is needed: a macOS open-file before the app is ready is
// held until launch finishes, a second instance's argv opens its file, a file
// that is not a document is ignored, and the window receives each opened file
// as 'open-document' only after it calls document:ready.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// main.js asks for electron-updater from a timer after launch, so the stub
// stays installed until the test process exits
const realModuleLoad = Module._load;

function loadMain(argvTail) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-wiring-'));
  const handlers = new Map();
  const appEvents = new Map();
  const sent = [];
  let ready = false;
  let readyCbs = [];
  let windows = 0;
  const sender = { isDestroyed: () => false, send: (ch, msg) => sent.push([ch, msg]) };
  const quiet = new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : quiet),
    apply: () => quiet,
    construct: () => quiet
  });
  const app = new Proxy({}, {
    get(_t, k) {
      switch (k) {
        case 'on': return (name, fn) => { appEvents.set(name, fn); return app; };
        case 'whenReady': return () => ({ then: (cb) => { readyCbs.push(cb); return { catch() {} }; } });
        case 'isReady': return () => ready;
        case 'isPackaged': return true;
        case 'requestSingleInstanceLock': return () => true;
        case 'getPath': return () => tmp;
        case 'getName': return () => 'NeoCraft';
        case 'getVersion': return () => '0.0.0';
        default: return quiet;
      }
    }
  });
  const BrowserWindow = function () { windows++; return quiet; };
  BrowserWindow.getAllWindows = () => (windows ? [quiet] : []);
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn), on() {}, once() {}, removeHandler() {} };
  const electron = new Proxy({ app, BrowserWindow, ipcMain }, { get: (t, k) => (k in t ? t[k] : quiet) });

  const realLoad = realModuleLoad;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === 'electron-updater') return { autoUpdater: quiet };
    return realLoad.call(this, request, parent, isMain);
  };
  const launchArgv = [process.execPath, ...argvTail];
  const mainPath = require.resolve('../main.js');
  delete require.cache[mainPath];
  require(mainPath);
  return {
    tmp, handlers, appEvents, sent, sender,
    isWindowCreated: () => windows > 0,
    async launch() {
      const savedArgv = process.argv;
      process.argv = launchArgv; // main reads argv when the app is ready
      ready = true;
      try { for (const cb of readyCbs) await cb(); } finally { process.argv = savedArgv; }
    },
    openFile(filePath) {
      let prevented = false;
      appEvents.get('open-file')({ preventDefault: () => { prevented = true; } }, filePath);
      return prevented;
    },
    secondInstance(argv, cwd) { appEvents.get('second-instance')({}, argv, cwd); }
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

test('open-file before the app is ready is held, then delivered once the window says ready', async (t) => {
  const m = loadMain([]);
  const doc = path.join(m.tmp, 'a.md');
  fs.writeFileSync(doc, 'one');
  t.after(() => fs.rmSync(m.tmp, { recursive: true, force: true }));
  assert.equal(m.openFile(doc), true, 'the event is claimed so the OS does not retry');
  await settle();
  assert.deepEqual(m.sent, [], 'nothing is opened before launch finishes');
  await m.launch();
  await settle();
  assert.deepEqual(m.sent, [], 'and nothing is sent until the window calls document:ready');
  await m.handlers.get('document:ready')({ sender: m.sender });
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0][0], 'open-document');
  assert.equal(m.sent[0][1].path, doc);
  assert.equal(m.sent[0][1].name, 'a.md');
});

test('a file named on the command line opens, and a second instance argv opens its own file', async (t) => {
  const m = loadMain([]);
  const first = path.join(m.tmp, 'first.md');
  const second = path.join(m.tmp, 'second.txt');
  fs.writeFileSync(first, 'one');
  fs.writeFileSync(second, 'two');
  t.after(() => fs.rmSync(m.tmp, { recursive: true, force: true }));
  const withFile = loadMain([first]);
  t.after(() => fs.rmSync(withFile.tmp, { recursive: true, force: true }));
  await withFile.launch();
  await withFile.handlers.get('document:ready')({ sender: withFile.sender });
  await settle();
  assert.deepEqual(withFile.sent.map(([, msg]) => msg.path), [first]);

  await m.launch();
  await m.handlers.get('document:ready')({ sender: m.sender });
  m.secondInstance([process.execPath, '--some-flag', second], m.tmp);
  await settle();
  assert.deepEqual(m.sent.map(([, msg]) => msg.path), [second]);
});

test('a file that is not a document is ignored, and the renderer can only read refs main issued', async (t) => {
  const m = loadMain([]);
  const docx = path.join(m.tmp, 'b.docx');
  fs.writeFileSync(docx, 'x');
  t.after(() => fs.rmSync(m.tmp, { recursive: true, force: true }));
  await m.launch();
  m.openFile(docx);
  m.secondInstance([process.execPath, docx, 'neocraft://open'], m.tmp);
  await m.handlers.get('document:ready')({ sender: m.sender });
  await settle();
  assert.deepEqual(m.sent, []);
  await assert.rejects(async () => m.handlers.get('document:read')({}, 'not-a-ref'), (err) => err.code === 'unknown-document');
  await assert.rejects(async () => m.handlers.get('document:read')({}, docx), (err) => err.code === 'unknown-document');
});
