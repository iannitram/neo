'use strict';

// .DOCX FIDELITY SCANNER: lists the features a Word file holds that NEO's
// simple model cannot keep, so the session can warn and offer the fallback
// instead of overwriting them. Pure string work over the package's
// document.xml, its relationships and its part names. Nothing is parsed
// into a tree and nothing is read from disk here.
//
// Plain JavaScript that also runs in Node (the tests) and in the browser
// (window.NeoCraft_DocxFidelity).

(function (root) {
  'use strict';

  // Each feature is the element start tags (qualified, as Word writes them)
  // that make it. A tag matches only when the local name is exact, so
  // <w:tblPr> does not count as a table and <w:delText> does not count as
  // a deletion.
  const FEATURES = [
    { feature: 'table', tags: ['w:tbl'] },
    { feature: 'image', tags: ['w:drawing', 'w:pict'] },
    { feature: 'comment', tags: ['w:commentRangeStart', 'w:commentReference'] },
    { feature: 'tracked change', tags: ['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'] },
    { feature: 'field', tags: ['w:fldSimple', 'w:fldChar'] },
    { feature: 'header or footer', tags: ['w:headerReference', 'w:footerReference'] },
    { feature: 'content control', tags: ['w:sdt'] },
    { feature: 'alternate content', tags: ['mc:AlternateContent'] },
    { feature: 'embedded object', tags: ['w:object'] },
    { feature: 'footnote', tags: ['w:footnoteReference', 'w:endnoteReference'] },
  ];

  // Start tag of a given name: "<" + name, then whitespace, ">" or "/".
  function countTag(xml, name) {
    const re = new RegExp('<' + name + '(?=[\\s>/])', 'g');
    let n = 0;
    while (re.exec(xml)) n++;
    return n;
  }

  // External relationships other than hyperlinks (a linked image, a linked
  // OLE object and so on) are features NEO cannot keep.
  function countExternalLinks(relsXml) {
    if (!relsXml) return 0;
    const tags = relsXml.match(/<Relationship\b[^>]*>/g) || [];
    let n = 0;
    for (const tag of tags) {
      const mode = /\sTargetMode\s*=\s*(["'])(.*?)\1/.exec(tag);
      if (!mode || mode[2] !== 'External') continue;
      const type = /\sType\s*=\s*(["'])(.*?)\1/.exec(tag);
      const typeValue = type ? type[2] : '';
      if (typeValue.endsWith('/hyperlink')) continue;
      n++;
    }
    return n;
  }

  function countEmbeddedParts(partNames) {
    if (!Array.isArray(partNames)) return 0;
    let n = 0;
    for (const name of partNames) {
      if (typeof name === 'string' && name.startsWith('word/embeddings/')) n++;
    }
    return n;
  }

  // scanDocx({ documentXml, relsXml = '', partNames = [] })
  //   -> { supported, unsupported: [{ feature, count }] sorted by feature }
  function scanDocx({ documentXml = '', relsXml = '', partNames = [] } = {}) {
    const xml = String(documentXml || '');
    const counts = new Map();

    for (const { feature, tags } of FEATURES) {
      let n = 0;
      for (const tag of tags) n += countTag(xml, tag);
      if (n > 0) counts.set(feature, n);
    }

    const links = countExternalLinks(relsXml);
    if (links > 0) counts.set('external link', (counts.get('external link') || 0) + links);

    const embedded = countEmbeddedParts(partNames);
    if (embedded > 0) counts.set('embedded object', (counts.get('embedded object') || 0) + embedded);

    const unsupported = [...counts.entries()]
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => (a.feature < b.feature ? -1 : a.feature > b.feature ? 1 : 0));

    return { supported: unsupported.length === 0, unsupported };
  }

  const api = { scanDocx };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_DocxFidelity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
