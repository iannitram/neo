'use strict';

// NEOCRAFT: which mode this window is in. main.js loads index.html with
// ?mode=document for a window opened on one file (#36); every other window is
// the book editor, exactly as before. The app's files ask documentMode() in
// core.js; this script loads first so the answer is there before they run.
// Book-only features are listed here so Document mode switches them off in
// one place: shelves, triple-Enter chapters, covers, outline, goals.
(function (root) {
  const isDocument = !!root.location && /(?:^|[?&])mode=document(?:&|$)/.test(root.location.search || '');
  const BOOK_ONLY = ['shelves', 'chapters', 'covers', 'outline', 'goals', 'notes', 'darlings', 'snapshots'];
  root.NeoCraft_Mode = Object.freeze({
    document: isDocument,
    bookOnly: BOOK_ONLY,
    // is this book-only part available here? (always, in the book editor)
    allows: (part) => !isDocument || !BOOK_ONLY.includes(part)
  });
  if (isDocument && root.document && root.document.body) root.document.body.classList.add('document-mode');
})(typeof globalThis !== 'undefined' ? globalThis : this);
