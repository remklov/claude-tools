// The reviewer's side (§6 R1, R8): cw review scope shows what the review covers (diff stat, files outside
// the packages, foreign commits, non-goal hints, pack scope scripts), and cw review save checks the
// reviewer's JSON against the spec, the applicable rules, the checks and the proofs before it writes
// review-<round>.json. Both read the task's work tree from task.json and never write to it (D5).
// The pure validators are exported for the SubagentStop gate (§9).
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { packagesOf } from './config.mjs';
import { foreignCommits } from './commit.mjs';
import { readText, writeJson } from './fsx.mjs';
import { currentBranch, git, gitResult, isNodeModulesPath, statusEntries } from './git.mjs';
import { failedError, preconditionError } from './out.mjs';
import { resolvePacks, runPackScript, scopeScripts } from './packs.mjs';
import { proofsAtHead, readProofs } from './prove.mjs';
import { collectState, validateReviewInput } from './report.mjs';
import { applicableForTask, buildRulebook } from './rules.mjs';
import { loadSchema, validateWith } from './schema.mjs';
import { parseSpec } from './spec.mjs';
import { readRoundFile, updateTask } from './task.mjs';
import { taskDir, taskPath, workTreeOf } from './workspace.mjs';
import { listFiles } from './ws.mjs';

const BUG_TYPES = ['bugfix', 'hotfix'];
const TAIL_LINES = 15;
const MOVED_ON = 'The orchestrator moved the task on; end your turn and say so in one line.';
// The reviewer is read-only: what it cannot fix, it reports to the orchestrator.
const TELL = 'end your turn and tell the orchestrator in one line';
const TELL_FIX = 'End your turn and tell the orchestrator in one line';

// Words too common to point at a file; only words of 4 or more letters are checked at all.
const STOP_WORDS = new Set([
  'about', 'also', 'been', 'before', 'being', 'both', 'change', 'changes', 'does', 'done', 'each', 'every', 'existing',
  'from', 'have', 'into', 'just', 'later', 'make', 'more', 'must', 'nothing', 'only', 'other', 'same', 'should', 'some',
  'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'under', 'very', 'were',
  'what', 'when', 'where', 'which', 'while', 'will', 'with', 'within', 'without', 'would',
]);

// The lowercase words of at least 4 letters in text, minus the stop words, in first-seen order.
export const significantWords = (text) =>
  [...new Set(String(text).toLowerCase().match(/\p{L}+/gu) ?? [])].filter((word) => word.length >= 4 && !STOP_WORDS.has(word));

// For each non-goal, the changed files whose path contains one of its significant words. Hints for
// the reviewer, never blocking; non-goals without a hit are left out.
export function nonGoalHints(nonGoals, files) {
  return nonGoals
    .map((nonGoal) => {
      const words = significantWords(nonGoal);
      const hits = files.filter((file) => words.some((word) => file.toLowerCase().includes(word)));
      return { nonGoal, words: words.filter((word) => hits.some((file) => file.toLowerCase().includes(word))), files: hits };
    })
    .filter((hint) => hint.files.length);
}

// The work tree of a task under review; exit 3 when the phase, the base or the work tree is missing.
function requireReviewable(ws, task, command) {
  if (task.phase !== 'review') throw preconditionError(`cw ${command} needs phase review; task ${task.id} is in ${task.phase}.`, MOVED_ON);
  if (!task.base?.commit) throw preconditionError(`Task ${task.id} has no recorded base commit.`, `${TELL_FIX}; it restarts the task with cw task start --task ${task.id}.`);
  const workTree = workTreeOf(ws, task);
  if (!workTree || !existsSync(workTree)) {
    throw preconditionError(`Task ${task.id} has no work tree${workTree ? `: ${workTree} does not exist` : ' yet'}.`, `${TELL_FIX}: there is no work tree to review.`);
  }
  return workTree;
}

