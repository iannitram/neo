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

const crypto = require('node:crypto');
const { contentRevision, atomicReplace } = require('../desktop/atomic-write');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const norm = (p) => String(p).replace(/\\/g, '/');
const FILE = '/docs/a.md';
const NOW = 1700000000000;
const TMP = '/docs/.a.md.neocraft-' + NOW + '.tmp';
const now = () => NOW;

// an in-memory stand-in for node:fs/promises
function fakeFs(initial, { failRename = null } = {}) {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]));
  const enoent = (p) => Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });
  const handle = (p) => ({
    sync: async () => {}, datasync: async () => {}, close: async () => {},
    writeFile: async (b) => { files.set(p, Buffer.from(b)); },
    write: async (b) => { files.set(p, Buffer.from(b)); },
  });
  return {
    files,
    readFile: async (p) => { const b = files.get(norm(p)); if (!b) throw enoent(p); return Buffer.from(b); },
    writeFile: async (p, b) => { files.set(norm(p), Buffer.from(b)); },
    rename: async (a, b) => {
      if (failRename) throw failRename;
      const v = files.get(norm(a)); if (!v) throw enoent(a);
      files.delete(norm(a)); files.set(norm(b), v);
    },
    unlink: async (p) => { files.delete(norm(p)); },
    open: async (p) => { if (!files.has(norm(p))) files.set(norm(p), Buffer.alloc(0)); return handle(norm(p)); },
  };
}

test('5. contentRevision is the lowercase hex SHA-256', () => {
  assert.equal(contentRevision(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('1. happy path: new bytes in place, revision returned, no tmp left', async () => {
  const fs = fakeFs({ [FILE]: 'old' });
  const bytes = deepFreeze(Buffer.from('new text'));
  const r = await atomicReplace({ fs, path: FILE, bytes, expectedRevision: sha('old'), now });
  assert.equal(fs.files.get(FILE).toString(), 'new text');
  assert.deepEqual(r, { revision: sha('new text') });
  assert.deepEqual([...fs.files.keys()], [FILE]);
});

test('2. a file changed on disk: RevisionMismatchError, nothing written', async () => {
  const fs = fakeFs({ [FILE]: 'someone else' });
  await assert.rejects(
    atomicReplace({ fs, path: FILE, bytes: Buffer.from('mine'), expectedRevision: sha('old'), now }),
    (e) => e.name === 'RevisionMismatchError' && e.currentRevision === sha('someone else'));
  assert.equal(fs.files.get(FILE).toString(), 'someone else');
  assert.deepEqual([...fs.files.keys()], [FILE]);
});

test('3. a failed rename: RetryableSaveError, original kept, tmp kept with the new bytes', async () => {
  const cause = Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
  const fs = fakeFs({ [FILE]: 'old' }, { failRename: cause });
  await assert.rejects(
    atomicReplace({ fs, path: FILE, bytes: Buffer.from('new'), expectedRevision: sha('old'), now }),
    (e) => e.name === 'RetryableSaveError' && norm(e.tmp) === TMP && e.cause === cause);
  assert.equal(fs.files.get(FILE).toString(), 'old');
  assert.equal(fs.files.get(TMP).toString(), 'new');
});

test('4. a missing file with expectedRevision null is created', async () => {
  const fs = fakeFs({});
  const r = await atomicReplace({ fs, path: FILE, bytes: Buffer.from('first'), expectedRevision: null, now });
  assert.equal(fs.files.get(FILE).toString(), 'first');
  assert.equal(r.revision, sha('first'));
});
