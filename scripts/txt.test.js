'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { runAdapterContract } = require('./format-contract');
const txtAdapter = require('../formats/txt');

// Helper to assert byte equality
function assertBytesEqual(actual, expected, message) {
  assert.ok(actual instanceof Uint8Array, 'result must be Uint8Array');
  assert.equal(
    Buffer.from(actual).toString('hex'),
    Buffer.from(expected).toString('hex'),
    message || 'bytes must match exactly'
  );
}

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

// 1. UTF-8 without BOM (LF)
const bytesUtf8NoBomLf = Buffer.from('First line\nSecond line\nThird line\n', 'utf8');

// 2. UTF-8 with BOM (CRLF)
const bytesUtf8BomCrlf = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from('Alpha\r\nBeta\r\nGamma\r\n', 'utf8')
]);

// 3. CR-only
const bytesCrOnly = Buffer.from('Row 1\rRow 2\rRow 3\r', 'utf8');

// 4. MIXED newlines (LF, CRLF, CR in one file) with final newline
const bytesMixedWithFinal = Buffer.from('Line 1\r\nLine 2\nLine 3\rLine 4\n', 'utf8');

// 5. MIXED newlines with NO final newline
const bytesMixedNoFinal = Buffer.from('Line 1\r\nLine 2\nLine 3\rLine 4', 'utf8');

// 6. No final newline (LF)
const bytesNoFinalLf = Buffer.from('Line A\nLine B', 'utf8');

// 7. UTF-16LE with BOM
const bytesUtf16LeBom = Buffer.concat([
  Buffer.from([0xff, 0xfe]),
  Buffer.from('Hello UTF-16LE\r\nSecond line\r\n', 'utf16le')
]);

// 8. UTF-16BE with BOM
function makeUtf16Be(str) {
  const buf = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16BE(str.charCodeAt(i), i * 2);
  }
  return buf;
}
const bytesUtf16BeBom = Buffer.concat([
  Buffer.from([0xfe, 0xff]),
  makeUtf16Be('Hello UTF-16BE\nSecond line\n')
]);

// 9. Windows-1252 legacy codepage
// 0x93 = “, 0x94 = ”, 0xE9 = é
const bytesWin1252 = Buffer.from([
  0x93, 0x63, 0x61, 0x66, 0xe9, 0x94, 0x0d, 0x0a, // “café”\r\n
  0x73, 0x65, 0x63, 0x6f, 0x6e, 0x64, 0x0a        // second\n
]);

// 10. Ambiguous bytes: non-UTF-8 bytes without BOM
const bytesAmbiguous = Buffer.from([
  0x93, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x94 // “Hello” in win1252, invalid utf-8 lead byte
]);

// 11. Empty file
const bytesEmpty = new Uint8Array(0);

// ---------------------------------------------------------------------------
// FORMAT CONTRACT KIT
// ---------------------------------------------------------------------------
const contractFixtures = [
  { name: 'empty', bytes: bytesEmpty },
  { name: 'utf8-no-bom-lf', bytes: new Uint8Array(bytesUtf8NoBomLf) },
  { name: 'utf8-bom-crlf', bytes: new Uint8Array(bytesUtf8BomCrlf) },
  { name: 'cr-only', bytes: new Uint8Array(bytesCrOnly) },
  { name: 'mixed-no-final', bytes: new Uint8Array(bytesMixedNoFinal) },
  { name: 'utf16le-bom', bytes: new Uint8Array(bytesUtf16LeBom) },
  { name: 'utf16be-bom', bytes: new Uint8Array(bytesUtf16BeBom) },
];

runAdapterContract(test, txtAdapter, contractFixtures);

