// Test fixtures: temp repositories per test (removed with t.after), a hermetic git environment and
// runners for cw. Helpers here never end in .test.mjs, so the test glob does not run them.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cwScript = join(pluginRoot, 'cli', 'cw.mjs');
export const cwShim = join(pluginRoot, 'bin', 'cw');

export function tempBase(t, prefix = 'dw-test-') {
  const base = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

export function write(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
}

// The environment for git and cw in tests: no global or system git config, a fixed identity, a fixed
// session id, stubs first on PATH, and none of the developer's Claude Code session variables.
export function hermeticEnv(base, extra = {}) {
  mkdirSync(join(base, 'home'), { recursive: true });
  mkdirSync(join(base, 'stubs'), { recursive: true });
  writeFileSync(join(base, 'gitconfig'), '');
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLAUDE') || key === 'NODE_TEST_CONTEXT' || key.startsWith('GIT_')) delete env[key];
  }
  return {
    ...env,
    HOME: join(base, 'home'),
    GIT_CONFIG_GLOBAL: join(base, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    CLAUDE_CODE_SESSION_ID: 'test-session',
    PATH: `${join(base, 'stubs')}:${process.env.PATH}`,
    ...extra,
  };
}

export const gitIn = (cwd, env) => (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

const APP_FILES = {
  'package.json': { name: 'fixture-app', private: true, scripts: { test: 'node --test' } },
  'src/sum.mjs': 'export const sum = (a, b) => a + b;\n',
  'src/sum.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from './sum.mjs';\n\ntest('adds', () => assert.equal(sum(1, 2), 3));\n",
  '.gitignore': 'node_modules\n',
};

export const inPlaceConfig = (overrides = {}) => ({
  version: 1,
  project: { name: 'Fixture' },
  workspace: { mode: 'in-place', appRoot: 'app' },
  packs: [],
  packages: [{ id: 'app', path: '.', areas: ['backend'], checks: { test: 'node --test' } }],
  git: { noTicketKey: 'NO-TICKET' },
  ...overrides,
});

export const worktreeConfig = (overrides = {}) => ({
  version: 1,
  project: { name: 'Fixture' },
  workspace: { mode: 'worktree' },
  packs: [],
  packages: [{ id: 'app', path: '.', areas: ['backend'], checks: { test: 'node --test' } }],
  git: { noTicketKey: 'NO-TICKET' },
  ...overrides,
});

// Commits files on main in a fresh repo and pushes main to a bare origin.
function initRepo(dir, remote, env, files) {
  mkdirSync(dir, { recursive: true });
  const git = gitIn(dir, env);
  git('init', '-q', '-b', 'main');
  write(dir, files);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  execFileSync('git', ['init', '-q', '--bare', remote], { env });
  git('remote', 'add', 'origin', remote);
  git('push', '-q', 'origin', 'main');
  return git;
}

// In-place layout (D5): the outer repo holds the config and ignores app/, a nested repo with its own origin.
export function makeInPlace(t, { config = inPlaceConfig(), appFiles = {} } = {}) {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'project');
  const app = join(root, 'app');
  initRepo(root, join(base, 'outer-origin.git'), env, { '.gitignore': 'app/\n', '.claude/dev-workflow/config.json': config });
  initRepo(app, join(base, 'app-origin.git'), env, { ...APP_FILES, ...appFiles });
  return { base, env, root, app, remote: join(base, 'app-origin.git') };
}

// Worktree layout: one repo with the config and the application, and its origin.
export function makeWorktreeRepo(t, { config = worktreeConfig(), files = {} } = {}) {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'project');
  initRepo(root, join(base, 'origin.git'), env, {
    ...APP_FILES,
    '.gitignore': 'node_modules\n.claude/worktrees/\n',
    '.claude/dev-workflow/config.json': config,
    ...files,
  });
  return { base, env, root, remote: join(base, 'origin.git') };
}

// What Claude Code creates for an Agent call with isolation "worktree" (S4).
export function addAgentWorktree(root, env, id = 'abc123') {
  const path = join(root, '.claude', 'worktrees', `agent-${id}`);
  execFileSync('git', ['worktree', 'add', '-q', '-b', `worktree-agent-${id}`, path, 'HEAD'], { cwd: root, env });
  return path;
}

const spawnCw = (command, args, cwd, { input = '', env } = {}) => {
  const result = spawnSync(process.execPath, [command, ...args], { cwd, env, input, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, json: () => JSON.parse(result.stdout) };
};

export const cw = (cwd, args, options) => spawnCw(cwScript, args, cwd, options);
export const cwBin = (cwd, args, options) => spawnCw(cwShim, args, cwd, options);
