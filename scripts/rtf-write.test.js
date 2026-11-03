'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { readRtf } = require('../formats/rtf/read');
const { writeRtf, RtfWriteRefusedError, rtfAdapter } = require('../formats/rtf/write');
const { contentRevision, atomicReplace } = require('../desktop/atomic-write');
const { runAdapterContract } = require('./format-contract');

const bytes = (source) => Uint8Array.from(source, (char) => char.charCodeAt(0));
const named = (name) => (error) => error.name === name;
const roundTrip = (model) => readRtf(writeRtf(model), 'round-trip.rtf').model;
const outputText = (out) => Buffer.from(out).toString('latin1');
const para = (...runs) => ({ type: 'paragraph', runs });

// recursive freeze so any mutation of a fixture throws (R28)
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

// Braces must balance, and never close before they open. A backslash
// escapes the next character, so \{ and \} do not count.
function bracesBalance(out) {
  let depth = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === '\\') { i += 1; continue; }
    if (out[i] === '{') depth += 1;
    else if (out[i] === '}') { depth -= 1; if (depth < 0) return false; }
  }
  return depth === 0;
}

const NESTED = String.raw`{\rtf1 A{\b B{\i C{\ul D}E}F}G\b\i\ul H\b0 I\i0 J\ulnone K\b\plain L}`;
const UNICODE = String.raw`{\rtf1\uc1\u233\'e9 {\uc2㡣4ab}荤? \u123\{ \u-10179?\u-8704?}`;
const LEGACY = String.raw`{\rtf1\ansi\ansicpg1251\'cf\'f0\'e8\'e2\'e5\'f2}`;

const fixtures = deepFreeze([
  { name: 'hello.rtf', bytes: bytes('{\\rtf1 Hi}') },
  { name: 'nested.rtf', bytes: bytes(NESTED) },
  { name: 'unicode.rtf', bytes: bytes(UNICODE) },
  { name: 'legacy.rtf', bytes: bytes(LEGACY) },
  { name: 'padded.rtf', bytes: bytes('{\\rtf1\r\n one\\par\r\ntwo}\u0000\u001a') },
]);

runAdapterContract(test, rtfAdapter, fixtures);

test('RTF writer: output is ASCII RTF 1 with balanced braces and a scanner-clean report', () => {
  const models = [
    { type: 'document', blocks: [para({ text: 'plain' })] },
    { type: 'document', blocks: [para({ text: 'é 雪 😀 {x}\\', b: true, i: true, u: true })] },
    readRtf(bytes(NESTED)).model,
    { type: 'document', blocks: [] },
  ];
  for (const model of models) {
    const out = writeRtf(model);
    const text = outputText(out);
    assert.ok(text.startsWith('{\\rtf1'), 'output starts with {\\rtf1');
    assert.ok([...text].every((ch) => ch.charCodeAt(0) < 0x80), 'output is ASCII only');
    assert.ok(bracesBalance(text), 'braces balance');
    assert.deepEqual(rtfAdapter.scan(out, 'out.rtf'), { supported: true, unsupported: [] });
  }
});

test('RTF writer: nested formatting survives a round trip from reader output', () => {
  const opened = readRtf(bytes(NESTED));
  assert.deepEqual(roundTrip(opened.model), opened.model);
});

test('RTF writer: escaped braces, backslashes, tabs, line breaks and empty paragraphs round trip', () => {
  const model = { type: 'document', blocks: [
    para({ text: 'a{b}\\c' }),
    para(),
    para({ text: 'x\ty\nz', b: true }),
    para({ text: 'bold ', b: true }, { text: ' both', b: true, i: true, u: true }),
    para({ text: '\\' }, { text: '}', i: true }),
  ] };
  assert.deepEqual(roundTrip(model), model);
  assert.ok(outputText(writeRtf(model)).includes('a\\{b\\}\\\\c'));
});

test('RTF writer: Unicode, controls and surrogate pairs round trip with signed 16-bit escapes', () => {
  const model = { type: 'document', blocks: [para({ text: 'café 雪€ 😀 \u0001\u007f\r ‑' })] };
  assert.deepEqual(roundTrip(model), model);
  const out = outputText(writeRtf(model));
  assert.ok(out.includes('\\u8364?'), 'the euro sign is a positive escape');
  assert.ok(outputText(writeRtf({ type: 'document', blocks: [para({ text: '＀' })] })).includes('\\u-256?'));
  assert.ok(outputText(writeRtf({ type: 'document', blocks: [para({ text: '😀' })] })).includes('\\u-10179?\\u-8704?'));
});

test('RTF writer: legacy codepage text round trips through the reader’s codepage rules', () => {
  const opened = readRtf(bytes(LEGACY));
  assert.equal(opened.model.blocks[0].runs[0].text, 'Привет');
  assert.deepEqual(roundTrip(opened.model), opened.model);
  const cp1252 = readRtf(bytes(String.raw`{\rtf1\'80\'93Hi\'94}`));
  assert.equal(cp1252.model.blocks[0].runs[0].text, '€“Hi”');
  assert.deepEqual(roundTrip(cp1252.model), cp1252.model);
  assert.ok(outputText(writeRtf(cp1252.model)).includes('\\u8364?'));
});

