// Briefs for the implementer and the reviewer (§6 items 1–2), and the exact Agent parameters and
// SendMessage texts the orchestrator passes on verbatim (O6, O8; D4). Rendering is pure.
import { join } from 'node:path';
import { writeAtomic } from './fsx.mjs';
import { gitForm, taskPath, workTreeOf } from './workspace.mjs';

export const implementerAgentType = (complexity) => `dev-workflow:implementer-${complexity}`;
export const REVIEWER_AGENT = 'dev-workflow:reviewer';

const cap = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const short = (sha) => String(sha ?? '').slice(0, 10);

// The Agent call's description; the mod matches runs by it (§11), so it is stable per task and role.
export const agentDescription = (task, role) => cap(role === 'reviewer' ? `Review · ${task.ticket} · ${task.title}` : `${task.ticket} · ${task.title}`, 60);

export function agentPrompt(task, role, briefPath) {
  const first = role === 'implementer' ? `Start with \`cw ws setup --task ${task.id}\`.` : `Start with \`cw review scope --task ${task.id}\`.`;
  return [
    `Task ${task.ticket} · ${task.title} (task id ${task.id}).`,
    `Your brief is ${briefPath}. Read it completely before anything else, then follow your playbook step by step.`,
    first,
  ].join('\n');
}

// Exactly the Agent tool parameters: run_in_background is false so the orchestrator waits for the report
// where the tool has the parameter (D4); isolation only for the implementer in worktree mode (D4, D5).
export function agentCall(ws, task, role, briefPath) {
  const call = {
    subagent_type: role === 'implementer' ? implementerAgentType(task.complexity) : REVIEWER_AGENT,
    description: agentDescription(task, role),
    prompt: agentPrompt(task, role, briefPath),
    run_in_background: false,
  };
  if (role === 'implementer' && ws.mode === 'worktree') call.isolation = 'worktree';
  return call;
}

const findingLine = (finding, label) =>
  `- [${label}${finding.rule ? ` · ${finding.rule}` : ''}] ${finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}: ` : ''}${finding.issue}${finding.suggestion ? ` — ${finding.suggestion}` : ''}`;

const decided = (decision) => `the user decided: ${decision.as}${decision.note ? ` (${decision.note})` : ''}`;

// The findings an implementer fixes: every blocking one, the non-blocking ones the user decided to fix
// (ADR 0015), and the cheap ones marked sendAlong. A blocking finding carries the user's decision on it.
export function findingsToFix(review, decisions = []) {
  const findings = review?.findings ?? [];
  const decisionOf = (finding) => decisions.find((decision) => decision.review === review.round && decision.reviewRound === review.reviewRound && decision.finding === finding.id);
  const lines = [];
  for (const finding of findings.filter((item) => item.severity === 'blocking')) {
    const decision = decisionOf(finding);
    lines.push(findingLine(finding, decision ? `blocking; ${decided(decision)}` : 'blocking'));
  }
  for (const finding of findings.filter((item) => item.severity !== 'blocking')) {
    const decision = decisionOf(finding);
    if (decision?.as === 'fix') lines.push(findingLine(finding, decided(decision)));
    else if (!decision && finding.sendAlong) lines.push(findingLine(finding, 'also'));
  }
  return lines;
}

// The line that sends an implementer back to its branch first, when the work tree left it (task cleanup).
const setupLine = (task, setupFirst) => (setupFirst ? [`First run cw ws setup --task ${task.id}: the work tree is no longer on ${task.branch}.`] : []);

// decision: the user's decision after an escalation (task return --continue --note), quoted first.
export function returnMessage(task, review, briefPath, { decision = null, setupFirst = false } = {}) {
  const why = review?.status === 'approved'
    ? `Review round ${task.reviewRound} approved, and the user decided to fix these findings in this task.`
    : `Review round ${task.reviewRound} requests changes.`;
  return [
    ...(decision ? [`The user decided after the escalation: ${decision}`] : []),
    ...(task.returnedWith?.specRevised ? ['The spec changed with the user\'s answers: the updated brief has the new spec.'] : []),
    ...setupLine(task, setupFirst),
    `${why} Fix these on ${task.branch}, rerun cw checks --changed, commit (cw commit msg, then the git commit -F it prints) and finish with cw report save --task ${task.id}:`,
    ...findingsToFix(review, task.decisions),
    `The updated brief is ${briefPath}.`,
  ].join('\n');
}

export function reviewerFollowUp(task, briefPath, reportPath, previousHead) {
  return [
    `Round ${task.reviewRound}: the implementer reports done again (${reportPath}). The brief is updated: ${briefPath}.`,
    `Review the changes since ${previousHead} and check every earlier blocking finding; finish with cw review save --task ${task.id}.`,
  ].join('\n');
}

// The follow-up when the task branch moved after the reviewer's approval (cw task review, §6 O9).
export function reviewerRecheck(task, briefPath, approvedHead) {
  return [
    `Round ${task.reviewRound}: ${task.branch} moved after your approval of ${approvedHead}. The brief is updated: ${briefPath}.`,
    `Review the commits since ${approvedHead}; finish with cw review save --task ${task.id}.`,
  ].join('\n');
}

export function specChangedMessage(task, note, briefPath, { setupFirst = false } = {}) {
  return [
    `The spec changed after the review: ${note}`,
    ...setupLine(task, setupFirst),
    `Read the updated brief ${briefPath}, implement the change on ${task.branch}, rerun cw checks --changed, commit and finish with cw report save --task ${task.id}.`,
  ].join('\n');
}

const section = (title, lines) => (lines.length ? ['', `## ${title}`, '', ...lines] : []);

