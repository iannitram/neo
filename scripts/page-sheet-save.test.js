'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

// recursive freeze so any mutation of an input throws (R28)
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The save closure AND the close (Done / Escape) handler of openPageSheet,
// run on their own: sliced out of app.js, from `let saved` to the line that
// wires the Done button. Names the slice uses but does not declare (toast, t,
// knowDisk, diskKnown, keepOtherDeviceVersion, ...) are looked up in `scope`;
// a name the test does not know is a recording stub, so a fix may use any
// helper app.js already has.
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('  let saved = body.innerHTML;');
const to = app.indexOf("  bd.querySelector('.ps-done').onclick", from);
assert.ok(from > 0 && to > from, 'the save and close handlers were not found in app.js');
const make = vm.runInNewContext(
  '(function (scope) { with (scope) { return function (body, live, chId, window, normalizePageBody, clearTimeout, html, settle, bd, document) {\n' +
  '  let timer = null;\n' + app.slice(from, to) + '\n  return { save, close, saved: () => saved };\n}; } })');

// What the sheet shows the writer when a save did not land: text set on any
// element of the sheet, or a toast-like call with a sentence. Any wording.
function sheet(writeChapter, opts = {}) {
  const shown = [];
  const calls = [];
  const element = () => new Proxy(function () {}, {
    get: (_t, k) => (k === 'isConnected' ? true : (...a) => { for (const x of a) if (typeof x === 'string' && x.trim().length > 3) shown.push(x); return element(); }),
    set: (_t, k, v) => { if (['textContent', 'innerHTML', 'innerText'].includes(k) && typeof v === 'string' && v.trim()) shown.push(v); return true; },
  });
  const bd = { isConnected: true, removed: 0, remove() { this.removed++; this.isConnected = false; }, querySelector: element, querySelectorAll: () => [], append: element, appendChild: element, insertAdjacentHTML: (_p, h) => shown.push(h) };
  const scope = new Proxy({
    t: (s) => s,
    diskKnown: {},
    knowDisk() {},
    keepOtherDeviceVersion: async (...a) => { calls.push(['keepOtherDeviceVersion', ...a]); },
  }, {
    has: (target, k) => typeof k === 'string' && (k in target || !(k in globalThis)),
    get: (target, k) => (typeof k !== 'string' ? undefined : k in target ? target[k] : (...a) => { for (const x of a) if (typeof x === 'string' && x.trim().length > 3) shown.push(x); }),
  });
  const body = {
    innerHTML: '<p>old</p>',
    cloneNode() { return { innerHTML: body.innerHTML, querySelectorAll: () => [] }; },
    addEventListener() {},
  };
  const writes = [];
  const window = { neo: { writeChapter: (...a) => { writes.push(a); return writeChapter(writes.length, a); } } };
  const doc = { body: { appendChild() {} }, execCommand() {} };
  const s = make(scope)(body, deepFreeze({ id: 'book1' }), 'ch1', window, () => {}, () => {}, '<p>old</p>', () => {}, bd, doc);
  body.innerHTML = '<p>edited</p>';
  return { s, writes, bd, body, shown, calls };
}
const attempt = async (s) => { try { await s.save(); } catch { /* the error may propagate */ } };
const done = async (s) => { try { await s.close(); } catch { /* the error may propagate */ } };
// the first three arguments of a write: book, chapter, html
const three = (w) => w.slice(0, 3);

test('a rejected write leaves saved alone and the next save() writes again', async () => {
  const { s, writes } = sheet((n) => (n === 1 ? Promise.reject(new Error('disk full')) : Promise.resolve(true)));
  await attempt(s);
  assert.equal(s.saved(), '<p>old</p>');
  assert.equal(writes.length, 1);
  await attempt(s);
  assert.equal(writes.length, 2);
  assert.deepEqual(three(writes[1]), ['book1', 'ch1', '<p>edited</p>']);
});

test('a write that resolves false leaves saved alone and the next save() writes again', async () => {
  const { s, writes } = sheet((n) => Promise.resolve(n === 1 ? false : true));
  await attempt(s);
  assert.equal(s.saved(), '<p>old</p>');
  await attempt(s);
  assert.equal(writes.length, 2);
});

