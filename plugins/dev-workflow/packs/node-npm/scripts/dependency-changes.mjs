// Lists dependency changes between the base and HEAD: the dependency blocks of every package.json
// (also one that is new or deleted since the base) and changed npm lockfiles (CORE-DEPENDENCIES).
// Usage: cw run node-npm:dependency-changes [--task <id>] [-- --base <sha>]; the base defaults to CW_BASE.
// Exit 0 no changes · 1 changes (listed on stdout) · 2 usage.
import { execFileSync } from 'node:child_process';

const BLOCKS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const LOCKFILE = /(^|\/)(package-lock|npm-shrinkwrap)\.json$/;

const workTree = process.env.CW_WORK_TREE || process.cwd();
const git = (args) => execFileSync('git', args, { cwd: workTree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

// The parsed file at rev; {} when it does not exist there, null when it is not valid JSON.
function manifestAt(rev, file) {
  let text;
  try {
    text = git(['show', `${rev}:${file}`]);
  } catch {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function main() {
  const flag = process.argv.indexOf('--base');
  const base = (flag !== -1 && process.argv[flag + 1]) || process.env.CW_BASE;
  if (!base) {
    console.error('usage: dependency-changes --base <sha> (or run it with cw run --task <id>, which passes the task base)');
    return 2;
  }
  let files;
  try {
    files = git(['diff', '--name-only', '-z', `${base}...HEAD`]).split('\0').filter(Boolean);
  } catch (error) {
    console.error(`dependency-changes: git diff ${base}...HEAD failed in ${workTree}: ${String(error.stderr ?? error.message).trim()}`);
    return 2;
  }
  const findings = files.filter((file) => LOCKFILE.test(file)).map((file) => `${file} changed`);
  for (const file of files.filter((name) => /(^|\/)package\.json$/.test(name))) {
    const before = manifestAt(base, file);
    const after = manifestAt('HEAD', file);
    if (before === null || after === null) {
      findings.push(`${file}: not valid JSON at ${before === null ? 'the base' : 'HEAD'}; check its dependencies by hand`);
      continue;
    }
    for (const block of BLOCKS) {
      const old = before[block] ?? {};
      const now = after[block] ?? {};
      for (const name of new Set([...Object.keys(old), ...Object.keys(now)])) {
        if (old[name] !== now[name]) findings.push(`${file} ${block}: ${name} ${old[name] ?? '—'} → ${now[name] ?? '—'}`);
      }
    }
  }
  if (!findings.length) return 0;
  console.log(`dependency changes (CORE-DEPENDENCIES):\n${findings.join('\n')}`);
  return 1;
}

process.exitCode = main();
