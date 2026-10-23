import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { readJson } from '../../cli/lib/fsx.mjs';
import {
  PHASES, TRANSITIONS, activeTasksOwnedBy, bumpStopBlocks, createTask, endTask, findTaskAwaitingAgent, listTasks,
  markStep, newTask, readTask, recordAgentStart, staleAgent, tasksAwaitingAgent, transition, updateTask,
} from '../../cli/lib/task.mjs';
import { loadWorkspace } from '../../cli/lib/workspace.mjs';
import { cw, makeInPlace, pluginRoot } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

// Runs node -e module scripts as processes that start their work at the same moment. spawnSync would
// run them one after another, and a lock test would pass without any lock.
function runTogether(scripts, env) {
  const startAt = Date.now() + 500;
  const barrier = `for (let left; (left = ${startAt} - Date.now()) > 0;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, left);\n`;
  return Promise.all(scripts.map((script) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `${barrier}${script}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => resolve({ status, stderr }));
  })));
}

const fields = (slug, extra = {}) => ({ ticket: 'APP-42', title: 'Add it', type: 'feature', slug, branch: `APP-42/feature/${slug}`, ownerSession: 's1', ...extra });

function setup(t) {
  const fx = makeInPlace(t);
  const ws = loadWorkspace({ cwd: fx.root });
  return { fx, ws };
}

test('every allowed transition succeeds and every other one names the allowed targets', () => {
  for (const from of Object.keys(TRANSITIONS)) {
    for (const to of PHASES) {
      const task = { id: 't', phase: from, outcome: null, history: [] };
      if (TRANSITIONS[from].includes(to)) {
        transition(task, to, { by: 'test' });
        assert.equal(task.phase, to);
      } else {
        assert.throws(() => transition(task, to), (error) => error.exitCode === 3 && error.fix.includes(TRANSITIONS[from].join(', ')), `${from} -> ${to}`);
      }
    }
  }
});

test('done needs deliver; an ended task refuses every change', () => {
  const task = { id: 't', phase: 'review', outcome: null, history: [] };
  assert.throws(() => endTask(task, 'done'), (error) => error.exitCode === 3);
  endTask(task, 'escalated', { note: 'user stopped' });
  assert.equal(task.outcome, 'escalated');
  assert.throws(() => transition(task, 'implement'), /has ended/);
  assert.throws(() => endTask(task, 'aborted'), /has ended already/);
});

test('create, update with a revision check, and the state.json index', (t) => {
  const { ws } = setup(t);
  const task = createTask(ws, newTask(ws, fields('add-it')));
  assert.equal(task.id, 'APP-42__feature__add-it');
  assert.equal(task.workTree, ws.workRepo);
  assert.throws(() => createTask(ws, newTask(ws, fields('add-it'))), (error) => /Choose another --slug/.test(error.fix));

  assert.throws(() => updateTask(ws, task.id, (x) => (x.title = 'lost'), { expectRev: 5 }), /changed while this command ran/);
  assert.equal(readTask(ws, task.id).title, 'Add it');
  updateTask(ws, task.id, (x) => transition(x, 'classify', { by: 'test' }), { expectRev: 0 });
  assert.equal(readTask(ws, task.id).rev, 1);

  const state = readJson(join(ws.stateDir, 'state.json'));
  assert.equal(state.tasks.length, 1);
  assert.deepEqual(Object.keys(state.tasks[0]).sort(), [
    'agents', 'areas', 'branch', 'complexity', 'cycle', 'descriptions', 'endedAt', 'id', 'maxReviewRounds', 'outcome',
    'ownerSession', 'packages', 'phase', 'prUrl', 'reviewRound', 'round', 'steps', 'ticket', 'title', 'updatedAt',
  ]);
  assert.equal(state.tasks[0].phase, 'classify');
  assert.deepEqual(activeTasksOwnedBy(ws, 's1').map((entry) => entry.id), [task.id]);
  assert.deepEqual(activeTasksOwnedBy(ws, 'other'), []);
});

test('an ended task leaves state.json after 10 minutes', (t) => {
  const { ws } = setup(t);
  const start = new Date('2026-10-19T10:00:00Z');
  const task = createTask(ws, newTask(ws, fields('end-it'), { now: start }), { now: start });
  updateTask(ws, task.id, (x) => endTask(x, 'aborted', { now: start }), { now: start });
  assert.equal(readJson(join(ws.stateDir, 'state.json')).tasks.length, 1);
  createTask(ws, newTask(ws, fields('later-one'), { now: new Date('2026-10-19T10:11:00Z') }), { now: new Date('2026-10-19T10:11:00Z') });
  assert.deepEqual(readJson(join(ws.stateDir, 'state.json')).tasks.map((entry) => entry.id), ['APP-42__feature__later-one']);
  assert.deepEqual(listTasks(ws).map((x) => x.id), ['APP-42__feature__later-one']);
  assert.equal(listTasks(ws, { all: true }).length, 2);
});

test('concurrent updates of different fields both land', async (t) => {
  const { fx, ws } = setup(t);
  const task = createTask(ws, newTask(ws, fields('race-it')));
  const lib = pathToFileURL(join(pluginRoot, 'cli', 'lib')).href;
  const script = (key) => `import { loadWorkspace } from '${lib}/workspace.mjs'; import { updateTask } from '${lib}/task.mjs';
const ws = loadWorkspace({ cwd: '${fx.root}' });
for (let i = 0; i < 20; i++) updateTask(ws, '${task.id}', (x) => { x.${key} = (x.${key} ?? 0) + 1; });`;
  const children = await runTogether(['counterA', 'counterB'].map(script), fx.env);
  for (const child of children) assert.equal(child.status, 0, child.stderr);
  const after = readTask(ws, task.id);
  assert.equal(after.counterA, 20);
  assert.equal(after.counterB, 20);
  assert.equal(after.rev, 40);
});

test('steps never go down; agents and stop blocks are recorded per agent', (t) => {
  const { ws } = setup(t);
  const task = createTask(ws, newTask(ws, fields('step-it')));
  markStep(ws, task.id, 3, 'tests');
  markStep(ws, task.id, 2, 'late');
  assert.deepEqual(readTask(ws, task.id).steps, { done: 3, total: 8, note: 'late' });

  updateTask(ws, task.id, (x) => {
    x.phase = 'implement';
    x.round = 1;
    x.complexity = 'm';
  });
  const implementer = { sessionId: 's1', role: 'implementer', agentType: 'dev-workflow:implementer-m' };
  assert.equal(findTaskAwaitingAgent(ws, implementer).id, task.id);
  assert.equal(findTaskAwaitingAgent(ws, { ...implementer, sessionId: 'other' }), null);
  assert.equal(findTaskAwaitingAgent(ws, { ...implementer, agentType: 'dev-workflow:implementer-s' }), null, 'an implementer of another complexity');
  assert.equal(findTaskAwaitingAgent(ws, { sessionId: 's1', role: 'reviewer', agentType: 'dev-workflow:reviewer' }), null);
  recordAgentStart(ws, task.id, { role: 'implementer', agentId: 'a1', agentType: 'dev-workflow:implementer-m', at: '2026-10-19T10:00:00.000Z' });
  assert.equal(findTaskAwaitingAgent(ws, implementer), null);
  assert.equal(readTask(ws, task.id).agents.implementer.round, 1);

  assert.equal(bumpStopBlocks(ws, task.id, 'a1'), 1);
  assert.equal(bumpStopBlocks(ws, task.id, 'a1'), 2);
  assert.equal(bumpStopBlocks(ws, task.id, 'a2'), 1);
});

test('SubagentStart takes an implementer only for a task of its complexity, and none when several tasks wait', (t) => {
  const { ws } = setup(t);
  const implementing = (slug, complexity) => {
    const task = createTask(ws, newTask(ws, fields(slug)));
    updateTask(ws, task.id, (x) => {
      x.phase = 'implement';
      x.round = 1;
      x.complexity = complexity;
    });
    return task.id;
  };
  // Worktree mode allows several tasks of one session in implement: A's Agent call was lost, B's runs.
  const a = implementing('first-task', 's');
  const b = implementing('second-task', 'm');
  const query = (agentType) => ({ sessionId: 's1', role: 'implementer', agentType });
  assert.equal(findTaskAwaitingAgent(ws, query('dev-workflow:implementer-m')).id, b);
  assert.equal(findTaskAwaitingAgent(ws, query('dev-workflow:implementer-s')).id, a);
  assert.equal(findTaskAwaitingAgent(ws, query('dev-workflow:implementer-l')), null);

  const c = implementing('third-task', 'm');
  assert.deepEqual(tasksAwaitingAgent(ws, query('dev-workflow:implementer-m')).map((task) => task.id).sort(), [b, c].sort());
  assert.equal(findTaskAwaitingAgent(ws, query('dev-workflow:implementer-m')), null, 'two tasks of that complexity wait: no guess');
});

test('SubagentStart records the agent from the hook input; with the owner session it is live, after a rebind stale', (t) => {
  const { fx, ws } = setup(t);
  // The fixture's CLAUDE_CODE_SESSION_ID is test-session; the task belongs to it (D3).
  const task = createTask(ws, newTask(ws, fields('agent-start', { ownerSession: 'test-session' })));
  updateTask(ws, task.id, (x) => {
    x.phase = 'implement';
    x.round = 1;
    x.complexity = 'm';
  });
  assert.equal(staleAgent(readTask(ws, task.id), 'implementer'), false, 'no agent yet');

  // The hook input carries session_id (the owner's: subagents share the main session's id, S3), agent_id
  // and agent_type (§9); the hook finds the task and records the start with exactly these fields.
  const input = { session_id: 'test-session', agent_id: 'agent-7', agent_type: 'dev-workflow:implementer-m' };
  const at = '2026-10-20T08:00:00.000Z';
  const awaiting = findTaskAwaitingAgent(ws, { sessionId: input.session_id, role: 'implementer', agentType: input.agent_type });
  assert.equal(awaiting.id, task.id);
  recordAgentStart(ws, awaiting.id, { role: 'implementer', agentId: input.agent_id, agentType: input.agent_type, at, session: input.session_id });
  const recorded = readTask(ws, task.id);
  assert.deepEqual(recorded.agents.implementer, { id: 'agent-7', type: 'dev-workflow:implementer-m', startedAt: at, round: 1, session: 'test-session' });
  assert.equal(staleAgent(recorded, 'implementer'), false, 'recorded with the owner session: live, SendMessage reaches it');
  assert.equal(readJson(join(ws.stateDir, 'state.json')).tasks[0].agents.implementer, 'agent-7');

  // O6: cw task agent in the owner session records the same id and keeps the start.
  const agent = cw(fx.root, ['task', 'agent', '--task', task.id, '--role', 'implementer', '--id', 'agent-7'], { env: fx.env });
  assert.equal(agent.code, 0, agent.stderr);
  assert.equal(agent.stderr, '', 'same id: no warning');
  assert.deepEqual(readTask(ws, task.id).agents.implementer, recorded.agents.implementer);
  assert.equal(staleAgent(readTask(ws, task.id), 'implementer'), false);

  // A rebind makes another session the owner (D3): the agent of the earlier session is stale.
  const { task: rebound } = updateTask(ws, task.id, (x) => {
    x.ownerSession = 'session-2';
  });
  assert.equal(staleAgent(rebound, 'implementer'), true);
  // A hook input without session_id is never taken for the owner's session.
  recordAgentStart(ws, task.id, { role: 'reviewer', agentId: 'agent-8', agentType: 'dev-workflow:reviewer', at });
  assert.equal(readTask(ws, task.id).agents.reviewer.session, null);
  assert.equal(staleAgent(readTask(ws, task.id), 'reviewer'), true);
});
