(function (root) {
  'use strict';

  function conflictCopyName(fileName, date, attempt = 1) {
    const stamp = `(conflict ${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}-${String(date.getUTCMinutes()).padStart(2, '0')})`;
    
    const lastDot = fileName.lastIndexOf('.');
    let namePart = fileName;
    let extPart = '';
    
    if (lastDot !== -1 && lastDot > 0) {
      // Handle dotfiles properly
      namePart = fileName.substring(0, lastDot);
      extPart = fileName.substring(lastDot);
      
      // If it's a dotfile like .env, the whole thing is the name part
      if (namePart === '') {
        namePart = '.';
        extPart = fileName;
      }
    }
    
    if (attempt === 1) {
      return namePart + ' ' + stamp + extPart;
    } else {
      // For attempt > 1, add the attempt number before the extension
      const lastSpace = namePart.lastIndexOf(' ');
      if (lastSpace !== -1 && namePart.substring(lastSpace).startsWith(' ') && 
          namePart.substring(lastSpace + 1) === stamp.replace(/\s+/g, ' ').trim()) {
        // If we already have a conflict stamp, replace it with attempt number
        return namePart.substring(0, lastSpace) + ' ' + stamp + ' ' + attempt + extPart;
      } else {
        // Add the attempt number at the end before extension  
        return namePart + ' ' + stamp + ' ' + attempt + extPart;
      }
    }
  }

  async function createExclusive({ fetch, folderUrl, fileName, bytes, date, requestToken, maxAttempts = 20 }) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const name = conflictCopyName(fileName, date, attempt);
      try {
        const response = await fetch(folderUrl + '/' + encodeURIComponent(name), {
          method: 'PUT',
          body: bytes,
          headers: {
            'If-None-Match': '*',
            requesttoken: requestToken
          }
        });
        
        if (response.status === 201 || response.status === 204) {
          // Success - file was created 
          return { kind: 'created', name, etag: response.headers.get('ETag') };
        } else if (response.status === 412) {
          // Precondition failed, try next attempt
          continue;
        } else {
          // Some other error
          return { kind: 'error', status: response.status, name };
        }
      } catch (err) {
        // Network or fetch error - ambiguous result
        return { kind: 'ambiguous', name };
      }
    }
    
    // All attempts failed with 412
    return { kind: 'error', status: 412 };
  }

  const api = {
    conflictCopyName,
    createExclusive
  };

  if (typeof module === 'object' && module.exports) 
    module.exports = api;
  else 
    root.NeoCraft_conflictCopy = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);