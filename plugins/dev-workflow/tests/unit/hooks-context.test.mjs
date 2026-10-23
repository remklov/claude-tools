import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { quote } from '../../cli/lib/host/index.mjs';
import { loadWorkspace } from '../../cli/lib/workspace.mjs';
import { CONTEXT_MAX, agentContext, treeGitForm } from '../../hooks/lib/agent-context.mjs';
import { CACHE_FILE, canonical, loadHookWorkspace, locateProject, roleOf } from '../../hooks/lib/context.mjs';
import { addAgentWorktree, inPlaceConfig, makeInPlace, makeWorktreeRepo, tempBase, write } from '../fixtures/repo.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const FIELDS = ['configRoot', 'configPath', 'configDir', 'repoRoot', 'commonDir', 'stateDir', 'tasksDir', 'mode', 'appRoot', 'workRepo', 'pluginRoot'];
const pick = (ws) => Object.fromEntries(FIELDS.map((key) => [key, ws[key]]));
const hookWs = (cwd) => loadHookWorkspace(locateProject(cwd));

const task = (overrides = {}) => ({
  id: 'NO-TICKET__feature__mul-helper', ticket: 'NO-TICKET', title: 'Add the mul helper', round: 1, reviewRound: 0, packages: [], workTree: null, ...overrides,
});

test('roleOf reads the workflow roles from agent_type and nothing else', () => {
  assert.equal(roleOf('dev-workflow:implementer-s'), 'implementer');
  assert.equal(roleOf('dev-workflow:implementer-xl'), 'implementer');
  assert.equal(roleOf('dev-workflow:reviewer'), 'reviewer');
  for (const other of [undefined, null, '', 'Explore', 'general-purpose', 'dev-workflow:implementer-xxl', 'other:reviewer', 'dev-workflow:reviewer-2']) assert.equal(roleOf(other), null, String(other));
});

test('without a config the hooks have no project', (t) => {
  assert.equal(locateProject(tempBase(t)), null);
});

test('the hook workspace equals loadWorkspace, from the project, app/ and an agent worktree', (t) => {
  const inPlace = makeInPlace(t);
  for (const cwd of [inPlace.root, inPlace.app, join(inPlace.app, 'src')]) {
    assert.deepEqual(pick(hookWs(cwd).ws), pick(loadWorkspace({ cwd })), cwd);
    assert.deepEqual(hookWs(cwd).ws.config, loadWorkspace({ cwd }).config);
  }
  const single = makeWorktreeRepo(t);
  const agentTree = addAgentWorktree(single.root, single.env);
  for (const cwd of [single.root, agentTree]) assert.deepEqual(pick(hookWs(cwd).ws), pick(loadWorkspace({ cwd })), cwd);
  assert.equal(hookWs(agentTree).ws.stateDir, canonical(join(single.root, '.git', 'dev-workflow')), 'a worktree shares the main state dir');
});

test('config and pack guards are cached by mtime in the state dir and recomputed after a change', (t) => {
  const fx = makeInPlace(t, { config: inPlaceConfig({ packs: ['node-npm'] }) });
  const first = hookWs(fx.root);
  assert.deepEqual(first.guards.dependencyCommands.slice(0, 2), ['npm install', 'npm i']);
  const cacheFile = join(first.ws.stateDir, CACHE_FILE);
  assert.ok(existsSync(cacheFile));

  // Unchanged inputs: the cached value is used as it is.
  const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  cache.value.guards.commands = ['from-the-cache'];
  writeFileSync(cacheFile, JSON.stringify(cache));
  assert.deepEqual(hookWs(fx.root).guards.commands, ['from-the-cache']);

  // A changed config (other size and mtime) is read again.
  write(fx.root, { '.claude/dev-workflow/config.json': inPlaceConfig({ packs: ['node-npm'], guards: { commands: ['docker compose'], devServer: 'never' } }) });
  const changed = hookWs(fx.root);
  assert.deepEqual(changed.guards.commands, []);
  assert.deepEqual(changed.ws.config.guards, { ports: [], commands: ['docker compose'], devServer: 'never' });
});

test('a broken config throws, so the hook fails open and logs it', (t) => {
  const fx = makeInPlace(t, { config: { version: 1, project: {} } });
  const place = locateProject(fx.root);
  assert.ok(place.stateDir.endsWith(join('.git', 'dev-workflow')));
  assert.throws(() => loadHookWorkspace(place), /config .* is invalid/);
});

test('a worktree reviewer reads the implementer worktree with git -C relative to its own cwd', () => {
  assert.equal(treeGitForm('/p', '/p/.claude/worktrees/agent-1'), 'git -C .claude/worktrees/agent-1');
  assert.equal(treeGitForm('/p/.claude/worktrees/agent-1', '/p/.claude/worktrees/agent-1'), 'git');
  assert.equal(treeGitForm('/p/x', '/p/.claude/worktrees/agent-1'), 'git -C ../.claude/worktrees/agent-1');
  assert.equal(treeGitForm('/p', '/p/my tree'), "git -C 'my tree'");
});

