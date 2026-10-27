'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { splitFrontmatter, joinFrontmatter } = require('../formats/markdown-frontmatter');

// recursive freeze so any mutation of an input throws (R28)
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

test('1. a --- block closed by --- is held aside', () => {
  const t = '---\ntitle: A\n---\n# H\n';
  assert.deepEqual(splitFrontmatter(t), { bom: '', frontmatter: '---\ntitle: A\n---\n', body: '# H\n' });
});

test('2. CRLF with a ... closing line', () => {
  const t = '---\r\na: 1\r\n...\r\nBody';
  assert.deepEqual(splitFrontmatter(t), { bom: '', frontmatter: '---\r\na: 1\r\n...\r\n', body: 'Body' });
});

test('3. BOM and a closing line with no final newline', () => {
  const t = '﻿---\nx: y\n---';
  assert.deepEqual(splitFrontmatter(t), { bom: '﻿', frontmatter: '---\nx: y\n---', body: '' });
});

test('4. --- followed by text is not frontmatter', () => {
  assert.equal(splitFrontmatter('--- not frontmatter\n').frontmatter, null);
});

test('5. no closing line means no frontmatter and the whole text is the body', () => {
  const t = '---\nno end\n';
  const r = splitFrontmatter(t);
  assert.equal(r.frontmatter, null);
  assert.equal(r.body, t);
});

test('6. round trip is byte-identical for all five and for the empty string', () => {
  const inputs = ['---\ntitle: A\n---\n# H\n', '---\r\na: 1\r\n...\r\nBody', '﻿---\nx: y\n---', '--- not frontmatter\n', '---\nno end\n', ''];
  for (const t of inputs) {
    assert.equal(joinFrontmatter(deepFreeze(splitFrontmatter(t))), t);
  }
});
