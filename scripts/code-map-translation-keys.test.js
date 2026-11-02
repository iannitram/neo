'use strict';
// Locked test (issue #99): the code map's "Change routing" section must say that
// t() strings are keys into locales/. Docs-only: this reads the code map.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const MAP = path.join(__dirname, '..', 'docs', 'review-2026-10-24', 'CODE-MAP.md');
const text = Object.freeze(fs.readFileSync(MAP, 'utf8'));
const start = text.indexOf('## Change routing');
const end = text.indexOf('## Planned 1.0 modules');
const section = start >= 0 && end > start ? text.slice(start, end) : '';
const bullets = section.split('\n').filter((l) => l.startsWith('- '));
const note = bullets.find((l) => l.includes("t('")) || '';

test('Change routing section exists, before Planned 1.0 modules', () => {
  assert.ok(start >= 0 && end > start);
});

test("a Change routing bullet names t('...')", () => {
  assert.ok(note, "no bullet in Change routing contains t('");
});

test('that bullet says the string is a key into locales/', () => {
  assert.match(note, /\bkey\b/i);
  assert.ok(note.includes('locales/'), 'must name locales/');
});

test('it says editing the visible text means editing every locale file', () => {
  assert.match(note, /every (locale|language)|all locales|each locale/i);
});

test('it says a missed locale silently falls back to English', () => {
  assert.match(note, /English/);
  assert.match(note, /silently|falls? back|drops?/i);
});

test('it points at node scripts/i18n.js check', () => {
  assert.ok(note.includes('node scripts/i18n.js check'));
});

test('the four existing Change routing bullets are kept', () => {
  for (const head of ['- Save/conflict/recovery changes:', '- Book formatting:', '- New host capability:', '- Nextcloud conversion:']) {
    assert.ok(bullets.some((l) => l.startsWith(head)), `missing: ${head}`);
  }
});
