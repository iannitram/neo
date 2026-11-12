'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { readDocx } = require('../formats/docx/read');
const { writeDocx, DocxWriteError, docxAdapter } = require('../formats/docx/write');
const { parseXml } = require('../formats/docx/xml');
const { minimalDocxParts } = require('../formats/minimal');
const { DEFAULT_LIMITS } = require('../formats/docx/limits');
const { runAdapterContract } = require('./format-contract');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const STYLES = `<w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"/>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="Emphasis"><w:rPr><w:i/><w:color w:val="00AA00"/></w:rPr></w:style>
</w:styles>`;
const NUMBERING = `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const RELS = `<Relationships xmlns="${P}">
  <Relationship Id="rId1" Type="${R}/hyperlink" Target="https://example.org/a" TargetMode="External"/>
  <Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/>
</Relationships>`;
const EXTRA = {
  'docProps/core.xml': `${DECL}<cp:coreProperties xmlns:cp="urn:example:core"><cp:title>Placeholder</cp:title></cp:coreProperties>`,
  'customXml/item1.xml': `${DECL}<root><note>kept</note></root>`,
};

const document = (body, lineEnd = '') => `${DECL}${lineEnd}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`;

async function packageBytes(parts) {
  const zip = new JSZip();
  // A fixed date: JSZip otherwise stamps each entry with the clock (2 s resolution), so two builds could differ.
  for (const [name, data] of Object.entries(parts)) zip.file(name, data, { createFolders: false, date: new Date(0) });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
function parts(body, { lineEnd = '', rels = RELS, extra = {} } = {}) {
  const base = minimalDocxParts();
  const result = {
    '[Content_Types].xml': base['[Content_Types].xml'],
    '_rels/.rels': base['_rels/.rels'],
    'word/document.xml': document(body, lineEnd),
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
    ...EXTRA,
    ...extra,
  };
  if (rels !== null) result['word/_rels/document.xml.rels'] = rels;
  return result;
}
async function open(bytes) {
  return readDocx(bytes, 'fixture.docx');
}

const BODY = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">Plain </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Centred</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>`;
const LINKED = `<w:p><w:r><w:t xml:space="preserve">Visit </w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>site</w:t></w:r></w:hyperlink></w:p>
<w:p><w:r><w:t>Old text</w:t></w:r></w:p>`;

const fixtureBytes = {};
const fixturesReady = (async () => {
  fixtureBytes.plain = await packageBytes(parts(BODY));
  fixtureBytes.linked = await packageBytes(parts(LINKED, { lineEnd: '\r\n' }));
})();
const fixtures = [
  { name: 'plain', get bytes() { return fixtureBytes.plain; } },
  { name: 'linked-crlf', get bytes() { return fixtureBytes.linked; } },
];
// The kit reads each fixture when its check runs, so the checks wait for the build.
runAdapterContract((name, fn) => test(name, async () => { await fixturesReady; return fn(); }), docxAdapter, fixtures);

function clone(model) {
  return structuredClone(model);
}

// Body-level w:p elements as raw text, with the offsets the parser reports.
function paragraphSpans(xml) {
  const tree = parseXml(xml);
  const body = tree.children.find((c) => typeof c !== 'string' && c.local === 'body');
  return body.children.filter((c) => typeof c !== 'string' && c.local === 'p')
    .map((p) => ({ text: xml.slice(p.start, p.end), start: p.start, end: p.end }));
}

async function entries(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const out = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir) out.push([name, Buffer.from(await file.async('uint8array'))]);
  }
  return { names: Object.keys(zip.files), entries: new Map(out) };
}

function referencedRIds(xml) {
  const ids = new Set();
  const walk = (n) => {
    for (const key of n.attrs.keys()) {
      const at = key.lastIndexOf('|');
      if (key.slice(at + 1) === 'id' && [R, 'http://purl.oclc.org/ooxml/officeDocument/relationships'].includes(key.slice(0, at))) {
        ids.add(n.attrs.get(key));
      }
    }
    for (const c of n.children) if (typeof c !== 'string') walk(c);
  };
  walk(parseXml(xml));
  return ids;
}

