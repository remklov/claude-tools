import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  askQuestions, detectProject, gitAllowRules, mergeSettings, parseJsonc, pendingQuestions, proposeConfig, settingsFragment, upsertMarkedSection,
} from '../../cli/lib/init.mjs';
import { validateConfig } from '../../cli/lib/config.mjs';
import { quote } from '../../cli/lib/host/index.mjs';
import { cw, gitIn, hermeticEnv, pluginRoot, tempBase, write } from '../fixtures/repo.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const TSCONFIG = `{
  // The app uses Node's ESM resolution.
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext", /* keep in sync with module */
    "paths": { "@/*": ["https://not-a-comment/*"] },
  },
}
`;

// Acme Shop's layout: an outer repo that ignores app/, a nested app repo with npm workspaces.
function outerAppLike(t) {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'project');
  const app = join(root, 'app');
  const init = (dir, files) => {
    write(dir, files);
    const git = gitIn(dir, env);
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    return git;
  };
  init(root, { '.gitignore': 'app/\n', 'CLAUDE.md': '# Project\n\nKeep this text.\n' });
  const appGit = init(app, {
    'package.json': {
      name: 'mm-app',
      private: true,
      workspaces: ['packages/*'],
      scripts: { test: 'npm test --workspaces', typecheck: 'tsc -b', lint: 'eslint .' },
      devDependencies: { typescript: '^5.6.0', vitest: '^3.0.0' },
    },
    'tsconfig.json': TSCONFIG,
    'packages/web/package.json': { name: 'web', dependencies: { react: '^19.1.0' }, devDependencies: { vite: '^6.0.0' }, scripts: { test: 'vitest run', lint: 'eslint .' } },
    'packages/web/vitest.config.ts': 'export default { test: { environment: "jsdom", globals: true } };\n',
    'packages/api/package.json': { name: 'api', dependencies: { express: '^5.1.0' }, scripts: { test: 'vitest run', 'type-check': 'tsc' } },
  });
  appGit('remote', 'add', 'origin', 'git@github.com:acme/app.git');
  return { base, env, root, app };
}

test('detectProject: in-place app, workspaces, areas, checks, packs with variants and options', (t) => {
  const fx = outerAppLike(t);
  const detection = detectProject(fx.root);
  assert.equal(detection.mode, 'in-place');
  assert.equal(detection.appRoot, 'app');
  assert.deepEqual(detection.host, { kind: 'github', hostname: 'github.com', repo: 'acme/app' });
  assert.deepEqual(detection.packages, [{ id: 'app', path: '.', areas: ['frontend', 'backend'], checks: { test: 'npm test', typecheck: 'npm run typecheck', lint: 'npm run lint' } }]);
  // The packs come from the manifests' detect entries, in pack id order.
  assert.deepEqual(detection.packs, [
    { id: 'express', variant: '5', options: { appEntry: 'createApp()' } },
    'node-npm',
    { id: 'react-vite', variant: 'react-19', options: { vitestGlobals: true } },
    { id: 'typescript', options: { moduleResolution: 'nodenext' } },
    'vitest',
  ]);
  assert.deepEqual(detection.symlinkDirectories, ['node_modules', 'packages/api/node_modules', 'packages/web/node_modules']);
  assert.equal(detection.defaultBase, 'main');
  const config = proposeConfig(detection);
  assert.deepEqual(validateConfig(config), []);
  assert.deepEqual(config.workspace, { mode: 'in-place', appRoot: 'app' });
  assert.equal(config.git.noTicketKey, 'maintenance');

  assert.throws(() => detectProject(fx.app), (error) => error.exitCode === 3 && error.fix === `Run cw init in the outer repository ${detection.projectRoot}.`);
});

test('detectProject per workspace and in worktree mode', (t) => {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'shop');
  write(root, {
    'package.json': { name: 'shop', workspaces: { packages: ['apps/*', 'tools/cli'] } },
    'apps/web/package.json': { dependencies: { react: '18.3.1' }, scripts: { test: 'echo "Error: no test specified" && exit 1' } },
    'apps/api/package.json': { dependencies: { express: '~4.21.0' }, scripts: { test: 'node --test', lint: 'eslint .' } },
    'tools/cli/package.json': { scripts: { test: 'node --test' } },
  });
  const git = gitIn(root, env);
  git('init', '-q', '-b', 'trunk');
  const detection = detectProject(root);
  assert.equal(detection.mode, 'worktree');
  assert.equal(detection.defaultBase, 'trunk');
  assert.deepEqual(detection.packages, [
    { id: 'api', path: 'apps/api', areas: ['backend'], checks: { test: 'npm test', lint: 'npm run lint' } },
    { id: 'web', path: 'apps/web', areas: ['frontend'], checks: {} },
    { id: 'cli', path: 'tools/cli', areas: ['app'], checks: { test: 'npm test' } },
  ]);
  assert.deepEqual(detection.undetectedAreas, ['cli']);
  assert.deepEqual(detection.packs, [{ id: 'express', variant: '4', options: { appEntry: 'createApp()' } }, 'node-npm', { id: 'react-vite', variant: 'react-18' }]);

  write(root, { 'apps/web/package.json': { dependencies: { react: '^17.0.2' } } });
  const older = detectProject(root);
  assert.equal(older.packs.find((pack) => pack === 'react-vite' || pack.id === 'react-vite'), 'react-vite', 'no variant is written when none matches');
  assert.ok(older.warnings.some((warning) => /No variant of pack react-vite matches the installed version; its default react-19 applies/.test(warning)));
});

test('detectProject: packs and variants from the manifests, checks from check discovery (React 19 + Vite + Vitest, Express 5 + TS)', (t) => {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'shop');
  write(root, {
    '.gitignore': 'node_modules\n',
    'package.json': { name: 'shop', private: true, workspaces: ['apps/*'] },
    'apps/web/package.json': { dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' }, devDependencies: { vite: '^6.0.0', vitest: '^3.2.0' }, scripts: { test: 'vitest run', lint: 'eslint .' } },
    'apps/web/vite.config.ts': 'export default { test: { environment: "jsdom" } };\n',
    'apps/api/package.json': { dependencies: { express: '^5.1.0' }, devDependencies: { typescript: '^5.6.0' }, scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'node --test' } },
    'apps/api/tsconfig.json': '{ "compilerOptions": { "moduleResolution": "NodeNext" } }\n',
  });
  gitIn(root, env)('init', '-q', '-b', 'main');
  const detection = detectProject(root);
  assert.deepEqual(detection.packs, [
    { id: 'express', variant: '5', options: { appEntry: 'createApp()' } },
    'node-npm',
    { id: 'react-vite', variant: 'react-19' },
    { id: 'typescript', options: { moduleResolution: 'nodenext' } },
    'vitest',
  ], 'untracked files count; core is never listed');
  assert.deepEqual(detection.packages, [
    { id: 'api', path: 'apps/api', areas: ['backend'], checks: { test: 'npm test', typecheck: 'npm run typecheck', lint: 'npm run lint' } },
    { id: 'web', path: 'apps/web', areas: ['frontend'], checks: { test: 'npm test', lint: 'npm run lint' } },
  ]);
  assert.deepEqual(Object.keys(detection.packages[0].checks), ['test', 'typecheck', 'lint'], 'the §5 order of node-npm:check-discovery');
  assert.deepEqual(validateConfig(proposeConfig(detection)), []);

  // An app directory that is no repository of its own: its package.json and tsconfig.json files.
  const outer = join(base, 'outer');
  write(outer, { '.gitignore': 'app/\n', 'app/package.json': { scripts: { test: 'node --test' } }, 'app/tsconfig.json': '{}\n' });
  gitIn(outer, env)('init', '-q', '-b', 'main');
  const plain = detectProject(outer, { appRoot: 'app' });
  assert.deepEqual(plain.packs, ['node-npm', 'typescript']);
  assert.deepEqual(plain.packages, [{ id: 'app', path: '.', areas: ['app'], checks: { test: 'npm test' } }]);
  assert.match(plain.warnings.join('\n'), /app\/ is not a git repository yet/);
});

test('detectProject merges the checks of every detected pack with check discovery and reports a failing script', (t) => {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'tool');
  const pack = (id, script) => ({
    [`.claude/dev-workflow/packs/${id}/pack.json`]: { id, version: '0.1.0', title: id, detect: [{ glob: 'Makefile' }], scripts: { discover: 'scripts/discover.mjs' }, checkDiscovery: 'discover' },
    [`.claude/dev-workflow/packs/${id}/scripts/discover.mjs`]: script,
  });
  write(root, {
    'package.json': { name: 'tool', scripts: { test: 'node --test' } },
    Makefile: 'check:\n\ttrue\n',
    ...pack('make', "console.log(JSON.stringify({ '.': { check: 'make check' }, missing: { test: 'x' } }));\n"),
    ...pack('flaky', "console.error('no make here');\nprocess.exitCode = 3;\n"),
  });
  gitIn(root, env)('init', '-q', '-b', 'main');
  const detection = detectProject(root);
  assert.deepEqual(detection.packs, ['flaky', 'make', 'node-npm']);
  assert.deepEqual(detection.packages, [{ id: 'tool', path: '.', areas: ['app'], checks: { check: 'make check', test: 'npm test' } }]);
  assert.ok(detection.warnings.includes("cw run flaky:discover found no checks (no make here); add the packages' checks by hand."), detection.warnings.join('\n'));
});

test('detectProject: without origin/HEAD the base is origin/main or origin/master, the current branch only with a warning', (t) => {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'repo');
  write(root, { 'package.json': { name: 'repo', scripts: { test: 'node --test' } } });
  const git = gitIn(root, env);
  git('init', '-q', '-b', 'master');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  // Added and pushed, not cloned: no refs/remotes/origin/HEAD.
  execFileSync('git', ['init', '-q', '--bare', join(base, 'origin.git')], { env });
  git('remote', 'add', 'origin', join(base, 'origin.git'));
  git('push', '-q', 'origin', 'master');
  git('switch', '-q', '-c', 'NO-TICKET/feature/wip');
  const pushed = detectProject(root);
  assert.equal(pushed.defaultBase, 'master');
  assert.ok(!pushed.warnings.some((warning) => /git\.defaultBase/.test(warning)), pushed.warnings.join('\n'));

  git('update-ref', '-d', 'refs/remotes/origin/master');
  const unknown = detectProject(root);
  assert.equal(unknown.defaultBase, 'NO-TICKET/feature/wip');
  assert.ok(unknown.warnings.some((warning) => /origin\/HEAD, origin\/main and origin\/master are unknown: git\.defaultBase is the current branch NO-TICKET\/feature\/wip/.test(warning)), unknown.warnings.join('\n'));
});

test('detectProject: a repo without origin on main or master gets no note about git.defaultBase', (t) => {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  for (const branch of ['main', 'master']) {
    const root = join(base, branch);
    write(root, { 'package.json': { name: branch, scripts: { test: 'node --test' } } });
    gitIn(root, env)('init', '-q', '-b', branch);
    const detection = detectProject(root);
    assert.equal(detection.defaultBase, branch);
    assert.ok(!detection.warnings.some((warning) => /git\.defaultBase/.test(warning)), detection.warnings.join('\n'));
  }
});

test('cw init --write and --interactive drop the detection notes that the final config resolves', (t) => {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'tool');
  write(root, { 'package.json': { name: 'tool' }, 'src/index.js': 'export {};\n' });
  const git = gitIn(root, env);
  git('init', '-q', '-b', 'trunk');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const checksNote = /Package tool \(\.\) has no checks/;
  const baseNote = /git\.defaultBase is the current branch trunk/;
  const has = (result, note) => result.json().warnings.some((warning) => note.test(warning));
  const { config } = cw(root, ['init', '--detect', '--json'], { env }).json();
  const withChecks = { ...config, packages: [{ ...config.packages[0], checks: { test: 'make test' } }] };

  // A prepared config with a test command and another base branch resolves both notes.
  write(root, { 'cfg.json': { ...withChecks, git: { ...config.git, defaultBase: 'develop' } } });
  const given = cw(root, ['init', '--write', 'cfg.json', '--json'], { env });
  assert.equal(given.code, 0, given.stderr);
  for (const note of [checksNote, baseNote]) {
    assert.doesNotMatch(given.stderr, note);
    assert.equal(has(given, note), false, given.stdout);
  }

  // The base branch is still the detected current branch: that note stays.
  write(root, { 'cfg.json': withChecks });
  const kept = cw(root, ['init', '--write', 'cfg.json', '--force', '--json'], { env });
  assert.equal(kept.code, 0, kept.stderr);
  assert.match(kept.stderr, baseNote);
  assert.doesNotMatch(kept.stderr, checksNote);
  assert.deepEqual([has(kept, baseNote), has(kept, checksNote)], [true, false]);

  // Interactive: every note comes before the questions; the answered test command resolves its note.
  const asked = cw(root, ['init', '--interactive', '--force', '--json'], { env, input: '\n\n\nbackend\nnpm test\n\n\n\n' });
  assert.equal(asked.code, 0, asked.stderr);
  assert.ok(asked.stderr.search(checksNote) !== -1 && asked.stderr.search(checksNote) < asked.stderr.indexOf('Project name ['), asked.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.claude/dev-workflow/config.json'), 'utf8')).packages[0].checks, { test: 'npm test' });
  assert.deepEqual([has(asked, baseNote), has(asked, checksNote)], [true, false]);
});

test('a package without checks is a warning and an open question for its test command', async (t) => {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'tool');
  write(root, { 'package.json': { name: 'tool' }, 'src/index.js': 'export {};\n' });
  gitIn(root, env)('init', '-q', '-b', 'main');
  const detection = detectProject(root);
  assert.deepEqual(detection.packages[0].checks, {});
  assert.ok(detection.warnings.some((warning) => /^Package tool \(\.\) has no checks, so cw checks would pass without running anything/.test(warning)), detection.warnings.join('\n'));
  const config = proposeConfig(detection);
  assert.deepEqual(pendingQuestions(config, detection).find((question) => question.id === 'packages.tool.checks.test'), { id: 'packages.tool.checks.test', text: 'Test command of package tool, run in . (Enter: none)', default: '' });
  assert.deepEqual((await askQuestions(config, detection, { yes: true })).packages[0].checks, {});
  const prompter = { ask: async (text, fallback) => (text.startsWith('Test command') ? 'make test' : fallback) };
  assert.deepEqual((await askQuestions(config, detection, { prompter })).packages[0].checks, { test: 'make test' });
});

test('cw init --interactive and --write print the detection notes, before the questions', (t) => {
  const base = tempBase(t);
  const env = hermeticEnv(base);
  const root = join(base, 'mono');
  write(root, {
    'package.json': { name: 'mono', private: true, workspaces: ['packages/**'], dependencies: { react: '^17.0.2' } },
    'packages/a/package.json': { name: 'a', scripts: { test: 'node --test' } },
  });
  gitIn(root, env)('init', '-q', '-b', 'main');
  const pattern = /The workspace pattern "packages\/\*\*" is not expanded/;
  const variant = /No variant of pack react-vite matches the installed version/;

  const asked = cw(root, ['init', '--interactive'], { env, input: '' });
  assert.equal(asked.code, 0, asked.stderr);
  assert.match(asked.stderr, pattern);
  assert.match(asked.stderr, variant);
  assert.ok(asked.stderr.search(pattern) < asked.stderr.indexOf('Project name ['), 'the notes come before the first question');

  const yes = cw(root, ['init', '--interactive', '--yes', '--force', '--json'], { env });
  assert.equal(yes.code, 0, yes.stderr);
  for (const note of [pattern, variant, /Package mono \(\.\) has no checks/]) assert.ok(yes.json().warnings.some((warning) => note.test(warning)), yes.stdout);

  write(root, { 'cfg.json': readFileSync(join(root, '.claude/dev-workflow/config.json'), 'utf8') });
  const given = cw(root, ['init', '--write', 'cfg.json', '--json'], { env });
  assert.equal(given.code, 0, given.stderr);
  assert.ok(given.json().warnings.some((warning) => pattern.test(warning)), given.stdout);
});

test('parseJsonc strips comments and trailing commas outside strings', () => {
  assert.deepEqual(parseJsonc(TSCONFIG).compilerOptions, { module: 'NodeNext', moduleResolution: 'NodeNext', paths: { '@/*': ['https://not-a-comment/*'] } });
  assert.deepEqual(parseJsonc('{"a": "x, }", "b": [1, 2,],}'), { a: 'x, }', b: [1, 2] });
});

test('askQuestions: defaults with yes, typed answers otherwise; the product copy defaults to the repo language', async (t) => {
  const fx = outerAppLike(t);
  const detection = detectProject(fx.root);
  const config = proposeConfig(detection);
  const yes = await askQuestions(config, detection, { yes: true });
  assert.equal(yes.project.name, 'project');
  assert.deepEqual(yes.project.language, { repo: 'en', productCopy: 'en' });

  const answers = ['Acme Shop', '', 'de', 'createApp(config)', 'xx-invalid', ''];
  const prompter = { ask: async (text, fallback, check) => {
    const value = answers.shift() || fallback;
    return check?.(value) ? fallback : value;
  } };
  const typed = await askQuestions(config, detection, { prompter });
  assert.deepEqual([typed.project.name, typed.project.language.productCopy], ['Acme Shop', 'de']);
  assert.equal(typed.packs.find((entry) => entry.id === 'express').options.appEntry, 'createApp(config)');
  assert.equal(typed.git.defaultBase, 'xx-invalid');
});

test('askQuestions: the ticket source decides whether the Jira site or the ticket file is asked', async (t) => {
  const fx = outerAppLike(t);
  const detection = detectProject(fx.root);
  const config = proposeConfig(detection);
  const run = async (answers) => {
    const asked = [];
    const prompter = { ask: async (text, fallback, check) => {
      asked.push(text);
      const part = Object.keys(answers).find((start) => text.startsWith(start));
      const value = part ? answers[part] : fallback;
      return check?.(value) ? fallback : value;
    } };
    return { tickets: (await askQuestions(config, detection, { prompter })).tickets, asked };
  };
  const fallback = await run({ 'Ticket source': 'github' });
  assert.deepEqual(fallback.tickets, { source: 'local', keyPattern: '^[A-Z][A-Z0-9]+-[0-9]+$', contextPath: 'docs/tickets/{key}.md' }, 'local is the default');
  assert.ok(fallback.asked.includes('Ticket files, relative to the project root, with {key}'));

  const siteQuestion = 'Jira site (host name, - to look it up on the first ticket)';
  const jira = await run({ 'Ticket source': 'jira' });
  assert.deepEqual(jira.tickets, { source: 'jira', keyPattern: '^[A-Z][A-Z0-9]+-[0-9]+$' });
  assert.ok(jira.asked.includes(siteQuestion));
  assert.equal((await run({ 'Ticket source': 'jira', 'Jira site': 'acme.atlassian.net' })).tickets.site, 'acme.atlassian.net');

  const linear = await run({ 'Ticket source': 'linear' });
  assert.deepEqual(linear.tickets, { source: 'linear', keyPattern: '^[A-Z][A-Z0-9]+-[0-9]+$', contextPath: 'docs/specs/{key}.md' });
  assert.ok(!linear.asked.includes(siteQuestion));
  assert.equal((await run({ 'Ticket source': 'linear', 'Technical context': '-' })).tickets.contextPath, undefined);

  assert.equal((await run({ 'Ticket source': 'local', 'Ticket files': 'specs/{key}.md' })).tickets.contextPath, 'specs/{key}.md');
  assert.equal((await run({ 'Ticket source': 'local', 'Ticket files': '../specs/{key}.md' })).tickets.contextPath, 'docs/tickets/{key}.md', 'a refused answer keeps the default');
  assert.equal((await run({ 'Ticket source': 'local' })).tickets.contextPath, 'docs/tickets/{key}.md');
  assert.deepEqual(pendingQuestions(config, detection).filter((question) => question.id.startsWith('tickets.')).map((question) => question.id), ['tickets.source', 'tickets.contextPath']);
});

test('mergeSettings is additive and reports kept scalars', () => {
  const existing = { model: 'opus', permissions: { allow: ['Bash(ls *)', 'Bash(cw *)'], ask: [] }, env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' } };
  const fragment = { permissions: { allow: ['Bash(cw *)', 'Bash(git add *)'], deny: ['Agent(model:*)'] }, env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1', OTHER: 'x' } };
  const { merged, conflicts, changed } = mergeSettings(existing, fragment);
  assert.deepEqual(merged, {
    model: 'opus',
    permissions: { allow: ['Bash(ls *)', 'Bash(cw *)', 'Bash(git add *)'], ask: [], deny: ['Agent(model:*)'] },
    env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2', OTHER: 'x' },
  });
  assert.deepEqual(Object.keys(merged), ['model', 'permissions', 'env']);
  assert.deepEqual(conflicts, ['env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH (kept "2", proposed "1")']);
  assert.equal(changed, true);
  assert.equal(mergeSettings(merged, fragment).changed, false);
  assert.deepEqual(mergeSettings({ worktree: 'x' }, { worktree: { baseRef: 'head' } }).conflicts, ['worktree (kept "x", proposed {"baseRef":"head"})']);
});

test('upsertMarkedSection replaces only between the markers or appends', () => {
  const section = '## Development workflow\n\nnew text';
  assert.equal(upsertMarkedSection('', section), '<!-- dev-workflow:start -->\n## Development workflow\n\nnew text\n<!-- dev-workflow:end -->\n');
  const before = '# Title\n\nOwn text, no newline';
  const appended = upsertMarkedSection(before, section);
  assert.ok(appended.startsWith(`${before}\n\n<!-- dev-workflow:start -->`));
  const around = `# A\r\n\n<!-- dev-workflow:start -->\nold\n<!-- dev-workflow:end -->\n\ntail  \n`;
  assert.equal(upsertMarkedSection(around, section), `# A\r\n\n<!-- dev-workflow:start -->\n${section}\n<!-- dev-workflow:end -->\n\ntail  \n`);
  assert.throws(() => upsertMarkedSection('<!-- dev-workflow:start -->\nno end', section), (error) => error.exitCode === 3);
});

