'use strict';

(function (root) {
  // Merge chapter order arrays, handling additions and removals from both sides
  function mergeOrder(base, local, remote) {
    // Start with the remote order as base
    const result = [...remote];
    
    // Remove items that were removed locally but not remotely
    for (const id of base) {
      if (!local.includes(id) && remote.includes(id)) {
        const index = result.indexOf(id);
        if (index !== -1) {
          result.splice(index, 1);
        }
      }
    }
    
    // Add items that were added locally but not in base
    for (const id of local) {
      if (!base.includes(id) && !result.includes(id)) {
        // Find the nearest preceding id that exists in result
        let insertIndex = 0;
        for (let i = 0; i < local.length; i++) {
          if (local[i] === id) break;
          const prevId = local[i];
          const prevIndex = result.indexOf(prevId);
          if (prevIndex !== -1 && prevIndex >= insertIndex) {
            insertIndex = prevIndex + 1;
          }
        }
        
        // Insert at the found position, or at the beginning
        result.splice(insertIndex, 0, id);
      }
    }
    
    return result;
  }

  // Merge book metadata with conflict resolution
  function mergeBookMeta(base, local, remote) {
    const meta = {};
    const conflicts = [];
    
    // Handle chapterOrder specifically
    meta.chapterOrder = mergeOrder(base.chapterOrder, local.chapterOrder, remote.chapterOrder);
    
    // For other fields, check if they've changed on both sides
    for (const key of Object.keys({ ...base, ...local, ...remote })) {
      if (key === 'chapterOrder') continue;
      
      const baseVal = base[key];
      const localVal = local[key];
      const remoteVal = remote[key];
      
      // If local equals base and remote differs from base, take remote
      if (JSON.stringify(localVal) === JSON.stringify(baseVal) && 
          JSON.stringify(remoteVal) !== JSON.stringify(baseVal)) {
        meta[key] = remoteVal;
      }
      // If remote equals base and local differs from base, take local
      else if (JSON.stringify(remoteVal) === JSON.stringify(baseVal) &&
               JSON.stringify(localVal) !== JSON.stringify(baseVal)) {
        meta[key] = localVal;
      }
      // If local equals remote, take that value
      else if (JSON.stringify(localVal) === JSON.stringify(remoteVal)) {
        meta[key] = localVal;
      }
      // Otherwise conflict - take local and record the conflict
      else {
        meta[key] = localVal;
        conflicts.push({ field: key, local: localVal, remote: remoteVal });
      }
    }
    
    // Handle modified timestamp (later of local and remote)
    const localModified = new Date(local.modified || 0);
    const remoteModified = new Date(remote.modified || 0);
    meta.modified = localModified > remoteModified ? 
                    local.modified : 
                    remote.modified;
    
    // Handle revision
    const localRev = typeof local.revision === 'number' ? local.revision : 0;
    const remoteRev = typeof remote.revision === 'number' ? remote.revision : 0;
    meta.revision = Math.max(localRev, remoteRev) + 1;
    
    return { meta, conflicts };
  }

  const api = { mergeOrder, mergeBookMeta };

  if (typeof module === 'object' && module.exports) 
    {module.exports = api;}
  else 
    {root.NeoCraft_MetaMerge = api;}

})(typeof globalThis !== 'undefined' ? globalThis : this);