'use strict';

// Format adapter contract test kit (test-only, CommonJS).
//
// Every format adapter (txt, markdown, docx, rtf) runs this kit from its own
// test file:  runAdapterContract(test, adapter, fixtures)
//
// ADAPTER CONTRACT
// - adapter.id: non-empty string, e.g. 'txt'. Used to name the checks.
// - adapter.open(bytes: Uint8Array, name: string) -> { model, meta }
//     sync or Promise. Reads a file's bytes into the editor's model.
// - adapter.serialize(model, meta) -> Uint8Array
//     sync or Promise. Writes the model back to bytes.
// - adapter.scan(bytes: Uint8Array, name: string)
//     -> { supported: boolean, unsupported: Array<{ feature: string, count: number }> }
//     sync or Promise. Lists what NEO would lose. `count` is a positive integer.
//     supported must equal (unsupported.length === 0).
//
// FIXTURES
// - Array<{ name: string, bytes: Uint8Array }>. The kit never mutates them.
//
// CHECKS (one test() call each)
// 1. '<id>: adapter has an id and open, serialize, scan functions'
// 2. '<id>: no-edit round trip <fixture>'
//    serialize(...open(bytes)) must equal bytes exactly.
// 3. '<id>: scan <fixture>'
//    scan returns the shape above and supported === (unsupported.length === 0).

function runAdapterContract(test, adapter, fixtures) {
  const id = adapter && adapter.id;
  const label = typeof id === 'string' && id ? id : '(no id)';

  test(`${label}: adapter has an id and open, serialize, scan functions`, () => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('adapter.id must be a non-empty string');
    }
    for (const fn of ['open', 'serialize', 'scan']) {
      if (typeof adapter[fn] !== 'function') {
        throw new Error(`adapter.${fn} must be a function`);
      }
    }
  });

  for (const fixture of fixtures) {
    test(`${label}: no-edit round trip ${fixture.name}`, async () => {
      const opened = await adapter.open(fixture.bytes, fixture.name);
      const out = await adapter.serialize(opened.model, opened.meta);
      if (!(out instanceof Uint8Array)) {
        throw new TypeError('serialize must return a Uint8Array');
      }
      if (Buffer.compare(Buffer.from(out), Buffer.from(fixture.bytes)) !== 0) {
        throw new Error(
          `round trip changed the bytes: ${fixture.bytes.length} in, ${out.length} out`
        );
      }
    });

    test(`${label}: scan ${fixture.name}`, async () => {
      const result = await adapter.scan(fixture.bytes, fixture.name);
      if (!result || typeof result !== 'object') {
        throw new TypeError('scan must return an object');
      }
      if (typeof result.supported !== 'boolean') {
        throw new TypeError('scan.supported must be a boolean');
      }
      if (!Array.isArray(result.unsupported)) {
        throw new TypeError('scan.unsupported must be an array');
      }
      for (const item of result.unsupported) {
        if (!item || typeof item.feature !== 'string') {
          throw new TypeError('each unsupported item needs a string feature');
        }
        if (!Number.isInteger(item.count) || item.count <= 0) {
          throw new TypeError('each unsupported item needs a positive integer count');
        }
      }
      if (result.supported !== (result.unsupported.length === 0)) {
        throw new Error('scan.supported must equal (unsupported.length === 0)');
      }
    });
  }
}

module.exports = { runAdapterContract };
