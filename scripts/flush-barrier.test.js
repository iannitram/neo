'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createFlushBarrier } = require('../flush-barrier');

const deferred = () => { let resolve, reject; const promise = new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject; }); return { promise, resolve, reject }; };
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fakeTimers() {
  let id = 0, t = 0; const timers = new Map();
  return {
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    clearTimer: (h) => { timers.delete(h); },
    advance: (ms) => { t += ms; for (const [h, x] of [...timers]) if (x.at <= t) { timers.delete(h); x.fn(); } },
  };
}
const make = () => { const ft = fakeTimers(); return { ft, b: createFlushBarrier({ setTimer: ft.setTimer, clearTimer: ft.clearTimer }) }; };

test('1. nothing tracked resolves at once', async () => {
  const { b } = make();
  assert.deepEqual(await b.flush(1000), { ok: true, failed: [], timedOut: [] });
});

test('2. a failed write is reported after the others settle, and only once', async () => {
  const { b } = make();
  const a = deferred();
  const ta = b.track(a.promise, 'a');
  const bad = b.track(Promise.reject(new Error('x')), 'b');
  bad.catch(() => {}); ta.catch(() => {});
  const p = b.flush(1000);
  let done = false; p.then(() => { done = true; });
  await settle();
  assert.equal(done, false);
  a.resolve();
  assert.deepEqual(await p, { ok: false, failed: ['b'], timedOut: [] });
  assert.deepEqual(await b.flush(1000), { ok: true, failed: [], timedOut: [] });
});

test('3. a write that never settles times out', async () => {
  const { ft, b } = make();
  b.track(new Promise(() => {}), 'c');
  const p = b.flush(50);
  await settle();
  ft.advance(50);
  assert.deepEqual(await p, { ok: false, failed: [], timedOut: ['c'] });
});

test('4. a write tracked while flush is waiting is waited for too', async () => {
  const { b } = make();
  const a = deferred(); const d = deferred();
  b.track(a.promise, 'a');
  const p = b.flush(1000);
  let done = false; p.then(() => { done = true; });
  await settle();
  b.track(d.promise, 'd');
  a.resolve();
  await settle();
  assert.equal(done, false);
  d.resolve();
  assert.deepEqual(await p, { ok: true, failed: [], timedOut: [] });
});

test('5. pending lists running labels in order and drops settled ones; track returns the same promise', async () => {
  const { b } = make();
  const a = deferred(); const c = deferred();
  assert.equal(b.track(a.promise, 'a'), a.promise);
  b.track(c.promise, 'b');
  assert.deepEqual(b.pending(), ['a', 'b']);
  a.resolve();
  await settle();
  assert.deepEqual(b.pending(), ['b']);
});

test('6. a write tracked while flush is waiting that rejects is reported', async () => {
  const { b } = make();
  const a = deferred(); const late = deferred();
  b.track(a.promise, 'a');
  const p = b.flush(1000);
  await settle();
  b.track(late.promise, 'late').catch(() => {});
  late.reject(new Error('x'));
  a.resolve();
  assert.deepEqual(await p, { ok: false, failed: ['late'], timedOut: [] });
});

test('7. a write that rejected before flush is reported by the next flush, once', async () => {
  const { b } = make();
  b.track(Promise.reject(new Error('x')), 'early').catch(() => {});
  await settle();
  assert.deepEqual(b.pending(), []);
  assert.deepEqual(await b.flush(1000), { ok: false, failed: ['early'], timedOut: [] });
  assert.deepEqual(await b.flush(1000), { ok: true, failed: [], timedOut: [] });
});

test('8. the timeout covers writes tracked while flush is waiting', async () => {
  const { ft, b } = make();
  b.track(new Promise(() => {}), 'c');
  const p = b.flush(50);
  await settle();
  b.track(new Promise(() => {}), 'd');
  await settle();
  ft.advance(50);
  assert.deepEqual(await p, { ok: false, failed: [], timedOut: ['c', 'd'] });
});

test('9. loads as a classic browser script and still works under require', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const file = path.join(__dirname, '..', 'flush-barrier.js');
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInContext(ctx));
  assert.equal(typeof ctx.window.NeoCraft_FlushBarrier.createFlushBarrier, 'function');
  assert.equal(typeof require('../flush-barrier').createFlushBarrier, 'function');
});
