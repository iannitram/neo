'use strict';

// RTF SCANNER: analyzes RTF tokens to determine which features are supported
// and which are not. Returns an object with supported (boolean) and unsupported
// (array of { feature, count }) properties.

(function (root) {
  'use strict';

  // Ignorable destinations that should not be counted as unsupported
  const ignorableDestinations = new Set([
    'generator', 'xmlnstbl', 'pgdsctbl', 'listtable', 'listoverridetable',
    'rsidtbl', 'themedata', 'colorschememapping', 'datastore', 'latentstyles',
    'panose', 'fname', 'mmathPr', 'wgrffmtfilter'
  ]);

  function scanRtf(tokens) {
    const counts = new Map();
    
    // Track if we're inside a field
    let fieldDepth = 0;
    let inField = false;
    let inUnknownDestination = false;
    let unknownDestinationDepth = 0;
    
    // Check for ignorable destinations
    let ignorableDestination = null;
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      
      if (token.type === 'open') {
        // Check if we're entering a group with a star control word (potential destination)
        if (i + 1 < tokens.length && tokens[i + 1].type === 'symbol' && tokens[i + 1].char === '*') {
          if (i + 2 < tokens.length && tokens[i + 2].type === 'control') {
            const destToken = tokens[i + 2];
            if (ignorableDestinations.has(destToken.word)) {
              ignorableDestination = destToken.word;
            } else if (destToken.word) {
              // This is an unknown destination
              inUnknownDestination = true;
              unknownDestinationDepth = 0;
              // Count this as unknown destination only if not inside a field
              if (!inField) {
                const key = 'unknown destination';
                counts.set(key, (counts.get(key) || 0) + 1);
              }
            }
          }
        }
        // Track field depth
        if (i > 0 && tokens[i - 1].type === 'control' && tokens[i - 1].word === 'field') {
          fieldDepth++;
        }
      } else if (token.type === 'control') {
        // Check for field control words
        if (token.word === 'field') {
          inField = true;
          fieldDepth++;
          const key = 'field';
          counts.set(key, (counts.get(key) || 0) + 1);
        } else if (token.word === 'trowd') {
          // Count table rows
          const key = 'table';
          counts.set(key, (counts.get(key) || 0) + 1);
        } else if (token.word === 'object') {
          // Embedded object
          const key = 'embedded object';
          counts.set(key, (counts.get(key) || 0) + 1);
        } else if (token.word === 'pict') {
          // Image
          const key = 'image';
          counts.set(key, (counts.get(key) || 0) + 1);
        } else if (token.word === 'shp' || token.word === 'shpgrp') {
          // Shape
          const key = 'shape';
          counts.set(key, (counts.get(key) || 0) + 1);
        } else if (token.word === 'header' || token.word === 'headerl' || token.word === 'headerr' || 
                   token.word === 'headerf' || token.word === 'footer' || token.word === 'footerl' || 
                   token.word === 'footerr' || token.word === 'footerf') {
          // Header or footer
          const key = 'header or footer';
          counts.set(key, (counts.get(key) || 0) + 1);
        } else if (token.word === 'footnote') {
          // Footnote
          const key = 'footnote';
          counts.set(key, (counts.get(key) || 0) + 1);
        } else if (token.word === 'fldinst') {
          // If we're inside a field, don't count fldinst as an unknown destination
          if (inField) {
            // fldinst is part of field structure, don't count it as unknown
          } else {
            // This is an unknown destination
            const key = 'unknown destination';
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        }
      } else if (token.type === 'close') {
        // Decrease field depth when closing
        if (fieldDepth > 0) {
          fieldDepth--;
          if (fieldDepth === 0) {
            inField = false;
          }
        }
        
        // Reset unknown destination tracking
        if (inUnknownDestination) {
          unknownDestinationDepth--;
          if (unknownDestinationDepth <= 0) {
            inUnknownDestination = false;
          }
        }
        
        // Reset ignorable destination tracking
        if (ignorableDestination) {
          ignorableDestination = null;
        }
      }
    }
    
    // Build the unsupported array with features sorted by feature name
    const unsupportedList = [];
    for (const [feature, count] of counts.entries()) {
      unsupportedList.push({ feature, count });
    }
    
    // Sort by feature name
    unsupportedList.sort((a, b) => a.feature.localeCompare(b.feature));
    
    // Return if all features are supported or not
    const supported = unsupportedList.length === 0;
    
    return { supported, unsupported: unsupportedList };
  }

  const api = { scanRtf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_RtfScan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);