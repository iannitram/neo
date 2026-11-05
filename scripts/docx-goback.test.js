'use strict';
// Locked test for #194: Word's hidden _GoBack bookmark in an edited paragraph no longer
// refuses the in-place .docx save; any other bookmark still does.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { readDocx } = require('../formats/docx/read');
const { writeDocx, DocxWriteError } = require('../formats/docx/write');
const { minimalDocxParts } = require('../formats/minimal');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

async function docx(body) {
  const base = minimalDocxParts();
  const zip = new JSZip();
  zip.file('[Content_Types].xml', base['[Content_Types].xml'], { createFolders: false });
  zip.file('_rels/.rels', base['_rels/.rels'], { createFolders: false });
  zip.file('word/document.xml', `${DECL}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`, { createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

async function editFirst(body, text) {
  const { model, meta } = await readDocx(await docx(body), 'fixture.docx');
  const edited = structuredClone(model);
  edited.blocks[0].runs = [{ text }];
  return { model, edited, meta };
}

async function documentXml(bytes) {
  return (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');
}

const GOBACK_BODY = '<w:p><w:r><w:t>Before</w:t></w:r><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/><w:r><w:t> after</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>';

test('an edited paragraph holding a _GoBack pair saves and reads back as the edited model', async () => {
  const { edited, meta } = await editFirst(GOBACK_BODY, 'Before and after');
  const out = await writeDocx(edited, meta);
  assert.deepEqual((await readDocx(out, 'out.docx')).model, edited);
  const xml = await documentXml(out);
  assert.ok(!xml.includes('_GoBack'), 'the _GoBack pair is dropped from the regenerated paragraph');
  assert.ok(!/bookmarkEnd/.test(xml), 'its end goes too');
});

test('a _GoBack pair at the start of the paragraph, before any run, is also dropped', async () => {
  const body = '<w:p><w:bookmarkStart w:id="7" w:name="_GoBack"/><w:bookmarkEnd w:id="7"/><w:r><w:t>Text</w:t></w:r></w:p>';
  const { edited, meta } = await editFirst(body, 'Text edited');
  const out = await writeDocx(edited, meta);
  assert.deepEqual((await readDocx(out, 'out.docx')).model, edited);
});

test('an unedited paragraph keeps its _GoBack pair byte for byte', async () => {
  const { model, meta } = await readDocx(await docx(GOBACK_BODY), 'fixture.docx');
  const edited = structuredClone(model);
  edited.blocks[1].runs = [{ text: 'Second, edited' }];
  const xml = await documentXml(await writeDocx(edited, meta));
  assert.ok(xml.includes('<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>'));
});

async function refused(body, why) {
  const { edited, meta } = await editFirst(body, 'Changed');
  await assert.rejects(writeDocx(edited, meta), (e) => e instanceof DocxWriteError && e.code === 'unrepresentable', why);
}

test('any other bookmark in an edited paragraph is still refused', async () => {
  await refused('<w:p><w:bookmarkStart w:id="0" w:name="mark"/><w:r><w:t>Anchored</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>', 'a named bookmark');
  await refused('<w:p><w:bookmarkStart w:id="0" w:name="_Toc123"/><w:bookmarkEnd w:id="0"/><w:r><w:t>Heading</w:t></w:r></w:p>', 'a _Toc bookmark');
});

test('a _GoBack start without its end in the same paragraph is refused', async () => {
  await refused('<w:p><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:r><w:t>Open</w:t></w:r></w:p><w:p><w:bookmarkEnd w:id="0"/><w:r><w:t>Closed</w:t></w:r></w:p>', 'start only');
});

test('a bookmark end that does not close a _GoBack start is refused', async () => {
  await refused('<w:p><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/><w:bookmarkEnd w:id="5"/><w:r><w:t>Text</w:t></w:r></w:p>', 'stray end');
});

test('a _GoBack start with an extra attribute is refused', async () => {
  await refused('<w:p><w:bookmarkStart w:id="0" w:name="_GoBack" w:colFirst="1"/><w:bookmarkEnd w:id="0"/><w:r><w:t>Text</w:t></w:r></w:p>', 'extra attribute');
});
