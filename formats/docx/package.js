'use strict';

// JSZip 3.10.1 is used under its MIT option (LICENSE.markdown).
// Inspect raw directory names before JSZip normalizes them or merges duplicates.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const JSZip = node ? require('jszip') : root.JSZip;
  const { DEFAULT_LIMITS, checkPackageLimits } = node ? require('./limits') : root.NeoCraft_DocxLimits;
  const invalid = () => { throw new Error('Invalid DOCX ZIP package'); };
  const utf8 = new TextDecoder('utf-8', { fatal: true });

  function directory(bytes, limits) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (p) => view.getUint16(p, true);
    const u32 = (p) => view.getUint32(p, true);
    let end = bytes.length - 22;
    const earliest = Math.max(0, end - 65535);
    while (end >= earliest && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
    if (end < earliest || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) invalid();
    const count = u16(end + 10);
    let pos = u32(end + 16);
    // ZIP64 and split archives are outside this bounded simple subset.
    if (count === 0xffff || pos === 0xffffffff || pos + u32(end + 12) !== end) invalid();
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || u32(pos) !== 0x02014b50) invalid();
      const length = u16(pos + 28);
      const next = pos + 46 + length + u16(pos + 30) + u16(pos + 32);
      const local = u32(pos + 42);
      const method = u16(pos + 10);
      const compressedSize = u32(pos + 20);
      const uncompressedSize = u32(pos + 24);
      if (next > end || local + 30 > pos || u32(local) !== 0x04034b50 ||
          u16(pos + 34) || (u16(pos + 8) & 1) || ![0, 8].includes(method) ||
          u16(local + 8) !== method || u16(local + 6) !== u16(pos + 8) ||
          u16(local + 26) !== length || local + 30 + length + u16(local + 28) + compressedSize > u32(end + 16) ||
          compressedSize === 0xffffffff || uncompressedSize === 0xffffffff ||
          (!compressedSize && uncompressedSize)) invalid();
      const raw = bytes.subarray(pos + 46, pos + 46 + length);
      if (!raw.every((b, j) => bytes[local + 30 + j] === b)) invalid();
      const name = utf8.decode(raw);
      entries.push({ name, compressedSize, uncompressedSize, crc: u32(pos + 16) });
      pos = next;
    }
    if (pos !== end) invalid();
    const checked = checkPackageLimits(entries, limits);
    if (!checked.ok) throw new Error('DOCX package limits: ' + checked.problems.join('; '));
    return entries;
  }

  // Streaming bounds also cover a dishonest directory size. Do not accumulate
  // an inflated entry with zip.file(...).async() before checking its real size.
  function inflate(file, entry) {
    return new Promise((resolve, reject) => {
      const stream = file.internalStream('uint8array');
      const chunks = [];
      let size = 0;
      let crc = -1;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > entry.uncompressedSize) {
          stream.pause();
          reject(new Error('DOCX package limits: inflated size exceeds directory size'));
          return;
        }
        for (const byte of chunk) {
          crc ^= byte;
          for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
        chunks.push(chunk);
      }).on('error', reject).on('end', () => {
        if (size !== entry.uncompressedSize || ((crc ^ -1) >>> 0) !== entry.crc) {
          reject(new Error('Invalid DOCX ZIP size or CRC'));
          return;
        }
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
        resolve(result);
      }).resume();
    });
  }

  async function readPackage(bytes, limits = DEFAULT_LIMITS) {
    const entries = directory(bytes, { ...DEFAULT_LIMITS, ...limits });
    const zip = await JSZip.loadAsync(bytes, { createFolders: false, checkCRC32: false });
    if (Object.keys(zip.files).length !== entries.length || entries.some((e) => !Object.hasOwn(zip.files, e.name))) invalid();
    const parts = new Map();
    for (const entry of entries) {
      if (zip.files[entry.name].dir) continue;
      // Check every XML part, including parts not used by the simple reader.
      if (!/\.(xml|rels)$/i.test(entry.name)) continue;
      const data = await inflate(zip.files[entry.name], entry);
      const encoding = data[0] === 0xff && data[1] === 0xfe || data[0] === 60 && data[1] === 0 ? 'utf-16le'
        : data[0] === 0xfe && data[1] === 0xff || data[0] === 0 && data[1] === 60 ? 'utf-16be' : 'utf-8';
      parts.set(entry.name, new TextDecoder(encoding, { fatal: true }).decode(data));
    }
    return { parts, partNames: entries.map((e) => e.name) };
  }

  const api = { readPackage };
  if (node) module.exports = api;
  else root.NeoCraft_DocxPackage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
