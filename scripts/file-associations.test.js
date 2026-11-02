'use strict';

// The text file types NeoCraft opens from the desktop (M13, #73): md, txt and
// rtf are claimed in the electron-builder config (NSIS registry, macOS document
// types) and in the Linux desktop entry's MimeType. .docx stays with WordCraft.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

describe('desktop file associations', () => {
  const associations = pkg.build.fileAssociations;

  test('md, txt and rtf are claimed as editor documents', () => {
    assert.deepEqual(associations.map((a) => a.ext), ['md', 'txt', 'rtf']);
    for (const a of associations) {
      assert.equal(a.role, 'Editor', `${a.ext} should open as an editor`);
      assert.ok(a.name && a.description, `${a.ext} needs a name and description`);
    }
  });

  test('.docx is not claimed, it stays with WordCraft', () => {
    assert.equal(associations.some((a) => a.ext === 'docx'), false);
  });

  test('the Linux desktop entry lists the same text types and no docx type', () => {
    const mimes = pkg.build.linux.desktop.entry.MimeType.split(';').filter(Boolean);
    for (const mime of ['text/markdown', 'text/plain', 'text/rtf', 'application/rtf']) {
      assert.ok(mimes.includes(mime), `MimeType should include ${mime}`);
    }
    assert.equal(mimes.some((m) => m.includes('openxmlformats')), false);
  });
});
