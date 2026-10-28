'use strict';

// SPAN PATCHER: apply edits as replacements of exact source ranges, so
// every byte outside an edit stays identical. Pure string functions, no
// I/O. Plain JavaScript that loads in the browser, Electron and Node tests.
//
//   applySpanEdits(source, edits)
//     source: string. edits: Array<{ start, end, text }> with
//       0 <= start <= end <= source.length (UTF-16 indices).
//     Returns the new string. Edits may come in any order. Two edits that
//     share only an endpoint are fine; two inserts at the same index are
//     applied in array order. The input array is not mutated.
//     Throws RangeError for an out-of-range span or start > end, and
//     RangeError('overlap') when two edits overlap.

(function (root) {
  'use strict';

  function applySpanEdits(source, edits) {
    if (typeof source !== 'string') throw new TypeError('source must be a string');
    if (!Array.isArray(edits)) throw new TypeError('edits must be an array');

    // Keep the caller's order for ties (inserts at one index), but sort
    // by position. Indices are copied so the input is never touched.
    const list = edits.map((e, order) => {
      const { start, end, text } = e;
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new RangeError('span indices must be integers');
      }
      if (start < 0 || end > source.length) throw new RangeError('span out of range');
      if (start > end) throw new RangeError('start after end');
      return { start, end, text: String(text), order };
    });
    list.sort((a, b) => a.start - b.start || a.end - b.end || a.order - b.order);

    let out = '';
    let pos = 0;
    let prevEnd = -1;
    for (const e of list) {
      if (e.start < prevEnd) throw new RangeError('overlap');
      out += source.slice(pos, e.start) + e.text;
      pos = e.end;
      prevEnd = e.end;
    }
    return out + source.slice(pos);
  }

  const api = { applySpanEdits };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_SpanPatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