// The npm aliases that install or remove packages (npm <command> --help, npm 11.6.2) ask too, as their
// commands do.
const NPM_ALIAS_ASK = [
  'npm add', 'npm in', 'npm ins', 'npm inst', 'npm insta', 'npm instal', 'npm isnt', 'npm isnta', 'npm isntal', 'npm isntall',
  'npm clean-install', 'npm ic', 'npm install-clean', 'npm isntall-clean',
  'npm unlink', 'npm remove', 'npm rm', 'npm r', 'npm un',
  'npm install-test', 'npm it', 'npm install-ci-test', 'npm cit', 'npm clean-install-test', 'npm sit',
].map((command) => `Bash(${command} *)`);

// The §12 permissions, as templates/settings-base.json listed them before the packs became their only
// source, plus the npm aliases.
const PERMISSIONS_12 = {
  allow: ['Bash(cw *)', 'Bash(git add *)', 'Bash(git commit *)'],
  ask: ['Bash(git push *)', 'Bash(git -C * push *)', 'Bash(gh pr create *)', 'Bash(glab mr create *)', 'Bash(npm ci *)', 'Bash(npm install *)', 'Bash(npm i *)', 'Bash(npm uninstall *)', ...NPM_ALIAS_ASK],
  deny: ['Agent(model:*)', 'Agent(effort:*)'],
};

