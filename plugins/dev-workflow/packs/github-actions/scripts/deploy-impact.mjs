// Lists the workflows a merge of the diff into the default branch triggers.
// Usage: cw run github-actions:deploy-impact --task <id> (or --base <sha>)
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const libUrl = (name) => pathToFileURL(join(new URL('../../../scripts/lib/', import.meta.url).pathname, name)).href;
const { parseYaml } = await import(libUrl('yaml-lite.mjs'));
const { matchAny } = await import(libUrl('glob.mjs'));
const root = process.env.CW_REPO_ROOT ?? process.cwd();
const flag = process.argv.indexOf('--base');
const base = (flag !== -1 && process.argv[flag + 1]) || process.env.CW_BASE;
const defaultBase = process.env.CW_DEFAULT_BASE ?? 'main';
if (!base) { console.error('usage: deploy-impact --base <sha> (or --task)'); process.exit(2); }
const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const dir = join(root, '.github', 'workflows');
const workflows = [];
for (const name of existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : []) {
  const doc = parseYaml(readFileSync(join(dir, name), 'utf8'));
  const on = doc.on ?? doc.true ?? {};
  const push = typeof on === 'string' ? (on === 'push' ? {} : null) : Array.isArray(on) ? (on.includes('push') ? {} : null) : on.push === undefined ? null : on.push ?? {};
  if (!push) continue;
  const branches = push.branches ? [].concat(push.branches) : null;
  if (branches && !branches.some((b) => b === defaultBase || matchAny(defaultBase, [b]))) continue;
  const paths = push.paths ? [].concat(push.paths) : null;
  const ignore = push['paths-ignore'] ? [].concat(push['paths-ignore']) : [];
  const hits = files.filter((f) => (!paths || matchAny(f, paths)) && !matchAny(f, ignore));
  if (hits.length) workflows.push({ file: `.github/workflows/${name}`, name: doc.name ?? name, reason: paths ? `paths ${hits.slice(0, 3).join(', ')}` : 'every push' });
}
const result = { workflows };
if (process.env.CW_TASK_DIR) writeFileSync(join(process.env.CW_TASK_DIR, 'deploy-impact.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(workflows.length ? `A merge into ${defaultBase} triggers:\n${workflows.map((w) => `- ${w.file} (${w.name}): ${w.reason}`).join('\n')}` : `A merge into ${defaultBase} triggers no workflow.`);
