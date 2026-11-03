'use strict';

// DESKTOP DOCUMENT HOST (M4, #72). The storage host for one file that the
// writer asked to open, on the Electron main process. It implements the
// document session's storage host contract (document-session.js):
//   read(ref) -> { bytes, revision }
//   save(ref, bytes, baseRevision) -> { revision }
// and is the only place the desktop reads or replaces a document.
//
// Rules this module keeps:
//   - It touches only the exact path the writer asked for. It never lists or
//     scans a folder, so a macOS File Provider placeholder downloads only when
//     that file is read.
//   - The renderer never sees a path. open() issues an opaque ref for a file
//     that was requested (command line, second instance, macOS open-file);
//     read and save accept only refs it issued.
//   - The revision is the SHA-256 of the file's bytes (desktop/atomic-write.js).
//     A save replaces the file only if its revision still matches the one the
//     session read, so an edit made outside NeoCraft is never overwritten.
//     A local revision cannot see remote changes the sync client has not
//     delivered yet.
//
// Plain CommonJS for the Electron main process and Node's tests. fs and path
// are injected, so tests run against an in-memory filesystem.

const crypto = require('node:crypto');
const { contentRevision, atomicReplace } = require('../desktop/atomic-write');
const { parseOpenArgs } = require('../desktop/open-args');

// Document mode opens these; .docx stays with WordCraft (M13).
const DOCUMENT_EXTS = ['md', 'markdown', 'txt', 'rtf'];

function isDocumentFile(filePath) {
  const name = String(filePath);
  const dot = name.lastIndexOf('.');
  return dot !== -1 && DOCUMENT_EXTS.includes(name.slice(dot + 1).toLowerCase());
}

// The files a launch names, as absolute paths. neocraft:// links are left out:
// they are the handoff's business, not a document's.
function documentPathsFromArgv(argv, { isPackaged, cwd, pathImpl }) {
  return parseOpenArgs(argv, { isPackaged, cwd, exts: DOCUMENT_EXTS, pathImpl }).files;
}

function withCode(code, message, extra = {}) {
  return Object.assign(new Error(message), { code }, extra);
}

// A permission the system took away is the session's 'permission-lost';
// everything else reaches the session as the error it is.
function fromFsError(err) {
  if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
    return withCode('permission-lost', 'NeoCraft can no longer read or write this file', { cause: err });
  }
  return err;
}

function createElectronDocumentHost({
  fs = require('node:fs/promises'),
  path = require('node:path'),
  newRef = () => crypto.randomUUID(),
} = {}) {
  // ref -> absolute path, for the files the writer asked to open, and nothing else
  const files = new Map();

  function pathOf(ref) {
    const filePath = files.get(ref);
    if (filePath === undefined) throw withCode('unknown-document', 'That document is not open');
    return filePath;
  }

  async function readExact(filePath) {
    try {
      return await fs.readFile(filePath);
    } catch (err) {
      throw fromFsError(err);
    }
  }

  // Asks for one file by its exact path and returns the ref the session uses.
  // The first read gives the first revision; the bytes are not kept.
  async function open(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new TypeError('A document is opened by its absolute path');
    }
    const bytes = await readExact(filePath);
    const ref = newRef();
    files.set(ref, filePath);
    return { ref, path: filePath, name: path.basename(filePath), revision: contentRevision(bytes) };
  }

  async function read(ref) {
    const bytes = await readExact(pathOf(ref));
    return { bytes: new Uint8Array(bytes), revision: contentRevision(bytes) };
  }

  async function save(ref, bytes, baseRevision) {
    const filePath = pathOf(ref);
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Host must save bytes');
    try {
      const saved = await atomicReplace({ fs, path: filePath, bytes, expectedRevision: baseRevision });
      return { revision: saved.revision };
    } catch (err) {
      if (err && err.name === 'RevisionMismatchError') {
        // edited (or deleted) outside NeoCraft since it was read: nothing was written
        throw withCode('conflict', 'The file changed on disk since it was opened', { currentRevision: err.currentRevision });
      }
      if (err && err.name === 'RetryableSaveError') {
        throw withCode('save-failed', 'The file could not be replaced; the new copy is beside it', { tmp: err.tmp, cause: err.cause });
      }
      throw fromFsError(err);
    }
  }

  return { open, read, save };
}

module.exports = { DOCUMENT_EXTS, isDocumentFile, documentPathsFromArgv, createElectronDocumentHost };
