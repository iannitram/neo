'use strict';

(function (root) {
  function findWikilinks(text) {
    const results = [];
    
    // Track code blocks to avoid matching inside them
    let inCodeBlock = false;
    let codeBlockDelimiter = '';
    let inInlineCode = false;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Handle code block delimiters
      if (!inInlineCode && !inCodeBlock) {
        if (text.slice(i, i + 3) === '```' || text.slice(i, i + 3) === '~~~') {
          inCodeBlock = true;
          codeBlockDelimiter = text.slice(i, i + 3);
          i += 2; // Skip the rest of the delimiter
          continue;
        }
      } else if (inCodeBlock && text.slice(i, i + codeBlockDelimiter.length) === codeBlockDelimiter) {
        inCodeBlock = false;
        i += codeBlockDelimiter.length - 1;
        continue;
      }
      
      // Handle inline code
      if (!inCodeBlock && !inInlineCode && char === '`') {
        inInlineCode = true;
        continue;
      } else if (inInlineCode && char === '`') {
        inInlineCode = false;
        continue;
      }
      
      // Skip if inside code
      if (inCodeBlock || inInlineCode) {
        continue;
      }
      
      // Look for wikilink start
      if (char === '[' && i + 1 < text.length && text[i + 1] === '[') {
        let linkStart = i;
        let linkEnd = -1;
        
        // Find the end of the wikilink, being careful about nested brackets
        let bracketCount = 0;
        for (let j = i + 2; j < text.length; j++) {
          if (text[j] === '[' && j + 1 < text.length && text[j + 1] === '[') {
            // Nested [[, increase the count and skip next [
            bracketCount++;
            j++; // Skip next [
          } else if (text[j] === ']' && j + 1 < text.length && text[j + 1] === ']') {
            // Check if this is a closing ]] for our opening [[ 
            if (bracketCount > 0) {
              bracketCount--;
            } else {
              linkEnd = j + 2;
              break;
            }
          }
        }
        
        // Check if we found a complete wikilink
        if (linkEnd !== -1) {
          const content = text.slice(i + 2, linkEnd - 2);
          
          // Skip unclosed or empty links or links spanning newlines
          if (content.length === 0 || content.includes('\n')) {
            i = linkEnd - 1;
            continue;
          }
          
          let embed = false;
          let target = '';
          let heading = null;
          let alias = null;
          
          // Check for embed marker at the start (it would be right before the [[)
          if (i > 0 && text[i - 1] === '!') {
            embed = true;
            // Adjust linkStart to include the !
            linkStart = i - 1;
          }
          
          // Parse content
          const parts = content.split('|');
          target = parts[0];
          
          // Handle heading and alias
          if (target.includes('#')) {
            const [t, h] = target.split('#', 2);
            target = t;
            heading = h;
          }
          
          // Process alias (second part after |)
          if (parts.length > 1) {
            const aliasPart = parts.slice(1).join('|');
            
            // Check if the last part contains # to indicate a heading
            if (aliasPart.includes('#')) {
              const [a, h] = aliasPart.split('#', 2);
              alias = a;
              heading = h;
            } else {
              alias = aliasPart;
            }
          }
          
          // Trim target
          target = target.trim();
          
          results.push({
            start: linkStart,
            end: linkEnd,
            target,
            heading,
            alias,
            embed
          });
          
          i = linkEnd - 1;
        }
      }
    }
    
    return results;
  }

  const api = { findWikilinks };
  
  if (typeof module === 'object' && module.exports) 
    module.exports = api;
  else 
    root.NeoCraft_Wikilinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);