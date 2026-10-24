// Orchestrator commands of the delegation cycle (§6 O6–O8): start the implementer, read its report,
// start or continue the reviewer, read the review, send findings back, and reset the work after a
// misclassification. Each prints exactly what the orchestrator passes on: the Agent call parameters
// or the SendMessage text for the SAME agent (D4). An agent recorded in an earlier session (D3 rebind)
// is never sent a message: it gets a fresh Agent call. So does an implementer whose context grew past
// workflow.freshImplementerAboveTokens when the work goes back to it (ADR 0012).
import { existsSync, renameSync, rmSync } from 'node:fs';
import { agentCall, findingsToFix, returnMessage, reviewerFollowUp, reviewerRecheck, specChangedMessage, writeBrief } from '../lib/brief.mjs';
import { keepWork, releaseWorktree, renderTaskBrief, resetWork, resolveBase, sameCommit, taskBranchTip, unknownChanges } from '../lib/cycle.mjs';
import { readJson } from '../lib/fsx.mjs';
import { quote } from '../lib/host/index.mjs';
import { branchExists, currentBranch } from '../lib/git.mjs';
import { failedError, preconditionError, usageError } from '../lib/out.mjs';
import { prBodyPath } from '../lib/pr.mjs';
import { fence } from '../lib/report.mjs';
import { STEPS_TOTAL, isActive, listTasks, readRoundFile, setResumeBranch, staleAgent, transition, updateTask } from '../lib/task.mjs';
import { kTokens, measureAgentContext } from '../lib/transcript.mjs';
import { taskPath } from '../lib/workspace.mjs';
import { mainCheckout } from '../lib/worktree.mjs';
import { emit, loadTaskContext, requireFlag } from './common.mjs';
import { lintTaskSpec } from './spec.mjs';

const now = () => new Date().toISOString();
const freshSteps = () => ({ done: 0, total: STEPS_TOTAL, note: '' });
const short = (sha) => String(sha ?? '').slice(0, 10);

// Where each phase continues, for the fixes of refused commands.
const NEXT_BY_PHASE = {
  spec: (id) => `cw spec lint --task ${id}, then cw classify --task ${id}`,
  classify: (id) => `cw classify --task ${id} --set <c> --why "…"`,
  confirm: (id) => `cw task start --task ${id}`,
  implement: (id) => `cw report show --task ${id}`,
  review: (id) => `cw review show --task ${id}`,
  deliver: (id) => `cw pr command --task ${id}`,
  escalated: (id) => `ask the user, then cw task return --task ${id} --continue --note "<the user's decision>" or cw task end --task ${id} --outcome escalated`,
};

function requireActive(task) {
  if (!isActive(task)) throw preconditionError(`Task ${task.id} has ended (${task.outcome}).`, 'Start a new task with cw task new.');
}

function wrongPhase(task, command, phases) {
  const next = NEXT_BY_PHASE[task.phase]?.(task.id) ?? 'cw task show --task <id>';
  return preconditionError(`${command} needs phase ${phases.join(' or ')}; task ${task.id} is in ${task.phase}.`, `Continue with: ${next}.`);
}

function requireCleanSpec(ws, task) {
  const { errors } = lintTaskSpec(ws, task);
  if (errors.length) {
    throw failedError(`The spec of ${task.id} has ${errors.length} error(s):\n- ${errors.join('\n- ')}`, `Fix them and save the spec again: cw spec save --task ${task.id}.`, { errors });
  }
}

// The newest review file before the given round, for the reviewer's follow-up and the findings to fix.
function latestReview(ws, task, below = task.round + 1) {
  for (let round = below - 1; round >= 1; round -= 1) {
    const file = readRoundFile(ws, task, 'review', round);
    if (file.data) return { ...file, round };
  }
  return { path: null, data: null, round: null };
}

const stamp = (ws, task, role) =>
  updateTask(ws, task.id, (current) => {
    current.agents[role] = { ...(current.agents[role] ?? {}), shownAt: now() };
  });

// Why an agent of the earlier session gets no SendMessage (D3), for the printed texts.
const staleReason = (task, role) =>
  `${task.agents[role].id} was recorded in session ${task.agents[role].session ?? '(none)'}, and the task now belongs to session ${task.ownerSession ?? '(none)'}`;

function printDelegation(ctx, value) {
  const { out } = ctx;
  if (value.freshAgent) out.print(`A fresh ${value.role}: ${value.freshAgent}.`);
  if (value.context?.unmeasured) out.print(value.context.unmeasured);
  if (value.agentCall) {
    out.print('Call the Agent tool with exactly these parameters:');
    out.print(fence(value.agentCall));
  }
  if (value.sendMessage) {
    out.print(`SendMessage to ${value.sendMessage.to} (the same ${value.role}) with exactly this message:`);
    out.print(`\`\`\`text\n${value.sendMessage.message}\n\`\`\``);
  }
  out.print(`Next: ${value.next.join('; then ')}`);
}

