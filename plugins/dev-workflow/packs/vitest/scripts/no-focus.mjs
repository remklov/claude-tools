// Finds focused, skipped or todo tests in lines added since the base. Usage: cw run vitest:no-focus --base <sha>
import { execFileSync } from 'node:child_process';
const flag = process.argv.indexOf('--base');
const base = (flag !== -1 && process.argv[flag + 1]) || process.env.CW_BASE;
if (!base) {
  console.error('usage: no-focus --base <sha>');
  process.exit(2);
}
const diff = execFileSync('git', ['diff', '-U0', `${base}...HEAD`, '--', '*.test.*', '*.spec.*'], { encoding: 'utf8' });
const hits = [];
let file = '';
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) file = line.slice(6);
  else if (line.startsWith('+') && /\b(it|test|describe)\.(only|skip|todo)\s*\(/.test(line)) hits.push(`${file}: ${line.slice(1).trim()}`);
}
if (hits.length) {
  console.log(`focused/skipped tests (VITEST-NO-FOCUS):\n${hits.join('\n')}`);
  process.exit(1);
}