test('RTF writer: an empty document reads back as the reader’s one empty paragraph; false marks are absent', () => {
  assert.deepEqual(roundTrip({ type: 'document', blocks: [] }).blocks, [para()]);
  assert.deepEqual(roundTrip({ type: 'document', blocks: [para({ text: 'x', b: false })] }).blocks,
    [para({ text: 'x' })]);
});

test('RTF writer: a model it cannot represent is refused, never silently reduced', () => {
  const refusals = {
    'unknown run key': { type: 'document', blocks: [para({ text: 'x', color: 'red' })] },
    'unknown paragraph key': { type: 'document', blocks: [{ type: 'paragraph', runs: [], align: 'center' }] },
    'unknown document key': { type: 'document', blocks: [], comments: [] },
    'non-paragraph block': { type: 'document', blocks: [{ type: 'table', runs: [] }] },
    'document type': { type: 'sheet', blocks: [] },
    'mark not boolean': { type: 'document', blocks: [para({ text: 'x', b: 'yes' })] },
    'text not a string': { type: 'document', blocks: [para({ text: 5 })] },
    'run not an object': { type: 'document', blocks: [para(null)] },
    'lone high surrogate': { type: 'document', blocks: [para({ text: 'a\ud83d' })] },
    'lone low surrogate': { type: 'document', blocks: [para({ text: '\ude00b' })] },
  };
  for (const [label, model] of Object.entries(refusals)) {
    assert.throws(() => writeRtf(model), named('RtfWriteRefusedError'), label);
    assert.throws(() => rtfAdapter.serialize(model, {}), named('RtfWriteRefusedError'), label);
  }
  assert.ok(new RtfWriteRefusedError('x') instanceof Error);
});

test('RTF writer: unchanged models save the original bytes; edits from a source with unsupported features are refused', () => {
  const original = bytes('{\\rtf1 Body{\\header Head}}');
  const opened = rtfAdapter.open(original, 'draft.rtf');
  assert.deepEqual(rtfAdapter.serialize(opened.model, opened.meta), original);
  const edited = structuredClone(opened.model);
  edited.blocks[0].runs[0].text = 'Edited';
  assert.throws(() => rtfAdapter.serialize(edited, opened.meta), (error) =>
    error.name === 'RtfWriteRefusedError' && /header or footer/.test(error.message));
});

test('RTF writer: a refused save leaves the file untouched; a clean save replaces it through the atomic helper', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rtf-write-'));
  try {
    const lossy = path.join(dir, 'lossy.rtf');
    const original = bytes('{\\rtf1 Body{\\header Head}}');
    await fsp.writeFile(lossy, original);
    const opened = rtfAdapter.open(original, 'lossy.rtf');
    const edited = structuredClone(opened.model);
    edited.blocks[0].runs[0].text = 'Edited';
    let refusal = null;
    try {
      // A refused serialize means no write is attempted, so the file stays as it was.
      const out = rtfAdapter.serialize(edited, opened.meta);
      await atomicReplace({ fs: fsp, path: lossy, bytes: out, expectedRevision: contentRevision(original) });
    } catch (error) { refusal = error; }
    assert.equal(refusal?.name, 'RtfWriteRefusedError');
    assert.deepEqual(new Uint8Array(await fsp.readFile(lossy)), original);

    const clean = path.join(dir, 'clean.rtf');
    const cleanOriginal = bytes('{\\rtf1 Body}');
    await fsp.writeFile(clean, cleanOriginal);
    const cleanOpened = rtfAdapter.open(cleanOriginal, 'clean.rtf');
    const cleanEdit = structuredClone(cleanOpened.model);
    cleanEdit.blocks[0].runs[0].text = 'Edited';
    const out = rtfAdapter.serialize(cleanEdit, cleanOpened.meta);
    await atomicReplace({ fs: fsp, path: clean, bytes: out, expectedRevision: contentRevision(cleanOriginal) });
    assert.deepEqual(readRtf(new Uint8Array(await fsp.readFile(clean))).model, cleanEdit);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('RTF writer: malformed input is reported unsupported by the adapter scan and refused by open', () => {
  for (const source of ['{\\rtf1 x', 'plain text', '{\\rtf1 x}}']) {
    const report = rtfAdapter.scan(bytes(source), 'bad.rtf');
    assert.equal(report.supported, false);
    assert.equal(report.unsupported.length, 1);
    assert.match(report.unsupported[0].feature, /^unreadable RTF \(RtfSyntaxError\)$/);
    assert.throws(() => rtfAdapter.open(bytes(source), 'bad.rtf'), named('RtfSyntaxError'));
  }
});

test('RTF writer runs as a classic browser script beside the reader', () => {
  const sandbox = vm.createContext({ Uint8Array, TextDecoder });
  const dir = path.join(__dirname, '../formats/rtf');
  for (const file of ['tokenize', 'scan', 'read', 'write']) {
    vm.runInContext(fs.readFileSync(path.join(dir, file + '.js'), 'utf8'), sandbox);
  }
  const model = { type: 'document', blocks: [para({ text: 'Привет', b: true }, { text: ' €' })] };
  const browserOut = sandbox.NeoCraft_RtfWrite.writeRtf(model);
  assert.deepEqual(Buffer.from(browserOut), Buffer.from(writeRtf(model)));
  // Objects from the vm context have another Object prototype, so compare their JSON.
  assert.equal(JSON.stringify(sandbox.NeoCraft_RtfRead.readRtf(browserOut).model), JSON.stringify(model));
});
