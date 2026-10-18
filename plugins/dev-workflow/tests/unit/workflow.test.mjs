import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cw, git, makeProject } from '../helpers/repo.mjs';

const SPEC = `## Task: Add the product helper
**Ticket:** AB-2 · **Type:** feature · **Complexity:** s
**Branch:** ab-2-product-helper · **Builds on:** —

### Context
Add \`api/product.mjs\` next to \`api/sum.mjs\`.

### Requirements
- R1 Export product(a, b) returning a * b.

### Acceptance criteria
- [ ] AC1 product(2, 3) returns 6 (unit test).

### Non-goals
- No change to sum.

### Definition of done
- Checks pass
`;

test('a ticket runs from intake to a recorded PR', () => {
  const { root } = makeProject();
  const id = 'ab-2-product-helper';
  assert.equal(cw(root, ['intake', 'AB-2']).code, 0);
  assert.equal(cw(root, ['task', 'new', '--ticket', 'AB-2', '--slug', 'product-helper', '--title', 'Add the product helper']).code, 0);
  assert.equal(cw(root, ['spec', 'save', '--task', id], { input: SPEC }).code, 0);
  assert.equal(cw(root, ['spec', 'lint', '--task', id]).code, 0);
  const classified = JSON.parse(cw(root, ['classify', '--task', id, '--json']).stdout);
  assert.deepEqual(classified.packages, ['api']);
  assert.equal(classified.minComplexity, 's');
  assert.equal(cw(root, ['classify', '--task', id, '--set', 's', '--why', 'One new file']).code, 0);
  const start = JSON.parse(cw(root, ['task', 'start', '--task', id]).stdout);
  assert.equal(start.agent, 'dev-workflow:implementer-s');
  assert.equal(start.description, 'AB-2 · Add the product helper');
  assert.ok(existsSync(start.brief));
  assert.equal(JSON.parse(cw(root, ['ticket', 'claims', '--json']).stdout)[0].phase, 'implement');

  // The implementer in its worktree (what Claude Code's worktree isolation creates).
  const wt = join(root, '.claude/worktrees/agent-1');
  git(root, 'worktree', 'add', '-q', wt, '-b', 'worktree-agent-1', 'HEAD');
  assert.equal(cw(wt, ['ws', 'setup', '--task', id]).code, 0);
  assert.equal(git(wt, 'branch', '--show-current'), id);
  writeFileSync(join(wt, 'api/product.mjs'), 'export const product = (a, b) => a * b;\n');
  writeFileSync(join(wt, 'api/product.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert';\nimport { product } from './product.mjs';\ntest('multiplies', () => assert.equal(product(2, 3), 6));\n");
  const proof = cw(wt, ['prove', '--task', id, '--test', 'api:api/product.test.mjs', '--change', 'api/product.mjs', '--json']);
  assert.equal(proof.code, 0, proof.stdout + proof.stderr);
  assert.equal(JSON.parse(proof.stdout).failedWithout, true);
  const checks = cw(wt, ['checks', '--task', id, '--json']);
  assert.equal(checks.code, 0, checks.stdout);
  assert.deepEqual(JSON.parse(checks.stdout).packages.map((p) => p.id), ['api']);
  git(wt, 'add', '-A');
  const msgFile = join(wt, '..', 'msg.txt');
  assert.equal(cw(wt, ['commit', 'msg', '--task', id, '--summary', 'Add the product helper', '--out', msgFile]).code, 0);
  assert.equal(readFileSync(msgFile, 'utf8'), 'Add the product helper (AB-2)\n');
  git(wt, 'commit', '-q', '-F', msgFile);
  assert.equal(cw(wt, ['git', 'lint', '--task', id]).code, 0);
  const incomplete = cw(wt, ['report', 'save', '--task', id], { input: JSON.stringify({ status: 'done', acceptanceCriteria: [] }) });
  assert.equal(incomplete.code, 1);
  assert.match(incomplete.stderr, /AC1 from the spec is missing/);
  const saved = cw(wt, ['report', 'save', '--task', id], { input: JSON.stringify({ status: 'done', acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'api/product.test.mjs › multiplies' }], openPoints: [] }) });
  assert.equal(saved.code, 0, saved.stderr);

  // Orchestrator: review.
  const review = JSON.parse(cw(root, ['task', 'review', '--task', id]).stdout);
  assert.equal(review.agent, 'dev-workflow:reviewer');
  const mutation = cw(wt, ['mutate', '--task', id, '--test', 'api:api/product.test.mjs', '--remove', 'api/product.mjs:1-1', '--replace', 'export const product = () => 0;']);
  assert.equal(mutation.code, 0, mutation.stdout + mutation.stderr);
  const applicable = JSON.parse(cw(wt, ['rules', 'applicable', '--task', id, '--json']).stdout).rules.map((rule) => rule.id);
  const skipping = cw(wt, ['review', 'save', '--task', id], { input: JSON.stringify({ status: 'approved', checks: [{ package: 'api', check: 'test', result: 'pass' }], acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'test' }], rulesChecked: ['CORE-SCOPE'], findings: [] }) });
  assert.match(skipping.stderr, /rulesChecked lacks/);
  const approved = cw(wt, ['review', 'save', '--task', id], { input: JSON.stringify({ status: 'approved', checks: [{ package: 'api', check: 'test', result: 'pass' }], acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'test' }], rulesChecked: applicable, findings: [] }) });
  assert.equal(approved.code, 0, approved.stderr);

  // Deliver.
  assert.equal(cw(root, ['base-moved', '--task', id]).code, 0);
  const body = JSON.parse(cw(root, ['pr', 'body', '--task', id, '--json']).stdout).body;
  assert.match(body, /## What & why/);
  assert.match(body, /node --test/);
  assert.equal(cw(root, ['pr', 'record', '--task', id, '--url', 'https://example.com/pr/1']).code, 0);
  assert.equal(cw(root, ['task', 'end', '--task', id, '--outcome', 'done']).code, 0);
  const state = JSON.parse(readFileSync(join(root, '.git/dev-workflow/state.json'), 'utf8'));
  assert.equal(state.tasks[0].phase, 'done');
  assert.equal(JSON.parse(cw(root, ['ticket', 'claims', '--json']).stdout)[0].prUrl, 'https://example.com/pr/1');
});

