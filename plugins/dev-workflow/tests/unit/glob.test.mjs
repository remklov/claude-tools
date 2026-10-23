import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { expandBraces, globError, globToRegExp, matchAny, matchGlob, normalizeGlob } from '../../cli/lib/glob.mjs';
import { parseRuleFile, parseScope } from '../../cli/lib/rules.mjs';
import { pluginRoot } from '../fixtures/repo.mjs';

test('glob semantics from the rule scopes', () => {
  const cases = [
    ['**/*.yml', '.github/workflows/x.yml', true],
    ['**/*.yml', 'x.yml', true],
    ['app/**', 'app/src/a.tsx', true],
    ['app/**', 'api/a.ts', false],
    ['**/*.{ts,tsx,mts,cts}', 'a/b.tsx', true],
    ['**/Dockerfile*', 'x/Dockerfile.prod', true],
    ['**/Dockerfile*', 'Dockerfile', true],
    ['**/*compose*.y*ml', 'infra/docker-compose.prod.yml', true],
    ['plan/', 'plan/x.md', true],
    ['**/migrations/[0-9][0-9][0-9]_*.sql', 'api/migrations/001_init.sql', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['src/?.ts', 'src/a.ts', true],
    ['src?a.ts', 'src/a.ts', false],
    ['**/.gitlab-ci.yml', '.gitlab-ci.yml', true],
    ['.github/workflows/**/*', '.github/workflows/ci.yml', true],
    ['app/**/*', 'app/x', true],
    ['app/**/*', 'app/a/b/c.ts', true],
    ['app/**/*', 'application/x', false],
    ['./src/*.ts', 'src/a.ts', true],
    ['src/*.ts', './src/a.ts', true],
    ['[!a]*.md', 'b.md', true],
    ['[!a]*.md', 'a.md', false],
    ['a+b(c).ts', 'a+b(c).ts', true],
  ];
  for (const [pattern, path, expected] of cases) assert.equal(matchGlob(path, pattern), expected, `${pattern} vs ${path}`);
  assert.equal(matchAny('src/a.ts', ['x/**', 'src/*.ts']), true);
  assert.equal(matchAny('src/a.ts', []), false);
  assert.equal(globToRegExp('src/*.ts'), globToRegExp('src/*.ts'), 'cached per pattern');
});

test('brace expansion nests and survives an unclosed first brace', () => {
  assert.deepEqual(expandBraces('{a,{b,c}}/x'), ['a/x', 'b/x', 'c/x']);
  assert.equal(matchGlob('b/x', '{a,{b,c}}/x'), true);
  assert.deepEqual(expandBraces('{x/y/*.{ts,js}'), ['{x/y/*.ts', '{x/y/*.js']);
  assert.equal(matchGlob('{x/y/a.js', '{x/y/*.{ts,js}'), true);
  assert.deepEqual(expandBraces('no-braces'), ['no-braces']);
});

test('globError flags an unclosed "[" only, in words for every glob user', () => {
  // Config and pack complexity paths, procedure when.paths and pack detect globs are matched by cw only.
  assert.equal(globError('photos [2024/**'), 'unclosed "[": escape a literal [ as \\[');
  assert.equal(globError('[0-9]*.sql'), null);
  assert.equal(globError('**/*.{ts,tsx}'), null);
  assert.match(globError('[a]/[b'), /unclosed/);
});

test('a backslash escapes the next character, also inside a class and a brace group', () => {
  // The escape Claude Code documents for a literal [ (code.claude.com/docs/en/memory).
  const cases = [
    ['photos \\[2024\\]/**', 'photos [2024]/a.jpg', true],
    ['photos \\[2024\\]/**', 'photos 2/a.jpg', false],
    ['photos \\[2024/**', 'photos [2024/a.jpg', true],
    ['app/\\[id\\]/**', 'app/[id]/page.tsx', true],
    ['[\\]a]x', ']x', true],
    ['[\\]a]x', 'bx', false],
    ['a\\{b,c\\}', 'a{b,c}', true],
    ['a\\{b,c\\}', 'ab', false],
    ['{a,b\\,c}', 'b,c', true],
    ['a\\*', 'a*', true],
    ['a\\*', 'ab', false],
  ];
  for (const [pattern, path, expected] of cases) {
    assert.equal(globError(pattern), null, pattern);
    assert.equal(matchGlob(path, pattern), expected, `${pattern} vs ${path}`);
  }
  assert.equal(globError('a/[b\\]/c'), 'unclosed "[": escape a literal [ as \\[', '\\] does not close the class');
});

test('globError reports a class that does not compile, so matching never throws', () => {
  for (const pattern of ['src/[z-a]*.ts', '{a,[z-a]}']) {
    assert.match(globError(pattern), /^invalid \[ … \] class \(Range out of order in character class\)\. Correct the class, or escape a literal \[ as \\\[$/, pattern);
    assert.throws(() => matchGlob('src/a.ts', pattern), SyntaxError, 'what globError prevents');
  }
});

test('normalizeGlob drops a leading ./ and turns a trailing / into /**', () => {
  assert.equal(normalizeGlob('./src/**'), 'src/**');
  assert.equal(normalizeGlob('docs/'), 'docs/**');
  assert.equal(normalizeGlob('**/*.ts'), '**/*.ts');
  assert.equal(matchGlob('docs/a/b.md', 'docs/'), true);
});

// One sample path per bundled scope glob; the test fails when a pack adds a glob without a sample.
const SAMPLES = [
  'Dockerfile', 'infra/Dockerfile.prod', 'docker-compose.yml', 'infra/compose.prod.yaml', '.github/workflows/ci.yml', '.gitlab-ci.yml',
  'Makefile', 'scripts/deploy.sh', 'src/a.ts', 'src/a.tsx', 'src/a.mts', 'src/a.cts', 'src/a.js', 'src/a.jsx', 'src/a.mjs', 'src/a.cjs',
  'src/a.test.ts', 'src/a.spec.tsx', 'src/a.test.mjs',
];

test('every glob in the bundled rule scopes is valid and matches a sample path', () => {
  const packsDir = join(pluginRoot, 'packs');
  let count = 0;
  for (const id of readdirSync(packsDir)) {
    for (const file of readdirSync(join(packsDir, id)).filter((name) => /^rules.*\.md$/.test(name))) {
      for (const rule of parseRuleFile(readFileSync(join(packsDir, id, file), 'utf8'), `${id}/${file}`)) {
        const scope = parseScope(rule.scope);
        if (scope.kind !== 'paths') continue;
        for (const glob of scope.globs) {
          count += 1;
          assert.equal(globError(glob), null, `${rule.id}: ${glob}`);
          assert.ok(SAMPLES.some((path) => matchGlob(path, glob)), `${rule.id}: ${glob} matches no sample path`);
        }
      }
    }
  }
  assert.ok(count >= 10, `found ${count} scope globs`);
});