// The git -C allow rules (§12, owner decisions 2026-10-20 and 2026-10-21): in-place from
// workspace.appRoot; none in worktree mode (a * before the subcommand would approve git options, ADR 0011).
const READ_GIT = ['status *', 'diff *', 'log *', 'show *', 'ls-files *', 'rev-parse *', 'branch --show-current'];
const appGitRules = (appRoot) => ['add *', 'commit *', ...READ_GIT].map((command) => `Bash(git -C ${appRoot} ${command})`);
const APP_GIT_RULES = appGitRules('app');
const WORKTREE_GIT_RULES = [];

test('settingsFragment: the packs\' §12 permissions, plain checks only, worktree settings only in worktree mode', () => {
  const checks = { test: 'npm test', bad: 'npm test && rm -rf x', typecheck: 'npm run typecheck' };
  const config = { version: 1, project: { name: 'Fixture' }, workspace: { mode: 'in-place', appRoot: 'app' }, packs: ['node-npm'], packages: [{ id: 'app', path: '.', checks }] };
  const inPlace = settingsFragment({ config, detection: null });
  assert.deepEqual(inPlace.permissions, { ...PERMISSIONS_12, allow: [...PERMISSIONS_12.allow, ...APP_GIT_RULES, 'Bash(npm test *)', 'Bash(npm run typecheck *)'] });
  assert.deepEqual(inPlace.env, { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1' });
  assert.deepEqual(Object.keys(inPlace), ['permissions', 'env']);
  assert.equal(JSON.parse(readFileSync(join(pluginRoot, 'templates', 'settings-base.json'), 'utf8')).permissions, undefined, 'the packs are the only source');

  const withoutNpm = settingsFragment({ config: { ...config, packs: ['vitest'], packages: [] }, detection: null });
  assert.deepEqual(withoutNpm.permissions, { ...PERMISSIONS_12, allow: [...PERMISSIONS_12.allow, ...APP_GIT_RULES], ask: ['Bash(git push *)', 'Bash(git -C * push *)', 'Bash(gh pr create *)', 'Bash(glab mr create *)'] }, 'core only');

  const worktree = settingsFragment({ config: { ...config, workspace: { mode: 'worktree' } }, detection: { symlinkDirectories: ['node_modules', 'web/node_modules'] } });
  assert.deepEqual(worktree.worktree, { baseRef: 'head', symlinkDirectories: ['node_modules', 'web/node_modules'] });
  assert.equal(inPlace.worktree, undefined);
  assert.deepEqual(worktree.permissions.allow.filter((rule) => rule.startsWith('Bash(git -C')), WORKTREE_GIT_RULES, 'worktree mode: no git -C rule; the reviewer uses cw review');

  const spaced = settingsFragment({ config: { ...config, workspace: { mode: 'in-place', appRoot: 'my app' } }, detection: null });
  assert.ok(!spaced.permissions.allow.some((rule) => rule.startsWith('Bash(git -C')), 'no rule for an appRoot that needs quoting');
});

test('gitAllowRules: the rules for every appRoot cw prints unquoted; none and a warning for one that needs quoting', () => {
  const rules = (workspace) => gitAllowRules({ workspace });
  assert.deepEqual(rules({ mode: 'in-place', appRoot: 'app' }), { rules: APP_GIT_RULES, warning: null });
  assert.deepEqual(rules({ mode: 'in-place', appRoot: './app/' }), { rules: APP_GIT_RULES, warning: null }, 'the form cw prints: the normalized appRoot');
  assert.deepEqual(rules({ mode: 'in-place', appRoot: 'apps/web-app_2.x' }).rules, appGitRules('apps/web-app_2.x'));
  assert.deepEqual(rules({ mode: 'worktree' }), { rules: WORKTREE_GIT_RULES, warning: null });
  assert.deepEqual(gitAllowRules({}), { rules: WORKTREE_GIT_RULES, warning: null }, 'worktree is the default mode');
  // quote() leaves these unquoted, so cw prints git -C web+app …: the rule text equals the printed form.
  for (const appRoot of ['web+app', 'app@2', 'a%b', 'k=v', 'a:b', 'a,b']) {
    const result = rules({ mode: 'in-place', appRoot });
    assert.equal(quote(appRoot), appRoot);
    assert.deepEqual(result, { rules: appGitRules(appRoot), warning: null }, appRoot);
  }
  for (const appRoot of ['my app', 'app$x', "o'app", 'app*', 'a(b)', 'app;x', 'a~b', 'a"b', 'a&b', 'a|b', 'a<b', 'a?b', 'a[b]', 'a{b}', 'a#b', 'a!b', 'a`b']) {
    const result = rules({ mode: 'in-place', appRoot });
    assert.notEqual(quote(appRoot), appRoot, appRoot);
    assert.deepEqual(result.rules, [], appRoot);
    assert.match(result.warning, /needs shell quoting \(only letters, digits and _ @ % \+ = : , \. \/ - go unquoted\), so cw init wrote no allow rule for git -C .+: each git add, git commit and read-only git -C command of the agents asks for permission\. Rename the directory/, appRoot);
  }
  assert.ok(rules({ mode: 'in-place', appRoot: 'my app' }).warning.startsWith("workspace.appRoot 'my app' needs shell quoting"));
});

test('cw init refuses to write inside Claude Code; --detect still works', (t) => {
  const fx = outerAppLike(t);
  write(fx.root, { '.claude/settings.json': '{ "model": "opus" }\n', 'cfg.json': proposeConfig(detectProject(fx.root)) });
  const env = { ...fx.env, CLAUDECODE: '1' };
  for (const args of [['init', '--write', 'cfg.json'], ['init', '--interactive', '--yes']]) {
    const refused = cw(fx.root, args, { env });
    assert.equal(refused.code, 3);
    assert.match(refused.stderr, /CLAUDECODE=1\)\.\nFix: Run scripts\/setup-dev-workflow\.sh/);
  }
  assert.equal(readFileSync(join(fx.root, '.claude/settings.json'), 'utf8'), '{ "model": "opus" }\n');
  const detect = cw(fx.app, ['init', '--detect', '--json'], { env });
  assert.equal(detect.code, 3, 'detect from inside the nested app repo points at the outer repo');
  const fromRoot = cw(fx.root, ['init', '--detect', '--json'], { env });
  assert.equal(fromRoot.code, 0, fromRoot.stderr);
  assert.equal(fromRoot.json().config.workspace.appRoot, 'app');
  assert.ok(fromRoot.json().questions.some((question) => question.id === 'tickets.contextPath' && question.default === 'docs/tickets/{key}.md'));
  assert.equal(cw(fx.root, ['init'], { env }).code, 2);
  assert.equal(cw(fx.root, ['init', '--detect', '--interactive'], { env }).code, 2);
});

test('cw init --write: readable errors for an invalid config', (t) => {
  const fx = outerAppLike(t);
  const config = proposeConfig(detectProject(fx.root));
  delete config.packages[0].path;
  write(fx.root, { 'cfg.json': config, 'broken.json': '{ "version": 1,' });
  const invalid = cw(fx.root, ['init', '--write', 'cfg.json'], { env: fx.env });
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /- \$\.packages\[0\]\.path: is required/);
  assert.equal(cw(fx.root, ['init', '--write', 'broken.json'], { env: fx.env }).code, 1);
  assert.equal(cw(fx.root, ['init', '--write', 'missing.json'], { env: fx.env }).code, 2);
});

