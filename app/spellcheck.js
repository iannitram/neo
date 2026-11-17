'use strict';

// NEOCRAFT: reusable spellcheck lives in editor/spellcheck.js; book-only view tools stay here.

let typewriterEnabled = false;
let nbspMarksEnabled = false;

// ---- look up rules:
// macOS shows the system dictionary for a selected word; the menu only makes sense for one word,
// never for a phrase or a whole paragraph (#179).
const LOOK_UP_MAX_WORD = 60;
function lookUpWord(text) {
  const word = (text || '').trim();
  if (!word || word.length > LOOK_UP_MAX_WORD) return null;
  return /\s/.test(word) ? null : word;
}
// ---- end of look up rules ----

// macOS: a selected word in the manuscript or the notes gets the system "Look Up" — the panel
// Safari and Books show (#179). The listener runs in the bubble phase, after the spellcheck menu,
// and stands down when any other menu already answered the right-click.
document.addEventListener('contextmenu', (e) => {
  if (window.neo.platform !== 'darwin' || e.defaultPrevented || !featureOn('readAloud')) return;
  const editor = e.target.closest && e.target.closest('.chapter-body, #aux-editor');
  if (!editor) return;
  const sel = window.getSelection();
  const word = sel && sel.rangeCount && !sel.isCollapsed ? lookUpWord(sel.toString()) : null;
  if (!word) return;
  e.preventDefault();
  popMenu(e.clientX, e.clientY, [{ label: t('Look Up “{word}”', { word }), value: 'lookup' }]).then((choice) => {
    if (choice === 'lookup') window.neo.lookUpText();
  });
});

// The page needs empty room beneath its last line, or the caret can't be held
// at the centre once the end of the draft scrolls into view (body.typewriter
// deepens #paper's bottom margin; see styles.css). Only as much as the last
// page's own blank paper doesn't already give: a page that is mostly blank
// needs none, and a fixed 60vh left an empty scroll under it from line one.
function applyTypewriter() {
  document.body.classList.toggle('typewriter', typewriterEnabled);
  if (window.neo.typewriterState) window.neo.typewriterState(typewriterEnabled); // the Format menu's tick
  typewriterRoom();
}
function typewriterRoom() {
  const paper = $('#paper');
  const bodies = $$('#chapters .chapter-body');
  const last = bodies[bodies.length - 1];
  if (!typewriterEnabled || !last || paper.hidden) return;
  const line = parseFloat(getComputedStyle(last).lineHeight) || 30;
  // On one long sheet (not Pages, not a script) the room is paper: the last
  // sheet runs on past the bottom of the window while the line is held at
  // the writing height, so no edge of the page creeps up under the words.
  // The sheet ends where a chapter does, and nowhere else.
  if (!document.body.classList.contains('paged') && !paper.classList.contains('script')) {
    const view = $('#paper-scroll').getBoundingClientRect();
    // the line's bottom at its highest in the band (see typewriterScrollTarget),
    // and a little overhang so the edge never sits flush with the window
    const pad = view.bottom - (window.innerHeight * 0.45 - line * 0.5) + 60;
    paper.style.setProperty('--typewriter-sheet', Math.max(90, Math.ceil(pad)) + 'px');
    return;
  }
  // the last line must be able to rise to the writing height (45% of the
  // window, as in the selectionchange handler below)
  const below = paper.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
  const room = $('#paper-scroll').clientHeight - window.innerHeight * 0.45 - below + line;
  paper.style.setProperty('--typewriter-room', Math.max(120, Math.ceil(room)) + 'px');
}
new ResizeObserver(() => typewriterRoom()).observe($('#chapters'));
window.addEventListener('resize', typewriterRoom);
function applyNbspMarks() {
  if (window.neo.nbspMarksState) window.neo.nbspMarksState(nbspMarksEnabled); // the Format menu's tick
  paintNonBreakingMarks();
}
function toggleNbspMarks() {
  nbspMarksEnabled = !nbspMarksEnabled;
  library.nbspMarks = nbspMarksEnabled;
  writeLibrary(library);
  applyNbspMarks();
  toast(nbspMarksEnabled
    ? t('Non-breaking marks ON — the spaces and hyphens that hold a line together are tinted')
    : t('Non-breaking marks off'));
}
function toggleTypewriter() {
  typewriterEnabled = !typewriterEnabled;
  library.typewriter = typewriterEnabled;
  writeLibrary(library);
  applyTypewriter();
  toast(typewriterEnabled ? t('Typewriter scrolling ON — your line stays centered') : t('Typewriter scrolling off'));
}


