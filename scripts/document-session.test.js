'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocumentSession } = require('../document-session');
const { runAdapterContract } = require('./format-contract');

const bytes = (text) => new Uint8Array(Buffer.from(text, 'utf8'));
const text = (value) => Buffer.from(value).toString('utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let fulfill, fail;
  const promise = new Promise((resolve, reject) => { fulfill = resolve; fail = reject; });
  return { promise, resolve: fulfill, reject: fail };
}
const adapter = {
  id: 'session-mock',
  scan: () => ({ supported: true, unsupported: [] }),
  open: (value, name) => ({ model: { text: text(value) }, meta: { name } }),
  serialize: (model) => bytes(model.text),
};
runAdapterContract(test, adapter, [{ name: 'roundtrip.txt', bytes: bytes('\uFEFFone\r\ntwo') }]);

function setup(overrides = {}) {
  const writes = [];
  const host = {
    read: (ref) => ({ bytes: bytes(ref), revision: 'r0' }),
    save: (ref, value, baseRevision) => {
      writes.push({ ref, text: text(value), baseRevision });
      return { revision: `r${writes.length}` };
    },
    ...overrides,
  };
  return { host, writes, session: createDocumentSession({ host, adapter }) };
}

test('open/edit/save uses only the host contract; clean saves do no work', async () => {
  const { session, writes } = setup();
  assert.equal(session.getState().state, 'loading');
  assert.throws(() => session.edit({ text: 'early' }));
  await assert.rejects(session.save());
  const opened = await session.open('file', 'draft.txt');
  assert.deepEqual(opened, { state: 'clean', ref: 'file', name: 'draft.txt',
    model: { text: 'file' }, meta: { name: 'draft.txt' }, originalBytes: bytes('file'),
    baseRevision: 'r0', editGeneration: 0, savedGeneration: 0,
    fidelity: { supported: true, unsupported: [] }, error: null, dirty: false });
  assert.equal(await session.save(), null);
  const model = { text: 'edited' };
  session.edit(model);
  model.text = 'changed outside the session';
  opened.originalBytes.fill(0);
  assert.equal(session.getState().state, 'dirty');
  assert.deepEqual(await session.save(), { revision: 'r1' });
  assert.deepEqual(writes, [{ ref: 'file', text: 'edited', baseRevision: 'r0' }]);
  const saved = session.getState();
  assert.equal(saved.state, 'clean');
  assert.equal(saved.dirty, false);
  assert.equal(saved.editGeneration, 1);
  assert.equal(saved.savedGeneration, 1);
  assert.deepEqual(saved.originalBytes, bytes('file'));
  await session.save();
  assert.equal(writes.length, 1);
});

test('a save acknowledges its captured model, leaving later edits dirty', async () => {
  const gate = deferred();
  const { session, host } = setup();
  const save = host.save;
  host.save = async (...args) => { await gate.promise; return save(...args); };
  await session.open('file', 'draft.txt');
  session.edit({ text: 'first' });
  const pending = session.save();
  await settle();
  session.edit({ text: 'later' });
  assert.equal(session.getState().state, 'saving');
  assert.equal(session.getState().dirty, true);
  gate.resolve();
  await pending;
  assert.equal(session.getState().state, 'dirty');
  assert.equal(session.getState().model.text, 'later');
  assert.equal(session.getState().savedGeneration, 1);
  assert.equal(session.getState().editGeneration, 2);
  await session.save();
  assert.equal(session.getState().state, 'clean');
});

test('queued saves coalesce and use the previous acknowledgement revision', async () => {
  const gate = deferred();
  const { session, host, writes } = setup();
  const save = host.save;
  host.save = async (...args) => { if (!writes.length) await gate.promise; return save(...args); };
  await session.open('file', 'draft.txt');
  session.edit({ text: 'a' });
  const a = session.save();
  await settle();
  session.edit({ text: 'b' });
  const b = session.save();
  session.edit({ text: 'c' });
  const c = session.save();
  let idle = false;
  const waiting = session.idle().then(() => { idle = true; });
  assert.equal(idle, false);
  gate.resolve();
  assert.deepEqual(await Promise.all([a, b, c]), [{ revision: 'r1' }, { revision: 'r2' }, { revision: 'r2' }]);
  await waiting;
  assert.deepEqual(writes, [{ ref: 'file', text: 'a', baseRevision: 'r0' },
    { ref: 'file', text: 'c', baseRevision: 'r1' }]);
  assert.equal(session.getState().savedGeneration, 3);
});

for (const stage of ['read', 'scan', 'open']) {
  for (const rejected of [false, true]) {
    test(`stale ${stage} ${rejected ? 'failure' : 'reply'} cannot replace a newer open`, async () => {
      const gate = deferred();
      const host = { read: (ref) => ({ bytes: bytes(ref), revision: ref }) };
      const format = { ...adapter };
      const target = stage === 'read' ? host : format;
      const original = target[stage];
      let first = true;
      target[stage] = async (...args) => {
        if (first) { first = false; await gate.promise; }
        return original(...args);
      };
      const session = createDocumentSession({ host, adapter: format });
      const old = session.open('old', 'old.txt');
      await settle();
      await session.open('new', 'new.txt');
      session.edit({ text: 'new edits' });
      const expected = session.getState();
      if (rejected) gate.reject(new Error('late error'));
      else gate.resolve();
      assert.equal(await old, null);
      assert.deepEqual(session.getState(), expected);
    });
  }
}

