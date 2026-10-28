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

const { scanDocx } = require('../formats/docx/scan');

const doc = (inner) => '<w:document><w:body>' + inner + '</w:body></w:document>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

test('1. plain text is supported', () => {
  const documentXml = '<w:document><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>';
  assert.deepEqual(scanDocx(deepFreeze({ documentXml })), { supported: true, unsupported: [] });
});

test('2. two tables', () => {
  const documentXml = doc('<w:tbl><w:tr/></w:tbl><w:p/><w:tbl><w:tr/></w:tbl>');
  assert.deepEqual(scanDocx(deepFreeze({ documentXml })), { supported: false, unsupported: [{ feature: 'table', count: 2 }] });
});

test('3. an insertion and a deletion are two tracked changes', () => {
  const documentXml = doc('<w:ins w:id="1"><w:r/></w:ins><w:del w:id="2"><w:r/></w:del>');
  assert.deepEqual(scanDocx(deepFreeze({ documentXml })).unsupported, [{ feature: 'tracked change', count: 2 }]);
});

test('4. external hyperlinks are fine, other external relationships are external links', () => {
  const documentXml = doc('<w:p/>');
  const link = '<Relationship Id="rId1" Type="' + REL + 'hyperlink" Target="https://x.example/" TargetMode="External"/>';
  const img = '<Relationship Id="rId2" Type="' + REL + 'image" Target="https://x.example/a.png" TargetMode="External"/>';
  const wrap = (s) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + s + '</Relationships>';
  assert.deepEqual(scanDocx(deepFreeze({ documentXml, relsXml: wrap(link) })), { supported: true, unsupported: [] });
  assert.deepEqual(scanDocx(deepFreeze({ documentXml, relsXml: wrap(link + img) })).unsupported, [{ feature: 'external link', count: 1 }]);
});

test('5. an embedded part counts as an embedded object', () => {
  const r = scanDocx(deepFreeze({ documentXml: doc('<w:p/>'), partNames: ['word/embeddings/oleObject1.bin'] }));
  assert.deepEqual(r.unsupported, [{ feature: 'embedded object', count: 1 }]);
});

test('6. w:tblPr alone is not a table', () => {
  assert.deepEqual(scanDocx(deepFreeze({ documentXml: doc('<w:tblPr></w:tblPr>') })), { supported: true, unsupported: [] });
});

test('unsupported is sorted by feature name', () => {
  const documentXml = doc('<w:ins w:id="1"/><w:tbl/>');
  assert.deepEqual(scanDocx(deepFreeze({ documentXml })).unsupported.map((u) => u.feature), ['table', 'tracked change']);
});
