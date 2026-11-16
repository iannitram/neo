'use strict';

// NEOCRAFT: the plain-text half of Document mode's page model (provisional
// until the Markdown adapter, #49, lands). Paragraphs are blocks separated by
// a blank line; a single line break inside one stays a line break.
// textToHtml(text) -> chapter HTML for the editor; htmlToText(html, meta) ->
// text. Also runs in Node (the document page's adapter and its tests).
(function (root) {
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function textToHtml(text) {
    const blocks = String(text).replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).map((b) => b.replace(/^\n+|\n+$/g, ''));
    const kept = blocks.filter((b) => b !== '');
    if (!kept.length) return '<p><br></p>';
    return kept.map((b) => '<p>' + b.split('\n').map(escapeHtml).join('<br>') + '</p>').join('');
  }

  // blocks: the paragraphs' text in order, each with "\n" for a <br>
  function blocksToText(blocks, meta = {}) {
    const eol = meta.eol || '\n';
    const body = blocks.join('\n\n');
    const text = body === '' ? '' : body + (meta.trailing === false ? '' : '\n');
    return (meta.bom ? '﻿' : '') + text.replace(/\n/g, eol);
  }

  const api = { textToHtml, blocksToText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_EditorText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
