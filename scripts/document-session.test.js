'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  createDocumentSession,
  ConflictError,
  OfflineError,
  PermissionLostError,
} = require('../document-session.js');

// No timers: replies are held and released by the test, and flush() only
// waits for pending promise callbacks.
const flush = () => new Promise((resolve) => setImmediate(resolve));
const enc = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const dec = (b) => Buffer.from(b).toString('utf8');
const copy = (b) => new Uint8Array(b);
const REF = { name: 'notes.txt', path: '/Documents/notes.txt' };

// A storage host with the contract's shape. It keeps one stored file and a
// revision counter, refuses a save whose base revision is not the stored one
// (as a 412 would), and records every call. Each call's outcome is decided
// when the call is made; with hold[op] set, its reply is kept until the test
// releases it, so late replies are real.
function mockHost(initialText) {
  const host = {
    calls: [],
    stored: { bytes: enc(initialText), revision: 'r1' },
    held: { read: [], save: [] },
    hold: { read: false, save: false },
    failNext: { read: null, save: null },
    read(ref) {
      return call('read', ref, undefined, () => ({
        bytes: copy(host.stored.bytes),
        revision: host.stored.revision,
      }));
    },
    save(ref, bytes, baseRevision) {
      return call('save', ref, { base: baseRevision, text: dec(bytes) }, () => {
        if (baseRevision !== host.stored.revision) throw new ConflictError();
        const n = Number(host.stored.revision.slice(1)) + 1;
        host.stored = { bytes: copy(bytes), revision: `r${n}` };
        return { revision: host.stored.revision };
      });
    },
    // deliver the held reply at index (0 = oldest)
    release(op, index = 0) {
      host.held[op].splice(index, 1)[0]();
    },
  };

  function call(op, ref, detail, work) {
    host.calls.push({ op, ref, detail });
    let deliver;
    try {
      const fail = host.failNext[op];
      if (fail) {
        host.failNext[op] = null;
        throw fail;
      }
      const value = work();
      deliver = (resolve) => resolve(value);
    } catch (error) {
      deliver = (resolve, reject) => reject(error);
    }
    return new Promise((resolve, reject) => {
      const reply = () => deliver(resolve, reject);
      if (host.hold[op]) host.held[op].push(reply);
      else reply();
    });
  }

  return host;
}

function textAdapter(scanResult) {
  return {
    id: 'text',
    open: (bytes) => ({ model: dec(bytes), meta: {} }),
    serialize: (model) => enc(model),
    scan: () => scanResult || { supported: true, unsupported: [] },
  };
}

function open(text, options = {}) {
  const host = mockHost(text);
  const session = createDocumentSession({
    ref: REF,
    host,
    adapter: textAdapter(options.scan),
    now: options.now || (() => 1000),
  });
  return { host, session };
}

// records every state the session moves to, in order
function track(session) {
  const seen = [];
  session.subscribe((state) => seen.push(state));
  return seen;
}

test('open reads the one ref and loads the document: loading, then clean', async () => {
  const { host, session } = open('hello');
  const states = track(session);
  assert.equal(session.state, 'closed');
  await session.open();
  assert.deepEqual(states, ['loading', 'clean']);
  assert.equal(session.state, 'clean');
  assert.equal(session.getModel(), 'hello');
  assert.equal(session.baseRevision, 'r1');
  assert.equal(dec(session.originalBytes), 'hello');
  assert.deepEqual(session.fidelity, { supported: true, unsupported: [] });
  assert.equal(session.editGeneration, 0);
  assert.equal(session.savedGeneration, 0);
  assert.equal(session.dirty, false);
  assert.equal(session.ref, REF);
  assert.deepEqual(host.calls, [{ op: 'read', ref: REF, detail: undefined }]);
});

test('each session gets its own id on the same ref', () => {
  const a = open('x').session;
  const b = open('x').session;
  assert.equal(typeof a.id, 'string');
  assert.notEqual(a.id, b.id);
  assert.equal(a.ref, b.ref);
});

test('clean becomes dirty on the first edit', async () => {
  const { session } = open('hello');
  await session.open();
  const states = track(session);
  session.edit('hello there');
  assert.deepEqual(states, ['dirty']);
  assert.equal(session.getModel(), 'hello there');
  assert.equal(session.editGeneration, 1);
  assert.equal(session.savedGeneration, 0);
  assert.equal(session.dirty, true);
});

test('edit also accepts an updater that gets the current model', async () => {
  const { session } = open('hello');
  await session.open();
  session.edit((m) => `${m}!`);
  assert.equal(session.getModel(), 'hello!');
});