// git diff --numstat of the task branch against the base, without rename detection (a rename is a
// deletion plus an addition): { files: [{ path, added, deleted, binary }], added, deleted }.
function diffStat(workTree, range) {
  const files = git(['diff', '--numstat', '-z', '--no-renames', range], { cwd: workTree })
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const [added, deleted, ...path] = record.split('\t');
      const binary = added === '-';
      return { path: path.join('\t'), added: binary ? null : Number(added), deleted: binary ? null : Number(deleted), binary };
    });
  const total = (key) => files.reduce((sum, file) => sum + (file[key] ?? 0), 0);
  return { files, added: total('added'), deleted: total('deleted') };
}

const tailOf = (text) => text.trimEnd().split('\n').slice(-TAIL_LINES).join('\n');

// The first lines of a script's output on one line, for its blocking entry.
const gist = (tail) => {
  const lines = tail.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 3 ? `${lines.slice(0, 3).join(' ')} …` : lines.join(' ');
};

// The problems of the task branch's content. blocking: foreign commits and node_modules paths its commits
// add (the link worktree.symlinkDirectories creates passes a "node_modules/" ignore pattern); review save
// refuses an approval while there are any. failedScripts: the failing pack scope scripts ({ script,
// problem }); they block an approval unless a finding accepts them (acceptsScript), because a script
// such as node-npm:dependency-changes fails on every change of its kind, also on one the user approved.
function contentProblems(ws, task, workTree) {
  const ref = `refs/heads/${task.branch}`;
  const base = task.base.commit;
  const { count, foreign } = foreignCommits(workTree, task);
  const modules = git(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=A', `${base}...${ref}`], { cwd: workTree })
    .split('\0')
    .filter((path) => path && isNodeModulesPath(path));
  const packs = resolvePacks(ws);
  const scripts = scopeScripts(packs).map((script) => {
    const result = runPackScript(packs, script, {
      workTree,
      configRoot: ws.configRoot,
      task: task.id,
      taskDir: taskDir(ws, task.id),
      base,
      defaultBase: ws.config.git.defaultBase,
      packageDirs: ws.config.packages.map((pkg) => pkg.path),
    });
    return { script, code: result.code, passed: result.code === 0, timedOut: result.timedOut, tail: tailOf(`${result.stdout}${result.stderr}`) };
  });
  const blocking = [
    ...foreign.map((commit) => {
      const also = commit.alsoOn.length ? `; also on ${commit.alsoOn.join(', ')}` : '';
      return `foreign commit ${commit.sha} "${commit.subject}" (${commit.reasons.join(', ')}${also}): ${task.branch} must hold only this task's commits`;
    }),
    ...modules.map((path) => `${path} is added by the task's commits: node_modules is never committed`),
  ];
  const failedScripts = scripts.filter((script) => !script.passed).map((script) => ({
    script: script.script,
    // Exit 1 is a script's finding; any other exit or a timeout means it never finished its check.
    ranCheck: script.code === 1 && !script.timedOut,
    problem: `${script.script} failed (exit ${script.code}${script.timedOut ? ', timed out' : ''})${script.tail ? `: ${gist(script.tail)}` : ''}`,
  }));
  return { count, foreign, scripts, blocking, failedScripts };
}

// A finding accepts a failing scope script when its rule is scope and its issue names the script
// reference and says why: words beyond script references and file names.
const REFERENCE = /^[a-z0-9-]+:[a-z0-9-]+$/i;
const reasonWords = (issue) =>
  significantWords(issue.split(/\s+/).map((token) => token.replace(/[,;:.!?)]+$/, '')).filter((token) => !REFERENCE.test(token) && !/[/.]/.test(token)).join(' '));
export const acceptsScript = (finding, script) => finding.rule === 'scope' && finding.issue.includes(script) && reasonWords(finding.issue).length > 0;

