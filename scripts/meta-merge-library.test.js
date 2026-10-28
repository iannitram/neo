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

const { mergeLibrary } = require('../meta-merge');

const lib = (over = {}) => ({ authorName: '', penNames: [], firstRunDone: false, pageTheme: 'night', shelves: [], ...over });
const sh = (id, name, bookIds) => ({ id, name, bookIds });
const clone = (o) => JSON.parse(JSON.stringify(o));
const byId = (l, id) => l.shelves.find((s) => s.id === id);

test('1. a shelf renamed locally and a book added remotely both survive', () => {
  const base = deepFreeze(lib({ shelves: [sh('s1', 'S', ['b1'])] }));
  const local = deepFreeze(lib({ shelves: [sh('s1', 'X', ['b1'])] }));
  const remote = deepFreeze(lib({ shelves: [sh('s1', 'S', ['b1', 'b2'])] }));
  const { library, conflicts } = mergeLibrary(base, local, remote);
  assert.equal(byId(library, 's1').name, 'X');
  assert.deepEqual(byId(library, 's1').bookIds, ['b1', 'b2']);
  assert.deepEqual(conflicts, []);
});

test('2. a shelf added remotely is present after s1', () => {
  const base = deepFreeze(lib({ shelves: [sh('s1', 'S', [])] }));
  const local = deepFreeze(lib({ shelves: [sh('s1', 'S', [])] }));
  const remote = deepFreeze(lib({ shelves: [sh('s1', 'S', []), sh('s2', 'T', [])] }));
  assert.deepEqual(mergeLibrary(base, local, remote).library.shelves.map((s) => s.id), ['s1', 's2']);
});

test('3. a shelf deleted locally and untouched remotely is gone', () => {
  const base = deepFreeze(lib({ shelves: [sh('s1', 'S', []), sh('s2', 'T', [])] }));
  const local = deepFreeze(lib({ shelves: [sh('s1', 'S', [])] }));
  const remote = deepFreeze(lib({ shelves: [sh('s1', 'S', []), sh('s2', 'T', [])] }));
  const { library, conflicts } = mergeLibrary(base, local, remote);
  assert.deepEqual(library.shelves.map((s) => s.id), ['s1']);
  assert.deepEqual(conflicts, []);
});

test('4. a shelf deleted locally but changed remotely is kept and reported', () => {
  const base = deepFreeze(lib({ shelves: [sh('s1', 'S', []), sh('s2', 'T', [])] }));
  const local = deepFreeze(lib({ shelves: [sh('s1', 'S', [])] }));
  const remote = deepFreeze(lib({ shelves: [sh('s1', 'S', []), sh('s2', 'T', ['b9'])] }));
  const { library, conflicts } = mergeLibrary(base, local, remote);
  assert.deepEqual(byId(library, 's2').bookIds, ['b9']);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, 'shelves.s2');
});

test('5. firstRunDone is local OR remote', () => {
  const f = deepFreeze(lib());
  const t = deepFreeze(lib({ firstRunDone: true }));
  assert.equal(mergeLibrary(f, f, t).library.firstRunDone, true);
  assert.equal(mergeLibrary(f, t, f).library.firstRunDone, true);
});

test('other fields follow the scalar rule and penNames merge as an order', () => {
  const base = deepFreeze(lib({ authorName: '', pageTheme: 'night' }));
  const local = deepFreeze(lib({ authorName: 'Ann', pageTheme: 'day', penNames: ['P'] }));
  const remote = deepFreeze(lib({ authorName: '', pageTheme: 'dusk' }));
  const { library, conflicts } = mergeLibrary(base, local, remote);
  assert.equal(library.authorName, 'Ann');
  assert.deepEqual(library.penNames, ['P']);
  assert.equal(library.pageTheme, 'day');
  assert.deepEqual(conflicts, [{ field: 'pageTheme', local: 'day', remote: 'dusk' }]);
});

test('inputs are not mutated', () => {
  const base = lib({ shelves: [sh('s1', 'S', ['b1']), sh('s2', 'T', [])] });
  const local = lib({ shelves: [sh('s1', 'X', ['b1'])] });
  const remote = lib({ shelves: [sh('s1', 'S', ['b1', 'b2']), sh('s2', 'T', ['b9'])] });
  const before = clone({ base, local, remote });
  mergeLibrary(deepFreeze(base), deepFreeze(local), deepFreeze(remote));
  assert.deepEqual(clone({ base, local, remote }), before);
});