// In-place the implementer always works in app/: after task cleanup app/ may be back on the base,
// and ws setup then switches to the existing task branch again (resumeBranch).
const leftTaskBranch = (ws, task) => ws.mode === 'in-place' && branchExists(ws.workRepo, task.branch) && currentBranch(ws.workRepo) !== task.branch;

// Renders the implementer brief from the state the task will have, hands the work over to a new agent
// where needed, changes the task under the revision guard, and only then writes the brief: a broken
// procedure or rule file leaves the task as it was. A release whose state update then fails is found
// again by the next run (releaseWorktree prunes a recorded worktree that is gone).
function delegateImplementer(ws, task, mutate, { fresh }) {
  const preview = structuredClone(task);
  mutate(preview, { resumeBranch: false });
  // A fresh agent of a started task gets the handover and the branch state (ADR 0012).
  const rendered = renderTaskBrief(ws, preview, 'implementer', { takeover: fresh && task.round >= 1 });
  const handover = fresh && ws.mode === 'worktree' ? releaseWorktree(ws, task) : { released: null, resumeBranch: false, warnings: [] };
  const { task: updated } = updateTask(ws, task.id, (current) => mutate(current, handover), { expectRev: task.rev });
  const path = writeBrief(ws, updated, 'implementer', rendered.text);
  return { task: updated, handover, brief: { path, rules: rendered.rules, procedures: rendered.procedures } };
}

// The agent fields of a fresh implementer: worktree mode forgets the old worktree, and the new
// agent's ws setup continues the task branch when it exists (resumeBranch).
function forgetImplementer(ws, current, handover) {
  current.agents.implementer = null;
  if (ws.mode === 'worktree') {
    current.workTree = null;
    current.agentBranch = null;
    setResumeBranch(current, handover.resumeBranch, 'handover');
  }
}

// --- task start ---------------------------------------------------------------------------------------

// D6: in-place mode allows one active task per work tree. A task that started (round ≥ 1) and has not
// ended may hold app/, whatever its phase.
function requireFreeWorkTree(ws, task) {
  const other = listTasks(ws).find((candidate) => candidate.id !== task.id && candidate.round >= 1);
  if (other) {
    throw preconditionError(
      `${ws.appRoot} is the work tree of the active task ${other.id} (phase ${other.phase}); in-place mode runs one task at a time.`,
      `Finish ${other.id} first, or drop it after asking the user: cw task end --task ${other.id} --outcome aborted, then cw task cleanup --task ${other.id}.`,
    );
  }
}

function start(ctx) {
  const { ws, task } = loadTaskContext(ctx);
  requireActive(task);
  if (task.phase === 'implement' && ctx.flags['new-agent']) return restartImplementer(ctx, ws, task);
  if (!['classify', 'confirm'].includes(task.phase)) throw wrongPhase(task, 'cw task start', ['classify', 'confirm']);
  if (!task.complexity) throw preconditionError(`Task ${task.id} has no complexity yet.`, `Choose it: cw classify --task ${task.id} --set <c> --why "…".`);
  if (task.phase === 'classify' && ws.config.workflow.confirm.includes(task.complexity)) {
    throw preconditionError(`Complexity ${task.complexity} needs the user's confirmation (workflow.confirm).`, `AskUserQuestion with the spec summary and the classification, then cw task confirm --task ${task.id} --note "…".`);
  }
  if (task.resetPending) throw preconditionError(`Task ${task.id} was misclassified and its work is not reset yet.`, `Run cw task reset --task ${task.id} first.`);
  if (ws.mode === 'in-place') requireFreeWorkTree(ws, task);
  requireCleanSpec(ws, task);
  const base = resolveBase(ws, ctx.flags.base ?? ws.config.git.defaultBase);
  // A same-named branch that exists now and is not kept for the task is not cw's: reset must not delete it.
  const branchNow = branchExists(ws.mode === 'in-place' ? ws.workRepo : mainCheckout(ws), task.branch);
  const { task: started, brief } = delegateImplementer(ws, task, (current) => {
    transition(current, 'implement', { note: `round ${current.round + 1}, complexity ${current.complexity}, base ${base.branch}@${base.commit.slice(0, 10)}`, by: 'cw task start' });
    current.round += 1;
    current.base = base;
    current.steps = freshSteps();
    current.agents.implementer = null;
    current.previousComplexity = null;
    current.returnedWith = null;
    // A branch kept with cw task reset --keep (or handed over) is continued. One that only task cleanup
    // saw is not: ws setup then refuses a same-named branch that cw did not create.
    if (!['keep', 'handover'].includes(current.resumeBranchBy)) setResumeBranch(current, false);
    current.branchPreexisted = branchNow && !current.resumeBranch;
    if (ws.mode === 'worktree') {
      current.workTree = null;
      current.agentBranch = null;
    }
  }, { fresh: false });
  const value = {
    task: started.id,
    role: 'implementer',
    round: started.round,
    complexity: started.complexity,
    base,
    brief: brief.path,
    rules: brief.rules,
    procedures: brief.procedures,
    agentCall: agentCall(ws, started, 'implementer', brief.path),
    next: [`cw task agent --task ${started.id} --role implementer --id <the agentId the Agent tool returned>`, `cw report show --task ${started.id}`],
  };
  emit(ctx, value, () => printDelegation(ctx, value));
}