// cw review scope (§6 R1). Problems the reviewer turns into blocking findings are listed in blocking,
// failing scope scripts in failingScripts (blocking unless accepted); the scope itself is computed
// whatever they are.
export function reviewScope({ ws, task }) {
  const workTree = requireReviewable(ws, task, 'review scope');
  const ref = `refs/heads/${task.branch}`;
  const tip = gitResult(['rev-parse', '--verify', '--quiet', ref], { cwd: workTree });
  if (tip.code !== 0) {
    throw preconditionError(`The task branch ${task.branch} does not exist in ${workTree}.`, `${TELL_FIX}: there is no branch to review.`);
  }
  const base = task.base.commit;
  const stat = diffStat(workTree, `${base}...${ref}`);
  const files = stat.files.map((file) => file.path);
  const specText = readText(taskPath(ws, task.id, 'spec.md'));
  const { count, foreign, scripts, blocking: content, failedScripts } = contentProblems(ws, task, workTree);
  const branchNow = currentBranch(workTree);
  const dirty = statusEntries(workTree).map((entry) => entry.path);
  const blocking = [
    ...(branchNow !== task.branch ? [`${workTree} is on ${branchNow || 'a detached HEAD'}, not on the task branch ${task.branch}`] : []),
    ...(dirty.length ? [`${workTree} has uncommitted changes (${listFiles(dirty)}); they cannot be approved`] : []),
    ...content,
  ];
  return {
    task: task.id,
    branch: task.branch,
    workTree,
    base,
    head: tip.stdout.trim(),
    commits: count,
    diffStat: stat,
    changedFiles: files,
    unowned: packagesOf(ws.config, files).unowned,
    foreignCommits: foreign.map(({ sha, subject, alsoOn, reasons }) => ({ sha, subject, alsoOn, reasons })),
    nonGoalHints: specText === null ? [] : nonGoalHints(parseSpec(specText).nonGoals, files),
    scripts,
    blocking,
    failingScripts: failedScripts.map((failed) => failed.problem),
  };
}

// The latest proof recheck made after since (the implementer's report), or null.
export function proofRecheckSince(rechecks = [], since) {
  const latest = rechecks.at(-1);
  return latest && since && Date.parse(latest.at) > Date.parse(since) ? latest : null;
}

// What a finding about a missing or broken proof cites. A project may disable CORE-TEST-SPEC (it is not
// protected): then the finding cites the spec category, as review save refuses a rule outside rulesChecked.
export const testSpecRule = (applicableIds) =>
  [...applicableIds].includes('CORE-TEST-SPEC')
    ? { rule: 'CORE-TEST-SPEC', finding: 'CORE-TEST-SPEC finding' }
    : { rule: 'spec', finding: 'finding with rule spec (CORE-TEST-SPEC is disabled in this project)' };