// The page follows the caret only while the writer is typing or moving by
// keyboard: a click to think about a sentence leaves the screen exactly as
// it was. The caret has a band of a few lines to move in before the page
// glides (not snaps) to bring it back to the writing height.
let typewriterByKeyboard = false;
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target;
  if (el && el.closest && el.closest('.chapter-body')) typewriterByKeyboard = true;
}, true);
document.addEventListener('mousedown', () => { typewriterByKeyboard = false; }, true);

// ---- typewriter rules: where the page goes as the writer types ----
// The writing height is 45% of the window, with a band of about three lines
// around it. The page's new scrollTop for a caret at caretTop, or null while
// the caret is inside the band.
function typewriterScrollTarget(scrollTop, caretTop, windowHeight, lineHeight) {
  const diff = caretTop - windowHeight * 0.45;
  return Math.abs(diff) <= lineHeight * 1.5 ? null : scrollTop + diff;
}
// A letter typed, Chromium scrolls its caret into view on its own. In the
// Pages view it measures a line that a page break carried to the next page
// at the top of its paragraph, back on the page before, and scrolls up to
// that while the caret sits in plain view; the typewriter then glided the
// page back, and every letter at the top of a page bobbed it (#453). NEO
// keeps the caret in sight itself, so a scroll like that goes back. Given
// the scrollTop when the letter went in (was) and now, where the typewriter
// is gliding (glide, or null), the caret's top and bottom in the window as
// they were at `was`, and the scroller's top and bottom: the scrollTop to
// put back, or null to leave it.
function strayCaretScroll({ was, now, glide, caretTop, caretBottom, viewTop, viewBottom }) {
  if (now === was) return null;
  // the typewriter's own glide, on its way
  if (glide !== null && Math.sign(now - was) === Math.sign(glide - was) && Math.abs(now - was) <= Math.abs(glide - was) + 1) return null;
  // a caret that was out of sight, even in part, is Chromium's to bring in
  if (caretTop < viewTop || caretBottom > viewBottom) return null;
  return was;
}
// ---- end of typewriter rules ----

// where the typewriter is gliding the page, until it gets there
let typewriterGlide = null;
$('#paper-scroll').addEventListener('scrollend', () => { typewriterGlide = null; });

document.addEventListener('selectionchange', () => {
  if (!typewriterEnabled || !book || currentTab !== 'manuscript' || !typewriterByKeyboard) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest || !el.closest('.chapter-body')) return;
  requestAnimationFrame(() => {
    try {
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.top === 0 && rect.height === 0)) rect = el.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 30;
      const scroller = $('#paper-scroll');
      const top = typewriterScrollTarget(scroller.scrollTop, rect.top, window.innerHeight, lineHeight);
      if (top === null) return;
      typewriterGlide = top;
      scroller.scrollTo({ top, behavior: scrollBehavior() });
    } catch { /* selection mid-mutation; skip this frame */ }
  });
});

// Chromium's scroll comes after the input event, inside the same keystroke,
// so the page is checked in the next frame, before it is painted. (On the
// window, so NEO's own input handlers, revealCaret among them, have run.)
window.addEventListener('input', (e) => {
  if (!pagesOn() || currentTab !== 'manuscript') return;
  if (!e.target.closest || !e.target.closest('.chapter-body')) return;
  const sc = $('#paper-scroll');
  const was = sc.scrollTop;
  requestAnimationFrame(() => {
    const now = sc.scrollTop;
    if (now === was) return;
    const rect = caretRect();
    if (!rect) return;
    const box = sc.getBoundingClientRect();
    const back = strayCaretScroll({
      was, now, glide: typewriterGlide,
      caretTop: rect.top + now - was, caretBottom: rect.bottom + now - was,
      viewTop: box.top, viewBottom: box.bottom
    });
    if (back !== null) sc.scrollTop = back;
  });
});