test('cw init: rules that do not compile or a foreign rules file fail with exit 1 and nothing written; rule warnings are reported', (t) => {
  const fx = outerAppLike(t);
  const nothingWritten = () => {
    assert.equal(existsSync(join(fx.root, '.claude/dev-workflow/config.json')), false);
    assert.equal(existsSync(join(fx.root, '.claude/dev-workflow/rulebook.lock.json')), false);
    assert.equal(readFileSync(join(fx.root, 'CLAUDE.md'), 'utf8'), '# Project\n\nKeep this text.\n');
  };
  write(fx.root, { '.claude/dev-workflow/rules/team.md': '## TEAM-ONE — No body\n<!-- rule: severity=advisory -->\n' });
  const broken = cw(fx.root, ['init', '--interactive', '--yes'], { env: fx.env });
  assert.equal(broken.code, 1);
  assert.match(broken.stderr, /Rulebook build failed:\n- .*team\.md:1: rule TEAM-ONE has an empty body/);
  assert.match(broken.stderr, /Nothing was written\.\nFix: Correct the named files, or the packs and rules of the config, then run cw init again\.\n$/);
  nothingWritten();

  write(fx.root, {
    '.claude/dev-workflow/rules/team.md': '## CORE-TEAM — Team rule\n<!-- rule: severity=advisory -->\nKeep it short.\n',
    '.claude/rules/dev-workflow/00-global.md': '# Hand-written\n',
  });
  const foreign = cw(fx.root, ['init', '--interactive', '--yes'], { env: fx.env });
  assert.equal(foreign.code, 1);
  assert.match(foreign.stderr, /00-global\.md exists and was not generated by cw; nothing was written\.\nFix: Move or delete \.claude\/rules\/dev-workflow\/00-global\.md, then run cw init again\./);
  nothingWritten();

  rmSync(join(fx.root, '.claude/rules/dev-workflow/00-global.md'));
  const written = cw(fx.root, ['init', '--interactive', '--yes', '--json'], { env: fx.env });
  assert.equal(written.code, 0, written.stderr);
  assert.ok(written.json().warnings.some((warning) => /project rule CORE-TEAM .* uses the pack prefix CORE/.test(warning)), written.stdout);
  assert.match(readFileSync(join(fx.root, '.claude/rules/dev-workflow/00-global.md'), 'utf8'), /## CORE-TEAM — Team rule/);
});

test('cw init --interactive --yes writes config, rules, settings, CLAUDE.md and the bootstrap; a rerun changes nothing', (t) => {
  const fx = outerAppLike(t);
  write(fx.root, { '.claude/settings.json': { permissions: { allow: ['Bash(ls *)'] }, env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' } } });
  const first = cw(fx.root, ['init', '--interactive', '--yes', '--json'], { env: fx.env });
  assert.equal(first.code, 0, first.stderr);
  const out = first.json();
  const ruleFiles = readdirSync(join(fx.root, '.claude/rules/dev-workflow')).sort().map((name) => `.claude/rules/dev-workflow/${name}`);
  assert.ok(ruleFiles.includes('.claude/rules/dev-workflow/00-global.md') && ruleFiles.includes('.claude/rules/dev-workflow/area-frontend.md'));
  const written = ['.claude/dev-workflow/config.json', ...ruleFiles, '.claude/dev-workflow/rulebook.lock.json', '.claude/settings.json', 'CLAUDE.md', 'scripts/setup-dev-workflow.sh'];
  assert.deepEqual(out.changed, written);
  assert.deepEqual(out.files, written);
  assert.deepEqual(out.conflicts, ['env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH (kept "2", proposed "1")']);
  assert.equal(out.next.length, 1, 'the rules are compiled already, so cw rules build is no next step');
  assert.match(out.next[0], /run \/dev-workflow:ticket <KEY>/);
  const rulesCheck = cw(fx.root, ['rules', 'build', '--check'], { env: fx.env });
  assert.equal(rulesCheck.code, 0, rulesCheck.stdout);

  const config = JSON.parse(readFileSync(join(fx.root, '.claude/dev-workflow/config.json'), 'utf8'));
  assert.deepEqual(config.workspace, { mode: 'in-place', appRoot: 'app' });
  const settings = JSON.parse(readFileSync(join(fx.root, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions.allow, ['Bash(ls *)', 'Bash(cw *)', 'Bash(git add *)', 'Bash(git commit *)', ...APP_GIT_RULES, 'Bash(npm test *)', 'Bash(npm run typecheck *)', 'Bash(npm run lint *)']);
  assert.equal(settings.worktree, undefined);
  const claude = readFileSync(join(fx.root, 'CLAUDE.md'), 'utf8');
  assert.ok(claude.startsWith('# Project\n\nKeep this text.\n\n<!-- dev-workflow:start -->\n## Development workflow (dev-workflow)'));
  assert.match(claude, /\/dev-workflow:ticket <TICKET-KEY \| maintenance>/);
  assert.ok(statSync(join(fx.root, 'scripts/setup-dev-workflow.sh')).mode & 0o111);
  const bash = execFileSync('bash', ['-n', join(fx.root, 'scripts/setup-dev-workflow.sh')], { encoding: 'utf8' });
  assert.equal(bash, '');

  const files = written.map((file) => readFileSync(join(fx.root, file)));
  const again = cw(fx.root, ['init', '--interactive', '--yes', '--force', '--json'], { env: fx.env });
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(again.json().changed, []);
  assert.deepEqual(written.map((file) => readFileSync(join(fx.root, file))), files);

  const changedConfig = JSON.parse(readFileSync(join(fx.root, '.claude/dev-workflow/config.json'), 'utf8'));
  changedConfig.project.name = 'Other';
  write(fx.root, { 'cfg.json': changedConfig });
  const exists = cw(fx.root, ['init', '--write', 'cfg.json'], { env: fx.env });
  assert.equal(exists.code, 3);
  assert.match(exists.stderr, /exists and differs.*\nFix: Pass --force/);
});

test('cw init --write: an appRoot that needs quoting gets no git -C rule and a warning that names the fix', (t) => {
  const fx = outerAppLike(t);
  const config = proposeConfig(detectProject(fx.root));
  config.workspace.appRoot = 'my app';
  write(fx.root, { 'cfg.json': config });
  const result = cw(fx.root, ['init', '--write', 'cfg.json'], { env: fx.env });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\nWarning: workspace\.appRoot 'my app' needs shell quoting .+, so cw init wrote no allow rule for git -C 'my app': .+ Rename the directory to a name without such characters, set workspace\.appRoot to it, and run cw init again\.\n/);
  const settings = JSON.parse(readFileSync(join(fx.root, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions.allow.filter((rule) => rule.startsWith('Bash(git')), ['Bash(git add *)', 'Bash(git commit *)']);
});

test('cw init writes through a symlinked CLAUDE.md and never touches settings.local.json', (t) => {
  const fx = outerAppLike(t);
  rmSync(join(fx.root, 'CLAUDE.md'));
  write(fx.root, { 'AGENTS.md': '# Agents\n', '.claude/settings.local.json': '{ "agent": "x" }\n' });
  symlinkSync('AGENTS.md', join(fx.root, 'CLAUDE.md'));
  const result = cw(fx.root, ['init', '--interactive', '--yes', '--json'], { env: fx.env });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.json().changed.includes('AGENTS.md'));
  assert.ok(lstatSync(join(fx.root, 'CLAUDE.md')).isSymbolicLink());
  assert.match(readFileSync(join(fx.root, 'AGENTS.md'), 'utf8'), /^# Agents\n\n<!-- dev-workflow:start -->/);
  assert.equal(readFileSync(join(fx.root, '.claude/settings.local.json'), 'utf8'), '{ "agent": "x" }\n');
});

test('cw init --interactive reads piped answers', (t) => {
  const fx = outerAppLike(t);
  const result = cw(fx.root, ['init', '--interactive'], { env: fx.env, input: 'Acme Shop\n\nde\n' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /Project name \[project\]: /);
  assert.match(result.stdout, /Files to commit: \.claude\/dev-workflow\/config\.json, \.claude\/rules\/dev-workflow\/00-global\.md, .*\.claude\/dev-workflow\/rulebook\.lock\.json, \.claude\/settings\.json/);
  assert.doesNotMatch(result.stdout, /cw rules build|once built/);
  const config = JSON.parse(readFileSync(join(fx.root, '.claude/dev-workflow/config.json'), 'utf8'));
  assert.deepEqual([config.project.name, config.project.language], ['Acme Shop', { repo: 'en', productCopy: 'de' }]);
  assert.deepEqual(config.tickets, { source: 'local', keyPattern: '^[A-Z][A-Z0-9]+-[0-9]+$', contextPath: 'docs/tickets/{key}.md' });
});
