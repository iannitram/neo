'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { readDocx } = require('../formats/docx/read');
const { minimalDocxParts } = require('../formats/minimal');
const { DEFAULT_LIMITS } = require('../formats/docx/limits');
const { parseXml } = require('../formats/docx/xml');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
const document = (body, ns = W) => `<w:document xmlns:w="${ns}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`;
async function fixture(body = '<w:p/>', extra = {}, compression = 'STORE') {
  const zip = new JSZip();
  const parts = { ...minimalDocxParts(), 'word/document.xml': document(body), ...extra };
  for (const [name, xml] of Object.entries(parts)) zip.file(name, xml, { createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression });
}
const model = async (...args) => (await readDocx(...args)).model;

test('DOCX reader returns the open contract shape and retains independent original bytes', async () => {
  const bytes = await fixture();
  const original = bytes.slice();
  const opened = await readDocx(bytes, 'new.docx');
  assert.deepEqual(opened.model, { type: 'document', blocks: [{ type: 'paragraph', runs: [] }] });
  assert.equal(opened.meta.name, 'new.docx');
  assert.ok(opened.meta.originalBytes instanceof Uint8Array);
  assert.deepEqual(opened.meta.originalBytes, original);
  assert.ok(opened.meta.documentXml.includes('<w:p/>'));
  assert.ok(opened.meta.partNames.includes('[Content_Types].xml'));
  bytes.fill(0);
  assert.deepEqual(opened.meta.originalBytes, original);
  const buffer = Buffer.from(original);
  const reading = readDocx(buffer);
  buffer.fill(0);
  assert.deepEqual((await reading).meta.originalBytes, original);
});

test('paragraphs, canonical headings, combined marks, disabled marks, spaces and Unicode', async () => {
  const bytes = await fixture(`<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
    <w:r><w:rPr><w:b/><w:i w:val="true"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">  Café &amp; 雪 &#x1F680; </w:t></w:r>
    <w:r><w:rPr><w:b w:val="0"/><w:i w:val="off"/><w:u w:val="none"/></w:rPr><w:t>&lt;plain&gt;</w:t><w:tab/><w:br/><w:cr/></w:r>
    <w:r><w:t/></w:r></w:p><w:p/>`);
  assert.deepEqual((await model(bytes)).blocks, [
    { type: 'heading', level: 2, runs: [
      { text: '  Café & 雪 🚀 ', b: true, i: true, u: true },
      { text: '<plain>\t\n\n' }, { text: '' },
    ] }, { type: 'paragraph', runs: [] },
  ]);
});

test('namespace URIs govern elements and attributes, including rebinding and default namespaces', async () => {
  const xml = `<document xmlns="${W}" xmlns:a="${W}"><body>
    <p><pPr><pStyle a:val="Heading1"/></pPr><r><rPr><b/></rPr><t>Yes</t></r>
      <x:r xmlns:x="urn:unrelated"><x:t>Ignore</x:t></x:r>
      <a:r xmlns:a="urn:unrelated"><a:t>Ignore</a:t></a:r></p>
    <p><pPr><pStyle val="Heading3"/></pPr></p></body></document>`;
  assert.deepEqual((await model(await fixture('', { 'word/document.xml': xml }))).blocks, [
    { type: 'heading', level: 1, runs: [{ text: 'Yes', b: true }] }, { type: 'paragraph', runs: [] },
  ]);
  const strict = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
  assert.equal((await model(await fixture('', { 'word/document.xml': document('<w:p><w:r><w:t>Strict</w:t></w:r></w:p>', strict) }))).blocks[0].runs[0].text, 'Strict');
});

