'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createSaveSerializer, createRequestGuard } = require('../document-session/serial');

const settle = () => new Promise((resolve) => setImmediate(resolve));
// every save waits on a gate the test opens
function gated() {
  const calls = [], gates = {};
  let running = 0, maxRunning = 0;
  const saveFn = (s) => {
    calls.push(s); running++; maxRunning = Math.max(maxRunning, running);
    return new Promise((resolve, reject) => { gates[s] = { resolve: (v) => { running--; resolve(v); }, reject: (e) => { running--; reject(e); } }; });
  };
  return { calls, gates, saveFn, max: () => maxRunning };
}

test('1. two saves in a row never overlap', async () => {
  let running = 0, max = 0;
  const saveFn = async () => { running++; max = Math.max(max, running); await settle(); running--; return 'ok'; };
  const s = createSaveSerializer(saveFn);
  await Promise.all([s.save('x'), s.save('y')]);
  assert.equal(max, 1);
});

test('2. while a runs, b then c: b is dropped, c runs, both resolve to c\'s result', async () => {
  const g = gated();
  const s = createSaveSerializer(g.saveFn);
  const pa = s.save('a');
  await settle();
  const pb = s.save('b');
  const pc = s.save('c');
  g.gates.a.resolve('ra');
  await settle();
  g.gates.c.resolve('rc');
  assert.equal(await pa, 'ra');
  assert.equal(await pb, 'rc');
  assert.equal(await pc, 'rc');
  assert.deepEqual(g.calls, ['a', 'c']);
  assert.equal(g.max(), 1);
});

test('3. a rejected save does not block later saves', async () => {
  const err = new Error('disk');
  const saveFn = async (x) => { if (x === 'a') throw err; return 'r' + x; };
  const s = createSaveSerializer(saveFn);
  await assert.rejects(s.save('a'), (e) => e === err);
  assert.equal(await s.save('d'), 'rd');
});

test('4. idle resolves only after the queued save finishes', async () => {
  const g = gated();
  const s = createSaveSerializer(g.saveFn);
  s.save('a');
  await settle();
  s.save('b');
  let idle = false;
  const pi = s.idle().then(() => { idle = true; });
  g.gates.a.resolve('ra');
  await settle();
  assert.equal(idle, false);
  g.gates.b.resolve('rb');
  await pi;
  assert.equal(idle, true);
});

test('5. the request guard knows only the latest token', () => {
  const g = createRequestGuard();
  const t1 = g.next();
  const t2 = g.next();
  assert.equal(t1, 1);
  assert.equal(t2, 2);
  assert.equal(g.isCurrent(t1), false);
  assert.equal(g.isCurrent(t2), true);
});
