import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withDefaults } from '../../cli/lib/config.mjs';
import { nonGoalHints, proofRecheckSince, reviewStateProblems, significantWords, validateSavedReview } from '../../cli/lib/review.mjs';
import { inPlaceConfig } from '../fixtures/repo.mjs';

test('significantWords: lowercase words of 4+ letters in any script, without stop words', () => {
  assert.deepEqual(significantWords('No changes to the Billing API or its e-mail templates'), ['billing', 'mail', 'templates']);
  assert.deepEqual(significantWords('Keine Übersetzungen der Größen'), ['keine', 'übersetzungen', 'größen']);
  assert.deepEqual(significantWords('Nothing about other things, nothing'), ['things']);
});

test('nonGoalHints: changed files whose path holds a significant word; non-goals without a hit are left out', () => {
  const files = ['src/Billing/invoice.ts', 'src/sum3.test.mjs', 'README.md', 'src/other.mjs'];
  const nonGoals = ['No changes to the billing API', 'Touching the test helpers', 'Rounding of the results', 'Nothing about other modules'];
  assert.deepEqual(nonGoalHints(nonGoals, files), [
    { nonGoal: 'No changes to the billing API', words: ['billing'], files: ['src/Billing/invoice.ts'] },
    { nonGoal: 'Touching the test helpers', words: ['test'], files: ['src/sum3.test.mjs'] },
  ]);
  assert.deepEqual(nonGoalHints([], files), []);
  assert.deepEqual(nonGoalHints(nonGoals, []), []);
});

test('proofRecheckSince: only the latest recheck, and only when it is newer than the report', () => {
  const rechecks = [{ at: '2026-10-19T10:01:00.000Z', allHold: true }, { at: '2026-10-19T10:03:00.000Z', allHold: false }];
  assert.equal(proofRecheckSince(rechecks, '2026-10-19T10:02:00.000Z'), rechecks[1]);
  assert.equal(proofRecheckSince(rechecks, '2026-10-19T10:03:00.000Z'), null);
  assert.equal(proofRecheckSince(rechecks, null), null);
  assert.equal(proofRecheckSince([], '2026-10-19T10:00:00.000Z'), null);
});

const config = withDefaults(inPlaceConfig({ packages: [{ id: 'app', path: '.', areas: ['backend'] }, { id: 'docs', path: 'docs', areas: ['docs'] }] }));
const task = { id: 't', type: 'feature', branch: 'NO-TICKET/feature/mul-helper', round: 1, reviewRound: 1 };
const SPEC = '### Acceptance criteria\n- [ ] AC1 multiplies\n';
const RULES = ['CORE-SCOPE', 'CORE-TEST-SPEC'];
const approved = { status: 'approved', acceptanceCriteria: [{ id: 'AC1', met: true, evidence: 'P1 holds' }], rulesChecked: RULES, findings: [], summary: 'fine' };
const blocking = (rule) => ({ id: 'F1', severity: 'blocking', rule, file: 'src/mul.mjs', issue: 'x' });
const changesRequested = { ...approved, status: 'changes_requested', findings: [blocking('CORE-SCOPE')] };
const passing = { file: '/s/checks-1.json', data: { tree: 'tree1', overall: 'pass', only: [], packages: [{ id: 'app' }] } };
const goodState = {
  workTree: '/w', onBranch: true, branchNow: task.branch, dirty: [], tree: 'tree1', head: 'h1', changedFiles: ['src/mul.mjs'],
  checks: { latest: passing, current: passing },
};
const facts = {
  config, task, input: approved, specText: SPEC, applicableIds: RULES, state: goodState,
  proofs: [{ id: 'P1', holds: true }], rechecks: [{ at: '2026-10-19T10:05:00.000Z', head: 'h1', allHold: true }], reportSavedAt: '2026-10-19T10:00:00.000Z',
};
const problems = (patch = {}, state = {}) => reviewStateProblems({ ...facts, ...patch, state: { ...goodState, ...state } });
const only = (patch, state) => {
  const errors = problems(patch, state);
  assert.equal(errors.length, 1, errors.join('\n'));
  return errors[0];
};

