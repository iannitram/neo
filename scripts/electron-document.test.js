'use strict';

// Desktop document host (#72): exact-path reads and saves through an injected
// filesystem, revision conflicts, and the argv routing that decides which
// files open in Document mode. Run by `npm test` (node --test).

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { contentRevision } = require('../desktop/atomic-write');
const { createElectronDocumentHost, documentPathsFromArgv, isDocumentFile } = require('../hosts/electron-document');

// recursive freeze so any mutation of an input throws (R28)
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

const bytes = (value) => new Uint8Array(Buffer.from(value, 'utf8'));
const text = (value) => Buffer.from(value).toString('utf8');
const enoent = (p) => Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });

// In-memory stand-in for node:fs/promises. It records every path it reads or
// writes, and every directory listing (which the host must never make).
function fakeFs(initial, { failRename = null, denyRead = new Set(), denyWrite = new Set() } = {}) {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]));
  const reads = [];
  const writes = [];
  const listed = [];
  const handle = () => ({ sync: async () => {}, close: async () => {} });
  return {
    files, reads, writes, listed,
    readFile: async (p) => {
      reads.push(p);
      if (denyRead.has(p)) throw Object.assign(new Error('EACCES: ' + p), { code: 'EACCES' });
      const b = files.get(p);
      if (!b) throw enoent(p);
      return Buffer.from(b);
    },
    writeFile: async (p, b) => {
      writes.push(p);
      // a read-only folder refuses every file in it, the temporary one included
      if ([...denyWrite].some((dir) => path.dirname(p) === dir)) throw Object.assign(new Error('EPERM: ' + p), { code: 'EPERM' });
      files.set(p, Buffer.from(b));
    },
    open: async () => handle(),
    rename: async (from, to) => {
      writes.push(to);
      if (failRename) throw failRename;
      const v = files.get(from);
      if (!v) throw enoent(from);
      files.delete(from);
      files.set(to, v);
    },
    readdir: async (p) => { listed.push(p); throw new Error('the host must not list ' + p); },
    opendir: async (p) => { listed.push(p); throw new Error('the host must not list ' + p); },
  };
}

const DOC = path.join(path.sep, 'Sync', 'draft.md');
const SIBLING = path.join(path.sep, 'Sync', 'other.md');

function setup(initial, options) {
  const fs = fakeFs(initial, options);
  let n = 0;
  const host = createElectronDocumentHost({ fs, path, newRef: () => `ref-${++n}` });
  return { fs, host };
}

test('open takes one exact path, lists nothing, and reports the first revision', async () => {
  const { fs, host } = setup({ [DOC]: 'Chapter one.', [SIBLING]: 'not ours' });
  const opened = await host.open(DOC);
  assert.deepEqual(opened, { ref: 'ref-1', path: DOC, name: 'draft.md', revision: contentRevision(bytes('Chapter one.')) });
  assert.deepEqual(fs.reads, [DOC], 'only the requested file is read');
  assert.deepEqual(fs.listed, []);
  assert.deepEqual(fs.writes, []);
});

test('read returns the bytes and the revision of exactly those bytes', async () => {
  const { host } = setup({ [DOC]: 'First line\n' });
  const { ref, revision } = await host.open(DOC);
  const read = await host.read(ref);
  assert.ok(read.bytes instanceof Uint8Array);
  assert.equal(text(read.bytes), 'First line\n');
  assert.equal(read.revision, revision);
});

test('a ref the host did not issue is refused, and nothing is read or written', async () => {
  const { fs, host } = setup({ [DOC]: 'x' });
  await assert.rejects(host.read('made-up'), { code: 'unknown-document' });
  await assert.rejects(host.save('made-up', bytes('y'), contentRevision(bytes('x'))), { code: 'unknown-document' });
  assert.deepEqual(fs.reads, []);
  assert.deepEqual(fs.writes, []);
});

test('open refuses a relative path', async () => {
  const { host } = setup({ 'draft.md': 'x' });
  await assert.rejects(host.open('draft.md'), TypeError);
});

test('a save at the revision the session read replaces the file and returns the new revision', async () => {
  const { fs, host } = setup({ [DOC]: 'before' });
  const { ref, revision } = await host.open(DOC);
  const saved = await host.save(ref, bytes('after'), revision);
  assert.deepEqual(saved, { revision: contentRevision(bytes('after')) });
  assert.equal(text(fs.files.get(DOC)), 'after');
  assert.equal((await host.read(ref)).revision, saved.revision);
  assert.ok(![...fs.files.keys()].some((k) => k.endsWith('.tmp')), 'the temporary file is renamed away');
});

test('an edit made outside NeoCraft is detected: the save conflicts and the external bytes stay', async () => {
  const { fs, host } = setup({ [DOC]: 'opened' });
  const { ref, revision } = await host.open(DOC);
  fs.files.set(DOC, Buffer.from('edited elsewhere'));
  await assert.rejects(host.save(ref, bytes('our words'), revision), (err) => {
    assert.equal(err.code, 'conflict');
    assert.equal(err.currentRevision, contentRevision(bytes('edited elsewhere')));
    return true;
  });
  assert.equal(text(fs.files.get(DOC)), 'edited elsewhere');
});

