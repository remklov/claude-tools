// Delivery commands (§6 O8-O10, D7, §10): foreign commits on the task branch, the PR/MR title, body and
// commands, the recorded URL, and the cleanup of the work tree. cw never pushes and never creates a
// PR/MR: it prints the exact commands, and the orchestrator runs them after the user confirmed.
import { existsSync, realpathSync } from 'node:fs';
import {
  branchExists, commitsBetween, currentBranch, git, gitResult, headCommit, porcelain,
} from '../lib/git.mjs';
import { sameCommit } from '../lib/cycle.mjs';
import { adapterFor, detectHost, pushCommand, quote, requireHost } from '../lib/host/index.mjs';
import { EXIT, failedError, preconditionError, usageError } from '../lib/out.mjs';
import { foreignCommits, taskCommits } from '../lib/commit.mjs';
import { deliveryInputs, prBody, prBodyPath, prTitle, writePrBody } from '../lib/pr.mjs';
import { isActive, listTasks, readRoundFile, setResumeBranch, staleAgent, transition, updateTask } from '../lib/task.mjs';
import { render } from '../lib/template.mjs';
import { isNoTicket } from '../lib/ticket.mjs';
import { gitForm, orchestratorTreeOf, workTreeOf } from '../lib/workspace.mjs';
import { dropAgentBranch, isListedWorktree, mainCheckout, pruneWorktrees, removeWorktree } from '../lib/worktree.mjs';
import { emit, loadTaskContext, readStdinText } from './common.mjs';

const short = (sha) => String(sha ?? '').slice(0, 10);
const listed = (paths) => (paths.length > 5 ? `${paths.slice(0, 5).join(', ')} and ${paths.length - 5} more` : paths.join(', '));
const prName = (kind) => (kind === 'gitlab' ? 'merge request' : 'pull request');

// Where git reads the task's refs: the work repo, or the task's worktree while it exists.
function gitTree(ws, task) {
  const tree = orchestratorTreeOf(ws, task);
  return existsSync(tree) ? tree : ws.repoRoot;
}

function requireBase(task) {
  if (!task.base?.commit) throw preconditionError(`Task ${task.id} has no recorded base commit.`, `Start it first: cw task start --task ${task.id}.`);
}

function branchTip(cwd, task) {
  const result = gitResult(['rev-parse', '--verify', '--quiet', `refs/heads/${task.branch}`], { cwd });
  if (result.code !== 0) throw preconditionError(`Branch ${task.branch} does not exist in ${cwd}.`, 'Ask the user; the implementer creates it with cw ws setup.');
  return result.stdout.trim();
}

// The first pr command moves review -> deliver (§8 Decided in P2). Every pr command needs the current
// round's review approved and made at the branch tip, and the spec it approved, so nothing unreviewed
// is delivered.
function enterDeliver(ws, loaded, by) {
  let task = loaded;
  if (!isActive(task)) throw preconditionError(`Task ${task.id} has ended (${task.outcome}).`, 'Nothing to deliver; start a new task with cw task new.');
  if (!['review', 'deliver'].includes(task.phase)) {
    throw preconditionError(`Task ${task.id} is in ${task.phase}; delivery needs an approved review.`, `Finish the review loop first: cw review show --task ${task.id}.`);
  }
  if (task.specChanged) {
    throw preconditionError(`The spec of ${task.id} changed after the review; the approval does not cover it.`, `Restart the cycle: cw task return --task ${task.id} --spec-changed --note "<what changed>".`);
  }
  requireBase(task);
  const tree = gitTree(ws, task);
  const tip = branchTip(tree, task);
  const { path, data: review } = readRoundFile(ws, task, 'review');
  if (!review) throw preconditionError(`There is no review for round ${task.round} (${path}).`, `Run the review first: cw task review --task ${task.id}.`);
  if (review.status !== 'approved') {
    throw preconditionError(`The review of round ${task.round} is ${review.status}, not approved.`, `Send the findings back: cw task return --task ${task.id}.`);
  }
  if (!sameCommit(review.head, tip)) {
    throw preconditionError(
      `The branch moved after the approved review (reviewed ${short(review.head)}, now ${short(tip)}).`,
      `Have the new commits reviewed: cw task review --task ${task.id} (a new review round over the commits since ${short(review.head)}).`,
    );
  }
  if (task.phase === 'review') {
    task = updateTask(ws, task.id, (fresh) => {
      if (fresh.phase === 'review') transition(fresh, 'deliver', { note: `review round ${fresh.reviewRound} approved at ${short(tip)}`, by });
    }).task;
  }
  return { task, tree, tip };
}

