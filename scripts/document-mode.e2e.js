// End-to-end test for Document mode (#36): a .md named on the command line
// opens in the book editor's page with the book-only parts off. No book is
// made, library.json is not written by the page, triple Enter starts no
// chapter, and typed words reach the file through the document session.
// Throwaway folder only. Run with `npm run test:document-mode`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-document-mode-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NeoCraft Library');
const doc = path.join(tmp, 'draft.md');
const rtf = path.join(tmp, 'other.rtf');
fs.writeFileSync(doc, '# Draft\n\nThe lantern was lit at dusk.\n');
fs.writeFileSync(rtf, '{\\rtf1 hello}');
process.argv.push(doc);

const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(code, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(code).catch(() => false)) return true;
    await tick(60);
  }
  return false;
}
const press = async (keyCode) => {
  for (const type of ['keyDown', 'char', 'keyUp']) {
    wc.sendInputEvent({ type, keyCode: type === 'char' && keyCode === 'Enter' ? '\r' : keyCode });
    await tick(15);
  }
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let libraryBefore;

test('the file opens in Document mode: one page, its words, no shelf', async () => {
  assert.ok(await until(`document.querySelector('.chapter-body') && document.querySelector('.chapter-body').textContent.includes('lantern')`), 'the words are on the page');
  assert.equal(await js(`document.body.classList.contains('document-mode')`), true);
  assert.equal(await js(`document.querySelector('#bookshelf-view').hidden`), true);
  assert.equal(await js(`document.querySelectorAll('#chapters section').length`), 1);
  libraryBefore = fs.existsSync(path.join(lib, 'library.json')) ? fs.readFileSync(path.join(lib, 'library.json'), 'utf8') : null;
});

test('triple Enter starts no chapter and makes no section break', async () => {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const p = body.lastElementChild;
    const r = document.createRange();
    r.selectNodeContents(p); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  })()`);
  await press('Enter'); await press('Enter'); await press('Enter');
  assert.equal(await js(`document.querySelectorAll('#chapters section').length`), 1, 'still one chapter');
  assert.equal(await js(`document.querySelectorAll('.scene-break').length`), 0, 'no section break');
});

test('typed words reach the file through the session, and the file stays a plain .md', async () => {
  await js(`document.execCommand('insertText', false, 'The road was empty.')`);
  const end = Date.now() + 10000;
  let text = '';
  while (Date.now() < end) {
    text = fs.readFileSync(doc, 'utf8');
    if (text.includes('The road was empty.')) break;
    await tick(100);
  }
  assert.ok(text.includes('The road was empty.'), 'saved: ' + JSON.stringify(text));
  assert.ok(text.startsWith('# Draft\n\nThe lantern was lit at dusk.'), 'earlier words kept: ' + JSON.stringify(text));
  assert.ok(!text.includes('***'), 'no break marker');
});

test('no book was made, and the page never wrote library.json', async () => {
  const books = fs.existsSync(lib) ? fs.readdirSync(lib).filter((name) => name.startsWith('book-')) : [];
  assert.deepEqual(books, []);
  const now = fs.existsSync(path.join(lib, 'library.json')) ? fs.readFileSync(path.join(lib, 'library.json'), 'utf8') : null;
  assert.equal(now, libraryBefore);
});

test('book-only parts are off: no chapter heading, no title page', async () => {
  assert.equal(await js(`getComputedStyle(document.querySelector('.chapter-head')).display`), 'none');
  assert.equal(await js(`getComputedStyle(document.querySelector('#title-page')).display`), 'none');
  assert.equal(await js(`['covers','penNames','cards','notesPages'].some((k) => featureOn(k))`), false);
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof window.neo !== 'undefined' && !!window.NeoCraft_DocumentView`).catch(() => false))) await tick(50);
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
