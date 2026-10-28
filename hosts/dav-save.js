'use strict';

// GUARDED WEBDAV SAVE: one PUT that carries If-Match against the exact
// ETag the file was loaded with, and a classification of every outcome so
// the host never overwrites or retries blindly.
//
// Plain JavaScript that also runs in Node (the tests). It takes its fetch
// as an argument, so it knows nothing of the browser or the network.
//
//   guardedPut({ fetch, url, bytes, etag, requestToken, timeoutMs })
//     -> { kind: 'saved', etag, needsRefresh }
//      | { kind: 'conflict' } | { kind: 'locked' } | { kind: 'auth' }
//      | { kind: 'gone' } | { kind: 'error', retryable, status }
//      | { kind: 'ambiguous' }
//
// 'ambiguous' means a rejected fetch or a timeout: the upload may or may
// not have landed, so the caller must check the server before saving again.

(function (root) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 30000;

  function classifySaveResponse(status, headers) {
    if (status === 200 || status === 201 || status === 204) {
      const etag = headers.get('ETag');
      return { kind: 'saved', etag, needsRefresh: etag === null };
    }
    if (status === 412) return { kind: 'conflict' };
    if (status === 423) return { kind: 'locked' };
    if (status === 401 || status === 403) return { kind: 'auth' };
    if (status === 404 || status === 410) return { kind: 'gone' };
    if (status === 507) return { kind: 'error', retryable: false, status };
    if (status >= 500 && status <= 599) return { kind: 'error', retryable: true, status };
    return { kind: 'error', retryable: false, status };
  }

  async function guardedPut({ fetch, url, bytes, etag, requestToken, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (typeof etag !== 'string' || etag === '') {
      throw new TypeError('guardedPut needs the ETag the file was loaded with');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        body: bytes,
        headers: { 'If-Match': etag, requesttoken: requestToken },
        signal: controller.signal,
      });
      return classifySaveResponse(res.status, res.headers);
    } catch {
      // A rejected fetch or an abort: the upload may or may not have landed.
      return { kind: 'ambiguous' };
    } finally {
      clearTimeout(timer);
    }
  }

  const api = { classifySaveResponse, guardedPut };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_DavSave = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
