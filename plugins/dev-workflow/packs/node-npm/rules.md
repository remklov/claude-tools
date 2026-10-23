## NPM-WORKSPACE-IMPORTS — Workspace imports
<!-- rule: severity=blocking; scope=paths:**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts} -->
Import only packages listed in the importing workspace's own `package.json`, even if another package is resolvable from `node_modules`.

## NPM-CI — Reproducible installs
<!-- rule: severity=blocking; scope=paths:**/Dockerfile*|**/*compose*.y*ml|.github/workflows/**|**/.gitlab-ci.yml|**/Makefile|**/*.sh -->
npm dependencies are pinned by `package-lock.json` and installed with `npm ci` in builds and CI, never with `npm install`.
