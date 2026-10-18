// Builds throwaway git repositories for tests: a small two-package project with a backlog,
// migrations, a workflow file and a bare remote.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cwBin = join(pluginRoot, 'scripts', 'cw.mjs');

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
}

export const BACKLOG = `# Next steps

## Suggested order

1. **AB-2** first.

## Area A

| ID | Task | Status | Needs |
|---|---|---|---|
| AB-1 | Add the sum helper | ⬜ Open | — |
| AB-2 | Add the product helper | ⬜ Open | — |
| AB-3 | Use both | ⬜ Open | AB-1 |
| AB-4 | Owner thing | 👤 Owner | — |
`;

export const PROFILE = {
  version: 1,
  project: { name: 'mini', language: { repo: 'en', productCopy: 'es' } },
  packs: ['core', 'node-npm', 'vitest', { id: 'postgres-sql', variant: 'numbered-sql', options: { dir: 'api/migrations' } }, 'github-actions'],
  packages: [
    { id: 'api', path: 'api', areas: ['backend', 'data'], checks: { test: 'node --test' }, exclusive: ['test'], test: { single: 'node --test {file}' } },
    { id: 'app', path: 'app', areas: ['frontend'], checks: { test: 'node --test' } },
    { id: 'docs', path: ['docs', 'plan'], areas: ['docs'] },
  ],
  complexity: { escalate: [{ keywords: ['auth'], min: 'xl', reason: 'security' }] },
  guards: { ports: [5174], commands: ['make up'], devServer: 'never' },
  git: { defaultBase: 'main', branch: '{ticket|lower}-{slug}', branchNoTicket: 'chore-{slug}', commitSummary: '{summary} ({ticket})' },
  tickets: { adapter: 'markdown-table', file: 'plan/NEXT_STEPS.md', newRowSections: { 'Area A': 'AB' } },
  knowledgeBase: { docsOnlyPaths: ['plan/**', 'docs/**'] },
  rules: {
    extend: { 'CORE-NAMING': 'Domain terms keep their official spelling.' },
    add: ['.claude/workflow/rules/project.md'],
    aliases: { 'CQ-1': 'CORE-SCOPE', 'CQ-27': ['SQL-MIGRATION-COMPAT', 'SQL-MIGRATION-NUMBERING'] },
  },
};

export const PROJECT_RULES = `## MINI-MONEY — Money as integer cents
<!-- rule: severity=blocking; scope=areas:backend; protected=true -->
Store and compute money as integer cents.
`;

// Creates the project, commits it, and attaches a bare remote as origin. Returns { root, remote }.
export function makeProject({ profile = PROFILE, withProfile = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'dw-test-'));
  const root = join(base, 'project');
  const remote = join(base, 'remote.git');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  write(root, {
    'package.json': { name: 'mini', private: true, workspaces: ['api', 'app'] },
    'api/package.json': { name: 'api', scripts: { test: 'node --test' }, dependencies: { pg: '^8.0.0' } },
    'api/sum.mjs': 'export const sum = (a, b) => a + b;\n',
    'api/sum.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert';\nimport { sum } from './sum.mjs';\ntest('adds', () => assert.equal(sum(1, 2), 3));\n",
    'api/migrations/001_init.sql': 'CREATE TABLE t (id int);\n',
    'app/package.json': { name: 'app', scripts: { test: 'node --test' }, dependencies: { vitest: '^4.0.0' } },
    'app/view.mjs': 'export const label = () => "ok";\n',
    'plan/NEXT_STEPS.md': BACKLOG,
    '.github/workflows/deploy.yml': "name: Deploy api\non:\n  push:\n    branches: [main]\n    paths:\n      - 'api/**'\njobs:\n  deploy:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo deploy\n",
    '.gitignore': 'node_modules/\n',
  });
  if (withProfile) {
    write(root, { '.claude/workflow/profile.json': profile, '.claude/workflow/rules/project.md': PROJECT_RULES });
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  git(base, 'clone', '-q', '--bare', root, remote);
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'fetch', '-q', 'origin');
  git(root, 'branch', '-q', '--set-upstream-to', 'origin/main', 'main');
  return { base, root, remote };
}

// The test runner marks its children with NODE_TEST_CONTEXT; checks that run `node --test` must not inherit it.
export function cleanEnv(extra = {}) {
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: 'test-session', ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

export function cw(cwd, args, { input, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [cwBin, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}
