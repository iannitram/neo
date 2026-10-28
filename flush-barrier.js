(function (root) {
  'use strict';

  function createFlushBarrier({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const pendingEntries = [];
    let failedLabels = [];
    const waiters = [];

    function notifyWaiters() {
      if (waiters.length === 0) return;
      const current = waiters.slice();
      waiters.length = 0;
      const failed = failedLabels.slice();
      failedLabels = [];
      for (const fn of current) {
        fn(failed);
      }
    }

    function track(promise, label) {
      const entry = { promise, label };
      pendingEntries.push(entry);

      const onSettle = (isReject) => {
        const index = pendingEntries.indexOf(entry);
        if (index !== -1) {
          pendingEntries.splice(index, 1);
        }
        if (isReject) {
          failedLabels.push(label);
        }
        if (pendingEntries.length === 0) {
          notifyWaiters();
        }
      };

      Promise.resolve(promise).then(
        () => onSettle(false),
        () => onSettle(true)
      );

      return promise;
    }

    function pending() {
      return pendingEntries.map((entry) => entry.label);
    }

    function flush(timeoutMs) {
      if (pendingEntries.length === 0) {
        const failed = failedLabels.slice();
        failedLabels = [];
        return Promise.resolve({
          ok: failed.length === 0,
          failed,
          timedOut: []
        });
      }

      return new Promise((resolve) => {
        let timerId = null;
        let settled = false;

        const onAllSettled = (batchFailed) => {
          if (settled) return;
          settled = true;
          if (timerId !== null) {
            clearTimer(timerId);
          }
          const failed = batchFailed || failedLabels.slice();
          if (!batchFailed) {
            failedLabels = [];
          }
          resolve({
            ok: failed.length === 0,
            failed,
            timedOut: []
          });
        };

        waiters.push(onAllSettled);

        if (typeof timeoutMs === 'number') {
          timerId = setTimer(() => {
            if (settled) return;
            settled = true;
            const waiterIndex = waiters.indexOf(onAllSettled);
            if (waiterIndex !== -1) {
              waiters.splice(waiterIndex, 1);
            }
            const timedOut = pendingEntries.map((entry) => entry.label);
            const failed = failedLabels.slice();
            failedLabels = [];
            resolve({
              ok: false,
              failed,
              timedOut
            });
          }, timeoutMs);
        }
      });
    }

    return { track, pending, flush };
  }

  const api = { createFlushBarrier };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_FlushBarrier = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
