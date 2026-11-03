'use strict';

// RECOVERY DRAFTS: a durable copy of a document's unsaved edits, one per
// account and file, so a reload or a crash can offer them back.
//
// createDrafts({ store, now, retentionMs }) -> {
//   write, clear, discard, findDraft, offerDraft, clearAccount, prune
// }
// write(account, ref, { name, model, meta, generation }): keeps the newest
//   edit for that account and file. Resolves once the store has it.
// clear(account, ref, generation): a save of `generation` is confirmed, so the
//   draft goes. A draft from a later edit (higher generation) stays.
// discard(account, ref): removes the draft whatever it holds (the writer declined it).
// findDraft(account, ref): the draft or null. An expired draft is removed and not returned.
// offerDraft(account, ref, decide): when a draft exists, decide(draft) resolves
//   true to keep it (returned) or false to discard it (null). No draft: null.
// clearAccount(account): every draft of one account (logout).
// prune(): removes every expired draft, across accounts. Returns the count.
//
// Keys are JSON [account, ref]. A record read back whose account or ref does
// not match the request is treated as absent, so one account never sees
// another's draft. Every store call runs on one queue, in call order, so a
// clear always lands after the writes issued before it.
//
// Failures reject with a DraftError: code 'quota' when the store is full,
// 'storage' for anything else. Nothing is swallowed: a caller that ignores the
// returned promise has chosen to, and the session reports them through onError.
// Arguments that are not strings (or a generation that is not a positive
// integer) throw a TypeError at the call.
//
// RETENTION: DEFAULT_RETENTION_MS is 30 days. A draft's age is the time of its
// last write, so a draft kept current by typing never expires while it is in use.
//
// STORE CONTRACT (promises; keys are strings):
//   open() -> resolves once the store is usable (called once, lazily)
//   get(key) -> record | undefined
//   put(key, record)
//   delete(key)
//   keys() -> string[]
// createIndexedDbStore(indexedDB) implements it over the browser's IndexedDB.
// Tests use an in-memory fake; IndexedDB itself is not available in Node.
//
// Plain JavaScript that also runs in Node (the tests). No UI, no timers.

