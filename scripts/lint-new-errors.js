'use strict';

// oxlint is strict about the whole tree, and main already carries a set of
// errors (scripts/lint-baseline.txt). A pull request should fail only for the
// errors it adds, so this compares the current diagnostics with that baseline.
// Line and column numbers are left out of the baseline, so moving code around
// does not look like a new error. Run with --update to rewrite the baseline.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const baselineFile = path.join(__dirname, 'lint-baseline.txt');

function oxlintErrors() {
  const run = spawnSync(process.execPath, [path.join(root, 'node_modules', 'oxlint', 'bin', 'oxlint'), '--format=json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (run.error) throw run.error;
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    process.stderr.write(run.stderr || run.stdout || 'oxlint produced no JSON\n');
    process.exit(2);
  }
  return (report.diagnostics || []).filter((d) => d.severity === 'error');
}

// A stable name for an error: where it is (without the line, which moves),
// which rule, and what it says. Duplicates stay as separate entries.
const key = (d) => `${String(d.filename).replace(/\\/g, '/')}: ${d.code}: ${d.message}`;

const errors = oxlintErrors();
const lines = errors.map(key).sort();

if (process.argv.includes('--update')) {
  fs.writeFileSync(baselineFile, lines.join('\n') + (lines.length ? '\n' : ''));
  console.log(`wrote ${lines.length} known errors to ${path.relative(root, baselineFile)}`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = fs.readFileSync(baselineFile, 'utf8').split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('#'));
} catch {
  console.error(`missing ${path.relative(root, baselineFile)}; run with --update`);
  process.exit(2);
}

const known = new Map();
for (const line of baseline) known.set(line, (known.get(line) || 0) + 1);

const added = [];
for (const d of errors) {
  const name = key(d);
  const left = known.get(name) || 0;
  if (left > 0) known.set(name, left - 1);
  else added.push(d);
}

if (!added.length) {
  console.log(`no new lint errors (${baseline.length} known errors ignored)`);
  process.exit(0);
}

for (const d of added) {
  const span = d.labels && d.labels[0] && d.labels[0].span;
  const where = span ? `${d.filename}:${span.line}:${span.column}` : d.filename;
  console.error(`${where}: error ${d.code}: ${d.message}`);
}
console.error(`\n${added.length} new lint error${added.length === 1 ? '' : 's'} not in scripts/lint-baseline.txt`);
process.exit(1);