// The rules a review must meet beyond its own shape (§6 R1-R4, R8; Decided in P2). Pure: every fact
// comes in. state is collectState's shape; applicableIds are the IDs of cw rules applicable; proofs
// are the proofs that count (held, not stale at HEAD); reportSavedAt is the savedAt of
// report-<round>.json (null without one); scopeBlocking are review scope's blocking content problems and
// failedScripts its failing scope scripts ({ script, problem }).
export function reviewStateProblems({ config, task, input, specText, applicableIds, state, proofs, rechecks, reportSavedAt, scopeBlocking = [], failedScripts = [] }) {
  const errors = [];
  const id = task.id;
  const approved = input.status === 'approved';

  if (specText === null) errors.push(`task ${id} has no spec.md: ${TELL}`);
  else {
    const specIds = parseSpec(specText).acceptance.map((ac) => ac.id);
    if (!specIds.length) errors.push(`the spec lists no acceptance criteria (AC1 …): ${TELL}`);
    for (const acId of specIds) {
      if (!input.acceptanceCriteria.some((ac) => ac.id === acId)) errors.push(`${acId} from the spec is missing in acceptanceCriteria: add it with met and evidence`);
    }
    for (const ac of input.acceptanceCriteria) {
      if (specIds.length && !specIds.includes(ac.id)) errors.push(`${ac.id} is not an acceptance criterion of the spec (${specIds.join(', ')}): remove it`);
    }
  }

  const applicable = new Set(applicableIds);
  const checked = new Set(input.rulesChecked);
  const missing = [...applicable].filter((rule) => !checked.has(rule));
  const extra = [...checked].filter((rule) => !applicable.has(rule));
  if (missing.length) errors.push(`rulesChecked misses ${missing.join(', ')}: check every rule that cw rules applicable --task ${id} lists`);
  if (extra.length) errors.push(`rulesChecked lists ${extra.join(', ')}, which do not apply to this task (cw rules applicable --task ${id}): remove them`);

  const rerun = `cw checks --changed --task ${id}`;
  const { latest, current } = state.checks;
  if (!latest) errors.push(`no checks result: run ${rerun}`);
  else if (!current) errors.push(`checks ran on an older state (tree ${String(latest.data.tree).slice(0, 10)}, now ${String(state.tree).slice(0, 10)}): run ${rerun} again`);
  else if (approved && current.data.overall === 'no-package') {
    errors.push(`checks are no-package: the changed files ${listFiles(current.data.unowned)} belong to no package; run cw checks --task ${id} --package <id> for the package that uses them, or ${TELL} (it adds a package, packages[].path)`);
  } else if (approved && current.data.overall !== 'pass') {
    errors.push(`checks are ${current.data.overall}, not pass: approval needs passing checks; a failing check is a blocking finding (save changes_requested)`);
  } else if (approved) {
    const ran = new Set(current.data.packages.map((pkg) => pkg.id));
    const uncovered = packagesOf(config, state.changedFiles).packages.filter((pkg) => !ran.has(pkg.id)).map((pkg) => pkg.id);
    if (uncovered.length || current.data.only.length) errors.push(`the checks did not cover ${uncovered.length ? uncovered.join(', ') : 'every check (--only)'}: run ${rerun}`);
  }

  const testSpec = testSpecRule(applicable);
  const holding = proofs.filter((proof) => proof.holds);
  const testSpecFinding = input.findings.some((finding) => finding.severity === 'blocking' && finding.rule === testSpec.rule);
  if (BUG_TYPES.includes(task.type) && !holding.length && !testSpecFinding) {
    errors.push(approved
      ? `a ${task.type} without a holding regression proof cannot be approved: save changes_requested with a blocking ${testSpec.finding}`
      : `a ${task.type} without a holding regression proof needs a blocking ${testSpec.finding}: add it`);
  }
  if (approved && holding.length) {
    const recheck = proofRecheckSince(rechecks, reportSavedAt);
    if (!reportSavedAt) errors.push(`there is no saved implementer report for round ${task.round}: ${TELL}`);
    else if (!recheck) errors.push(`the proofs were not rechecked since the implementer's report: run cw prove --task ${id} --recheck`);
    else if (recheck.head !== state.head) {
      errors.push(`the proofs were rechecked at ${String(recheck.head).slice(0, 10)}, the branch is at ${String(state.head).slice(0, 10)}: run cw prove --task ${id} --recheck`);
    } else if (!recheck.allHold) errors.push(`the proof recheck of ${recheck.at} does not hold: a proof that no longer holds is a blocking ${testSpec.finding} (save changes_requested)`);
  }

  if (approved) {
    for (const problem of scopeBlocking) errors.push(`cw review scope lists a blocking problem: ${problem}; save changes_requested with a blocking finding`);
    for (const { script, problem, ranCheck = true } of failedScripts) {
      if (!ranCheck) {
        errors.push(`cw review scope lists a scope script that did not finish its check: ${problem}; fix what stopped it (see its output) and run cw review scope again, or save changes_requested with a blocking finding`);
        continue;
      }
      if (input.findings.some((finding) => acceptsScript(finding, script))) continue;
      errors.push(`cw review scope lists a failing scope script: ${problem}; save changes_requested with a blocking finding, or, if the change is accepted (for example the user approved the dependency), add a non-blocking finding with rule scope whose issue names ${script} and says why it is accepted`);
    }
    if (!state.workTree) errors.push(`task ${id} has no work tree: ${TELL}`);
    else {
      if (!state.onBranch) errors.push(`the task branch ${task.branch} does not exist in ${state.workTree}: nothing to approve; ${TELL}`);
      else if (state.branchNow !== task.branch) {
        errors.push(`${state.workTree} is on ${state.branchNow || 'a detached HEAD'}, not on the task branch ${task.branch}: request changes with a blocking finding`);
      }
      if (state.dirty.length) errors.push(`${state.workTree} has uncommitted changes (${listFiles(state.dirty)}), which cannot be approved: request changes with a blocking finding`);
    }
  }
  return errors;
}