test('a successful write sets saved, and a second save() with no change writes nothing', async () => {
  const { s, writes } = sheet(() => Promise.resolve(true));
  await s.save();
  assert.equal(s.saved(), '<p>edited</p>');
  assert.equal(writes.length, 1);
  assert.deepEqual(three(writes[0]), ['book1', 'ch1', '<p>edited</p>']);
  await s.save();
  assert.equal(writes.length, 1);
});

test('Done after a write that resolves false keeps the sheet open and shows recovery text', async () => {
  const { s, bd, shown, writes } = sheet(() => Promise.resolve(false));
  await done(s);
  assert.equal(bd.removed, 0, 'the sheet closed with the edit unwritten');
  assert.equal(writes.length, 1);
  assert.ok(shown.length > 0, 'no error or recovery text was shown');
});

test('Done after a rejected write keeps the sheet open', async () => {
  const { s, bd, writes } = sheet(() => Promise.reject(new Error('disk full')));
  await done(s);
  assert.equal(bd.removed, 0);
  assert.equal(writes.length, 1);
});

test('the next Done after a failed write writes the same edit again and then closes', async () => {
  for (const first of [() => Promise.resolve(false), () => Promise.reject(new Error('disk full'))]) {
    const { s, bd, writes } = sheet((n) => (n === 1 ? first() : Promise.resolve(true)));
    await done(s);
    assert.equal(bd.removed, 0);
    await done(s);
    assert.equal(writes.length, 2, 'the retry did not write');
    assert.deepEqual(three(writes[1]), ['book1', 'ch1', '<p>edited</p>']);
    assert.equal(bd.removed, 1, 'the sheet stayed open after a write that landed');
    assert.equal(s.saved(), '<p>edited</p>');
  }
});

test('a Done whose write lands closes the sheet at once and shows no error text', async () => {
  const { s, bd, writes, shown } = sheet(() => Promise.resolve(true));
  await done(s);
  assert.equal(bd.removed, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(shown, []);
});

test('the write passes the revision the window knows: what it read, then what it last wrote', async () => {
  const { s, writes, body } = sheet(() => Promise.resolve(true));
  await s.save();
  assert.equal(writes[0][3], '<p>old</p>');
  body.innerHTML = '<p>edited again</p>';
  await s.save();
  assert.equal(writes[1][3], '<p>edited</p>');
});

test('a failed write does not move the known revision: the retry still passes what was read', async () => {
  const { s, writes } = sheet((n) => Promise.resolve(n === 1 ? false : true));
  await attempt(s);
  await attempt(s);
  assert.equal(writes[0][3], '<p>old</p>');
  assert.equal(writes[1][3], '<p>old</p>');
});

test('a {conflict} keeps the other device\'s text, and the write that follows passes it as the revision', async () => {
  const other = '<p>from the other device</p>';
  const { s, bd, writes, calls } = sheet((n) => Promise.resolve(n === 1 ? { conflict: other } : true));
  await done(s);
  assert.deepEqual(calls, [['keepOtherDeviceVersion', 'book1', 'ch1', other]], 'the disk text was not kept as its own chapter');
  if (bd.removed === 0) await done(s); // staying open for the next Done is allowed
  assert.equal(bd.removed, 1, 'the sheet never closed once the write landed');
  assert.equal(writes.length, 2);
  assert.deepEqual(three(writes[1]), ['book1', 'ch1', '<p>edited</p>']);
  assert.equal(writes[1][3], other);
  assert.equal(s.saved(), '<p>edited</p>');
});

test('a {conflict} is never taken for saved: while it lasts the sheet stays open and writes stay few', async () => {
  const other = '<p>from the other device</p>';
  const { s, bd, writes } = sheet(() => Promise.resolve({ conflict: other }));
  await Promise.race([done(s), new Promise((r) => setTimeout(r, 2000))]);
  assert.equal(bd.removed, 0, 'the sheet closed on a conflict');
  assert.notEqual(s.saved(), '<p>edited</p>');
  assert.ok(writes.length >= 1 && writes.length <= 5, 'the sheet kept writing against a conflict');
  assert.ok(writes.slice(1).every((w) => w[3] === other), 'a retry overwrote the disk without its revision');
});