// --- git foreign-commits ------------------------------------------------------------------------

const foreignCommitsCommand = {
  path: ['git', 'foreign-commits'],
  group: 'orchestrator',
  usage: 'cw git foreign-commits --task <id> [--json]',
  summary: "Check that the task branch holds only this task's commits (exit 1 with the rebase fix)",
  flags: { task: 'string' },
  run(ctx) {
    const { ws, task } = loadTaskContext(ctx);
    requireBase(task);
    const workTree = workTreeOf(ws, task);
    if (!workTree || !existsSync(workTree)) throw preconditionError(`Task ${task.id} has no work tree yet.`, `The implementer creates it with cw ws setup --task ${task.id}.`);
    branchTip(workTree, task);
    const { count, foreign } = foreignCommits(workTree, task);
    const onTaskBranch = currentBranch(workTree) === task.branch;
    // A rebase drops foreign commits only when they come before all of the task's own commits.
    const prefix = foreign.length > 0 && foreign.every((commit, i) => commit.index === i);
    // The implementer runs plain git inside its worktree (D5); in-place git -C <appRoot> from the project root.
    const gitPrefix = gitForm(ws);
    // The command for the implementer: the rebase, else the switch back to the task branch.
    const command = prefix
      ? `${gitPrefix} rebase --onto ${task.base.commit} ${foreign.at(-1).fullSha} ${quote(task.branch)}`
      : onTaskBranch ? null : `${gitPrefix} switch ${quote(task.branch)}`;
    // An implementer of an earlier session gets no SendMessage: the review turns the problem into a
    // blocking finding, and task return hands the command to a fresh implementer.
    const handOn = (what) => (staleAgent(task, 'implementer')
      ? `the implementer belongs to an earlier session (no SendMessage): continue with cw task review --task ${task.id}; cw review scope makes this a blocking finding, and cw task return --task ${task.id} --new-agent gives a fresh implementer ${what}: ${command}`
      : `send the same implementer ${what}: ${command}`);
    const fixes = [];
    if (prefix) fixes.push(handOn('the rebase that keeps only its own commits'));
    else if (!onTaskBranch) fixes.push(handOn('the switch back to the task branch'));
    if (foreign.length && !prefix) fixes.push("the foreign commits are interleaved with the task's own; ask the user.");
    const fix = fixes.length ? fixes.join('; then ') : null;
    const result = {
      task: task.id,
      branch: task.branch,
      workTree,
      onTaskBranch,
      base: task.base.commit,
      commits: count,
      foreign: foreign.map(({ sha, subject, alsoOn, reasons }) => ({ sha, subject, alsoOn, reasons })),
      command,
      fix,
    };
    emit(ctx, result, () => {
      if (!onTaskBranch) ctx.out.print(`${workTree} is not on ${task.branch}.`);
      for (const commit of result.foreign) {
        ctx.out.print(`foreign: ${commit.sha} ${commit.subject} (${commit.reasons.join(', ')}${commit.alsoOn.length ? `; also on ${commit.alsoOn.join(', ')}` : ''})`);
      }
      if (fix) ctx.out.print(`Fix: ${fix}`);
      if (onTaskBranch && !foreign.length) ctx.out.print(`${task.branch}: ${count} commit(s), all from this task`);
    });
    return foreign.length || !onTaskBranch ? EXIT.failed : EXIT.ok;
  },
};

