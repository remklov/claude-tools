// Suggests checks per package dir from package.json scripts. Input: CW_PACKAGE_DIRS (JSON array).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.CW_REPO_ROOT;
const dirs = JSON.parse(process.env.CW_PACKAGE_DIRS ?? '["."]');
const out = {};
for (const dir of dirs) {
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    continue;
  }
  const checks = {};
  const typecheck = ['typecheck', 'type-check'].find((name) => scripts[name]);
  if (typecheck) checks.typecheck = `npm run ${typecheck}`;
  if (scripts.lint) checks.lint = 'npm run lint';
  if (scripts.test && !/no test specified/.test(scripts.test)) checks.test = scripts['test:coverage'] && !scripts.lint ? 'npm run test:coverage' : 'npm test';
  if (Object.keys(checks).length) out[dir] = checks;
}
console.log(JSON.stringify(out));
