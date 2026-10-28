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

const { runAdapterContract } = require('./format-contract');

const fixtures = deepFreeze([
  { name: 'empty', bytes: new Uint8Array(0) },
  { name: 'crlf', bytes: new Uint8Array(Buffer.from('a\r\nb', 'utf8')) },
]);

const identity = {
  id: 'identity',
  open: (b) => ({ model: b, meta: {} }),
  serialize: (m) => m,
  scan: () => ({ supported: true, unsupported: [] }),
};

// a stand-in for node:test's test(): records each check, runs it later
function recorder() {
  const checks = [];
  const fakeTest = (name, fn) => { checks.push({ name, fn }); };
  const run = async () => {
    const out = [];
    for (const c of checks) {
      try { await c.fn(); out.push({ name: c.name, ok: true }); } catch (e) { out.push({ name: c.name, ok: false, error: e }); }
    }
    return out;
  };
  return { fakeTest, run, checks };
}

// the kit registers real tests too, so a wrong kit shows up in this run
runAdapterContract(test, identity, fixtures);

test('the identity adapter passes every check', async () => {
  const r = recorder();
  runAdapterContract(r.fakeTest, identity, fixtures);
  const results = await r.run();
  assert.ok(results.length >= 5, 'one id check plus a round trip and a scan per fixture');
  assert.deepEqual(results.filter((x) => !x.ok), []);
  const names = results.map((x) => x.name);
  assert.ok(names.includes('identity: no-edit round trip empty'));
  assert.ok(names.includes('identity: no-edit round trip crlf'));
});

test('an adapter that drops the last byte fails the round-trip check', async () => {
  const broken = { ...identity, id: 'broken', serialize: (m) => m.slice(0, Math.max(0, m.length - 1)) };
  const r = recorder();
  runAdapterContract(r.fakeTest, broken, fixtures);
  const results = await r.run();
  const failed = results.filter((x) => !x.ok).map((x) => x.name);
  assert.ok(failed.includes('broken: no-edit round trip crlf'), 'the crlf fixture must fail');
  assert.ok(failed.every((n) => n.startsWith('broken: no-edit round trip')), 'only round-trip checks fail');
});