async function refusal(promise, code) {
  await assert.rejects(promise, (error) => error instanceof DocxWriteError && error.code === code);
}

test('xml offsets are reported in the caller string even with CRLF and a BOM', () => {
  const xml = '﻿<a>\r\n<b/>\r\n<c>x\r\ny</c></a>';
  const tree = parseXml(xml);
  const [b, c] = tree.children.filter((n) => typeof n !== 'string');
  assert.equal(xml.slice(b.start, b.end), '<b/>');
  assert.equal(xml.slice(c.start, c.end), '<c>x\r\ny</c>');
  assert.equal(xml.slice(tree.start, tree.openEnd), '<a>');
});

test('changing one paragraph changes only that paragraph in document.xml', async () => {
  const { model, meta } = await open(await packageBytes(parts(BODY)));
  const edited = clone(model);
  edited.blocks[1].runs = [{ text: 'Edited ', b: true }, { text: 'text' }];
  const out = await writeDocx(edited, meta);
  const outDoc = await (await JSZip.loadAsync(out)).file('word/document.xml').async('string');
  const before = paragraphSpans(meta.documentXml);
  const after = paragraphSpans(outDoc);
  assert.equal(after.length, before.length);
  before.forEach((p, k) => {
    if (k === 1) assert.notEqual(after[k].text, p.text);
    else assert.equal(after[k].text, p.text, `paragraph ${k + 1} must keep its XML`);
  });
  assert.equal(outDoc.slice(0, after[1].start), meta.documentXml.slice(0, before[1].start));
  assert.equal(outDoc.slice(after[1].end), meta.documentXml.slice(before[1].end));
  assert.deepEqual((await readDocx(out)).model.blocks[1].runs, [{ text: 'Edited ', b: true }, { text: 'text' }]);
});

test('CRLF document: unchanged paragraphs and the declaration keep their exact bytes', async () => {
  const { model, meta } = await open(await packageBytes(parts(LINKED, { lineEnd: '\r\n' })));
  const edited = clone(model);
  edited.blocks[1].runs = [{ text: 'New text' }];
  const out = await writeDocx(edited, meta);
  const outDoc = await (await JSZip.loadAsync(out)).file('word/document.xml').async('string');
  const before = paragraphSpans(meta.documentXml);
  const after = paragraphSpans(outDoc);
  assert.equal(after[0].text, before[0].text);
  assert.ok(outDoc.startsWith(DECL + '\r\n<w:document'), 'the CRLF after the declaration is kept');
  assert.equal(outDoc.slice(0, after[1].start), meta.documentXml.slice(0, before[1].start));
  assert.equal(outDoc.slice(after[1].end), meta.documentXml.slice(before[1].end));
});

test('every other ZIP entry keeps its name, its order and its bytes', async () => {
  const { model, meta } = await open(await packageBytes(parts(BODY)));
  const edited = clone(model);
  edited.blocks[2].runs = [{ text: 'Replaced', i: true }];
  const out = await writeDocx(edited, meta);
  const before = await entries(meta.originalBytes);
  const after = await entries(out);
  assert.deepEqual(after.names, before.names, 'same names in the same order');
  for (const [name, bytes] of before.entries) {
    if (name === 'word/document.xml') continue;
    assert.ok(after.entries.get(name).equals(bytes), `${name} must be byte-identical`);
  }
  assert.ok(!after.entries.get('word/document.xml').equals(before.entries.get('word/document.xml')));
});

test('an edit with no change returns the original bytes exactly', async () => {
  const { model, meta } = await open(await packageBytes(parts(BODY)));
  const out = await writeDocx(clone(model), meta);
  assert.deepEqual(out, meta.originalBytes);
});

test('run properties the model does not hold survive a text edit; bold is explicit', async () => {
  const { model, meta } = await open(await packageBytes(parts(BODY)));
  const edited = clone(model);
  edited.blocks[1].runs = [{ text: 'Plain ' }, { text: 'bolder', b: true }];
  const out = await readDocx(await writeDocx(edited, meta));
  assert.deepEqual(out.model.blocks[1].runs, [{ text: 'Plain ' }, { text: 'bolder', b: true }]);
  const xml = (await (await JSZip.loadAsync(await writeDocx(edited, meta))).file('word/document.xml').async('string'));
  assert.ok(xml.includes('<w:color w:val="FF0000"/>'), 'the colour of the first run is kept');
  assert.ok(xml.includes('<nwx:b nwx:val="0"/>'), 'an unbold run is explicit');
});

