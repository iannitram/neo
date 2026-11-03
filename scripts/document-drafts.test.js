'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');
const { createDrafts, createIndexedDbStore, DraftError, DEFAULT_RETENTION_MS } = require('../document-session/drafts');
const { createDocumentSession } = require('../document-session');

const settle = () => new Promise((resolve) => setImmediate(resolve));
// queued store work and its reports take a few turns of the event loop
const idle = async () => { for (let i = 0; i < 5; i++) await settle(); };
const bytes = (value) => new Uint8Array(Buffer.from(value, 'utf8'));
const text = (value) => Buffer.from(value).toString('utf8');

function quotaError() {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

// In-memory STORE CONTRACT. Switches: quota (puts fail as a full disk),
// failDelete (deletes are refused). `items` is the disk, so a new createDrafts
// over the same store is a page reload.
function memoryStore() {
  const items = new Map();
  const store = {
    quota: false,
    failDelete: false,
    opened: 0,
    items,
    open: async () => { store.opened += 1; },
    get: async (key) => structuredClone(items.get(key)),
    put: async (key, record) => {
      await settle();
      if (store.quota) throw quotaError();
      items.set(key, structuredClone(record));
    },
    delete: async (key) => {
      await settle();
      if (store.failDelete) throw new Error('disk refuses the delete');
      items.delete(key);
    },
    keys: async () => [...items.keys()],
  };
  return store;
}

function clock(start = 1_000_000) {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
}

const draftOf = (drafts, account, ref) => drafts.findDraft(account, ref);
const edit = (model, generation, name = 'chapter.txt') => ({ name, model, meta: null, generation });

describe('recovery drafts', () => {
  test('reload after an unsaved edit offers the draft back for the same account and file', async () => {
    const store = memoryStore();
    const before = createDrafts({ store, now: clock().now });
    await before.write('acct-1', 'Notes/a.md', edit({ text: 'typed before the crash' }, 3));
    // a new page load: new drafts module over the same durable store
    const after = createDrafts({ store, now: clock().now });
    let asked = null;
    const kept = await after.offerDraft('acct-1', 'Notes/a.md', (draft) => { asked = draft; return true; });
    assert.equal(asked.model.text, 'typed before the crash');
    assert.equal(asked.generation, 3);
    assert.equal(asked.name, 'chapter.txt');
    assert.equal(kept.model.text, 'typed before the crash');
    assert.equal((await draftOf(after, 'acct-1', 'Notes/a.md')).model.text, 'typed before the crash');
  });

  test('offerDraft with a declined draft discards it; with no draft, decide is not called', async () => {
    const store = memoryStore();
    const drafts = createDrafts({ store, now: clock().now });
    await drafts.write('acct-1', 'a.txt', edit({ text: 'old' }, 1));
    assert.equal(await drafts.offerDraft('acct-1', 'a.txt', () => false), null);
    assert.equal(await draftOf(drafts, 'acct-1', 'a.txt'), null);
    let called = false;
    assert.equal(await drafts.offerDraft('acct-1', 'a.txt', () => { called = true; return true; }), null);
    assert.equal(called, false);
    await assert.rejects(drafts.offerDraft('acct-1', 'a.txt'), TypeError);
  });

  test('a confirmed save removes the draft; a draft from a later edit survives it', async () => {
    const store = memoryStore();
    const drafts = createDrafts({ store, now: clock().now });
    await drafts.write('acct-1', 'a.txt', edit({ text: 'one' }, 1));
    await drafts.clear('acct-1', 'a.txt', 1);
    assert.equal(await draftOf(drafts, 'acct-1', 'a.txt'), null);

    await drafts.write('acct-1', 'a.txt', edit({ text: 'two' }, 2));
    await drafts.write('acct-1', 'a.txt', edit({ text: 'three' }, 3));
    await drafts.clear('acct-1', 'a.txt', 2); // the save of edit 2 landed; edit 3 is unsaved
    assert.equal((await draftOf(drafts, 'acct-1', 'a.txt')).model.text, 'three');
    await drafts.clear('acct-1', 'a.txt', 3);
    assert.equal(await draftOf(drafts, 'acct-1', 'a.txt'), null);
  });

  test('drafts of another account are never returned, even for the same file', async () => {
    const store = memoryStore();
    const drafts = createDrafts({ store, now: clock().now });
    await drafts.write('acct-1', 'shared/notes.md', edit({ text: 'first account' }, 1));
    assert.equal(await draftOf(drafts, 'acct-2', 'shared/notes.md'), null);
    assert.equal(await drafts.offerDraft('acct-2', 'shared/notes.md', () => true), null);
    // a record moved under another account's key is still refused on read
    const [key] = [...store.items.keys()];
    const moved = JSON.stringify(['acct-2', 'shared/notes.md']);
    store.items.set(moved, store.items.get(key));
    assert.equal(await draftOf(drafts, 'acct-2', 'shared/notes.md'), null);
    // other files of the same account are separate
    assert.equal(await draftOf(drafts, 'acct-1', 'other.md'), null);
    // one account's logout leaves the other's drafts
    await drafts.write('acct-2', 'own.md', edit({ text: 'second account' }, 1));
    await drafts.clearAccount('acct-1');
    assert.equal(await draftOf(drafts, 'acct-1', 'shared/notes.md'), null);
    assert.equal((await draftOf(drafts, 'acct-2', 'own.md')).model.text, 'second account');
  });

  test('logout clears every draft of that account and nothing else', async () => {
    const store = memoryStore();
    const drafts = createDrafts({ store, now: clock().now });
    await drafts.write('acct-1', 'a.txt', edit({ text: 'a' }, 1));
    await drafts.write('acct-1', 'b.txt', edit({ text: 'b' }, 1));
    await drafts.write('acct-2', 'a.txt', edit({ text: 'other' }, 1));
    await drafts.clearAccount('acct-1');
    assert.equal(await draftOf(drafts, 'acct-1', 'a.txt'), null);
    assert.equal(await draftOf(drafts, 'acct-1', 'b.txt'), null);
    assert.equal((await draftOf(drafts, 'acct-2', 'a.txt')).model.text, 'other');
    assert.equal(store.items.size, 1);
  });

  test('a quota failure rejects with a typed error and keeps the older draft', async () => {
    const store = memoryStore();
    const drafts = createDrafts({ store, now: clock().now });
    await drafts.write('acct-1', 'a.txt', edit({ text: 'saved a little while ago' }, 1));
    store.quota = true;
    const failed = drafts.write('acct-1', 'a.txt', edit({ text: 'the newest words' }, 2));
    await assert.rejects(failed, (error) => {
      assert.ok(error instanceof DraftError);
      assert.equal(error.code, 'quota');
      assert.equal(error.cause.name, 'QuotaExceededError');
      return true;
    });
    store.quota = false;
    assert.equal((await draftOf(drafts, 'acct-1', 'a.txt')).model.text, 'saved a little while ago');
  });

  test('a refused delete is reported as a storage error, not swallowed', async () => {
    const store = memoryStore();
    const drafts = createDrafts({ store, now: clock().now });
    await drafts.write('acct-1', 'a.txt', edit({ text: 'x' }, 1));
    store.failDelete = true;
    await assert.rejects(drafts.clear('acct-1', 'a.txt', 1), (error) => error.code === 'storage' && error instanceof DraftError);
    await assert.rejects(drafts.discard('acct-1', 'a.txt'), { code: 'storage' });
    await assert.rejects(drafts.clearAccount('acct-1'), { code: 'storage' });
    store.failDelete = false;
    assert.equal((await draftOf(drafts, 'acct-1', 'a.txt')).model.text, 'x');
  });

  test('a store that will not open rejects every call with a storage error', async () => {
    const store = memoryStore();
    store.open = async () => { throw new Error('database locked'); };
    const drafts = createDrafts({ store, now: clock().now });
    await assert.rejects(drafts.findDraft('acct-1', 'a.txt'), { code: 'storage' });
  });

  test('drafts older than the retention limit are dropped, judged by the injected clock', async () => {
    const store = memoryStore();
    const time = clock();
    const drafts = createDrafts({ store, now: time.now, retentionMs: 1000 });
    assert.equal(drafts.retentionMs, 1000);
    assert.equal(DEFAULT_RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
    await drafts.write('acct-1', 'old.txt', edit({ text: 'old' }, 1));
    time.advance(600);
    await drafts.write('acct-1', 'new.txt', edit({ text: 'new' }, 1));
    time.advance(500); // old is 1100 ms old, new is 500 ms
    assert.equal(await draftOf(drafts, 'acct-1', 'old.txt'), null);
    assert.equal(store.items.has(JSON.stringify(['acct-1', 'old.txt'])), false);
    assert.equal((await draftOf(drafts, 'acct-1', 'new.txt')).model.text, 'new');
  });

  test('a draft kept current by typing does not expire', async () => {
    const store = memoryStore();
    const time = clock();
    const drafts = createDrafts({ store, now: time.now, retentionMs: 1000 });
    for (let i = 0; i < 5; i++) {
      await drafts.write('acct-1', 'a.txt', edit({ text: `edit ${i}` }, i + 1));
      time.advance(800);
    }
    assert.equal((await draftOf(drafts, 'acct-1', 'a.txt')).model.text, 'edit 4');
  });

  test('prune removes expired drafts across every account and counts them', async () => {
    const store = memoryStore();
    const time = clock();
    const drafts = createDrafts({ store, now: time.now, retentionMs: 1000 });
    await drafts.write('acct-1', 'a.txt', edit({ text: 'a' }, 1));
    await drafts.write('acct-2', 'b.txt', edit({ text: 'b' }, 1));
    time.advance(900);
    await drafts.write('acct-2', 'c.txt', edit({ text: 'c' }, 1));
    time.advance(200);
    assert.equal(await drafts.prune(), 2);
    assert.deepEqual([...store.items.keys()], [JSON.stringify(['acct-2', 'c.txt'])]);
  });

  test('writes, reads and clears run in call order: the last write wins', async () => {
    const store = memoryStore();
    const drafts = createDrafts({ store, now: clock().now });
    const first = drafts.write('acct-1', 'a.txt', edit({ text: '1' }, 1));
    const second = drafts.write('acct-1', 'a.txt', edit({ text: '2' }, 2));
    const seen = drafts.findDraft('acct-1', 'a.txt');
    await Promise.all([first, second]);
    assert.equal((await seen).model.text, '2');
    assert.equal(store.opened, 1);
  });

  test('a write is copied when it is queued, so the caller may keep mutating its model', async () => {
    const store = memoryStore();
    const drafts = createDrafts({ store, now: clock().now });
    const model = { text: 'as queued' };
    const pending = drafts.write('acct-1', 'a.txt', edit(model, 1));
    model.text = 'changed afterwards';
    await pending;
    assert.equal((await draftOf(drafts, 'acct-1', 'a.txt')).model.text, 'as queued');
  });

  test('bad arguments are refused at the call', () => {
    const drafts = createDrafts({ store: memoryStore(), now: clock().now });
    assert.throws(() => drafts.write('', 'a.txt', edit({}, 1)), TypeError);
    assert.throws(() => drafts.write('acct-1', 7, edit({}, 1)), TypeError);
    assert.throws(() => drafts.write('acct-1', 'a.txt', edit({}, 0)), TypeError);
    assert.throws(() => drafts.findDraft('acct-1'), TypeError);
    assert.throws(() => drafts.clearAccount(undefined), TypeError);
    assert.throws(() => createDrafts({}), TypeError);
  });
});

// A minimal hand-written IndexedDB: open with upgrade, transactions that run
// their requests in order and abort on the first request error. `quota` makes
// a put fail the way a full origin quota does.
function fakeIndexedDB() {
  const databases = new Map();
  const idb = {
    quota: false,
    open(name, version) {
      const request = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      setImmediate(() => {
        let db = databases.get(name);
        if (!db) { db = { version: 0, stores: new Map() }; databases.set(name, db); }
        request.result = {
          objectStoreNames: { contains: (store) => db.stores.has(store) },
          createObjectStore: (store) => { db.stores.set(store, new Map()); },
          transaction: (store, mode) => transaction(db.stores.get(store), mode),
        };
        if (db.version < version) {
          db.version = version;
          request.onupgradeneeded();
        }
        request.onsuccess();
      });
      return request;
    },
  };
  function transaction(data, mode) {
    const ops = [];
    const tx = { error: null, oncomplete: null, onabort: null };
    const queue = (work) => {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      ops.push({ req, work });
      return req;
    };
    const store = {
      get: (key) => queue(() => structuredClone(data.get(key))),
      put: (value, key) => queue(() => {
        if (idb.quota && mode === 'readwrite') throw quotaError();
        data.set(key, structuredClone(value));
      }),
      delete: (key) => queue(() => { data.delete(key); }),
      getAllKeys: () => queue(() => [...data.keys()]),
    };
    tx.objectStore = () => store;
    setImmediate(() => {
      for (const { req, work } of ops) {
        try {
          req.result = work();
          req.onsuccess();
        } catch (error) {
          req.error = error;
          tx.error = error;
          req.onerror();
          tx.onabort();
          return;
        }
      }
      tx.oncomplete();
    });
    return tx;
  }
  return idb;
}

describe('IndexedDB adapter (hand-written fake, not a browser)', () => {
  test('round trip through the store contract, with the database created once', async () => {
    const idb = fakeIndexedDB();
    const store = createIndexedDbStore(idb);
    await store.open();
    await store.put('["acct-1","a.txt"]', { account: 'acct-1', ref: 'a.txt', generation: 1, at: 5, model: { text: 'x' } });
    assert.equal((await store.get('["acct-1","a.txt"]')).model.text, 'x');
    assert.deepEqual(await store.keys(), ['["acct-1","a.txt"]']);
    assert.equal(await store.get('missing'), undefined);
    await store.delete('["acct-1","a.txt"]');
    assert.deepEqual(await store.keys(), []);
  });

  test('drafts work over the IndexedDB adapter, including a quota failure', async () => {
    const idb = fakeIndexedDB();
    const drafts = createDrafts({ store: createIndexedDbStore(idb), now: clock().now });
    await drafts.write('acct-1', 'a.txt', edit({ text: 'stored' }, 1));
    idb.quota = true;
    await assert.rejects(drafts.write('acct-1', 'a.txt', edit({ text: 'lost' }, 2)), { code: 'quota' });
    idb.quota = false;
    assert.equal((await draftOf(drafts, 'acct-1', 'a.txt')).model.text, 'stored');
    await drafts.clear('acct-1', 'a.txt', 1);
    assert.equal(await draftOf(drafts, 'acct-1', 'a.txt'), null);
  });

  test('an open that fails surfaces as a storage error', async () => {
    const idb = { open() {
      const request = { onerror: null, onsuccess: null, onupgradeneeded: null, error: new Error('blocked') };
      setImmediate(() => request.onerror());
      return request;
    } };
    const drafts = createDrafts({ store: createIndexedDbStore(idb), now: clock().now });
    await assert.rejects(drafts.findDraft('acct-1', 'a.txt'), { code: 'storage' });
  });
});

describe('document session recovery hook', () => {
  const adapter = {
    id: 'session-mock',
    scan: () => ({ supported: true, unsupported: [] }),
    open: (value, name) => ({ model: { text: text(value) }, meta: { name } }),
    serialize: (model) => bytes(model.text),
  };

  function setup(overrides = {}) {
    const store = memoryStore();
    const drafts = createDrafts({ store, now: clock().now });
    const errors = [];
    const writes = [];
    const host = {
      read: (ref) => ({ bytes: bytes(ref), revision: 'r0' }),
      save: (ref, value, baseRevision) => {
        writes.push({ ref, text: text(value), baseRevision });
        return { revision: `r${writes.length}` };
      },
      ...overrides,
    };
    const session = createDocumentSession({ host, adapter, recovery: { account: 'acct-1', drafts, onError: (e) => errors.push(e) } });
    return { session, drafts, errors, store, writes };
  }

  test('an edit leaves a draft; a confirmed save removes it', async () => {
    const { session, drafts, writes } = setup();
    await session.open('file', 'draft.txt');
    session.edit({ text: 'typed' });
    assert.equal((await draftOf(drafts, 'acct-1', 'file')).model.text, 'typed');
    await session.save();
    assert.equal(writes.length, 1);
    assert.equal(await draftOf(drafts, 'acct-1', 'file'), null);
  });

  test('an edit made while a save runs stays as a draft after that save', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const saved = [];
    // a host whose save waits on the gate
    const slow = setup({
      save: async (ref, value) => {
        await gate;
        saved.push(text(value));
        return { revision: 'r1' };
      },
    });
    await slow.session.open('file', 'draft.txt');
    slow.session.edit({ text: 'first' });
    const pending = slow.session.save();
    await settle();
    slow.session.edit({ text: 'second' });
    release();
    await pending;
    assert.deepEqual(saved, ['first']);
    assert.equal((await draftOf(slow.drafts, 'acct-1', 'file')).model.text, 'second');
    assert.equal(slow.errors.length, 0);
  });

  test('a failed draft write is reported and leaves the edit in place', async () => {
    const { session, store, errors } = setup();
    await session.open('file', 'draft.txt');
    store.quota = true;
    session.edit({ text: 'unsaved' });
    await idle();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'quota');
    assert.equal(session.getState().state, 'dirty');
    assert.equal(session.getState().model.text, 'unsaved');
  });

  test('a failed draft clear is reported, and the save still succeeded', async () => {
    const { session, store, errors, writes } = setup();
    await session.open('file', 'draft.txt');
    session.edit({ text: 'typed' });
    await idle();
    store.failDelete = true;
    await session.save();
    await idle();
    assert.equal(writes.length, 1);
    assert.equal(session.getState().state, 'clean');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'storage');
  });

  test('a session without recovery never touches drafts and rejects a malformed option', async () => {
    const plain = createDocumentSession({ adapter, host: { read: (ref) => ({ bytes: bytes(ref), revision: 'r0' }), save: () => ({ revision: 'r1' }) } });
    await plain.open('file', 'draft.txt');
    plain.edit({ text: 'no drafts' });
    assert.equal(plain.getState().state, 'dirty');
    assert.throws(() => createDocumentSession({ adapter, host: {}, recovery: { account: 'a', drafts: {}, onError() {} } }), TypeError);
    assert.throws(() => createDocumentSession({ adapter, host: {}, recovery: { account: 'a', drafts: createDrafts({ store: memoryStore() }) } }), TypeError);
  });
});

test('classic browser script exposes the drafts module as a global', () => {
  const context = vm.createContext({ structuredClone, DOMException });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'document-session', 'drafts.js'), 'utf8'), context);
  assert.equal(typeof context.NeoCraft_Drafts.createDrafts, 'function');
  assert.equal(typeof context.NeoCraft_Drafts.createIndexedDbStore, 'function');
});
