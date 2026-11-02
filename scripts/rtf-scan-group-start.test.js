'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { scanRtf } = require('../formats/rtf/scan');
const open = { type: 'open' };
const close = { type: 'close' };
const ctl = (word, param = null) => ({ type: 'control', word, param });
const star = { type: 'symbol', char: '*' };
const txt = (value) => ({ type: 'text', value });

test('a * that does not open a group is not an unknown destination', () => {
  // {\rtf1 Hi \*\foo x}: the star is not the first token of a group
  const tokens = [open, ctl('rtf', 1), txt('Hi '), star, ctl('foo'), txt('x'), close];
  assert.deepEqual(scanRtf(tokens), { supported: true, unsupported: [] });
});

test('a * that opens a group with an unknown word is reported', () => {
  // {\rtf1 {\*\foo x}}
  const tokens = [open, ctl('rtf', 1), open, star, ctl('foo'), txt('x'), close, close];
  assert.deepEqual(scanRtf(tokens).unsupported, [{ feature: 'unknown destination', count: 1 }]);
});
