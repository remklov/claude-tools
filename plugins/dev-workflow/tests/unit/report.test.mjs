import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withDefaults } from '../../cli/lib/config.mjs';
import {
  devReportProblems, fence, parseAgentJson, validateDevReportInput, validateReviewInput, validateSavedDevReport,
} from '../../cli/lib/report.mjs';
import { inPlaceConfig } from '../fixtures/repo.mjs';

const done = {
  status: 'done',
  acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'src/mul.test.mjs › multiplies' }],
  openPoints: ['manual check of the UI', { text: 'follow up', tag: 'follow-up' }],
};

test('parseAgentJson: raw JSON or the last ```json fence; anything else is exit 1', () => {
  assert.deepEqual(parseAgentJson(' {"a": 1} '), { a: 1 });
  assert.deepEqual(parseAgentJson('Here:\n```json\n{"a": 1}\n```\nand finally\n```json\n{"a": 2}\n```\n'), { a: 2 });
  assert.equal(parseAgentJson(fence({ b: true })).b, true);
  assert.throws(() => parseAgentJson('{"a": '), (error) => error.exitCode === 1 && /not valid JSON/.test(error.message));
  assert.throws(() => parseAgentJson('text\n```json\n{oops}\n```'), (error) => error.exitCode === 1 && /last ```json fence/.test(error.message));
});

test('validateDevReportInput: the schema and the status rules', () => {
  assert.deepEqual(validateDevReportInput(done), []);
  const errorsOf = (patch) => validateDevReportInput({ ...done, ...patch });
  assert.match(errorsOf({ status: 'finished' })[0], /^\$\.status: must be one of done, blocked, misclassified/);
  assert.match(errorsOf({ acceptanceCriteria: [{ id: 'A1', met: true, evidence: 'x' }] })[0], /\$\.acceptanceCriteria\[0\]\.id: must match/);
  assert.match(errorsOf({ acceptanceCritera: [] })[0], /is not allowed/);
  assert.match(errorsOf({ acceptanceCriteria: [{ id: 'AC1', met: false, evidence: '' }] })[0], /AC1 is not met; status cannot be done/);
  assert.match(errorsOf({ acceptanceCriteria: [{ id: 'AC1', met: true, evidence: ' ' }] })[0], /AC1 has no evidence/);
  assert.match(errorsOf({ acceptanceCriteria: [done.acceptanceCriteria[0], done.acceptanceCriteria[0]] })[0], /AC1 more than once/);
  assert.match(errorsOf({ status: 'blocked' })[0], /status blocked needs blocked: \{ question, needed \}/);
  assert.match(errorsOf({ status: 'blocked', blocked: { question: 'Which API?' } })[0], /blocked\.needed: is required/);
  assert.deepEqual(errorsOf({ status: 'blocked', blocked: { question: 'Which API?', needed: 'a decision' } }), []);
  assert.match(errorsOf({ blocked: { question: 'q', needed: 'n' } })[0], /blocked must be null unless status is blocked/);
  assert.match(errorsOf({ status: 'misclassified', misclassified: { reason: 'r', suggested: 'xxl' } })[0], /suggested: must be one of s, m, l, xl/);
  assert.deepEqual(errorsOf({ status: 'misclassified', misclassified: { reason: 'needs a schema change', suggested: 'l' }, blocked: null }), []);
});

test('validateSavedDevReport accepts what report save writes and refuses a file without savedAt', () => {
  const saved = { kind: 'dev-report', version: 1, task: 't', round: 1, savedAt: '2026-10-19T10:00:00.000Z', ...done, openPoints: [{ text: 'x' }], risks: [], blocked: null, misclassified: null, head: 'abc', checks: {} };
  assert.deepEqual(validateSavedDevReport(saved), []);
  assert.match(validateSavedDevReport({ ...saved, savedAt: null })[0], /savedAt/);
  assert.match(validateSavedDevReport({ ...saved, round: 0 })[0], /round/);
  assert.match(validateSavedDevReport({ ...saved, status: 'nope' })[0], /status/);
});

test('validateReviewInput: status, findings and rule references', () => {
  const approved = { status: 'approved', acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'P1 holds' }], rulesChecked: ['CORE-SCOPE', 'TS-NO-ANY'], findings: [], summary: 'fine' };
  assert.deepEqual(validateReviewInput(approved), []);
  const blocking = { id: 'F1', severity: 'blocking', rule: 'CORE-SCOPE', file: 'src/a.ts', line: 3, issue: 'out of scope' };
  const errorsOf = (patch) => validateReviewInput({ ...approved, ...patch });
  assert.match(errorsOf({ findings: [blocking] })[0], /approved with blocking findings: F1/);
  assert.match(errorsOf({ acceptanceCriteria: [{ id: 'AC1', met: false, evidence: 'missing' }] })[0], /unmet acceptance criteria: AC1/);
  assert.match(errorsOf({ status: 'changes_requested' })[0], /changes_requested needs at least one blocking finding/);
  assert.deepEqual(errorsOf({ status: 'changes_requested', findings: [blocking] }), []);
  assert.match(errorsOf({ status: 'changes_requested', findings: [{ ...blocking, rule: 'REACT-A11Y' }] })[0], /F1 cites REACT-A11Y, which is not in rulesChecked/);
  assert.deepEqual(errorsOf({ findings: [{ ...blocking, severity: 'non_blocking', rule: 'correctness', sendAlong: true }] }), []);
  assert.match(errorsOf({ status: 'changes_requested', findings: [{ ...blocking, sendAlong: true }] })[0], /sendAlong marks non-blocking findings only/);
  assert.match(errorsOf({ findings: [{ ...blocking, severity: 'minor' }] })[0], /severity: must be one of blocking, non_blocking/);
  assert.match(errorsOf({ acceptanceCriteria: [{ id: 'AC1', met: true, evidence: '' }] })[0], /evidence: must not be empty/);
  assert.match(errorsOf({ rulesChecked: ['core-scope'] })[0], /rulesChecked\[0\]: must match/);
});

const config = withDefaults(inPlaceConfig({ packages: [{ id: 'app', path: '.', areas: ['backend'] }, { id: 'docs', path: 'docs', areas: ['docs'] }] }));
const SPEC = '### Acceptance criteria\n- [ ] AC1 multiplies\n';
const task = { id: 't', type: 'feature', branch: 'NO-TICKET/feature/mul-helper' };
const passing = { file: '/s/checks-1.json', data: { tree: 'tree1', overall: 'pass', only: [], packages: [{ id: 'app' }] } };
const goodState = {
  workTree: '/w', onBranch: true, branchNow: task.branch, dirty: [], tree: 'tree1', commits: [], added: [], changedFiles: ['src/mul.mjs'],
  checks: { latest: passing, current: passing },
};
const problems = (patch = {}, { report = { ...done, proofs: [] }, specText = SPEC, kind = task } = {}) =>
  devReportProblems({ ws: { config }, task: kind, report, state: { ...goodState, ...patch }, specText });

test('devReportProblems: every done rule names its fix', () => {
  // Commits are linted in the integration test; here the state has none, which is its own error.
  assert.deepEqual(problems().errors, [`no commits on ${task.branch} since the base: commit your work (step 6)`]);
  const errorsOf = (...args) => problems(...args).errors.filter((error) => !/no commits/.test(error));
  assert.deepEqual(errorsOf(), []);
  assert.match(errorsOf({}, { specText: null })[0], /has no spec\.md/);
  assert.match(errorsOf({}, { specText: '### Acceptance criteria\n- [ ] AC1 x\n- [ ] AC2 y\n' })[0], /AC2 from the spec is missing in acceptanceCriteria/);
  assert.match(errorsOf({}, { specText: '### Acceptance criteria\n- [ ] AC2 y\n' }).join('\n'), /AC1 is not an acceptance criterion of the spec \(AC2\)/);
  assert.match(errorsOf({ workTree: null })[0], /no work tree: run cw ws setup --task t/);
  assert.match(errorsOf({ onBranch: false })[0], /does not exist in \/w: run cw ws setup/);
  assert.match(errorsOf({ branchNow: 'main' })[0], /\/w is on main, not on the task branch/);
  assert.match(errorsOf({ dirty: ['src/x.mjs'] })[0], /uncommitted changes \(src\/x\.mjs\): commit them/);
  assert.match(errorsOf({ checks: { latest: null, current: null } })[0], /no checks result: run cw checks --changed --task t/);
  assert.match(errorsOf({ tree: 'tree2', checks: { latest: passing, current: null } })[0], /older state \(tree tree1, now tree2\): run cw checks --changed --task t again/);
  const failing = { ...passing, data: { ...passing.data, overall: 'fail' } };
  assert.match(errorsOf({ checks: { latest: failing, current: failing } })[0], /checks are fail/);
  assert.match(errorsOf({ changedFiles: ['src/mul.mjs', 'docs/a.md'] })[0], /did not cover docs/);
  const only = { ...passing, data: { ...passing.data, only: ['lint'] } };
  assert.match(errorsOf({ checks: { latest: only, current: only } })[0], /did not cover every check \(--only\)/);
  assert.match(errorsOf({}, { kind: { ...task, type: 'bugfix' } })[0], /a bug fix needs the regression test's failing run: cw prove/);
  assert.deepEqual(errorsOf({}, { kind: { ...task, type: 'bugfix' }, report: { ...done, proofs: [{ holds: true, testPath: 'src/mul.test.mjs' }] } }), []);
  assert.deepEqual(problems({ added: ['src/mul.test.mjs', 'src/mul.mjs'] }).warnings, ['the new test src/mul.test.mjs has no holding proof (cw prove)']);
});

test('devReportProblems: no-package checks name the config, not failures to fix', () => {
  const noPackage = { ...passing, data: { ...passing.data, overall: 'no-package', packages: [], unowned: ['notes/a.md'] } };
  const { errors } = problems({ checks: { latest: noPackage, current: noPackage } });
  assert.deepEqual(errors.filter((error) => !/no commits/.test(error)), [
    'the changed files notes/a.md belong to no package: run cw checks --task t --package <id> for the package that uses them, or report blocked so the orchestrator adds a package (packages[].path)',
  ]);
});

test('devReportProblems: a committed node_modules path is refused with the command that removes it', () => {
  const errorsOf = (ws) => devReportProblems({ ws, task, report: { ...done, proofs: [] }, state: { ...goodState, added: ['node_modules', 'web/node_modules', 'src/node_modules.mjs'] }, specText: SPEC }).errors
    .filter((error) => !/no commits/.test(error));
  assert.deepEqual(errorsOf({ config, mode: 'worktree' }), [
    'the commits add node_modules, web/node_modules (node_modules is never committed; a link from worktree.symlinkDirectories passes a "node_modules/" ignore pattern): git rm --cached node_modules web/node_modules, commit (step 6), then save the report again',
  ]);
  assert.match(errorsOf({ config, mode: 'in-place' })[0], /: git -C app rm --cached node_modules web\/node_modules, commit/, 'relative to the project root');
});

test('devReportProblems: stale proofs are shown as warnings and not counted for a bug fix', () => {
  const stale = [{ id: 'P1', test: 'app:src/mul.test.mjs', reason: 'the test file src/mul.test.mjs no longer exists at HEAD' }];
  const { errors, warnings } = problems({}, { kind: { ...task, type: 'bugfix' }, report: { ...done, proofs: [], staleProofs: stale } });
  assert.match(errors.join('\n'), /a bug fix needs the regression test's failing run/);
  assert.deepEqual(warnings, ['P1 (app:src/mul.test.mjs) is stale and not counted: the test file src/mul.test.mjs no longer exists at HEAD; run cw prove for the test as it is now']);
});
