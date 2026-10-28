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

const { scanRtf } = require('../formats/rtf/scan');
const open = { type: 'open' };
const close = { type: 'close' };
const ctl = (word, param = null) => ({ type: 'control', word, param });
const star = { type: 'symbol', char: '*' };
const txt = (value) => ({ type: 'text', value });

test('1. plain text is supported', () => {
  assert.deepEqual(scanRtf(deepFreeze([open, ctl('rtf', 1), txt('Hi'), close])), { supported: true, unsupported: [] });
});

test('2. a field counts once, its fldinst destination is not counted again', () => {
  // {\rtf1{\field{\*\fldinst HYPERLINK}}}
  const tokens = deepFreeze([open, ctl('rtf', 1), open, ctl('field'), open, star, ctl('fldinst'), txt('HYPERLINK'), close, close, close]);
  assert.deepEqual(scanRtf(tokens), { supported: false, unsupported: [{ feature: 'field', count: 1 }] });
});

test('3. each \\trowd is a table row', () => {
  const tokens = deepFreeze([open, ctl('rtf', 1), ctl('trowd'), txt('a'), ctl('trowd'), txt('b'), close]);
  assert.deepEqual(scanRtf(tokens).unsupported, [{ feature: 'table', count: 2 }]);
});

test('4. an ignorable destination such as generator is fine', () => {
  const tokens = deepFreeze([open, star, ctl('generator'), txt('Word'), close]);
  assert.deepEqual(scanRtf(tokens), { supported: true, unsupported: [] });
});

test('5. an unknown destination is reported', () => {
  const tokens = deepFreeze([open, star, ctl('foo'), txt('x'), close]);
  assert.deepEqual(scanRtf(tokens).unsupported, [{ feature: 'unknown destination', count: 1 }]);
});