// ---------------------------------------------------------------------------
// NO-EDIT ROUND TRIP TESTS
// ---------------------------------------------------------------------------
describe('txt adapter: byte-identical no-edit round trips', () => {
  test('UTF-8 without BOM', async () => {
    const opened = await txtAdapter.open(bytesUtf8NoBomLf, 'test.txt');
    assert.equal(opened.meta.encoding, 'utf-8');
    assert.equal(opened.meta.hasBom, false);
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesUtf8NoBomLf);
  });

  test('UTF-8 with BOM (EF BB BF kept)', async () => {
    const opened = await txtAdapter.open(bytesUtf8BomCrlf, 'test.txt');
    assert.equal(opened.meta.encoding, 'utf-8');
    assert.equal(opened.meta.hasBom, true);
    assertBytesEqual(opened.meta.bom, new Uint8Array([0xef, 0xbb, 0xbf]));
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesUtf8BomCrlf);
  });

  test('LF line endings', async () => {
    const opened = await txtAdapter.open(bytesUtf8NoBomLf, 'test.txt');
    assert.deepEqual(opened.meta.lineEndings, ['\n', '\n', '\n']);
    assert.equal(opened.meta.hasFinalNewline, true);
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesUtf8NoBomLf);
  });

  test('CRLF line endings', async () => {
    const opened = await txtAdapter.open(bytesUtf8BomCrlf, 'test.txt');
    assert.deepEqual(opened.meta.lineEndings, ['\r\n', '\r\n', '\r\n']);
    assert.equal(opened.meta.hasFinalNewline, true);
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesUtf8BomCrlf);
  });

  test('CR-only line endings', async () => {
    const opened = await txtAdapter.open(bytesCrOnly, 'test.txt');
    assert.deepEqual(opened.meta.lineEndings, ['\r', '\r', '\r']);
    assert.equal(opened.meta.hasFinalNewline, true);
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesCrOnly);
  });

  test('MIXED line endings (LF, CRLF, CR in one file)', async () => {
    const opened = await txtAdapter.open(bytesMixedWithFinal, 'test.txt');
    assert.deepEqual(opened.meta.lineEndings, ['\r\n', '\n', '\r', '\n']);
    assert.equal(opened.meta.hasFinalNewline, true);
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesMixedWithFinal);
  });

  test('file with no final newline', async () => {
    const opened = await txtAdapter.open(bytesMixedNoFinal, 'test.txt');
    assert.deepEqual(opened.meta.lineEndings, ['\r\n', '\n', '\r', '']);
    assert.equal(opened.meta.hasFinalNewline, false);
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesMixedNoFinal);
  });

  test('UTF-16LE with BOM (FF FE kept)', async () => {
    const opened = await txtAdapter.open(bytesUtf16LeBom, 'test.txt');
    assert.equal(opened.meta.encoding, 'utf-16le');
    assert.equal(opened.meta.hasBom, true);
    assertBytesEqual(opened.meta.bom, new Uint8Array([0xff, 0xfe]));
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesUtf16LeBom);
  });

  test('UTF-16BE with BOM (FE FF kept)', async () => {
    const opened = await txtAdapter.open(bytesUtf16BeBom, 'test.txt');
    assert.equal(opened.meta.encoding, 'utf-16be');
    assert.equal(opened.meta.hasBom, true);
    assertBytesEqual(opened.meta.bom, new Uint8Array([0xfe, 0xff]));
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesUtf16BeBom);
  });

  test('legacy windows-1252 explicitly selected (with 0xE9 and 0x93/0x94)', async () => {
    const opened = await txtAdapter.open(bytesWin1252, 'test.txt', { encoding: 'windows-1252' });
    assert.equal(opened.meta.encoding, 'windows-1252');
    assert.equal(opened.model.text, '“café”\r\nsecond\n');
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesWin1252);
  });
});

// ---------------------------------------------------------------------------
// AMBIGUOUS ENCODING HANDLING
// ---------------------------------------------------------------------------
describe('txt adapter: ambiguous encoding handling', () => {
  test('open() refuses ambiguous file without BOM and not valid UTF-8', async () => {
    await assert.rejects(
      async () => {
        await txtAdapter.open(bytesAmbiguous, 'ambiguous.txt');
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.code, 'AMBIGUOUS_ENCODING');
        assert.equal(err.requiresEncoding, true);
        return true;
      }
    );
  });

  test('scan() reports unsupported ambiguous encoding', async () => {
    const result = await txtAdapter.scan(bytesAmbiguous, 'ambiguous.txt');
    assert.equal(result.supported, false);
    assert.deepEqual(result.unsupported, [{ feature: 'ambiguous encoding', count: 1 }]);
  });

  test('scan() succeeds when encoding is explicitly provided', async () => {
    const result = await txtAdapter.scan(bytesAmbiguous, 'ambiguous.txt', { encoding: 'windows-1252' });
    assert.equal(result.supported, true);
    assert.deepEqual(result.unsupported, []);
  });

  test('open() succeeds when encoding is explicitly selected', async () => {
    const opened = await txtAdapter.open(bytesAmbiguous, 'ambiguous.txt', { encoding: 'windows-1252' });
    assert.equal(opened.meta.encoding, 'windows-1252');
    assert.equal(opened.model.text, '“Hello”');
    const out = await txtAdapter.serialize(opened.model, opened.meta);
    assertBytesEqual(out, bytesAmbiguous);
  });
});

