'use strict';

// Package-patching writer for .docx (#54). writeDocx(model, meta, options)
// returns new package bytes for an edited model, or throws a DocxWriteError.
// Only the paragraphs whose runs changed are regenerated in word/document.xml;
// every other paragraph keeps its exact XML text. Every other ZIP entry keeps
// its name, its position and its decompressed bytes. A new external hyperlink
// adds one Relationship element to word/_rels/document.xml.rels; existing
// elements keep their text. The result is read back through readDocx, with the
// same limits and the entity check, and must equal the edited model before any
// bytes are returned.
//
// Paragraphs are matched by index. A model with a different paragraph count,
// or a block whose type, level or list changed, is refused.
//
// A regenerated paragraph keeps its w:pPr verbatim. A regenerated run keeps the
// run properties NEO does not model (colour, size, character style) from the
// original character at the same place. Bold, italic and underline are written
// explicitly, so they do not depend on styles. Dropped on regeneration: w:rsid*
// attributes, w:lastRenderedPageBreak and w:proofErr (Word's revision, layout
// and spelling caches; Word recomputes them).
// Refused: anything else the paragraph holds (fields, bookmarks, drawings,
// page or column breaks, tracked changes, comments), unsafe hyperlinks, and
// text that XML cannot store.
//
// Plain JavaScript that also runs in Node (the tests) and in the browser
// (window.NeoCraft_DocxWrite; read.js, xml.js, limits.js and scan.js load first).