test('a new hyperlink adds one relationship; existing relationships and every r:id stay valid', async () => {
  const { model, meta } = await open(await packageBytes(parts(LINKED)));
  const edited = clone(model);
  edited.blocks[1].runs = [
    { text: 'Go ' }, { text: 'new', href: 'https://example.org/new' },
    { text: ' and ' }, { text: 'again', href: 'https://example.org/a' },
  ];
  const out = await writeDocx(edited, meta);
  const zip = await JSZip.loadAsync(out);
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const doc = await zip.file('word/document.xml').async('string');
  const origRels = meta.relsXml;
  assert.ok(rels.startsWith(origRels.slice(0, origRels.lastIndexOf('</Relationships>'))), 'existing relationships keep their text');
  assert.equal((rels.match(/<Relationship /g) || []).length, 3, 'one new relationship; the existing target is reused');
  assert.ok(rels.includes('Id="rId3" Type="' + R + '/hyperlink" Target="https://example.org/new" TargetMode="External"'));
  const ids = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
  for (const id of referencedRIds(doc)) assert.ok(ids.has(id), `r:id ${id} must exist in the relationships`);
  assert.deepEqual((await readDocx(out)).model.blocks[1].runs, [
    { text: 'Go ' }, { text: 'new', href: 'https://example.org/new' },
    { text: ' and ' }, { text: 'again', href: 'https://example.org/a' },
  ]);
  assert.equal((await readDocx(out)).model.blocks[0].runs[1].href, 'https://example.org/a', 'the unchanged link keeps its target');
});

test('the written runs read back exactly: bold, italic, underline, tabs, breaks, anchors and links', async () => {
  const { model, meta } = await open(await packageBytes(parts('<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>')));
  const edited = clone(model);
  edited.blocks[0].runs = [
    { text: 'Hello ', b: true },
    { text: 'big\tworld', i: true, href: 'https://example.org/a' },
    { text: ' ', u: true },
    { text: 'anchor', href: '#top' },
    { text: 'line\nbreak' },
    { text: 'Café & 雪 🚀 ' },
  ];
  const out = await readDocx(await writeDocx(edited, meta));
  assert.deepEqual(out.model.blocks[0].runs, [
    { text: 'Hello ', b: true },
    { text: 'big\tworld', i: true, href: 'https://example.org/a' },
    { text: ' ', u: true },
    { text: 'anchor', href: '#top' },
    { text: 'line\nbreak' },
    { text: 'Café & 雪 🚀 ' },
  ]);
});

test('a list paragraph keeps its list properties and its heading level', async () => {
  const { model, meta } = await open(await packageBytes(parts(BODY)));
  const edited = clone(model);
  edited.blocks[3].runs = [{ text: 'changed item' }];
  const out = await readDocx(await writeDocx(edited, meta));
  assert.deepEqual(out.model.blocks[3].list, model.blocks[3].list);
  assert.deepEqual(out.model.blocks[0], model.blocks[0]);
});

test('paragraph properties and the w:p tag are kept; rsid and layout caches are dropped from the regenerated runs', async () => {
  const body = '<w:p w:rsidR="00A10001" w:rsidRDefault="00A10001"><w:pPr><w:jc w:val="right"/></w:pPr>'
    + '<w:r w:rsidRPr="00B20002"><w:lastRenderedPageBreak/><w:t>Old</w:t></w:r><w:proofErr w:type="spellStart"/></w:p>';
  const { model, meta } = await open(await packageBytes(parts(body)));
  const edited = clone(model);
  edited.blocks[0].runs = [{ text: 'New' }];
  const out = await writeDocx(edited, meta);
  const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('string');
  assert.match(xml, /<w:p w:rsidR="00A10001" w:rsidRDefault="00A10001" [^>]*><w:pPr><w:jc w:val="right"\/><\/w:pPr>/);
  assert.ok(!xml.includes('lastRenderedPageBreak'));
  assert.ok(!xml.includes('rsidRPr'));
  assert.ok(!xml.includes('proofErr'));
  assert.deepEqual((await readDocx(out)).model.blocks[0].runs, [{ text: 'New' }]);
});