// cw task start --new-agent in implement: the round's implementer is gone (its Agent call was lost, or
// it belongs to an earlier session) and left no report or a blocked one. A fresh agent takes the same
// round over with the re-rendered brief.
function restartImplementer(ctx, ws, task) {
  const report = readRoundFile(ws, task, 'report').data;
  if (report && report.status !== 'blocked') {
    throw preconditionError(`The report of round ${task.round} is ${report.status}; a fresh implementer replaces one that left no report or a blocked one.`, `Continue with: cw report show --task ${task.id}.`);
  }
  if (ws.mode === 'in-place') {
    // Worktree mode refuses a dirty worktree when it releases it (releaseWorktree).
    const unknown = unknownChanges(ws, task);
    if (unknown) throw preconditionError(unknown.reason, unknown.fix);
  }
  const resume = leftTaskBranch(ws, task);
  const previous = task.agents.implementer?.id ?? null;
  const { task: restarted, brief, handover } = delegateImplementer(ws, task, (current, released) => {
    current.history.push({
      at: now(), from: current.phase, to: current.phase, note: `a fresh implementer for round ${current.round}${previous ? ` (was ${previous})` : ''}`, by: 'cw task start --new-agent',
      agentSwitch: { role: 'implementer', reason: 'new-agent', previous },
    });
    current.steps = freshSteps();
    forgetImplementer(ws, current, released);
    if (ws.mode === 'in-place') setResumeBranch(current, resume, 'handover');
  }, { fresh: true });
  for (const warning of handover.warnings) ctx.out.warn(warning);
  const value = {
    task: restarted.id,
    role: 'implementer',
    round: restarted.round,
    complexity: restarted.complexity,
    base: restarted.base,
    brief: brief.path,
    rules: brief.rules,
    procedures: brief.procedures,
    freshAgent: previous ? `it replaces ${previous}` : 'no implementer was recorded',
    releasedWorktree: handover.released,
    agentCall: agentCall(ws, restarted, 'implementer', brief.path),
    next: [`cw task agent --task ${restarted.id} --role implementer --id <the agentId the Agent tool returned>`, `cw report show --task ${restarted.id}`],
  };
  emit(ctx, value, () => printDelegation(ctx, value));
}

// --- report show --------------------------------------------------------------------------------------

const freshImplementer = (task) => `cw task start --task ${task.id} --new-agent`;

function nextForReport(task, report) {
  const agent = task.agents.implementer?.id ?? '<implementer agentId>';
  if (report.status === 'done') return [`cw git foreign-commits --task ${task.id}`, `cw task review --task ${task.id}`];
  if (report.status === 'blocked') {
    if (staleAgent(task, 'implementer')) {
      return [`answer from the spec and the code, else ask the user; put the answer into the spec (cw spec save --task ${task.id}), then start a fresh implementer: ${freshImplementer(task)} (${staleReason(task, 'implementer')})`];
    }
    return [`answer from the spec and the code via SendMessage to ${agent} (the same implementer), else ask the user; a spec change: cw spec save --task ${task.id}`];
  }
  return [`cw classify --task ${task.id} (it was ${task.complexity}, the implementer suggests ${report.misclassified.suggested}); tell the user the old and the new complexity`];
}

function missingReportFix(task) {
  const agent = task.agents.implementer?.id;
  if (!agent) return `Wait for the implementer to finish; it ends with cw report save. If no implementer runs (its Agent call was lost or denied), start one: ${freshImplementer(task)}.`;
  if (staleAgent(task, 'implementer')) return `Start a fresh implementer: ${freshImplementer(task)} (${staleReason(task, 'implementer')}).`;
  return `If the implementer ended without one, SendMessage ${agent}: "Finish with cw report save --task ${task.id} and end with its JSON fence." If it is gone, start a fresh one: ${freshImplementer(task)}.`;
}

