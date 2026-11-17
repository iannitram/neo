'use strict';

// NEOCRAFT: extracted from the upstream window editor; keep its load position.


/* ================================================================== */
/*  SPELLCHECK PASS + TYPEWRITER SCROLLING                             */
/* ================================================================== */

/* NEO's own spellcheck pass: a bundled dictionary (via the main process),
   squiggles painted with the CSS Highlight API — the same machinery as
   search — and a right-click menu for suggestions. Chapters scan lazily
   as the caret reaches them. */
let spellOn = false;
let spellScanned = new Set();
let spellRanges = new Map();     // key → [Range]
const spellCache = new Map();    // word → correct?

const spellNorm = (w) => w.replace(/’/g, "'").replace(/^'+|'+$/g, '');

function spellElFor(key) {
  return key.startsWith('aux-')
    ? $('#aux-editor')
    : document.querySelector(`.chapter[data-id="${key}"] .chapter-body`);
}

async function spellScanEl(el, key) {
  if (!el || !spellOn) return;
  spellScanned.add(key);
  const occurrences = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  // letters of any alphabet, with their accents, so French and German
  // words reach the dictionary whole — hyphenated ones too (e-mail,
  // well-known, fazê-lo, dir-se-ia): the dictionary judges the whole word,
  // and only when it says no are the pieces underlined one by one
  const re = /[\p{L}\p{M}'’]+(?:-[\p{L}\p{M}'’]+)*/gu;
  const piece = /[\p{L}\p{M}'’]+/gu;
  const legal = (raw) => /^[\p{Lu}'’]+$/u.test(raw); // acronyms and shouting are legal
  // a stammer (E-eu, N-não, Wh-what): each short piece starts the next, and
  // only the word it lands on is judged
  const bare = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const stammers = (bits) => bits.length > 1 && bits.slice(0, -1).every((s, i) => s.length <= 3 && bare(bits[i + 1]).startsWith(bare(s)));
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;
    if (p && p.closest('.scene-break, .ghost, .ph-mark')) continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(n.data))) {
      const stammer = stammers(m[0].split('-'));
      const parts = [];
      piece.lastIndex = 0;
      let q;
      while ((q = piece.exec(m[0]))) {
        const word = spellNorm(q[0]);
        if (word.length < 2 || legal(q[0])) continue;
        if (stammer && q.index + q[0].length < m[0].length) continue;
        parts.push({ start: m.index + q.index, end: m.index + q.index + q[0].length, word });
      }
      if (!parts.length) continue;
      const whole = m[0].includes('-') && !stammer && !legal(m[0].replace(/-/g, '')) ? spellNorm(m[0]) : null;
      occurrences.push({ node: n, start: m.index, end: m.index + m[0].length, whole, parts });
    }
  }
  const words = new Set();
  for (const o of occurrences) {
    if (o.whole) words.add(o.whole);
    for (const pt of o.parts) words.add(pt.word);
  }
  const unknown = [...words].filter((w) => !spellCache.has(w));
  if (unknown.length) {
    const res = await window.neo.spellCheckWords(unknown);
    for (const w of unknown) spellCache.set(w, res[w] !== false);
  }
  if (!spellOn) return; // toggled off while we were checking
  const ranges = [];
  const mark = (node, start, end) => {
    try {
      const r = new Range();
      r.setStart(node, start);
      r.setEnd(node, end);
      ranges.push(r);
    } catch { /* node changed underneath us */ }
  };
  for (const o of occurrences) {
    if (!o.node.isConnected) continue;
    if (o.whole && spellCache.get(o.whole)) continue;
    const wrong = o.parts.filter((pt) => !spellCache.get(pt.word));
    if (wrong.length) for (const pt of wrong) mark(o.node, pt.start, pt.end);
    else if (o.whole) mark(o.node, o.start, o.end); // every piece fine, the whole not
  }
  const caps = capitalSlips(el);
  for (const r of caps) ranges.push(r);
  capsRanges.set(key, caps);
  spellRanges.set(key, ranges);
  rebuildSpellHighlight();
}

