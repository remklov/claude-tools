// Flags unpinned images in changed Dockerfiles and compose files. Usage: cw run docker:image-pins --base <sha>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const flag = process.argv.indexOf('--base');
const base = (flag !== -1 && process.argv[flag + 1]) || process.env.CW_BASE;
const root = process.env.CW_REPO_ROOT ?? process.cwd();
const files = base
  ? execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => /(Dockerfile|compose[^/]*\.ya?ml)$/.test(f))
  : process.argv.slice(2).filter((a) => !a.startsWith('--'));
const isPinned = (image) => /@sha256:/.test(image) || /:(\d+\.\d+(\.\d+)?)[\w.-]*$/.test(image);
const hits = [];
for (const file of files) {
  let text;
  try { text = readFileSync(`${root}/${file}`, 'utf8'); } catch { continue; }
  for (const [i, line] of text.split('\n').entries()) {
    const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(line) ?? /^\s*image:\s*["']?([^\s"']+)/.exec(line);
    if (!m || /^\$|^scratch$/.test(m[1]) || /\bAS\b/i.test(m[1])) continue;
    if (!isPinned(m[1])) hits.push(`${file}:${i + 1}: ${m[1]}`);
  }
}
if (hits.length) { console.log(`unpinned images (DOCKER-PIN):\n${hits.join('\n')}`); process.exit(1); }
