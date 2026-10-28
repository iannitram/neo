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

const { mergeOrder, mergeBookMeta } = require('../meta-merge');

const clone = (o) => JSON.parse(JSON.stringify(o));

test('1. a rename locally and a new chapter remotely both survive', () => {
  const base = deepFreeze({ title: 'A', chapterOrder: ['c1'] });
  const local = deepFreeze({ title: 'B', chapterOrder: ['c1'] });
  const remote = deepFreeze({ title: 'A', chapterOrder: ['c1', 'c2'] });
  const r = mergeBookMeta(base, local, remote);
  assert.equal(r.meta.title, 'B');
  assert.deepEqual(r.meta.chapterOrder, ['c1', 'c2']);
  assert.deepEqual(r.conflicts, []);
});

test('2. a chapter removed locally stays removed, one added remotely stays', () => {
  assert.deepEqual(mergeOrder(deepFreeze(['c1', 'c2', 'c3']), deepFreeze(['c1', 'c3']), deepFreeze(['c1', 'c2', 'c3', 'c4'])), ['c1', 'c3', 'c4']);
});

test('3. a chapter added locally goes after its preceding id', () => {
  assert.deepEqual(mergeOrder(deepFreeze(['c1']), deepFreeze(['c1', 'cL']), deepFreeze(['c1', 'cR'])), ['c1', 'cL', 'cR']);
});

test('4. a title changed to different values on both sides: local wins, conflict reported', () => {
  const base = deepFreeze({ title: 'A', chapterOrder: [] });
  const local = deepFreeze({ title: 'B', chapterOrder: [] });
  const remote = deepFreeze({ title: 'C', chapterOrder: [] });
  const r = mergeBookMeta(base, local, remote);
  assert.equal(r.meta.title, 'B');
  assert.deepEqual(r.conflicts, [{ field: 'title', local: 'B', remote: 'C' }]);
});

test('5. revision is max plus one, missing counts as 0', () => {
  const o = { title: 'A', chapterOrder: [] };
  assert.equal(mergeBookMeta(deepFreeze({ ...o }), deepFreeze({ ...o, revision: 3 }), deepFreeze({ ...o, revision: 5 })).meta.revision, 6);
  assert.equal(mergeBookMeta(deepFreeze({ ...o }), deepFreeze({ ...o }), deepFreeze({ ...o })).meta.revision, 1);
});

test('6. inputs are not mutated', () => {
  const base = { title: 'A', chapterOrder: ['c1', 'c2'], tabNames: { notes: 'n' } };
  const local = { title: 'B', chapterOrder: ['c1'], tabNames: { notes: 'n' } };
  const remote = { title: 'A', chapterOrder: ['c1', 'c2', 'c3'], tabNames: { notes: 'N' } };
  const before = clone({ base, local, remote });
  mergeBookMeta(deepFreeze(base), deepFreeze(local), deepFreeze(remote));
  assert.deepEqual(clone({ base, local, remote }), before);
});

test('mergeOrder: front insert, remote removal, no duplicates', () => {
  assert.deepEqual(mergeOrder(deepFreeze(['a']), deepFreeze(['n', 'a']), deepFreeze(['a', 'b'])), ['n', 'a', 'b']);
  assert.deepEqual(mergeOrder(deepFreeze(['a', 'b']), deepFreeze(['a', 'b']), deepFreeze(['a'])), ['a']);
  assert.deepEqual(mergeOrder(deepFreeze(['a']), deepFreeze(['a', 'x']), deepFreeze(['a', 'x'])), ['a', 'x']);
});

test('modified is the later of local and remote', () => {
  const o = { title: 'A', chapterOrder: [] };
  const r = mergeBookMeta(deepFreeze({ ...o }), deepFreeze({ ...o, modified: '2026-01-01T00:00:00.000Z' }), deepFreeze({ ...o, modified: '2026-02-01T00:00:00.000Z' }));
  assert.equal(r.meta.modified, '2026-02-01T00:00:00.000Z');
});

test('9. a local addition goes after its nearest preceding id in local order, even when remote reorders', () => {
  assert.deepEqual(mergeOrder(deepFreeze(['a', 'b']), deepFreeze(['a', 'b', 'X']), deepFreeze(['b', 'a'])), ['b', 'X', 'a']);
});
