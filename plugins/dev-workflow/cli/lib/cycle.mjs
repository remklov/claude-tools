// The orchestrator's delegation cycle (§6 O4–O8): the classification, the base a task starts from,
// the briefs with their packages, rules and procedures, the reset after a misclassification, and the
// handover of a task to a new implementer agent (D3, D5, ADR 0012).
import { existsSync } from 'node:fs';
import { findingsToFix, renderBrief, writeBrief } from './brief.mjs';
import { classify, configRules } from './classify.mjs';
import { packageById } from './config.mjs';
import { readJson, readText, writeJson } from './fsx.mjs';
import { branchExists, changedFiles, commitsBetween, currentBranch, git, gitResult, porcelain } from './git.mjs';
import { matchGlob } from './glob.mjs';
import { GUARDRAILS } from './guardrails.mjs';
import { preconditionError } from './out.mjs';
import { loadProcedures, packComplexityRules, resolvePacks, selectProcedures } from './packs.mjs';
import { applicableRules, buildRulebook } from './rules.mjs';
import { keywordText, parseSpec } from './spec.mjs';
import { readRoundFile, staleAgent } from './task.mjs';
import { orchestratorTreeOf, taskPath, workTreeOf } from './workspace.mjs';
import { agentBranchOf, dropAgentBranch, dropBranch, mainCheckout, pruneWorktrees, removeWorktree, worktreeHolding } from './worktree.mjs';
import { listFiles } from './ws.mjs';

const unique = (items) => [...new Set(items)];
const short = (sha) => String(sha ?? '').slice(0, 10);

// The task's packages (all of them before classification) as config entries.
export const taskPackages = (ws, task) =>
  (task.packages.length ? task.packages : ws.config.packages.map((pkg) => pkg.id)).map((id) => packageById(ws.config, id)).filter(Boolean);

// cw classify: the spec's Context paths plus extra paths against the config's and the packs'
// escalation rules (§5 complexity.escalate). Pure apart from reading the packs.
export function classifyTask(ws, specText, extraPaths = [], packs = resolvePacks(ws)) {
  const spec = parseSpec(specText);
  const paths = unique([...spec.paths, ...extraPaths]);
  const rules = [...configRules(ws.config), ...packComplexityRules(packs)];
  return classify({ config: ws.config, rules, paths, text: keywordText(spec), matchGlob });
}

