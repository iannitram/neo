'use strict';

// Module shape (same as manuscript.js): plain JS that loads in the browser, Electron and Node tests.
(function (root) {
  // ...functions...
  const api = { /* exported names */ };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_Origins = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Checks if a URL is a canonical origin.
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL represents a canonical origin
 */
function isCanonicalOrigin(url) {
  try {
    const parsed = new URL(url);
    
    // Must be HTTPS protocol
    if (parsed.protocol !== 'https:') return false;
    
    // Must have hostname ending in .ts.net with at least three labels
    if (!parsed.hostname.endsWith('.ts.net')) return false;
    
    const labels = parsed.hostname.split('.');
    if (labels.length < 3) return false;
    
    // Must not have username or password
    if (parsed.username || parsed.password) return false;
    
    // Must not have path other than '/'
    if (parsed.pathname !== '/') return false;
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Matches a URL against enrolled servers.
 * @param {string} url - The URL to match
 * @param {Array<{origin: string, basePath: string, aliases: Array<string>}>} enrolled - Enrolled servers
 * @returns {Object|null} The matching entry or null
 */
function matchEnrolled(url, enrolled) {
  try {
    // Check for userinfo (username/password) first
    if (url.includes('@')) return null;
    
    const parsed = new URL(url);
    
    // Check for '..' segments in the raw path string before parsing
    // new URL() resolves '..' segments, so we need to check the raw input string
    const urlPath = parsed.pathname;
    if (urlPath.includes('..') || urlPath.includes('%2e%2e')) return null;
    
    const urlOrigin = parsed.origin.toLowerCase();
    const urlPathname = parsed.pathname;
    
    for (const entry of enrolled) {
      // Check if the URL's origin matches the canonical origin or any alias
      const canonicalOrigin = entry.origin.toLowerCase();
      const aliases = entry.aliases || [];
      
      if (urlOrigin === canonicalOrigin) {
        // If path starts with basePath on a segment boundary, match it
        if (urlPathname.startsWith(entry.basePath)) {
          // Check for segment boundary - the character after the basePath must be '/' or end of string
          if (entry.basePath === '/' || urlPathname.length === entry.basePath.length || urlPathname[entry.basePath.length] === '/') {
            return entry;
          }
        }
      } else {
        // Check against aliases
        for (const alias of aliases) {
          const aliasParsed = new URL(alias);
          if (aliasParsed.origin.toLowerCase() === urlOrigin) {
            // Check if path starts with basePath on a segment boundary
            if (urlPathname.startsWith(entry.basePath)) {
              // Check for segment boundary - the character after the basePath must be '/' or end of string
              if (entry.basePath === '/' || urlPathname.length === entry.basePath.length || urlPathname[entry.basePath.length] === '/') {
                return entry;
              }
            }
          }
        }
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Canonicalizes a URL based on enrolled servers.
 * @param {string} url - The URL to canonicalize
 * @param {Array<{origin: string, basePath: string, aliases: Array<string>}>} enrolled - Enrolled servers
 * @returns {string} The canonicalized URL
 * @throws {Error} If the server is not enrolled
 */
function canonicalize(url, enrolled) {
  const entry = matchEnrolled(url, enrolled);
  
  if (!entry) {
    const error = new Error('Unknown server');
    error.name = 'UnknownServerError';
    throw error;
  }
  
  const parsed = new URL(url);
  const canonicalUrl = new URL(entry.origin);
  
  // Keep the path, query and hash
  canonicalUrl.pathname = parsed.pathname;
  canonicalUrl.search = parsed.search;
  canonicalUrl.hash = parsed.hash;
  
  return canonicalUrl.toString();
}

// Export the functions
const api = {
  isCanonicalOrigin,
  matchEnrolled,
  canonicalize
};

if (typeof module === 'object' && module.exports) module.exports = api;
else root.NeoCraft_Origins = api;