// The brief stays small: the branch state lists files and commit subjects, never a diff.
const MAX_LISTED_FILES = 80;
const MAX_LISTED_COMMITS = 20;
const HANDOVER_LABELS = [
  ['decisions', 'Decisions and why'],
  ['rejected', 'Rejected approaches'],
  ['testing', 'Test commands and setups'],
  ['pitfalls', 'Pitfalls'],
  ['deviations', 'Deviations from the spec or a rule'],
];

const capped = (items, max, render, more) => [...items.slice(0, max).map(render), ...(items.length > max ? [more(items.length - max)] : [])];

// What a fresh implementer takes over (ADR 0012): takeover { report: { round, data } | null, branch:
// { head, commits, files } | null }.
function takeoverLines(task, { report, branch }) {
  const lines = [
    `You take ${task.branch} over from an earlier implementer: its commits are on the branch. Read the spec, this handover and the findings, then the files they name; do not explore the whole change again.`,
  ];
  if (branch) {
    lines.push('', '### Branch state', '', `- Head \`${short(branch.head)}\` · ${branch.commits.length} commit(s) since the base \`${short(task.base?.commit)}\`, newest first:`);
    lines.push(...capped(branch.commits, MAX_LISTED_COMMITS, (commit) => `  - \`${short(commit.sha)}\` ${commit.subject}`, (n) => `  - … and ${n} older commit(s)`));
    lines.push(`- Changed files since the base (${branch.files.length}):`);
    lines.push(...capped(branch.files, MAX_LISTED_FILES, (file) => `  - ${file}`, (n) => `  - … and ${n} more`));
  }
  const data = report?.data;
  if (data) {
    lines.push('', `### Handover from the report of round ${report.round} (${data.status})`);
    for (const [key, label] of HANDOVER_LABELS) {
      const notes = data.handover?.[key] ?? [];
      if (notes.length) lines.push('', `${label}:`, ...notes.map((note) => `- ${note}`));
    }
    if (!data.handover) lines.push('', 'That report has no handover.');
    if (data.risks?.length) lines.push('', 'Risks:', ...data.risks.map((risk) => `- ${risk}`));
    if (data.openPoints?.length) lines.push('', 'Open points:', ...data.openPoints.map((point) => `- ${point.tag ? `(${point.tag}) ` : ''}${point.text}`));
  }
  return lines;
}

