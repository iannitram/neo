'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { applySpanEdits } = require('../formats/span-patch');

// recursive freeze so any mutation of an input throws (R28)
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

test('1. one replacement', () => {
  assert.equal(applySpanEdits('abcdef', deepFreeze([{ start: 2, end: 4, text: 'XY' }])), 'abXYef');
});

test('2. edits in any order', () => {
  assert.equal(applySpanEdits('abcdef', deepFreeze([{ start: 4, end: 6, text: '' }, { start: 0, end: 1, text: 'Z' }])), 'Zbcd');
});

test('3. an insert', () => {
  assert.equal(applySpanEdits('abcdef', deepFreeze([{ start: 3, end: 3, text: '-' }])), 'abc-def');
});

test('4. no edits returns the same string', () => {
  const s = 'abcdef';
  assert.ok(applySpanEdits(s, deepFreeze([])) === s);
});

test('5. overlapping edits throw RangeError overlap', () => {
  assert.throws(
    () => applySpanEdits('abcdef', deepFreeze([{ start: 0, end: 3, text: 'x' }, { start: 2, end: 5, text: 'y' }])),
    (e) => e instanceof RangeError && e.message === 'overlap');
});

test('6. CRLF and emoji in untouched parts survive', () => {
  const s = 'a\r\nb \u{1F600} c\r\nd';
  const i = s.indexOf('c');
  assert.equal(applySpanEdits(s, deepFreeze([{ start: i, end: i + 1, text: 'C' }])), 'a\r\nb \u{1F600} C\r\nd');
});

test('out of range or start > end throws RangeError', () => {
  assert.throws(() => applySpanEdits('abc', deepFreeze([{ start: 0, end: 4, text: '' }])), RangeError);
  assert.throws(() => applySpanEdits('abc', deepFreeze([{ start: -1, end: 1, text: '' }])), RangeError);
  assert.throws(() => applySpanEdits('abc', deepFreeze([{ start: 2, end: 1, text: '' }])), RangeError);
});

test('touching ends are allowed and inserts at one index apply in array order', () => {
  assert.equal(applySpanEdits('abcd', deepFreeze([{ start: 0, end: 2, text: 'X' }, { start: 2, end: 4, text: 'Y' }])), 'XY');
  assert.equal(applySpanEdits('abc', deepFreeze([{ start: 1, end: 1, text: '1' }, { start: 1, end: 1, text: '2' }])), 'a12bc');
});
