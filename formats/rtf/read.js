'use strict';

// Reader half of #33; adapter assembly and writing belong to #63.
// Same provisional model as the DOCX reader (#53): document -> paragraphs ->
// runs { text, b?, i?, u? }. Font definitions stay in meta for the writer.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const { tokenize } = node ? require('./tokenize') : root.NeoCraft_RtfTokenize;
  const { scanRtf } = node ? require('./scan') : root.NeoCraft_RtfScan;
  const destinations = new Set([
    'colortbl', 'stylesheet', 'info', 'filetbl', 'revtbl', 'listtable',
    'listoverridetable', 'generator', 'field', 'pict', 'object', 'shp', 'shpgrp',
    'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr',
    'footerf', 'footnote', 'annotation', 'listtext', 'pntext',
  ]);
  const charsets = { 77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936,
    136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256,
    186: 1257, 204: 1251, 222: 874, 238: 1250, 254: 437, 255: 850 };
  const labels = { 874: 'windows-874', 932: 'shift_jis', 936: 'gbk',
    949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 65001: 'utf-8' };
  // WHATWG Windows-1252 index, bytes 0x80–0x9f:
  // https://encoding.spec.whatwg.org/index-windows-1252.txt
  const windows1252 = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021' +
    '\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f' +
    '\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014' +
    '\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';
  const characters = { tab: '\t', line: '\n', emdash: '\u2014', endash: '\u2013',
    bullet: '\u2022', lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201c', rdblquote: '\u201d' };
  function fail(name, message) { const error = new Error(message); error.name = name; throw error; }

  function readRtf(bytes, name = '', options = {}) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('RTF bytes must be a Uint8Array');
    const limits = { maxLength: 20 * 1024 * 1024, maxDepth: 100, ...options.limits };
    for (const key of ['maxLength', 'maxDepth']) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) throw new TypeError('Invalid RTF limit: ' + key);
    }
    if (bytes.length > limits.maxLength) fail('RtfLimitError', 'RTF input exceeds maxLength');
    const originalBytes = new Uint8Array(bytes);
    // Preserve byte values. TextDecoder('latin1') aliases windows-1252 and
    // would corrupt raw bytes before the document's codepage is known.
    let source = '';
    for (let i = 0; i < originalBytes.length; i += 8192) {
      source += String.fromCharCode(...originalBytes.subarray(i, i + 8192));
    }
    const tokens = tokenize(source, limits);
    if (tokens[0]?.type !== 'open' || tokens[1]?.word !== 'rtf' || tokens[1]?.param !== 1) {
      fail('RtfSyntaxError', 'Expected an RTF 1 document');
    }
    const blocks = [];
    let paragraph = { type: 'paragraph', runs: [] };
    const fonts = new Map();
    const decoders = new Map();
    let defaultFont = null;
    let state = { codepage: 1252, font: null, b: false, i: false, u: false, start: false };
    const stack = [];
    let pending = '';
    let ended = false;

    function decoder() {
      const font = state.table ? state.entry : fonts.get(state.font ?? defaultFont);
      // A Symbol font's name is still text in the document encoding; its
      // body glyphs have no TextDecoder mapping and must fail explicitly.
      const charset = state.table && font?.charset === 2 ? 0 : font?.charset;
      if (charset !== undefined && charset !== 0 && charset !== 1 && !charsets[charset] && !font.codepage) {
        fail('RtfEncodingError', 'Unsupported RTF font charset: ' + charset);
      }
      const cp = font?.codepage ?? charsets[charset] ?? state.codepage;
      if (!decoders.has(cp)) {
        try {
          const native = new TextDecoder(labels[cp] || (cp >= 1250 && cp <= 1258 ? 'windows-' + cp : 'cp' + cp), { fatal: true });
          // Some Node 20 builds decode Windows-1252 as Latin-1. Normalize
          // only this codepage's C1 range; correct native output is unchanged.
          decoders.set(cp, cp === 1252 ? {
            decode: (bytes) => native.decode(bytes).replace(/[\u0080-\u009f]/g,
              (char) => windows1252[char.charCodeAt(0) - 0x80]),
          } : native);
        } catch { fail('RtfEncodingError', 'Unsupported RTF codepage: ' + cp); }
      }
      return decoders.get(cp);
    }
    function append(text) {
      if (!text) return;
      if (state.table) {
        if (state.entry) state.entry.name += text.split(';', 1)[0];
        return;
      }
      const run = { text };
      for (const mark of ['b', 'i', 'u']) if (state[mark]) run[mark] = true;
      const last = paragraph.runs.at(-1);
      if (last && ['b', 'i', 'u'].every((mark) => last[mark] === run[mark])) last.text += text;
      else paragraph.runs.push(run);
    }
    function flush() {
      if (!pending.length) return;
      let text;
      try { text = decoder().decode(Uint8Array.from(pending, (char) => char.charCodeAt(0))); }
      catch (error) {
        if (error.name === 'RtfEncodingError') throw error;
        fail('RtfEncodingError', 'Invalid bytes for RTF codepage');
      }
      pending = '';
      append(text);
    }
    for (const token of tokens) {
      if (token.type !== 'text' && token.type !== 'hex') flush();
      if (token.type === 'open') {
        if (ended) fail('RtfSyntaxError', 'Multiple RTF documents');
        stack.push(state);
        state = { ...state, start: true };
        continue;
      }
      if (token.type === 'close') { state = stack.pop(); ended = !stack.length; continue; }
      // Writers pad a finished file with NUL or a DOS end-of-file byte (0x1A).
      if (!stack.length && ended && token.type === 'text' && /^[\u0000\u001a\s]*$/.test(token.value)) continue;
      if (!stack.length) fail('RtfSyntaxError', 'Text outside the RTF document');
      if (state.skip) continue;
      if (state.start && token.type === 'symbol' && token.char === '*') { state.skip = true; continue; }
      if (state.start && token.type === 'control') {
        if (token.word === 'fonttbl') state.table = true;
        else if (destinations.has(token.word)) state.skip = true;
      }
      state.start = false;
      if (state.skip) continue;
      if (token.type === 'text') {
        pending += token.value;
      } else if (token.type === 'hex') pending += String.fromCharCode(token.byte);
      else if (token.type === 'unicode') {
        if (token.code < 0 || token.code > 65535) fail('RtfSyntaxError', 'Invalid RTF Unicode code unit');
        append(String.fromCharCode(token.code));
      } else if (token.type === 'symbol') {
        append(({ '~': '\u00a0', '-': '\u00ad', _: '\u2011' })[token.char] || '');
      } else if (token.type === 'control') {
        const { word, param } = token;
        if (word === 'ansicpg') { state.codepage = param; decoder(); }
        else if (word === 'mac') state.codepage = 10000;
        else if (word === 'pc') state.codepage = 437;
        else if (word === 'pca') state.codepage = 850;
        else if (word === 'deff') defaultFont = param;
        else if (word === 'f') {
          state.font = param;
          if (state.table) { state.entry = { id: param, name: '' }; fonts.set(param, state.entry); }
        } else if (state.table && state.entry && (word === 'fcharset' || word === 'cpg')) {
          state.entry[word === 'cpg' ? 'codepage' : 'charset'] = param;
        } else if (['b', 'i', 'ul'].includes(word)) state[word === 'ul' ? 'u' : word] = param !== 0;
        else if (word === 'ulnone') state.u = false;
        else if (word === 'plain') Object.assign(state, { b: false, i: false, u: false, font: defaultFont });
        else if (!state.table && word === 'par') { blocks.push(paragraph); paragraph = { type: 'paragraph', runs: [] }; }
        else if (Object.hasOwn(characters, word)) append(characters[word]);
        else if (word === 'bin') fail('RtfSyntaxError', 'Binary RTF payloads are not supported');
      }
    }
    if (paragraph.runs.length || !blocks.length) blocks.push(paragraph);
    for (const font of fonts.values()) font.name = font.name.trim();
    return { model: { type: 'document', blocks }, meta: {
      name, originalBytes, fonts: [...fonts.values()], fidelity: scanRtf(tokens),
    } };
  }
  const api = { readRtf };
  if (node) module.exports = api;
  else root.NeoCraft_RtfRead = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
