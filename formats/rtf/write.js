'use strict';

// Writer half of #63. Serialises the provisional document model that
// formats/rtf/read.js returns:
//   { type: 'document', blocks: [{ type: 'paragraph', runs: [{ text, b?, i?, u? }] }] }
//
// The output is ASCII-only RTF 1. Every character outside printable ASCII is a
// signed 16-bit \uN escape with a '?' fallback, so the text does not depend on
// a codepage. The header still declares ansicpg1252, the reader's default, so
// both sides agree on what a raw byte would mean. The writer never emits raw
// or \'hh bytes.
//
// Anything the model holds that this writer cannot represent is refused with
// RtfWriteRefusedError. Nothing is dropped silently. The caller then uses its
// fallback or save-as-copy, and the original file is not touched.
//
// The adapter (rtfAdapter) adds one rule for an existing file. An unchanged
// model returns the original bytes, because nothing was edited. An edited
// model from a source with unsupported features is refused, because writing it
// would lose those features.
//
// Plain JavaScript that also runs in the browser and in Node (the tests).
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const { readRtf } = node ? require('./read') : root.NeoCraft_RtfRead;

  const HEADER = '{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0' +
    '{\\fonttbl{\\f0\\fnil\\fcharset0 Times New Roman;}}\\pard\\plain ';
  const DOCUMENT_KEYS = ['type', 'blocks'];
  const PARAGRAPH_KEYS = ['type', 'runs'];
  const RUN_KEYS = ['text', 'b', 'i', 'u'];
  // Marks in the order they are written, with their RTF control words.
  const MARKS = [['b', 'b'], ['i', 'i'], ['u', 'ul']];

  class RtfWriteRefusedError extends Error {
    constructor(message) {
      super(message);
      this.name = 'RtfWriteRefusedError';
    }
  }

  function refuse(message) {
    throw new RtfWriteRefusedError(message);
  }

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // A key the writer does not know would be lost on save, so it is refused.
  // An undefined value counts as absent.
  function onlyKeys(object, allowed, where) {
    for (const key of Object.keys(object)) {
      if (object[key] !== undefined && !allowed.includes(key)) {
        refuse(`${where} has "${key}", which the RTF writer cannot represent`);
      }
    }
  }

  function markOn(run, mark) {
    const value = run[mark];
    if (value === undefined || value === false) return false;
    if (value === true) return true;
    refuse(`run "${mark}" must be true or absent`);
    return false;
  }

  // \uN with N signed 16-bit, as RTF readers expect, then the '?' fallback.
  function unicodeEscape(unit) {
    const signed = unit > 0x7fff ? unit - 0x10000 : unit;
    return `\\u${signed}?`;
  }

  // Escapes text for the body. A surrogate pair becomes two code-unit escapes;
  // a lone surrogate is refused because RTF text cannot hold it.
  function escapeText(text) {
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
      const unit = text.charCodeAt(i);
      const ch = text[i];
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const low = text.charCodeAt(i + 1);
        if (!(low >= 0xdc00 && low <= 0xdfff)) refuse('text contains a lone surrogate');
        out += unicodeEscape(unit) + unicodeEscape(low);
        i += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        refuse('text contains a lone surrogate');
      } else if (ch === '\\' || ch === '{' || ch === '}') {
        out += '\\' + ch;
      } else if (ch === '\t') {
        out += '\\tab ';
      } else if (ch === '\n') {
        out += '\\line ';
      } else if (unit >= 0x20 && unit < 0x7f) {
        out += ch;
      } else {
        out += unicodeEscape(unit);
      }
    }
    return out;
  }

  function writeRun(run) {
    if (!isPlainObject(run)) refuse('run is not an object');
    onlyKeys(run, RUN_KEYS, 'run');
    if (typeof run.text !== 'string') refuse('run text must be a string');
    const body = escapeText(run.text);
    if (body === '') return '';
    const words = MARKS.filter(([mark]) => markOn(run, mark)).map(([, word]) => '\\' + word);
    if (!words.length) return body;
    // The group ends the marks, so the next run starts plain.
    return '{' + words.join('') + ' ' + body + '}';
  }

  function writeParagraph(paragraph) {
    if (!isPlainObject(paragraph)) refuse('block is not an object');
    if (paragraph.type !== 'paragraph') refuse(`block type "${paragraph.type}" is not supported`);
    onlyKeys(paragraph, PARAGRAPH_KEYS, 'paragraph');
    if (!Array.isArray(paragraph.runs)) refuse('paragraph runs must be an array');
    // Every paragraph ends with \par, including empty ones. The reader only
    // keeps a paragraph that a \par closes, and it does not add one at the end.
    return paragraph.runs.map(writeRun).join('') + '\\par\r\n';
  }

  // Serialises a model to RTF bytes. Throws RtfWriteRefusedError if the model
  // holds anything this writer cannot represent. An empty document is written
  // with no paragraphs and reads back as one empty paragraph.
  function writeRtf(model) {
    if (!isPlainObject(model)) refuse('model must be an object');
    onlyKeys(model, DOCUMENT_KEYS, 'document');
    if (model.type !== 'document') refuse(`model type "${model.type}" is not supported`);
    if (!Array.isArray(model.blocks)) refuse('document blocks must be an array');
    const text = HEADER + model.blocks.map(writeParagraph).join('') + '}';
    return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
  }

  // Deep equality for plain model data. Keys with undefined values count as absent.
  function sameValue(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
    const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => sameValue(a[key], b[key]));
  }

  // The model the reader gives for the original bytes, cached per byte copy.
  const readModels = new WeakMap();
  function originalModel(originalBytes) {
    if (!readModels.has(originalBytes)) {
      try { readModels.set(originalBytes, readRtf(originalBytes, '').model); }
      catch { readModels.set(originalBytes, null); }
    }
    return readModels.get(originalBytes);
  }

  // Adapter for the format contract (scripts/format-contract.js).
  const rtfAdapter = {
    id: 'rtf',
    open(bytes, name) {
      return readRtf(bytes, name);
    },
    serialize(model, meta) {
      const original = meta && meta.originalBytes;
      if (original instanceof Uint8Array) {
        const reread = originalModel(original);
        if (reread && sameValue(reread, model)) return Uint8Array.from(original);
      }
      if (meta && meta.fidelity && meta.fidelity.supported === false) {
        const features = meta.fidelity.unsupported.map((item) => item.feature).join(', ');
        refuse(`the source has features this writer cannot keep (${features}); save a copy instead`);
      }
      return writeRtf(model);
    },
    scan(bytes, name) {
      try {
        return readRtf(bytes, name).meta.fidelity;
      } catch (error) {
        return { supported: false, unsupported: [{ feature: `unreadable RTF (${error.name})`, count: 1 }] };
      }
    },
  };

  const api = { writeRtf, RtfWriteRefusedError, rtfAdapter };
  if (node) module.exports = api;
  else root.NeoCraft_RtfWrite = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
