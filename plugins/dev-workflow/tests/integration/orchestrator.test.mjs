import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { cw, inPlaceConfig, makeInPlace, write } from '../fixtures/repo.mjs';

const spec = (branch) => `## Task: Add the mul helper

**Ticket:** NO-TICKET · **Type:** feature · **Branch:** ${branch}

### Context
\`src/sum.mjs\` has sum only.

### Requirements
- R1 Export mul(a, b) from src/mul.mjs.

### Acceptance criteria
- [ ] AC1 mul(2, 3) returns 6.

### Non-goals
- No division.

### Definition of done
- Checks pass.
`;

const state = (root) => JSON.parse(readFileSync(join(root, '.git', 'dev-workflow', 'state.json'), 'utf8'));

test('task new, ticket save, spec save and lint work from anywhere in the project', (t) => {
  const fx = makeInPlace(t);
  const run = (cwd, args, input) => cw(cwd, args, { env: fx.env, input });

  const created = run(fx.app, ['task', 'new', '--ticket', 'NO-TICKET', '--slug', 'mul-helper', '--title', 'Add the mul helper', '--type', 'feature', '--json']);
  assert.equal(created.code, 0, created.stderr);
  const { task, branch, ownerSession } = created.json();
  assert.equal(task, 'NO-TICKET__feature__mul-helper');
  assert.equal(branch, 'NO-TICKET/feature/mul-helper');
  assert.equal(ownerSession, 'test-session');
  assert.equal(state(fx.root).tasks[0].ownerSession, 'test-session');

  const snapshot = run(fx.base, ['ticket', 'save', '--task', task], '```json\n{ "key": "NO-TICKET", "summary": "Add mul", "source": "notes" }\n```');
  assert.equal(snapshot.code, 3, 'outside the project there is no config');
  assert.equal(run(fx.root, ['ticket', 'save', '--task', task], '{ "key": "NO-TICKET", "summary": "Add mul", "source": "notes" }').code, 0);

  const lintTemplate = run(fx.root, ['spec', 'lint', '--task', task, '--json']);
  assert.equal(lintTemplate.code, 1);
  assert.match(lintTemplate.json().details.errors.join('\n'), /still a placeholder/);

  assert.equal(run(fx.root, ['spec', 'save', '--task', task], spec(branch)).code, 0);
  const lint = run(join(fx.app, 'src'), ['spec', 'lint', '--task', task, '--json']);
  assert.equal(lint.code, 0, lint.stderr);
  assert.deepEqual(lint.json().warnings, [], 'src/sum.mjs is resolved in app/, not in the outer repo');

  const listed = run(fx.root, ['task', 'list', '--json']).json();
  assert.deepEqual(listed.tasks.map((x) => x.id), [task]);
  assert.equal(run(fx.root, ['task', 'show', '--task', task, '--json']).json().workTree, realpathSync(fx.app));
});

test('a second task for a ticket names the rebind; NO-TICKET tasks may run side by side', (t) => {
  const fx = makeInPlace(t);
  const run = (args, env = fx.env) => cw(fx.root, args, { env });
  assert.equal(run(['task', 'new', '--ticket', 'APP-42', '--slug', 'version-endpoint', '--title', 'Version', '--type', 'feature']).code, 0);
  const again = run(['task', 'new', '--ticket', 'APP-42', '--slug', 'other-thing', '--title', 'Other', '--type', 'feature']);
  assert.equal(again.code, 3);
  assert.match(again.stderr, /cw task new --rebind APP-42__feature__version-endpoint/);
  for (const slug of ['first-one', 'second-one']) assert.equal(run(['task', 'new', '--ticket', 'NO-TICKET', '--slug', slug, '--title', 'x', '--type', 'bugfix']).code, 0);
  assert.equal(run(['task', 'new', '--ticket', 'mm-1', '--slug', 'a-b', '--title', 'x', '--type', 'feature']).code, 2);
  assert.equal(run(['task', 'new', '--ticket', 'APP-1', '--slug', 'a-b', '--title', 'x', '--type', 'chore']).code, 2);

  const rebound = run(['task', 'new', '--rebind', 'APP-42__feature__version-endpoint', '--json'], { ...fx.env, CLAUDE_CODE_SESSION_ID: 'session-2' });
  assert.equal(rebound.code, 0, rebound.stderr);
  assert.deepEqual({ ...rebound.json(), previousOwner: rebound.json().previousOwner }, {
    task: 'APP-42__feature__version-endpoint', ticket: 'APP-42', phase: 'spec', round: 0, reviewRound: 0,
    previousOwner: 'test-session', ownerSession: 'session-2', resumeAt: 'O3', next: 'cw spec show --task APP-42__feature__version-endpoint', staleAgents: [],
  });
  assert.equal(state(fx.root).tasks.find((x) => x.ticket === 'APP-42').ownerSession, 'session-2');
  const { CLAUDE_CODE_SESSION_ID, ...noSession } = fx.env;
  assert.equal(run(['task', 'new', '--rebind', 'APP-42__feature__version-endpoint'], noSession).code, 3);
});

