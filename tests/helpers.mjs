import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'evals/fixtures');

/** Copy a fixture into a fresh temp git repo so file listing behaves like a real project. */
export function fixtureRepo(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lunar-${name}-`));
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

export function tempDir(prefix = 'lunar-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