/* ================================================================== */
/*  FOCUS MODE: dim everything but the sentence or paragraph           */
/* ================================================================== */
// Painted with the CSS Custom Highlight API (like search and spellcheck),
// so the manuscript DOM is never touched and nothing leaks into saved HTML.
// also the order ⌘⇧O steps through: off → paragraph → sentence → off
const FOCUS_LEVELS = ['off', 'paragraph', 'sentence'];
const FOCUS_LABELS = { off: tk('Focus mode off'), sentence: tk('Focus: sentence'), paragraph: tk('Focus: paragraph') };
let focusLevel = 'off';

// The paragraph alignment the Format menu should tick. `null` means no tick belongs to the caret:
// outside the manuscript, or the caret is not inside a paragraph. No alignment rule IS left.
function currentAlign() {
  if (!book || currentTab !== 'manuscript') return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let el = sel.getRangeAt(0).startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  const p = el && el.closest ? el.closest('p') : null;
  if (!body || !p || !body.contains(p)) return null;
  const value = (p.style && p.style.textAlign) || 'left';
  return ['left', 'center', 'right', 'justify'].includes(value) ? value : null;
}

// the View and Format menus' ticks (focus level, page, brighter interface, body font, drop cap,
// alignment) follow the page. Selection changes call this often, so an unchanged payload is
// not sent again.
let viewStateSent = '';

// Brighter Interface, remembered two ways: while writing (where a faint
// interface keeps out of the way) and everywhere else in a book, the
// Outline, Notes and Darlings, where the tips need reading (bright unless
// the writer turns it down). The shelf goes with writing.
const brightAside = () => !!book && !$('#editor-view').hidden && currentTab !== 'manuscript';
function brightNow() {
  if (brightAside()) return library.uiBrightAside === undefined ? true : !!library.uiBrightAside;
  return library.uiBright === undefined ? SYSTEM_CONTRAST.matches : !!library.uiBright;
}
function applyBright() {
  if (!library) return;
  document.body.classList.toggle('bright', brightNow());
  reportViewState();
}
function reportViewState() {
  if (!window.neo.viewState || !library) return;
  const payload = {
    focus: focusLevel,
    pageTheme: library.pageTheme || 'night',
    uiBright: document.body.classList.contains('bright'),
    bodyFont: (library.fonts && library.fonts.body) || '',
    dropCap: (library.fonts && library.fonts.dropcap) || 'literary',
    align: currentAlign(),
  };
  const key = JSON.stringify(payload);
  if (key === viewStateSent) return;
  viewStateSent = key;
  window.neo.viewState(payload);
}

function applyFocus() {
  reportViewState();
  document.body.classList.toggle('focus-mode', focusLevel !== 'off');
  if (focusLevel === 'off') {
    if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-focus');
  } else updateFocus();
}
function setFocus(level) {
  if (!FOCUS_LEVELS.includes(level)) return;
  focusLevel = level;
  library.focus = level;
  writeLibrary(library);
  applyFocus();
  toast(t(FOCUS_LABELS[level] || ''));
}
function cycleFocus() { setFocus(FOCUS_LEVELS[(FOCUS_LEVELS.indexOf(focusLevel) + 1) % FOCUS_LEVELS.length]); }

// the paragraph (direct <p> child of a chapter body) holding the caret
function focusParagraph() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let el = sel.focusNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest) return null;
  const body = el.closest('.chapter-body');
  if (!body) return null;
  let p = el;
  while (p && p.parentElement !== body) p = p.parentElement;
  return p && p.tagName === 'P' ? p : null;
}

