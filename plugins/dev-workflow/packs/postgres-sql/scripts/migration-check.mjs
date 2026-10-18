// Checks a migration file: numbering (free on the base) and risky statements for the self-check.
// Usage: cw run postgres-sql:migration-check --file <path> [--base <ref>]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const options = JSON.parse(process.env.CW_PACK_OPTIONS ?? '{}');
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const file = arg('--file');
if (!file) { console.error('usage: migration-check --file <path> [--base <ref>]'); process.exit(2); }
const root = process.env.CW_REPO_ROOT ?? process.cwd();
const base = arg('--base') ?? `origin/${process.env.CW_DEFAULT_BASE ?? 'main'}`;
const sql = readFileSync(join(root, file), 'utf8').replace(/--.*$/gm, '');
const errors = [];
const number = /^(\d+)_/.exec(basename(file))?.[1];
if (!number) errors.push(`${basename(file)} does not follow ${options.pattern}`);
try {
  const onBase = execFileSync('git', ['ls-tree', '--name-only', `${base}:${options.dir}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
  const clash = onBase.find((name) => name.startsWith(`${number}_`) && name !== basename(file));
  if (clash) errors.push(`number ${number} is already used on ${base} by ${clash}`);
} catch { /* base without the directory */ }
const risks = [];
const statements = sql.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
for (const s of statements) {
  if (/\bDROP\s+(COLUMN|TABLE)\b/i.test(s)) risks.push(`drop: ${s.slice(0, 120)} → only after all code references are gone and deployed (two phases)`);
  if (/\bRENAME\s+(COLUMN|TO)\b/i.test(s)) risks.push(`rename: ${s.slice(0, 120)} → add the new name first, drop the old one later`);
  if (/\bALTER\s+COLUMN\b.*\bTYPE\b/i.test(s)) risks.push(`type change: ${s.slice(0, 120)} → new column + backfill + cut-over instead`);
  if (/\bSET\s+NOT\s+NULL\b/i.test(s)) risks.push(`NOT NULL on an existing column: ${s.slice(0, 120)} → needs a default or prior backfill`);
  if (/\bADD\s+COLUMN\b(?!.*\bDEFAULT\b).*\bNOT\s+NULL\b/i.test(s)) risks.push(`NOT NULL column without default: ${s.slice(0, 120)}`);
}
console.log(`Migration ${file}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log('\nSelf-check (answer each in the report):');
console.log('1. Can the previous version SELECT from all affected tables?');
console.log('2. Can the previous version INSERT without supplying the new columns?');
console.log('3. Is anything dropped that current code still references?');
console.log(risks.length ? `\nStatements that need an explicit answer:\n- ${risks.join('\n- ')}` : '\nNo risky statements found.');
process.exit(errors.length ? 1 : 0);