// --- pr title | body | command | record ----------------------------------------------------------

const prTitleCommand = {
  path: ['pr', 'title'],
  group: 'orchestrator',
  usage: 'cw pr title --task <id> [--json]',
  summary: 'Print the PR/MR title: the first task commit summary with the flags of later commits',
  flags: { task: 'string' },
  run(ctx) {
    const { ws, task: loaded } = loadTaskContext(ctx);
    const { task, tree } = enterDeliver(ws, loaded, 'cw pr title');
    const title = prTitle({ preset: ws.config.git.conventions, commits: taskCommits(tree, task), taskId: task.id });
    emit(ctx, { task: task.id, title }, (value) => ctx.out.print(value.title));
  },
};

// The "## " headings outside fenced code blocks. A fence is three or more backticks or tildes after
// up to three spaces; the line that closes it repeats the character at least as often and has nothing
// after it but blanks; an unclosed fence runs to the end (CommonMark 0.31.2, 4.5).
function sectionHeadings(text) {
  const headings = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      continue;
    }
    // A backtick fence's info string holds no backtick.
    fence = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line)?.[1] ?? null;
    const heading = fence ? null : /^##[ \t]+(.+?)\s*$/.exec(line);
    if (heading) headings.push(heading[1]);
  }
  return headings;
}

const withoutLeadingBlankLines = (text) => text.replace(/^(?:[ \t]*\n)+/, '');

// A corrected body (pr body --stdin) keeps the preset's rules (§10): only its "## " sections, and for a
// ticket task the trailers at the end, appended when the text left them out. It never starts with a
// blank line.
function correctedBody(ws, task, text) {
  const preset = ws.config.git.conventions;
  const unknown = sectionHeadings(text).filter((heading) => !preset.pr.sections.includes(heading));
  if (unknown.length) {
    throw failedError(
      `The PR/MR body has sections the git preset does not know: ${unknown.map((heading) => `"## ${heading}"`).join(', ')}.`,
      `Use only ${preset.pr.sections.map((section) => `"## ${section}"`).join(', ')}, then pipe the body again.`,
    );
  }
  if (isNoTicket(ws.config, task.ticket)) return withoutLeadingBlankLines(text);
  const trailers = preset.pr.trailers.map((trailer) => render(trailer, { ticket: task.ticket }));
  const content = withoutLeadingBlankLines(text.split('\n').filter((line) => !trailers.includes(line.trim())).join('\n')).trimEnd();
  return `${content ? `${content}\n\n` : ''}${trailers.join('\n')}\n`;
}

const prBodyCommand = {
  path: ['pr', 'body'],
  group: 'orchestrator',
  usage: 'cw pr body --task <id> [--stdin] [--json]',
  summary: 'Write the PR/MR description to the task dir (--stdin: replace it with corrected text)',
  flags: { task: 'string', stdin: 'boolean' },
  run(ctx) {
    const { ws, task: loaded } = loadTaskContext(ctx);
    const { task, tree } = enterDeliver(ws, loaded, 'cw pr body');
    const body = ctx.flags.stdin
      ? correctedBody(ws, task, readStdinText(ctx, `cw pr body --task ${task.id} --stdin < <scratchpad>/${task.id}-pr-body-1.md`))
      : prBody({ task, config: ws.config, ...deliveryInputs(ws, task, tree) });
    const file = writePrBody(ws, task, body);
    emit(ctx, { task: task.id, file, body }, (value) => ctx.out.print(`${value.file}\n\n${value.body.trimEnd()}`));
  },
};

// Base commits that origin/<base> lacks, from the local remote-tracking ref (no fetch); null if unknown.
function unpushedBase(cwd, task) {
  const remoteRef = `refs/remotes/origin/${task.base.branch}`;
  if (gitResult(['rev-parse', '--verify', '--quiet', remoteRef], { cwd }).code !== 0) return null;
  return commitsBetween(cwd, remoteRef, task.base.commit).map((commit) => ({ sha: short(commit.sha), subject: commit.subject }));
}

