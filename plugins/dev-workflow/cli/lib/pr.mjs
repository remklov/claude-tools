// PR/MR title and description (§10, D8). The title is the oldest task commit's summary with the flags
// of later commits; the body has the preset's sections, built only from what the task recorded:
// ticket.json, spec.md, the last report, the reviews, and the checks and proofs cw ran.
import { existsSync } from 'node:fs';
import { posix } from 'node:path';
import { parseSummary, taskCommits, titleOf } from './commit.mjs';
import { decisionFor } from './decisions.mjs';
import { readJson, readText, writeAtomic } from './fsx.mjs';
import { failedError, preconditionError } from './out.mjs';
import { RISKS_SECTION, parseSpec } from './spec.mjs';
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

const MAX_REQUIREMENTS = 6;

// The orchestrator's summary of the change (cw pr body --what, O9), else the spec's requirements, at
// most six: a long list made the orchestrator rewrite the whole body (ADR 0014).
function whatAndWhy({ task, ticket, spec, what }) {
  const parsed = parseSpec(spec);
  const context = parsed.body('Context').split(/\n\s*\n/)[0].trim();
  const requirements = parsed.requirements.map((item) => item.text);
  const listed = requirements.length > MAX_REQUIREMENTS
    ? [...requirements.slice(0, MAX_REQUIREMENTS), `… and ${requirements.length - MAX_REQUIREMENTS} more requirements`]
    : requirements;
  let lead = task.title;
  if (ticket?.summary) lead = ticket.url ? `[${ticket.key}](${ticket.url}): ${ticket.summary}` : `${ticket.key}: ${ticket.summary}`;
  return [lead, context, what?.trim() || bullets(listed)].filter(Boolean).join('\n\n');
}

// The task's packages with their paths, from the classification.
function affectedPackages({ task, config }) {
  return bullets((task.packages ?? []).map((id) => {
    const pkg = config.packages.find((item) => item.id === id);
    return pkg ? `${id} (\`${pkg.path}\`)` : id;
  }));
}

// Only what cw verified: the passing checks of the final run, one line per package, and the proofs
// that hold: one with its failure line, several as their test files.
function testing({ report, checks }) {
  const lines = [];
  for (const pkg of checks?.packages ?? []) {
    const passed = (pkg.checks ?? []).filter((check) => check.result === 'pass').map((check) => `\`${check.command}\``);
    if (passed.length) lines.push(`${passed.join(', ')} in \`${pkg.path}\` (${pkg.id}): pass`);
  }
  const holding = (report?.proofs ?? []).filter((proof) => proof.holds);
  if (holding.length === 1) {
    const [proof] = holding;
    lines.push(`Proof: \`${proof.command}\` fails without the change${proof.failureLine ? ` (${proof.failureLine})` : ''} and passes with it`);
  } else if (holding.length) {
    const files = [...new Set(holding.map((proof) => posix.basename(proof.testPath ?? proof.test ?? proof.command)))];
    lines.push(`Proofs: ${holding.length} tests fail without the change and pass with it (${files.map((file) => `\`${file}\``).join(', ')})`);
  }
  return bullets(lines);
}

// The spec's Risks and deploy steps (ADR 0016), without the None of a change without fallout.
function specRisks(spec) {
  return parseSpec(spec).body(RISKS_SECTION).split('\n')
    .map((line) => line.replace(/^\s*[-*+]\s*/, '').trim())
    .filter((line) => line && !/^none\.?$/i.test(line));
}

function risks({ spec, report, commits, preset }) {
  const lines = [...specRisks(spec), ...points(report?.risks).map((risk) => risk.text)];
  for (const commit of commits) {
    const { flags } = parseSummary(commit.subject, preset);
    if (flags.includes('!!!')) lines.push(`Breaking change: ${commit.subject}`);
    if (flags.includes('SECURITY')) lines.push(`Security-relevant change: ${commit.subject}`);
  }
  return bullets(lines);
}

// How an open point shows the user's decision on its finding (ADR 0015).
const decidedAs = (decision) => (decision?.as === 'accept'
  ? `Accepted by the user (${decision.note}): `
  : decision?.as === 'ticket' ? `Needs a ticket (${decision.note}): ` : '');
const findingPoint = (finding, decision) => `${decidedAs(decision)}${finding.rule ? `${finding.rule}: ` : ''}${finding.issue}${where(finding)}`;

// The report's open points, then the final review's non-blocking findings with the user's decisions.
// The reviewer carries over the earlier findings that still hold (carriedFrom), and they inherit the
// decision; one the user decided to fix is not open.
function openPoints({ task, report, reviews, decisions }) {
  const lines = points(report?.openPoints).map((point) => (point.tag === 'manual' ? `Manual check (not verified here): ${point.text}` : point.text));
  const final = [...reviews].sort((a, b) => b.round - a.round)[0];
  const known = { ...task, decisions };
  for (const finding of final?.findings ?? []) {
    const decision = decisionFor(known, final, finding.id);
    if (decision?.as === 'fix') continue;
    if (finding.severity === 'non_blocking' || decision) lines.push(findingPoint(finding, decision));
  }
  return bullets([...new Set(lines)]);
}

// The description; empty sections are left out (§10). It never asks for a merge.
export function prBody({ task, config, ticket = null, spec = '', report = null, reviews = [], checks = null, commits = [], decisions = [], what = null }) {
  const preset = config.git.conventions;
  const builders = {
    'What & why': () => whatAndWhy({ task, ticket, spec, what }),
    'Affected packages': () => affectedPackages({ task, config }),
    Testing: () => testing({ report, checks }),
    'Risks & deploy steps': () => risks({ spec, report, commits, preset }),
    'Open points': () => openPoints({ task, report, reviews, decisions }),
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
    if (review) reviews.push({ ...review, round, reviewRound: review.reviewRound ?? null });
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
    decisions: task.decisions ?? [],
  };
}

export const prBodyPath = (ws, task) => taskPath(ws, task.id, 'pr-body.md');

export function writePrBody(ws, task, text) {
  const path = prBodyPath(ws, task);
  writeAtomic(path, text.endsWith('\n') ? text : `${text}\n`);
  return path;
}