(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const JSZip = node ? require('jszip') : root.JSZip;
  const { readDocx, safeLink } = node ? require('./read') : root.NeoCraft_DocxRead;
  const { parseXml } = node ? require('./xml') : root.NeoCraft_DocxXml;
  const { DEFAULT_LIMITS } = node ? require('./limits') : root.NeoCraft_DocxLimits;
  const { scanDocx } = node ? require('./scan') : root.NeoCraft_DocxFidelity;

  const W_URIS = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
  const R_URIS = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'];
  const P_URI = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const XML_URI = 'http://www.w3.org/XML/1998/namespace';
  const DOCUMENT_PART = 'word/document.xml';
  const RELS_PART = 'word/_rels/document.xml.rels';
  const NS_W = 'nwx'; // prefixes declared on each regenerated paragraph
  const NS_R = 'nwr';
  const HEAD = ['rStyle', 'rFonts']; // schema order: these lead w:rPr
  const AFTER_U = ['effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
  const INVALID_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u;
  const RUN_KEYS = ['text', 'b', 'i', 'u', 'href'];
  const BLOCK_KEYS = ['type', 'level', 'runs', 'list'];
  const NO_KEYS = '[]';

  class DocxWriteError extends Error {
    constructor(code, detail) {
      super(`DOCX write refused (${code}): ${detail}`);
      this.name = 'DocxWriteError';
      this.code = code;
    }
  }
  const refuse = (code, detail) => { throw new DocxWriteError(code, detail); };

  const isW = (n, local) => !!n && typeof n === 'object' && n.local === local && W_URIS.includes(n.uri);
  const elements = (n) => (n.children || []).filter((c) => typeof c !== 'string');
  const isBlank = (s) => /^[ \t\n]*$/.test(s);
  const stable = (value) => JSON.stringify(value, (key, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
  const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
  const escAttr = (s) => escText(s).replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;');

  function attrList(n) {
    return [...n.attrs.keys()].map((key) => {
      const at = key.lastIndexOf('|');
      return { uri: key.slice(0, at), local: key.slice(at + 1) };
    });
  }
  const isRsid = (a) => W_URIS.includes(a.uri) && a.local.startsWith('rsid');
  const wAttr = (local) => (a) => W_URIS.includes(a.uri) && a.local === local;
  const rAttr = (local) => (a) => R_URIS.includes(a.uri) && a.local === local;
  const xmlSpace = (a) => a.uri === XML_URI && a.local === 'space';
  function allowAttrs(n, allowed) {
    for (const a of attrList(n)) {
      if (!isRsid(a) && !allowed.some((ok) => ok(a))) refuse('unrepresentable', `<${n.qname}> has attribute ${a.local}`);
    }
  }

  function linkOk(href) {
    try { safeLink(href); return true; } catch { return false; }
  }

  // The model as the caller gives it: checked here, so a bad edit is refused
  // before any package work.
  function normalizeRun(run) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) refuse('invalid-model', 'a run must be an object');
    for (const key of Object.keys(run)) {
      if (!RUN_KEYS.includes(key)) refuse('unsupported-edit', `run property ${key} is not in the supported model`);
    }
    if (typeof run.text !== 'string') refuse('invalid-model', 'run text must be a string');
    for (const key of ['b', 'i', 'u']) {
      if (run[key] !== undefined && typeof run[key] !== 'boolean') refuse('invalid-model', `run ${key} must be a boolean`);
    }
    if (run.href !== undefined) {
      if (typeof run.href !== 'string') refuse('invalid-model', 'run href must be a string');
      if (!linkOk(run.href)) refuse('unsafe-hyperlink', 'hyperlink target is not http, https, mailto or an anchor');
    }
    return { text: run.text, b: run.b === true, i: run.i === true, u: run.u === true, href: run.href };
  }

  function normalizeBlock(block) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) refuse('invalid-model', 'a block must be an object');
    for (const key of Object.keys(block)) {
      if (!BLOCK_KEYS.includes(key)) refuse('unsupported-edit', `block property ${key} is not in the supported model`);
    }
    if (!Array.isArray(block.runs)) refuse('invalid-model', 'block runs must be an array');
    return {
      shape: stable([block.type, block.level ?? null, block.list ?? null]),
      runs: block.runs.map(normalizeRun),
    };
  }

  // Runs as a reader would see them: no empty runs, adjacent runs with the same
  // formatting and target joined. Two models with the same canonical runs
  // describe the same paragraph.
  function canonical(runs) {
    const out = [];
    for (const run of runs) {
      if (run.text === '') continue;
      const last = out[out.length - 1];
      if (last && last.b === run.b && last.i === run.i && last.u === run.u && last.href === run.href) last.text += run.text;
      else out.push({ ...run });
    }
    return out;
  }

  // Reads one w:r as read.js does (one run per w:r, text from t, tab, br, cr)
  // and keeps the run properties the model does not hold, as raw XML.
  function readRun(r, raw) {
    allowAttrs(r, []);
    let text = '';
    let props = null;
    let seenContent = false;
    for (const c of r.children) {
      if (typeof c === 'string') {
        if (!isBlank(c)) refuse('unrepresentable', 'text outside w:t in a run');
        continue;
      }
      if (isW(c, 'rPr')) {
        if (props || seenContent) refuse('unrepresentable', 'run properties are not first in a run');
        props = c;
        continue;
      }
      seenContent = true;
      if (isW(c, 't')) {
        allowAttrs(c, [xmlSpace]);
        for (const s of c.children) {
          if (typeof s !== 'string') refuse('unrepresentable', 'an element inside w:t');
          text += s;
        }
      } else if (isW(c, 'tab')) {
        allowAttrs(c, []);
        text += '\t';
      } else if (isW(c, 'br')) {
        allowAttrs(c, [wAttr('type')]);
        const type = c.attrs.get(c.uri + '|type');
        if (type !== undefined && type !== 'textWrapping') refuse('unrepresentable', `a ${type} break`);
        text += '\n';
      } else if (isW(c, 'cr')) {
        allowAttrs(c, []);
        text += '\n';
      } else if (isW(c, 'lastRenderedPageBreak') && c.children.length === 0) {
        allowAttrs(c, []); // a layout cache, dropped when the run is regenerated
      } else {
        refuse('unrepresentable', `<${c.qname}> in a run`);
      }
    }
    const extras = props ? elements(props)
      .filter((c) => !isW(c, 'b') && !isW(c, 'i') && !isW(c, 'u'))
      .map((c) => ({ local: c.local, xml: raw.slice(c.start, c.end) })) : [];
    return { text, extras };
  }

  // A paragraph's pPr and runs (direct and inside hyperlinks, in document
  // order: the order read.js uses). Anything else in it is refused.
  function readParagraph(p, raw) {
    let pPr = null;
    const runs = [];
    let seenContent = false;
    for (const c of p.children) {
      if (typeof c === 'string') {
        if (!isBlank(c)) refuse('unrepresentable', 'text outside a run');
        continue;
      }
      if (isW(c, 'pPr')) {
        if (pPr || seenContent) refuse('unrepresentable', 'paragraph properties are not first');
        pPr = c;
        continue;
      }
      seenContent = true;
      if (isW(c, 'proofErr') && c.children.length === 0) {
        allowAttrs(c, [wAttr('type')]); // a spelling mark, dropped with the regenerated paragraph
      } else if (isW(c, 'r')) {
        runs.push(readRun(c, raw));
      } else if (isW(c, 'hyperlink')) {
        allowAttrs(c, [rAttr('id'), wAttr('anchor')]);
        for (const r of c.children) {
          if (typeof r === 'string') {
            if (!isBlank(r)) refuse('unrepresentable', 'text inside a hyperlink');
            continue;
          }
          if (!isW(r, 'r')) refuse('unrepresentable', `<${r.qname}> inside a hyperlink`);
          runs.push(readRun(r, raw));
        }
      } else {
        refuse('unrepresentable', `<${c.qname}> in a paragraph`);
      }
    }
    return { pPr, runs };
  }

  // Each edited character takes the run properties of the original character
  // in the same place. Text before and after the one changed span keeps its
  // own; inserted text takes the character before it. Edited runs are split
  // where those properties change. The result is a list of pieces.
  function pieces(origRuns, edited) {
    const O = origRuns.map((r) => r.text).join('');
    const E = edited.map((r) => r.text).join('');
    const keyed = new Map([[NO_KEYS, []]]);
    const okeys = [];
    for (const run of origRuns) {
      const key = JSON.stringify(run.extras.map((e) => e.xml));
      keyed.set(key, run.extras);
      for (let k = 0; k < run.text.length; k++) okeys.push(key);
    }
    const at = (k) => (okeys.length ? okeys[Math.min(Math.max(k, 0), okeys.length - 1)] : NO_KEYS);
    let p = 0;
    while (p < O.length && p < E.length && O[p] === E[p]) p++;
    let s = 0;
    while (s < O.length - p && s < E.length - p && O[O.length - 1 - s] === E[E.length - 1 - s]) s++;
    const keyAt = (j) => {
      if (j < p) return at(j);
      if (j >= E.length - s) return at(j - (E.length - O.length));
      return at(p - 1);
    };
    const ek = Array.from({ length: E.length }, (_, j) => keyAt(j)); // per code unit, as the offsets are
    const out = [];
    let pos = 0;
    for (const run of edited) {
      const fmt = { b: run.b, i: run.i, u: run.u, href: run.href };
      if (run.text === '') {
        out.push({ ...fmt, text: '', extras: keyed.get(keyAt(pos)) });
      } else {
        let start = pos;
        for (let j = pos + 1; j <= pos + run.text.length; j++) {
          if (j === pos + run.text.length || ek[j] !== ek[start]) {
            out.push({ ...fmt, text: E.slice(start, j), extras: keyed.get(ek[start]) });
            start = j;
          }
        }
      }
      pos += run.text.length;
    }
    return out;
  }

  function textXml(text, pfx) {
    if (INVALID_XML.test(text)) refuse('invalid-text', 'text holds a character XML cannot store');
    return text.split(/(\t|\n)/).map((seg) => {
      if (seg === '') return '';
      if (seg === '\t') return `<${pfx}tab/>`;
      if (seg === '\n') return `<${pfx}br/>`;
      return `<${pfx}t xml:space="preserve">${escText(seg)}</${pfx}t>`;
    }).join('');
  }

  // rPr: leading style and font, then bold and its complex-script partner,
  // italic and its partner, then the rest in order, with underline before the
  // properties that follow it in the schema.
  function propsXml(piece, pfx) {
    const flag = (name, on) => (on ? `<${pfx}${name}/>` : `<${pfx}${name} ${pfx}val="0"/>`);
    const xmlOf = (list) => list.map((e) => e.xml);
    const extras = piece.extras;
    const head = extras.filter((e) => HEAD.includes(e.local));
    const bcs = extras.filter((e) => e.local === 'bCs');
    const ics = extras.filter((e) => e.local === 'iCs');
    const others = extras.filter((e) => !HEAD.includes(e.local) && e.local !== 'bCs' && e.local !== 'iCs');
    const cut = others.findIndex((e) => AFTER_U.includes(e.local));
    const split = cut < 0 ? others.length : cut;
    const u = piece.u ? `<${pfx}u ${pfx}val="single"/>` : `<${pfx}u ${pfx}val="none"/>`;
    return [
      ...xmlOf(head), flag('b', piece.b), ...xmlOf(bcs), flag('i', piece.i), ...xmlOf(ics),
      ...xmlOf(others.slice(0, split)), u, ...xmlOf(others.slice(split)),
    ].join('');
  }

  function runsXml(ps, linkFor) {
    const pfx = NS_W + ':';
    let out = '';
    let current = null;
    for (const piece of ps) {
      const href = piece.href ?? null;
      if (href !== current) {
        if (current !== null) out += `</${pfx}hyperlink>`;
        if (href !== null) {
          const target = href.startsWith('#')
            ? `${pfx}anchor="${escAttr(href.slice(1))}"`
            : `${NS_R}:id="${escAttr(linkFor(href))}"`;
          out += `<${pfx}hyperlink ${target}>`;
        }
        current = href;
      }
      out += `<${pfx}r><${pfx}rPr>${propsXml(piece, pfx)}</${pfx}rPr>${textXml(piece.text, pfx)}</${pfx}r>`;
    }
    if (current !== null) out += `</${pfx}hyperlink>`;
    return out;
  }

  // Relationships of the part: existing ids and hyperlink targets, the
  // relationship namespace in use, and the elements to add.
  function relationships(relsXml) {
    const info = { tree: null, ids: new Set(), targets: new Map(), uri: R_URIS[0], prefix: '', added: [] };
    if (!relsXml) return info;
    const tree = parseXml(relsXml);
    if (tree.uri !== P_URI || tree.local !== 'Relationships') refuse('unrepresentable', 'invalid relationships part');
    info.tree = tree;
    info.prefix = tree.qname.includes(':') ? tree.qname.slice(0, tree.qname.indexOf(':') + 1) : '';
    const types = [];
    for (const rel of elements(tree)) {
      if (rel.uri !== P_URI || rel.local !== 'Relationship') continue;
      const get = (key) => rel.attrs.get('|' + key);
      if (get('Id')) info.ids.add(get('Id'));
      types.push(get('Type') || '');
      const hyperlink = R_URIS.some((uri) => get('Type') === uri + '/hyperlink');
      if (hyperlink && get('TargetMode') === 'External' && !info.targets.has(get('Target'))) info.targets.set(get('Target'), get('Id'));
    }
    info.uri = R_URIS.find((uri) => types.some((t) => t.startsWith(uri + '/'))) || R_URIS[0];
    return info;
  }

  function linkFor(info) {
    return (href) => {
      if (info.targets.has(href)) return info.targets.get(href);
      if (!info.tree) refuse('unsupported-edit', 'the package has no relationships part to hold a new hyperlink');
      let n = 0;
      for (const id of info.ids) {
        const m = /^rId(\d+)$/.exec(id || '');
        if (m) n = Math.max(n, Number(m[1]));
      }
      let id;
      do { id = 'rId' + ++n; } while (info.ids.has(id));
      info.ids.add(id);
      info.targets.set(href, id);
      info.added.push(`<${info.prefix}Relationship Id="${id}" Type="${info.uri}/hyperlink" Target="${escAttr(href)}" TargetMode="External"/>`);
      return id;
    };
  }

  // The relationships text with the new elements added before the closing tag.
  // Existing text is not touched.
  function relsWithAdded(info, relsXml) {
    if (!info.added.length) return null;
    const add = info.added.join('');
    const tree = info.tree;
    if (tree.selfClosing) {
      return relsXml.slice(0, tree.openEnd - 2) + '>' + add + `</${tree.qname}>` + relsXml.slice(tree.end);
    }
    const close = relsXml.lastIndexOf('</', tree.end - 1);
    return relsXml.slice(0, close) + add + relsXml.slice(close);
  }

  function paragraphXml(p, raw, pPr, ps, linkFor, rUri) {
    const decl = ` xmlns:${NS_W}="${p.uri}" xmlns:${NS_R}="${rUri}"`;
    const open = (p.selfClosing ? raw.slice(p.start, p.openEnd - 2).trimEnd() : raw.slice(p.start, p.openEnd - 1)) + decl + '>';
    const props = pPr ? raw.slice(pPr.start, pPr.end) : '';
    return open + props + runsXml(ps, linkFor) + `</${p.qname}>`;
  }

  const canonModel = (blocks) => blocks.map((b) => {
    const n = normalizeBlock(b);
    return { shape: n.shape, runs: canonical(n.runs) };
  });

  async function writeDocx(model, meta, options = {}) {
    if (!model || typeof model !== 'object' || model.type !== 'document' || !Array.isArray(model.blocks)) {
      refuse('invalid-model', 'model must be { type: "document", blocks: [] }');
    }
    if (!meta || !(meta.originalBytes instanceof Uint8Array)) refuse('invalid-model', 'meta.originalBytes must hold the original package');
    const original = new Uint8Array(meta.originalBytes); // the caller's bytes are never written to
    const name = meta.name || '';
    const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    const opened = await readDocx(original, name, { limits });
    const before = opened.model.blocks;
    if (model.blocks.length !== before.length) {
      refuse('unsupported-edit', `paragraph count changed from ${before.length} to ${model.blocks.length}; the patcher rewrites existing paragraphs only`);
    }
    const after = model.blocks.map(normalizeBlock);
    const old = before.map(normalizeBlock);
    const changed = [];
    for (let i = 0; i < before.length; i++) {
      if (old[i].shape !== after[i].shape) refuse('unsupported-edit', `paragraph ${i + 1} changed type, level or list`);
      if (stable(canonical(old[i].runs)) !== stable(canonical(after[i].runs))) changed.push(i);
    }
    if (changed.length === 0) return original;

    const source = await JSZip.loadAsync(original, { createFolders: false, checkCRC32: false });
    const docBytes = await source.file(DOCUMENT_PART).async('uint8array');
    const hasBom = docBytes[0] === 0xef && docBytes[1] === 0xbb && docBytes[2] === 0xbf;
    const utf16 = (docBytes[0] === 0xff && docBytes[1] === 0xfe) || (docBytes[0] === 0xfe && docBytes[1] === 0xff)
      || (docBytes[0] === 0x3c && docBytes[1] === 0) || (docBytes[0] === 0 && docBytes[1] === 0x3c);
    if (utf16) refuse('unsupported-encoding', 'document.xml is not UTF-8');

    const docXml = opened.meta.documentXml;
    if (/xmlns:nw[xr]|<nw[xr]:|\snw[xr]:/.test(docXml)) refuse('unsupported-edit', 'the document uses a prefix the patcher reserves');
    const tree = parseXml(docXml);
    const body = elements(tree).find((c) => isW(c, 'body'));
    const pNodes = elements(body).filter((c) => isW(c, 'p'));
    if (pNodes.length !== before.length) refuse('unrepresentable', 'paragraph list does not match the reader');

    const rels = relationships(opened.meta.relsXml);
    const edits = [];
    for (const i of changed) {
      const p = pNodes[i];
      const parsed = readParagraph(p, docXml);
      const sameText = before[i].runs.length === parsed.runs.length
        && before[i].runs.every((r, k) => r.text === parsed.runs[k].text);
      if (!sameText) refuse('unrepresentable', `paragraph ${i + 1} does not match the reader's runs`);
      const ps = pieces(parsed.runs, after[i].runs);
      edits.push({ p, xml: paragraphXml(p, docXml, parsed.pPr, ps, linkFor(rels), rels.uri) });
    }

    let out = '';
    let pos = 0;
    for (const { p, xml } of edits) {
      out += docXml.slice(pos, p.start) + xml;
      pos = p.end;
    }
    out += docXml.slice(pos);
    const newDoc = (hasBom ? '﻿' : '') + out;
    const newRels = relsWithAdded(rels, opened.meta.relsXml);

    const target = await JSZip.loadAsync(original, { createFolders: false, checkCRC32: false });
    const encoder = new TextEncoder();
    const replaced = [[DOCUMENT_PART, newDoc]];
    if (newRels !== null) replaced.push([RELS_PART, newRels]);
    for (const [part, text] of replaced) {
      const entry = target.files[part];
      const extra = { binary: true, createFolders: false, date: entry.date };
      if (entry.unixPermissions) extra.unixPermissions = entry.unixPermissions;
      if (entry.dosPermissions) extra.dosPermissions = entry.dosPermissions;
      target.file(part, encoder.encode(text), extra);
    }
    const outBytes = await target.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });

    // The output must read back as the edited model, and every part not
    // replaced must hold the same bytes under the same name, in the same order.
    try {
      const check = await readDocx(outBytes, name, { limits });
      if (stable(canonModel(check.model.blocks)) !== stable(canonModel(model.blocks))) {
        refuse('round-trip', 'the written package does not read back as the edited model');
      }
      if (stable(check.meta.partNames) !== stable(opened.meta.partNames)) refuse('output-invalid', 'part names or order changed');
      const reread = await JSZip.loadAsync(outBytes, { createFolders: false, checkCRC32: false });
      for (const part of opened.meta.partNames) {
        const entry = source.files[part];
        if (entry.dir || replaced.some(([p]) => p === part)) continue;
        const a = await source.file(part).async('uint8array');
        const b = await reread.file(part).async('uint8array');
        if (Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0) refuse('output-invalid', `part ${part} changed`);
      }
    } catch (error) {
      if (error instanceof DocxWriteError) throw error;
      refuse('output-invalid', error.message);
    }
    return outBytes;
  }

  // The adapter for the format contract kit (scripts/format-contract.js).
  const docxAdapter = {
    id: 'docx',
    open: (bytes, name) => readDocx(bytes, name),
    serialize: (model, meta) => writeDocx(model, meta),
    scan: async (bytes, name) => {
      const { meta } = await readDocx(bytes, name);
      return scanDocx({ documentXml: meta.documentXml, relsXml: meta.relsXml, partNames: meta.partNames });
    },
  };

  const api = { writeDocx, DocxWriteError, docxAdapter };
  if (node) module.exports = api;
  else root.NeoCraft_DocxWrite = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
