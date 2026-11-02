'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { minimalMarkdown, minimalDocxParts } = require('../formats/minimal');

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NAMES = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels'];
const has = (s, re) => re.test(s);

// well-formedness: every start tag is closed in order
function balanced(xml) {
  const tags = xml.replace(/<\?[\s\S]*?\?>/g, '').match(/<\/?[A-Za-z_][^>]*>/g) || [];
  const stack = [];
  for (const t of tags) {
    const name = t.match(/^<\/?([^\s/>]+)/)[1];
    if (t.startsWith('</')) { if (stack.pop() !== name) return false; }
    else if (!t.endsWith('/>')) stack.push(name);
  }
  return stack.length === 0;
}

test('1. a new note is an empty file', () => {
  const b = minimalMarkdown();
  assert.ok(b instanceof Uint8Array);
  assert.equal(b.length, 0);
});

test('2. exactly the four parts', () => {
  assert.deepEqual(Object.keys(minimalDocxParts()).sort(), NAMES.slice().sort());
});

test('3. every part starts with the declaration, is well formed and has no DOCTYPE', () => {
  const parts = minimalDocxParts();
  for (const name of NAMES) {
    assert.equal(typeof parts[name], 'string', name);
    assert.ok(parts[name].startsWith(DECL), name + ' declaration');
    assert.ok(balanced(parts[name]), name + ' balanced');
    assert.ok(!/<!DOCTYPE/i.test(parts[name]), name + ' doctype');
  }
});

test('4. content types and relationships name the main document', () => {
  const parts = minimalDocxParts();
  const ct = parts['[Content_Types].xml'];
  assert.ok(ct.includes('/word/document.xml'));
  assert.ok(ct.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'));
  assert.ok(has(ct, /Extension=["']rels["']/));
  assert.ok(ct.includes('application/vnd.openxmlformats-package.relationships+xml'));
  assert.ok(has(ct, /Extension=["']xml["']/));
  assert.ok(ct.includes('application/xml'));
  const rels = parts['_rels/.rels'];
  assert.ok(has(rels, /Id=["']rId1["']/));
  assert.ok(rels.includes('http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'));
  assert.ok(has(rels, /Target=["']word\/document\.xml["']/));
  const docXml = parts['word/document.xml'];
  assert.ok(docXml.includes('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr/></w:body></w:document>'));
  const docRels = parts['word/_rels/document.xml.rels'];
  assert.ok(docRels.includes('http://schemas.openxmlformats.org/package/2006/relationships'));
  assert.ok(!/<Relationship[\s>]/.test(docRels));
});

test('5. the fidelity scanner, when present, finds nothing unsupported', () => {
  let scan;
  try { scan = require('../formats/docx/scan'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return; }
  const r = scan.scanDocx({ documentXml: minimalDocxParts()['word/document.xml'] });
  assert.deepEqual(r, { supported: true, unsupported: [] });
});
