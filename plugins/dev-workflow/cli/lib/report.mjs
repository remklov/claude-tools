// The agents' JSON outputs (§6 output contract). The implementer's report is checked against
// schemas/dev-report.schema.json and against the state it claims (commits and their conventions, a
// current passing checks result, proofs) and saved as report-<round>.json for the SubagentStop gate (§9).
// The review input validator is exported for cw review save.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { packagesOf } from './config.mjs';
import { listChecks, workTreeId } from './checks.mjs';
import { lintRange, taskCommits } from './commit.mjs';
import { readText, writeJson } from './fsx.mjs';
import { branchExists, changedFiles, currentBranch, git, headCommit, isNodeModulesPath, statusEntries } from './git.mjs';
import { quote } from './host/index.mjs';
import { failedError, preconditionError } from './out.mjs';
import { proofsAtHead, readProofs } from './prove.mjs';
import { loadSchema, validate } from './schema.mjs';
import { parseSpec } from './spec.mjs';
import { updateTask } from './task.mjs';
import { gitForm, taskPath, workTreeOf } from './workspace.mjs';
import { listFiles } from './ws.mjs';

const RULE_CATEGORIES = new Set(['spec', 'scope', 'git', 'correctness', 'security']);
const TEST_FILE = /\.(test|spec)\.[^/]+$/;
const FENCE = /```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/g;

export const fence = (value) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

// The agent's JSON: the whole text, or the last ```json fence in it.
export function parseAgentJson(text) {
  const raw = String(text).trim();
  const fences = [...raw.matchAll(FENCE)];
  const fix = 'Pipe one JSON object on stdin, raw or in a ```json fence.';
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (!fences.length) throw failedError(`stdin is not valid JSON: ${error.message}`, fix);
  }
  try {
    return JSON.parse(fences.at(-1)[1]);
  } catch (error) {
    throw failedError(`the last \`\`\`json fence on stdin is not valid JSON: ${error.message}`, fix);
  }
}

const duplicates = (values) => [...new Set(values.filter((value, i) => values.indexOf(value) !== i))];
const schemaErrors = (name, value) => validate(loadSchema(name), value).map((error) => `${error.path}: ${error.message}`);

const HANDOVER_KEYS = ['decisions', 'rejected', 'testing', 'pitfalls', 'deviations'];
const HANDOVER_SHAPE = `{ ${HANDOVER_KEYS.map((key) => `"${key}": []`).join(', ')} }`;

// The implementer's input on its own: schema plus the status rules. Pure (no fs, no git).
export function validateDevReportInput(input) {
  const errors = schemaErrors('dev-report', input).map((error) =>
    error === '$.handover: is required'
      ? `$.handover: is required: ${HANDOVER_SHAPE}, each a list of short notes for a fresh implementer (implementer playbook, step 8)`
      : error);
  if (errors.length) return errors;
  const dupes = duplicates(input.acceptanceCriteria.map((ac) => ac.id));
  if (dupes.length) errors.push(`acceptanceCriteria lists ${dupes.join(', ')} more than once`);
  for (const key of ['blocked', 'misclassified']) {
    const shape = key === 'blocked' ? '{ question, needed }' : '{ reason, suggested }';
    if (input.status === key && !input[key]) errors.push(`status ${key} needs ${key}: ${shape}`);
    if (input.status !== key && input[key]) errors.push(`${key} must be null unless status is ${key}`);
  }
  if (input.status === 'done') {
    if (!HANDOVER_KEYS.some((key) => input.handover[key].length)) {
      errors.push('handover is empty: a done report names at least one decision, rejected approach, test setup, pitfall or deviation for a fresh implementer');
    }
    for (const ac of input.acceptanceCriteria) {
      if (!ac.met) errors.push(`${ac.id} is not met; status cannot be done (report blocked with the open question instead)`);
      else if (!ac.evidence.trim()) errors.push(`${ac.id} has no evidence`);
    }
  }
  return errors;
}

// A saved report-<n>.json, for the SubagentStop gate (§9). Pure.
export function validateSavedDevReport(saved) {
  const errors = [];
  if (saved?.kind !== 'dev-report' || saved?.version !== 1) errors.push('kind must be dev-report and version 1');
  if (!Number.isInteger(saved?.round) || saved.round < 1) errors.push('round must be an integer ≥ 1');
  if (typeof saved?.savedAt !== 'string' || Number.isNaN(Date.parse(saved.savedAt))) errors.push('savedAt must be an ISO timestamp');
  if (errors.length) return errors;
  const keys = Object.keys(loadSchema('dev-report').properties).filter((key) => key in saved);
  return validateDevReportInput(Object.fromEntries(keys.map((key) => [key, saved[key]])));
}