function reportShow(ctx) {
  const { ws, task } = loadTaskContext(ctx);
  requireActive(task);
  if (task.phase !== 'implement') throw wrongPhase(task, 'cw report show', ['implement']);
  const { path, data: report } = readRoundFile(ws, task, 'report');
  if (!report) throw preconditionError(`There is no report for round ${task.round} yet (${path}).`, missingReportFix(task));
  stamp(ws, task, 'implementer');
  const value = { task: task.id, round: task.round, file: path, ...report, next: nextForReport(task, report) };
  emit(ctx, value, () => {
    const { out } = ctx;
    out.print(`Report round ${value.round}: ${value.status} · ${value.commits.length} commit(s) on ${value.branch} · checks ${value.checks.overall}${value.checks.current ? '' : ' (not current)'} · ${value.proofs.filter((proof) => proof.holds).length} holding proof(s)`);
    for (const ac of value.acceptanceCriteria) out.print(`  ${ac.id} ${ac.met ? 'met' : 'NOT met'}: ${ac.evidence}`);
    for (const proof of value.staleProofs ?? []) out.print(`stale proof ${proof.id} (${proof.test}), not counted: ${proof.reason}`);
    if (value.blocked) out.print(`Blocked: ${value.blocked.question}\nNeeded: ${value.blocked.needed}`);
    if (value.misclassified) out.print(`Misclassified: ${value.misclassified.reason} (suggests ${value.misclassified.suggested})`);
    for (const risk of value.risks) out.print(`risk: ${risk}`);
    for (const point of value.openPoints) out.print(`open point${point.tag ? ` (${point.tag})` : ''}: ${point.text}`);
    for (const warning of value.warnings) out.warn(warning);
    out.print(`Next: ${value.next.join('; then ')}`);
  });
}

// --- task review ------------------------------------------------------------------------------------

// The approved review of the round when the task branch moved after it (§6 O9): cw task review then
// starts a new review round over the commits since the approved head. null otherwise.
function movedAfterApproval(ws, task, saved) {
  if (saved.data?.status !== 'approved') return null;
  const tip = taskBranchTip(ws, task);
  return tip && !sameCommit(saved.data.head, tip) ? { ...saved, tip } : null;
}

// Where a re-review round keeps the approval it started from: review-<round>-r<its review round>.json.
const archivedApprovalPath = (ws, task, reviewRound) => taskPath(ws, task.id, `review-${task.round}-r${reviewRound}.json`);

// The approval the current re-review round started from, while that round has no review yet; null
// otherwise. A rerun of cw task review then prints the same recheck and brief as its first call.
function archivedApproval(ws, task) {
  const path = archivedApprovalPath(ws, task, task.reviewRound - 1);
  const data = existsSync(path) ? readJson(path) : null;
  return data?.status === 'approved' ? { path, data } : null;
}