test('l and xl need confirmation; going below the minimum needs an override', () => {
  const { root } = makeProject();
  const id = 'ab-1-auth-sum';
  cw(root, ['intake', 'AB-1']);
  cw(root, ['task', 'new', '--ticket', 'AB-1', '--slug', 'auth-sum', '--title', 'Guard sum behind auth']);
  cw(root, ['spec', 'save', '--task', id], { input: SPEC.replace('AB-2', 'AB-1').replace('ab-2-product-helper', id).replace('Add the product helper', 'Guard sum behind auth').replace('- R1 Export', '- R1 Check auth and export') });
  cw(root, ['classify', '--task', id]);
  assert.equal(cw(root, ['classify', '--task', id, '--set', 'm', '--why', 'x']).code, 3);
  assert.equal(cw(root, ['classify', '--task', id, '--set', 'xl', '--why', 'auth']).code, 0);
  assert.equal(cw(root, ['task', 'start', '--task', id]).code, 3);
  assert.equal(cw(root, ['task', 'confirm', '--task', id, '--note', 'ok']).code, 0);
  assert.equal(JSON.parse(cw(root, ['task', 'start', '--task', id]).stdout).agent, 'dev-workflow:implementer-xl');
});

test('aborting a task releases its claim', () => {
  const { root } = makeProject();
  cw(root, ['intake', 'AB-2']);
  cw(root, ['task', 'new', '--ticket', 'AB-2', '--slug', 'product-helper', '--title', 'x']);
  assert.equal(cw(root, ['task', 'end', '--task', 'ab-2-product-helper', '--outcome', 'aborted']).code, 0);
  assert.deepEqual(JSON.parse(cw(root, ['ticket', 'claims', '--json']).stdout), []);
});

test('cw init --write installs profile, settings, gitignore, merge driver, snippet and rules', () => {
  const { root, base } = makeProject({ withProfile: false });
  const detected = JSON.parse(cw(root, ['init', '--detect', '--json']).stdout);
  assert.ok(detected.detectedPacks.some((pack) => pack.id === 'postgres-sql' && pack.variant === 'numbered-sql'));
  const profileFile = join(base, 'profile.json');
  const profile = { ...detected.profile, packs: ['core', 'node-npm', { id: 'postgres-sql', variant: 'numbered-sql', options: { dir: 'api/migrations' } }] };
  writeFileSync(profileFile, JSON.stringify(profile));
  writeFileSync(join(root, '.gitignore'), '.claude/*\n!.claude/settings.json\n');
  writeFileSync(join(root, '.claude-settings-local-marker'), '');
  const result = cw(root, ['init', '--write', '--profile', profileFile]);
  assert.equal(result.code, 0, result.stderr);
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.enabledPlugins['dev-workflow@remklov'], true);
  assert.ok(settings.permissions.deny.includes('Agent(model:*)'));
  assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /!\.claude\/workflow\//);
  assert.match(readFileSync(join(root, '.gitattributes'), 'utf8'), /plan\/NEXT_STEPS\.md merge=dw-ticket-table/);
  assert.match(git(root, 'config', '--get', 'merge.dw-ticket-table.driver'), /cw merge-driver/);
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /dev-workflow:start/);
  assert.ok(existsSync(join(root, '.claude/rules/workflow/00-global.md')));
});
