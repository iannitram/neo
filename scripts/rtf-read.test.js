'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readRtf } = require('../formats/rtf/read');
const bytes = (source) => Uint8Array.from(source, (char) => char.charCodeAt(0));
const read = (source, options) => readRtf(bytes(source), 'fixture.rtf', options);
const text = (opened) => opened.model.blocks.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
const named = (name) => (error) => error.name === name;

test('RTF open contract matches the DOCX model and owns original bytes, including Buffer input', async () => {
  for (const input of [bytes('{\\rtf1 Hi}'), Buffer.from('{\\rtf1 Hi}')]) {
    const original = Uint8Array.from(input);
    const opened = await readRtf(input, 'draft.rtf');
    assert.deepEqual(opened.model, { type: 'document', blocks: [{ type: 'paragraph', runs: [{ text: 'Hi' }] }] });
    assert.equal(opened.meta.name, 'draft.rtf');
    input.fill(0);
    assert.ok(opened.meta.originalBytes instanceof Uint8Array);
    assert.deepEqual(opened.meta.originalBytes, original);
    assert.deepEqual(opened.meta.fidelity, { supported: true, unsupported: [] });
  }
  assert.throws(() => readRtf('RTF'), TypeError);
});

test('nested formatting restores marks, explicit resets and plain restore defaults', () => {
  const opened = read(String.raw`{\rtf1 A{\b B{\i C{\ul D}E}F}G\b\i\ul H\b0 I\i0 J\ulnone K\b\plain L}`);
  assert.deepEqual(opened.model.blocks[0].runs, [
    { text: 'A' }, { text: 'B', b: true }, { text: 'C', b: true, i: true },
    { text: 'D', b: true, i: true, u: true }, { text: 'E', b: true, i: true },
    { text: 'F', b: true }, { text: 'G' }, { text: 'H', b: true, i: true, u: true },
    { text: 'I', i: true, u: true }, { text: 'J', u: true }, { text: 'KL' },
  ]);
  assert.deepEqual(read(String.raw`{\rtf1\ul X\ul0 Y}`).model.blocks[0].runs, [{ text: 'X', u: true }, { text: 'Y' }]);
});

test('paragraphs, empty paragraphs, whitespace, escaped braces and character controls', () => {
  assert.equal(text(read('{\\rtf1\r\n  a\\{b\\}\\\\c\\tab d\\line e\\par\\par last\\par}')), '  a{b}\\c\td\ne\n\nlast');
  assert.deepEqual(read('{\\rtf1}').model.blocks, [{ type: 'paragraph', runs: [] }]);
  assert.equal(text(read(String.raw`{\rtf1\~\-\_\emdash\endash\bullet\lquote\rquote\ldblquote\rdblquote}`)), '\u00a0\u00ad\u2011—–•‘’“”');
  assert.equal(text(read(String.raw`{\rtf1\constructor\unknown Hi}`)), 'Hi');
});

test('Unicode fallback handles hex, scoped uc, escaped braces and signed surrogate pairs', () => {
  assert.equal(text(read(String.raw`{\rtf1\uc1\u233\'e9 {\uc2\u38634ab}\u8364? \u123\{ \u-10179?\u-8704?}`)), 'é 雪€ { 😀');
  assert.equal(text(read(String.raw`{\rtf1\uc0\u233!}`)), 'é!');
  assert.equal(text(read(String.raw`{\rtf1{\u233}tail}`)), 'étail');
  assert.equal(text(read(String.raw`{\rtf1\uc1\u233\emdash tail}`)), 'étail');
  assert.equal(text(read('{\\rtf1\\u233\r\n?}')), 'é');
  assert.throws(() => read(String.raw`{\rtf1\u233\'zz}`), named('RtfSyntaxError'));
});

test('ansicpg decodes raw bytes and hex bytes together, including multibyte codepages', () => {
  assert.equal(text(read("{\\rtf1\\ansi\\ansicpg1251 \\'cf\\'f0\\'e8\\'e2\\'e5\\'f2}")), 'Привет');
  assert.equal(text(read("{\\rtf1 caf\xe9 \\'80}")), 'café €');
  assert.equal(text(read("{\\rtf1\\ansicpg932 \\'82\xa0\\'82\\'a2}")), 'あい');
  assert.equal(text(read(String.raw`{\rtf1\ansicpg1252{\ansicpg1251\'cf}\'e9}`)), 'Пé');
});

