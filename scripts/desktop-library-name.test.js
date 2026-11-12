'use strict';
// Issue #105: the desktop app's own strings say "NeoCraft Library", the name
// of its library folder (#8). Neo Pocket keeps its existing library name for now.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const OLD = [
  `“{title}” removed from the shelves — its files are still in your ${'NEO' + ' Library'}`,
  `Takes it off your shelves. The files stay safe in your ${'NEO' + ' Library'} folder on disk.`,
];
const NEW = OLD.map((s) => s.replace('NEO' + ' Library', 'NeoCraft Library'));

test('app.js shows NeoCraft Library on desktop and keeps the old name only behind window.Capacitor', () => {
  const app = read('app.js');
  for (const s of NEW) assert.ok(app.includes(`t('${s}'`), `missing t('${s}')`);
  const all = app.split('\n');
  const oldName = 'NEO' + ' Library';
  const hits = all.map((l, i) => [l, i]).filter(([l]) => l.includes(oldName) && l.includes("t('"));
  assert.equal(hits.length, 4);
  for (const [l, i] of hits) {
    const guard = all.slice(Math.max(0, i - 2), i + 1).join('\n');
    assert.ok(guard.includes('window.Capacitor'), 'the Pocket line must sit behind window.Capacitor: ' + l.trim());
  }
});

test('locales/_template.json has the NeoCraft keys, and the old keys stay for Pocket', () => {
  const tpl = JSON.parse(read('locales/_template.json'));
  for (const s of [...NEW, ...OLD]) assert.ok(s in tpl, `template lacks key: ${s}`);
});

test('no locale value for a NeoCraft key keeps the old literal library name', () => {
  const oldName = 'NEO' + ' Library';
  const dir = path.join(root, 'locales');
  for (const f of fs.readdirSync(dir)) {
    const obj = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const s of NEW) {
      if (!(s in obj)) continue;
      assert.ok(!String(obj[s]).includes(oldName), `${f} keeps the old literal library name in a NeoCraft value`);
    }
  }
});