for (const stage of ['serialize', 'save']) {
  for (const rejected of [false, true]) {
    test(`stale ${stage} ${rejected ? 'failure' : 'reply'} cannot clear a newer document's edits`, async () => {
      const gate = deferred();
      const { host, writes } = setup();
      const format = { ...adapter };
      const target = stage === 'save' ? host : format;
      const original = target[stage];
      let first = true;
      target[stage] = async (...args) => {
        if (first) { first = false; await gate.promise; }
        return original(...args);
      };
      const session = createDocumentSession({ host, adapter: format });
      await session.open('old', 'old.txt');
      session.edit({ text: 'old edits' });
      const old = session.save();
      await settle();
      session.edit({ text: 'old queued edits' });
      const queued = session.save();
      await session.open('new', 'new.txt');
      session.edit({ text: 'new edits' });
      const expected = session.getState();
      if (rejected) gate.reject(new Error('late error'));
      else gate.resolve();
      assert.equal(await old, null);
      assert.equal(await queued, null);
      assert.deepEqual(session.getState(), expected);
      assert.equal(writes.length, stage === 'save' && !rejected ? 1 : 0);
      await session.save();
      assert.equal(writes.at(-1).ref, 'new');
      assert.equal(session.getState().state, 'clean');
    });
  }
}

for (const code of ['conflict', 'offline', 'permission-lost']) {
  test(`${code} from read or save retains the error and unacknowledged edits`, async () => {
    const error = Object.assign(new Error(code), { code });
    const { session, host } = setup({ read: () => { throw error; } });
    await assert.rejects(session.open('file', 'draft.txt'), (err) => err === error);
    assert.equal(session.getState().state, code);
    host.read = () => ({ bytes: bytes('original'), revision: 'r0' });
    await session.open('file', 'draft.txt');
    session.edit({ text: 'local' });
    host.save = () => { throw error; };
    await assert.rejects(session.save(), (err) => err === error);
    session.edit({ text: 'more local' });
    const state = session.getState();
    assert.equal(state.state, code);
    assert.equal(state.error, error);
    assert.equal(state.dirty, true);
    assert.equal(state.savedGeneration, 0);
    assert.equal(state.baseRevision, 'r0');
    assert.deepEqual(state.originalBytes, bytes('original'));
    host.save = () => ({ revision: 'r1' });
    if (code === 'conflict') await assert.rejects(session.save(), (err) => err === error);
    else { await session.save(); assert.equal(session.getState().state, 'clean'); }
  });
}

test('a failed save stops queued writes; only a subsequent explicit request retries', async () => {
  const gate = deferred();
  let calls = 0;
  const { session, host } = setup({ save: () => { calls++; return gate.promise; } });
  await session.open('file', 'draft.txt');
  session.edit({ text: 'a' });
  const a = session.save();
  await settle();
  session.edit({ text: 'b' });
  const b = session.save();
  const error = Object.assign(new Error('offline'), { code: 'offline' });
  const checking = [a, b].map((promise) => assert.rejects(promise, (err) => err === error));
  gate.reject(error);
  await Promise.all(checking);
  assert.equal(calls, 1);
  host.save = () => ({ revision: 'r1' });
  await session.save();
  assert.equal(session.getState().savedGeneration, 2);
});

test('unsupported fidelity is retained and blocks in-place writes', async () => {
  const { host, writes } = setup();
  const fidelity = { supported: false, unsupported: [{ feature: 'images', count: 1 }] };
  const session = createDocumentSession({ host, adapter: { ...adapter, scan: async () => fidelity } });
  await session.open('file', 'draft.txt');
  assert.deepEqual(session.getState().fidelity, fidelity);
  session.edit({ text: 'local' });
  await assert.rejects(session.save(), { code: 'unsupported-format' });
  assert.equal(session.getState().dirty, true);
  assert.equal(writes.length, 0);
});

test('adapter failures and missing save acknowledgements never mark edits saved', async () => {
  for (const failure of ['serialize', 'revision']) {
    const { host } = setup();
    const format = { ...adapter };
    if (failure === 'serialize') format.serialize = () => { throw new Error('adapter failure'); };
    else host.save = () => ({});
    const session = createDocumentSession({ host, adapter: format });
    await session.open('file', 'draft.txt');
    session.edit({ text: 'local' });
    await assert.rejects(session.save());
    assert.equal(session.getState().state, 'error');
    assert.equal(session.getState().savedGeneration, 0);
    assert.equal(session.getState().dirty, true);
    assert.equal(session.getState().baseRevision, 'r0');
  }
});

test('classic browser scripts expose the same session without Node or filesystem access', async () => {
  const context = vm.createContext({ structuredClone, Uint8Array });
  for (const file of ['document-session/serial.js', 'document-session.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  const { host, writes } = setup();
  const session = context.NeoCraft_DocumentSession.createDocumentSession({ host, adapter });
  await session.open('file', 'draft.txt');
  session.edit({ text: 'browser' });
  await session.save();
  assert.equal(writes[0].text, 'browser');
  assert.equal(session.getState().state, 'clean');
});
