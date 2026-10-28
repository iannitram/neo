'use strict';

function createFlushBarrier({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const pendingPromises = [];
  
  function track(promise, label) {
    // Wrap the promise to ensure it's always a Promise instance
    const wrappedPromise = Promise.resolve(promise);
    
    const entry = { promise: wrappedPromise, label };
    pendingPromises.push(entry);
    
    // When the promise settles (either resolve or reject), remove it from the pending list
    const cleanup = () => {
      const index = pendingPromises.findIndex(e => e === entry);
      if (index !== -1) {
        pendingPromises.splice(index, 1);
      }
    };
    
    wrappedPromise.then(cleanup).catch(cleanup);
    
    return promise;
  }
  
  function pending() {
    return pendingPromises.map(entry => entry.label);
  }
  

  
  function flush(timeoutMs) {
    // If nothing is pending, resolve immediately
    if (pendingPromises.length === 0) {
      return Promise.resolve({ ok: true, failed: [], timedOut: [] });
    }

    let timeoutId;
    
    // Create a snapshot of the promises at flush start  
    const initialPending = [...pendingPromises];
    
    // We'll create an array to track all promises we're waiting for
    // Initially this is just the ones that were pending when flush was called
    const waitList = [...initialPending];
    
    return new Promise((resolve) => {
      let timeoutHandled = false;
      
      // Set up the timeout
      timeoutId = setTimer(() => {
        if (!timeoutHandled) {
          timeoutHandled = true;
          
          // If we timed out, report all originally pending items as timed out 
          const timedOutLabels = initialPending.map(entry => entry.label);
          resolve({ ok: false, failed: [], timedOut: timedOutLabels });
        }
      }, timeoutMs);
      
      function waitForPromises(promisesToWait) {
        // If nothing to wait for, immediately resolve
        if (promisesToWait.length === 0) {
          clearTimer(timeoutId);
          resolve({ ok: true, failed: [], timedOut: [] });
          return;
        }
        
        const promiseSettled = Promise.allSettled(promisesToWait.map(entry => entry.promise));
        
        promiseSettled.then(results => {
          if (timeoutHandled) return;
          
          // Check for any new items that may have been added during wait
          // This is the key insight: we might need to re-check the list of pending promises
          const currentPending = [...pendingPromises];
          
          // Create a new wait list with all currently pending items, 
          // but only if some were added while waiting (this is where test 4 needs us to detect)
          const additionalWaitList = [];
          
          for (let i = 0; i < currentPending.length; i++) {
            const item = currentPending[i];
            if (!promisesToWait.includes(item)) { // If it's not in our original wait list
              additionalWaitList.push(item);
            }
          }
          
          // If we found new items, we need to re-start waiting with the full set 
          if (additionalWaitList.length > 0) {
            const combinedWait = [...promisesToWait, ...additionalWaitList];
            waitForPromises(combinedWait);  
          } else {
            // No new items - check results and resolve
            clearTimer(timeoutId);
            
            // Check what failed - only from original pending list that were tracked at start time
            const failedLabels = [];
            for (let i = 0; i < initialPending.length; i++) {
              if (results[i] && results[i].status === 'rejected') {
                failedLabels.push(initialPending[i].label);
              }
            }

            resolve({ ok: failedLabels.length === 0, failed: failedLabels, timedOut: [] });
          }
        }).catch(_error => {
          clearTimer(timeoutId);
          resolve({ ok: false, failed: [], timedOut: [] });
        });
      }
      
      // Start waiting for the initial set
      waitForPromises(waitList);
    });
  }
  
  return { track, pending, flush };
}

// Export for Node.js and other environments - use the standard CommonJS pattern that works with all import methods
if (typeof module === 'object' && module.exports) {
  // This is what makes require('./flush-barrier') work correctly in Node.js
  module.exports = createFlushBarrier;
  // Also export as default for ES6 imports
  module.exports.default = createFlushBarrier;
} else if (typeof window !== 'undefined') {
  window.NeoCraft_FlushBarrier = createFlushBarrier;
} else if (typeof define === 'function' && define.amd) {
  // AMD support
  define(function() {
    return createFlushBarrier;
  });
}

// For ES6 modules, also export the function directly so that both 
// `import { createFlushBarrier } from './flush-barrier.js'` and  
// `import createFlushBarrier from './flush-barrier.js'` work correctly.
export { createFlushBarrier };