test('a rebind names the step to resume at in text and JSON alike; a confirmed task resumes at O6', (t) => {
  const fx = makeInPlace(t);
  const run = (args, input, env = fx.env) => cw(fx.root, args, { env, input });
  const id = run(['task', 'new', '--ticket', 'NO-TICKET', '--slug', 'mul-helper', '--title', 'Add the mul helper', '--type', 'feature', '--json']).json().task;
  assert.equal(run(['spec', 'save', '--task', id], spec('NO-TICKET/feature/mul-helper')).code, 0);
  assert.equal(run(['classify', '--task', id]).code, 0);
  assert.equal(run(['classify', '--task', id, '--set', 'l', '--why', 'A big one.']).code, 0);
  assert.equal(run(['task', 'confirm', '--task', id, '--note', 'The user confirmed l.']).code, 0);

  const session2 = { ...fx.env, CLAUDE_CODE_SESSION_ID: 'session-2' };
  const json = run(['task', 'new', '--rebind', id, '--json'], undefined, session2).json();
  // O5 is done: the user confirmed. The next step is O6, cw task start.
  assert.deepEqual([json.phase, json.resumeAt, json.next], ['confirm', 'O6', `cw task start --task ${id}`]);
  const text = run(['task', 'new', '--rebind', id], undefined, session2);
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stdout, `${id} (confirm), resume at O6. Next: cw task start --task ${id}\n`);
});

test('the NO-TICKET alias of the preset default key works for task list --ticket and ticket save', (t) => {
  const fx = makeInPlace(t, { config: inPlaceConfig({ git: {} }) });
  const run = (args, input) => cw(fx.root, args, { env: fx.env, input });
  const created = run(['task', 'new', '--ticket', 'NO-TICKET', '--slug', 'fix-readme', '--title', 'Fix the readme', '--type', 'bugfix', '--json']);
  assert.equal(created.code, 0, created.stderr);
  const id = created.json().task;
  assert.equal(id, 'maintenance__bugfix__fix-readme');
  for (const key of ['NO-TICKET', 'maintenance']) {
    assert.deepEqual(run(['task', 'list', '--ticket', key, '--json']).json().tasks.map((task) => task.id), [id], `--ticket ${key}`);
  }
  assert.equal(run(['task', 'list', '--ticket', 'mm-1']).code, 2, 'an invalid key is a usage error');
  const saved = run(['ticket', 'save', '--task', id], JSON.stringify({ key: 'NO-TICKET', summary: 'Fix the readme', source: 'notes' }));
  assert.equal(saved.code, 0, saved.stderr);
  assert.match(run(['ticket', 'save', '--task', id], JSON.stringify({ key: 'APP-1', summary: 'x', source: 'notes' })).stderr, /is APP-1, the task's ticket is maintenance/);
});

test('spec save after classification goes back to spec; ending needs the deliver phase for done', (t) => {
  const fx = makeInPlace(t);
  const run = (args, input) => cw(fx.root, args, { env: fx.env, input });
  const id = run(['task', 'new', '--ticket', 'NO-TICKET', '--slug', 'end-it', '--title', 'x', '--type', 'feature', '--json']).json().task;
  assert.equal(run(['task', 'confirm', '--task', id, '--note', 'ok']).code, 3, 'no complexity yet');
  assert.equal(run(['task', 'end', '--task', id, '--outcome', 'done']).code, 3);
  const bogus = run(['task', 'end', '--task', id, '--outcome', 'bogus']);
  assert.equal(bogus.code, 2, 'an unknown outcome is a usage error');
  assert.match(bogus.stderr, /Fix: Use --outcome done\|escalated\|aborted/);
  const ended = run(['task', 'end', '--task', id, '--outcome', 'aborted', '--json']);
  assert.equal(ended.code, 0, ended.stderr);
  assert.equal(ended.json().outcome, 'aborted');
  assert.deepEqual(run(['task', 'list', '--json']).json().tasks, []);
  assert.equal(run(['task', 'list', '--all', '--json']).json().tasks.length, 1);
  assert.equal(run(['spec', 'save', '--task', id], 'x').code, 3, 'an ended task takes no spec changes');
});

test('ticket context names the source and the ticket or context file of a key, from anywhere in the project', (t) => {
  const contextOf = (tickets, key) => {
    const fx = makeInPlace(t, { config: inPlaceConfig({ tickets }) });
    write(fx.root, { 'docs/specs/APP-123.md': '# Search filter\n' });
    return cw(fx.app, ['ticket', 'context', '--ticket', key], { env: fx.env });
  };
  const linear = { source: 'linear', contextPath: 'docs/specs/{key}.md' };
  const found = contextOf(linear, 'APP-123');
  assert.equal(found.code, 0, found.stderr);
  assert.match(found.stdout, /APP-123 · source linear: read the ticket as cw playbook read reference\/linear\.md describes\.\nContext file: docs\/specs\/APP-123\.md; read it as technical context\./);
  assert.match(contextOf(linear, 'APP-124').stdout, /Context file: docs\/specs\/APP-124\.md does not exist\./);
  assert.match(contextOf({ source: 'jira' }, 'APP-123').stdout, /source jira: .*reference\/jira\.md[^]*Context file: none \(tickets\.contextPath is not set\)/);
  assert.match(contextOf(linear, 'NO-TICKET').stdout, /NO-TICKET · no ticket/);

  const local = { source: 'local', contextPath: 'docs/specs/{key}.md' };
  assert.match(contextOf(local, 'APP-123').stdout, /APP-123 · source local: the ticket is docs\/specs\/APP-123\.md \(cw playbook read reference\/local\.md\)/);
  const fx = makeInPlace(t, { config: inPlaceConfig({ tickets: local }) });
  write(fx.root, { 'docs/specs/APP-123.md': '# Search filter\n' });
  assert.deepEqual(cw(fx.root, ['ticket', 'context', '--ticket', 'APP-123', '--json'], { env: fx.env }).json(), { ticket: 'APP-123', source: 'local', file: 'docs/specs/APP-123.md', exists: true });
  const missing = cw(fx.root, ['ticket', 'context', '--ticket', 'APP-124'], { env: fx.env });
  assert.equal(missing.code, 3);
  assert.match(missing.stderr, /docs\/specs\/APP-124\.md of APP-124 does not exist/);
  assert.equal(cw(fx.root, ['ticket', 'context'], { env: fx.env }).code, 2);
});
