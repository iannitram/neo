'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

// recursive freeze so any mutation of an input throws (R28)
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

const path = require('node:path');
const { parseOpenArgs } = require('../desktop/open-args');

test('1. a packaged launch: the executable is skipped, the file is made absolute', () => {
  const r = parseOpenArgs(deepFreeze(['/Apps/NeoCraft', 'notes.md']), { isPackaged: true, cwd: '/home/u', pathImpl: path.posix });
  assert.deepEqual(r, { files: ['/home/u/notes.md'], urls: [] });
});

test('2. unpackaged: argv[1] and flags are skipped', () => {
  const r = parseOpenArgs(deepFreeze(['electron', '.', '--inspect', 'a.txt']), { isPackaged: false, cwd: '/w', pathImpl: path.posix });
  assert.deepEqual(r.files, ['/w/a.txt']);
  assert.deepEqual(r.urls, []);
});

test('3. Windows path semantics', () => {
  const r = parseOpenArgs(deepFreeze(['NeoCraft.exe', 'C:\\Docs\\x.rtf']), { isPackaged: true, cwd: 'C:\\w', pathImpl: path.win32 });
  assert.deepEqual(r.files, ['C:\\Docs\\x.rtf']);
});

test('4. a neocraft:// link goes to urls unchanged', () => {
  const r = parseOpenArgs(deepFreeze(['NeoCraft', 'neocraft://open?x=1']), { isPackaged: true, cwd: '/w', pathImpl: path.posix });
  assert.deepEqual(r, { files: [], urls: ['neocraft://open?x=1'] });
});

test('5. a .docx is not ours', () => {
  const r = parseOpenArgs(deepFreeze(['NeoCraft', 'report.docx']), { isPackaged: true, cwd: '/w', pathImpl: path.posix });
  assert.deepEqual(r.files, []);
});

test('6. a duplicate is opened once', () => {
  const r = parseOpenArgs(deepFreeze(['NeoCraft', 'a.md', 'a.md']), { isPackaged: true, cwd: '/w', pathImpl: path.posix });
  assert.deepEqual(r.files, ['/w/a.md']);
});
