'use strict';

// Reader half of the format adapter contract (#33): readDocx(bytes, name)
// resolves to { model, meta }. Writing/adapter assembly belongs to #54.
// No shared session model exists yet. This typed shape uses NEO's b/i/u runs:
// { type: 'document', blocks: [{ type: 'paragraph' | 'heading', level?,
//   runs: [{ text, b?, i?, u?, href? }], list?:
//     { id, level, ordered, start, format, text } }] }
// Lists annotate paragraphs in document order; level is zero-based. `start`
// is the numbering definition's start, not a computed display counter.
// meta retains the input and XML for the later package-patching writer.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const { readPackage } = node ? require('./package') : root.NeoCraft_DocxPackage;
  const { parseXml } = node ? require('./xml') : root.NeoCraft_DocxXml;
  const W = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
  const R = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'];
  const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const is = (n, local) => n && W.includes(n.uri) && n.local === local;
  const children = (n, local) => (n?.children || []).filter((c) => is(c, local));
  const child = (n, local) => children(n, local)[0];
  const attr = (n, key) => n?.attrs.get((n && W.includes(n.uri) ? n.uri : '') + '|' + key);
  const val = (n) => attr(n, 'val');
  const bad = (detail) => { throw new Error('Invalid DOCX: ' + detail); };
  function integer(value, fallback, max = 2147483647) {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) > max) return bad('invalid number');
    return Number(value);
  }

  function marks(properties) {
    const result = {};
    for (const key of ['b', 'i', 'u']) {
      const element = child(properties, key);
      if (element) result[key] = !['0', 'false', 'off', 'none'].includes(val(element));
    }
    return result;
  }

  function stylesFor(styles) {
    const definitions = new Map(children(styles, 'style').map((s) => [attr(s, 'styleId'), s]));
    const defaults = child(styles, 'docDefaults');
    const defaultMarks = marks(child(child(defaults, 'rPrDefault'), 'rPr'));
    const defaultParagraph = children(styles, 'style').find((s) => attr(s, 'type') === 'paragraph' && ['1', 'true', 'on'].includes(attr(s, 'default')));
    function resolve(id, seen = new Set()) {
      if (!id || !definitions.has(id)) return { marks: {} };
      if (seen.has(id) || seen.size > 64) return bad('cyclic styles');
      seen.add(id);
      const style = definitions.get(id);
      const base = resolve(val(child(style, 'basedOn')), seen);
      const properties = child(style, 'pPr');
      return {
        marks: { ...base.marks, ...marks(child(style, 'rPr')) },
        outline: val(child(properties, 'outlineLvl')) ?? base.outline,
        numPr: child(properties, 'numPr') || base.numPr,
      };
    }
    return { resolve, defaultMarks, defaultId: attr(defaultParagraph, 'styleId') };
  }

  function listFor(numbering, numPr) {
    const id = val(child(numPr, 'numId'));
    if (id === undefined || id === '0') return undefined;
    integer(id);
    const level = integer(val(child(numPr, 'ilvl')), 0, 8);
    const num = children(numbering, 'num').find((n) => attr(n, 'numId') === id);
    const abstract = children(numbering, 'abstractNum').find((n) => attr(n, 'abstractNumId') === val(child(num, 'abstractNumId')));
    const override = children(num, 'lvlOverride').find((n) => integer(attr(n, 'ilvl'), 0, 8) === level);
    const definition = child(override, 'lvl') || children(abstract, 'lvl').find((n) => integer(attr(n, 'ilvl'), 0, 8) === level);
    const format = val(child(definition, 'numFmt'));
    if (!num || !definition || !format) return bad('missing list definition');
    return {
      id, level, ordered: format !== 'bullet', format,
      start: integer(val(child(override, 'startOverride')) ?? val(child(definition, 'start')), 1),
      text: val(child(definition, 'lvlText')) || '',
    };
  }

  function safeLink(target) {
    if (!target || [...target].some((char) => char.codePointAt(0) <= 32 || char.codePointAt(0) === 127)) return bad('unsafe hyperlink');
    if (target.startsWith('#')) return target;
    let url;
    try { url = new URL(target); } catch { return bad('invalid hyperlink'); }
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return bad('unsafe hyperlink');
    return target;
  }

  async function readDocx(bytes, name = '', options = {}) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('DOCX bytes must be a Uint8Array');
    const originalBytes = new Uint8Array(bytes); // Buffer.slice() would alias the caller
    const { parts, partNames } = await readPackage(originalBytes, options.limits);
    for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
      if (!parts.has(required)) return bad('missing package part ' + required);
    }
    const trees = new Map();
    const wanted = ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels'];
    for (const [partName, xml] of parts) {
      const tree = parseXml(xml); // entity check runs before parsing every XML part
      if (wanted.includes(partName)) trees.set(partName, tree);
    }
    const document = trees.get('word/document.xml');
    const body = child(document, 'body');
    if (!is(document, 'document') || !body || children(document, 'body').length !== 1) return bad('missing document body');
    const styles = trees.get('word/styles.xml');
    const numbering = trees.get('word/numbering.xml');
    if (styles && !is(styles, 'styles') || numbering && !is(numbering, 'numbering')) return bad('invalid supporting part');
    const style = stylesFor(styles);
    const rels = trees.get('word/_rels/document.xml.rels');
    if (rels && (rels.uri !== P || rels.local !== 'Relationships')) return bad('invalid relationships');
    const links = new Map();
    for (const rel of rels?.children || []) {
      if (rel.uri !== P || rel.local !== 'Relationship') continue;
      const get = (key) => rel.attrs.get('|' + key);
      const id = get('Id');
      if (!id || links.has(id)) return bad('duplicate or missing relationship id');
      links.set(id, R.some((uri) => get('Type') === uri + '/hyperlink') && get('TargetMode') === 'External' ? get('Target') : undefined);
    }
    const blocks = children(body, 'p').map((paragraph) => {
      const properties = child(paragraph, 'pPr');
      const styleId = val(child(properties, 'pStyle')) || style.defaultId;
      const inherited = style.resolve(styleId);
      const outline = val(child(properties, 'outlineLvl')) ?? inherited.outline;
      const conventional = /^Heading([1-9])$/i.exec(styleId || '');
      const level = outline !== undefined ? integer(outline, 9, 9) + 1 : conventional ? Number(conventional[1]) : 10;
      const block = level <= 9 ? { type: 'heading', level, runs: [] } : { type: 'paragraph', runs: [] };
      const numPr = child(properties, 'numPr');
      const list = listFor(numbering, numPr ? {
        children: [...children(numPr, 'ilvl'), ...children(numPr, 'numId'), ...(inherited.numPr?.children || [])],
      } : inherited.numPr);
      if (list) block.list = list;
      function run(n, href) {
        const rp = child(n, 'rPr');
        const formatting = { ...style.defaultMarks, ...inherited.marks, ...style.resolve(val(child(rp, 'rStyle'))).marks, ...marks(rp) };
        let text = '';
        for (const piece of n.children) {
          if (is(piece, 't')) text += piece.children.filter((c) => typeof c === 'string').join('');
          else if (is(piece, 'tab')) text += '\t';
          else if (is(piece, 'br') || is(piece, 'cr')) text += '\n';
        }
        const result = { text };
        for (const key of ['b', 'i', 'u']) if (formatting[key]) result[key] = true;
        if (href) result.href = href;
        block.runs.push(result); // keep blank runs and significant spaces
      }
      for (const item of paragraph.children) {
        if (is(item, 'r')) run(item);
        else if (is(item, 'hyperlink')) {
          const id = R.map((uri) => item.attrs.get(uri + '|id')).find((v) => v !== undefined);
          const anchor = attr(item, 'anchor');
          const target = id !== undefined ? links.get(id) : anchor ? '#' + anchor : undefined;
          if (!target) return bad('unresolved hyperlink');
          const href = safeLink(target);
          for (const r of children(item, 'r')) run(r, href);
        }
      }
      return block;
    });
    return { model: { type: 'document', blocks }, meta: {
      name, originalBytes, documentXml: parts.get('word/document.xml'),
      relsXml: parts.get('word/_rels/document.xml.rels') || '', partNames,
    } };
  }

  const api = { readDocx };
  if (node) module.exports = api;
  else root.NeoCraft_DocxRead = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