test('dirty goes to saving, then clean; the save writes the new bytes on the base revision', async () => {
  const { host, session } = open('a', { now: () => 4242 });
  await session.open();
  session.edit('b');
  host.hold.save = true;
  const states = track(session);
  const pending = session.save();
  await flush();
  assert.equal(session.state, 'saving');
  host.release('save');
  assert.deepEqual(await pending, { saved: true, revision: 'r2' });
  assert.deepEqual(states, ['saving', 'clean']);
  assert.equal(session.state, 'clean');
  assert.equal(session.savedGeneration, 1);
  assert.equal(session.dirty, false);
  assert.equal(session.baseRevision, 'r2');
  assert.equal(dec(session.originalBytes), 'b');
  assert.equal(session.savedAt, 4242);
  assert.deepEqual(host.calls.at(-1), { op: 'save', ref: REF, detail: { base: 'r1', text: 'b' } });
});

test('an edit made while a save is in flight keeps the session dirty', async () => {
  const { host, session } = open('a');
  await session.open();
  session.edit('b');
  host.hold.save = true;
  const first = session.save();
  await flush();
  session.edit('c');
  assert.equal(session.state, 'saving');
  host.release('save');
  assert.deepEqual(await first, { saved: true, revision: 'r2' });
  // the reply covered generation 1 only; generation 2 is still unsaved
  assert.equal(session.state, 'dirty');
  assert.equal(session.savedGeneration, 1);
  assert.equal(session.editGeneration, 2);
  assert.equal(session.dirty, true);
  assert.equal(dec(session.originalBytes), 'b');

  host.hold.save = false;
  assert.deepEqual(await session.save(), { saved: true, revision: 'r3' });
  assert.equal(session.state, 'clean');
  assert.equal(session.dirty, false);
  assert.equal(dec(host.stored.bytes), 'c');
});

test('saves never overlap: a second save waits for the first reply', async () => {
  const { host, session } = open('a');
  await session.open();
  session.edit('b');
  host.hold.save = true;
  const first = session.save();
  await flush();
  session.edit('c');
  const second = session.save();
  await flush();
  assert.equal(host.held.save.length, 1, 'only the first save is on the wire');
  host.release('save');
  await first;
  await flush();
  assert.equal(host.held.save.length, 1, 'the second save starts after the first');
  host.release('save');
  assert.deepEqual(await second, { saved: true, revision: 'r3' });
  assert.equal(session.state, 'clean');
  assert.equal(dec(host.stored.bytes), 'c');
});

test('a save with nothing unsaved makes no host call', async () => {
  const { host, session } = open('a');
  await session.open();
  assert.deepEqual(await session.save(), { saved: false, reason: 'clean', revision: 'r1' });
  assert.equal(session.state, 'clean');
  assert.deepEqual(host.calls.map((c) => c.op), ['read']);
});

test('conflict: a moved server revision stops the save, keeps the edits, and never overwrites', async () => {
  const { host, session } = open('a');
  await session.open();
  session.edit('mine');
  host.stored = { bytes: enc('theirs'), revision: 'r7' }; // another writer got there first
  await assert.rejects(session.save(), (e) => e instanceof ConflictError && e.code === 'conflict');
  assert.equal(session.state, 'conflict');
  assert.equal(session.dirty, true);
  assert.ok(session.error instanceof ConflictError);
  assert.equal(session.baseRevision, 'r1');
  assert.equal(dec(host.stored.bytes), 'theirs');
});

test('offline: an OfflineError keeps the edits, and a later save goes clean', async () => {
  const { host, session } = open('a');
  await session.open();
  session.edit('b');
  host.failNext.save = new OfflineError();
  const states = track(session);
  await assert.rejects(session.save(), OfflineError);
  assert.equal(session.state, 'offline');
  assert.equal(session.dirty, true);
  assert.equal(dec(host.stored.bytes), 'a');
  await session.save();
  assert.deepEqual(states, ['saving', 'offline', 'saving', 'clean']);
  assert.equal(dec(host.stored.bytes), 'b');
});

test('permission-lost: a PermissionLostError keeps the edits and writes nothing', async () => {
  const { host, session } = open('a');
  await session.open();
  session.edit('b');
  host.failNext.save = new PermissionLostError();
  await assert.rejects(session.save(), PermissionLostError);
  assert.equal(session.state, 'permission-lost');
  assert.equal(session.dirty, true);
  assert.equal(dec(host.stored.bytes), 'a');
});

