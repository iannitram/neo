'use strict';

// NEO's window code, the app/ and editor/ files in the order they load. index.html
// and Pocket's page list them in this order (scripts/app-files.test.js
// checks); they share one global scope, as one file did, and each starts
// 'use strict'. A file's code that runs while it loads may only call what
// is already loaded; everything else waits for the writer.
const fs = require('fs');
const path = require('path');

const APP_FILES = [
  'app/core.js', 'app/shelf.js', 'app/editor.js', 'editor/typing.js', 'app/paragraphs.js',
  'app/litrpg.js', 'editor/typing-rules.js', 'app/vim.js', 'app/screenplay.js',
  'app/footnotes.js', 'app/nav.js', 'app/tabs.js', 'app/cards.js', 'app/saving.js',
  'app/undo.js', 'editor/find.js', 'editor/spellcheck.js', 'app/spellcheck.js',
  'app/menu.js', 'app/options.js', 'app/export.js', 'app/print.js', 'app/startup.js'
];

// the whole window's source in one string, for tests that pick functions out,
// with \n line ends (a Windows checkout's \r\n would hide them from the tests)
function appSource() {
  const root = path.join(__dirname, '..');
  return APP_FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n')).join('\n');
}

module.exports = { APP_FILES, appSource };
