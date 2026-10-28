'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { DEFAULT_LIMITS, checkPackageLimits, xmlIsSafe } = require('../formats/docx/limits');

// recursive freeze so any mutation of an input throws (R28)
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

const e = (name, compressedSize, uncompressedSize) => ({ name, compressedSize, uncompressedSize });

test('DEFAULT_LIMITS values', () => {
  assert.deepEqual(DEFAULT_LIMITS, { maxEntries: 2000, maxTotalUncompressed: 100 * 1024 * 1024, maxEntryUncompressed: 25 * 1024 * 1024, maxRatio: 100 });
});

test('1. two normal entries are ok', () => {
  const entries = deepFreeze([e('[Content_Types].xml', 300, 1000), e('word/document.xml', 2000, 8000)]);
  assert.deepEqual(checkPackageLimits(entries), { ok: true, problems: [] });
});

test('2. a compression ratio over 100 is reported', () => {
  const entries = deepFreeze([e('word/document.xml', 10 * 1024, 5 * 1024 * 1024)]);
  assert.deepEqual(checkPackageLimits(entries), { ok: false, problems: ['compression ratio: word/document.xml'] });
});

test('3. path traversal and backslash names are bad', () => {
  assert.deepEqual(checkPackageLimits(deepFreeze([e('../evil.xml', 10, 10)])), { ok: false, problems: ['bad name: ../evil.xml'] });
  assert.deepEqual(checkPackageLimits(deepFreeze([e('word\\x.xml', 10, 10)])), { ok: false, problems: ['bad name: word\\x.xml'] });
});

test('4. duplicate names compare case-insensitively and the second is reported', () => {
  const entries = deepFreeze([e('Word/Doc.xml', 10, 10), e('word/doc.xml', 10, 10)]);
  assert.deepEqual(checkPackageLimits(entries), { ok: false, problems: ['duplicate name: word/doc.xml'] });
});

test('5. 2001 entries is too many', () => {
  const entries = deepFreeze(Array.from({ length: 2001 }, (_, i) => e('p' + i + '.xml', 10, 10)));
  const r = checkPackageLimits(entries);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.startsWith('too many entries')));
});

test('6. DOCTYPE and ENTITY are unsafe, plain XML is safe', () => {
  assert.equal(xmlIsSafe('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x/>'), false);
  assert.equal(xmlIsSafe('<w:document/>'), true);
});
