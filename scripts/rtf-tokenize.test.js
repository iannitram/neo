'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { tokenize } = require('../formats/rtf/tokenize');

const open = { type: 'open' };
const close = { type: 'close' };
const ctl = (word, param = null) => ({ type: 'control', word, param });
const named = (name) => (e) => e instanceof Error && e.name === name;

test('1. a control word with a number, the space is consumed', () => {
  assert.deepEqual(tokenize('{\\rtf1 Hi}'), [open, ctl('rtf', 1), { type: 'text', value: 'Hi' }, close]);
});

test('2. escaped braces are literal text', () => {
  assert.deepEqual(tokenize('{a\\{b\\}}'), [open, { type: 'text', value: 'a{b}' }, close]);
});

test('3. \\\'hh is a hex byte', () => {
  assert.deepEqual(tokenize("{\\'e9}"), [open, { type: 'hex', byte: 0xe9 }, close]);
});

test('4. \\uN skips one fallback character', () => {
  assert.deepEqual(tokenize('{\\u8364?}'), [open, { type: 'unicode', code: 8364 }, close]);
});

test('5. \\ucK sets how many fallback characters are skipped', () => {
  assert.deepEqual(tokenize('{\\uc2\\u8364ab c}'), [open, ctl('uc', 2), { type: 'unicode', code: 8364 }, { type: 'text', value: ' c' }, close]);
});

test('6. a negative parameter', () => {
  assert.deepEqual(tokenize('{\\b-1 x}'), [open, ctl('b', -1), { type: 'text', value: 'x' }, close]);
});

test('7. unbalanced braces and too-deep nesting', () => {
  assert.throws(() => tokenize('{{'), named('RtfSyntaxError'));
  assert.throws(() => tokenize('{'.repeat(101) + '}'.repeat(101)), named('RtfLimitError'));
});

test('text longer than maxLength is a limit error', () => {
  assert.throws(() => tokenize('{abc}', { maxLength: 4 }), named('RtfLimitError'));
});