// The reviewer's input on its own: schema plus the status and finding rules. Pure. The state rules
// (applicable rules checked, checks current, proofs rechecked) belong to cw review save.
export function validateReviewInput(input) {
  const errors = schemaErrors('review', input);
  if (errors.length) return errors;
  for (const [label, values] of [['acceptanceCriteria', input.acceptanceCriteria.map((ac) => ac.id)], ['findings', input.findings.map((f) => f.id)]]) {
    const dupes = duplicates(values);
    if (dupes.length) errors.push(`${label} lists ${dupes.join(', ')} more than once`);
  }
  const blocking = input.findings.filter((finding) => finding.severity === 'blocking');
  if (input.status === 'approved') {
    if (blocking.length) errors.push(`approved with blocking findings: ${blocking.map((f) => f.id).join(', ')}`);
    const unmet = input.acceptanceCriteria.filter((ac) => !ac.met);
    if (unmet.length) errors.push(`approved with unmet acceptance criteria: ${unmet.map((ac) => ac.id).join(', ')}`);
  } else if (!blocking.length) {
    errors.push('changes_requested needs at least one blocking finding');
  }
  for (const finding of input.findings) {
    if (finding.sendAlong && finding.severity === 'blocking') errors.push(`${finding.id}: sendAlong marks non-blocking findings only`);
    if (!RULE_CATEGORIES.has(finding.rule) && !input.rulesChecked.includes(finding.rule)) {
      errors.push(`${finding.id} cites ${finding.rule}, which is not in rulesChecked`);
    }
  }
  return errors;
}

// What git and the state dir say about the task right now; null fields before ws setup.
export function collectState(ws, task) {
  const workTree = workTreeOf(ws, task);
  if (!workTree || !existsSync(workTree) || !task.base?.commit) {
    return { workTree: null, onBranch: false, branchNow: null, dirty: [], tree: null, head: null, commits: [], added: [], changedFiles: [], checks: { latest: null, current: null } };
  }
  const ref = `refs/heads/${task.branch}`;
  const onBranch = branchExists(workTree, task.branch);
  const tree = workTreeId(workTree);
  const results = listChecks(ws, task);
  const range = `${task.base.commit}...${ref}`;
  return {
    workTree,
    onBranch,
    branchNow: currentBranch(workTree),
    dirty: statusEntries(workTree).map((entry) => entry.path),
    tree,
    head: onBranch ? git(['rev-parse', ref], { cwd: workTree }) : headCommit(workTree),
    commits: onBranch ? taskCommits(workTree, task).map((commit) => ({ sha: commit.sha.slice(0, 10), subject: commit.subject })) : [],
    added: onBranch ? git(['diff', '--name-only', '-z', '--diff-filter=A', range], { cwd: workTree }).split('\0').filter(Boolean) : [],
    changedFiles: changedFiles(workTree, task.base.commit),
    checks: { latest: results[0] ?? null, current: results.find((result) => result.data.tree === tree) ?? null },
  };
}

// report-<round>.json: the agent's input plus the facts cw adds. proofs are the ones that count (held,
// not stale at HEAD); staleProofs are shown, not counted.
export function buildDevReport({ ws, task, input, state }) {
  const shown = state.checks.current ?? state.checks.latest;
  const { held, stale } = proofsAtHead(state.workTree, task.base?.commit, readProofs(ws, task).proofs);
  return {
    kind: 'dev-report',
    version: 1,
    task: task.id,
    round: task.round,
    savedAt: null,
    status: input.status,
    branch: task.branch,
    workTree: state.workTree,
    head: state.head,
    base: task.base,
    commits: state.commits,
    changedFiles: state.changedFiles,
    acceptanceCriteria: input.acceptanceCriteria,
    proofs: held,
    staleProofs: stale,
    checks: shown
      ? { file: basename(shown.file), overall: shown.data.overall, tree: shown.data.tree, current: shown === state.checks.current }
      : { file: null, overall: 'missing', tree: null, current: false },
    risks: input.risks ?? [],
    openPoints: (input.openPoints ?? []).map((point) => (typeof point === 'string' ? { text: point } : point)),
    handover: input.handover,
    blocked: input.blocked ?? null,
    misclassified: input.misclassified ?? null,
    warnings: [],
  };
}

