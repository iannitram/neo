'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { mock } = require('node:test');
const { classifySaveResponse, guardedPut } = require('../hosts/dav-save');

const hdrs = (o = {}) => ({ get: (n) => { const k = Object.keys(o).find((x) => x.toLowerCase() === String(n).toLowerCase()); return k === undefined ? null : o[k]; } });
const bytes = new Uint8Array([1, 2, 3]);

test('1. 204 with an ETag keeps the quotes', () => {
  assert.deepEqual(classifySaveResponse(204, hdrs({ ETag: '"abc"' })), { kind: 'saved', etag: '"abc"', needsRefresh: false });
});

test('2. 201 without an ETag needs a refresh', () => {
  const r = classifySaveResponse(201, hdrs());
  assert.equal(r.kind, 'saved');
  assert.equal(r.etag, null);
  assert.equal(r.needsRefresh, true);
});

test('3. status classes', () => {
  assert.deepEqual(classifySaveResponse(412, hdrs()), { kind: 'conflict' });
  assert.deepEqual(classifySaveResponse(423, hdrs()), { kind: 'locked' });
  assert.deepEqual(classifySaveResponse(403, hdrs()), { kind: 'auth' });
  assert.deepEqual(classifySaveResponse(410, hdrs()), { kind: 'gone' });
  assert.deepEqual(classifySaveResponse(503, hdrs()), { kind: 'error', retryable: true, status: 503 });
  assert.deepEqual(classifySaveResponse(507, hdrs()), { kind: 'error', retryable: false, status: 507 });
});

test('4. a rejected fetch is ambiguous', async () => {
  const fetch = async () => { throw new TypeError('network'); };
  assert.deepEqual(await guardedPut({ fetch, url: 'https://h/f', bytes, etag: '"a"', requestToken: 't', timeoutMs: 1000 }), { kind: 'ambiguous' });
});

test('5. a fetch that never answers is aborted after timeoutMs and is ambiguous', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let signal;
    // like a real fetch: never resolves, rejects when its signal aborts
    const fetch = (url, init) => new Promise((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const p = guardedPut({ fetch, url: 'https://h/f', bytes, etag: '"a"', requestToken: 't', timeoutMs: 10 });
    mock.timers.tick(10);
    assert.deepEqual(await p, { kind: 'ambiguous' });
    assert.equal(signal.aborted, true);
  } finally {
    mock.timers.reset();
  }
});

test('6. an empty etag throws TypeError and never calls fetch', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return { status: 204, headers: hdrs() }; };
  await assert.rejects(guardedPut({ fetch, url: 'https://h/f', bytes, etag: '', requestToken: 't' }), TypeError);
  assert.equal(calls, 0);
});

test('7. If-Match is sent exactly as given', async () => {
  const seen = [];
  const fetch = async (url, init) => { seen.push([url, init]); return { status: 204, headers: hdrs({ ETag: '"n"' }) }; };
  const r = await guardedPut({ fetch, url: 'https://h/f', bytes, etag: 'W/"x y"', requestToken: 'tok', timeoutMs: 1000 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'https://h/f');
  assert.equal(seen[0][1].method, 'PUT');
  assert.equal(seen[0][1].body, bytes);
  assert.equal(seen[0][1].headers['If-Match'], 'W/"x y"');
  assert.equal(seen[0][1].headers.requesttoken, 'tok');
  assert.deepEqual(r, { kind: 'saved', etag: '"n"', needsRefresh: false });
});
