'use strict';

(function (root) {
  // Normalize a path by:
  // - making it start with '/'
  // - collapsing repeated '/' characters
  // - dropping trailing '/' except for the root '/'
  // Returns null if any segment is '.' or '..'
  function normalizePath(p) {
    if (!p) return null;
    
    // Ensure path starts with '/'
    let normalized = p.startsWith('/') ? p : '/' + p;
    
    // Split by '/' and filter out empty segments
    const segments = normalized.split('/').filter(seg => seg !== '');
    
    // Check for invalid segments ('.' or '..')
    if (segments.some(seg => seg === '.' || seg === '..')) {
      return null;
    }
    
    // Reconstruct path
    return segments.length > 0 ? '/' + segments.join('/') : '/';
  }

  // Check if a normalized path is inside any excluded folder
  function isExcludedPath(path, excluded) {
    const normalized = normalizePath(path);
    
    // If normalization fails, fail closed (return true)
    if (!normalized) return true;
    
    // Filter out empty or invalid entries and check each one
    for (const exclude of excluded) {
      if (!exclude || typeof exclude !== 'string') continue; // Skip invalid entries
      
      const normalizedExclude = normalizePath(exclude);
      
      // If the exclusion path can't be normalized, skip it
      if (!normalizedExclude) continue;
      
      // Special case: root path "/" covers everything
      if (normalizedExclude === '/') {
        return true;
      }
      
      // Check exact match or prefix match with segment boundary
      if (normalized === normalizedExclude || 
          normalized.startsWith(normalizedExclude + '/')) {
        return true;
      }
    }
    
    return false;
  }

  const api = { normalizePath, isExcludedPath };
  
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_Excluded = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);