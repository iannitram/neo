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

const { normalizePath, isExcludedPath } = require('../nextcloud/neocraft/src/excluded');

test('1. a file inside an excluded folder', () => {
  assert.equal(isExcludedPath('/Notes/a.md', deepFreeze(['/Notes'])), true);
});

test('2. a missing leading slash and a trailing slash on the entry', () => {
  assert.equal(isExcludedPath('Notes/sub/b.md', deepFreeze(['/Notes/'])), true);
});

test('3. a sibling that only shares a prefix is not excluded', () => {
  assert.equal(isExcludedPath('/Notesy/a.md', deepFreeze(['/Notes'])), false);
});

test('4. matching is case-sensitive', () => {
  assert.equal(isExcludedPath('/notes/a.md', deepFreeze(['/Notes'])), false);
});

test('5. a path that does not normalize fails closed', () => {
  assert.equal(isExcludedPath('/a/../Notes/x.md', deepFreeze(['/Other'])), true);
});

test('6. an empty list excludes nothing', () => {
  assert.equal(isExcludedPath('/x.md', deepFreeze([])), false);
});

test('an empty entry is ignored, not treated as the root', () => {
  assert.equal(isExcludedPath('/x.md', deepFreeze([''])), false);
});

test('normalizePath', () => {
  assert.equal(normalizePath('Notes//sub/'), '/Notes/sub');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('/a/./b'), null);
  assert.equal(normalizePath('/a/../b'), null);
});
