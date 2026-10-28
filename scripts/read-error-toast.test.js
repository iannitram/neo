'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Rule: a book whose chapter will not read stays on the shelf and the writer
// is told which chapter and why; a refresh that cannot read says it once.
// The real openBook, refreshFromDisk and message helpers run from app.js;
// the page around them is a stub.
function slice(from, to) {
  const at = app.indexOf(from);
  assert.ok(at >= 0, from);
  return app.slice(at, app.indexOf(to, at));
}
const END = '\n}';
function page(readChapter, extra = {}) {
  const toasts = [];
  const logged = [];
  const shelf = { hidden: false };
  const editor = { hidden: true };
  const ctx = vm.createContext({
    window: { neo: {
      readBookMeta: async () => ({ id: 'b', chapterOrder: ['c1', 'c2'] }),
      readChapter,
      readJSON: async () => [],
      logError: (m) => logged.push(m),
      chapterStamps: async () => ({})
    } },
    t: (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]),
    chapterName: (id) => (id === 'c1' ? 'Chapter 1' : 'Chapter 2'),
    toast: (m) => toasts.push(m),
    shelfExport: false,
    console: { error() {} },
    bookMetaCache: new Map(),
    refreshOpenAux: async () => {},
    $: (sel) => (sel === '#bookshelf-view' ? shelf : editor),
    book: null,
    savedMetaSig: '',
    chapterHTML: {}, savedHTML: {}, diskStamps: {}, writing: {},
    metaSig: (m) => JSON.stringify(m ? m.chapterOrder : ''),
    setTimeout,
    ...extra
  });
  vm.runInContext(slice('function chapterReadProblem(', '// Scripts that do not separate') +
    slice('let openGeneration = 0;', END) + END +
    slice('let refreshing = false;', '\nwindow.addEventListener(\'focus\''), ctx);
  return { ctx, toasts, logged, shelf, editor };
}
const fail = (message, code) => async () => { throw Object.assign(new Error(message), code ? { code } : {}); };
const CASES = [
  ['EACCES', 'Could not read chapter c2: EACCES', 'permission was denied'],
  ['EBUSY', 'Could not read chapter c2: EBUSY', 'busy or locked'],
  ['cloud-only', 'Still in iCloud, not on this Mac yet: c2.html', 'still in the cloud']
];

for (const [name, message, reason] of CASES) {
  test(`openBook: a chapter read failing with ${name} names the chapter and reason, the shelf stays`, async () => {
    const reads = [];
    const p = page(async (b, ch) => {
      reads.push(ch);
      if (ch === 'c2') return fail(message, name === 'cloud-only' ? 'ECLOUD' : undefined)();
      return '<p>x</p>';
    });
    await p.ctx.openBook('b'); // resolves: no unhandled rejection
    assert.equal(p.toasts.length, 1);
    assert.match(p.toasts[0], /Chapter 2/);
    assert.ok(p.toasts[0].includes(reason), p.toasts[0]);
    assert.equal(p.shelf.hidden, false);
    assert.equal(p.editor.hidden, true);
    assert.equal(vm.runInContext('book', p.ctx), null);
  });

  test(`refreshFromDisk: a reconcile read failing with ${name} says so once, not on every look`, async () => {
    const p = page(fail(message, name === 'cloud-only' ? 'ECLOUD' : undefined), {
      book: { id: 'b', chapterOrder: ['c1', 'c2'] },
      chapterHTML: { c1: '<p>a</p>', c2: '<p>b</p>' },
      savedHTML: { c1: '<p>a</p>', c2: '<p>b</p>' }
    });
    p.ctx.book = vm.runInContext('({ id: "b", chapterOrder: ["c1", "c2"] })', p.ctx);
    p.ctx.window.neo.readBookMeta = async () => ({ id: 'b', chapterOrder: ['c1', 'c2'] });
    await p.ctx.refreshFromDisk();
    await p.ctx.refreshFromDisk();
    await p.ctx.refreshFromDisk();
    assert.equal(p.toasts.length, 1, 'told once');
    assert.match(p.toasts[0], /Chapter 1/);
    assert.ok(p.toasts[0].includes(reason), p.toasts[0]);
  });
}

test('refreshFromDisk: a chapter new from the other device that will not read says so once', async () => {
  const p = page(fail('Could not read chapter c3: EACCES'), {
    chapterHTML: { c1: '' }, savedHTML: { c1: '' }
  });
  p.ctx.book = vm.runInContext('({ id: "b", chapterOrder: ["c1"] })', p.ctx);
  p.ctx.window.neo.readBookMeta = async () => ({ id: 'b', chapterOrder: ['c1', 'c3'] });
  await p.ctx.refreshFromDisk();
  await p.ctx.refreshFromDisk();
  assert.equal(p.toasts.length, 1);
  assert.match(p.toasts[0], /permission was denied/);
});
