'use strict';

// Release guard for the merged app-store feed (craft-nc-appstore): the feed reads id, version and the
// Nextcloud and PHP bounds from the NeoCraft Nextcloud app's info.xml, and the build workflow checks
// the version against the tag.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const file = path.join(__dirname, '..', 'nextcloud', 'neocraft', 'appinfo', 'info.xml');
const read = () => fs.readFileSync(file, 'utf8');

function tag(xml, name) {
  const m = xml.match(new RegExp('<' + name + '>\\s*([^<]*?)\\s*</' + name + '>'));
  return m ? m[1] : null;
}
function attrs(xml, name) {
  const m = xml.match(new RegExp('<' + name + '\\b([^>]*)/?>'));
  if (!m) return null;
  const out = {};
  for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) out[a[1]] = a[2];
  return out;
}
const num = (v) => v.split('.').map(Number);
function le(a, b) {
  const x = num(a); const y = num(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0;
  }
  return true;
}

test('info.xml has the app id neocraft', () => {
  assert.equal(tag(read(), 'id'), 'neocraft');
});

test('info.xml has a plain a.b.c version', () => {
  assert.match(tag(read(), 'version') || '', /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
});

test('info.xml declares a Nextcloud range that covers 33', () => {
  const nc = attrs(read(), 'nextcloud');
  assert.ok(nc, 'missing <nextcloud .../>');
  assert.match(nc['min-version'] || '', /^\d+(\.\d+){0,2}$/);
  assert.match(nc['max-version'] || '', /^\d+(\.\d+){0,2}$/);
  assert.ok(le(nc['min-version'], '33'));
  assert.ok(le('33', nc['max-version']));
});

test('info.xml declares a PHP minimum of at least 8.2', () => {
  const php = attrs(read(), 'php');
  assert.ok(php, 'missing <php .../>');
  assert.match(php['min-version'] || '', /^\d+\.\d+(\.\d+)?$/);
  assert.ok(le('8.2', php['min-version']));
});
