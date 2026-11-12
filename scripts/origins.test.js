'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

// recursive freeze so any mutation of an input throws (R28)
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

const { isCanonicalOrigin, matchEnrolled, canonicalize } = require('../desktop/origins');

const CANON = 'https://cloud.example-tailnet.ts.net:18082';
const enrolled = deepFreeze([{ origin: CANON, basePath: '/', aliases: ['http://cloud:8080', 'https://192.168.1.5'] }]);
const enrolledNc = deepFreeze([{ origin: CANON, basePath: '/nc', aliases: [] }]);

test('1. canonical origins', () => {
  assert.equal(isCanonicalOrigin('https://cloud.tail1234.ts.net:18082'), true);
  assert.equal(isCanonicalOrigin('http://cloud.tail1234.ts.net'), false);
  assert.equal(isCanonicalOrigin('https://cloud.local'), false);
  assert.equal(isCanonicalOrigin('https://u:p@cloud.tail1234.ts.net'), false);
  assert.equal(isCanonicalOrigin('https://ts.net'), false);
});

test('2. an old alias is rebuilt on the canonical origin, path query and hash kept', () => {
  assert.equal(canonicalize('http://cloud:8080/remote.php/dav/files/u/a.md', enrolled), CANON + '/remote.php/dav/files/u/a.md');
  assert.equal(canonicalize('http://cloud:8080/x/a.md?v=1#top', enrolled), CANON + '/x/a.md?v=1#top');
});

test('3. an unknown server matches nothing and canonicalize throws UnknownServerError', () => {
  assert.equal(matchEnrolled('https://evil.example/remote.php', enrolled), null);
  assert.throws(() => canonicalize('https://evil.example/remote.php', enrolled), (e) => e instanceof Error && e.name === 'UnknownServerError');
});

test('4. basePath matches on a segment boundary', () => {
  assert.deepEqual(matchEnrolled(CANON + '/nc/remote.php', enrolledNc), enrolledNc[0]);
  assert.equal(matchEnrolled(CANON + '/ncx/remote.php', enrolledNc), null);
});

test('5. host case does not matter', () => {
  assert.deepEqual(matchEnrolled('https://CLOUD.example-tailnet.ts.net:18082/x', enrolled), enrolled[0]);
});

test('a path with .. segments matches nothing', () => {
  assert.equal(matchEnrolled(CANON + '/a/../remote.php', enrolled), null);
});

test('userinfo and invalid URLs match nothing', () => {
  assert.equal(matchEnrolled('https://u:p@cloud.example-tailnet.ts.net:18082/x', enrolled), null);
  assert.equal(matchEnrolled('not a url', enrolled), null);
});