(function (root) {
  'use strict';

  const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

  class DraftError extends Error {
    constructor(code, message, options) {
      super(message, options);
      this.name = 'DraftError';
      this.code = code;
    }
  }

  function isQuota(error) {
    return Boolean(error) && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014);
  }

  function toDraftError(error, action) {
    if (error instanceof DraftError) return error;
    const detail = error && error.message ? error.message : String(error);
    return new DraftError(isQuota(error) ? 'quota' : 'storage',
      `Recovery draft ${action} failed: ${detail}`, { cause: error });
  }

  function checkId(value, label) {
    if (typeof value !== 'string' || value === '') throw new TypeError(`${label} must be a non-empty string`);
  }

  function checkIds(account, ref) {
    checkId(account, 'account');
    checkId(ref, 'file ref');
  }

  function keyOf(account, ref) {
    return JSON.stringify([account, ref]);
  }

  function parseKey(key) {
    try {
      const parts = JSON.parse(key);
      return Array.isArray(parts) ? parts : null;
    } catch {
      return null;
    }
  }

  function isRecord(record) {
    return Boolean(record) && typeof record.account === 'string' && typeof record.ref === 'string'
      && typeof record.at === 'number' && typeof record.generation === 'number';
  }

  function createDrafts({ store, now = () => Date.now(), retentionMs = DEFAULT_RETENTION_MS } = {}) {
    if (!store || ['open', 'get', 'put', 'delete', 'keys'].some((name) => typeof store[name] !== 'function')) {
      throw new TypeError('createDrafts needs a store with open, get, put, delete and keys');
    }

    let opening = null;
    let tail = Promise.resolve();

    function ready() {
      if (!opening) {
        opening = Promise.resolve().then(() => store.open()).catch((error) => {
          opening = null;
          throw error;
        });
      }
      return opening;
    }

    function queue(action, work) {
      const run = tail.then(async () => {
        try {
          await ready();
          return await work();
        } catch (error) {
          throw toDraftError(error, action);
        }
      });
      tail = run.catch(() => {});
      return run;
    }

    function expired(record) {
      return now() - record.at > retentionMs;
    }

    function ownRecord(record, account, ref) {
      return isRecord(record) && record.account === account && record.ref === ref ? record : null;
    }

    function write(account, ref, { name, model, meta, generation } = {}) {
      checkIds(account, ref);
      if (!Number.isInteger(generation) || generation < 1) throw new TypeError('generation must be a positive integer');
      const key = keyOf(account, ref);
      const record = structuredClone({
        account, ref, name: typeof name === 'string' ? name : '',
        model, meta: meta === undefined ? null : meta, generation, at: now(),
      });
      return queue('write', () => store.put(key, record));
    }

    function clear(account, ref, generation) {
      checkIds(account, ref);
      const key = keyOf(account, ref);
      return queue('clear', async () => {
        const record = ownRecord(await store.get(key), account, ref);
        if (record && record.generation <= generation) await store.delete(key);
      });
    }

    function discard(account, ref) {
      checkIds(account, ref);
      const key = keyOf(account, ref);
      return queue('discard', () => store.delete(key));
    }

    function findDraft(account, ref) {
      checkIds(account, ref);
      const key = keyOf(account, ref);
      return queue('read', async () => {
        const record = ownRecord(await store.get(key), account, ref);
        if (!record) return null;
        if (expired(record)) {
          await store.delete(key);
          return null;
        }
        return structuredClone(record);
      });
    }

    async function offerDraft(account, ref, decide) {
      if (typeof decide !== 'function') throw new TypeError('offerDraft needs a decide function');
      const draft = await findDraft(account, ref);
      if (!draft) return null;
      if (await decide(structuredClone(draft))) return draft;
      await discard(account, ref);
      return null;
    }

    function clearAccount(account) {
      checkId(account, 'account');
      return queue('clear account', async () => {
        for (const key of await store.keys()) {
          const parts = parseKey(key);
          if (parts && parts[0] === account) await store.delete(key);
        }
      });
    }

    function prune() {
      return queue('prune', async () => {
        let removed = 0;
        for (const key of await store.keys()) {
          const record = await store.get(key);
          if (!isRecord(record) || expired(record)) {
            await store.delete(key);
            removed += 1;
          }
        }
        return removed;
      });
    }

    return { write, clear, discard, findDraft, offerDraft, clearAccount, prune, retentionMs };
  }

  // IndexedDB over the STORE CONTRACT above. A write resolves when its
  // transaction completes (durable); a failed request aborts the transaction,
  // and the abort rejects with the request's error (QuotaExceededError when full).
  function createIndexedDbStore(indexedDB, { name = 'neocraft-recovery', storeName = 'drafts', version = 1 } = {}) {
    let db = null;

    function run(mode, make) {
      return new Promise((resolve, reject) => {
        let value;
        const tx = db.transaction(storeName, mode);
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(tx.error || new Error('Recovery drafts transaction aborted'));
        const request = make(tx.objectStore(storeName));
        request.onsuccess = () => { value = request.result; };
        request.onerror = () => {}; // the abort that follows carries the error
      });
    }

    return {
      open() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(name, version);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
          };
          request.onsuccess = () => { db = request.result; resolve(); };
          request.onerror = () => reject(request.error);
        });
      },
      get: (key) => run('readonly', (store) => store.get(key)),
      put: (key, record) => run('readwrite', (store) => store.put(record, key)),
      delete: (key) => run('readwrite', (store) => store.delete(key)),
      keys: () => run('readonly', (store) => store.getAllKeys()),
    };
  }

  const api = { createDrafts, createIndexedDbStore, DraftError, DEFAULT_RETENTION_MS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_Drafts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
