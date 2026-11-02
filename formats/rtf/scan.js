(function (root) {
  'use strict';
  
  // List of ignorable control words that are allowed in unknown destinations
  const ignorableWords = new Set([
    'generator', 'xmlnstbl', 'pgdsctbl', 'listtable', 'listoverridetable',
    'rsidtbl', 'themedata', 'colorschememapping', 'datastore', 'latentstyles',
    'panose', 'fname', 'mmathPr', 'wgrffmtfilter'
  ]);
  
  /**
   * Scan RTF tokens and classify supported/unsupported features
   * @param {Array} tokens - Array of RTF tokens
   * @returns {Object} { supported, unsupported }
   */
  function scanRtf(tokens) {
    
    // Feature counters
    const counts = new Map();
    
    // Process each token
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      
      if (token.type === 'control') {
        const word = token.word;
        
        switch (word) {
          case 'field':
            // Count fields, but only once per field
            counts.set('field', (counts.get('field') || 0) + 1);
            break;
            
          case 'trowd':
            // Count table rows
            counts.set('table', (counts.get('table') || 0) + 1);
            break;
            
          case 'object':
            // Embedded object
            counts.set('embedded object', (counts.get('embedded object') || 0) + 1);
            break;
            
          case 'pict':
            // Image
            counts.set('image', (counts.get('image') || 0) + 1);
            break;
            
          case 'shp':
          case 'shpgrp':
            // Shape
            counts.set('shape', (counts.get('shape') || 0) + 1);
            break;
            
          case 'header':
          case 'headerl':
          case 'headerr':
          case 'headerf':
          case 'footer':
          case 'footerl':
          case 'footerr':
          case 'footerf':
            // Header or footer
            counts.set('header or footer', (counts.get('header or footer') || 0) + 1);
            break;
            
          case 'footnote':
            // Footnote
            counts.set('footnote', (counts.get('footnote') || 0) + 1);
            break;
            
          default:
            break;
        }
      } else if (token.type === 'symbol' && token.char === '*' && i > 0 && tokens[i - 1].type === 'open') {
        // Only a '*' that opens a group (its first token) starts a destination
        // Look ahead to see what comes after the '*' symbol
        const nextToken = tokens[i + 1];
        if (nextToken && nextToken.type === 'control') {
          const nextWord = nextToken.word;
          // Only count as unknown destination if it's not in ignorable set and not fldinst
          if (!ignorableWords.has(nextWord) && nextWord !== 'fldinst') {
            counts.set('unknown destination', (counts.get('unknown destination') || 0) + 1);
          }
        }
      }
    }
    
    // Convert counts to the required format
    const result = [];
    for (const [feature, count] of counts.entries()) {
      result.push({ feature, count });
    }
    
    // Sort by feature name
    result.sort((a, b) => a.feature.localeCompare(b.feature));
    
    // Determine if supported
    const supported = result.length === 0;
    
    return { supported, unsupported: result };
  }
  
  const api = { scanRtf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_RtfScan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);