'use strict';

// Tailscale-only origin rules (D16): every link NeoCraft writes uses the server's
// Tailscale HTTPS name. Old LAN or http aliases only match to find an enrolled account.
// Module shape (same as manuscript.js): plain JS that loads in the browser, Electron and Node tests.
(function (root) {
  'use strict';

  function parseUrl(url) {
    if (typeof url !== 'string') return null;
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  // new URL() resolves '..' before we can see it, so check the raw path string.
  function hasDotDotSegment(raw) {
    // Match URL's preprocessing and HTTP(S) backslash handling before checking.
    const normalized = raw.trim().replace(/[\t\r\n]/g, '').replace(/\\/g, '/');
    const m = /^[a-z][a-z0-9+.-]*:\/*[^/?#]*([^?#]*)/i.exec(normalized);
    const path = m ? m[1] : '';
    return path.split('/').some((seg) => seg.replace(/%2e/gi, '.') === '..');
  }

  function basePathMatches(pathname, basePath) {
    const base = (basePath || '/').replace(/\/+$/, '');
    if (base === '') return true;
    return pathname === base || pathname.startsWith(base + '/');
  }

  function unknownServerError() {
    const e = new Error('URL is not an enrolled server');
    e.name = 'UnknownServerError';
    return e;
  }

  // Exported functions
  const api = {
    isCanonicalOrigin(url) {
      const u = parseUrl(url);
      if (!u) return false;
      if (u.protocol !== 'https:') return false;
      if (u.username || u.password) return false;
      if (u.pathname !== '/') return false;
      const labels = u.hostname.split('.');
      return u.hostname.endsWith('.ts.net') && labels.length >= 3;
    },

    matchEnrolled(url, enrolled) {
      const u = parseUrl(url);
      if (!u) return null;
      if (u.username || u.password) return null;
      if (hasDotDotSegment(url)) return null;
      for (const entry of enrolled || []) {
        const origins = [entry.origin, ...(entry.aliases || [])]
          .map((o) => parseUrl(o))
          .filter(Boolean)
          .map((o) => o.origin);
        if (!origins.includes(u.origin)) continue;
        if (basePathMatches(u.pathname, entry.basePath)) return entry;
      }
      return null;
    },

    canonicalize(url, enrolled) {
      const entry = api.matchEnrolled(url, enrolled);
      if (!entry) throw unknownServerError();
      const u = new URL(url);
      // Assign components so a path beginning with // cannot become an authority.
      const result = new URL(entry.origin);
      result.pathname = u.pathname;
      result.search = u.search;
      result.hash = u.hash;
      return result.href;
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_Origins = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