// The base a task starts from (§8 Decided in P2): the base branch's tip in the work repo. ws setup
// moves base.commit to app/'s HEAD in in-place mode.
export function resolveBase(ws, branch = ws.config.git.defaultBase) {
  const repo = ws.mode === 'in-place' ? ws.workRepo : mainCheckout(ws);
  if (!existsSync(repo)) throw preconditionError(`The work repo ${repo} does not exist.`, `Clone the application into ${ws.appRoot}, then run cw task start again.`);
  const result = gitResult(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`], { cwd: repo });
  if (result.code !== 0) {
    throw preconditionError(`The base branch ${branch} does not exist in ${repo}.`, `Pass --base <branch> with an existing local branch, or set git.defaultBase in ${ws.configPath}.`);
  }
  return { branch, commit: result.stdout.trim() };
}

// A recorded commit (possibly abbreviated) against a full sha.
export const sameCommit = (recorded, tip) => Boolean(recorded) && Boolean(tip) && (recorded === tip || (recorded.length >= 7 && tip.startsWith(recorded)));

// The tip of the task branch where the orchestrator's git commands run; null without the branch.
export function taskBranchTip(ws, task) {
  const tree = orchestratorTreeOf(ws, task);
  const result = gitResult(['rev-parse', '--verify', '--quiet', `refs/heads/${task.branch}`], { cwd: existsSync(tree) ? tree : ws.repoRoot });
  return result.code === 0 ? result.stdout.trim() : null;
}

// The changed files of the task's work tree since its base, [] before ws setup.
export function taskChangedFiles(ws, task) {
  const tree = workTreeOf(ws, task);
  if (!tree || !existsSync(tree) || !task.base?.commit) return [];
  return changedFiles(tree, task.base.commit);
}

// What a returned round works on (task.returnedWith, set by cw task return): the findings of that
// review and the user's decision after an escalation. Every rendering of the round's brief uses it.
function returnedInputs(ws, task) {
  const returned = task.returnedWith;
  if (!returned) return { findings: [], decision: null };
  const review = returned.review ? readRoundFile(ws, task, 'review', returned.review).data : null;
  return { findings: review ? findingsToFix(review) : [], decision: returned.mode === 'continue' ? returned.note : null };
}

// The newest report up to the task's round ({ path, data, round }), or null.
function latestReport(ws, task) {
  for (let round = task.round; round >= 1; round -= 1) {
    const file = readRoundFile(ws, task, 'report', round);
    if (file.data) return { ...file, round };
  }
  return null;
}

// The committed state of the task branch: its head, the commits and the changed files since the base;
// null before the branch exists. Read from the main checkout (worktree mode) or app/, so it holds while
// the old agent's worktree is released.
function branchState(ws, task) {
  const repo = ws.mode === 'in-place' ? ws.workRepo : mainCheckout(ws);
  if (!task.base?.commit || !existsSync(repo) || !branchExists(repo, task.branch)) return null;
  const ref = `refs/heads/${task.branch}`;
  return {
    head: git(['rev-parse', ref], { cwd: repo }),
    commits: commitsBetween(repo, task.base.commit, ref),
    files: git(['diff', '--name-only', '--no-renames', '-z', `${task.base.commit}...${ref}`], { cwd: repo }).split('\0').filter(Boolean).sort(),
  };
}

// What a fresh implementer takes over from the earlier one (ADR 0012): the handover of the newest
// report and the branch state. The findings come with the round (returnedInputs).
const takeoverInputs = (ws, task) => ({ report: latestReport(ws, task), branch: branchState(ws, task) });

// The text of brief-<role>.md, without writing it: cw task start and cw task return render it before
// they change the task, so a failure leaves the task as it was. The implementer's rules and procedures
// follow the spec's paths and the changes so far; the reviewer's rules are exactly the set cw review
// save checks (the changed files). takeover: the brief is for a fresh implementer of a started task.
export function renderTaskBrief(ws, task, role, { reportPath = null, previousReviewPath = null, movedFrom = null, takeover = false } = {}) {
  const packs = resolvePacks(ws);
  const book = buildRulebook(ws, packs);
  const specText = readText(taskPath(ws, task.id, 'spec.md'), '');
  const inherited = role === 'implementer' && takeover ? takeoverInputs(ws, task) : null;
  // A fresh worktree agent has no work tree yet: the branch's changed files stand in for it.
  const changed = unique([...taskChangedFiles(ws, task), ...(inherited?.branch?.files ?? [])]);
  const files = role === 'implementer' ? unique([...(task.paths ?? []), ...changed]) : changed;
  const rules = applicableRules(book, { files, areas: task.areas });
  const procedures = selectProcedures(loadProcedures(ws, packs), { role, paths: files, areas: task.areas, text: keywordText(parseSpec(specText)) });
  const returned = role === 'implementer' ? returnedInputs(ws, task) : { findings: [], decision: null };
  const text = renderBrief({
    ws,
    task,
    role,
    specText,
    ticket: readJson(taskPath(ws, task.id, 'ticket.json'), null),
    packages: taskPackages(ws, task),
    rules,
    procedures,
    guardrails: role === 'implementer' ? (GUARDRAILS[task.complexity] ?? []) : [],
    findings: returned.findings,
    decision: returned.decision,
    takeover: inherited,
    reportPath,
    previousReviewPath,
    movedFrom,
  });
  return { text, rules: rules.map((rule) => rule.id), procedures: procedures.map((procedure) => procedure.name) };
}

// Renders and writes brief-<role>.md.
export function prepareBrief(ws, task, role, options) {
  const { text, rules, procedures } = renderTaskBrief(ws, task, role, options);
  return { path: writeBrief(ws, task, role, text), rules, procedures };
}

export const writeClassification = (ws, task, result) => writeJson(taskPath(ws, task.id, 'classify.json'), { ...result, at: new Date().toISOString() });

// --- task reset (§6 "The misclassified reset") ------------------------------------------------------

const refused = (reason, fix) => ({ action: 'refused', reason, fix });

const keepFix = (task) =>
  `Ask the user: keep the work and continue on ${task.branch} (cw task reset --task ${task.id} --keep --note "<the user's decision>"), or discard it (the user deletes or resets ${task.branch}), then run cw task reset --task ${task.id} again.`;
const dirtyFix = (task) =>
  `Ask the user: commit the changes on ${task.branch} and keep them with cw task reset --task ${task.id} --keep --note "<the user's decision>", or discard them; then run cw task reset --task ${task.id} again.`;
// A branch with the task's name before cw task start was not created by cw: no base is recorded yet,
// or task start saw it already (branchPreexisted).
const foreignBranch = (task, repo) =>
  refused(
    task.base?.commit
      ? `${task.branch} existed in ${repo} before cw task start, so cw did not create it.`
      : `${task.branch} exists in ${repo}, but ${task.id} never started, so cw did not create it.`,
    `Ask the user whose branch it is. If it holds this task's work, keep it: cw task reset --task ${task.id} --keep --note "<the user's decision>"; otherwise the user renames or deletes it.`,
  );

// In-place: a missing branch on a clean base is nothing to do; a clean branch without commits is
// switched away from and deleted; anything else is refused.
function resetInPlace(ws, task) {
  const tree = ws.workRepo;
  const base = task.base?.branch ?? ws.config.git.defaultBase;
  const dirty = porcelain(tree);
  const now = currentBranch(tree);
  if (dirty.length) return refused(`${tree} has uncommitted changes (${listFiles(dirty)}).`, dirtyFix(task));
  if (!branchExists(tree, task.branch)) {
    return now === base ? { action: 'nothing' } : refused(`${tree} is on ${now || 'a detached HEAD'}, not on the base ${base}.`, `Ask the user to switch ${ws.appRoot} back to ${base}.`);
  }
  if (!task.base?.commit || task.branchPreexisted) return foreignBranch(task, tree);
  const commits = commitsBetween(tree, task.base.commit, `refs/heads/${task.branch}`);
  if (commits.length) return refused(`${task.branch} has ${commits.length} commit(s) since ${short(task.base.commit)}.`, keepFix(task));
  if (!branchExists(tree, base)) return refused(`The base branch ${base} does not exist in ${tree}.`, 'Ask the user which branch the work tree should be on.');
  if (now === task.branch) git(['switch', '--quiet', base], { cwd: tree });
  const { warning } = dropBranch(tree, task.branch);
  return { action: 'deleted', removed: [task.branch], warnings: warning ? [warning] : [] };
}

// The recorded worktree of this round's implementer: cw task start clears workTree, so in implement a
// recorded, existing worktree is the current agent's cwd and is never removed.
const liveImplementerTree = (task) => task.phase === 'implement' && Boolean(task.workTree) && existsSync(task.workTree);
const liveTreeRefusal = (task) =>
  refused(
    `${task.workTree} is the worktree of this round's implementer; removing it would pull its cwd away.`,
    staleAgent(task, 'implementer')
      ? `Replace the implementer of the earlier session: cw task start --task ${task.id} --new-agent releases the clean worktree.`
      : `Let the implementer go on (SendMessage), or replace it: cw task start --task ${task.id} --new-agent releases the clean worktree.`,
  );

// Worktree: a clean worktree without commits is removed with the task and agent branches.
function resetWorktree(ws, task) {
  const main = mainCheckout(ws);
  if (liveImplementerTree(task)) return liveTreeRefusal(task);
  const tree = task.workTree;
  const hasTree = Boolean(tree) && existsSync(tree);
  if (hasTree) {
    const dirty = porcelain(tree);
    if (dirty.length) return refused(`${tree} has uncommitted changes (${listFiles(dirty)}).`, dirtyFix(task));
  }
  if (branchExists(main, task.branch)) {
    if (!task.base?.commit || task.branchPreexisted) return foreignBranch(task, main);
    const commits = commitsBetween(main, task.base.commit, `refs/heads/${task.branch}`);
    if (commits.length) return refused(`${task.branch} has ${commits.length} commit(s) since ${short(task.base.commit)}.`, keepFix(task));
  }
  // A worktree deleted without `git worktree remove` still holds its branch until it is pruned.
  if (!hasTree && tree) pruneWorktrees(main);
  const agentBranch = agentBranchOf(task);
  if (!hasTree && !branchExists(main, task.branch) && !(agentBranch && branchExists(main, agentBranch))) return { action: 'nothing' };
  if (hasTree) removeWorktree(main, tree);
  const results = [dropBranch(main, task.branch), dropAgentBranch(main, task)];
  return { action: 'removed', removed: results.map((result) => result.removed).filter(Boolean), warnings: results.map((result) => result.warning).filter(Boolean) };
}

export const resetWork = (ws, task) => (ws.mode === 'in-place' ? resetInPlace(ws, task) : resetWorktree(ws, task));

// In place: uncommitted changes in app/ that the next implementer would not know about (task reset
// --keep, task start --new-agent), as { reason, fix }; null when app/ is clean or missing.
export function unknownChanges(ws, task) {
  const repo = ws.workRepo;
  const dirty = existsSync(repo) ? porcelain(repo) : [];
  if (!dirty.length) return null;
  // Before the first ws setup app/ is still on the base: committing there would put them into the base.
  const onTask = currentBranch(repo) === task.branch;
  return {
    reason: `${repo} has uncommitted changes (${listFiles(dirty)}); the next implementer would not know them.`,
    fix: onTask
      ? `Ask the user to commit them on ${task.branch} or discard them, then run the command again.`
      : `Ask the user to stash or discard them (${repo} is on ${currentBranch(repo) || 'a detached HEAD'}, not on ${task.branch}), then run the command again.`,
  };
}

// task reset --keep (§6 O7): the user keeps the task branch with its commits, and the next implementer
// continues it (resumeBranch). In worktree mode the old agent's clean worktree is released.
export function keepWork(ws, task) {
  const repo = ws.mode === 'in-place' ? ws.workRepo : mainCheckout(ws);
  if (!existsSync(repo) || !branchExists(repo, task.branch)) {
    return refused(`There is no ${task.branch} in ${repo} to keep.`, `Run cw task reset --task ${task.id} without --keep.`);
  }
  if (ws.mode === 'worktree') {
    if (liveImplementerTree(task)) return liveTreeRefusal(task);
    const released = releaseWorktree(ws, task);
    return { action: 'kept', removed: released.released ? [released.released] : [], resumeBranch: released.resumeBranch, warnings: released.warnings };
  }
  const base = task.base?.branch ?? ws.config.git.defaultBase;
  const unknown = unknownChanges(ws, task);
  if (unknown) return refused(unknown.reason, unknown.fix);
  const now = currentBranch(repo);
  if (now !== task.branch && now !== base) {
    return refused(`${repo} is on ${now || 'a detached HEAD'}, neither on ${task.branch} nor on the base ${base}.`, `Ask the user to switch ${ws.appRoot} back to ${base}.`);
  }
  return { action: 'kept', removed: [], resumeBranch: now !== task.branch, warnings: [] };
}

// --- agent handover (a new implementer agent, worktree mode) ---------------------------------------

// A new isolated agent cannot check out a branch that the old agent's worktree still holds. The clean
// old worktree is removed and the task branch kept; ws setup then switches the new worktree to it.
// A recorded worktree that is gone already (removed by the user, by cw task cleanup, or by an earlier
// run that stopped before its state update) is pruned, so git lets go of the branch.
// { released: the old path or null, resumeBranch: whether the task branch exists, warnings }.
export function releaseWorktree(ws, task) {
  const main = mainCheckout(ws);
  const tree = task.workTree;
  if (tree && existsSync(tree)) {
    const dirty = porcelain(tree);
    if (dirty.length) {
      throw preconditionError(`${tree} has uncommitted changes (${listFiles(dirty)}); a new agent would not get them.`, 'Ask the user: commit them on the task branch or discard them, then run the command again.');
    }
    if (currentBranch(tree) !== task.branch) {
      throw preconditionError(`${tree} is not on ${task.branch}.`, 'Ask the user; the task branch must hold all of the work before another agent takes over.');
    }
    removeWorktree(main, tree);
  } else if (tree) {
    pruneWorktrees(main);
  }
  const { warning } = dropAgentBranch(main, task);
  const warnings = warning ? [warning] : [];
  if (!branchExists(main, task.branch)) return { released: tree ?? null, resumeBranch: false, warnings };
  const holder = worktreeHolding(main, task.branch);
  if (holder) {
    throw preconditionError(`${task.branch} is checked out in ${holder}; a new agent cannot take it over.`, `Ask the user to switch ${holder} to another branch, then run the command again.`);
  }
  return { released: tree ?? null, resumeBranch: true, warnings };
}
