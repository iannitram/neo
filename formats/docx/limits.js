// Safety limits for a .docx package, checked before anything is parsed.
// A .docx is a ZIP; the caller reads its central directory into
// `entries` ({ name, compressedSize, uncompressedSize }) and passes them here.
// Plain JavaScript that loads in the browser, Electron and Node tests.
(function (root) {
  'use strict';

  const DEFAULT_LIMITS = {
    maxEntries: 2000,
    maxTotalUncompressed: 100 * 1024 * 1024,
    maxEntryUncompressed: 25 * 1024 * 1024,
    maxRatio: 100,
  };

  function badName(name) {
    if (typeof name !== 'string') return true;
    if (name.includes('\0')) return true;
    if (name.includes('\\')) return true;
    if (name.startsWith('/')) return true;
    if (/^[A-Za-z]:/.test(name)) return true;
    return name.split('/').some((seg) => seg === '..');
  }

  function checkPackageLimits(entries, limits = DEFAULT_LIMITS) {
    const problems = [];
    if (entries.length > limits.maxEntries) {
      problems.push('too many entries: ' + entries.length);
    }

    let total = 0;
    const seen = new Set();
    for (const entry of entries) {
      const name = entry.name;
      total += entry.uncompressedSize;

      if (badName(name)) {
        problems.push('bad name: ' + name);
      }

      const key = String(name).toLowerCase();
      if (seen.has(key)) {
        problems.push('duplicate name: ' + name);
      } else {
        seen.add(key);
      }

      if (entry.uncompressedSize > limits.maxEntryUncompressed) {
        problems.push('entry too large: ' + name);
      }

      if (entry.compressedSize > 0 &&
          entry.uncompressedSize / entry.compressedSize > limits.maxRatio) {
        problems.push('compression ratio: ' + name);
      }
    }

    if (total > limits.maxTotalUncompressed) {
      problems.push('too large: ' + total + ' bytes uncompressed');
    }

    return { ok: problems.length === 0, problems };
  }

  // True when the XML declares no DOCTYPE or ENTITY (the usual billion-laughs
  // and external-entity vectors). Plain WordprocessingML never needs them.
  function xmlIsSafe(xml) {
    const s = String(xml);
    return !/<!DOCTYPE/i.test(s) && !/<!ENTITY/i.test(s);
  }

  const api = { DEFAULT_LIMITS, checkPackageLimits, xmlIsSafe };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_DocxLimits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