// Capitals the dictionary can't see, since it takes any word in lowercase:
// a sentence that starts small, and, in English, "i" for "I". Underlined
// like a misspelling; right-click offers the capital. Manuscript prose only
// (notes are the writer's scratch paper, and poetry sets its own case).
// Mid-paragraph, only a full stop ends a sentence: "Oh! how lovely",
// "— Quanto falta? — perguntou ele" and "…and then" are the writer's.
const capsRanges = new Map(); // key → [Range]
const CAPS_ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'cf', 'approx', 'no', 'vol', 'pp', 'p', 'fig', 'ca', 'mt', 'ft', 'lt', 'sgt', 'capt', 'col', 'gen', 'prof', 'rev', 'hon', 'inc', 'ltd', 'co', 'ave', 'a.m', 'p.m', 'sra', 'sr', 'srta', 'dra', 'av', 'ex', 'z.b', 'bzw', 'ggf', 'usw', 'm', 'mme', 'mlle',
  // Danish: "vi købte f.eks. æbler" goes on in lowercase
  'f.eks', 'bl.a', 'dvs', 'osv', 'mv', 'evt', 'jf', 'kl', 'nr', 'pga', 'mht', 'inkl']);
function capitalSlips(el) {
  const out = [];
  if (typeof el.matches !== 'function' || !el.matches('.chapter-body')) return out;
  const english = /^en\b/.test(writingLanguage());
  for (const p of el.querySelectorAll('p:not(.poetry):not(.litrpg):not(.scene-break)')) {
    // the paragraph's text, and which node holds each stretch of it
    const segs = [];
    let text = '';
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.parentElement && n.parentElement.closest('.ghost, .ph-mark, .fn')) continue;
      segs.push({ node: n, at: text.length });
      text += n.data;
    }
    if (!text.trim()) continue;
    const seen = new Set();
    const mark = (i) => {
      if (seen.has(i)) return;
      seen.add(i);
      let s = segs[0];
      for (const g of segs) if (g.at <= i) s = g; else break;
      try {
        const r = new Range();
        r.setStart(s.node, i - s.at);
        r.setEnd(s.node, i - s.at + 1);
        out.push(r);
      } catch { /* changed underneath us */ }
    };
    // the paragraph's first letter, past opening quotes, brackets and dashes
    const lead = text.match(/^[\s"'“‘„«»(\[¿¡—–-]*/)[0].length;
    if (/\p{Ll}/u.test(text[lead] || '') && !/^\p{Ll}\./u.test(text.slice(lead, lead + 2))) mark(lead);
    // a letter after a full stop (not an ellipsis or an abbreviation)
    const stop = /(?<!\.)\.\s+["'“‘„«(\[]?(\p{Ll})/gu;
    let m;
    while ((m = stop.exec(text))) {
      const before = text.slice(0, m.index).match(/([\p{L}.]+)$/u);
      const word = before ? before[1].toLowerCase() : '';
      if (CAPS_ABBREV.has(word) || /^\p{L}$/u.test(word)) continue; // Mr. smith, J. r. r.
      mark(m.index + m[0].length - 1);
    }
    // English "i", "i'm", "i'd" … standing alone (not "i.e." or "(i)")
    if (english) {
      const eye = /(?<![\p{L}\p{M}\d'’.(-])i(?![\p{L}\p{M}\d.)-])(?!['’](?![mdv]|ll|re))/gu;
      while ((m = eye.exec(text))) mark(m.index);
    }
  }
  return out;
}

function rebuildSpellHighlight() {
  if (!spellOn) return;
  const hl = new Highlight();
  for (const list of spellRanges.values()) for (const r of list) hl.add(r);
  CSS.highlights.set('neo-spell', hl);
}

function scanSpellingIn(el, key) {
  if (!el || spellScanned.has(key)) return;
  spellScanEl(el, key);
}

// scan wherever the writer currently is
function scanSpellingHere() {
  if (currentTab === 'manuscript') {
    const body = currentChapterId && spellElFor(currentChapterId);
    if (body) scanSpellingIn(body, currentChapterId);
  } else {
    scanSpellingIn($('#aux-editor'), 'aux-' + ($('#aux-editor').dataset.kind || 'notes'));
  }
}

function scheduleSpellRescan(key, el) {
  clearTimeout(saveTimers['sp-' + key]);
  saveTimers['sp-' + key] = setTimeout(() => { if (spellOn) spellScanEl(el, key); }, 600);
}

// A book opened again has new pages under the same chapter ids: they're
// checked anew, not counted as checked with underlines on the old pages
function forgetSpelling() {
  spellScanned = new Set();
  spellRanges = new Map();
  capsRanges.clear();
}

function toggleSpellcheck() {
  spellOn = !spellOn;
  if (spellOn) {
    spellScanned = new Set();
    spellRanges = new Map();
    capsRanges.clear();
    scanSpellingHere();
  } else {
    CSS.highlights.delete('neo-spell');
    spellRanges = new Map();
    capsRanges.clear();
    document.querySelector('.spell-menu')?.remove();
  }
  toast(spellOn ? t('Spellcheck on') : t('Spellcheck off'));
}

// Edit → Spellcheck Language: swap the dictionary, remember the choice with
// the library, and re-check whatever is on screen
const SPELL_LANGUAGE_NAMES = {
  'en-US': t('US English'), 'en-GB': t('UK English'), 'en-CA': t('Canadian English'),
  'en-AU': t('Australian English'), fr: t('French'), es: t('Spanish'), de: t('German'),
  nl: t('Dutch'), pl: t('Polish'), 'pt-BR': t('Brazilian Portuguese'), ro: t('Romanian'), ru: t('Russian'), uk: t('Ukrainian'), hu: t('Hungarian'), sv: t('Swedish'), da: t('Danish')
};
async function changeSpellLanguage(code) {
  const ok = await window.neo.setSpellLanguage(code);
  if (!ok) { toast(t('That dictionary would not load')); return; }
  library.spellLanguage = code;
  await writeLibrary(library);
  spellCache.clear();
  if (spellOn) {
    spellScanned = new Set();
    spellRanges = new Map();
    capsRanges.clear();
    CSS.highlights.delete('neo-spell');
    scanSpellingHere();
  }
  toast(t('Spellcheck: {lang}', { lang: SPELL_LANGUAGE_NAMES[code] || code }));
}

// right-click a flagged word for suggestions
document.addEventListener('contextmenu', async (e) => {
  if (!spellOn) return;
  const editor = e.target.closest && e.target.closest('.chapter-body, #aux-editor');
  if (!editor) return;
  const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!pos || pos.startContainer.nodeType !== Node.TEXT_NODE) return;
  const node = pos.startContainer;
  const text = node.data;
  // a capital slip (see capitalSlips): the letter's capital, and nothing to learn
  let ws = pos.startOffset;
  while (ws > 0 && /[\p{L}\p{M}]/u.test(text[ws - 1])) ws--;
  for (const list of capsRanges.values()) {
    const hit = list.find((r) => r.startContainer === node && r.startOffset === ws);
    if (!hit) continue;
    e.preventDefault();
    const at = hit.startOffset;
    const upper = text[at].toLocaleUpperCase(writingLanguage());
    const chEl = editor.closest('.chapter');
    showSpellMenu(e.clientX, e.clientY, text[at], [upper], {
      replace: (s) => {
        const sel = window.getSelection();
        const r = document.createRange();
        r.setStart(node, at); r.setEnd(node, at + 1);
        sel.removeAllRanges(); sel.addRange(r);
        document.execCommand('insertText', false, s);
        if (chEl) spellScanEl(spellElFor(chEl.dataset.id), chEl.dataset.id);
      }
    });
    return;
  }
  const isW = (c) => /[\p{L}\p{M}'’]/u.test(c);
  let a = pos.startOffset, b = pos.startOffset;
  while (a > 0 && isW(text[a - 1])) a--;
  while (b < text.length && isW(text[b])) b++;
  if (a === b) return;
  let word = spellNorm(text.slice(a, b));
  if (spellCache.get(word) !== false) {
    // …or a hyphenated word underlined whole: every piece is a word, the
    // whole isn't (see spellScanEl)
    let wa = a, wb = b;
    while (text[wa - 1] === '-' && isW(text[wa - 2] || '')) { wa--; while (wa > 0 && isW(text[wa - 1])) wa--; }
    while (text[wb] === '-' && isW(text[wb + 1] || '')) { wb++; while (wb < text.length && isW(text[wb])) wb++; }
    const whole = spellNorm(text.slice(wa, wb));
    if (whole === word || spellCache.get(whole) !== false) return; // only flagged words get our menu
    if (text.slice(wa, wb).split('-').some((w) => spellCache.get(spellNorm(w)) === false)) return;
    a = wa; b = wb; word = whole;
  }
  e.preventDefault();
  const chEl = editor.closest ? editor.closest('.chapter') : null;
  const key = editor.id === 'aux-editor'
    ? 'aux-' + (editor.dataset.kind || 'notes')
    : (chEl ? chEl.dataset.id : null);
  const sugg = await window.neo.spellSuggest(word);
  showSpellMenu(e.clientX, e.clientY, word, sugg, {
    replace: (s) => {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, a); r.setEnd(node, b);
      sel.removeAllRanges(); sel.addRange(r);
      // a dictionary suggests its apostrophe straight (м'ясо); on the page
      // it's ’, as NEO types it
      document.execCommand('insertText', false, s.replace(/(?<=[\p{L}\p{M}])'(?=[\p{L}\p{M}])/gu, '’'));
      if (key) spellScanEl(spellElFor(key), key);
    },
    learn: async () => {
      library.customWords = library.customWords || [];
      if (!library.customWords.includes(word)) library.customWords.push(word);
      await writeLibrary(library);
      await window.neo.spellLearn(word);
      // Learning also accepts equivalent Unicode spellings. Recheck cached
      // failures so those variants lose their underlines in every editor.
      spellCache.clear();
      spellCache.set(word, true);
      for (const k of [...spellScanned]) spellScanEl(spellElFor(k), k);
    }
  });
});

function showSpellMenu(x, y, word, suggestions, actions) {
  document.querySelector('.spell-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'spell-menu';
  if (suggestions.length) {
    for (const s of suggestions) {
      const btn = document.createElement('button');
      btn.textContent = s;
      btn.onclick = () => { menu.remove(); actions.replace(s); };
      menu.appendChild(btn);
    }
  } else {
    const none = document.createElement('button');
    none.textContent = t('No suggestions');
    none.disabled = true;
    menu.appendChild(none);
  }
  if (actions.learn) {
    const sep = document.createElement('div');
    sep.className = 'sm-sep';
    menu.appendChild(sep);
    const learn = document.createElement('button');
    learn.textContent = t('Add “{word}” to dictionary', { word });
    learn.onclick = () => { menu.remove(); actions.learn(); };
    menu.appendChild(learn);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 10) + 'px';
  menu.style.top = Math.min(y + 4, window.innerHeight - r.height - 10) + 'px';
  const back = document.activeElement; // where the writer was, to go back to
  const close = (ev) => {
    if (menu.contains(ev.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close, true);
    document.removeEventListener('keydown', arrows, true);
  };
  // the keys do it too, so no hand leaves the keyboard: ↓ and ↑ walk the
  // choices, Enter takes the one on, Esc closes the menu and goes back to the text
  let on = -1;
  const arrows = (ev) => {
    if (!menu.isConnected) { document.removeEventListener('keydown', arrows, true); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const choices = [...menu.querySelectorAll('button:not(:disabled)')];
      if (!choices.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      on = ev.key === 'ArrowDown' ? (on + 1) % choices.length : (on <= 0 ? choices.length : on) - 1;
      choices[on].focus();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      menu.remove();
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', arrows, true);
      if (back && back.focus) back.focus({ preventScroll: true });
    }
  };
  document.addEventListener('mousedown', close, true);
  document.addEventListener('keydown', arrows, true);
}
