'use strict';

const crypto = require('node:crypto');

// Exported functions
function contentRevision(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const TEMP_ATTEMPTS = 5;

// Create the temp file exclusively (flag wx, O_EXCL): a name that already exists, even
// as a link, is never followed or written through. On a name clash, pick another name.
async function createTemp({ fs, dir, base, bytes, now, random }) {
  for (let i = 0; i < TEMP_ATTEMPTS; i++) {
    const tmpPath = `${dir}/.${base}.neocraft-${now()}-${random()}.tmp`;
    try {
      await fs.writeFile(tmpPath, bytes, { flag: 'wx' });
    } catch (e) {
      if (e.code === 'EEXIST') continue;
      throw e;
    }
    const handle = await fs.open(tmpPath, 'r+');
    await handle.sync();
    await handle.close();
    return tmpPath;
  }
  throw Object.assign(new Error('Could not create a temporary file'), { code: 'EEXIST' });
}

async function atomicReplace({
  fs,
  path,
  bytes,
  expectedRevision,
  now = () => Date.now(),
  random = () => crypto.randomBytes(8).toString('hex')
}) {
  // Step 1: Read the current file and check revision
  let current;
  try {
    current = await fs.readFile(path);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // File doesn't exist, check if expectedRevision is null (allowed for new files)
    if (expectedRevision !== null) {
      throw Object.assign(new Error('File does not exist but expectedRevision is not null'), {
        name: 'RevisionMismatchError',
        currentRevision: null
      });
    }
  }

  // If file exists, check revision
  if (current !== undefined) {
    const currentRevision = contentRevision(current);
    if (currentRevision !== expectedRevision) {
      throw Object.assign(new Error('File has been modified since it was loaded'), {
        name: 'RevisionMismatchError',
        currentRevision
      });
    }
  }

  // Step 2: Write to temporary file
  const dir = require('node:path').dirname(path);
  const base = require('node:path').basename(path);
  // Write bytes to a new temp file, created exclusively, and sync it
  const tmpPath = await createTemp({ fs, dir, base, bytes, now, random });

  // Step 3: Rename temp file to target path
  try {
    await fs.rename(tmpPath, path);
  } catch (e) {
    // If rename fails, leave the tmp file and throw a retryable error
    throw Object.assign(new Error('Failed to save file'), {
      name: 'RetryableSaveError',
      tmp: tmpPath,
      cause: e
    });
  }

  // Step 4: Return the new revision
  return { revision: contentRevision(bytes) };
}

// Module export
if (typeof module === 'object' && module.exports) {
  module.exports = { contentRevision, atomicReplace };
}