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

test('app.js passes the two desktop strings with NeoCraft Library to t()', () => {
  const app = read('app.js');
  for (const s of NEW) assert.ok(app.includes(`t('${s}'`), `missing t('${s}')`);
  for (const s of OLD) assert.ok(!app.includes(s), `still has: ${s}`);
});

test('the only old library name left in app.js is the Pocket-only Deleted Books line', () => {
  const all = read('app.js').split('\n');
  const oldName = 'NEO' + ' Library';
  const hits = all.map((l, i) => [l, i]).filter(([l]) => l.includes(oldName));
  assert.equal(hits.length, 2);
  for (const [l, i] of hits) {
    assert.ok(l.includes(`Moves the book folder to Deleted Books in your ${oldName}`), l);
    // the guard is on the same line or in the ternary just above it
    const guard = all.slice(Math.max(0, i - 2), i + 1).join('\n');
    assert.ok(guard.includes('window.Capacitor'), 'the Pocket line must sit behind window.Capacitor: ' + l.trim());
  }
});

test('locales/_template.json has the NeoCraft keys and no old ones', () => {
  const tpl = JSON.parse(read('locales/_template.json'));
  for (const s of NEW) assert.ok(s in tpl, `template lacks key: ${s}`);
  for (const s of OLD) assert.ok(!(s in tpl), `template still has old key: ${s}`);
});

test('every locale file renamed the keys and no value keeps the old literal library name for them', () => {
  const oldName = 'NEO' + ' Library';
  const dir = path.join(root, 'locales');
  for (const f of fs.readdirSync(dir)) {
    const obj = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const s of OLD) assert.ok(!(s in obj), `${f} still has old key: ${s}`);
    for (const s of NEW) {
      if (!(s in obj)) continue;
      assert.ok(!String(obj[s]).includes(oldName), `${f} keeps the old literal library name in a NeoCraft value`);
    }
  }
});
