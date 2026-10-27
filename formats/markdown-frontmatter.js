(function (root) {
  'use strict';
  
  function splitFrontmatter(text) {
    // Check for BOM
    let bom = '';
    if (text.startsWith('\uFEFF')) {
      bom = '\uFEFF';
      text = text.slice(1);
    }
    
    // Look for opening delimiter - must be ---\n or ---\r\n at start
    const hasOpening = text.startsWith('---\n') || text.startsWith('---\r\n');
    if (!hasOpening) {
      return { bom, frontmatter: null, body: text };
    }
    
    // Find where content starts after the opening delimiter 
    let contentStartPos;
    if (text.startsWith('---\n')) {
      contentStartPos = 4; // position after '---\n'
    } else { // starts with '---\r\n'
      contentStartPos = 5; // position after '---\r\n'
    }
    
    // Find the first line that is exactly "---" or "..." (not a partial match)
    let closeLineEnd = -1;
    
    // Scan for closing delimiter starting from contentStartPos
    const textLen = text.length;
    let pos = contentStartPos;
    
    while (pos < textLen) {
      // Find end of current line  
      let lineEnd = pos;
      while (lineEnd < textLen && text[lineEnd] !== '\n' && text[lineEnd] !== '\r') {
        lineEnd++;
      }
      
      // Get the content of this line, removing trailing \r if present
      const lineContent = text.substring(pos, 
        text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd);
        
      // Check if it's a valid closing delimiter
      if (lineContent === '---' || lineContent === '...') {
        closeLineEnd = lineEnd;
        break;
      }
      
      // Move to next line 
      pos = lineEnd + 1;  
    }
    
    // If no closing delimiter found, return null frontmatter
    if (closeLineEnd === -1) {
      return { bom, frontmatter: null, body: text };
    }
    
    // Include the newline after the closing delimiter
    if (text[closeLineEnd] === '\r' && text[closeLineEnd + 1] === '\n') {
      closeLineEnd += 2; // Skip \r\n 
    } else if (text[closeLineEnd] === '\n') {
      closeLineEnd++;   // Skip \n
    }
    
    // Frontmatter is from start to end of closing line (inclusive)
    const frontmatter = text.substring(0, closeLineEnd);
    
    // Body is everything after the closing line 
    const body = text.substring(closeLineEnd);
    
    return { bom, frontmatter, body };
  }
  
  function joinFrontmatter(parts) {
    return parts.bom + (parts.frontmatter || '') + parts.body;
  }
  
  const api = {
    splitFrontmatter,
    joinFrontmatter
  };
  
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_MarkdownFrontmatter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);