// caret position as a character offset into p.textContent
function caretOffsetIn(p) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(p);
  try { r.setEnd(sel.focusNode, sel.focusOffset); } catch { return 0; }
  return r.toString().length;
}

// character offsets within p → a DOM Range over its text nodes
function rangeFromOffsets(p, start, end) {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0, n, startSet = false;
  while ((n = walker.nextNode())) {
    const len = n.textContent.length;
    if (!startSet && start <= pos + len) { r.setStart(n, start - pos); startSet = true; }
    if (startSet && end <= pos + len) { r.setEnd(n, end - pos); return r; }
    pos += len;
  }
  if (!startSet) return null;
  r.setEndAfter(p.lastChild || p);
  return r;
}

let focusSegmenter = null;
function sentenceRange(p) {
  const text = p.textContent;
  if (!text.trim()) return null;
  const at = caretOffsetIn(p);
  if (!focusSegmenter && window.Intl && Intl.Segmenter) {
    focusSegmenter = new Intl.Segmenter((library.spellLanguage || 'en').split('-')[0], { granularity: 'sentence' });
  }
  if (!focusSegmenter) return null;
  let hit = null, last = null;
  for (const seg of focusSegmenter.segment(text)) {
    last = seg;
    // caret at the very end of a sentence still belongs to it
    if (at >= seg.index && at <= seg.index + seg.segment.length) { hit = seg; if (at < seg.index + seg.segment.length) break; }
  }
  hit = hit || last;
  // trim trailing whitespace so the highlight hugs the words
  const start = hit.index;
  const end = hit.index + hit.segment.replace(/\s+$/, '').length;
  return rangeFromOffsets(p, start, Math.max(end, start));
}

function updateFocus() {
  if (focusLevel === 'off' || !book || currentTab !== 'manuscript') return;
  if (!window.Highlight || !window.CSS || !CSS.highlights) return;
  const p = focusParagraph();
  if (!p) return;   // caret elsewhere (title, panels): keep the last focus
  let r = null;
  if (isBreakPara(p)) r = null;
  else if (focusLevel === 'sentence') r = sentenceRange(p);
  else if (focusLevel === 'paragraph') { r = document.createRange(); r.selectNodeContents(p); }
  if (r) CSS.highlights.set('neo-focus', new Highlight(r));
  else CSS.highlights.delete('neo-focus');
  // highlights can't reach the drop cap (it isn't text), so it gets a class
  // on its chapter body (a class on the body itself is never saved)
  document.querySelectorAll('.chapter-body.focus-cap').forEach((b) => b.classList.remove('focus-cap'));
  const body = p.parentElement;
  const first = body.querySelector('p[data-first]'); // the paragraph with the drop cap (openingPara)
  const firstText = first && document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode();
  if (r && firstText && r.comparePoint(firstText, 0) === 0) body.classList.add('focus-cap');
}
function isBreakPara(p) { return p.classList.contains('scene-break'); }

document.addEventListener('selectionchange', () => {
  if (focusLevel === 'off') return;
  requestAnimationFrame(() => { try { updateFocus(); } catch { /* mid-mutation */ } });
});
// the Format menu's alignment tick follows the caret
document.addEventListener('selectionchange', () => {
  requestAnimationFrame(() => { try { reportViewState(); } catch { /* mid-mutation */ } });
});
document.addEventListener('input', () => {
  if (focusLevel === 'off') return;
  requestAnimationFrame(() => { try { updateFocus(); } catch { /* mid-mutation */ } });
});

/* ================================================================== */
/*  GOALS, SPRINTS, AND THE CHART                                      */
/* ================================================================== */

let sprint = null;