test('reviewStateProblems: an approved review in a good state passes; so does a request for changes', () => {
  assert.deepEqual(problems(), []);
  assert.deepEqual(problems({ input: changesRequested }), []);
  assert.deepEqual(problems({ input: { ...approved, rulesChecked: [...RULES, 'CORE-SCOPE'] } }), [], 'rulesChecked is compared as a set');
});

test('reviewStateProblems: the acceptance criteria of the spec, each once and no other', () => {
  assert.match(only({ specText: null }), /^task t has no spec\.md: end your turn and tell the orchestrator in one line$/);
  assert.match(only({ specText: '### Acceptance criteria\n' }), /the spec lists no acceptance criteria/);
  assert.match(only({ specText: `${SPEC}- [ ] AC2 divides\n` }), /^AC2 from the spec is missing in acceptanceCriteria: add it/);
  const extra = { ...approved, acceptanceCriteria: [...approved.acceptanceCriteria, { id: 'AC2', met: true, evidence: 'x' }] };
  assert.match(only({ input: extra }), /^AC2 is not an acceptance criterion of the spec \(AC1\): remove it$/);
});

test('reviewStateProblems: rulesChecked equals the applicable rules, naming the missing and the extra ones', () => {
  assert.match(only({ input: { ...approved, rulesChecked: ['CORE-SCOPE'] } }), /^rulesChecked misses CORE-TEST-SPEC: check every rule that cw rules applicable --task t lists$/);
  assert.match(only({ input: { ...approved, rulesChecked: [...RULES, 'TS-NO-ANY'] } }), /^rulesChecked lists TS-NO-ANY, which do not apply to this task \(cw rules applicable --task t\): remove them$/);
  assert.match(only({ applicableIds: [...RULES, 'VITEST-NO-FOCUS'] }), /misses VITEST-NO-FOCUS/);
});

test('reviewStateProblems: a checks result for the current tree; approval needs it passing and complete', () => {
  assert.match(only({}, { checks: { latest: null, current: null } }), /^no checks result: run cw checks --changed --task t$/);
  assert.match(only({ input: changesRequested }, { tree: 'tree2', checks: { latest: passing, current: null } }), /older state \(tree tree1, now tree2\): run cw checks --changed --task t again/);
  const failing = { ...passing, data: { ...passing.data, overall: 'fail' } };
  assert.match(only({}, { checks: { latest: failing, current: failing } }), /^checks are fail, not pass: approval needs passing checks/);
  assert.deepEqual(problems({ input: changesRequested }, { checks: { latest: failing, current: failing } }), [], 'failing checks are a finding, not a refusal');
  assert.match(only({}, { changedFiles: ['src/mul.mjs', 'docs/a.md'] }), /the checks did not cover docs: run cw checks --changed --task t/);
  const partial = { ...passing, data: { ...passing.data, only: ['lint'] } };
  assert.match(only({}, { checks: { latest: partial, current: partial } }), /did not cover every check \(--only\)/);
});

test('reviewStateProblems: approval with proofs needs a holding recheck made after the report', () => {
  const rerun = /^the proofs were not rechecked since the implementer's report: run cw prove --task t --recheck$/;
  assert.match(only({ rechecks: [] }), rerun);
  assert.match(only({ rechecks: [{ at: '2026-10-19T09:59:00.000Z', allHold: true }] }), rerun);
  assert.match(only({ rechecks: [{ at: '2026-10-19T10:05:00.000Z', head: 'h1', allHold: false }] }), /does not hold: a proof that no longer holds is a blocking CORE-TEST-SPEC finding/);
  assert.match(only({ reportSavedAt: null }), /no saved implementer report for round 1/);
  assert.deepEqual(problems({ proofs: [], rechecks: [] }), [], 'a feature without proofs needs no recheck');
  assert.deepEqual(problems({ proofs: [{ id: 'P1', holds: false }], rechecks: [] }), [], 'nor one whose only proof did not hold');
  assert.deepEqual(problems({ input: changesRequested, rechecks: [] }), [], 'only approval needs the recheck');
});

test('reviewStateProblems: approval needs the recheck made at the head under review', () => {
  assert.equal(only({ rechecks: [{ at: '2026-10-19T10:05:00.000Z', head: 'h0', allHold: true }] }), 'the proofs were rechecked at h0, the branch is at h1: run cw prove --task t --recheck');
  assert.deepEqual(problems({ input: changesRequested, rechecks: [{ at: '2026-10-19T10:05:00.000Z', head: 'h0', allHold: true }] }), []);
});