test('a file deleted since it was opened is a conflict, and nothing is recreated', async () => {
  const { fs, host } = setup({ [DOC]: 'opened' });
  const { ref, revision } = await host.open(DOC);
  fs.files.delete(DOC);
  await assert.rejects(host.save(ref, bytes('ours'), revision), { code: 'conflict' });
  assert.equal(fs.files.has(DOC), false);
});

test('a second save must name the revision the first save left: an outside edit in between conflicts', async () => {
  const { fs, host } = setup({ [DOC]: 'one' });
  const { ref, revision } = await host.open(DOC);
  const first = await host.save(ref, bytes('two'), revision);
  fs.files.set(DOC, Buffer.from('three, from the sync client'));
  await assert.rejects(host.save(ref, bytes('four'), first.revision), { code: 'conflict' });
  assert.equal(text(fs.files.get(DOC)), 'three, from the sync client');
});

test('a permission the system took away is permission-lost, on open and on save', async () => {
  const locked = setup({ [DOC]: 'x' }, { denyRead: new Set([DOC]) });
  await assert.rejects(locked.host.open(DOC), { code: 'permission-lost' });

  const readOnly = setup({ [DOC]: 'x' }, { denyWrite: new Set([path.dirname(DOC)]) });
  const { ref, revision } = await readOnly.host.open(DOC);
  await assert.rejects(readOnly.host.save(ref, bytes('y'), revision), { code: 'permission-lost' });
  assert.equal(text(readOnly.fs.files.get(DOC)), 'x');
});

test('a failed rename leaves the original untouched and reports save-failed, not a conflict', async () => {
  const { fs, host } = setup({ [DOC]: 'keep me' }, { failRename: Object.assign(new Error('EXDEV'), { code: 'EXDEV' }) });
  const { ref, revision } = await host.open(DOC);
  await assert.rejects(host.save(ref, bytes('lost'), revision), { code: 'save-failed' });
  assert.equal(text(fs.files.get(DOC)), 'keep me');
});

test('a sibling in the same folder is never read, even when the document is a placeholder', async () => {
  const { fs, host } = setup({ [DOC]: 'x', [SIBLING]: 'y' });
  const { ref, revision } = await host.open(DOC);
  await host.read(ref);
  await host.save(ref, bytes('z'), revision);
  for (const p of fs.reads) assert.equal(p, DOC);
  assert.deepEqual(fs.listed, []);
});

test('two opened files keep their own refs and paths', async () => {
  const other = path.join(path.sep, 'Sync', 'notes.txt');
  const { fs, host } = setup({ [DOC]: 'a', [other]: 'b' });
  const first = await host.open(DOC);
  const second = await host.open(other);
  assert.notEqual(first.ref, second.ref);
  assert.equal(text((await host.read(second.ref)).bytes), 'b');
  assert.equal(text((await host.read(first.ref)).bytes), 'a');
  assert.deepEqual(fs.reads, [DOC, other, other, DOC], 'each ref reads only its own file');
});

test('save refuses bytes that are not a Uint8Array', async () => {
  const { host } = setup({ [DOC]: 'x' });
  const { ref, revision } = await host.open(DOC);
  await assert.rejects(host.save(ref, 'a string', revision), TypeError);
});

test('argv: a packaged launch names its files by absolute path, flags and the executable skipped', () => {
  const argv = deepFreeze(['/Apps/NeoCraft', '--no-sandbox', 'notes.md', 'book.txt']);
  assert.deepEqual(
    documentPathsFromArgv(argv, { isPackaged: true, cwd: '/home/u', pathImpl: path.posix }),
    ['/home/u/notes.md', '/home/u/book.txt']
  );
});

test('argv: an unpackaged launch also skips the app path', () => {
  const argv = deepFreeze(['electron', '.', 'a.rtf']);
  assert.deepEqual(documentPathsFromArgv(argv, { isPackaged: false, cwd: '/w', pathImpl: path.posix }), ['/w/a.rtf']);
});

test('argv: a .docx stays with WordCraft, a neocraft:// link is not a document, and a duplicate opens once', () => {
  const argv = deepFreeze(['NeoCraft', 'report.docx', 'neocraft://open?x=1', 'a.md', 'a.md', 'readme.MD']);
  assert.deepEqual(
    documentPathsFromArgv(argv, { isPackaged: true, cwd: '/w', pathImpl: path.posix }),
    ['/w/a.md', '/w/readme.MD']
  );
});

test('argv: Windows paths keep their drive', () => {
  const argv = deepFreeze(['NeoCraft.exe', 'C:\\Docs\\x.rtf']);
  assert.deepEqual(documentPathsFromArgv(argv, { isPackaged: true, cwd: 'C:\\w', pathImpl: path.win32 }), ['C:\\Docs\\x.rtf']);
});

test('isDocumentFile accepts md, markdown, txt and rtf in any case, and nothing else', () => {
  for (const name of ['a.md', 'b.MARKDOWN', 'c.txt', 'd.Rtf']) assert.equal(isDocumentFile(name), true, name);
  for (const name of ['e.docx', 'f', 'g.md.bak', 'h.pdf', 'trailing.']) assert.equal(isDocumentFile(name), false, name);
});
