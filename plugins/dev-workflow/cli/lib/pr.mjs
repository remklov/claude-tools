// PR/MR title and description (§10, D8). The title is the oldest task commit's summary with the flags
// of later commits; the body has the preset's sections, built only from what the task recorded:
// ticket.json, spec.md, the last report, the reviews, and the checks and proofs cw ran.
import { existsSync } from 'node:fs';
import { parseSummary, taskCommits, titleOf } from './commit.mjs';
import { readJson, readText, writeAtomic } from './fsx.mjs';
import { failedError, preconditionError } from './out.mjs';
import { parseSpec } from './spec.mjs';
import { readRoundFile } from './task.mjs';
import { render } from './template.mjs';
import { isNoTicket } from './ticket.mjs';
import { taskPath } from './workspace.mjs';

// The title from commit.mjs titleOf, which cw commit lint checks before the review. In delivery a reworded
// commit would move the branch past the approved review, so the fix opens the PR/MR by hand.
export function prTitle({ preset, commits, taskId }) {
  if (!commits.length) throw preconditionError('The task branch has no commits since its base.', 'Nothing to deliver; ask the user how to continue.');
  const max = preset.commit.summaryMax;
  const sha = commits[0].sha.slice(0, 10);
  const fix = `Ask the user to push the branch and open the PR/MR by hand with a title that follows the commit rules (at most ${max} characters), then run cw pr record --task ${taskId} --url <url>; rewording ${sha} would move the branch past the approved review. cw commit lint --task ${taskId} lists the problems.`;
  const title = titleOf(preset, commits);
  if (!title) throw failedError(`The first task commit "${commits[0].subject}" has no keyword (${preset.commit.keywords.map((k) => `[${k}]`).join(' ')}).`, fix);
  if (title.length > max) throw failedError(`The PR/MR title has ${title.length} characters, the limit is ${max}: ${title}`, fix);
  return title;
}

const points = (list) => (list ?? []).map((item) => (typeof item === 'string' ? { text: item, tag: null } : { text: item.text, tag: item.tag ?? null }));
const bullets = (items) => items.map((item) => `- ${item}`).join('\n');
const where = (finding) => (finding.file ? ` (\`${finding.file}${finding.line ? `:${finding.line}` : ''}\`)` : '');

function whatAndWhy({ task, ticket, spec }) {
  const parsed = parseSpec(spec);
  const context = parsed.body('Context').split(/\n\s*\n/)[0].trim();
  const requirements = parsed.requirements.map((item) => item.text);
  let lead = task.title;
  if (ticket?.summary) lead = ticket.url ? `[${ticket.key}](${ticket.url}): ${ticket.summary}` : `${ticket.key}: ${ticket.summary}`;
  return [lead, context, bullets(requirements)].filter(Boolean).join('\n\n');
}

// The task's packages with their paths, from the classification.
function affectedPackages({ task, config }) {
  return bullets((task.packages ?? []).map((id) => {
    const pkg = config.packages.find((item) => item.id === id);
    return pkg ? `${id} (\`${pkg.path}\`)` : id;
  }));
}

// Only what cw verified: the passing checks of the final run and the proofs that hold.
function testing({ report, checks }) {
  const lines = [];
  for (const pkg of checks?.packages ?? []) {
    for (const check of pkg.checks ?? []) {
      if (check.result === 'pass') lines.push(`\`${check.command}\` in \`${pkg.path}\` (${pkg.id}): pass`);
    }
  }
  for (const proof of report?.proofs ?? []) {
    if (proof.holds) lines.push(`Proof: \`${proof.command}\` fails without the change${proof.failureLine ? ` (${proof.failureLine})` : ''} and passes with it`);
  }
  return bullets(lines);
}

function risks({ report, commits, preset }) {
  const lines = points(report?.risks).map((risk) => risk.text);
  for (const commit of commits) {
    const { flags } = parseSummary(commit.subject, preset);
    if (flags.includes('!!!')) lines.push(`Breaking change: ${commit.subject}`);
    if (flags.includes('SECURITY')) lines.push(`Security-relevant change: ${commit.subject}`);
  }
  return bullets(lines);
}

// The report's open points, then the non-blocking findings nobody fixed: all of the final review's,
// and the earlier rounds' that were not sent along to the implementer.
function openPoints({ report, reviews }) {
  const lines = points(report?.openPoints).map((point) => (point.tag === 'manual' ? `Manual check (not verified here): ${point.text}` : point.text));
  const seen = new Set();
  const finalRound = Math.max(0, ...reviews.map((review) => review.round));
  for (const review of [...reviews].sort((a, b) => b.round - a.round)) {
    for (const finding of review.findings ?? []) {
      if (finding.severity !== 'non_blocking' || (review.round !== finalRound && finding.sendAlong)) continue;
      const key = `${finding.file ?? ''}|${finding.issue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`${finding.rule ? `${finding.rule}: ` : ''}${finding.issue}${where(finding)}`);
    }
  }
  return bullets(lines);
}

// The description; empty sections are left out (§10). It never asks for a merge.
export function prBody({ task, config, ticket = null, spec = '', report = null, reviews = [], checks = null, commits = [] }) {
  const preset = config.git.conventions;
  const builders = {
    'What & why': () => whatAndWhy({ task, ticket, spec }),
    'Affected packages': () => affectedPackages({ task, config }),
    Testing: () => testing({ report, checks }),
    'Risks & deploy steps': () => risks({ report, commits, preset }),
    'Open points': () => openPoints({ report, reviews }),
  };
  const parts = [];
  for (const name of preset.pr.sections) {
    const content = builders[name]?.() ?? '';
    if (content.trim()) parts.push(`## ${name}\n\n${content.trim()}`);
  }
  if (!isNoTicket(config, task.ticket)) parts.push(...preset.pr.trailers.map((trailer) => render(trailer, { ticket: task.ticket })));
  return `${parts.join('\n\n')}\n`;
}

// Everything prBody reads, from the task dir; the checks are the final review's run, else the report's.
export function deliveryInputs(ws, task, cwd) {
  const file = (name) => taskPath(ws, task.id, name);
  const reviews = [];
  for (let round = 1; round <= task.round; round += 1) {
    const review = readRoundFile(ws, task, 'review', round).data;
    if (review) reviews.push({ ...review, round });
  }
  const report = readRoundFile(ws, task, 'report').data;
  const finalReview = reviews.find((review) => review.round === task.round);
  const run = [finalReview?.checks, report?.checks].find((checks) => checks?.file && checks.overall === 'pass');
  const checksFile = run ? file(run.file) : null;
  return {
    ticket: readJson(file('ticket.json'), null),
    spec: readText(file('spec.md'), ''),
    report,
    reviews,
    checks: checksFile && existsSync(checksFile) ? readJson(checksFile) : null,
    commits: taskCommits(cwd, task),
  };
}

export const prBodyPath = (ws, task) => taskPath(ws, task.id, 'pr-body.md');

export function writePrBody(ws, task, text) {
  const path = prBodyPath(ws, task);
  writeAtomic(path, text.endsWith('\n') ? text : `${text}\n`);
  return path;
}