test('Windows-1252 punctuation is identical for raw and hex bytes, default and explicit encodings', () => {
  const raw = String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 0x80 + i));
  const hex = Array.from({ length: 32 }, (_, i) => "\\'" + (0x80 + i).toString(16)).join('');
  const expected = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
  for (const header of ['\\rtf1 ', '\\rtf1\\ansicpg1252 ',
    '\\rtf1\\ansicpg1251\\deff0{\\fonttbl{\\f0\\cpg1252 Font;}}']) {
    for (const input of [raw, hex]) assert.equal(text(read('{' + header + input + '}')), expected);
  }
  // C1 Unicode characters in another encoding must not become punctuation.
  assert.equal(text(read(String.raw`{\rtf1\ansicpg65001\'c2\'80}`)), '\u0080');
});

test('font table names stay out of text; default, selected and scoped font encodings apply', () => {
  const opened = read(String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fnil\fcharset204 Cyrillic;}{\f1\froman\fcharset0 Caf\'e9;}{\f2\cpg932 Japanese;}}\'cf{\f1\'e9}\'f0\f2\'82\'a0\plain\'e8}`);
  assert.equal(text(opened), 'Пéрあи');
  assert.deepEqual(opened.meta.fonts, [
    { id: 0, name: 'Cyrillic', charset: 204 },
    { id: 1, name: 'Café', charset: 0 }, { id: 2, name: 'Japanese', codepage: 932 },
  ]);
  assert.deepEqual(read(String.raw`{\rtf1{\fonttbl\f0 One;\f1 Two;}Body}`).meta.fonts,
    [{ id: 0, name: 'One' }, { id: 1, name: 'Two' }]);
  assert.equal(text(read(String.raw`{\rtf1{\fonttbl{\f0\fcharset2 Symbol;}}Body}`)), 'Body');
});

test('destinations never leak into body text and scanner report is retained', () => {
  const opened = read(String.raw`{\rtf1{\colortbl;\red255;}{\stylesheet{\s0 Normal;}}{\info{\title Secret}}{\*\generator Tool;}A{\*\unknown hidden{nested}}B{\header Head}{\field{\*\fldinst CODE}{\fldrslt Result}}{\pict 1234}}`);
  assert.equal(text(opened), 'AB');
  assert.deepEqual(opened.meta.fidelity, { supported: false, unsupported: [
    { feature: 'field', count: 1 }, { feature: 'header or footer', count: 1 },
    { feature: 'image', count: 1 }, { feature: 'unknown destination', count: 1 },
  ] });
});

test('reader enforces default and custom limits, even in skipped destinations', () => {
  assert.throws(() => read('{\\rtf1 abc}', { limits: { maxLength: 5 } }), named('RtfLimitError'));
  assert.throws(() => read('{\\rtf1{\\*\\skip{{x}}}}', { limits: { maxDepth: 3 } }), named('RtfLimitError'));
  assert.throws(() => read('{\\rtf1' + '{'.repeat(100) + '}'.repeat(101)), named('RtfLimitError'));
  assert.throws(() => readRtf(new Uint8Array(20 * 1024 * 1024 + 1)), named('RtfLimitError'));
  for (const value of [NaN, Infinity, -1, 1.5, undefined]) {
    assert.throws(() => read('{\\rtf1}', { limits: { maxLength: value } }), TypeError);
  }
});

test('malformed documents and unsupported or invalid encodings fail explicitly', () => {
  for (const source of ['', 'plain', '{\\rtf2 x}', '{\\rtf1', '{\\rtf1}}', '{\\rtf1}{\\rtf1}', '{\\rtf1}tail', '{\\rtf1\\u99999?}']) {
    assert.throws(() => read(source), named('RtfSyntaxError'));
  }
  for (const source of [String.raw`{\rtf1\ansicpg99999 x}`, String.raw`{\rtf1\ansicpg932\'82}`, String.raw`{\rtf1{\fonttbl{\f0\fcharset2 Symbol;}}\f0 x}`]) {
    assert.throws(() => read(source), named('RtfEncodingError'));
  }
});

test('NUL, DOS end-of-file and whitespace padding after the last group is ignored', () => {
  for (const pad of ['\u0000', '\u0000\u0000', '\u001a', '\r\n \u0000\u001a']) {
    assert.deepEqual(read('{\\rtf1 hi}' + pad).model.blocks[0].runs, [{ text: 'hi' }]);
  }
  assert.throws(() => read('{\\rtf1 hi}\u0000x'), named('RtfSyntaxError'));
});

test('reader runs as classic browser scripts without Node or Buffer', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const sandbox = vm.createContext({ Uint8Array, TextDecoder });
  for (const file of ['tokenize', 'scan', 'read']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../formats/rtf', file + '.js'), 'utf8'), sandbox);
  }
  assert.equal(text(sandbox.NeoCraft_RtfRead.readRtf(bytes(String.raw`{\rtf1\ansicpg1251\'cf}`))), 'П');
  assert.equal(text(sandbox.NeoCraft_RtfRead.readRtf(bytes(String.raw`{\rtf1\'80\'93Hi\'94}`))), '€“Hi”');
});