function statsChartSvg() {
  const W = 520, H = 200, PAD = 6;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(writingDay(d));
  }
  const counts = book.dailyCounts || {};
  const daily = days.map((d) => counts[d] ? Math.max(0, counts[d].end - counts[d].start) : 0);
  // cumulative: carry the last known total forward
  let last = 0;
  const firstKnown = days.find((d) => counts[d]);
  if (firstKnown) last = counts[firstKnown].start;
  const cumulative = days.map((d) => {
    if (counts[d]) last = counts[d].end;
    return last;
  });
  const goal = book.wordGoal || 0;
  const maxC = Math.max(...cumulative, goal, 1);
  const maxD = Math.max(...daily, library.dailyGoal || 0, 1);
  const bw = (W - PAD * 2) / 30;

  const bars = daily.map((v, i) => {
    const h = Math.round((v / maxD) * (H * 0.45));
    return `<rect x="${(PAD + i * bw).toFixed(1)}" y="${H - PAD - h}" width="${(bw - 2).toFixed(1)}" height="${h}" rx="1.5" fill="#3d5a4f"/>`;
  }).join('');
  const line = cumulative.map((v, i) => {
    const x = (PAD + i * bw + bw / 2).toFixed(1);
    const y = (H - PAD - (v / maxC) * (H - PAD * 2 - 20)).toFixed(1);
    return (i === 0 ? 'M' : 'L') + x + ',' + y;
  }).join(' ');
  const goalLine = goal
    ? `<line x1="${PAD}" x2="${W - PAD}" y1="${(H - PAD - (goal / maxC) * (H - PAD * 2 - 20)).toFixed(1)}" y2="${(H - PAD - (goal / maxC) * (H - PAD * 2 - 20)).toFixed(1)}" stroke="#c9a86a" stroke-dasharray="5,4" stroke-width="1" opacity="0.7"/>`
    : '';
  return `<svg id="stats-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escHtml(t('Words written over the last 30 days')).replace(/"/g, '&quot;')}">
    ${bars}
    <path d="${line}" fill="none" stroke="#c9a86a" stroke-width="2"/>
    ${goalLine}
  </svg>
  <div class="stats-legend">
    <span>${t('30 days ago')}</span>
    <span class="sl-daily">▮ ${t('daily words')}</span>
    <span style="color:var(--accent)">— ${t('total')}${goal ? ' · - - ' + t('goal') : ''}</span>
    <span>${t('today')}</span>
  </div>`;
}

/* ================================================================== */
/*  COVER ART SETTINGS (File → Cover Art…)                             */
/* ================================================================== */

// One key per provider. The brief and the painting always come from the
// same provider, so a writer only ever needs one account.
const COVER_PROVIDERS = {
  openai: { name: 'OpenAI', keyHint: 'sk-…', where: tk('platform.openai.com → API keys'), text: 'gpt-5-mini', image: 'gpt-image-1-mini', quality: true, cost: tk('a few cents a picture') }
};
// shown in the window, so translated when read
const providerWhere = (p) => t(p.where);
const providerCost = (p) => t(p.cost);
// Key formats change under us, so the only test is "one token, long enough" —
// the provider does the rest.
const looksLikeKey = (k) => /^\S{20,}$/.test(k);
const coverSettings = () => library.coverArt || {};
const coverProvider = () => (COVER_PROVIDERS[coverSettings().provider] ? coverSettings().provider : 'openai');

