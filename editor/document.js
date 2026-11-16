'use strict';

// NEOCRAFT: Document mode's bootstrap (#36). A window loaded with
// ?mode=document (editor/mode.js) shows one file in the book editor's page,
// with the book-only parts off: no shelf, no library, no chapters (triple
// Enter is only Enter), no outline, covers or goals. The file is read and
// saved through the document session (document-session.js) and the desktop
// document bridge (window.neo.document), by ref. Nothing here creates a book
// or writes library.json: persistChapter, saveMeta and writeLibrary in app/
// hand over to persist() below, or do nothing, while documentMode() is true.
//
// The editing itself is the app's own (typing, quotes, dashes, find,
// spellcheck, selection): it runs on the page this builds, from a one-chapter
// stand-in book that lives in memory only.
(function (root) {
  const DOC_ID = 'document';
  const DOC_CHAPTER = 'ch-document';
  const TEXT_EXTS = ['md', 'markdown', 'txt'];
  const extOf = (name) => (/\.([^.\\/]+)$/.exec(name || '') || [])[1]?.toLowerCase() || '';

  // Provisional plain-text adapter until the Markdown one (#49) lands.
  const textAdapter = {
    id: 'text',
    scan: () => ({ supported: true, unsupported: [] }),
    open(bytes) {
      const bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
      const text = new TextDecoder('utf-8').decode(bom ? bytes.subarray(3) : bytes);
      return { model: { text: text.replace(/\r\n?/g, '\n') }, meta: { bom, eol: /\r\n/.test(text) ? '\r\n' : '\n', trailing: text === '' || /\n$/.test(text) } };
    },
    serialize(model, meta) {
      return new TextEncoder().encode((meta.bom ? '﻿' : '') + (meta.eol === '\r\n' ? model.text.replace(/\n/g, '\r\n') : model.text));
    }
  };

  let session = null;
  let editable = false;

  // the page's paragraphs back to text: a <br> is a line break
  function htmlToText(html, meta) {
    const box = document.createElement('div');
    box.innerHTML = html;
    const blocks = [];
    for (const node of box.children) {
      const copy = node.cloneNode(true);
      for (const br of copy.querySelectorAll('br')) br.replaceWith('\n');
      blocks.push(copy.textContent.replace(/\n+$/, ''));
    }
    while (blocks.length && blocks[blocks.length - 1] === '') blocks.pop();
    // blocksToText adds the BOM and line ends; the adapter would add them
    // again, so this is the bare text
    return root.NeoCraft_EditorText.blocksToText(blocks, { trailing: meta.trailing });
  }

  function persist(html) {
    if (!session || !editable) return Promise.resolve(false);
    const meta = session.getState().meta || {};
    session.edit({ text: htmlToText(html, meta) });
    return session.save().then(() => true, (err) => {
      toast(err && err.code === 'conflict'
        ? t('This file changed outside NEO since it was opened. Nothing was overwritten.')
        : t('This file could not be saved: {reason}', { reason: (err && err.message) || String(err) }), 9000);
      throw err;
    });
  }

  async function openDocument(opened) {
    const host = {
      read: (ref) => window.neo.document.read(ref),
      save: (ref, bytes, base) => window.neo.document.save(ref, bytes, base)
    };
    editable = TEXT_EXTS.includes(extOf(opened.name));
    session = root.NeoCraft_DocumentSession.createDocumentSession({ adapter: textAdapter, host });
    let state;
    try {
      state = await session.open(opened.ref, opened.name);
    } catch (err) {
      toast(t('This file could not be opened: {reason}', { reason: (err && err.message) || String(err) }), 9000);
      return;
    }
    if (!state) return;
    const title = opened.name.replace(/\.[^.]+$/, '');
    // the stand-in book: in memory only, never listed, never written
    book = {
      id: DOC_ID, title, subtitle: '', author: '', document: true,
      chapterOrder: [DOC_CHAPTER], chapterTitles: {}, chapterKinds: { [DOC_CHAPTER]: 'story' }
    };
    chapterHTML = { [DOC_CHAPTER]: editable ? root.NeoCraft_EditorText.textToHtml(state.model.text) : '<p><br></p>' };
    savedHTML = { ...chapterHTML };
    knownChapters = new Set(book.chapterOrder);
    savedOrder = [...book.chapterOrder];
    stickies = []; darlings = []; undoStack = []; redoStack = [];
    currentChapterId = null;
    document.title = opened.name + ' — NEO';
    $('#editor-view').hidden = false;
    $('#bookshelf-view').hidden = true;
    document.execCommand('defaultParagraphSeparator', false, 'p');
    renderChapters();
    updateCounters();
    switchTab('manuscript');
    if (!editable) {
      for (const body of $$('.chapter-body')) body.contentEditable = 'false';
      toast(t('NEO cannot edit .{ext} files yet. This file was not changed.', { ext: extOf(opened.name) }), 9000);
    } else {
      const body = $('.chapter-body');
      if (body) body.focus();
    }
  }

  // called from startup.js instead of loadLibrary() while documentMode()
  function boot() {
    // a stand-in library: every feature off, nothing read from or written to disk
    library = { features: {}, shelves: [], authors: [], penNames: [], firstRunDone: true, hintShown: true, pageTheme: 'paper' };
    applyLook();
    typewriterEnabled = false;
    $('#bookshelf-view').hidden = true;
    window.neo.document.onOpen((opened) => { openDocument(opened); });
    window.neo.document.ready();
  }

  root.NeoCraft_DocumentView = { boot, persist, textAdapter, htmlToText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
