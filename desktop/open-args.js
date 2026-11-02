'use strict';

// Module shape (same as manuscript.js): plain JS that loads in the browser, Electron and Node tests.
(function (root) {
  'use strict';
  
  function parseOpenArgs(argv, { isPackaged, cwd, exts = ['md', 'markdown', 'txt', 'rtf'], pathImpl }) {
    const files = [];
    const urls = [];
    const seen = new Set();
    
    // Default to node:path if not provided
    if (!pathImpl) {
      if (typeof require === 'function') {
        pathImpl = require('node:path');
      } else {
        // Fallback for browser or other environments - use a simple posix-like implementation
        pathImpl = {
          resolve: (cwd, arg) => {
            // Simple fallback for non-node environments
            return new URL(arg, `file://${cwd}/`).pathname;
          }
        };
      }
    }
    
    // Skip argv[0] (the executable)
    let start = 1;
    
    // When isPackaged is false also skip argv[1] (the app path, e.g. '.')
    if (!isPackaged) {
      start = 2;
    }
    
    for (let i = start; i < argv.length; i++) {
      const arg = argv[i];
      
      // Skip anything starting with '-' (flags)
      if (arg.startsWith('-')) {
        continue;
      }
      
      // Check if it's a neocraft:// URL
      if (arg.toLowerCase().startsWith('neocraft://')) {
        urls.push(arg);
        continue;
      }
      
      // Check if it's a file with an allowed extension
      const lowerArg = arg.toLowerCase();
      const dotIndex = lowerArg.lastIndexOf('.');
      if (dotIndex !== -1) {
        const ext = lowerArg.substring(dotIndex + 1);
        if (exts.includes(ext)) {
          // Make absolute path using the provided path implementation
          const absPath = pathImpl.resolve(cwd, arg);
          
          // Only add if not already seen
          if (!seen.has(absPath)) {
            seen.add(absPath);
            files.push(absPath);
          }
        }
      }
    }
    
    return { files, urls };
  }

  const api = { parseOpenArgs };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_OpenArgs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);