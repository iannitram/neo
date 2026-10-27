'use strict';

(function (root) {
  // Export `createIntent({ fileId, path, origin }, { now = Date.now, randomBytes, ttlMs = 120000 })` and `createIntentVerifier()`.
  // - `randomBytes(n)` returns a Uint8Array (inject `crypto.getRandomValues` in the browser, a fake in tests). 
  //   `createIntent` returns `{ fileId, path, origin, nonce, expires }` with `nonce` = 32 lowercase hex chars from 16 random bytes and `expires = now() + ttlMs`.
  // - `createIntentVerifier()` returns `{ verify(intent, nonce, now) }` with a private set of used nonces. 
  //   `verify` returns 'ok' the first time when `nonce === intent.nonce` and `now <= intent.expires`; 
  //   'expired' when `now > intent.expires`; 
  //   'mismatch' when the nonce differs; 
  //   'used' when that nonce was already accepted. Only 'ok' marks it used.
  
  function createIntent({ fileId, path, origin }, { now = Date.now, randomBytes, ttlMs = 120000 }) {
    const bytes = randomBytes(16);
    let nonce = '';
    for (let i = 0; i < bytes.length; i++) {
      nonce += bytes[i].toString(16).padStart(2, '0');
    }
    
    return {
      fileId,
      path,
      origin,
      nonce,
      expires: now() + ttlMs
    };
  }

  function createIntentVerifier() {
    const usedNonces = new Set();
    
    return {
      verify(intent, nonce, now) {
        // Handle null/undefined intent
        if (!intent) {
          return 'mismatch';
        }
        
        // Check for required properties
        if (typeof intent.expires !== 'number') {
          return 'mismatch';
        }
        
        if (typeof intent.nonce !== 'string') {
          return 'mismatch';
        }
        
        if (now > intent.expires) {
          return 'expired';
        }
        
        if (nonce !== intent.nonce) {
          return 'mismatch';
        }
        
        if (usedNonces.has(nonce)) {
          return 'used';
        }
        
        usedNonces.add(nonce);
        return 'ok';
      }
    };
  }

  const api = { createIntent, createIntentVerifier };
  
  if (typeof module === 'object' && module.exports) 
    module.exports = api;
  else 
    root.NeoCraft_Handoff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);