#!/usr/bin/env bash
# Creates a throwaway git repo for the spikes and prints its path.
set -euo pipefail
dir="${1:-${TMPDIR:-/tmp}/dw-fixture}"
rm -rf "$dir"; mkdir -p "$dir"; cd "$dir"
git init -q -b main
cat > package.json <<'J'
{ "name": "dw-fixture", "private": true, "scripts": { "test": "node --test" } }
J
mkdir -p node_modules && echo marker > node_modules/MARKER
printf 'node_modules/\n' > .gitignore
cat > sum.mjs <<'J'
export const sum = (a, b) => a + b;
J
cat > sum.test.mjs <<'J'
import test from 'node:test'; import assert from 'node:assert'; import { sum } from './sum.mjs';
test('adds', () => assert.equal(sum(1, 2), 3));
J
mkdir -p .claude && cat > .claude/settings.json <<'J'
{ "worktree": { "baseRef": "head", "symlinkDirectories": ["node_modules"] }, "permissions": { "deny": ["Agent(model:*)", "Agent(effort:*)"] } }
J
git add -A && git commit -qm init
git switch -qc feature-x && echo "// x" >> sum.mjs && git commit -qam "feature x"
echo "$dir"
