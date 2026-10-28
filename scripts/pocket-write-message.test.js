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
  return {
    writeFile: async (o) => { if (failWrite && o.path.endsWith('.tmp')) throw failWrite; },
    rename: async () => { if (failRename) throw failRename; },
  };
}
const outcome = async (p) => { try { await p; return null; } catch (e) { return e; } };

test('a failed swap is shown once, as one "Could not save" line', async () => {
  const { writeText, shown } = load(mockFs({ failRename: { message: 'Permission denied' } }));
  const e = await outcome(writeText('b/ch.html', 'x'));
  assert.equal(e.message, 'Permission denied');
  assert.deepEqual(shown, ['Could not save b/ch.html: Permission denied']);
});

test('a failure writing the .tmp file is shown once, as one "Could not save" line', async () => {
  const { writeText, shown } = load(mockFs({ failWrite: new Error('no space') }));
  await outcome(writeText('b/ch.html', 'x'));
  assert.deepEqual(shown, ['Could not save b/ch.html: no space']);
});
