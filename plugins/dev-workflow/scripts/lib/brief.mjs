// Brief files per role and the exact Agent/SendMessage texts the orchestrator passes on.
import { readFileSync } from 'node:fs';
import { procedureApplies, proceduresFor } from './playbook.mjs';
import { packageById } from './profile.mjs';
import { parseSpec } from './spec.mjs';
import { taskPath } from './task.mjs';
import { writeAtomic } from './fsx.mjs';

const ROLE_LABEL = { implementer: '', reviewer: 'Review · ', investigator: 'Investigate · ' };

export const agentName = (profile, role, complexity) =>
  `${profile.workflow.agentPrefix}${role === 'implementer' ? `implementer-${complexity}` : role}`;

export const description = (task, role) => `${ROLE_LABEL[role]}${task.ticket} · ${task.title}`.slice(0, 120);

function packageTable(profile, task) {
  const rows = task.packages.map((id) => packageById(profile, id)).filter(Boolean).map((pkg) => {
    const checks = Object.entries(pkg.checks).map(([name, command]) => `${name}: \`${command}\`${pkg.exclusive.includes(name) ? ' (exclusive)' : ''}`).join('; ') || '—';
    return `| ${pkg.id} | ${pkg.paths.join(', ')} | ${pkg.areas.join(', ')} | ${checks} | ${pkg.docs.map((doc) => `\`${doc}\``).join(', ') || '—'} |`;
  });
  return ['| Package | Paths | Areas | Checks (`cw checks` runs them) | Read first |', '|---|---|---|---|---|', ...rows].join('\n');
}

function procedureList(ctx, packs, role, task, spec) {
  const items = proceduresFor(ctx, packs, role).filter((procedure) =>
    procedureApplies(procedure, { paths: spec.paths, areas: task.areas, text: `${spec.title}\n${spec.body('Requirements')}` }));
  if (!items.length) return '- none';
  return items.map((procedure) => `- **${procedure.name}** (${procedure.origin}): ${procedure.description} — read \`${procedure.path}\``).join('\n');
}

function duties(profile) {
  const lines = [];
  const kb = profile.knowledgeBase;
  if (kb.features) lines.push(`- Update the affected rows in \`${kb.features}\` for feature changes.`);
  if (kb.lessons) lines.push(`- Append an entry to \`${kb.lessons}\` after a non-trivial bug fix.`);
  if (profile.tickets.file) {
    lines.push(`- New open to-dos go into \`${profile.tickets.file}\` with an ID from \`cw ticket reserve-id <PREFIX>\`.`);
    if (profile.tickets.deleteRowWhenDone) lines.push(`- When the ticket is fully done, delete its row: \`cw ticket done <ID>\`.`);
  }
  if (kb.todo && kb.todo !== profile.tickets.file) lines.push(`- Keep \`${kb.todo}\` current.`);
  return lines.length ? lines.join('\n') : '- none';
}

export function renderBrief(ctx, profile, packs, task, role, extra = {}) {
  const specText = readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8');
  const spec = parseSpec(specText);
  const header = [
    `# Brief for the ${role}: ${task.ticket} · ${task.title}`,
    '',
    `- Task id: \`${task.id}\` (pass it as \`--task ${task.id}\` to every \`cw\` command)`,
    `- Branch: \`${task.branch}\`${task.buildsOn ? ` · builds on \`${task.buildsOn}\`` : ''}`,
    `- Base: \`${task.base?.branch ?? '?'}\` @ \`${task.base?.commit ?? '?'}\``,
    `- Complexity: ${task.complexity} · Areas: ${task.areas.join(', ') || '—'}`,
  ];
  if (task.worktree) header.push(`- Worktree: \`${task.worktree}\``);
  if (profile.domain.neverGuess.length) header.push(`- Never guess on: ${profile.domain.neverGuess.join('; ')} — ask (status \`blocked\`) or cite the source.`);
  const parts = [header.join('\n'), '## Spec', specText.trim(), '## Packages', packageTable(profile, task), `## Procedures for the ${role}`, procedureList(ctx, packs, role, task, spec)];
  if (role === 'implementer') {
    parts.push('## Knowledge-base duties', duties(profile));
    parts.push('## Finish', '- Your final message is exactly the output of `cw report save --task ' + task.id + '` (JSON in a ```json fence).');
  }
  if (role === 'reviewer') {
    parts.push('## Inputs', [
      `- Dev report: \`${taskPath(ctx, task, `report-${task.round}.json`)}\``,
      task.round > 1 ? `- Your previous review: \`${taskPath(ctx, task, `review-${task.round - 1}.json`)}\` — focus on the changes since then and check every earlier blocking finding.` : '- First review round.',
      `- Review in the worktree \`${task.worktree ?? ctx.mainCheckout}\`; never change it.`,
    ].join('\n'));
    parts.push('## Finish', '- Your final message is exactly the output of `cw review save --task ' + task.id + '`.');
  }
  if (role === 'investigator') {
    parts.push('## Question', extra.question ?? '—');
    parts.push('## Finish', '- Your final message is exactly the output of `cw investigation save --task ' + task.id + '`.');
  }
  const text = `${parts.join('\n\n')}\n`;
  const path = taskPath(ctx, task, `brief-${role}.md`);
  writeAtomic(path, text);
  return path;
}

export function agentPrompt(task, role, briefPath) {
  const lines = [
    `Task ${task.ticket} · ${task.title} (task id ${task.id}).`,
    `Your brief is ${briefPath}. Read it completely before anything else, then follow your playbook step by step.`,
  ];
  if (role === 'implementer') lines.push('Start with `cw ws setup --task ' + task.id + '` as the playbook says.');
  return lines.join('\n');
}
