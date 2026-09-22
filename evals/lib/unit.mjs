// Run the node:test suite programmatically and collect per-test results for the report.
import fs from 'node:fs';
import path from 'node:path';
import { run } from 'node:test';

export async function runUnit(root) {
  const dir = path.join(root, 'tests');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(dir, f));
  const tests = [];
  const stream = run({ files, concurrency: true });
  for await (const ev of stream) {
    if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
    const d = ev.data;
    if (d.details?.type === 'suite' || d.nesting > 0) continue;
    const err = d.details?.error;
    tests.push({
      name: d.name,
      file: path.relative(root, d.file || ''),
      status: ev.type === 'test:pass' ? (d.skip ? 'skip' : 'pass') : 'fail',
      durationMs: Math.round(d.details?.duration_ms || 0),
      error: err ? String(err.cause?.message || err.message || err).slice(0, 1500) : null,
    });
  }
  // A file that fails to load reports a single test named after the file.
  return {
    pass: tests.filter((t) => t.status === 'pass').length,
    fail: tests.filter((t) => t.status === 'fail').length,
    skip: tests.filter((t) => t.status === 'skip').length,
    tests,
  };
}
