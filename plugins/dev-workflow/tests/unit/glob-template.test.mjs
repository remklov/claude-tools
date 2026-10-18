import assert from 'node:assert/strict';
import test from 'node:test';
import { matchGlob } from '../../scripts/lib/glob.mjs';
import { render, templateToRegExp } from '../../scripts/lib/template.mjs';
import { parseYaml } from '../../scripts/lib/yaml-lite.mjs';

test('globs used by the packs', () => {
  const cases = [
    ['**/*.yml', '.github/workflows/x.yml', true], ['**/*.yml', 'x.yml', true], ['app/**', 'app/src/a.tsx', true],
    ['app/**', 'api/a.ts', false], ['**/*.{ts,tsx,mts,cts}', 'a/b.tsx', true], ['**/Dockerfile*', 'x/Dockerfile.prod', true],
    ['**/*compose*.y*ml', 'infra/docker-compose.prod.yml', true], ['**/*.{test,spec}.{ts,tsx,js,jsx,mts,mjs}', 'src/a.test.ts', true],
    ['plan/', 'plan/x.md', true], ['**/migrations/[0-9][0-9][0-9]_*.sql', 'api/migrations/001_init.sql', true],
  ];
  for (const [pattern, path, expected] of cases) assert.equal(matchGlob(path, pattern), expected, `${pattern} ~ ${path}`);
});

test('templates render and turn into matching regexes', () => {
  assert.equal(render('{ticket|lower}-{slug}', { ticket: 'NV-9', slug: 'cre-total' }), 'nv-9-cre-total');
  assert.ok(templateToRegExp('{summary} ({ticket})', { ticket: '[A-Z]+-\\d+' }).test('Fix it (NV-9)'));
  assert.ok(!templateToRegExp('{summary} ({ticket})', { ticket: '[A-Z]+-\\d+' }).test('Fix it'));
});

test('yaml-lite reads GitHub workflow triggers', () => {
  const doc = parseYaml("name: Deploy\non:\n  push:\n    branches: [main]\n    paths:\n      - 'api/**' # comment\n  pull_request:\njobs:\n  a:\n    steps:\n      - run: |\n          echo hi\n      - uses: x@v1\n");
  assert.deepEqual(doc.on.push, { branches: ['main'], paths: ['api/**'] });
  assert.equal(doc.on.pull_request, null);
  assert.equal(doc.jobs.a.steps[1].uses, 'x@v1');
});