// The brief as Markdown. rules: [{ id, title, severity, protected }]; procedures: [{ name, origin, description, body }].
// decision: the user's decision after an escalation; takeover: what a fresh implementer inherits;
// movedFrom: the approved head a re-review starts from.
export function renderBrief({ ws, task, role, specText, ticket = null, packages = [], rules = [], procedures = [], guardrails = [], findings = [], decision = null, takeover = null, previousReviewPath = null, reportPath = null, movedFrom = null }) {
  const tree = workTreeOf(ws, task);
  const base = task.base ? `\`${task.base.branch}\` @ \`${task.base.commit}\`` : 'recorded at task start';
  const gitLine =
    ws.mode === 'in-place'
      ? role === 'reviewer'
        ? `- Mode: in-place · work tree \`${tree}\`: read its history with \`cw review diff|log|status --task ${task.id}\`; never \`cd\`. Read its files by absolute path.`
        : `- Mode: in-place · work tree \`${tree}\`: run git as \`${gitForm(ws)} …\`, exactly in this form, from the project root (the Bash cwd stays there; never \`cd\`); use absolute paths for files.`
      : role === 'reviewer'
        // The reviewer runs without isolation, in the project root: it reads the implementer's worktree from there.
        ? `- Mode: worktree · the implementer's worktree: read its history with \`cw review diff|log|status --task ${task.id}\`, never with git; never \`cd\`. Read its files by absolute path.`
        : '- Mode: worktree · work only in your worktree with plain `git …`; no `git -C` and no command substitution around git.';
  const lines = [
    `# Brief: ${role} · ${task.ticket} · ${task.title}`,
    '',
    `- Task id: \`${task.id}\` (pass \`--task ${task.id}\` to every cw command)`,
    `- Branch: \`${task.branch}\` · Base: ${base} · Round ${task.round} (review round ${task.reviewRound}/${ws.config.workflow.maxReviewRounds})`,
    gitLine,
    `- Complexity: ${task.complexity ?? '-'} · Areas: ${task.areas.join(', ') || '-'}`,
  ];
  if (ticket) {
    lines.push(...section(`Ticket (snapshot ${ticket.savedAt})`, [
      `${ticket.key}: ${ticket.summary}${ticket.url ? ` (${ticket.url})` : ''}`,
      ...(ticket.path ? ['', `Ticket file (read-only): ${join(ws.configRoot, ticket.path)}`] : []),
      ...(ticket.context ? ['', `Technical context (read-only; read it with the spec): ${join(ws.configRoot, ticket.context)}`] : []),
      ...(ticket.acceptanceCriteria?.length ? ['', 'Acceptance criteria in the ticket:', ...ticket.acceptanceCriteria.map((item) => `- ${item}`)] : []),
      ...(ticket.description ? ['', ticket.description.trim()] : []),
      // Scope agreed in a comment belongs to the requirement (ADR 0016).
      ...(ticket.comments?.length ? ['', 'Comments:', ...ticket.comments.map((comment) => `- ${[comment.author, comment.created].filter(Boolean).join(', ')}${comment.author || comment.created ? ': ' : ''}${comment.body.trim().replace(/\n+/g, ' ')}`)] : []),
      ...(ticket.links?.length ? ['', 'Linked issues:', ...ticket.links.map((link) => `- ${link.type ? `${link.type} ` : ''}${link.key}${link.summary ? `: ${link.summary}` : ''}`)] : []),
    ]));
  }
  lines.push(...section('Spec', [specText.trim()]));
  lines.push(...section('Packages and checks', [
    '| Package | Path | Areas | Checks (cw checks runs them) |',
    '|---|---|---|---|',
    ...packages.map((pkg) => `| ${pkg.id} | ${pkg.path} | ${pkg.areas.join(', ')} | ${Object.keys(pkg.checks ?? {}).join(', ') || '-'} |`),
  ]));
  lines.push(...section('Rules that apply', rules.map((rule) => `- ${rule.id} — ${rule.title} (${rule.severity}${rule.protected ? ', protected' : ''}); full text: cw rules show ${rule.id}`)));
  lines.push(...section('Procedures', procedures.flatMap((procedure) => [`### ${procedure.name} (${procedure.origin}) — ${procedure.description}`, '', procedure.body.trim(), ''])));
  if (role === 'implementer') lines.push(...section(`Guardrails for complexity ${String(task.complexity ?? '').toUpperCase()}`, guardrails.map((item) => `- ${item}`)));
  if (role === 'implementer' && decision) lines.push(...section("The user's decision after the escalation", [decision]));
  if (role === 'implementer' && takeover) lines.push(...section('Taking over from an earlier implementer', takeoverLines(task, takeover)));
  if (role === 'implementer' && findings.length) lines.push(...section('Review findings to fix', findings));
  if (role === 'reviewer') {
    lines.push(...section("The user's decisions on earlier findings", (task.decisions ?? []).map((item) =>
      `- Review ${item.review}.${item.reviewRound} ${item.finding} [${item.severity} · ${item.rule}] ${item.file ? `${item.file}${item.line ? `:${item.line}` : ''}: ` : ''}${item.issue} → ${item.as}${item.note ? ` (${item.note})` : ''}`)));
    lines.push(...section('Inputs', [
      ...(reportPath ? [`- Implementer report: ${reportPath}`] : []),
      ...(previousReviewPath ? [`- Your previous review: ${previousReviewPath}`] : []),
      ...(movedFrom ? [`- The branch moved after the approval of ${movedFrom}: review the commits since then.`] : []),
      `- Work tree to review, read-only (absolute, for the Read tool): ${tree ?? 'the implementer worktree recorded in the task'}`,
    ]));
  }
  const finish = role === 'implementer' ? `cw report save --task ${task.id}` : `cw review save --task ${task.id}`;
  lines.push(...section('Finish', [`Your final message is exactly the line \`${finish}\` prints last.`]));
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

export function writeBrief(ws, task, role, text) {
  const path = taskPath(ws, task.id, `brief-${role}.md`);
  writeAtomic(path, text);
  return path;
}