// ---------------------------------------------------------------------------
// LOCALIZED EDITS & UNTOUCHED BYTES PRESERVATION
// ---------------------------------------------------------------------------
describe('txt adapter: localized edits and untouched bytes', () => {
  test('a one-line edit changes only that line bytes and keeps every other ending', async () => {
    // 4 lines with mixed endings:
    // Line 0: "Line 1\r\n" (CRLF)
    // Line 1: "Line 2\n"   (LF)
    // Line 2: "Line 3\r"   (CR)
    // Line 3: "Line 4"     (no final newline)
    const opened = await txtAdapter.open(bytesMixedNoFinal, 'mixed.txt');

    // Edit line 1 ("Line 2" -> "Line 2 Edited")
    opened.model.text = opened.model.text.replace('Line 2', 'Line 2 Edited');

    const out = await txtAdapter.serialize(opened.model, opened.meta);

    // Expected:
    // Line 0: "Line 1\r\n"
    // Line 1: "Line 2 Edited\n"
    // Line 2: "Line 3\r"
    // Line 3: "Line 4"
    const expected = Buffer.from('Line 1\r\nLine 2 Edited\nLine 3\rLine 4', 'utf8');
    assertBytesEqual(out, expected);

    // Verify untouched line 0 bytes:
    assert.equal(Buffer.from(out.subarray(0, 8)).toString('utf8'), 'Line 1\r\n');

    // Verify untouched lines 2 and 3 bytes:
    const endStart = out.length - ('Line 3\rLine 4'.length);
    assert.equal(Buffer.from(out.subarray(endStart)).toString('utf8'), 'Line 3\rLine 4');
  });

  test('editing the first line in a file with UTF-8 BOM keeps the BOM', async () => {
    const opened = await txtAdapter.open(bytesUtf8BomCrlf, 'test.txt');
    opened.model.text = opened.model.text.replace('Alpha', 'AlphaNew');

    const out = await txtAdapter.serialize(opened.model, opened.meta);

    const expected = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('AlphaNew\r\nBeta\r\nGamma\r\n', 'utf8')
    ]);
    assertBytesEqual(out, expected);
  });

  test('editing the last line of a no-final-newline file keeps no final newline', async () => {
    const opened = await txtAdapter.open(bytesNoFinalLf, 'test.txt');
    assert.equal(opened.meta.hasFinalNewline, false);

    opened.model.text = opened.model.text.replace('Line B', 'Line B Edited');

    const out = await txtAdapter.serialize(opened.model, opened.meta);
    const expected = Buffer.from('Line A\nLine B Edited', 'utf8');
    assertBytesEqual(out, expected);
  });

  test('editing a line in UTF-16LE keeps untouched lines and BOM intact', async () => {
    const opened = await txtAdapter.open(bytesUtf16LeBom, 'test.txt');
    opened.model.text = opened.model.text.replace('Hello UTF-16LE', 'Updated UTF-16LE');

    const out = await txtAdapter.serialize(opened.model, opened.meta);

    const expected = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Updated UTF-16LE\r\nSecond line\r\n', 'utf16le')
    ]);
    assertBytesEqual(out, expected);
  });
});

// ---------------------------------------------------------------------------
// UNREPRESENTABLE CHARACTER REJECTION
// ---------------------------------------------------------------------------
describe('txt adapter: unrepresentable character rejection', () => {
  test('serialize refuses unrepresentable character in windows-1252 with offerCopy', async () => {
    const opened = await txtAdapter.open(bytesWin1252, 'test.txt', { encoding: 'windows-1252' });

    // Add a character not in windows-1252, e.g. Snowman U+2603
    opened.model.text = '“café” with \u2603\r\nsecond\n';

    await assert.rejects(
      async () => {
        await txtAdapter.serialize(opened.model, opened.meta);
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.code, 'UNREPRESENTABLE_CHARACTER');
        assert.equal(err.character, '\u2603');
        assert.equal(err.offerCopy, true);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// PROSE TRANSFORMATIONS DISABLED
// ---------------------------------------------------------------------------
describe('txt adapter: document mode settings', () => {
  test('prose transformations are disabled by default', async () => {
    assert.equal(txtAdapter.capabilities.proseTransformations, false);
    const opened = await txtAdapter.open(bytesUtf8NoBomLf, 'test.txt');
    assert.equal(opened.meta.proseTransformations, false);
  });
});
