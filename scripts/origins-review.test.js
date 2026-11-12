'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isCanonicalOrigin, matchEnrolled, canonicalize } = require('../desktop/origins');
const CANON = 'https://cloud.example-tailnet.ts.net:18082';
const enrolled = Object.freeze([Object.freeze({ origin: CANON, basePath: '/', aliases: Object.freeze(['http://cloud:8080']) })]);

test('review: an alias within basePath cannot replace the canonical authority', () => {
  const input = 'http://cloud:8080//evil.example/x?q=1#top';
  assert.equal(matchEnrolled(input, enrolled), enrolled[0]);
  const output = new URL(canonicalize(input, enrolled));
  assert.equal(output.origin, CANON);
  assert.equal(output.pathname, new URL(input).pathname);
  assert.equal(output.search, '?q=1');
  assert.equal(output.hash, '#top');
});

test('review: reject encoded and URL-normalized parent path segments', () => {
  for (const path of ['/a/%2e%2e/x', '/a/.%2E/x', '/a/%2e./x', '/a\\..\\x', '/a/.\t./x']) {
    const input = 'http://cloud:8080' + path;
    assert.equal(matchEnrolled(input, enrolled), null, path);
    assert.throws(() => canonicalize(input, enrolled), { name: 'UnknownServerError' });
  }
});

test('review: origin-only paths and normalized default ports', () => {
  assert.equal(isCanonicalOrigin(CANON + '/folder'), false);
  assert.equal(isCanonicalOrigin(CANON + '/'), true);
  const entries = Object.freeze([Object.freeze({ origin: 'https://cloud.example-tailnet.ts.net:443', basePath: '/nc', aliases: Object.freeze(['http://CLOUD:80']) })]);
  assert.equal(matchEnrolled('http://cloud/nc', entries), entries[0]);
  assert.equal(matchEnrolled('https://CLOUD.example-tailnet.ts.net/nc/x', entries), entries[0]);
  assert.equal(matchEnrolled('http://cloud/ncx', entries), null);
  assert.equal(canonicalize('http://cloud/nc/x', entries), 'https://cloud.example-tailnet.ts.net/nc/x');
});

test('review: leading C0 controls cannot hide parent segments', () => {
  for (let code = 0; code <= 32; code++) {
    for (const path of ['/a/../x', '/a/%2e%2e/x']) {
      const input = String.fromCharCode(code) + 'http://cloud:8080' + path;
      assert.equal(matchEnrolled(input, enrolled), null, JSON.stringify(input));
      assert.throws(() => canonicalize(input, enrolled), { name: 'UnknownServerError' });
    }
  }
});

test('review: canonical origins require nonempty labels and no query or fragment', () => {
  for (const input of ['https://..ts.net', 'https://a..ts.net', CANON + '/?a=1', CANON + '/#h', CANON + '/?', CANON + '/#']) {
    assert.equal(isCanonicalOrigin(input), false, input);
  }
  assert.equal(isCanonicalOrigin('https://cloud.ts.net'), true);
});

test('review: reject empty userinfo as well as credentials', () => {
  for (const credentials of ['@', ':@', 'u@', ':p@', 'u:p@']) {
    const input = 'http://' + credentials + 'cloud:8080/x';
    assert.equal(matchEnrolled(input, enrolled), null, input);
    assert.throws(() => canonicalize(input, enrolled), { name: 'UnknownServerError' });
    assert.equal(isCanonicalOrigin('https://' + credentials + 'cloud.ts.net'), false);
  }
});