const scopeFinding = (issue, patch = {}) => ({ id: 'F1', severity: 'non_blocking', rule: 'scope', file: 'package.json', issue, ...patch });
const DEPS = 'node-npm:dependency-changes';
const ACCEPTED = `${DEPS} lists left-pad 1.3.0: accepted, the user approved the dependency`;

test('reviewStateProblems: approval is refused while review scope lists a blocking problem; no finding accepts it', () => {
  const scopeBlocking = ['foreign commit abc "[TASK] Other" (other-branch; also on other): x must hold only this task\'s commits', "node_modules is added by the task's commits: node_modules is never committed"];
  const refusals = scopeBlocking.map((problem) => `cw review scope lists a blocking problem: ${problem}; save changes_requested with a blocking finding`);
  assert.deepEqual(problems({ scopeBlocking }), refusals);
  assert.deepEqual(problems({ input: changesRequested, scopeBlocking }), [], 'the reviewer reports them as findings');
  const accepting = { ...approved, findings: [scopeFinding('foreign commit abc and node_modules: accepted, the user approved them')] };
  assert.deepEqual(problems({ input: accepting, scopeBlocking }), refusals);
});

test('reviewStateProblems: a failing scope script blocks an approval unless a finding with rule scope names it and says why it is accepted', () => {
  // dependency-changes fails on every dependency change, also one the user approved (R2-A2).
  const failedScripts = [{ script: DEPS, problem: `${DEPS} failed (exit 1): dependency changes (CORE-DEPENDENCIES): package.json dependencies: left-pad — → 1.3.0` }];
  const refusal = (script, problem) =>
    `cw review scope lists a failing scope script: ${problem}; save changes_requested with a blocking finding, or, if the change is accepted (for example the user approved the dependency), add a non-blocking finding with rule scope whose issue names ${script} and says why it is accepted`;
  const refused = [refusal(DEPS, failedScripts[0].problem)];
  assert.deepEqual(problems({ failedScripts }), refused);
  assert.deepEqual(problems({ failedScripts, input: { ...approved, findings: [scopeFinding(ACCEPTED)] } }), []);
  assert.deepEqual(problems({ failedScripts, input: { ...approved, findings: [scopeFinding(ACCEPTED, { rule: 'CORE-SCOPE' })] } }), refused, 'only rule scope accepts');
  assert.deepEqual(problems({ failedScripts, input: { ...approved, findings: [scopeFinding('left-pad 1.3.0: accepted, the user approved the dependency')] } }), refused, 'the issue names the script');
  assert.deepEqual(problems({ failedScripts, input: { ...approved, findings: [scopeFinding(`${DEPS}.`)] } }), refused, 'and says why');
  assert.deepEqual(problems({ failedScripts, input: changesRequested }), [], 'changes_requested needs no acceptance');
  const focus = { script: 'vitest:no-focus', problem: 'vitest:no-focus failed (exit 1): …' };
  assert.deepEqual(problems({ failedScripts: [...failedScripts, focus], input: { ...approved, findings: [scopeFinding(ACCEPTED)] } }), [refusal(focus.script, focus.problem)], 'each script needs its own acceptance');
  // Script references and file names are no reason.
  assert.deepEqual(problems({ failedScripts: [...failedScripts, focus], input: { ...approved, findings: [scopeFinding(`${DEPS} vitest:no-focus`)] } }).length, 2, 'two references, no reason');
  assert.deepEqual(problems({ failedScripts, input: { ...approved, findings: [scopeFinding(`${DEPS} in package.json`)] } }), refused, 'a file name is no reason');
  // A script that did not finish its check (an exit other than 1, a timeout) cannot be accepted.
  const broken = { script: DEPS, ranCheck: false, problem: `${DEPS} failed (exit 2): git: bad revision` };
  assert.deepEqual(problems({ failedScripts: [broken], input: { ...approved, findings: [scopeFinding(ACCEPTED)] } }), [
    `cw review scope lists a scope script that did not finish its check: ${broken.problem}; fix what stopped it (see its output) and run cw review scope again, or save changes_requested with a blocking finding`,
  ]);
});

