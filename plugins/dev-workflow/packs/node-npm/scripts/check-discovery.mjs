// Suggests checks per package directory from its package.json scripts; cw init takes the packages'
// checks from it (§8). Usage: cw run node-npm:check-discovery. Input: CW_WORK_TREE and
// CW_PACKAGE_DIRS (a JSON array of directories relative to the work tree, default ["."]). Prints one
// JSON object { "<dir>": { "test"?, "typecheck"?, "lint"? } }, checks in the §5 order; directories
// without package.json or checks are left out.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function main() {
  const workTree = process.env.CW_WORK_TREE || process.cwd();
  let dirs;
  try {
    dirs = JSON.parse(process.env.CW_PACKAGE_DIRS || '["."]');
  } catch {
    dirs = null;
  }
  if (!Array.isArray(dirs)) {
    console.error('check-discovery: CW_PACKAGE_DIRS must be a JSON array of directories, e.g. [".", "packages/api"]');
    return 2;
  }
  const found = {};
  for (const dir of dirs) {
    let scripts;
    try {
      scripts = JSON.parse(readFileSync(join(workTree, dir, 'package.json'), 'utf8')).scripts ?? {};
    } catch {
      continue;
    }
    const checks = {};
    if (scripts.test && !/no test specified/.test(scripts.test)) checks.test = 'npm test';
    const typecheck = ['typecheck', 'type-check'].find((name) => scripts[name]);
    if (typecheck) checks.typecheck = `npm run ${typecheck}`;
    if (scripts.lint) checks.lint = 'npm run lint';
    if (Object.keys(checks).length) found[dir] = checks;
  }
  console.log(JSON.stringify(found));
  return 0;
}

process.exitCode = main();
