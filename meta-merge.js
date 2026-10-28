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
    for (let i = 0; i < local.length; i++) {
      const id = local[i];
      if (!base.includes(id) && !result.includes(id)) {
        // Walk local backwards from the added id to find the nearest preceding id that exists in result
        let insertIndex = 0;
        for (let j = i - 1; j >= 0; j--) {
          const prevId = local[j];
          const prevIndex = result.indexOf(prevId);
          if (prevIndex !== -1) {
            insertIndex = prevIndex + 1;
            break;
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
      if (key === 'chapterOrder' || key === 'modified' || key === 'revision') continue;
      
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

  // Clone helper to avoid mutating or referencing frozen/original objects
  function cloneVal(v) {
    return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }

  // Check if two shelf objects are equal
  function shelfEqual(s1, s2) {
    if (s1 === s2) return true;
    if (!s1 || !s2) return false;
    if (s1.id !== s2.id || s1.name !== s2.name) return false;
    const b1 = s1.bookIds || [];
    const b2 = s2.bookIds || [];
    if (b1.length !== b2.length) return false;
    for (let i = 0; i < b1.length; i++) {
      if (b1[i] !== b2[i]) return false;
    }
    const k1 = Object.keys(s1).filter((k) => k !== 'id' && k !== 'name' && k !== 'bookIds');
    const k2 = Object.keys(s2).filter((k) => k !== 'id' && k !== 'name' && k !== 'bookIds');
    if (k1.length !== k2.length) return false;
    for (const k of k1) {
      if (JSON.stringify(s1[k]) !== JSON.stringify(s2[k])) return false;
    }
    return true;
  }

  // Merge library metadata with conflict resolution
  function mergeLibrary(base, local, remote) {
    base = base || {};
    local = local || {};
    remote = remote || {};

    const library = {};
    const conflicts = [];

    // Scalar rule for every other field (authorName, pageTheme, unknown fields)
    for (const key of Object.keys({ ...base, ...local, ...remote })) {
      if (key === 'shelves' || key === 'penNames' || key === 'firstRunDone') continue;

      const baseVal = base[key];
      const localVal = local[key];
      const remoteVal = remote[key];

      // If local equals base and remote differs from base, take remote
      if (JSON.stringify(localVal) === JSON.stringify(baseVal) &&
          JSON.stringify(remoteVal) !== JSON.stringify(baseVal)) {
        if (remoteVal !== undefined) library[key] = cloneVal(remoteVal);
      }
      // If remote equals base and local differs from base, take local
      else if (JSON.stringify(remoteVal) === JSON.stringify(baseVal) &&
               JSON.stringify(localVal) !== JSON.stringify(baseVal)) {
        if (localVal !== undefined) library[key] = cloneVal(localVal);
      }
      // If local equals remote, take that value
      else if (JSON.stringify(localVal) === JSON.stringify(remoteVal)) {
        if (localVal !== undefined) library[key] = cloneVal(localVal);
      }
      // Otherwise conflict - take local and record the conflict
      else {
        if (localVal !== undefined) library[key] = cloneVal(localVal);
        conflicts.push({ field: key, local: localVal, remote: remoteVal });
      }
    }

    // penNames via mergeOrder
    library.penNames = mergeOrder(
      base.penNames || [],
      local.penNames || [],
      remote.penNames || []
    );

    // firstRunDone = local OR remote
    library.firstRunDone = Boolean(local.firstRunDone || remote.firstRunDone);

    // Shelves merge
    const baseShelves = base.shelves || [];
    const localShelves = local.shelves || [];
    const remoteShelves = remote.shelves || [];

    const baseMap = new Map();
    for (const s of baseShelves) baseMap.set(s.id, s);

    const localMap = new Map();
    for (const s of localShelves) localMap.set(s.id, s);

    const remoteMap = new Map();
    for (const s of remoteShelves) remoteMap.set(s.id, s);

    const allShelfIds = new Set();
    for (const s of baseShelves) allShelfIds.add(s.id);
    for (const s of localShelves) allShelfIds.add(s.id);
    for (const s of remoteShelves) allShelfIds.add(s.id);

    const keptShelves = new Map();
    const resurrectedIds = new Set();
    const shelfConflicts = [];

    for (const id of allShelfIds) {
      const inBase = baseMap.has(id);
      const inLocal = localMap.has(id);
      const inRemote = remoteMap.has(id);

      const baseShelf = baseMap.get(id);
      const localShelf = localMap.get(id);
      const remoteShelf = remoteMap.get(id);

      if (inLocal && inRemote) {
        // Shelf present on both sides
        const bookIds = mergeOrder(
          (baseShelf && baseShelf.bookIds) || [],
          localShelf.bookIds || [],
          remoteShelf.bookIds || []
        );

        let name;
        const baseName = baseShelf ? baseShelf.name : undefined;
        const localName = localShelf.name;
        const remoteName = remoteShelf.name;

        if (JSON.stringify(localName) === JSON.stringify(baseName) &&
            JSON.stringify(remoteName) !== JSON.stringify(baseName)) {
          name = remoteName;
        } else if (JSON.stringify(remoteName) === JSON.stringify(baseName) &&
                   JSON.stringify(localName) !== JSON.stringify(baseName)) {
          name = localName;
        } else if (JSON.stringify(localName) === JSON.stringify(remoteName)) {
          name = localName;
        } else {
          name = localName;
          shelfConflicts.push({ field: `shelves.${id}.name`, local: localName, remote: remoteName });
        }

        const mergedShelf = { id, name, bookIds };

        // Handle any other properties on shelf via scalar rule
        const otherKeys = new Set([
          ...Object.keys(baseShelf || {}),
          ...Object.keys(localShelf || {}),
          ...Object.keys(remoteShelf || {})
        ]);
        for (const k of otherKeys) {
          if (k === 'id' || k === 'name' || k === 'bookIds') continue;
          const bVal = baseShelf ? baseShelf[k] : undefined;
          const lVal = localShelf[k];
          const rVal = remoteShelf[k];
          if (JSON.stringify(lVal) === JSON.stringify(bVal) && JSON.stringify(rVal) !== JSON.stringify(bVal)) {
            if (rVal !== undefined) mergedShelf[k] = cloneVal(rVal);
          } else if (JSON.stringify(rVal) === JSON.stringify(bVal) && JSON.stringify(lVal) !== JSON.stringify(bVal)) {
            if (lVal !== undefined) mergedShelf[k] = cloneVal(lVal);
          } else if (JSON.stringify(lVal) === JSON.stringify(rVal)) {
            if (lVal !== undefined) mergedShelf[k] = cloneVal(lVal);
          } else {
            if (lVal !== undefined) mergedShelf[k] = cloneVal(lVal);
            shelfConflicts.push({ field: `shelves.${id}.${k}`, local: lVal, remote: rVal });
          }
        }

        keptShelves.set(id, mergedShelf);
      } else if (!inBase && inLocal && !inRemote) {
        // Shelf added locally
        keptShelves.set(id, cloneVal(localShelf));
      } else if (!inBase && !inLocal && inRemote) {
        // Shelf added remotely
        keptShelves.set(id, cloneVal(remoteShelf));
      } else if (inBase && !inLocal && inRemote) {
        // Deleted locally, present remotely
        if (!shelfEqual(baseShelf, remoteShelf)) {
          // Changed remotely: keep and report conflict
          keptShelves.set(id, cloneVal(remoteShelf));
          resurrectedIds.add(id);
          shelfConflicts.push({ field: `shelves.${id}`, local: undefined, remote: remoteShelf });
        }
      } else if (inBase && inLocal && !inRemote) {
        // Present locally, deleted remotely
        if (!shelfEqual(baseShelf, localShelf)) {
          // Changed locally: keep and report conflict
          keptShelves.set(id, cloneVal(localShelf));
          resurrectedIds.add(id);
          shelfConflicts.push({ field: `shelves.${id}`, local: localShelf, remote: undefined });
        }
      }
    }

    const baseShelfIds = baseShelves.map((s) => s.id);
    const localShelfIds = localShelves.map((s) => s.id);
    const remoteShelfIds = remoteShelves.map((s) => s.id);

    // Merge shelf order with mergeOrder.
    // Shelves that were deleted on one side but kept due to changes on the other
    // are excluded from the base list so mergeOrder will not delete them.
    const orderBaseIds = baseShelfIds.filter((id) => !resurrectedIds.has(id));
    const mergedShelfOrder = mergeOrder(orderBaseIds, localShelfIds, remoteShelfIds);

    const orderedShelves = [];
    const placed = new Set();
    for (const id of mergedShelfOrder) {
      if (keptShelves.has(id)) {
        orderedShelves.push(keptShelves.get(id));
        placed.add(id);
      }
    }
    for (const [id, shelf] of keptShelves) {
      if (!placed.has(id)) {
        orderedShelves.push(shelf);
      }
    }

    library.shelves = orderedShelves;
    conflicts.push(...shelfConflicts);

    return { library, conflicts };
  }

  const api = { mergeOrder, mergeBookMeta, mergeLibrary };

  if (typeof module === 'object' && module.exports) 
    {module.exports = api;}
  else 
    {root.NeoCraft_MetaMerge = api;}

})(typeof globalThis !== 'undefined' ? globalThis : this);