test('a relationships part with a self-closing root gets its first relationship', async () => {
  const minimal = minimalDocxParts();
  const { model, meta } = await open(await packageBytes({ ...minimal, 'word/styles.xml': STYLES }));
  const edited = clone(model);
  edited.blocks[0].runs = [{ text: 'Link', href: 'https://example.org/first' }];
  const out = await writeDocx(edited, meta);
  const rels = await (await JSZip.loadAsync(out)).file('word/_rels/document.xml.rels').async('string');
  assert.ok(rels.includes('<Relationships xmlns="' + P + '">'), 'the self-closing root is opened and closed');
  assert.ok(rels.endsWith('</Relationships>'));
  assert.ok(rels.includes('<Relationship Id="rId1" Type="' + R + '/hyperlink" Target="https://example.org/first" TargetMode="External"/>'));
  assert.deepEqual((await readDocx(out)).model.blocks[0].runs, [{ text: 'Link', href: 'https://example.org/first' }]);
});

test('a refused edit throws a typed error and leaves the original bytes untouched', async () => {
  const bookmark = '<w:p><w:bookmarkStart w:id="0" w:name="mark"/><w:r><w:t>Anchored</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>';
  const pageBreak = '<w:p><w:r><w:t>A</w:t><w:br w:type="page"/><w:t>B</w:t></w:r></w:p>';
  const cases = [
    { name: 'a paragraph added', body: BODY, code: 'unsupported-edit', edit: (m) => m.blocks.push({ type: 'paragraph', runs: [] }) },
    { name: 'a heading turned into a paragraph', body: BODY, code: 'unsupported-edit', edit: (m) => { m.blocks[0] = { type: 'paragraph', runs: [{ text: 'Chapter One' }] }; } },
    { name: 'an unknown run property', body: BODY, code: 'unsupported-edit', edit: (m) => { m.blocks[1].runs = [{ text: 'x', font: 'Arial' }]; } },
    { name: 'a bookmark in the paragraph', body: bookmark, code: 'unrepresentable', edit: (m) => { m.blocks[0].runs = [{ text: 'Anchored again' }]; } },
    { name: 'a page break in the paragraph', body: pageBreak, code: 'unrepresentable', edit: (m) => { m.blocks[0].runs = [{ text: 'AC' }]; } },
    { name: 'a javascript link', body: BODY, code: 'unsafe-hyperlink', edit: (m) => { m.blocks[2].runs = [{ text: 'x', href: 'javascript:alert(1)' }]; } },
    { name: 'a control character', body: BODY, code: 'invalid-text', edit: (m) => { m.blocks[2].runs = [{ text: 'a\u0001b' }]; } },
    { name: 'a non-string run', body: BODY, code: 'invalid-model', edit: (m) => { m.blocks[2].runs = [{ text: 3 }]; } },
  ];
  for (const { name, body, code, edit } of cases) {
    const { model, meta } = await open(await packageBytes(parts(body)));
    const edited = clone(model);
    edit(edited);
    const before = Buffer.from(meta.originalBytes);
    await refusal(writeDocx(edited, meta), code);
    assert.ok(Buffer.from(meta.originalBytes).equals(before), `${name}: the original bytes must not change`);
    assert.deepEqual((await open(meta.originalBytes)).model, model, `${name}: the original still reads as before`);
  }
});

test('a link with no relationships part is refused, not written with a dangling id', async () => {
  const { model, meta } = await open(await packageBytes(parts(BODY, { rels: null })));
  const edited = clone(model);
  edited.blocks[1].runs = [{ text: 'x', href: 'https://example.org/new' }];
  await refusal(writeDocx(edited, meta), 'unsupported-edit');
});