const prCommandCommand = {
  path: ['pr', 'command'],
  group: 'orchestrator',
  usage: 'cw pr command --task <id> [--json]',
  summary: 'Print the push and PR/MR commands for the user to confirm; an existing open PR/MR means push only',
  flags: { task: 'string' },
  run(ctx) {
    const { ws, task: loaded } = loadTaskContext(ctx);
    const { task, tree } = enterDeliver(ws, loaded, 'cw pr command');
    const workTree = workTreeOf(ws, task);
    const dirty = workTree && existsSync(workTree) ? porcelain(workTree) : [];
    if (dirty.length) {
      throw preconditionError(`${workTree} has uncommitted changes (${listed(dirty)}); they would not be pushed.`, 'Ask the user: commit them through the implementer or discard them, then run cw pr command again.');
    }
    const host = requireHost(detectHost({ workTree: tree, config: ws.config }), { workTree: tree, taskId: task.id });
    const adapter = adapterFor(host.kind);
    const name = prName(host.kind);
    const existing = adapter.findExisting({ host, branch: task.branch, cwd: tree, env: ctx.env });
    if (existing && !existing.open) {
      throw preconditionError(
        `The ${name} for ${task.branch} is ${String(existing.state).toLowerCase()}: ${existing.url}`,
        `Ask the user how to continue; a ${String(existing.state).toLowerCase()} branch should not get new commits. Deliver on a new task branch, or end delivery with cw pr record --task ${task.id} --skipped "<reason>".`,
      );
    }
    // Push only to an open PR/MR: its title is set already.
    const title = existing ? null : prTitle({ preset: ws.config.git.conventions, commits: taskCommits(tree, task), taskId: task.id });
    const bodyFile = prBodyPath(ws, task);
    if (!existsSync(bodyFile)) writePrBody(ws, task, prBody({ task, config: ws.config, ...deliveryInputs(ws, task, tree) }));
    const base = task.base.branch;
    const baseUnpushed = unpushedBase(tree, task);
    // In-place the push uses the git -C <appRoot> form of every other in-place command; it still
    // matches the ask rule Bash(git -C * push *) (§12). Worktree mode names the worktree.
    const git = ws.mode === 'in-place' ? gitForm(ws) : `git -C ${quote(tree)}`;
    const commands = [pushCommand({ git, branch: task.branch })];
    if (!existing) commands.push(adapter.createCommand({ host, base, branch: task.branch, title, bodyFile }));
    const notes = [];
    if (existing) notes.push(`An open ${name} exists for ${task.branch}: ${existing.url}. Push only; do not create another.`);
    if (baseUnpushed === null) notes.push(`origin/${base} is not known locally (cw does not fetch), so it is unclear whether ${base} is pushed: ask the user before pushing anything.`);
    else if (baseUnpushed.length) notes.push(`${base} has ${baseUnpushed.length} commit(s) that origin/${base} lacks (${baseUnpushed.map((c) => c.sha).join(', ')}); the push would carry them: ask the user before pushing anything.`);
    notes.push('Run the commands only after the user confirmed exactly what is pushed. Never merge.');
    const result = {
      task: task.id,
      host: { kind: host.kind, source: host.source, hostname: host.hostname, repo: host.repo, webUrl: host.webUrl, cli: host.cli },
      workTree: tree,
      branch: task.branch,
      base,
      title,
      bodyFile,
      existing,
      branchOnRemote: gitResult(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${task.branch}`], { cwd: tree }).code === 0,
      baseUnpushed,
      commands,
      record: `cw pr record --task ${task.id} --url ${existing ? existing.url : '<url>'}`,
      notes,
    };
    emit(ctx, result, (value) => {
      ctx.out.print(`Host: ${value.host.kind} (${value.host.hostname}/${value.host.repo}, ${value.host.cli}; from ${value.host.source})`);
      ctx.out.print('Commands, after the user confirmed:');
      for (const command of value.commands) ctx.out.print(`  ${command}`);
      ctx.out.print(`Then: ${value.record}`);
      for (const note of value.notes) ctx.out.print(`Note: ${note}`);
    });
  },
};

const prRecordCommand = {
  path: ['pr', 'record'],
  group: 'orchestrator',
  usage: 'cw pr record --task <id> (--url <https URL> | --skipped "<reason>")',
  summary: 'Record the PR/MR URL, or why there is none; the task is then in deliver',
  flags: { task: 'string', url: 'string', skipped: 'string' },
  run(ctx) {
    const { url, skipped } = ctx.flags;
    if (Boolean(url) === Boolean(skipped)) {
      throw usageError('Pass exactly one of --url and --skipped.', 'cw pr record --task <id> --url <the URL gh or glab printed>, or --skipped "<why there is no PR/MR>".');
    }
    if (url && !/^https:\/\/[^\s/]+\/\S+$/.test(url)) throw usageError(`--url ${url} is not an https URL.`, 'Pass the https URL that gh or glab printed.');
    const { ws, task: loaded } = loadTaskContext(ctx);
    const { task, tree } = enterDeliver(ws, loaded, 'cw pr record');
    if (url) {
      const host = detectHost({ workTree: tree, config: ws.config });
      const urlHost = new URL(url).hostname.toLowerCase();
      if (host.hostname && urlHost !== host.hostname) ctx.out.warn(`${url} is on ${urlHost}, but the work repo's origin is on ${host.hostname}.`);
      if (task.prUrl && task.prUrl !== url) ctx.out.warn(`replacing the recorded ${task.prUrl}.`);
    }
    const updated = updateTask(ws, task.id, (fresh) => {
      fresh.prUrl = url ?? null;
      fresh.noPrReason = skipped ?? null;
    }).task;
    const result = { task: updated.id, phase: updated.phase, prUrl: updated.prUrl, noPrReason: updated.noPrReason };
    emit(ctx, result, (value) => ctx.out.print(value.prUrl ? `${value.task}: ${value.prUrl}` : `${value.task}: no PR/MR (${value.noPrReason})`));
  },
};

// --- task cleanup ------------------------------------------------------------------------------

// In-place cleanup switches app/ back only from this task's branch: on any other branch it belongs to
// someone else (another task under D6, or the user), and app/ is left alone.
function cleanupInPlace(ws, task, result) {
  const workTree = workTreeOf(ws, task);
  const base = result.base;
  const now = currentBranch(workTree);
  if (now === base) return { ...result, action: 'already-on-base' };
  if (now !== task.branch) {
    const owner = listTasks(ws).find((other) => other.id !== task.id && other.branch === now);
    const whose = owner ? `the branch of the active task ${owner.id}` : 'not a branch of an active task';
    return { ...result, action: 'left', reason: `${workTree} is on ${now || 'a detached HEAD'} (${whose}), not on ${task.branch}; cleanup leaves it as it is.`, otherTask: owner?.id ?? null };
  }
  const dirty = porcelain(workTree);
  if (dirty.length) return { ...result, action: 'kept', reason: `${workTree} has uncommitted changes: ${listed(dirty)}.`, fix: 'Ask the user, then commit or discard them and run cw task cleanup again.' };
  // switch would create a missing base from origin/<base> and write its upstream into .git/config.
  if (!branchExists(workTree, base)) return { ...result, action: 'kept', reason: `The base branch ${base} does not exist in ${workTree}.`, fix: 'Ask the user which branch the work tree should be on.' };
  git(['switch', base], { cwd: workTree });
  return { ...result, action: 'switched' };
}

function cleanupWorktree(ws, task, result) {
  const mainRoot = mainCheckout(ws);
  const workTree = task.workTree;
  const dropAgent = () => {
    const { removed, warning } = dropAgentBranch(mainRoot, task);
    return { removedBranch: removed, warnings: warning ? [warning] : [] };
  };
  if (!workTree || !existsSync(workTree)) {
    // A directory removed while its record stayed (the sandbox, or rm -r) still holds the task branch.
    if (workTree && isListedWorktree(mainRoot, workTree)) pruneWorktrees(mainRoot);
    return { ...result, action: 'gone', ...dropAgent() };
  }
  if (realpathSync(workTree) === realpathSync(mainRoot)) {
    return { ...result, action: 'kept', reason: `${workTree} is the main checkout, not a task worktree.`, fix: 'Nothing to remove; check task.json (workTree) with cw task show.' };
  }
  const dirty = porcelain(workTree);
  if (dirty.length) return { ...result, action: 'kept', reason: `${workTree} has uncommitted changes: ${listed(dirty)}.`, fix: 'Ask the user, then commit or discard them and run cw task cleanup again.' };
  if (currentBranch(workTree) !== task.branch) {
    const head = headCommit(workTree);
    if (gitResult(['merge-base', '--is-ancestor', head, `refs/heads/${task.branch}`], { cwd: mainRoot }).code !== 0) {
      return { ...result, action: 'kept', reason: `HEAD ${short(head)} of ${workTree} is not on ${task.branch}; removing the worktree could lose it.`, fix: 'Ask the user; keep the commit on a branch first.' };
    }
  }
  removeWorktree(mainRoot, workTree);
  return { ...result, action: 'removed', ...dropAgent() };
}

const taskCleanupCommand = {
  path: ['task', 'cleanup'],
  group: 'orchestrator',
  usage: 'cw task cleanup --task <id> [--json]',
  summary: 'In-place: switch the app back to the base branch; worktree: remove the clean task worktree',
  flags: { task: 'string' },
  run(ctx) {
    const { ws, task } = loadTaskContext(ctx);
    if (isActive(task) && ['implement', 'review'].includes(task.phase)) {
      throw preconditionError(`Task ${task.id} is in ${task.phase}: an agent works in its work tree.`, `Clean up after delivery (cw pr record --task ${task.id}) or after cw task end --task ${task.id}.`);
    }
    const base = task.base?.branch ?? ws.config.git.defaultBase;
    const start = { task: task.id, mode: ws.mode, workTree: workTreeOf(ws, task), action: null, base, branchKept: null, removedBranch: null, reason: null, fix: null, warnings: [] };
    const result = ws.mode === 'in-place' ? cleanupInPlace(ws, task, start) : cleanupWorktree(ws, task, start);
    result.branchKept = branchExists(ws.mode === 'in-place' ? ws.workRepo : mainCheckout(ws), task.branch) ? task.branch : null;
    if (ws.mode === 'worktree' && isActive(task) && ['removed', 'gone'].includes(result.action)) {
      // A started task can still go back to implement (a spec change, --continue): its next agent
      // continues the kept branch in a worktree of its own. The branch of a task that never started is
      // not cw's (ws setup refuses it), and a reason recorded earlier (task reset --keep) stays.
      const started = task.round >= 1 && Boolean(task.base?.commit);
      updateTask(ws, task.id, (current) => {
        current.workTree = null;
        current.agentBranch = null;
        if (started && !(current.resumeBranch && result.branchKept)) setResumeBranch(current, result.branchKept, 'cleanup');
      });
    }
    for (const warning of result.warnings) ctx.out.warn(warning);
    emit(ctx, result, (value) => {
      if (value.action === 'kept') ctx.out.print(`${value.task}: kept ${value.workTree}. ${value.reason}\nFix: ${value.fix}`);
      else if (value.action === 'left') ctx.out.print(`${value.task}: left ${value.workTree} as it is. ${value.reason}`);
      else ctx.out.print(`${value.task}: ${value.action}${value.removedBranch ? ` (deleted ${value.removedBranch})` : ''}${value.branchKept ? `; ${value.branchKept} stays` : ''}`);
    });
    return result.action === 'kept' ? EXIT.precondition : EXIT.ok;
  },
};

export const commands = [foreignCommitsCommand, prTitleCommand, prBodyCommand, prCommandCommand, prRecordCommand, taskCleanupCommand];