// The rules a done report must meet beyond its own shape (§6 steps 5-8, Decided in P2).
export function devReportProblems({ ws, task, report, state, specText }) {
  const errors = [];
  const warnings = [];
  const id = task.id;
  if (specText === null) errors.push(`task ${id} has no spec.md; report blocked and ask the orchestrator`);
  else {
    const specIds = parseSpec(specText).acceptance.map((ac) => ac.id);
    if (!specIds.length) errors.push('the spec lists no acceptance criteria (AC1 …); report blocked and ask the orchestrator');
    for (const acId of specIds) {
      if (!report.acceptanceCriteria.some((ac) => ac.id === acId)) errors.push(`${acId} from the spec is missing in acceptanceCriteria`);
    }
    for (const ac of report.acceptanceCriteria) {
      if (specIds.length && !specIds.includes(ac.id)) errors.push(`${ac.id} is not an acceptance criterion of the spec (${specIds.join(', ')})`);
    }
  }
  if (!state.workTree) {
    errors.push(`task ${id} has no work tree: run cw ws setup --task ${id}`);
    return { errors, warnings };
  }
  const { workTree } = state;
  if (!state.onBranch) errors.push(`the task branch ${task.branch} does not exist in ${workTree}: run cw ws setup --task ${id}`);
  else if (state.branchNow !== task.branch) errors.push(`${workTree} is on ${state.branchNow || 'a detached HEAD'}, not on the task branch ${task.branch}`);
  if (state.dirty.length) errors.push(`${workTree} has uncommitted changes (${listFiles(state.dirty)}): commit them (step 6) or remove them`);
  if (state.onBranch && !state.commits.length) errors.push(`no commits on ${task.branch} since the base: commit your work (step 6)`);
  if (state.commits.length) {
    const lint = lintRange({ config: ws.config, workTree, task });
    if (lint.errors) errors.push(`the commits break the git conventions (${lint.errors} errors): run cw commit lint --task ${id} and fix them`);
  }
  const modules = state.added.filter(isNodeModulesPath);
  if (modules.length) {
    errors.push(`the commits add ${modules.join(', ')} (node_modules is never committed; a link from worktree.symlinkDirectories passes a "node_modules/" ignore pattern): ${gitForm(ws)} rm --cached ${modules.map(quote).join(' ')}, commit (step 6), then save the report again`);
  }
  const { latest, current } = state.checks;
  const rerun = `cw checks --changed --task ${id}`;
  if (!latest) errors.push(`no checks result: run ${rerun}`);
  else if (!current) errors.push(`checks ran on an older state (tree ${String(latest.data.tree).slice(0, 10)}, now ${state.tree.slice(0, 10)}): run ${rerun} again`);
  else if (current.data.overall === 'no-package') {
    errors.push(`the changed files ${listFiles(current.data.unowned)} belong to no package: run cw checks --task ${id} --package <id> for the package that uses them, or report blocked so the orchestrator adds a package (packages[].path)`);
  } else if (current.data.overall !== 'pass') errors.push(`checks are ${current.data.overall}: fix the failures and run ${rerun} until they pass`);
  else {
    const ran = new Set(current.data.packages.map((pkg) => pkg.id));
    const missing = packagesOf(ws.config, state.changedFiles).packages.filter((pkg) => !ran.has(pkg.id)).map((pkg) => pkg.id);
    if (missing.length || current.data.only.length) errors.push(`the checks did not cover ${missing.length ? missing.join(', ') : 'every check (--only)'}: run ${rerun}`);
  }
  // report.proofs are the proofs that count (buildDevReport); the stale ones are only shown.
  const holding = report.proofs.filter((proof) => proof.holds);
  if (['bugfix', 'hotfix'].includes(task.type) && !holding.length) {
    errors.push(`a bug fix needs the regression test's failing run: cw prove --task ${id} --test <package>:<file> --change <file>`);
  }
  for (const proof of report.staleProofs ?? []) {
    warnings.push(`${proof.id} (${proof.test}) is stale and not counted: ${proof.reason}; run cw prove for the test as it is now`);
  }
  for (const file of state.added.filter((path) => TEST_FILE.test(path))) {
    if (!holding.some((proof) => proof.testPath === file)) warnings.push(`the new test ${file} has no holding proof (cw prove)`);
  }
  return { errors, warnings };
}

const invalid = (task, errors) =>
  failedError(`The dev report is not valid:\n- ${errors.join('\n- ')}`, `Fix each point, then pipe the report to cw report save --task ${task.id} again.`, { errors });

// cw report save: validate, write report-<round>.json under the task lock, raise the step to 8.
export function saveDevReport({ ws, task, input }) {
  if (task.phase !== 'implement') {
    throw preconditionError(`cw report save needs phase implement; task ${task.id} is in ${task.phase}.`, 'The orchestrator has moved the task on; end your turn and say so in one line.');
  }
  if (!(task.round >= 1)) throw preconditionError(`Task ${task.id} has no implementer round yet.`, `The orchestrator starts it with cw task start --task ${task.id}.`);
  const inputErrors = validateDevReportInput(input);
  if (inputErrors.length) throw invalid(task, inputErrors);
  const state = collectState(ws, task);
  const report = buildDevReport({ ws, task, input, state });
  if (report.status === 'done') {
    const { errors, warnings } = devReportProblems({ ws, task, report, state, specText: readText(taskPath(ws, task.id, 'spec.md')) });
    if (errors.length) throw invalid(task, errors);
    report.warnings = warnings;
  }
  const path = taskPath(ws, task.id, `report-${task.round}.json`);
  updateTask(ws, task.id, (current) => {
    if (current.phase !== 'implement' || current.round !== task.round) {
      throw preconditionError(`Task ${task.id} moved on while the report was checked.`, `Run cw report save --task ${task.id} again.`);
    }
    report.savedAt = new Date().toISOString();
    writeJson(path, report);
    current.steps = { ...current.steps, done: Math.max(current.steps.done, 8), note: `report ${report.status}` };
  });
  return { path, report };
}
