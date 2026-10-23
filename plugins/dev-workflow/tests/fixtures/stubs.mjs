// Stub executables (gh, glab, claude) for tests: each logs its argv as one JSON line and answers from a
// JSON script, so no test reaches a network or a real CLI. Helpers here never end in .test.mjs.
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { which } from '../../cli/lib/proc.mjs';

// CommonJS without an extension: the temp dirs have no package.json that would make it ESM.
const SOURCE = `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const argv = process.argv.slice(2);
appendFileSync(__filename + '.log', JSON.stringify(argv) + '\\n');
const script = JSON.parse(readFileSync(__filename + '.script.json', 'utf8'));
const answer = script.find((entry) => (entry.args ?? []).every((arg, i) => argv[i] === arg)) ?? {};
if (answer.stdout) process.stdout.write(typeof answer.stdout === 'string' ? answer.stdout : JSON.stringify(answer.stdout));
if (answer.stderr) process.stderr.write(answer.stderr);
process.exitCode = answer.exit ?? 0;
`;

// Writes <dir>/<name>. script: [{ args: [prefix of argv], stdout?: string | JSON value, stderr?, exit? }];
// the first entry whose args prefix argv answers; no match prints nothing and exits 0.
export function stubCli(dir, name, script = []) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(`${path}.script.json`, JSON.stringify(script));
  writeFileSync(path, SOURCE, { mode: 0o755 });
  return {
    path,
    calls: () => (existsSync(`${path}.log`) ? readFileSync(`${path}.log`, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []),
  };
}

// The stub dir of a hermetic fixture env (tests/fixtures/repo.mjs puts <base>/stubs first on PATH).
export const stubDir = (base) => join(base, 'stubs');

// A PATH with the stub dir and only git and node, so a missing gh or glab is really missing.
export function minimalPath(base) {
  const bin = join(base, 'min-bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['git', 'node']) {
    const target = name === 'node' ? process.execPath : which(name);
    if (target && !existsSync(join(bin, name))) symlinkSync(target, join(bin, name));
  }
  return `${stubDir(base)}:${bin}`;
}
