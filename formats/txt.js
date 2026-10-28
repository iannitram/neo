'use strict';

// TXT FORMAT ADAPTER: read, scan, and serialize plain text documents
// without silently changing encoding, BOM, line endings, or untouched bytes.
//
// Conforms to the NeoCraft format adapter contract:
// - adapter.id: 'txt'
// - adapter.open(bytes, name, options) -> { model, meta }
// - adapter.serialize(model, meta) -> Uint8Array
// - adapter.scan(bytes, name, options) -> { supported, unsupported }
//
// Classic script that runs in Node (CommonJS) and browser environments.

(function (root) {
  'use strict';

  class AmbiguousEncodingError extends Error {
    constructor(message = 'Ambiguous encoding: file is not valid UTF-8 and lacks a BOM') {
      super(message);
      this.name = 'AmbiguousEncodingError';
      this.code = 'AMBIGUOUS_ENCODING';
      this.requiresEncoding = true;
    }
  }

  class UnrepresentableCharacterError extends Error {
    constructor(char, codePoint, encoding) {
      const hex = Number(codePoint).toString(16).toUpperCase().padStart(4, '0');
      super(`Character '${char}' (U+${hex}) cannot be represented in ${encoding}`);
      this.name = 'UnrepresentableCharacterError';
      this.code = 'UNREPRESENTABLE_CHARACTER';
      this.character = char;
      this.codePoint = codePoint;
      this.encoding = encoding;
      this.offerCopy = true;
    }
  }

  // Windows-1252 reverse code map
  const WIN1252_REVERSE = new Map();
  for (let b = 0; b <= 0x7f; b++) {
    WIN1252_REVERSE.set(b, b);
  }
  try {
    const win1252Dec = new TextDecoder('windows-1252');
    for (let b = 0x80; b <= 0xff; b++) {
      if ([0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(b)) continue;
      const char = win1252Dec.decode(new Uint8Array([b]));
      WIN1252_REVERSE.set(char.charCodeAt(0), b);
    }
  } catch {
    // Fallback static map if TextDecoder doesn't support windows-1252
    const win1252Extra = [
      [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
      [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
      [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
      [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
      [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
      [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
      [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]
    ];
    for (const [code, byte] of win1252Extra) {
      WIN1252_REVERSE.set(code, byte);
    }
    for (let b = 0xa0; b <= 0xff; b++) {
      WIN1252_REVERSE.set(b, b);
    }
  }

  function normalizeEncodingName(name) {
    if (!name || typeof name !== 'string') return null;
    const lower = name.trim().toLowerCase();
    if (lower === 'utf-8' || lower === 'utf8') return 'utf-8';
    if (lower === 'utf-16le' || lower === 'utf16le') return 'utf-16le';
    if (lower === 'utf-16be' || lower === 'utf16be') return 'utf-16be';
    if (lower === 'windows-1252' || lower === 'cp1252' || lower === 'win1252' || lower === 'ansi') {
      return 'windows-1252';
    }
    return lower;
  }

  function toUint8Array(input) {
    if (!input) return new Uint8Array(0);
    if (input instanceof Uint8Array) {
      return input;
    }
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    }
    return new Uint8Array(0);
  }

  function parseLinesAndEndings(text) {
    if (text.length === 0) {
      return {
        lines: [],
        lineEndings: [],
        hasFinalNewline: false,
        defaultNewline: '\n'
      };
    }

    const lines = [];
    const lineEndings = [];
    const counts = { '\n': 0, '\r\n': 0, '\r': 0 };

    let start = 0;
    let i = 0;
    const len = text.length;

    while (i < len) {
      const ch = text[i];
      if (ch === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          lines.push(text.slice(start, i));
          lineEndings.push('\r\n');
          counts['\r\n']++;
          i += 2;
          start = i;
        } else {
          lines.push(text.slice(start, i));
          lineEndings.push('\r');
          counts['\r']++;
          i += 1;
          start = i;
        }
      } else if (ch === '\n') {
        lines.push(text.slice(start, i));
        lineEndings.push('\n');
        counts['\n']++;
        i += 1;
        start = i;
      } else {
        i++;
      }
    }

    let hasFinalNewline = true;
    if (start < len) {
      lines.push(text.slice(start, len));
      lineEndings.push('');
      hasFinalNewline = false;
    } else {
      hasFinalNewline = true;
    }

    let defaultNewline = '\n';
    let maxCount = 0;
    for (const [nl, c] of Object.entries(counts)) {
      if (c > maxCount) {
        maxCount = c;
        defaultNewline = nl;
      }
    }

    return {
      lines,
      lineEndings,
      hasFinalNewline,
      defaultNewline
    };
  }

  function computeLineByteRanges(bomLength, lines, lineEndings, encoding) {
    const ranges = [];
    let offset = bomLength;

    for (let i = 0; i < lines.length; i++) {
      const lineStr = lines[i];
      const endingStr = lineEndings[i];

      let contentByteLen;
      let endingByteLen;

      if (encoding === 'utf-16le' || encoding === 'utf-16be') {
        contentByteLen = lineStr.length * 2;
        endingByteLen = endingStr.length * 2;
      } else if (encoding === 'windows-1252') {
        contentByteLen = lineStr.length;
        endingByteLen = endingStr.length;
      } else {
        contentByteLen = new TextEncoder().encode(lineStr).length;
        endingByteLen = new TextEncoder().encode(endingStr).length;
      }

      const start = offset;
      const contentEnd = start + contentByteLen;
      const end = contentEnd + endingByteLen;

      ranges.push({ start, contentEnd, end });
      offset = end;
    }

    return ranges;
  }

  function encodeText(text, encoding) {
    switch (encoding) {
      case 'utf-8':
        return new TextEncoder().encode(text);
      case 'utf-16le': {
        const buf = new Uint8Array(text.length * 2);
        for (let i = 0; i < text.length; i++) {
          const code = text.charCodeAt(i);
          buf[i * 2] = code & 0xff;
          buf[i * 2 + 1] = (code >> 8) & 0xff;
        }
        return buf;
      }
      case 'utf-16be': {
        const buf = new Uint8Array(text.length * 2);
        for (let i = 0; i < text.length; i++) {
          const code = text.charCodeAt(i);
          buf[i * 2] = (code >> 8) & 0xff;
          buf[i * 2 + 1] = code & 0xff;
        }
        return buf;
      }
      case 'windows-1252': {
        const buf = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) {
          const code = text.charCodeAt(i);
          const b = WIN1252_REVERSE.get(code);
          if (b === undefined) {
            throw new UnrepresentableCharacterError(text[i], code, encoding);
          }
          buf[i] = b;
        }
        return buf;
      }
      default:
        throw new RangeError(`Unsupported encoding: ${encoding}`);
    }
  }

  function concatUint8Arrays(arrays) {
    let totalLen = 0;
    for (const a of arrays) totalLen += a.length;
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const a of arrays) {
      out.set(a, pos);
      pos += a.length;
    }
    return out;
  }

  function detectAndDecode(rawBytes, options = {}) {
    const bytes = toUint8Array(rawBytes);
    const explicit = normalizeEncodingName(options.encoding);

    if (explicit) {
      let hasBom = false;
      let bom = new Uint8Array(0);
      let contentBytes = bytes;

      if (explicit === 'utf-8' && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        hasBom = true;
        bom = bytes.subarray(0, 3);
        contentBytes = bytes.subarray(3);
      } else if (explicit === 'utf-16le' && bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        hasBom = true;
        bom = bytes.subarray(0, 2);
        contentBytes = bytes.subarray(2);
      } else if (explicit === 'utf-16be' && bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        hasBom = true;
        bom = bytes.subarray(0, 2);
        contentBytes = bytes.subarray(2);
      }

      let text;
      try {
        text = new TextDecoder(explicit, { fatal: true }).decode(contentBytes);
      } catch (err) {
        throw new TypeError(`Failed to decode as ${explicit}: ${err.message}`);
      }

      return {
        encoding: explicit,
        hasBom,
        bom,
        contentBytes,
        text
      };
    }

    // Auto-detect from BOM or UTF-8 validation
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      const bom = bytes.subarray(0, 3);
      const contentBytes = bytes.subarray(3);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes);
      return {
        encoding: 'utf-8',
        hasBom: true,
        bom,
        contentBytes,
        text
      };
    }

    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      const bom = bytes.subarray(0, 2);
      const contentBytes = bytes.subarray(2);
      const text = new TextDecoder('utf-16le', { fatal: true }).decode(contentBytes);
      return {
        encoding: 'utf-16le',
        hasBom: true,
        bom,
        contentBytes,
        text
      };
    }

    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      const bom = bytes.subarray(0, 2);
      const contentBytes = bytes.subarray(2);
      const text = new TextDecoder('utf-16be', { fatal: true }).decode(contentBytes);
      return {
        encoding: 'utf-16be',
        hasBom: true,
        bom,
        contentBytes,
        text
      };
    }

    // No BOM: test for valid UTF-8
    let text;
    let isUtf8 = true;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      isUtf8 = false;
    }

    if (isUtf8) {
      return {
        encoding: 'utf-8',
        hasBom: false,
        bom: new Uint8Array(0),
        contentBytes: bytes,
        text
      };
    }

    // Non-UTF-8 without BOM: Ambiguous encoding
    if (options.allowAmbiguous) {
      return {
        status: 'ambiguous_encoding',
        requiresEncoding: true,
        encoding: null,
        hasBom: false,
        bom: new Uint8Array(0),
        contentBytes: bytes,
        text: null
      };
    }

    throw new AmbiguousEncodingError();
  }

  function open(bytes, nameOrOptions, maybeOptions) {
    const options = (typeof nameOrOptions === 'object' && nameOrOptions !== null)
      ? nameOrOptions
      : (maybeOptions || {});

    const rawBytes = toUint8Array(bytes);
    const decoded = detectAndDecode(rawBytes, options);

    if (decoded.status === 'ambiguous_encoding') {
      return {
        status: 'ambiguous_encoding',
        requiresEncoding: true,
        model: null,
        meta: {
          encoding: null,
          requiresEncoding: true
        }
      };
    }

    const { encoding, hasBom, bom, text } = decoded;
    const parsed = parseLinesAndEndings(text);
    const lineByteRanges = computeLineByteRanges(bom.length, parsed.lines, parsed.lineEndings, encoding);

    const meta = {
      encoding,
      hasBom,
      bom: new Uint8Array(bom),
      lineEndings: [...parsed.lineEndings],
      hasFinalNewline: parsed.hasFinalNewline,
      defaultNewline: parsed.defaultNewline,
      originalBytes: new Uint8Array(rawBytes),
      originalText: text,
      originalLines: [...parsed.lines],
      lineByteRanges,
      proseTransformations: false
    };

    const model = {
      text,
      lines: [...parsed.lines]
    };

    return { model, meta };
  }

  function serialize(model, meta = {}) {
    const origBytes = meta.originalBytes ? toUint8Array(meta.originalBytes) : null;
    const origLines = Array.isArray(meta.originalLines) ? meta.originalLines : null;
    const origText = typeof meta.originalText === 'string' ? meta.originalText : null;
    const origRanges = Array.isArray(meta.lineByteRanges) ? meta.lineByteRanges : null;
    const origEndings = Array.isArray(meta.lineEndings) ? meta.lineEndings : null;
    const encoding = normalizeEncodingName(meta.encoding) || 'utf-8';
    const bom = meta.bom ? toUint8Array(meta.bom) : (meta.hasBom ? encodeBom(encoding) : new Uint8Array(0));

    // Determine current text / lines from model
    let currentText = null;
    let currentLines = null;
    let currentDelims = null;

    if (typeof model === 'string') {
      currentText = model;
    } else if (model && typeof model.text === 'string') {
      currentText = model.text;
      if (Array.isArray(model.lines)) {
        const linesChanged =
          !origLines ||
          model.lines.length !== origLines.length ||
          model.lines.some((l, idx) => l !== origLines[idx]);
        if (linesChanged && currentText === origText) {
          currentLines = model.lines;
          currentText = null;
        }
      }
    } else if (model && Array.isArray(model.lines)) {
      currentLines = model.lines;
    } else {
      currentText = '';
    }

    // Fast path: no edits made
    if (origBytes && origText !== null && currentText === origText) {
      return new Uint8Array(origBytes);
    }

    if (currentText !== null) {
      const parsed = parseLinesAndEndings(currentText);
      currentLines = parsed.lines;
      currentDelims = parsed.lineEndings;
    } else if (currentLines) {
      // Reconstructed from lines array
      currentDelims = [];
      for (let i = 0; i < currentLines.length; i++) {
        if (i === currentLines.length - 1 && meta.hasFinalNewline === false) {
          currentDelims.push('');
        } else if (origEndings && origEndings[i] !== undefined) {
          currentDelims.push(origEndings[i]);
        } else {
          currentDelims.push(meta.defaultNewline || '\n');
        }
      }
    }

    // If we have original lines and byte ranges, perform localized byte patching
    if (origBytes && origLines && origRanges && origEndings && currentLines) {
      const M = currentLines.length;
      const N = origLines.length;

      let p = 0;
      while (p < M && p < N && currentLines[p] === origLines[p]) {
        p++;
      }

      let s = 0;
      while (s < (M - p) && s < (N - p) && currentLines[M - 1 - s] === origLines[N - 1 - s]) {
        s++;
      }

      if (p === N && M === N) {
        return new Uint8Array(origBytes);
      }

      // Untouched prefix bytes
      const prefixBytes = p > 0
        ? origBytes.subarray(0, origRanges[p - 1].end)
        : origBytes.subarray(0, bom.length);

      // Untouched suffix bytes
      const suffixBytes = s > 0
        ? origBytes.subarray(origRanges[N - s].start)
        : new Uint8Array(0);

      // Changed middle lines
      const middleChunks = [];
      for (let j = p; j <= M - 1 - s; j++) {
        let ending;
        if (j === M - 1) {
          if (meta.hasFinalNewline === false && s === 0) {
            ending = '';
          } else if (j < N && M === N && origEndings[j] !== undefined) {
            ending = origEndings[j];
          } else if (currentDelims && currentDelims[j] !== undefined) {
            ending = currentDelims[j];
          } else {
            ending = meta.defaultNewline || '\n';
          }
        } else {
          if (j < N && M === N && origEndings[j]) {
            ending = origEndings[j];
          } else if (currentDelims && currentDelims[j]) {
            ending = currentDelims[j];
          } else {
            ending = meta.defaultNewline || '\n';
          }
        }

        const encodedLine = encodeText(currentLines[j] + ending, encoding);
        middleChunks.push(encodedLine);
      }

      return concatUint8Arrays([prefixBytes, ...middleChunks, suffixBytes]);
    }

    // Fallback serialization if no original structure is available
    const chunks = [];
    if (bom.length > 0) chunks.push(bom);

    if (currentLines) {
      for (let i = 0; i < currentLines.length; i++) {
        const ending = (currentDelims && currentDelims[i] !== undefined)
          ? currentDelims[i]
          : (i === currentLines.length - 1 && meta.hasFinalNewline === false ? '' : (meta.defaultNewline || '\n'));
        chunks.push(encodeText(currentLines[i] + ending, encoding));
      }
    } else if (currentText !== null) {
      chunks.push(encodeText(currentText, encoding));
    }

    return concatUint8Arrays(chunks);
  }

  function encodeBom(encoding) {
    if (encoding === 'utf-8') return new Uint8Array([0xef, 0xbb, 0xbf]);
    if (encoding === 'utf-16le') return new Uint8Array([0xff, 0xfe]);
    if (encoding === 'utf-16be') return new Uint8Array([0xfe, 0xff]);
    return new Uint8Array(0);
  }

  function scan(bytes, _name, options = {}) {
    const rawBytes = toUint8Array(bytes);
    try {
      const decoded = detectAndDecode(rawBytes, options);
      if (decoded.status === 'ambiguous_encoding') {
        return {
          supported: false,
          unsupported: [{ feature: 'ambiguous encoding', count: 1 }]
        };
      }
      return {
        supported: true,
        unsupported: []
      };
    } catch {
      return {
        supported: false,
        unsupported: [{ feature: 'ambiguous encoding', count: 1 }]
      };
    }
  }

  const api = {
    id: 'txt',
    open,
    serialize,
    scan,
    capabilities: {
      proseTransformations: false
    },
    AmbiguousEncodingError,
    UnrepresentableCharacterError
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NeoCraft_TxtAdapter = api;
    root.NeoCraft_Txt = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
