// Prints the next free migration file name. Usage: cw run postgres-sql:next-number --slug <slug>
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const options = JSON.parse(process.env.CW_PACK_OPTIONS ?? '{}');
const flag = process.argv.indexOf('--slug');
const slug = flag !== -1 ? process.argv[flag + 1] : null;
if (!slug || !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(slug)) {
  console.error('usage: next-number --slug <words_with_underscores>');
  process.exit(2);
}
const root = process.env.CW_REPO_ROOT ?? process.cwd();
const numbers = new Set();
const collect = (names) => names.forEach((name) => { const m = /^(\d+)_/.exec(name); if (m) numbers.add(Number(m[1])); });
try { collect(readdirSync(join(root, options.dir))); } catch { /* new directory */ }
for (const ref of [process.env.CW_BASE, `origin/${process.env.CW_DEFAULT_BASE ?? 'main'}`].filter(Boolean)) {
  try { collect(execFileSync('git', ['ls-tree', '--name-only', `${ref}:${options.dir}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')); } catch { /* ref missing */ }
}
const width = Math.max(3, ...[...numbers].map((n) => String(n).length));
const next = String((numbers.size ? Math.max(...numbers) : 0) + 1).padStart(width, '0');
console.log(`${options.dir}/${next}_${slug}.sql`);
