'use strict';

// DOCUMENT SESSION: the two small rules that keep async work in order.
//
// createSaveSerializer(saveFn): saves run one at a time. While one runs,
// the newest request waits as the single pending save; an older pending
// request is dropped, and its caller's promise settles with the result (or
// error) of the save that replaced it. A failed save does not block the
// ones after it.
//
// createRequestGuard(): hands out increasing tokens; a reply is current only
// if its token is the latest one issued. Late replies after navigation are
// then ignored.
//
// Plain JavaScript that also runs in Node (the tests). It knows nothing of
// NEO: the caller supplies saveFn.

(function (root) {
  'use strict';

  function createSaveSerializer(saveFn) {
    let busy = false;
    let pending = null; // { snapshot, waiters: [{ resolve, reject }] }
    let idleWaiters = [];

    async function drain() {
      busy = true;
      while (pending) {
        const job = pending;
        pending = null;
        let failed = false;
        let result;
        let error;
        try {
          result = await saveFn(job.snapshot);
        } catch (e) {
          failed = true;
          error = e;
        }
        for (const w of job.waiters) {
          if (failed) w.reject(error);
          else w.resolve(result);
        }
      }
      busy = false;
      const waiting = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiting) resolve();
    }

    function save(snapshot) {
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        if (pending) {
          // Drop the older pending snapshot; its caller follows the newer one.
          pending.snapshot = snapshot;
          pending.waiters.push(waiter);
        } else {
          pending = { snapshot, waiters: [waiter] };
        }
        if (!busy) drain();
      });
    }

    function idle() {
      if (!busy && !pending) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    }

    function inFlight() {
      return busy;
    }

    return { save, idle, inFlight };
  }

  function createRequestGuard() {
    let latest = 0;
    return {
      next() {
        latest += 1;
        return latest;
      },
      isCurrent(token) {
        return latest > 0 && token === latest;
      },
    };
  }

  const api = { createSaveSerializer, createRequestGuard };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_Serial = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