test('reviewStateProblems: with CORE-TEST-SPEC disabled a missing regression proof is a blocking finding of rule spec', () => {
  const bugfix = { ...task, type: 'bugfix' };
  const applicableIds = ['CORE-SCOPE'];
  const input = { ...changesRequested, rulesChecked: applicableIds };
  assert.equal(only({ task: bugfix, proofs: [], applicableIds, input }), 'a bugfix without a holding regression proof needs a blocking finding with rule spec (CORE-TEST-SPEC is disabled in this project): add it');
  assert.deepEqual(problems({ task: bugfix, proofs: [], applicableIds, input: { ...input, findings: [blocking('spec')] } }), []);
  assert.match(only({ task: bugfix, proofs: [], applicableIds, input: { ...approved, rulesChecked: applicableIds } }), /cannot be approved: save changes_requested with a blocking finding with rule spec \(CORE-TEST-SPEC is disabled/);
});

test('reviewStateProblems: no-package checks name the config, not a failing check', () => {
  const noPackage = { ...passing, data: { ...passing.data, overall: 'no-package', packages: [], unowned: ['notes/a.md'] } };
  assert.equal(only({}, { checks: { latest: noPackage, current: noPackage } }),
    'checks are no-package: the changed files notes/a.md belong to no package; run cw checks --task t --package <id> for the package that uses them, or end your turn and tell the orchestrator in one line (it adds a package, packages[].path)');
});

test('reviewStateProblems: a bug fix without a holding proof needs a blocking CORE-TEST-SPEC finding', () => {
  const bugfix = { ...task, type: 'bugfix' };
  assert.match(only({ task: bugfix, proofs: [] }), /^a bugfix without a holding regression proof cannot be approved: save changes_requested with a blocking CORE-TEST-SPEC finding$/);
  assert.match(problems({ task: { ...task, type: 'hotfix' }, proofs: [{ id: 'P1', holds: false }] }).join('\n'), /hotfix without a holding regression proof cannot be approved/);
  assert.match(only({ task: bugfix, proofs: [], input: changesRequested }), /needs a blocking CORE-TEST-SPEC finding: add it/);
  assert.deepEqual(problems({ task: bugfix, proofs: [], input: { ...changesRequested, findings: [blocking('CORE-TEST-SPEC')] } }), []);
  assert.deepEqual(problems({ task: bugfix }), [], 'a bug fix with a holding, rechecked proof can be approved');
});

test('reviewStateProblems: approval needs the work tree clean and on the task branch', () => {
  assert.match(only({}, { branchNow: 'main' }), /^\/w is on main, not on the task branch NO-TICKET\/feature\/mul-helper: request changes/);
  assert.match(only({}, { branchNow: '' }), /is on a detached HEAD/);
  assert.match(only({}, { onBranch: false }), /the task branch .+ does not exist in \/w/);
  assert.match(only({}, { dirty: ['src/x.mjs'] }), /^\/w has uncommitted changes \(src\/x\.mjs\), which cannot be approved: request changes with a blocking finding$/);
  assert.match(only({}, { workTree: null }), /^task t has no work tree/);
  assert.deepEqual(problems({ input: changesRequested }, { branchNow: 'main', dirty: ['src/x.mjs'] }), [], 'the reviewer reports them as findings');
});

test('validateSavedReview accepts what review save writes and refuses a broken file', () => {
  const saved = {
    kind: 'review', version: 1, task: 't', round: 1, reviewRound: 1, savedAt: '2026-10-19T10:00:00.000Z', ...approved, summary: null,
    head: 'h1', checks: { file: 'checks-1.json', overall: 'pass', tree: 'tree1' }, proofRecheck: null, rulesApplicable: RULES,
  };
  assert.deepEqual(validateSavedReview(saved), []);
  assert.match(validateSavedReview({ ...saved, savedAt: null })[0], /savedAt must be an ISO timestamp/);
  assert.match(validateSavedReview({ ...saved, reviewRound: 0 })[0], /reviewRound must be an integer ≥ 1/);
  assert.match(validateSavedReview({ ...saved, kind: 'dev-report' })[0], /kind must be review/);
  assert.match(validateSavedReview({ ...saved, findings: [blocking('CORE-SCOPE')] })[0], /approved with blocking findings: F1/);
  assert.match(validateSavedReview({ ...saved, findings: null })[0], /findings: is required/);
});
