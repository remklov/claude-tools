// Shared steps of the delegation cycle tests: the orchestrator's commands up to the classification,
// one implementer round with the real implementer commands, and the review file cw review save leaves.
// Helpers here never end in .test.mjs, so the test glob does not run them.
import assert from 'node:assert/strict';

import { readJson, writeJson } from '../../cli/lib/fsx.mjs';
import { loadWorkspace, taskPath } from '../../cli/lib/workspace.mjs';
import { cw, gitIn, inPlaceConfig, makeInPlace, write } from '../fixtures/repo.mjs';

// In-process lib calls (loadWorkspace here and in the tests that import this module) spawn git with
// process.env: keep them away from the developer's git config, as hermeticEnv does for cw.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

export const spec = (branch, requirements = '- R1 Export mul(a, b) from src/mul.mjs.') => `## Task: Add the mul helper

**Ticket:** NO-TICKET · **Type:** feature · **Branch:** ${branch}

### Context
\`src/sum.mjs\` has sum only.

### Requirements
${requirements}

### Acceptance criteria
- [ ] AC1 mul(2, 3) returns 6.

### Non-goals
- No division.

### Definition of done
- Checks pass.
`;

export const MUL = {
  'src/mul.mjs': 'export const mul = (a, b) => a * b;\n',
  'src/mul.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { mul } from './mul.mjs';\n\ntest('multiplies', () => assert.equal(mul(2, 3), 6));\n",
};
// A second round's change: mul rejects non-numbers.
export const STRICT_MUL = { 'src/mul.mjs': "export const mul = (a, b) => {\n  if (typeof a !== 'number' || typeof b !== 'number') throw new TypeError('mul takes numbers');\n  return a * b;\n};\n" };
// The fixture package with a single-test command, so cw prove runs without a test-runner pack.
export const PACKAGES = [{ id: 'app', path: '.', areas: ['backend'], checks: { test: 'node --test' }, testSingle: 'node --test {file}' }];
export const inPlace = (t, overrides = {}) => makeInPlace(t, { config: inPlaceConfig({ packages: PACKAGES, ...overrides }) });

// The handover every report carries (ADR 0012); the empty one fits a report that stopped early.
export const HANDOVER = {
  decisions: ['mul stays a plain arrow function: the spec names no input checks'],
  rejected: ['A shared math module: out of scope'],
  testing: ['cw checks --changed; one test: node --test src/mul.test.mjs'],
  pitfalls: [],
  deviations: [],
};
export const NO_HANDOVER = { decisions: [], rejected: [], testing: [], pitfalls: [], deviations: [] };
export const DONE = { status: 'done', acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'src/mul.test.mjs › multiplies' }], handover: HANDOVER };
export const BLOCKED = { status: 'blocked', acceptanceCriteria: [], blocked: { question: 'Integers only?', needed: 'a decision' }, handover: NO_HANDOVER };
export const misclassified = (suggested) => ({ status: 'misclassified', acceptanceCriteria: [], misclassified: { reason: 'It is bigger.', suggested }, handover: NO_HANDOVER });

export function harness(fx) {
  const run = (cwd, args, input) => cw(cwd, args, { env: fx.env, input });
  const ok = (cwd, args, input) => {
    const result = run(cwd, [...args, '--json'], input);
    assert.equal(result.code, 0, `cw ${args.join(' ')}: ${result.stderr}`);
    return result.json();
  };
  return { run, ok };
}

// task new, ticket save, spec save, classify and the choice of the complexity.
export function specified(fx, { slug = 'mul-helper', complexity = 's' } = {}) {
  const { ok } = harness(fx);
  const { task: id, branch } = ok(fx.root, ['task', 'new', '--ticket', 'NO-TICKET', '--slug', slug, '--title', 'Add the mul helper', '--type', 'feature']);
  ok(fx.root, ['ticket', 'save', '--task', id], JSON.stringify({ key: 'NO-TICKET', summary: 'Add mul', source: 'notes' }));
  ok(fx.root, ['spec', 'save', '--task', id], spec(branch));
  const classified = ok(fx.root, ['classify', '--task', id]);
  ok(fx.root, ['classify', '--task', id, '--set', complexity, '--why', 'One small helper.']);
  return { id, branch, classified };
}

// One implementer round with the real commands: ws setup (from cwd), change, checks, commit, report.
export function implement(fx, id, { cwd, tree, files = MUL, summary = 'Add the mul helper', prove = true, report = DONE }) {
  const { ok } = harness(fx);
  ok(cwd, ['ws', 'setup', '--task', id]);
  write(tree, files);
  ok(cwd, ['checks', '--changed', '--task', id]);
  const git = gitIn(tree, fx.env);
  git('add', '-A');
  const { file } = ok(cwd, ['commit', 'msg', '--task', id, '--summary', summary, '--keyword', 'FEATURE']);
  git('commit', '-q', '-F', file);
  if (prove) ok(cwd, ['prove', '--task', id, '--test', 'app:src/mul.test.mjs', '--change', 'src/mul.mjs']);
  ok(cwd, ['checks', '--changed', '--task', id]);
  return ok(cwd, ['report', 'save', '--task', id], JSON.stringify(report));
}

// What cw review save leaves for the round (the reviewer area's command).
export function writeReview(fx, id, round, status, { findings = [], head } = {}) {
  const ws = loadWorkspace({ cwd: fx.root });
  const task = readJson(taskPath(ws, id, 'task.json'));
  writeJson(taskPath(ws, id, `review-${round}.json`), {
    kind: 'review', version: 1, task: id, round, reviewRound: task.reviewRound, savedAt: new Date().toISOString(), status,
    acceptanceCriteria: [{ id: 'AC1', met: status === 'approved', evidence: 'src/mul.test.mjs' }], rulesChecked: ['CORE-SCOPE'], findings, summary: null, head,
  });
}

export const taskJson = (fx, id) => readJson(taskPath(loadWorkspace({ cwd: fx.root }), id, 'task.json'));
export const blocking = { id: 'F1', severity: 'blocking', rule: 'CORE-ERRORS', file: 'src/mul.mjs', line: 1, issue: 'No input check', suggestion: 'Reject non-numbers' };
