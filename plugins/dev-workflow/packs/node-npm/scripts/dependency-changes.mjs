// Lists dependency changes in the diff (dependency blocks of package.json and lockfiles).
// Usage: cw run node-npm:dependency-changes --base <sha>
import { execFileSync } from 'node:child_process';
const flag = process.argv.indexOf('--base');
const base = (flag !== -1 && process.argv[flag + 1]) || process.env.CW_BASE;
if (!base) {
  console.error('usage: dependency-changes --base <sha>');
  process.exit(2);
}
const git = (args) => execFileSync('git', args, { encoding: 'utf8' });
const files = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
const findings = files.filter((f) => /(^|\/)package-lock\.json$/.test(f)).map((f) => `${f} changed`);
for (const file of files.filter((f) => /(^|\/)package\.json$/.test(f))) {
  const before = JSON.parse(git(['show', `${base}:${file}`]) || '{}');
  const after = JSON.parse(git(['show', `HEAD:${file}`]) || '{}');
  for (const block of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const a = before[block] ?? {};
    const b = after[block] ?? {};
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[name] !== b[name]) findings.push(`${file} ${block}: ${name} ${a[name] ?? '—'} → ${b[name] ?? '—'}`);
    }
  }
}
if (findings.length) {
  console.log(`dependency changes (NPM-DEPS):\n${findings.join('\n')}`);
  process.exit(1);
}