test('the agent context names the task, the mode, the git form, the packages and the guards', (t) => {
  const fx = makeInPlace(t, { config: inPlaceConfig({ packs: ['node-npm'], guards: { ports: [5173], commands: ['docker compose'], devServer: 'never' } }) });
  const { ws, guards } = hookWs(fx.root);
  const implementer = agentContext({ ws, task: task(), role: 'implementer', guards, cwd: ws.cwd });
  assert.match(implementer, /you are the implementer of task NO-TICKET__feature__mul-helper \(NO-TICKET · Add the mul helper\) · round 1\./);
  assert.match(implementer, /Your brief file is named in your prompt/);
  assert.match(implementer, /Your preloaded playbook \(dev-workflow:implementer-playbook\) is the procedure/);
  assert.ok(implementer.includes(`Mode: in-place · work tree ${ws.workRepo}`));
  assert.match(implementer, /\nGit: `git -C app …` exactly in this form, from the project root \(your Bash cwd stays there; never cd\)/);
  assert.doesNotMatch(implementer, /\nNote: /, 'no note at the project root');
  assert.match(implementer, /- app \(path \.; areas backend\): test `node --test`/);
  assert.match(implementer, /no dependency commands \(npm install, npm i, .*\): report blocked/);
  assert.match(implementer, /blocked commands: docker compose/);
  assert.match(implementer, /ports 5173/);
  assert.match(implementer, /no dev servers/);
  assert.match(implementer, /pipe your JSON to `cw report save --task NO-TICKET__feature__mul-helper`/);
  assert.doesNotMatch(implementer, /read-only/);

  const reviewer = agentContext({ ws, task: task({ reviewRound: 1 }), role: 'reviewer', guards, cwd: ws.cwd });
  assert.match(reviewer, /review round 1\/3/);
  assert.match(reviewer, /Your preloaded playbook \(dev-workflow:reviewer-playbook\) is the procedure/);
  assert.match(reviewer, /\nGit: `git -C app …` exactly in this form/);
  assert.match(reviewer, /read-only: no git write commands/);
  assert.match(reviewer, /cw review save --task/);

  // A cwd inside app/: the same form as cw context and the brief, and the note cw context prints.
  const fromApp = agentContext({ ws, task: task(), role: 'implementer', guards, cwd: ws.workRepo });
  assert.match(fromApp, /\nGit: `git -C app …` exactly in this form/);
  assert.ok(fromApp.includes(`\nNote: the cwd ${ws.workRepo} is not the project root ${ws.configRoot}, and the git -C app … commands are relative to the project root, so from this cwd they name another directory. Use git -C ${quote(ws.workRepo)} … instead (it may ask for permission).`), fromApp);
});

test('worktree mode: plain git in the implementer worktree; the reviewer reads the recorded one', (t) => {
  const fx = makeWorktreeRepo(t);
  const tree = addAgentWorktree(fx.root, fx.env);
  const { ws, guards } = hookWs(tree);
  const implementer = agentContext({ ws, task: task(), role: 'implementer', guards, cwd: canonical(tree) });
  assert.ok(implementer.includes(`your own worktree ${canonical(tree)}`));
  assert.match(implementer, /plain `git …` in your worktree; no `git -C`/);
  const reviewer = agentContext({ ws, task: task({ workTree: canonical(tree) }), role: 'reviewer', guards, cwd: canonical(fx.root) });
  assert.match(reviewer, /`git -C \.claude\/worktrees\/agent-abc123 …` for log, diff, show and status/);
  assert.match(agentContext({ ws, task: task(), role: 'reviewer', guards, cwd: canonical(fx.root) }), /cw review scope names it/);
});

test('the agent context stays within 6,000 characters', (t) => {
  const packages = Array.from({ length: 60 }, (_, i) => ({ id: `pkg-${i}`, path: `packages/pkg-${i}`, areas: ['backend'], checks: { test: `npm test --workspace packages/pkg-${i} -- --reporter=verbose`, lint: `npm run lint --workspace packages/pkg-${i}` } }));
  const fx = makeInPlace(t, { config: inPlaceConfig({ packages }) });
  const { ws, guards } = hookWs(fx.root);
  const text = agentContext({ ws, task: task(), role: 'implementer', guards, cwd: ws.cwd });
  assert.ok(text.length <= CONTEXT_MAX, `${text.length} characters`);
  assert.match(text, /- pkg-0 \(path packages\/pkg-0; areas backend\): test, lint/, 'long package lists fall back to check names');
});
