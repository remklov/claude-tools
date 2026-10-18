// Delivery helpers: did the base move, PR title and body from the task's artifacts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitResult, lines, tryGit } from './git.mjs';
import { latestChecks } from './report.mjs';
import { parseSpec } from './spec.mjs';
import { taskPath } from './task.mjs';
import { readJson } from './fsx.mjs';

export function baseMoved(ctx, task, workdir) {
  const cwd = workdir ?? ctx.repoRoot;
  tryGit(['fetch', '--quiet', 'origin'], { cwd, timeoutMs: 60_000 });
  const tips = {
    local: tryGit(['rev-parse', task.base.branch], { cwd }),
    remote: tryGit(['rev-parse', `origin/${task.base.branch}`], { cwd }),
  };
  const candidates = [...new Set(Object.values(tips).filter(Boolean))].filter((tip) => tip !== task.base.commit);
  const newTip = candidates.find((tip) => tryGit(['merge-base', '--is-ancestor', task.base.commit, tip], { cwd }) !== null) ?? candidates[0];
  if (!newTip) return { moved: false, base: task.base.commit };
  const merge = gitResult(['merge-tree', '--write-tree', '--name-only', newTip, task.branch], { cwd });
  const conflicts = merge.code === 1 ? lines(merge.stdout).slice(1).filter((line) => line && !line.startsWith('Auto-merging')) : [];
  const baseFiles = new Set(lines(tryGit(['diff', '--name-only', `${task.base.commit}..${newTip}`], { cwd }) ?? ''));
  const taskFiles = lines(tryGit(['diff', '--name-only', `${task.base.commit}...${task.branch}`], { cwd }) ?? '');
  const overlap = taskFiles.filter((file) => baseFiles.has(file));
  const rebaseNeeded = conflicts.length > 0 || overlap.length > 0;
  return {
    moved: true,
    base: task.base.commit,
    newTip,
    conflicts,
    overlap,
    rebaseNeeded,
    implementerMessage: rebaseNeeded
      ? `The base branch ${task.base.branch} moved to ${newTip}. Rebase your commits: \`git rebase --onto ${newTip} ${task.base.commit}\`, resolve conflicts${conflicts.length ? ` (${conflicts.join(', ')})` : ''}, rerun \`cw checks --changed --task ${task.id}\`, then report again with \`cw report save --task ${task.id}\`.`
      : null,
  };
}

export function prTitle(ctx, task) {
  const first = lines(tryGit(['log', '--reverse', '--format=%s', `${task.base.commit}..${task.branch}`], { cwd: task.worktree ?? ctx.repoRoot }) ?? '')[0];
  return first ?? task.title;
}

function section(ctx, profile, packs, task, source) {
  const spec = parseSpec(readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8'));
  const report = readJson(taskPath(ctx, task, `report-${task.round}.json`), null);
  const review = readJson(taskPath(ctx, task, `review-${task.round}.json`), null);
  switch (source) {
    case 'spec.summary': {
      const context = spec.body('Context').split('\n\n')[0];
      const reqs = spec.requirements.map((req) => `- ${req.text}`).join('\n');
      const ticket = task.ticket === profile.git.noTicketKey ? '' : `${profile.tickets.adapter === 'github-issues' ? `Closes ${task.ticket}. ` : `Ticket: ${task.ticket}. `}`;
      return `${ticket}${context}\n\n${reqs}`.trim();
    }
    case 'classify.packages':
      return task.packages.map((id) => `- \`${id}\``).join('\n');
    case 'checks': {
      const checks = latestChecks(ctx, task)?.data;
      const out = [];
      for (const pkg of checks?.packages ?? []) for (const check of pkg.checks) out.push(`- \`${check.command}\` in \`${check.cwd}\`: ${check.result}`);
      for (const proof of report?.proofs ?? []) out.push(`- Proof: \`${proof.test}\` fails without the change (${proof.failureLine ?? 'non-zero exit'}) and passes with it`);
      const manual = (report?.openPoints ?? []).filter((point) => point.tag === 'manual');
      for (const point of manual) out.push(`- Not verified here (manual): ${point.text}`);
      return out.join('\n');
    }
    case 'manualTests':
      return (report?.openPoints ?? []).filter((point) => point.tag === 'manual').map((point) => `- ${point.text}`).join('\n');
    case 'migrations':
      return report?.migrations && report.migrations !== 'none' ? report.migrations : '';
    case 'deployImpact': {
      const impact = readJson(taskPath(ctx, task, 'deploy-impact.json'), null);
      if (!impact?.workflows?.length) return '';
      return impact.workflows.map((workflow) => `- A merge triggers \`${workflow.file}\` (${workflow.name}): ${workflow.reason}`).join('\n');
    }
    case 'openPoints': {
      const points = (report?.openPoints ?? []).filter((point) => point.tag !== 'manual').map((point) => `- ${point.text}`);
      for (const finding of review?.findings ?? []) if (finding.severity === 'non_blocking' && !finding.sendAlong) points.push(`- ${finding.issue}${finding.file ? ` (\`${finding.file}${finding.line ? `:${finding.line}` : ''}\`)` : ''}`);
      return points.join('\n');
    }
    case 'screenshots':
      return task.areas.includes('frontend') ? '<!-- Add screenshots of the changed UI. -->' : '';
    default:
      return '';
  }
}

export function prBody(ctx, profile, packs, task) {
  const parts = [];
  for (const { title, source } of profile.git.pr.sections) {
    const content = section(ctx, profile, packs, task, source);
    if (content.trim()) parts.push(`## ${title}\n\n${content.trim()}`);
  }
  return `${parts.join('\n\n')}\n`;
}

export const prBodyPath = (ctx, task) => join(ctx.stateDir, 'tasks', task.id, 'pr-body.md');
