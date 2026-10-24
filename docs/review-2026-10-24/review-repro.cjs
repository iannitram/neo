'use strict';

// Loads main.js the way scripts/spellcheck.test.js does: Electron is replaced,
// the real disk functions run, and LIBRARY_DIR points at a temporary folder.
// main.js itself is not edited for these tests.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..', '..');
const localRequire = createRequire(path.join(root, 'main.js'));
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function loadMain() {
  const handlers = new Map();
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      getPath: () => os.tmpdir(),
      getLocale: () => 'en',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      on() {}
    },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    utilityProcess: { fork: () => ({ on() {}, postMessage() {} }) },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    libraryRoot: os.tmpdir()
  });
  // The string is the file on disk. filename is how Node attributes coverage to it.
  vm.runInContext(source, context, { filename: path.join(root, 'main.js') });
  return {
    context,
    call: (name, ...args) => handlers.get(name)(null, ...args),
    pointAt(dir) {
      context.libraryRoot = dir;
      vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', context);
    }
  };
}

const main = loadMain();

function tempLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-library-fs-'));
  main.pointAt(dir);
  return dir;
}


const dir = tempLibrary();
try {
 const b=main.call('book:create',{title:'Review'});
 const original='<p>red blue</p>', remote='<p><b>blue</b> red</p>', local='<p>red blue green</p>';
 main.call('chapter:write',b.id,'c1',original);
 main.call('chapter:write',b.id,'c1',remote);
 const result=main.call('chapter:write',b.id,'c1',local,original);
 assert.equal(result,true);
 assert.equal(main.call('chapter:read',b.id,'c1'),local);
 console.log('B02 reproduced: remote reordering and bold overwritten without conflict');
 b.chapterOrder=['c1']; main.call('book:writeMeta',b.id,b);
 const stale=JSON.parse(JSON.stringify(b));
 main.call('chapter:write',b.id,'c2','<p>New remote chapter</p>');
 main.call('book:writeMeta',b.id,{...b,chapterOrder:['c1','c2']});
 main.call('book:writeMeta',b.id,{...stale,title:'Local rename'});
 assert.equal(JSON.stringify(main.call('book:readMeta',b.id).chapterOrder),'["c1"]');
 assert.equal(main.call('chapter:read',b.id,'c2'),'<p>New remote chapter</p>');
 console.log('B03 reproduced: stale metadata hides remote chapter; file remains recoverable');
 main.call('aux:write',b.id,'notes','<p>Remote notes</p>');
 main.call('aux:write',b.id,'notes','<p>Stale local notes</p>');
 assert.equal(main.call('aux:read',b.id,'notes'),'<p>Stale local notes</p>');
 assert.equal(fs.existsSync(path.join(dir,b.id,'notes.html.bak')),false);
 console.log('B04 reproduced: stale notes replace remote notes, no backup');
 const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
 const saveBody=source.slice(source.indexOf('  const save = async () => {',source.indexOf('async function openPageSheet')),source.indexOf("  body.addEventListener('input'",source.indexOf('async function openPageSheet')));
 let calls=0; const body={innerHTML:'<p>edited</p>',cloneNode(){return {innerHTML:this.innerHTML,querySelectorAll(){return []}}}};
 const ctx=vm.createContext({body, clearTimeout, normalizePageBody(){},live:{id:'book-test'},chId:'c1',window:{neo:{async writeChapter(){calls++;throw Error('disk full')}}}});
 vm.runInContext("let timer=null; let saved='<p>old</p>';"+saveBody+'globalThis.save=save;',ctx);
 (async()=>{await ctx.save().catch(()=>{}); await ctx.save(); assert.equal(calls,1); console.log('B05 reproduced: failed page sheet save is not retried');})().catch(e=>{console.error(e);process.exitCode=1});
} finally {fs.rmSync(dir,{recursive:true,force:true});}
