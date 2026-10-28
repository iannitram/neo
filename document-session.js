'use strict';

// DOCUMENT SESSION: one open file, edited in place (M3, M7, M8).
//
// The session knows nothing of books, chapters, the library, Nextcloud paths,
// Electron IPC or credentials. It holds the bytes it loaded, the model the
// format adapter made from them, and two counters that say what is saved.
// It talks to a format adapter and a storage host only through the contracts
// below. Saves run through createSaveSerializer (document-session/serial.js),
// and open replies are checked with createRequestGuard.
//
// ---------------------------------------------------------------------------
// STORAGE HOST CONTRACT
//
//   host.read(ref) -> Promise<{ bytes: Uint8Array, revision }>
//     Reads the current bytes and an opaque revision (for WebDAV, the ETag).
//
//   host.save(ref, bytes: Uint8Array, baseRevision) -> Promise<{ revision }>
//     Writes only if the stored revision is still baseRevision, as one atomic
//     compare-and-write. If it has moved, reject with ConflictError and write
//     nothing. Never write unconditionally. Returns the new revision.
//
//   The host creates, renames and deletes nothing else. The session calls
//   read and save on the one ref it was given, and nothing more.
//
//   Errors. A rejection maps to a session state by its code:
//     ConflictError       code 'conflict'        -> state 'conflict'
//     OfflineError        code 'offline'         -> state 'offline'
//     PermissionLostError code 'permission-lost' -> state 'permission-lost'
//   Any other rejection leaves the session dirty, with the error recorded in
//   session.error. A host in another realm may throw any Error with the
//   matching `code` property; the session maps on `code`, not on the class.
//   Hosts map HTTP status to these: 412 -> conflict, network failure ->
//   offline, 401/403 -> permission-lost.
//
// ---------------------------------------------------------------------------
// FORMAT ADAPTER CONTRACT (checked by scripts/format-contract.js)
//
//   adapter.id: non-empty string
//   adapter.open(bytes: Uint8Array, name: string) -> { model, meta }
//     sync or Promise. Turns the bytes into the editor's model.
//   adapter.serialize(model, meta) -> Uint8Array
//     sync or Promise. Turns the model back into bytes.
//   adapter.scan(bytes: Uint8Array, name: string)
//     -> { supported: boolean, unsupported: Array<{ feature, count }> }
//     sync or Promise. The fidelity report. supported === (unsupported is empty).
//
// ---------------------------------------------------------------------------
// SESSION
//
//   createDocumentSession({ ref, host, adapter, now? }) -> session
//     ref: opaque, handed to the host unchanged. The adapter's name is
//       ref.name when ref is an object, otherwise String(ref).
//     now: () => number, for savedAt. Defaults to Date.now.
//
//   session.id            string: a generated session id. Identity is ref + id.
//   session.ref           the ref given to the constructor.
//   session.state         'closed' | 'loading' | 'clean' | 'dirty' | 'saving'
//                         | 'conflict' | 'offline' | 'permission-lost'
//                         'closed' is the state before the first open, after a
//                         failed open that is not offline or permission-lost,
//                         and after close().
//   session.baseRevision  the revision the host last acknowledged.
//   session.originalBytes the bytes of baseRevision.
//   session.fidelity      the adapter's scan result, taken on open.
//   session.editGeneration   bumped on each edit.
//   session.savedGeneration  the edit generation the last successful save covered.
//   session.dirty         editGeneration > savedGeneration.
//   session.error         the last error recorded, or null.
//   session.savedAt       now() at the last successful save, or null.
//
//   session.open() -> Promise<session>
//     Reads the ref and loads it. It refuses to replace unsaved edits. A
//     reply from an older open() that a newer open() has overtaken is ignored.
//   session.getModel() -> the current model (undefined when no document is open)
//   session.edit(change) -> editGeneration
//     change is the whole new model, or a function from the current model to
//     the new one. Throws when no document is open.
//   session.save() -> Promise<{ saved: true, revision } | { saved: false, reason }>
//     Saves the edits made so far. Saves never overlap. A save with nothing
//     unsaved makes no host call. A save that the host rejects rejects here too.
//   session.close() -> Promise
//     Retires the session. A save still in flight finishes on the host, but
//     its reply changes nothing, and no further host calls are made.
//   session.subscribe(listener(state, session)) -> unsubscribe
//     Called on each state change.
// ---------------------------------------------------------------------------