function review(ctx) {
  const { ws, task: loaded } = loadTaskContext(ctx);
  requireActive(loaded);
  let task = loaded;
  const reportFile = readRoundFile(ws, task, 'report');
  const saved = readRoundFile(ws, task, 'review');
  let previous = null;
  let movedFrom = null;
  let mutate = null;
  let moved = null;
  let archived = null;
  if (task.phase === 'implement') {
    if (reportFile.data?.status !== 'done') {
      throw preconditionError(`The report of round ${task.round} is ${reportFile.data?.status ?? 'missing'}, not done.`, `Read it first: cw report show --task ${task.id}.`);
    }
    mutate = (current) => {
      transition(current, 'review', { note: `review round ${current.reviewRound + 1}`, by: 'cw task review' });
      current.reviewRound += 1;
    };
  } else if (['review', 'deliver'].includes(task.phase) && saved.data) {
    moved = movedAfterApproval(ws, task, saved);
    if (!moved) {
      throw preconditionError(
        `The review of round ${task.round} is saved (${saved.data.status}); cw task review starts another review round only when the branch moved after an approval.`,
        `Continue with: ${NEXT_BY_PHASE[task.phase](task.id)}.`,
      );
    }
    // A reviewer reads the implementer's work tree; after task cleanup (or by hand) it can be gone.
    if (ws.mode === 'worktree' && !(task.workTree && existsSync(task.workTree))) {
      throw preconditionError(
        `${task.branch} moved after the approval of ${short(moved.data.head)} (now ${short(moved.tip)}), but the implementer worktree is gone, so no reviewer can check the new commits.`,
        `Ask the user: reset the branch to the approved commit (git -C ${quote(mainCheckout(ws))} branch -f ${task.branch} ${moved.data.head}) and continue with cw pr command --task ${task.id}; or let a fresh implementer take the change into a new round: cw spec save --task ${task.id} (name the late change), then cw task return --task ${task.id} --spec-changed --note "<why>" --new-agent.`,
      );
    }
    // The approved review keeps its file under another name; the new round saves review-<round>.json.
    archived = archivedApprovalPath(ws, task, moved.data.reviewRound ?? task.reviewRound);
    mutate = (current) => {
      const note = `${current.branch} moved after the approval of ${short(moved.data.head)} (now ${short(moved.tip)}); review round ${current.reviewRound + 1}`;
      if (current.phase === 'deliver') transition(current, 'review', { note, by: 'cw task review' });
      else current.history.push({ at: now(), from: current.phase, to: current.phase, note, by: 'cw task review' });
      current.reviewRound += 1;
    };
    previous = { path: archived, data: moved.data };
    movedFrom = moved.data.head;
  } else if (task.phase !== 'review') {
    throw wrongPhase(task, 'cw task review', ['implement']);
  } else {
    // In review without a saved review the command only prints the delegation again, in a re-review
    // round with the approval it started from, as its first call did.
    const approval = archivedApproval(ws, task);
    if (approval) {
      previous = approval;
      movedFrom = approval.data.head;
    }
  }
  // The brief is rendered from the next state before anything changes, so a broken procedure or rule
  // file leaves the task where it was.
  const preview = structuredClone(task);
  if (mutate) mutate(preview);
  previous ??= latestReview(ws, preview, preview.round);
  const rendered = renderTaskBrief(ws, preview, 'reviewer', { reportPath: reportFile.path, previousReviewPath: previous.path, movedFrom });
  const reviewer = loaded.agents.reviewer?.id;
  const stale = staleAgent(loaded, 'reviewer');
  const followUp = Boolean(reviewer) && !ctx.flags['new-agent'] && !stale;
  const freshAgent = stale && !ctx.flags['new-agent'] ? staleReason(loaded, 'reviewer') : null;
  // A fresh Agent call replaces the recorded reviewer, as forgetImplementer does for the implementer:
  // the slot is free again, so SubagentStart records the new agent and the stop gate checks it (§9).
  const forget = !followUp && loaded.agents.reviewer ? (current) => { current.agents.reviewer = null; } : null;
  if (mutate || forget) {
    task = updateTask(ws, task.id, (current) => {
      mutate?.(current);
      forget?.(current);
    }, { expectRev: task.rev }).task;
  }
  if (moved) {
    renameSync(moved.path, archived);
    if (loaded.phase === 'deliver') rmSync(prBodyPath(ws, task), { force: true });
  }
  const brief = { path: writeBrief(ws, task, 'reviewer', rendered.text), rules: rendered.rules, procedures: rendered.procedures };
  const message = movedFrom
    ? reviewerRecheck(task, brief.path, movedFrom)
    : reviewerFollowUp(task, brief.path, reportFile.path, previous.data?.head ?? task.base.commit);
  const value = {
    task: task.id,
    role: 'reviewer',
    round: task.round,
    reviewRound: task.reviewRound,
    brief: brief.path,
    rules: brief.rules,
    procedures: brief.procedures,
    ...(freshAgent ? { freshAgent } : {}),
    ...(followUp ? { sendMessage: { to: reviewer, message } } : { agentCall: agentCall(ws, task, 'reviewer', brief.path) }),
    next: [
      ...(followUp ? [] : [`cw task agent --task ${task.id} --role reviewer --id <the agentId the Agent tool returned>`]),
      `cw review show --task ${task.id}`,
    ],
  };
  emit(ctx, value, () => printDelegation(ctx, value));
}

// --- review show --------------------------------------------------------------------------------------

const escalatedNext = (task) =>
  [`ask the user with the open blocking findings: continue (cw task return --task ${task.id} --continue --note "<the user's decision>") or stop (cw task end --task ${task.id} --outcome escalated)`];

function missingReviewFix(task) {
  const agent = task.agents.reviewer?.id;
  if (!agent) return `Wait for the reviewer to finish; it ends with cw review save. If no reviewer runs, start one: cw task review --task ${task.id} --new-agent.`;
  if (staleAgent(task, 'reviewer')) return `Start a fresh reviewer: cw task review --task ${task.id} --new-agent (${staleReason(task, 'reviewer')}).`;
  return `If the reviewer ended without one, SendMessage ${agent}: "Finish with cw review save --task ${task.id} and end with its JSON fence." If it is gone, start a fresh one: cw task review --task ${task.id} --new-agent.`;
}

