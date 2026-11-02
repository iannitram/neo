'use strict';

// #132: a sticky note's debounced save (scheduleStickiesSave, 600 ms after the
// last keystroke) that fails must not become an unhandled rejection: that is
// the "Something hiccuped" toast and an `Unhandled:` log line. runSidecar
// already logs the failure, and the note stays queued for the next flush.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const SLICES = [
  ['function writeSidecar(', 'function renderDarlings('],
  ['function scheduleStickiesSave(', '// Pair every mark']
];

function bookWithStickies() {
  const due = [];
  const logged = [];
  const page = vm.createContext({
    window: { neo: {
      writeJSON: async () => { throw new Error('disk full'); },
      logError: (m) => logged.push(m)
    } },
    book: { id: 'b', chapterOrder: [] },
    stickies: [{ id: 's1', text: 'a note' }],
    saveTimers: {},
    sidecarPending: {}, sidecarBase: {},
    console,
    // the test holds the timers: run() fires the ones that are due
    setTimeout: (fn) => { due.push(fn); return due.length; },
    clearTimeout: (id) => { if (id) due[id - 1] = null; }
  });
  for (const [from, to] of SLICES) {
    const at = app.indexOf(from);
    assert.ok(at >= 0, 'app.js still has ' + from);
    vm.runInContext(app.slice(at, app.indexOf(to, at)), page);
  }
  return { page, logged, run() { const fns = due.splice(0).filter(Boolean); fns.forEach((fn) => fn()); return fns.length; } };
}

test('a debounced sticky save that fails leaves no unhandled rejection', async () => {
  const { page, logged, run } = bookWithStickies();
  const loose = [];
  const onLoose = (e) => loose.push(e);
  process.on('unhandledRejection', onLoose);
  try {
    page.scheduleStickiesSave();
    assert.equal(run(), 1, 'the 600 ms save came due');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onLoose);
  }
  assert.deepEqual(loose.map(String), []);
  assert.equal(logged.length, 1, 'the failure is still logged once');
  assert.ok(page.sidecarPending['b/stickies'], 'the note stays queued for the next flush');
});