(function (root) {
  'use strict';

  const serial = typeof module === 'object' && module.exports
    ? require('./document-session/serial')
    : root.NeoCraft_Serial;
  const { createSaveSerializer, createRequestGuard } = serial;

  class HostError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'HostError';
      this.code = code;
    }
  }

  class ConflictError extends HostError {
    constructor(message) {
      super('conflict', message || 'the file changed on the server');
      this.name = 'ConflictError';
    }
  }

  class OfflineError extends HostError {
    constructor(message) {
      super('offline', message || 'the storage host cannot be reached');
      this.name = 'OfflineError';
    }
  }

  class PermissionLostError extends HostError {
    constructor(message) {
      super('permission-lost', message || 'access to the file was lost');
      this.name = 'PermissionLostError';
    }
  }

  const STATE_FOR_CODE = {
    conflict: 'conflict',
    offline: 'offline',
    'permission-lost': 'permission-lost',
  };

  let sessionCount = 0;

  function stateForError(error, fallback) {
    const code = error && error.code;
    return Object.prototype.hasOwnProperty.call(STATE_FOR_CODE, code)
      ? STATE_FOR_CODE[code]
      : fallback;
  }

  function createDocumentSession({ ref, host, adapter, now = () => Date.now() } = {}) {
    if (!host || typeof host.read !== 'function' || typeof host.save !== 'function') {
      throw new TypeError('host needs read(ref) and save(ref, bytes, baseRevision)');
    }
    if (!adapter || typeof adapter.open !== 'function' || typeof adapter.serialize !== 'function'
      || typeof adapter.scan !== 'function') {
      throw new TypeError('adapter needs open, serialize and scan');
    }

    sessionCount += 1;
    const id = `doc-${sessionCount}-${String(now())}`;
    const name = typeof ref === 'string' ? ref : (ref && ref.name) || String(ref);

    let state = 'closed';
    let retired = false;
    let model;
    let meta;
    let fidelity = null;
    let baseRevision;
    let originalBytes;
    let editGeneration = 0;
    let savedGeneration = 0;
    let lastError = null;
    let savedAt = null;
    let docToken = 0; // the open token of the loaded document; 0 before any load

    const listeners = new Set();
    const openGuard = createRequestGuard();
    const saver = createSaveSerializer((job) => runSave(job));

    function setState(next) {
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener(state, session);
    }

    // true while a reply that began at `token` may still apply
    const isCurrent = (token) => !retired && openGuard.isCurrent(token);

    async function open() {
      if (retired) throw new Error('session is closed');
      if (model !== undefined && editGeneration > savedGeneration) {
        throw new Error('unsaved edits: save before opening again');
      }
      const token = openGuard.next();
      model = undefined;
      meta = undefined;
      fidelity = null;
      baseRevision = undefined;
      originalBytes = undefined;
      editGeneration = 0;
      savedGeneration = 0;
      lastError = null;
      setState('loading');

      let loaded;
      try {
        const got = await host.read(ref);
        if (!got || !(got.bytes instanceof Uint8Array) || got.revision === undefined) {
          throw new TypeError('host.read must return { bytes: Uint8Array, revision }');
        }
        const opened = await adapter.open(got.bytes, name);
        const scanned = await adapter.scan(got.bytes, name);
        loaded = { got, opened, scanned };
      } catch (error) {
        if (!isCurrent(token)) return session; // a newer open() owns the session now
        lastError = error;
        setState(stateForError(error, 'closed'));
        throw error;
      }
      if (!isCurrent(token)) return session;

      model = loaded.opened.model;
      meta = loaded.opened.meta;
      fidelity = loaded.scanned;
      baseRevision = loaded.got.revision;
      originalBytes = new Uint8Array(loaded.got.bytes);
      docToken = token;
      setState('clean');
      return session;
    }

    function edit(change) {
      if (retired) throw new Error('session is closed');
      if (model === undefined) throw new Error('no document is open');
      const next = typeof change === 'function' ? change(model) : change;
      if (next === undefined) throw new TypeError('edit needs a model, or an updater that returns one');
      model = next;
      editGeneration += 1;
      if (state === 'clean') setState('dirty');
      return editGeneration;
    }

    function save() {
      if (retired) return Promise.reject(new Error('session is closed'));
      if (model === undefined) return Promise.reject(new Error('no document is open'));
      return saver.save({ token: docToken });
    }

    // The serializer runs this one save at a time. It takes its generation
    // when it starts, so an edit made while it waits is included.
    async function runSave(job) {
      if (!isCurrent(job.token)) return { saved: false, reason: retired ? 'closed' : 'superseded' };
      const gen = editGeneration;
      if (gen <= savedGeneration) return { saved: false, reason: 'clean', revision: baseRevision };

      const token = job.token;
      const base = baseRevision;
      const snapshot = { model, meta };
      setState('saving');

      let bytes;
      let reply;
      try {
        bytes = await adapter.serialize(snapshot.model, snapshot.meta);
        if (!(bytes instanceof Uint8Array)) throw new TypeError('adapter.serialize must return a Uint8Array');
        reply = await host.save(ref, bytes, base);
        if (!reply || reply.revision === undefined) throw new TypeError('host.save must return { revision }');
      } catch (error) {
        if (!isCurrent(token)) return { saved: false, reason: retired ? 'closed' : 'superseded' };
        lastError = error;
        setState(stateForError(error, 'dirty'));
        throw error;
      }
      if (!isCurrent(token)) return { saved: false, reason: retired ? 'closed' : 'superseded' };

      savedGeneration = gen; // the snapshot's generation, not editGeneration
      baseRevision = reply.revision;
      originalBytes = new Uint8Array(bytes);
      savedAt = now();
      lastError = null;
      setState(editGeneration > savedGeneration ? 'dirty' : 'clean');
      return { saved: true, revision: reply.revision };
    }

    async function close() {
      if (retired) return;
      retired = true;
      openGuard.next(); // every reply still in flight is now stale
      setState('closed');
      await saver.idle();
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    const session = {
      get id() { return id; },
      get ref() { return ref; },
      get state() { return state; },
      get baseRevision() { return baseRevision; },
      get originalBytes() { return originalBytes; },
      get fidelity() { return fidelity; },
      get editGeneration() { return editGeneration; },
      get savedGeneration() { return savedGeneration; },
      get dirty() { return editGeneration > savedGeneration; },
      get error() { return lastError; },
      get savedAt() { return savedAt; },
      open,
      edit,
      save,
      close,
      getModel() { return model; },
      subscribe,
    };
    return session;
  }

  const api = {
    createDocumentSession,
    HostError,
    ConflictError,
    OfflineError,
    PermissionLostError,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_DocumentSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