function printReview(ctx, value) {
  const { out } = ctx;
  out.print(`Review round ${value.reviewRound}/${value.maxReviewRounds}: ${value.status}${value.escalated ? ' · escalated (maximum rounds reached)' : ''}`);
  if (value.summary) out.print(value.summary);
  for (const ac of value.acceptanceCriteria) out.print(`  ${ac.id} ${ac.met ? 'met' : 'NOT met'}: ${ac.evidence}`);
  for (const finding of value.findings) {
    out.print(`  ${finding.id} [${finding.severity}${finding.sendAlong ? ', send along' : ''} · ${finding.rule}] ${finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}: ` : ''}${finding.issue}`);
  }
  out.print(`Next: ${value.next.join('; then ')}`);
}

const blockingFirst = (findings) => [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1));

function reviewShow(ctx) {
  const { ws, task } = loadTaskContext(ctx);
  requireActive(task);
  if (!['review', 'escalated'].includes(task.phase)) throw wrongPhase(task, 'cw review show', ['review', 'escalated']);
  const { path, data: saved } = readRoundFile(ws, task, 'review');
  const max = ws.config.workflow.maxReviewRounds;
  if (task.phase === 'escalated') {
    // Read-only: the open findings again for the user's decision, after a rebind too.
    if (!saved) throw preconditionError(`There is no review for round ${task.round} (${path}).`, `Ask the user how to continue: ${NEXT_BY_PHASE.escalated(task.id)}.`);
    const value = { task: task.id, round: task.round, reviewRound: task.reviewRound, maxReviewRounds: max, file: path, ...saved, findings: blockingFirst(saved.findings), escalated: true, next: escalatedNext(task) };
    return emit(ctx, value, () => printReview(ctx, value));
  }
  if (!saved) throw preconditionError(`There is no review for round ${task.round} yet (${path}).`, missingReviewFix(task));
  stamp(ws, task, 'reviewer');
  const escalate = saved.status === 'changes_requested' && task.reviewRound >= max;
  if (escalate) {
    updateTask(ws, task.id, (current) => transition(current, 'escalated', { note: `${current.reviewRound} review rounds without approval (max ${max})`, by: 'cw review show' }));
  }
  const next = saved.status === 'approved'
    ? [`cw pr body --task ${task.id}`, `cw pr command --task ${task.id}`]
    : escalate
      ? escalatedNext(task)
      : [`cw task return --task ${task.id}${staleAgent(task, 'implementer') ? ' --new-agent' : ''}`];
  const value = { task: task.id, round: task.round, reviewRound: task.reviewRound, maxReviewRounds: max, file: path, ...saved, findings: blockingFirst(saved.findings), escalated: escalate, next };
  emit(ctx, value, () => printReview(ctx, value));
}

// --- task return --------------------------------------------------------------------------------------

function returnMode(ctx) {
  const { flags } = ctx;
  if (flags['spec-changed'] && flags.continue) throw usageError('--spec-changed and --continue exclude each other', 'Pass one of them, or neither to send the review findings back.');
  if (flags.note && !flags['spec-changed'] && !flags.continue) {
    throw usageError('--note goes with --spec-changed or --continue', 'cw task return --task <id> --spec-changed --note "<what changed>", or --continue --note "<the user\'s decision>".');
  }
  return flags['spec-changed'] ? 'spec' : flags.continue ? 'continue' : 'findings';
}

// The review whose findings go back ({ round, data }), or null for a spec change.
function checkReturn(ws, task, mode, ctx) {
  if (mode === 'findings') {
    if (task.phase !== 'review') throw wrongPhase(task, 'cw task return', ['review']);
    const saved = readRoundFile(ws, task, 'review').data;
    if (saved?.status !== 'changes_requested') {
      throw preconditionError(`The review of round ${task.round} is ${saved?.status ?? 'missing'}; only requested changes go back.`, `Read it: cw review show --task ${task.id}.`);
    }
    if (task.reviewRound >= ws.config.workflow.maxReviewRounds) {
      throw preconditionError(`Task ${task.id} reached ${task.reviewRound} review rounds (the maximum).`, `cw review show --task ${task.id} escalates it; then ask the user.`);
    }
    return { round: task.round, data: saved };
  }
  if (mode === 'spec') {
    // In review only after an approval: the task stays there until the first pr command (O8).
    const approved = task.phase === 'review' && readRoundFile(ws, task, 'review').data?.status === 'approved';
    if (!['deliver', 'escalated'].includes(task.phase) && !approved) throw wrongPhase(task, 'cw task return --spec-changed', ['deliver', 'escalated', 'review (approved)']);
    if (!task.specChanged) throw preconditionError(`The spec of ${task.id} has not changed since the review.`, `Save the changed spec first: cw spec save --task ${task.id}.`);
    requireFlag(ctx.flags, 'note', 'Pass --note "<what changed in the spec>".');
    requireCleanSpec(ws, task);
    return null;
  }
  if (task.phase !== 'escalated') throw wrongPhase(task, 'cw task return --continue', ['escalated']);
  if (task.specChanged) throw preconditionError(`The spec of ${task.id} changed.`, `Restart with the new spec: cw task return --task ${task.id} --spec-changed --note "<what changed>".`);
  requireFlag(ctx.flags, 'note', `Pass the user's decision: cw task return --task ${task.id} --continue --note "<the user's decision>".`);
  const latest = latestReview(ws, task);
  return latest.data ? { round: latest.round, data: latest.data } : null;
}

// The implementer's context against workflow.freshImplementerAboveTokens (ADR 0012): every call of an
// agent continued by SendMessage reads its whole context again, while a fresh one starts from the
// brief. null when the rule is off or no agent is recorded; { tokens, limit, path, over } when
// measured; { tokens: null, unmeasured } when the size cannot be read, and the SendMessage stays.
function implementerContext(ws, task, env) {
  const limit = ws.config.workflow.freshImplementerAboveTokens;
  const agent = task.agents.implementer;
  if (!limit || !agent?.id) return null;
  const measured = measureAgentContext(agent, env);
  if (measured.tokens === null) {
    return { tokens: null, limit, path: measured.path, unmeasured: `The context size of ${agent.id} is unknown (${measured.reason}), so it gets the SendMessage.` };
  }
  return { tokens: measured.tokens, limit, path: measured.path, over: measured.tokens > limit };
}

// Why the next round needs a fresh implementer Agent call instead of a SendMessage: { reason, why,
// switch } with reason null for none. why is the short form for the history; switch the record of it.
function freshImplementerReason(ws, task, ctx) {
  const previous = task.agents.implementer?.id ?? null;
  const fresh = (reason, why, extra = {}) => ({ reason, why, switch: { role: 'implementer', previous, ...extra } });
  if (ctx.flags['new-agent']) return fresh('--new-agent', '--new-agent', { reason: 'new-agent' });
  if (ws.mode === 'worktree' && !(task.workTree && existsSync(task.workTree))) {
    return fresh(`the recorded worktree ${task.workTree ?? '(none)'} is gone, and with it the implementer's cwd`, 'its worktree is gone', { reason: 'worktree-gone' });
  }
  if (staleAgent(task, 'implementer')) return fresh(staleReason(task, 'implementer'), 'an agent of an earlier session', { reason: 'earlier-session' });
  const context = implementerContext(ws, task, ctx.env);
  if (context?.over) {
    const size = `${kTokens(context.tokens)} > ${kTokens(context.limit)}`;
    return {
      ...fresh(`the context of ${previous} is ${kTokens(context.tokens)} tokens, above workflow.freshImplementerAboveTokens (${kTokens(context.limit)})`, `context ${size}`, { reason: 'context', tokens: context.tokens, limit: context.limit }),
      context,
    };
  }
  return { reason: null, why: null, switch: null, context };
}

function giveBack(ctx) {
  const { ws, task } = loadTaskContext(ctx);
  requireActive(task);
  const mode = returnMode(ctx);
  const review = checkReturn(ws, task, mode, ctx);
  const { reason: fresh, why, switch: agentSwitch, context } = freshImplementerReason(ws, task, ctx);
  const implementer = task.agents.implementer?.id;
  if (!fresh && !implementer) {
    throw preconditionError(`No implementer agent is recorded for ${task.id}, so there is nobody to send the message to.`, `Start a fresh one: cw task return --task ${task.id}${mode === 'spec' ? ' --spec-changed --note "…"' : mode === 'continue' ? ' --continue --note "…"' : ''} --new-agent.`);
  }
  const note = ctx.flags.note ?? null;
  const reviewRound = task.reviewRound;
  const resume = leftTaskBranch(ws, task);
  const { task: back, brief, handover } = delegateImplementer(ws, task, (current, released) => {
    const historyNote = mode === 'spec' ? `spec changed: ${note}` : mode === 'continue' ? `the user continues after the escalation: ${note}` : `review round ${current.reviewRound} requested changes`;
    transition(current, 'implement', { note: historyNote, by: 'cw task return' });
    current.round += 1;
    if (fresh) {
      current.history.push({ at: now(), from: 'implement', to: 'implement', note: `a fresh implementer for round ${current.round} (${why})`, by: 'cw task return', agentSwitch });
    }
    current.steps = freshSteps();
    current.returnedWith = { mode, review: review?.round ?? null, note };
    if (mode !== 'findings') {
      current.cycle += 1;
      current.reviewRound = 0;
      current.specChanged = false;
    }
    if (ws.mode === 'in-place') setResumeBranch(current, resume, 'handover');
    if (fresh) forgetImplementer(ws, current, released);
  }, { fresh: Boolean(fresh) });
  // A PR/MR body written for the earlier state must not be reused (cw pr command reuses an existing one).
  if (task.phase === 'deliver') rmSync(prBodyPath(ws, back), { force: true });
  let message = null;
  if (!fresh) {
    message = mode === 'spec'
      ? specChangedMessage(back, note, brief.path, { setupFirst: resume })
      : returnMessage({ ...back, reviewRound }, review?.data, brief.path, { decision: mode === 'continue' ? note : null, setupFirst: resume });
  }
  for (const warning of handover.warnings) ctx.out.warn(warning);
  const value = {
    task: back.id,
    role: 'implementer',
    mode,
    round: back.round,
    cycle: back.cycle,
    brief: brief.path,
    findings: review ? findingsToFix(review.data) : [],
    releasedWorktree: handover.released,
    ...(context ? { context } : {}),
    ...(fresh ? { freshAgent: fresh, agentCall: agentCall(ws, back, 'implementer', brief.path) } : { sendMessage: { to: implementer, message } }),
    next: [
      ...(fresh ? [`cw task agent --task ${back.id} --role implementer --id <the agentId the Agent tool returned>`] : []),
      `cw report show --task ${back.id}`,
    ],
  };
  emit(ctx, value, () => printDelegation(ctx, value));
}

// --- task reset ---------------------------------------------------------------------------------------

function resetNext(ws, task) {
  const id = task.id;
  if (task.phase === 'implement') {
    return staleAgent(task, 'implementer') ? freshImplementer(task) : `SendMessage the same implementer: run cw ws setup --task ${id} again`;
  }
  if (task.complexity && task.phase === 'classify' && ws.config.workflow.confirm.includes(task.complexity)) {
    return `AskUserQuestion with the spec summary and the classification, then cw task confirm --task ${id} --note "<what the user confirmed>"`;
  }
  if (task.complexity && ['classify', 'confirm'].includes(task.phase)) return `cw task start --task ${id}`;
  return NEXT_BY_PHASE[task.phase](id);
}

function reset(ctx) {
  const { ws, task } = loadTaskContext(ctx);
  requireActive(task);
  if (!['spec', 'classify', 'confirm', 'implement'].includes(task.phase)) throw wrongPhase(task, 'cw task reset', ['spec', 'classify', 'confirm', 'implement']);
  const keep = Boolean(ctx.flags.keep);
  if (ctx.flags.note && !keep) throw usageError('--note goes with --keep', `cw task reset --task ${task.id} --keep --note "<the user's decision>".`);
  const note = keep ? requireFlag(ctx.flags, 'note', 'Pass the user\'s decision: --note "<why the work is kept>".') : null;
  const result = keep ? keepWork(ws, task) : resetWork(ws, task);
  if (result.action === 'refused') throw preconditionError(`Task ${task.id} cannot be reset: ${result.reason}`, result.fix, { task: task.id, ...result });
  const { task: updated } = updateTask(ws, task.id, (current) => {
    current.resetPending = false;
    setResumeBranch(current, keep && result.resumeBranch, 'keep');
    current.history.push({ at: now(), from: current.phase, to: current.phase, note: keep ? `work kept on ${current.branch}: ${note}` : `work reset (${result.action})`, by: 'cw task reset' });
    if (ws.mode === 'worktree') {
      current.workTree = null;
      current.agentBranch = null;
    }
  }, { expectRev: task.rev });
  for (const warning of result.warnings ?? []) ctx.out.warn(warning);
  const next = resetNext(ws, updated);
  const value = { task: updated.id, action: result.action, removed: result.removed ?? [], resumeBranch: updated.resumeBranch, next };
  emit(ctx, value, () => ctx.out.print(`${value.task}: ${value.action}${value.removed.length ? ` (${value.removed.join(', ')})` : ''}. Next: ${next}`));
}

export const commands = [
  {
    path: ['task', 'start'],
    group: 'orchestrator',
    usage: 'cw task start --task <id> [--base <branch>] | cw task start --task <id> --new-agent',
    summary: 'Start an implementer round: record the base, write the brief, print the exact Agent call (O6); --new-agent replaces a lost implementer',
    flags: { task: 'string', base: 'string', 'new-agent': 'boolean' },
    run: start,
  },
  {
    path: ['report', 'show'],
    group: 'orchestrator',
    usage: 'cw report show --task <id> [--json]',
    summary: "Show the implementer's report of the current round and what to do next (O7)",
    flags: { task: 'string' },
    run: reportShow,
  },
  {
    path: ['task', 'review'],
    group: 'orchestrator',
    usage: 'cw task review --task <id> [--new-agent]',
    summary: 'Start a review round: the reviewer brief and the Agent call, or the SendMessage to the same reviewer (O8)',
    flags: { task: 'string', 'new-agent': 'boolean' },
    run: review,
  },
  {
    path: ['review', 'show'],
    group: 'orchestrator',
    usage: 'cw review show --task <id> [--json]',
    summary: "Show the reviewer's result; escalates after the maximum review rounds (O8)",
    flags: { task: 'string' },
    run: reviewShow,
  },
  {
    path: ['task', 'return'],
    group: 'orchestrator',
    usage: 'cw task return --task <id> [--spec-changed --note <text> | --continue --note <text>] [--new-agent]',
    summary: 'Send the review findings, a spec change or the go-on after an escalation back to the implementer (O8)',
    flags: { task: 'string', 'spec-changed': 'boolean', note: 'string', continue: 'boolean', 'new-agent': 'boolean' },
    run: giveBack,
  },
  {
    path: ['task', 'reset'],
    group: 'orchestrator',
    usage: 'cw task reset --task <id> [--keep --note <the user\'s decision>]',
    summary: "Undo an implementer's empty start (task branch, worktree) after a misclassification, or refuse; --keep continues the branch (O7)",
    flags: { task: 'string', keep: 'boolean', note: 'string' },
    run: reset,
  },
];
