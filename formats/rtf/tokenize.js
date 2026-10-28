'use strict';

// RTF TOKENIZER: turns RTF text into a flat list of tokens (groups, control
// words, control symbols, hex bytes, Unicode escapes and plain text). It does
// not interpret destinations, fonts or colours; a reader built on top decides
// what the tokens mean.
//
// Bounded on purpose: a text longer than maxLength, or groups nested deeper
// than maxDepth, throw RtfLimitError; unbalanced braces throw RtfSyntaxError.
//
// Plain JavaScript that also runs in the browser and in Node (the tests).

(function (root) {
  'use strict';

  function fail(name, message) {
    const err = new Error(message);
    err.name = name;
    return err;
  }

  function isLetter(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
  }

  function isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  function isHex(ch) {
    return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
  }

  // Skips `count` fallback characters starting at `i`. A \'hh escape or a
  // backslash escape counts as one character.
  function skipFallback(src, i, count) {
    let left = count;
    while (left > 0 && i < src.length) {
      if (src[i] === '\\' && src[i + 1] === "'") i += 4;
      else if (src[i] === '\\') i += 2;
      else i += 1;
      left -= 1;
    }
    return Math.min(i, src.length);
  }

  function tokenize(text, options) {
    const opts = options || {};
    const maxDepth = opts.maxDepth === undefined ? 100 : opts.maxDepth;
    const maxLength = opts.maxLength === undefined ? 20 * 1024 * 1024 : opts.maxLength;

    const src = String(text);
    if (src.length > maxLength) {
      throw fail('RtfLimitError', 'RTF text is longer than ' + maxLength + ' characters');
    }

    const tokens = [];
    const stack = [];
    let uc = 1;
    let buf = '';

    function flush() {
      if (buf !== '') {
        tokens.push({ type: 'text', value: buf });
        buf = '';
      }
    }

    function emit(token) {
      flush();
      tokens.push(token);
    }

    let i = 0;
    while (i < src.length) {
      const ch = src[i];

      if (ch === '{') {
        if (stack.length + 1 > maxDepth) {
          throw fail('RtfLimitError', 'RTF groups nest deeper than ' + maxDepth);
        }
        stack.push(uc);
        emit({ type: 'open' });
        i += 1;
      } else if (ch === '}') {
        if (stack.length === 0) {
          throw fail('RtfSyntaxError', 'Unexpected } at character ' + i);
        }
        uc = stack.pop();
        emit({ type: 'close' });
        i += 1;
      } else if (ch === '\r' || ch === '\n') {
        // Line breaks outside control words carry no meaning.
        i += 1;
      } else if (ch === '\\') {
        const next = src[i + 1];
        if (next === undefined) {
          throw fail('RtfSyntaxError', 'RTF ends with a lone backslash');
        }

        if (isLetter(next)) {
          let j = i + 1;
          while (j < src.length && isLetter(src[j])) j += 1;
          const word = src.slice(i + 1, j);

          let param = null;
          let k = j;
          if (src[k] === '-' && isDigit(src[k + 1] || '')) k += 1;
          if (isDigit(src[k] || '')) {
            const start = j;
            k = start;
            if (src[k] === '-') k += 1;
            while (k < src.length && isDigit(src[k])) k += 1;
            param = parseInt(src.slice(start, k), 10);
          }
          // One space after a control word is its delimiter.
          if (src[k] === ' ') k += 1;
          i = k;

          if (word === 'uc') {
            if (param !== null) uc = Math.max(0, param);
            emit({ type: 'control', word, param });
          } else if (word === 'u' && param !== null) {
            const code = param < 0 ? param + 65536 : param;
            emit({ type: 'unicode', code });
            i = skipFallback(src, i, uc);
          } else {
            emit({ type: 'control', word, param });
          }
        } else if (next === "'") {
          const h1 = src[i + 2] || '';
          const h2 = src[i + 3] || '';
          if (!isHex(h1) || !isHex(h2)) {
            throw fail('RtfSyntaxError', "Bad \\' hex escape at character " + i);
          }
          emit({ type: 'hex', byte: parseInt(h1 + h2, 16) });
          i += 4;
        } else if (next === '\r' || next === '\n') {
          // A backslash before a line break is a paragraph.
          emit({ type: 'control', word: 'par', param: null });
          i += 2;
        } else if (next === '\\' || next === '{' || next === '}') {
          buf += next;
          i += 2;
        } else {
          emit({ type: 'symbol', char: next });
          i += 2;
        }
      } else {
        buf += ch;
        i += 1;
      }
    }

    if (stack.length > 0) {
      throw fail('RtfSyntaxError', 'RTF has ' + stack.length + ' unclosed group(s)');
    }
    flush();
    return tokens;
  }

  const api = { tokenize };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_RtfTokenize = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