test('the written package must stay within the limits, and an output over them is refused', async () => {
  const { model, meta } = await open(await packageBytes(parts(BODY)));
  const edited = clone(model);
  edited.blocks[1].runs = [{ text: 'x'.repeat(400) }];
  const docSize = Buffer.byteLength(meta.documentXml);
  await refusal(writeDocx(edited, meta, { limits: { ...DEFAULT_LIMITS, maxEntryUncompressed: docSize + 20 } }), 'output-invalid');
  assert.ok(Buffer.from(meta.originalBytes).equals(Buffer.from(await packageBytes(parts(BODY)))));
});

test('an unchanged model with an unsafe link elsewhere is refused before any package work', async () => {
  const { model, meta } = await open(await packageBytes(parts(LINKED)));
  const edited = clone(model);
  edited.blocks[1].runs = [{ text: 'fine' }];
  edited.blocks[0].runs[0].href = 'file:///etc/passwd';
  await refusal(writeDocx(edited, meta), 'unsafe-hyperlink');
});

test('a reader-compatible model that rewrites every paragraph reads back equal', async () => {
  const { model, meta } = await open(await packageBytes(parts(BODY)));
  const edited = clone(model);
  edited.blocks = edited.blocks.map((block, k) => ({ ...block, runs: [{ text: 'Paragraph ' + k, b: k % 2 === 0 }] }));
  const out = await readDocx(await writeDocx(edited, meta));
  // The reader reports bold only when it is on; an explicit off reads back as no key.
  const expected = edited.blocks.map((b) => b.runs.map((r) => ({ text: r.text, ...(r.b ? { b: true } : {}) })));
  assert.deepEqual(out.model.blocks.map((b) => b.runs), expected);
  assert.deepEqual(out.model.blocks.map((b) => [b.type, b.level, b.list]), edited.blocks.map((b) => [b.type, b.level, b.list]));
});

// The patcher and JSZip read whether Buffer exists when they load (JSZip's support.nodebuffer),
// so the Buffer-free run loads fresh copies with the global removed, as the browser would have it.
function loadWithoutBuffer() {
  const dir = path.join(__dirname, '..', 'formats', 'docx');
  const fresh = (id) => id.startsWith(dir) || id.includes(`${path.sep}node_modules${path.sep}jszip${path.sep}`);
  const saved = new Map(Object.entries(require.cache).filter(([id]) => fresh(id)));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  for (const id of saved.keys()) delete require.cache[id];
  delete globalThis.Buffer;
  try {
    return require(path.join(dir, 'write.js'));
  } finally {
    Object.defineProperty(globalThis, 'Buffer', descriptor);
    for (const id of Object.keys(require.cache)) if (fresh(id)) delete require.cache[id];
    Object.assign(require.cache, Object.fromEntries(saved));
  }
}

test('the patcher saves without Node\'s Buffer (the browser has none)', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'formats', 'docx', 'write.js'), 'utf8');
  assert.doesNotMatch(source, /\bBuffer\b/);
  const bare = loadWithoutBuffer();
  const { model, meta } = await open(await packageBytes(parts(BODY)));
  const edited = clone(model);
  edited.blocks[1].runs = [{ text: 'Edited ', b: true }, { text: 'text' }];
  const out = await bare.writeDocx(edited, meta);
  assert.deepEqual((await readDocx(out)).model.blocks[1].runs, [{ text: 'Edited ', b: true }, { text: 'text' }]);
  assert.equal(typeof globalThis.Buffer, 'function');
});

test('a changed untouched part is still refused as output-invalid', async () => {
  const { model, meta } = await open(await packageBytes(parts(BODY)));
  const edited = clone(model);
  edited.blocks[1].runs = [{ text: 'Edited ', b: true }, { text: 'text' }];
  // Tamper with an untouched part in the output, after the writer has assembled it.
  const proto = JSZip.prototype;
  const generate = proto.generateAsync;
  proto.generateAsync = function tampered(...args) {
    this.file('docProps/core.xml', 'changed behind the writer');
    return generate.apply(this, args);
  };
  try {
    await refusal(writeDocx(edited, meta), 'output-invalid');
  } finally {
    proto.generateAsync = generate;
  }
  assert.deepEqual((await open(meta.originalBytes)).model, model);
});
