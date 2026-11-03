'use strict';

// One document, with no filesystem, library, timers or UI dependencies.
// createDocumentSession({ adapter, host }) -> { open, edit, save, getState, idle }
// open(ref, name) replaces the document; edit(model) replaces its working model.
// Models, adapter metadata, refs and revisions must be structured-cloneable.
// getState() returns detached data (except error, retained for caller inspection).
// originalBytes always holds the bytes read on open, even after successful saves.
// A clean save does nothing; save() resolves to { revision }, or null for a
// no-op/stale request. open() similarly returns a state snapshot or null.
//
// STORAGE HOST CONTRACT (sync results or Promises):
//   read(ref) -> { bytes: Uint8Array, revision }
//   save(ref, bytes: Uint8Array, baseRevision) -> { revision }
// ref identifies exactly one file; revisions are opaque, non-null tokens.
// save must conditionally replace only that file at baseRevision, atomically,
// and acknowledge only durable success with the new revision. No library files.
// Hosts must not mutate inputs. Reject with an Error whose code is:
//   'conflict'        base revision changed; original must not be overwritten
//   'offline'         unavailable; retain local edits for an explicit retry
//   'permission-lost' no longer authorized; retain edits for reauthorization
// A conflict copy/reconciliation belongs to the host/caller, never a blind retry.
// Unknown upload outcomes must be reconciled by the host before another write.
//
// Adapter contract: scripts/format-contract.js (#33), including async methods.
// Unsupported fidelity blocks in-place saves with code 'unsupported-format'.
// States: loading, clean, dirty, saving, conflict, offline, permission-lost;
// unexpected failures use error. dirty is also a boolean comparing generations:
// saving/error states never imply that the working model has been acknowledged.
// Failed queued saves are not retried automatically. Conflict requires reopening
// a reconciled file; offline/permission failures permit an explicit save retry.
//
// RECOVERY (optional): recovery: { account, drafts, onError } where drafts is
// document-session/drafts.js's createDrafts(). edit() writes a recovery draft
// and a confirmed save clears it (guarded by generation). A failed draft write
// or clear goes to onError(error) and never changes the session's state.

(function (root) {
  'use strict';

  const { createSaveSerializer, createRequestGuard } = typeof module === 'object' && module.exports
    ? require('./document-session/serial') : root.NeoCraft_Serial;

  function createDocumentSession({ adapter, host, recovery = null }) {
    if (recovery && (typeof recovery.drafts?.write !== 'function' || typeof recovery.drafts?.clear !== 'function'
      || typeof recovery.onError !== 'function')) {
      throw new TypeError('recovery needs drafts (with write and clear) and onError');
    }
    const guard = createRequestGuard();
    let token;
    let doc = { state: 'loading', ref: null, name: '', model: null, meta: null,
      originalBytes: null, baseRevision: null, editGeneration: 0, savedGeneration: 0,
      fidelity: null, error: null };

    function reportDraft(pending) {
      pending.catch((error) => recovery.onError(error));
    }

    function getState() {
      const { error, ...data } = doc;
      return { ...structuredClone(data), dirty: doc.editGeneration > doc.savedGeneration, error };
    }

    function fail(error) {
      doc.error = error;
      doc.state = ['conflict', 'offline', 'permission-lost'].includes(error.code) ? error.code : 'error';
    }

    function revisionOf(result) {
      if (!result || result.revision == null) throw new TypeError('Host must return a revision');
      return structuredClone(result.revision);
    }

    async function open(ref, name) {
      const request = guard.next();
      token = request;
      doc = { state: 'loading', ref: structuredClone(ref), name, model: null, meta: null,
        originalBytes: null, baseRevision: null, editGeneration: 0, savedGeneration: 0,
        fidelity: null, error: null };
      try {
        const read = await host.read(doc.ref);
        if (!guard.isCurrent(request)) return null;
        if (!(read.bytes instanceof Uint8Array)) throw new TypeError('Host must return bytes');
        const originalBytes = new Uint8Array(read.bytes);
        const baseRevision = revisionOf(read);
        const fidelity = await adapter.scan(new Uint8Array(originalBytes), name);
        if (!guard.isCurrent(request)) return null;
        const opened = await adapter.open(new Uint8Array(originalBytes), name);
        if (!guard.isCurrent(request)) return null;
        Object.assign(doc, structuredClone({ originalBytes, baseRevision, fidelity,
          model: opened.model, meta: opened.meta }), { state: 'clean' });
        return getState();
      } catch (error) {
        if (!guard.isCurrent(request)) return null;
        fail(error);
        throw error;
      }
    }

    function edit(model) {
      if (doc.originalBytes === null) throw new Error('Open a document before editing');
      doc.model = structuredClone(model);
      doc.editGeneration++;
      if (doc.state === 'clean') doc.state = 'dirty';
      if (recovery) {
        reportDraft(recovery.drafts.write(recovery.account, doc.ref,
          { name: doc.name, model: doc.model, meta: doc.meta, generation: doc.editGeneration }));
      }
    }

    const serializer = createSaveSerializer(async (job) => {
      if (!guard.isCurrent(job.token)) return null;
      if (doc.error && (doc.state === 'conflict' || doc.error !== job.failure)) throw doc.error;
      if (job.generation <= doc.savedGeneration) return null;
      try {
        if (!doc.fidelity.supported) {
          throw Object.assign(new Error('Unsupported content requires a copy or fallback'), { code: 'unsupported-format' });
        }
        doc.state = 'saving';
        const bytes = await adapter.serialize(job.model, job.meta);
        if (!guard.isCurrent(job.token)) return null;
        if (!(bytes instanceof Uint8Array)) throw new TypeError('Adapter must serialize bytes');
        // Read the revision when this queued save starts, after the prior ack.
        const result = await host.save(doc.ref, new Uint8Array(bytes), doc.baseRevision);
        if (!guard.isCurrent(job.token)) return null;
        doc.baseRevision = revisionOf(result);
        doc.savedGeneration = job.generation;
        doc.error = null;
        doc.state = doc.editGeneration === doc.savedGeneration ? 'clean' : 'dirty';
        if (recovery) reportDraft(recovery.drafts.clear(recovery.account, doc.ref, job.generation));
        return { revision: structuredClone(doc.baseRevision) };
      } catch (error) {
        if (!guard.isCurrent(job.token)) return null;
        fail(error);
        throw error;
      }
    });

    function save() {
      if (doc.originalBytes === null) return Promise.reject(new Error('Open a document before saving'));
      if (doc.editGeneration === doc.savedGeneration) return Promise.resolve(null);
      return serializer.save({ token, generation: doc.editGeneration, failure: doc.error,
        model: structuredClone(doc.model), meta: structuredClone(doc.meta) });
    }

    return { open, edit, save, getState, idle: serializer.idle };
  }

  const api = { createDocumentSession };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_DocumentSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