test('paragraph, character and default styles inherit; direct formatting overrides them', async () => {
  const styles = `<w:styles xmlns:w="${W}">
    <w:docDefaults><w:rPrDefault><w:rPr><w:u/></w:rPr></w:rPrDefault></w:docDefaults>
    <w:style w:styleId="Normal" w:type="paragraph" w:default="1"><w:rPr><w:i/></w:rPr></w:style>
    <w:style w:styleId="Base"><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
    <w:style w:styleId="Custom"><w:basedOn w:val="Base"/></w:style>
    <w:style w:styleId="Emphasis"><w:rPr><w:i/></w:rPr></w:style></w:styles>`;
  const bytes = await fixture(`<w:p><w:pPr><w:pStyle w:val="Custom"/></w:pPr>
    <w:r><w:rPr><w:rStyle w:val="Emphasis"/><w:b w:val="false"/></w:rPr><w:t>styled</w:t></w:r></w:p>
    <w:p><w:r><w:t>default</w:t></w:r></w:p>`, { 'word/styles.xml': styles });
  assert.deepEqual((await model(bytes)).blocks, [
    { type: 'heading', level: 3, runs: [{ text: 'styled', i: true, u: true }] },
    { type: 'paragraph', runs: [{ text: 'default', i: true, u: true }] },
  ]);
});

