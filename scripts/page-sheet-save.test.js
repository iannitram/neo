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

// the save closure of openPageSheet, run on its own (sliced out of app.js)
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('  let saved = body.innerHTML;');
const to = app.indexOf("  body.addEventListener('input'", from);
assert.ok(from > 0 && to > from, 'the save closure was not found in app.js');
const factory = vm.runInNewContext(
  '(function (body, live, chId, window, normalizePageBody, clearTimeout) {\n  let timer = null;\n' +
  app.slice(from, to) + '\n  return { save, saved: () => saved };\n})');

function sheet(writeChapter) {
  const body = {
    innerHTML: '<p>old</p>',
    cloneNode() { return { innerHTML: body.innerHTML, querySelectorAll: () => [] }; },
  };
  const writes = [];
  const window = { neo: { writeChapter: (...a) => { writes.push(a); return writeChapter(writes.length); } } };
  const s = factory(body, { id: 'book1' }, 'ch1', window, () => {}, () => {});
  body.innerHTML = '<p>edited</p>';
  return { s, writes };
}
const attempt = async (s) => { try { await s.save(); } catch { /* the error may propagate */ } };

test('a rejected write leaves saved alone and the next save() writes again', async () => {
  const { s, writes } = sheet((n) => (n === 1 ? Promise.reject(new Error('disk full')) : Promise.resolve(true)));
  await attempt(s);
  assert.equal(s.saved(), '<p>old</p>');
  assert.equal(writes.length, 1);
  await attempt(s);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], ['book1', 'ch1', '<p>edited</p>']);
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
  assert.deepEqual(writes, [['book1', 'ch1', '<p>edited</p>']]);
  await s.save();
  assert.equal(writes.length, 1);
});
