---
pack: node-npm
---

## NPM-DEPS — Dependencies
<!-- rule: severity=blocking; scope=all -->
Don't change dependencies in any `package.json` or `package-lock.json`; if a task needs one, stop and report it (status `blocked`). Import only packages listed in the importing workspace's own `package.json`, even if another package is resolvable from `node_modules`.

## NPM-CI — Reproducible installs
<!-- rule: severity=blocking; scope=paths:**/Dockerfile*|.github/workflows/**|**/Makefile|**/*.sh -->
npm dependencies are pinned by `package-lock.json` and installed with `npm ci` in builds and CI, never with `npm install`.