test('a host error with a matching code maps the same way, so a host in another realm works', async () => {
  const { host, session } = open('a');
  await session.open();
  session.edit('b');
  host.failNext.save = Object.assign(new Error('network'), { code: 'offline' });
  await assert.rejects(session.save(), /network/);
  assert.equal(session.state, 'offline');
});

test('any other host error leaves the session dirty with the error recorded', async () => {
  const { host, session } = open('a');
  await session.open();
  session.edit('b');
  const disk = new Error('disk full');
  host.failNext.save = disk;
  await assert.rejects(session.save(), (e) => e === disk);
  assert.equal(session.state, 'dirty');
  assert.equal(session.dirty, true);
  assert.equal(session.error, disk);
  await session.save();
  assert.equal(session.state, 'clean');
  assert.equal(session.error, null);
});

test('open failures: offline and permission-lost set their states; other errors close the session', async () => {
  const { host, session } = open('a');
  host.failNext.read = new OfflineError();
  await assert.rejects(session.open(), OfflineError);
  assert.equal(session.state, 'offline');

  host.failNext.read = new PermissionLostError();
  await assert.rejects(session.open(), PermissionLostError);
  assert.equal(session.state, 'permission-lost');

  const boom = new Error('corrupt');
  host.failNext.read = boom;
  await assert.rejects(session.open(), (e) => e === boom);
  assert.equal(session.state, 'closed');
  assert.equal(session.getModel(), undefined);
});

test('a late open reply after a newer open() is ignored', async () => {
  const { host, session } = open('A');
  host.hold.read = true;
  const older = session.open();
  host.stored = { bytes: enc('B'), revision: 'r5' };
  const newer = session.open();
  const states = track(session);

  host.release('read', 1); // the newer reply arrives first
  await newer;
  assert.equal(session.getModel(), 'B');
  assert.equal(session.baseRevision, 'r5');

  host.release('read', 0); // then the older one, late
  await older;
  assert.equal(session.getModel(), 'B');
  assert.equal(session.baseRevision, 'r5');
  assert.equal(session.state, 'clean');
  assert.deepEqual(states, ['clean'], 'the late reply moved no state');
});

test('a late open failure after a newer open succeeded is ignored, not reported', async () => {
  const { host, session } = open('A');
  host.failNext.read = new OfflineError();
  host.hold.read = true;
  const older = session.open(); // this reply will fail
  const newer = session.open();
  host.release('read', 1);
  await newer;
  host.release('read', 0);
  await older; // resolves: the stale failure is not reported
  assert.equal(session.state, 'clean');
  assert.equal(session.getModel(), 'A');
});

test('open refuses to replace unsaved edits', async () => {
  const { session } = open('a');
  await session.open();
  session.edit('b');
  await assert.rejects(session.open(), /unsaved edits/);
  assert.equal(session.getModel(), 'b');
});

test('close during a save: the late reply changes nothing and nothing else reaches the host', async () => {
  const { host, session } = open('a');
  await session.open();
  session.edit('b');
  host.hold.save = true;
  const pending = session.save();
  await flush();
  const closing = session.close();
  assert.equal(session.state, 'closed');
  host.release('save');
  await closing;
  assert.deepEqual(await pending, { saved: false, reason: 'closed' });
  assert.equal(session.baseRevision, 'r1');
  assert.equal(session.savedGeneration, 0);
  assert.equal(session.state, 'closed');

  assert.throws(() => session.edit('c'), /closed/);
  await assert.rejects(session.save(), /closed/);
  assert.equal(host.calls.length, 2, 'only the read and the one save that was already sent');
});

test('edit and save before open are refused', async () => {
  const { session } = open('a');
  assert.throws(() => session.edit('b'), /no document/);
  await assert.rejects(session.save(), /no document/);
  assert.equal(session.state, 'closed');
});

test('no library files: every host call is a read or a save on the one ref', async () => {
  const { host, session } = open('a');
  await session.open();
  session.edit('b');
  await session.save();
  session.edit('c');
  await session.save();
  assert.deepEqual(host.calls.map((c) => c.op), ['read', 'save', 'save']);
  for (const c of host.calls) assert.equal(c.ref, REF);
});

test('fidelity comes from the adapter scan on open', async () => {
  const scan = { supported: false, unsupported: [{ feature: 'footnotes', count: 2 }] };
  const { session } = open('a', { scan });
  await session.open();
  assert.deepEqual(session.fidelity, scan);
});

test('subscribe returns an unsubscribe function', async () => {
  const { session } = open('a');
  let calls = 0;
  const stop = session.subscribe(() => { calls += 1; });
  await session.open();
  const before = calls;
  stop();
  session.close();
  assert.equal(calls, before);
  assert.ok(before > 0);
});