// A saved review-<n>.json, for the SubagentStop gate (§9). Pure.
export function validateSavedReview(saved) {
  const errors = [];
  if (saved?.kind !== 'review' || saved?.version !== 1) errors.push('kind must be review and version 1');
  for (const key of ['round', 'reviewRound']) {
    if (!Number.isInteger(saved?.[key]) || saved[key] < 1) errors.push(`${key} must be an integer ≥ 1`);
  }
  if (typeof saved?.savedAt !== 'string' || Number.isNaN(Date.parse(saved.savedAt))) errors.push('savedAt must be an ISO timestamp');
  if (errors.length) return errors;
  const keys = Object.keys(loadSchema('review').properties).filter((key) => key in saved && saved[key] !== null);
  return validateReviewInput(Object.fromEntries(keys.map((key) => [key, saved[key]])));
}

const invalid = (task, errors) =>
  failedError(`The review is not valid:\n- ${errors.join('\n- ')}`, `Fix each point, then pipe the review to cw review save --task ${task.id} again.`, { errors });

// cw review save: validate everything at once, then write review-<round>.json under the task lock.
// The phase stays review: the orchestrator's cw review show reads the file and moves the task.
export function saveReview({ ws, task, input }) {
  requireReviewable(ws, task, 'review save');
  if (!(task.round >= 1) || !(task.reviewRound >= 1)) {
    throw preconditionError(`Task ${task.id} has no review round yet.`, `${TELL_FIX}; it starts the review with cw task review --task ${task.id}.`);
  }
  const inputErrors = validateReviewInput(input);
  if (validateWith('review', input).length) throw invalid(task, inputErrors);
  const state = collectState(ws, task);
  const applicableIds = applicableForTask(ws, task, buildRulebook(ws)).rules.map((rule) => rule.id);
  const store = readProofs(ws, task);
  const reportSavedAt = readRoundFile(ws, task, 'report').data?.savedAt ?? null;
  // The scripts take a while: only an approval needs them.
  const content = input.status === 'approved' && state.onBranch ? contentProblems(ws, task, state.workTree) : null;
  const errors = [
    ...inputErrors,
    ...reviewStateProblems({
      config: ws.config,
      task,
      input,
      specText: readText(taskPath(ws, task.id, 'spec.md')),
      applicableIds,
      state,
      proofs: proofsAtHead(state.workTree, task.base?.commit, store.proofs).held,
      rechecks: store.rechecks ?? [],
      reportSavedAt,
      scopeBlocking: content?.blocking ?? [],
      failedScripts: content?.failedScripts ?? [],
    }),
  ];
  if (errors.length) throw invalid(task, errors);
  const { current } = state.checks;
  const recheck = proofRecheckSince(store.rechecks, reportSavedAt);
  const review = {
    kind: 'review',
    version: 1,
    task: task.id,
    round: task.round,
    reviewRound: task.reviewRound,
    savedAt: null,
    status: input.status,
    acceptanceCriteria: input.acceptanceCriteria,
    rulesChecked: input.rulesChecked,
    findings: input.findings,
    summary: input.summary ?? null,
    head: state.onBranch ? state.head : null,
    checks: { file: basename(current.file), overall: current.data.overall, tree: current.data.tree },
    proofRecheck: recheck ? { at: recheck.at, allHold: recheck.allHold } : null,
    rulesApplicable: applicableIds,
  };
  const path = taskPath(ws, task.id, `review-${task.round}.json`);
  updateTask(ws, task.id, (fresh) => {
    if (fresh.phase !== 'review' || fresh.round !== task.round || fresh.reviewRound !== task.reviewRound) {
      throw preconditionError(`Task ${task.id} moved on while the review was checked.`, `Run cw review save --task ${task.id} again.`);
    }
    review.savedAt = new Date().toISOString();
    writeJson(path, review);
  });
  return { path, review };
}
