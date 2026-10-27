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

const { createIntent, createIntentVerifier } = require('../desktop/handoff');

const ID = deepFreeze({ fileId: 42, path: '/Docs/a.md', origin: 'https://cloud.example-tailnet.ts.net' });
const fixedBytes = (n) => new Uint8Array(n).fill(0xab);
const make = (now = 1000) => createIntent(ID, { now: () => now, randomBytes: fixedBytes });

test('1. the nonce is 32 hex chars from 16 random bytes', () => {
  let asked = 0;
  const intent = createIntent(ID, { now: () => 1000, randomBytes: (n) => { asked = n; return fixedBytes(n); } });
  assert.equal(asked, 16);
  assert.equal(intent.nonce, 'abababababababababababababababab');
});

test('2. expires is now plus the ttl', () => {
  assert.deepEqual(make(1000), { fileId: 42, path: '/Docs/a.md', origin: 'https://cloud.example-tailnet.ts.net', nonce: 'abababababababababababababababab', expires: 121000 });
});

test('3. the right nonce is ok once, then used', () => {
  const intent = make();
  const v = createIntentVerifier();
  assert.equal(v.verify(intent, intent.nonce, 2000), 'ok');
  assert.equal(v.verify(intent, intent.nonce, 2000), 'used');
});

test('4. after expires it is expired and not marked used', () => {
  const intent = make();
  const v = createIntentVerifier();
  assert.equal(v.verify(intent, intent.nonce, 121001), 'expired');
  assert.equal(v.verify(intent, intent.nonce, 2000), 'ok');
});

test('5. a different nonce is a mismatch', () => {
  const intent = make();
  const v = createIntentVerifier();
  assert.equal(v.verify(intent, 'f'.repeat(32), 2000), 'mismatch');
});