test('numbered and bulleted list IDs, nesting and start overrides survive', async () => {
  const numbering = `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="3">
    <w:lvl w:ilvl="0"><w:start w:val="2"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
    <w:num w:numId="7"><w:abstractNumId w:val="3"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num></w:numbering>`;
  const paragraph = (level, id = 7) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>`;
  const blocks = (await model(await fixture(paragraph(0) + paragraph(1) + paragraph(0, 0), { 'word/numbering.xml': numbering }))).blocks;
  assert.deepEqual(blocks.map((b) => b.list), [
    { id: '7', level: 0, ordered: true, start: 5, format: 'decimal', text: '%1.' },
    { id: '7', level: 1, ordered: false, start: 1, format: 'bullet', text: '•' }, undefined,
  ]);
  await assert.rejects(readDocx(await fixture(paragraph(0))), /missing list definition/);
});

test('relationship hyperlinks and document anchors retain run formatting', async () => {
  const rels = `<p:Relationships xmlns:p="${P}"><p:Relationship Id="go" Type="${R}/hyperlink" Target="https://example.org/?a=1&amp;b=2" TargetMode="External"/></p:Relationships>`;
  const bytes = await fixture(`<w:p><w:hyperlink r:id="go"><w:r><w:rPr><w:i/></w:rPr><w:t>web</w:t></w:r></w:hyperlink>
    <w:hyperlink w:anchor="chapter"><w:r><w:t>inside</w:t></w:r></w:hyperlink></w:p>`, { 'word/_rels/document.xml.rels': rels });
  assert.deepEqual((await model(bytes)).blocks[0].runs, [
    { text: 'web', i: true, href: 'https://example.org/?a=1&b=2' }, { text: 'inside', href: '#chapter' },
  ]);
  for (const target of ['javascript:alert(1)', 'file:///secret', 'data:text/html,x', 'java&#x0a;script:alert(1)']) {
    await assert.rejects(readDocx(await fixture('<w:p><w:hyperlink r:id="go"/></w:p>', {
      'word/_rels/document.xml.rels': rels.replace('https://example.org/?a=1&amp;b=2', target),
    })), /unsafe hyperlink/);
  }
  await assert.rejects(readDocx(await fixture('<w:p><w:hyperlink r:id="missing"/></w:p>')), /unresolved hyperlink/);
});

test('DTD and entity declarations are rejected in every XML part before parsing', async () => {
  for (const declaration of [
    '<!DOCTYPE w:document SYSTEM "https://example.org/never-fetch.dtd">',
    '<!DOCTYPE w:document [<!ENTITY leak SYSTEM "file:///never-read">]>',
    '<!ENTITY x "expansion">',
  ]) {
    for (const part of ['word/document.xml', 'word/styles.xml', 'customXml/item1.xml']) {
      await assert.rejects(readDocx(await fixture('', { [part]: declaration + document('<w:p/>') })), /Unsafe DOCX XML/);
    }
    const utf16 = Buffer.from('\uFEFF' + declaration + document('<w:p/>'), 'utf16le');
    await assert.rejects(readDocx(await fixture('', { 'word/document.xml': utf16 })), /Unsafe DOCX XML/);
  }
});

test('malformed XML fails closed without HTML recovery or namespace guessing', async () => {
  for (const xml of [
    '', '<w:document/>', '<a/><b/>', '<a><b></a>', '<a/>trailing', '<a x="1" x="2"/>',
    '<a xmlns:x="urn:x" xmlns:y="urn:x" x:v="1" y:v="2"/>', '<a>&unknown;</a>',
    '<a>&amp</a>', '<a>&#0;</a>', '<a>&#x110000;</a>', '<a>\u0000</a>',
    '<a xmlns:xml="urn:fake"/>', '<a xmlns="http://www.w3.org/2000/xmlns/"/>',
    '<a\u00a0x="1"/>', '<a/>&#32;', '<?xml version="1.0\' ?><a/>',
    '<a><!-- bad -- comment --></a>', '<a><![CDATA[unterminated</a>', '<a>bad]]></a>',
    '<a' + '><a'.repeat(130) + '/>' + '</a>'.repeat(130),
  ]) {
    await assert.rejects(readDocx(await fixture('', { 'word/document.xml': xml })), /DOCX/);
  }
  assert.equal(parseXml('<a><!-- fine --><![CDATA[<&]]>&#65;</a>').children.join(''), '<&A');
  assert.equal(parseXml('<?xml version = "1.0" encoding = "utf-8"?><a/>').local, 'a');
});

test('malformed ZIPs and packages over each limit are rejected', async () => {
  await assert.rejects(readDocx(new Uint8Array()), /ZIP/);
  const bytes = await fixture('<w:p><w:r><w:t>' + 'x'.repeat(4096) + '</w:t></w:r></w:p>');
  await assert.rejects(readDocx(bytes.subarray(0, bytes.length - 3)), /ZIP/);
  for (const limits of [ { maxEntries: 1 }, { maxEntryUncompressed: 20 }, { maxTotalUncompressed: 20 } ]) {
    await assert.rejects(readDocx(bytes, '', { limits }), /DOCX package limits/);
  }
  const compressed = await fixture('<w:p><w:r><w:t>' + 'x'.repeat(100000) + '</w:t></w:r></w:p>', {}, 'DEFLATE');
  await assert.rejects(readDocx(compressed), /compression ratio/);
  const bomb = await fixture('', { 'customXml/large.xml': '<a>' + 'x'.repeat(DEFAULT_LIMITS.maxEntryUncompressed) + '</a>' }, 'DEFLATE');
  await assert.rejects(readDocx(bomb), /entry too large/);
  const traversal = await fixture('', { '../escape.xml': '<a/>' });
  await assert.rejects(readDocx(traversal), /bad name/);
  const duplicate = await fixture('', { 'WORD/DOCUMENT.XML': '<a/>' });
  await assert.rejects(readDocx(duplicate), /duplicate name/);
});

test('forged inflated lengths and corrupt payloads are rejected', async () => {
  const bytes = await fixture('<w:p><w:r><w:t>' + 'z'.repeat(50000) + '</w:t></w:r></w:p>', {}, 'DEFLATE');
  const forged = bytes.slice();
  const view = new DataView(forged.buffer);
  for (let i = 0; i < forged.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1, true);
  }
  await assert.rejects(readDocx(forged), /inflated size/);
  const corrupt = await fixture();
  const text = Buffer.from(corrupt).indexOf(Buffer.from('<w:p/>'));
  assert.ok(text > 0);
  corrupt[text + 3] = 113;
  await assert.rejects(readDocx(corrupt), /CRC/);
});

test('reader also loads as browser scripts with the existing JSZip global', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const sandbox = vm.createContext({ JSZip, Uint8Array, DataView, TextDecoder, URL });
  for (const file of ['limits', 'xml', 'package', 'read']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../formats/docx', file + '.js'), 'utf8'), sandbox);
  }
  const opened = await sandbox.NeoCraft_DocxRead.readDocx(await fixture('<w:p><w:r><w:t>Browser</w:t></w:r></w:p>'));
  assert.equal(opened.model.blocks[0].runs[0].text, 'Browser');
});