function openCoverArt() {
  const cs = coverSettings();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  const provOptions = Object.entries(COVER_PROVIDERS).map(([id, p]) =>
    `<option value="${id}"${coverProvider() === id ? ' selected' : ''}>${p.name}</option>`).join('');
  bd.innerHTML = `
    <div class="modal" style="width:540px">
      <h2 style="font-size:17px">${t('Cover art')}</h2>
      <p>${t('Every book gets a cover on the shelf: an abstract with the title set in type. With an OpenAI key, NEO can also read a story once it passes {n} words and paint a cover from the text. Paintings stay on your shelf — exports never include them.', { n: PAINT_AT })}</p>
      <div class="stats-row">
        <select id="ca-provider" hidden>${provOptions}</select>
        <label class="st-check"><input id="ca-auto" type="checkbox"${cs.auto === false ? '' : ' checked'}/> ${t('paint at {n} words', { n: PAINT_AT })}</label>
      </div>
      <div class="stats-row st-covers">
        <label>${t('API key')} <input id="ca-key" type="password" autocomplete="off" spellcheck="false" style="width:300px"/></label>
      </div>
      <p class="soft" id="ca-note" style="margin:-6px 0 12px;font-size:12px"></p>
      <details class="st-advanced">
        <summary class="soft">${t('Models')}</summary>
        <div class="stats-row">
          <label>${t('Brief')} <input id="ca-tmodel" type="text" spellcheck="false"/></label>
          <label>${t('Paint')} <input id="ca-imodel" type="text" spellcheck="false"/></label>
          <label id="ca-quality-wrap">${t('Quality')}
            <select id="ca-quality">
              ${['low', 'medium', 'high'].map((q) => `<option value="${q}"${(cs.quality || 'medium') === q ? ' selected' : ''}>${({ low: t('low'), medium: t('medium'), high: t('high') })[q]}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="soft" style="font-size:12px;margin:0 0 6px">${t('Leave blank for NEO’s defaults. Names drift; if a provider retires one, NEO tries its own list before giving up.')}</p>
      </details>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
        <button class="m-ok btn-gold">${t('Save')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const sel = bd.querySelector('#ca-provider');
  const key = bd.querySelector('#ca-key');
  const note = bd.querySelector('#ca-note');
  const models = (cs.models || {});
  // per-provider fields: key placeholder, stored model overrides, quality
  const showProvider = async () => {
    const id = sel.value, p = COVER_PROVIDERS[id];
    key.value = '';
    key.placeholder = t('{name} key ({hint})', { name: p.name, hint: p.keyHint });
    bd.querySelector('#ca-tmodel').value = (models[id] && models[id].text) || '';
    bd.querySelector('#ca-tmodel').placeholder = p.text;
    bd.querySelector('#ca-imodel').value = (models[id] && models[id].image) || '';
    bd.querySelector('#ca-imodel').placeholder = p.image;
    bd.querySelector('#ca-quality-wrap').style.display = p.quality ? '' : 'none';
    const has = await window.neo.hasSecret(id);
    if (sel.value !== id) return;
    note.textContent = has
      ? t('A {name} key is saved, encrypted, outside your library folder. Paste a new one to replace it, or type “{remove}” to forget it.', { name: p.name, remove: t('remove') })
      : t('Get a key at {where} ({cost}). It’s stored encrypted on this computer and only ever sent to {name}.', { where: providerWhere(p), cost: providerCost(p), name: p.name });
  };
  sel.onchange = showProvider;
  showProvider();
  const done = () => bd.remove();
  bd.querySelector('.m-cancel').onclick = done;
  bd.querySelector('.m-ok').onclick = async () => {
    const id = sel.value, p = COVER_PROVIDERS[id];
    const k = key.value.trim();
    if (k === 'remove' || k === t('remove')) await window.neo.setSecret(id, '');
    else if (k && !looksLikeKey(k)) { toast(t('That doesn’t look like an API key ({name} keys look like {hint}) — not saved', { name: p.name, hint: p.keyHint }), 6000); return; }
    else if (k) await window.neo.setSecret(id, k);
    models[id] = {
      text: bd.querySelector('#ca-tmodel').value.trim() || undefined,
      image: bd.querySelector('#ca-imodel').value.trim() || undefined
    };
    library.coverArt = {
      provider: id,
      auto: bd.querySelector('#ca-auto').checked,
      quality: bd.querySelector('#ca-quality').value,
      models
    };
    await writeLibrary(library);
    done();
    if (!(await window.neo.hasSecret(id))) toast(t('Saved. Add a {name} key to start painting.', { name: p.name }), 5000);
  };
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } });
  key.focus();
}

// An hour of the day as the writer's language says it: 1 am / 13 h / 13 Uhr,
// or 13:00 where the language's hour is a bare number
function hourLabel(h) {
  if (h === 0) return t('midnight');
  const loc = NeoI18n.getLocale();
  if (loc.startsWith('en')) {
    if (h === 12) return t('noon');
    return h < 12 ? t('{h} am', { h: String(h) }) : t('{h} pm', { h: String(h - 12) });
  }
  const at = new Date(2000, 0, 1, h);
  const hour = new Intl.DateTimeFormat(loc, { hour: 'numeric' }).format(at);
  return /^\d+$/.test(hour) ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(at) : hour;
}

