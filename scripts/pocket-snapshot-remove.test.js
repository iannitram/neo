'use strict';

// Pocket's snapshotRemove (#114): it reports a snapshot still on the phone as
// a failure, the same as the desktop's snap:remove, so thinning keeps the source.
// The bridge runs in a vm with a stub Capacitor Filesystem (an in-memory folder).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'pocket', 'www', 'pocket-bridge.js'), 'utf8');

const SNAP = '20261001T000000Z-d-1-10-aaaa';
const SNAP_REL = 'book-x/snapshots/' + SNAP;

// load the bridge with a Filesystem stub. `faults.rmdir` and `faults.stat` are
// called with the relative path; a truthy answer makes that call misbehave.
function loadBridge(faults = {}) {
  const files = new Map([[`NEO Library/${SNAP_REL}`, 'dir'], [`NEO Library/${SNAP_REL}/ch-a.html`, '<p>A</p>']]);
  const deleted = [];
  files.set(`NEO Library/${SNAP_REL}/ch-b.html`, '<p>B</p>');
  files.set(`NEO Library/${SNAP_REL}/snapshot.json`, '{}');
  files.set('NEO Library/book-x/book.json', '{}');
  const under = (p) => [...files.keys()].filter((k) => k === p || k.startsWith(p + '/'));
  const notFound = () => Object.assign(new Error('File does not exist.'), { code: 'ENOENT' });
  const Filesystem = {
    async rmdir({ path: p }) {
      if (faults.silent) return; // does nothing and says nothing
      if (faults.rmdir && faults.rmdir(p)) throw new Error('EPERM: ' + p);
      for (const k of under(p)) files.delete(k);
    },
    async deleteFile({ path: p }) {
      deleted.push(p);
      if (faults.silent) return;
      if (faults.deleteFile && faults.deleteFile(p)) throw new Error('EPERM: ' + p);
      files.delete(p);
    },
    async stat({ path: p }) {
      if (faults.stat && faults.stat(p)) throw new Error('EIO: ' + p);
      if (!files.has(p)) throw notFound();
      return { type: files.get(p) };
    }
  };
  const win = {
    Capacitor: { getPlatform: () => 'android', Plugins: { Filesystem } },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout,
    clearTimeout,
    console
  };
  const doc = {
    readyState: 'complete',
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, addEventListener() {}, appendChild() {}, setAttribute() {} }),
    body: { appendChild() {}, addEventListener() {} },
    documentElement: { style: {}, setAttribute() {} }
  };
  win.document = doc;
  const context = vm.createContext({ window: win, document: doc, console, setTimeout, clearTimeout, Promise, JSON, Object, Array, Set, Map, Error, String, Number, Math, Date });
  vm.runInContext(bridge, context, { filename: 'pocket-bridge.js' });
  return { neo: win.neo, files, deleted };
}

describe('Pocket snapshotRemoveFile (#114)', () => {
  const key = (f) => `NEO Library/${SNAP_REL}/${f}`;

  test('removes exactly one chapter file and leaves the others', async () => {
    const { neo, files } = loadBridge();
    assert.equal(await neo.snapshotRemoveFile('book-x', SNAP, 'ch-a.html'), true);
    assert.equal(files.has(key('ch-a.html')), false);
    assert.equal(files.has(key('ch-b.html')), true);
    assert.equal(files.has(key('snapshot.json')), true);
    assert.equal(files.has('NEO Library/book-x/book.json'), true);
  });

  test('refuses snapshot.json and path escapes, touching nothing', async () => {
    const { neo, files, deleted } = loadBridge();
    for (const file of ['snapshot.json', '../book.json', '../../book.json', '..', 'a/b.html', '..\\x.html', '.html/../x', '']) {
      await assert.rejects(neo.snapshotRemoveFile('book-x', SNAP, file), undefined, file);
    }
    await assert.rejects(neo.snapshotRemoveFile('book-x', '../x', 'ch-a.html'));
    assert.deepEqual(deleted, []);
    assert.equal(files.size, 5);
  });

  test('rejects when the delete fails and the file is still there', async () => {
    const { neo, files } = loadBridge({ deleteFile: () => true });
    await assert.rejects(neo.snapshotRemoveFile('book-x', SNAP, 'ch-a.html'), /still there/);
    assert.equal(files.has(key('ch-a.html')), true);
  });

  test('rejects when the delete does nothing, and when stat cannot tell', async () => {
    await assert.rejects(loadBridge({ silent: true }).neo.snapshotRemoveFile('book-x', SNAP, 'ch-a.html'), /still there/);
    await assert.rejects(loadBridge({ deleteFile: () => true, stat: () => true }).neo.snapshotRemoveFile('book-x', SNAP, 'ch-a.html'), /still there/);
  });

  test('a file already gone counts as removed', async () => {
    const { neo, files } = loadBridge({ deleteFile: () => true });
    files.delete(key('ch-a.html'));
    assert.equal(await neo.snapshotRemoveFile('book-x', SNAP, 'ch-a.html'), true);
  });
});

describe('Pocket snapshotRemove reports a snapshot it could not remove (#114)', () => {
  test('a removed snapshot reports true and its folder is gone', async () => {
    const { neo, files } = loadBridge();
    assert.equal(await neo.snapshotRemove('book-x', SNAP), true);
    assert.equal(files.has(`NEO Library/${SNAP_REL}`), false);
    assert.equal(files.has(`NEO Library/${SNAP_REL}/ch-a.html`), false);
  });

  test('a remove that throws, with the folder still there, rejects', async () => {
    const { neo, files } = loadBridge({ rmdir: () => true });
    await assert.rejects(neo.snapshotRemove('book-x', SNAP), /still there/);
    assert.equal(files.has(`NEO Library/${SNAP_REL}/ch-a.html`), true);
  });

  test('a remove that does nothing, with the folder still there, rejects', async () => {
    const { neo } = loadBridge({ silent: true });
    await neo.snapshotRemove('book-x', SNAP).then(() => assert.fail('should reject'), (err) => assert.match(err.message, /still there/));
  });

  test('a snapshot already gone counts as removed', async () => {
    const { neo, files } = loadBridge({ rmdir: () => true });
    files.clear();
    assert.equal(await neo.snapshotRemove('book-x', SNAP), true);
  });

  test('a stat that cannot say whether the folder is there rejects, not reports success', async () => {
    const { neo } = loadBridge({ rmdir: () => true, stat: () => true });
    await assert.rejects(neo.snapshotRemove('book-x', SNAP), /still there/);
  });
});
