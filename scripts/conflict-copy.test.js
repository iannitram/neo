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

const { conflictCopyName, createExclusive } = require('../hosts/conflict-copy');
const D = new Date('2026-10-26T14:05:09Z');
const STAMP = '(conflict 2026-10-26 14-05)';
const hdrs = (o = {}) => ({ get: (n) => { const k = Object.keys(o).find((x) => x.toLowerCase() === String(n).toLowerCase()); return k === undefined ? null : o[k]; } });
const mkFetch = (statuses) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push([url, init]);
    const s = statuses[calls.length - 1];
    if (s === 'reject') throw new TypeError('network');
    return { status: s, headers: hdrs({ ETag: '"e' + calls.length + '"' }) };
  };
  return { fetch, calls };
};
const args = (fetch) => deepFreeze({ folderUrl: 'https://h.example/remote.php/dav/files/u/Docs', fileName: 'Notes.docx', bytes: 'B', date: D, requestToken: 'tok' });

test('1. names', () => {
  assert.equal(conflictCopyName('Notes.docx', D, 1), 'Notes ' + STAMP + '.docx');
  assert.equal(conflictCopyName('Notes.docx', D, 2), 'Notes ' + STAMP + ' 2.docx');
  assert.equal(conflictCopyName('README', D, 1), 'README ' + STAMP);
  assert.equal(conflictCopyName('.env', D, 1), '.env ' + STAMP);
  assert.equal(conflictCopyName('a.tar.gz', D, 1), 'a.tar ' + STAMP + '.gz');
});

test('2. 412 then 201 creates the attempt-2 name with If-None-Match: *', async () => {
  const { fetch, calls } = mkFetch([412, 201]);
  const r = await createExclusive({ fetch, ...args() });
  const name2 = 'Notes ' + STAMP + ' 2.docx';
  assert.equal(r.kind, 'created');
  assert.equal(r.name, name2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'https://h.example/remote.php/dav/files/u/Docs/' + encodeURIComponent('Notes ' + STAMP + '.docx'));
  assert.equal(calls[1][0], 'https://h.example/remote.php/dav/files/u/Docs/' + encodeURIComponent(name2));
  for (const [, init] of calls) {
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers['If-None-Match'], '*');
    assert.equal(init.headers.requesttoken, 'tok');
  }
});

test('3. a rejected fetch is ambiguous and no other name is tried', async () => {
  const { fetch, calls } = mkFetch(['reject']);
  const r = await createExclusive({ fetch, ...args() });
  assert.equal(r.kind, 'ambiguous');
  assert.equal(r.name, 'Notes ' + STAMP + '.docx');
  assert.equal(calls.length, 1);
});

test('4. 403 is an error with its status', async () => {
  const { fetch } = mkFetch([403]);
  const r = await createExclusive({ fetch, ...args() });
  assert.equal(r.kind, 'error');
  assert.equal(r.status, 403);
});

test('every attempt 412 ends in error 412', async () => {
  const { fetch, calls } = mkFetch([412, 412, 412]);
  const r = await createExclusive({ fetch, ...args(), maxAttempts: 3 });
  assert.equal(r.kind, 'error');
  assert.equal(r.status, 412);
  assert.equal(calls.length, 3);
});
