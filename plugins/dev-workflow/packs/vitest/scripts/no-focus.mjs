// Finds focused, skipped or todo tests in the lines added between the base and HEAD (VITEST-NO-FOCUS).
// Usage: cw run vitest:no-focus [--task <id>] [-- --base <sha>]; the base defaults to CW_BASE.
// Exit 0 none · 1 hits (listed on stdout) · 2 usage.
import { execFileSync } from 'node:child_process';

// it.only(, describe.skip(, test.todo(, and chained forms such as it.only.each( or it.concurrent.only(.
const FOCUS = /\b(?:it|test|describe|suite)(?:\.\w+)*\.(?:only|skip|todo)\b/;

const workTree = process.env.CW_WORK_TREE || process.cwd();

// A path from a "+++ " header: git ends a name with a space with a tab and C-quotes names with
// quotes, backslashes or control characters (observed with git 2.54; core.quotePath=false keeps
// other names raw).
function headerPath(text) {
  const name = text.replace(/\t$/, '');
  if (!name.startsWith('"')) return name;
  try {
    return JSON.parse(name);
  } catch {
    return name;
  }
}

function main() {
  const flag = process.argv.indexOf('--base');
  const base = (flag !== -1 && process.argv[flag + 1]) || process.env.CW_BASE;
  if (!base) {
    console.error('usage: no-focus --base <sha> (or run it with cw run --task <id>, which passes the task base)');
    return 2;
  }
  let diff;
  try {
    // An explicit --no-prefix, so header paths do not depend on the user's diff.noprefix setting.
    diff = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-prefix', `${base}...HEAD`, '--', '*.test.*', '*.spec.*'], {
      cwd: workTree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    console.error(`no-focus: git diff ${base}...HEAD failed in ${workTree}: ${String(error.stderr ?? error.message).trim()}`);
    return 2;
  }
  const hits = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = headerPath(line.slice(4));
    else if (line.startsWith('+') && FOCUS.test(line)) hits.push(`${file}: ${line.slice(1).trim()}`);
  }
  if (!hits.length) return 0;
  console.log(`focused/skipped tests (VITEST-NO-FOCUS):\n${hits.join('\n')}`);
  return 1;
}

process.exitCode = main();
