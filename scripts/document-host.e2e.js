// End-to-end test for the desktop document host (#72): a .md named on the
// command line opens as a document, not a book. The open-document message
// reaches the window through the preload bridge, the page reads and saves the
// file by its ref, and an outside edit is refused as a conflict. Everything
// happens in a throwaway folder; the writer's library is never touched.
// Run with `npm run test:document-host`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-document-host-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-document-host-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NeoCraft Library');
const doc = path.join(tmp, 'draft.md');
const FIRST = '# Draft\n\nThe lantern was lit at dusk.\n';
const SECOND = FIRST + 'The road was empty.\n';
const OUTSIDE = 'Edited in another app.\n';
fs.writeFileSync(doc, FIRST);
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
// the file the writer double-clicked: main reads argv when it loads
process.argv.push(doc);

const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the .md opens: open-document reaches the window with its path, ref and first revision', async () => {
  await js(`window.__opened = []; window.neo.document.onOpen((m) => window.__opened.push(m)); window.neo.document.ready();`);
  await tick(200);
  const opened = await js('window.__opened');
  assert.equal(opened.length, 1, 'one document opened');
  assert.equal(opened[0].path, doc);
  assert.equal(opened[0].name, 'draft.md');
  assert.equal(typeof opened[0].ref, 'string');
  assert.equal(opened[0].revision, sha(FIRST));
});

test('the page reads the document by its ref, and the bytes match the file', async () => {
  const read = await js(`window.neo.document.read(window.__opened[0].ref).then((r) => ({ text: new TextDecoder().decode(r.bytes), revision: r.revision }))`);
  assert.equal(read.text, FIRST);
  assert.equal(read.revision, sha(FIRST));
});

test('a save at the revision it read replaces the file', async () => {
  const saved = await js(`(async () => {
    const r = await window.neo.document.read(window.__opened[0].ref);
    const bytes = new TextEncoder().encode(${JSON.stringify(SECOND)});
    return window.neo.document.save(window.__opened[0].ref, bytes, r.revision);
  })()`);
  assert.equal(saved.revision, sha(SECOND));
  assert.equal(fs.readFileSync(doc, 'utf8'), SECOND);
});

test('an edit made outside NeoCraft is refused as a conflict, and the outside text stays', async () => {
  fs.writeFileSync(doc, OUTSIDE);
  // the page still holds the revision of its last save (SECOND)
  const result = await js(`window.neo.document.save(window.__opened[0].ref, new TextEncoder().encode('ours'), ${JSON.stringify(sha(SECOND))}).then(() => 'saved', (e) => e.message)`);
  assert.match(result, /changed on disk/);
  assert.equal(fs.readFileSync(doc, 'utf8'), OUTSIDE);
});

test('no book was made: the library holds no book folder', async () => {
  const books = fs.readdirSync(lib).filter((name) => name.startsWith('book-'));
  assert.deepEqual(books, []);
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof window.neo !== 'undefined' && !!window.neo.document`).catch(() => false))) await tick(50);
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
}
main();