function openStats() {
  const hasBook = !!book;
  const today = hasBook ? (book.dailyCounts || {})[todayStr()] : null;
  const wordsToday = today ? Math.max(0, today.end - today.start) : 0;
  const total = hasBook ? bookWordCount() : 0;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:${hasBook ? 580 : 380}px">
      <h2 style="font-size:17px">${hasBook ? t('{title} — progress', { title: escHtml(shownTitle(book.title)) }) : t('Goals')}</h2>
      ${hasBook ? `
      <div class="stats-nums">
        <div><div class="big">${fmtNum(total)}</div><div class="lbl">${t('total words')}</div></div>
        <div><div class="big">${fmtNum(wordsToday)}</div><div class="lbl">${t('today')}</div></div>
        <div><div class="big">${book.wordGoal ? Math.min(100, Math.round(total / book.wordGoal * 100)) + '%' : '—'}</div><div class="lbl">${t('of book goal')}</div></div>
      </div>
      ${statsChartSvg()}` : ''}
      <div class="stats-row stats-goals" style="margin-top:${hasBook ? 18 : 6}px">
        <label>${t('Daily goal')} <input id="st-daily" type="number" min="0" value="${library.dailyGoal || ''}" placeholder="500"/></label>
        ${hasBook ? `<label>${t('Book goal')} <input id="st-book" type="number" min="0" value="${book.wordGoal || ''}" placeholder="80000"/></label>` : ''}
      </div>
      <div class="stats-row stats-goals">
        <label>${t('Day ends at')}
          <select id="st-dayends">
            ${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${(library.dayEndsAt || 0) === h ? ' selected' : ''}>${hourLabel(h)}</option>`).join('')}
          </select>
        </label>
      </div>
      ${hasBook ? `
      <div class="stats-row stats-goals">
        <label>${t('Sprint')} <input id="st-sprint" type="number" min="50" value="${sprint ? sprint.target : 500}"/> ${t('words')}</label>
        <button id="st-sprint-btn" class="btn-gold" style="align-self: center;">${sprint && !sprint.done ? t('End sprint') : t('Start sprint')}</button>
      </div>` : ''}
      <div style="text-align:right;margin-top:14px">
        <button class="m-ok btn-gold">${t('Done')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = async () => {
    library.dailyGoal = parseInt(bd.querySelector('#st-daily').value, 10) || 0;
    library.dayEndsAt = parseInt(bd.querySelector('#st-dayends').value, 10) || 0;
    if (hasBook) {
      book.wordGoal = parseInt(bd.querySelector('#st-book').value, 10) || 0;
      scheduleMetaSave();
    }
    await writeLibrary(library);
    bd.remove();
    if (hasBook) updateCounters();
  };
  bd.querySelector('.m-ok').onclick = close;
  // Esc closes from anywhere in the dialog (it takes focus on opening, so
  // the key reaches it even before a field is clicked); so does a click on
  // the dim page around it. Both keep the edits, like Done.
  bd.tabIndex = -1;
  bd.focus();
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  if (hasBook) {
    bd.querySelector('#st-sprint-btn').onclick = () => {
      if (sprint && !sprint.done) {
        const got = bookWordCount() - sprint.startCount;
        toast(t('Sprint ended — {n} words in {min} min', { n: got, min: Math.round((Date.now() - sprint.startTime) / 60000) }));
        sprint = null;
      } else {
        const target = parseInt(bd.querySelector('#st-sprint').value, 10) || 500;
        sprint = { target, startCount: bookWordCount(), startTime: Date.now(), done: false, bookId: book.id };
        toast(t('Sprint started — {n} words. Go.', { n: target }));
      }
      close();
    };
  }
}

$('#goal-counter').onclick = openStats;
