// Task spec: template, parsing and lint (spec 01 §6).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tryGit } from './git.mjs';
import { isSlug, render, templateToRegExp, SLUG_PATTERN } from './template.mjs';

export const SECTIONS = ['Context', 'Requirements', 'Acceptance criteria', 'Non-goals', 'Definition of done'];

export function specTemplate(task, profile) {
  const duties = [];
  if (profile.knowledgeBase.features) duties.push(`- \`${profile.knowledgeBase.features}\` updated for feature changes`);
  if (profile.knowledgeBase.lessons) duties.push(`- \`${profile.knowledgeBase.lessons}\` entry for a non-trivial bug fix`);
  if (profile.tickets.deleteRowWhenDone && profile.tickets.file) duties.push(`- New open to-dos added to \`${profile.tickets.file}\`; the ticket's row deleted when it is fully done`);
  return `## Task: ${task.title}
**Ticket:** ${task.ticket} · **Type:** ${task.type} · **Complexity:** <s|m|l|xl>
**Branch:** ${task.branch} · **Builds on:** ${task.buildsOn ?? '—'}

### Context
<why; affected modules and files as \`backticked/paths\`; the plan, manual or doc that settles the rules>

### Requirements
- R1 …

### Acceptance criteria
- [ ] AC1 … (testable)

### Non-goals
- …

### Definition of done
- Checks of every affected package pass (\`cw checks --changed\`)
- Rules of the compiled rulebook are met (\`cw rules applicable\`)
${duties.join('\n')}
`;
}

export function parseSpec(text) {
  const sections = {};
  let current = null;
  for (const line of text.split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  const body = (name) => (sections[name] ?? []).join('\n').trim();
  const items = (name, prefix) => [...body(name).matchAll(new RegExp(`^-\\s*(?:\\[[ x]\\]\\s*)?(${prefix}\\d+)\\b\\s*(.*)$`, 'gm'))].map((m) => ({ id: m[1], text: m[2].trim() }));
  const title = /^##\s+Task:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
  const header = (key) => new RegExp(`\\*\\*${key}:\\*\\*\\s*([^·\\n]+)`).exec(text)?.[1]?.trim() ?? null;
  const FILE_EXT = /\.(m?[jt]sx?|c[jt]s|json|md|MD|sql|ya?ml|css|scss|html|py|go|rs|php|rb|java|kt|sh|toml|env|lock|svg|txt)$/;
  const paths = [...body('Context').matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1].replace(/:\d+(-\d+)?$/, ''))
    .filter((path) => (path.includes('/') && !/^https?:/.test(path) && !/\s/.test(path)) || FILE_EXT.test(path));
  return {
    title,
    ticket: header('Ticket'),
    type: header('Type'),
    complexity: header('Complexity'),
    branch: header('Branch'),
    sectionOrder: Object.keys(sections),
    sections,
    body,
    requirements: items('Requirements', 'R'),
    acceptance: items('Acceptance criteria', 'AC'),
    nonGoals: body('Non-goals').split('\n').map((line) => line.replace(/^-\s*/, '').trim()).filter(Boolean),
    paths: [...new Set(paths)],
  };
}

const VAGUE = /\b(should work|works correctly|is correct|properly|as expected|works fine|no errors)\b/i;

export function lintSpec(text, { profile, ctx, base, ruleIds = new Set() }) {
  const spec = parseSpec(text);
  const errors = [];
  const warnings = [];
  const present = SECTIONS.filter((name) => spec.sectionOrder.includes(name));
  if (present.length !== SECTIONS.length) errors.push(`missing sections: ${SECTIONS.filter((name) => !present.includes(name)).join(', ')}`);
  else if (spec.sectionOrder.filter((name) => SECTIONS.includes(name)).join('|') !== SECTIONS.join('|')) errors.push(`sections must be in order: ${SECTIONS.join(', ')}`);
  if (!spec.title) errors.push('missing "## Task: <title>" line');
  if (!spec.requirements.length) errors.push('no requirement R1…');
  if (!spec.acceptance.length) errors.push('no acceptance criterion AC1…');
  const contiguous = (list) => list.every((item, i) => Number(item.id.replace(/\D/g, '')) === i + 1);
  if (!contiguous(spec.requirements)) errors.push('requirement numbering is not contiguous');
  if (!contiguous(spec.acceptance)) errors.push('acceptance criterion numbering is not contiguous');
  for (const ac of spec.acceptance) {
    if (ac.text.includes('…') || ac.text === '') errors.push(`${ac.id} is still a placeholder`);
    else if (VAGUE.test(ac.text)) warnings.push(`${ac.id} is vague: "${ac.text}"`);
    if (/every (new )?test fails on the unfixed code/i.test(ac.text)) errors.push(`${ac.id}: only regression tests fail on unfixed code; other tests must fail when their behaviour is removed`);
  }
  if (/Co-Authored-By|Generated with/i.test(text)) errors.push('specs never contain attribution lines');
  for (const placeholder of ['<why;', '<s|m|l|xl>']) if (text.includes(placeholder)) errors.push(`placeholder ${placeholder} still in the spec`);
  for (const match of text.matchAll(/\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/g)) {
    const id = match[1];
    const looksLikeRule = /^(CORE|TS|NPM|EXPRESS|REACT|VITE|RTL|TW|VITEST|SQL|DOCKER|GHA)-/.test(id) || (profile.rules.add.length && /^[A-Z]+-[A-Z]/.test(id) && !new RegExp(profile.tickets.idPattern).test(id));
    if (looksLikeRule && ruleIds.size && !ruleIds.has(id)) warnings.push(`${id} looks like a rule ID but is not in the rulebook`);
  }
  if (spec.branch) {
    const tokenPatterns = { ticket: '[A-Za-z0-9#-]+', slug: SLUG_PATTERN, type: profile.git.branchTypes.length ? profile.git.branchTypes.join('|') : '[a-z]+' };
    const isNoTicket = spec.ticket === profile.git.noTicketKey;
    const template = isNoTicket ? profile.git.branchNoTicket : profile.git.branch;
    if (!templateToRegExp(template, tokenPatterns).test(spec.branch)) errors.push(`branch ${spec.branch} does not match ${template}`);
  }
  if (base && ctx) {
    for (const path of spec.paths) {
      const atBase = tryGit(['cat-file', '-e', `${base}:${path}`], { cwd: ctx.repoRoot }) !== null;
      if (!atBase && !existsSync(join(ctx.repoRoot, path))) warnings.push(`path \`${path}\` does not exist yet (fine for new files)`);
    }
  }
  return { spec, errors, warnings };
}

export function renderBranch(profile, { ticket, slug, type }) {
  if (!isSlug(slug)) throw new Error(`slug "${slug}" must be 2–4 lowercase words joined by hyphens`);
  const template = ticket === profile.git.noTicketKey ? profile.git.branchNoTicket : profile.git.branch;
  return render(template, { ticket: String(ticket).replace(/^#/, ''), slug, type });
}
