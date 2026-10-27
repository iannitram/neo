'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { findWikilinks } = require('../formats/wikilinks');

test('1. a plain link with its span', () => {
  const t = 'See [[Page]] now';
  const r = findWikilinks(t);
  assert.deepEqual(r, [{ start: 4, end: 12, target: 'Page', heading: null, alias: null, embed: false }]);
  assert.equal(t.slice(r[0].start, r[0].end), '[[Page]]');
});

test('2. heading and alias', () => {
  const r = findWikilinks('[[A#Intro|the intro]]');
  assert.equal(r.length, 1);
  assert.equal(r[0].target, 'A');
  assert.equal(r[0].heading, 'Intro');
  assert.equal(r[0].alias, 'the intro');
  assert.equal(r[0].embed, false);
});

test('3. an embed includes the ! in its span', () => {
  const t = '![[img.png]]';
  const r = findWikilinks(t);
  assert.equal(r.length, 1);
  assert.equal(r[0].embed, true);
  assert.equal(r[0].start, 0);
  assert.equal(r[0].end, 12);
  assert.equal(r[0].target, 'img.png');
  assert.equal(t.slice(r[0].start, r[0].end), t);
});

test('4. no match inside inline code', () => {
  assert.deepEqual(findWikilinks('`[[not]]`'), []);
});

test('5. no match inside a fenced block', () => {
  const t = '```\n[[no]]\n```\n[[yes]]';
  const r = findWikilinks(t);
  assert.equal(r.length, 1);
  assert.equal(r[0].target, 'yes');
  assert.equal(r[0].start, t.indexOf('[[yes]]'));
});

test('6. an unclosed [[ is ignored', () => {
  assert.deepEqual(findWikilinks('[[open'), []);
});

test('a link cannot span a newline and [[]] is ignored', () => {
  assert.deepEqual(findWikilinks('[[a\nb]]'), []);
  assert.deepEqual(findWikilinks('[[]]'), []);
});
