'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// writeText (and its helper) from the Pocket bridge, run on its own
const src = fs.readFileSync(path.join(__dirname, '..', 'pocket', 'www', 'pocket-bridge.js'), 'utf8');
const marks = ['function classifyRenameError', 'async function writeText'].map((m) => src.indexOf(m)).filter((i) => i >= 0);
const from = Math.min(...marks);
const to = src.indexOf('let permissionHelpShown');
assert.ok(from >= 0 && to > from, 'writeText was not found in pocket-bridge.js');

function load(fsMock) {
  const shown = [];
  const ctx = vm.createContext({
    ready: Promise.resolve(),
    FS: () => fsMock,
    at: (p) => ({ path: p, directory: 'DOCUMENTS' }),
    showErrorDetail: (m) => shown.push(m),
    t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => v[k]) : s),
  });
  vm.runInContext(src.slice(from, to) + '\nthis.api = { writeText };', ctx);
  return { writeText: ctx.api.writeText, shown };
}
function mockFs({ failWrite = null, failRename = null } = {}) {
  const calls = [];
  return {
    calls,
    writeFile: async (o) => { calls.push(['writeFile', o.path]); if (failWrite && o.path.endsWith('.tmp')) throw failWrite; },
    rename: async (o) => { calls.push(['rename', o.from, o.to]); if (failRename) throw failRename; },
    deleteFile: async (o) => { calls.push(['deleteFile', o.path]); },
  };
}
const outcome = async (p) => { try { await p; return null; } catch (e) { return e; } };

test('1. rename succeeds: write tmp, rename tmp over path, no plain write to path', async () => {
  const f = mockFs();
  const { writeText } = load(f);
  await writeText('b/ch.html', 'x');
  assert.deepEqual(f.calls, [['writeFile', 'b/ch.html.tmp'], ['rename', 'b/ch.html.tmp', 'b/ch.html']]);
});

test('2. rename denied: no write to path, tmp kept, RetryableSaveError kind denied', async () => {
  const cause = { message: 'Permission denied' };
  const f = mockFs({ failRename: cause });
  const { writeText, shown } = load(f);
  const e = await outcome(writeText('b/ch.html', 'x'));
  assert.ok(e, 'must reject');
  assert.equal(e.name, 'RetryableSaveError');
  assert.equal(e.retryable, true);
  assert.equal(e.kind, 'denied');
  assert.equal(e.path, 'b/ch.html');
  assert.equal(e.tmp, 'b/ch.html.tmp');
  assert.equal(e.cause, cause);
  assert.ok(!f.calls.some((c) => c[0] === 'writeFile' && c[1] === 'b/ch.html'));
  assert.ok(!f.calls.some((c) => c[0] === 'deleteFile'));
  assert.equal(shown.length, 1);
});

test('3. rename says the file exists: kind exists', async () => {
  const f = mockFs({ failRename: { message: 'File exists' } });
  const { writeText } = load(f);
  const e = await outcome(writeText('b/ch.html', 'x'));
  assert.equal(e.kind, 'exists');
});

test('4. writing the tmp file fails: that error, rename never called', async () => {
  const boom = new Error('no space');
  const f = mockFs({ failWrite: boom });
  const { writeText } = load(f);
  const e = await outcome(writeText('b/ch.html', 'x'));
  assert.equal(e, boom);
  assert.ok(!f.calls.some((c) => c[0] === 'rename'));
});
