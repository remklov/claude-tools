// The task spec (§6 O3): template, parsing and lint. Paths in the spec are relative to the work repo.
import { NO_TICKET_ALIAS } from './ticket.mjs';

export const SECTIONS = ['Context', 'Requirements', 'Acceptance criteria', 'Non-goals', 'Definition of done'];

export function specTemplate(task) {
  return `## Task: ${task.title}

**Ticket:** ${task.ticket} · **Type:** ${task.type} · **Branch:** ${task.branch}

### Context
<why; affected modules and files as \`backticked/paths\` relative to the work repo>

### Requirements
- R1 …

### Acceptance criteria
- [ ] AC1 … (testable)

### Non-goals
- …

### Definition of done
- The checks of every affected package pass (\`cw checks --changed\`)
- The applicable rules are met (\`cw rules applicable\`)
`;
}

const FILE_EXT = /\.(m?[jt]sx?|c[jt]s|json|md|sql|ya?ml|css|scss|html|py|go|rs|php|rb|java|kt|sh|toml|env|lock|svg|txt)$/i;

// A list item (-, *, + or 1. / 1)) at any indentation, with an optional checkbox, that starts with an id
// matching the id pattern: [id, text]. A dotted sub-id (AC1.1, R1.2) is a note of its parent, no item.
const listItems = (text, id) =>
  [...text.matchAll(new RegExp(`^[ \\t]*(?:[-*+]|\\d+[.)])[ \\t]*(?:\\[[ xX]\\][ \\t]*)?(${id})(?!\\.\\d)\\b[:.]?[ \\t]*(.*)$`, 'gm'))].map((m) => [m[1], m[2].trim()]);

export function parseSpec(text) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  const sections = {};
  let current = null;
  for (const line of normalized.split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  const body = (name) => (sections[name] ?? []).join('\n').trim();
  // Ids as the report and review schemas take them: AC1, never AC01 (lint names those).
  const items = (name, prefix) => listItems(body(name), `${prefix}[1-9]\\d*`).map(([id, text]) => ({ id, text }));
  const header = (key) => new RegExp(`\\*\\*${key}:\\*\\*\\s*([^·\\n]+)`).exec(normalized)?.[1]?.trim() ?? null;
  const paths = [...body('Context').matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1].replace(/:\d+(-\d+)?$/, ''))
    .filter((path) => !/^https?:/.test(path) && (path.includes('/') || FILE_EXT.test(path)));
  return {
    title: /^##\s+Task:\s*(.+)$/m.exec(normalized)?.[1]?.trim() ?? '',
    header: { ticket: header('Ticket'), type: header('Type'), branch: header('Branch') },
    sectionOrder: Object.keys(sections),
    body,
    requirements: items('Requirements', 'R'),
    acceptance: items('Acceptance criteria', 'AC'),
    nonGoals: body('Non-goals').split('\n').map((line) => line.replace(/^-\s*/, '').trim()).filter((line) => line && line !== '…'),
    paths: [...new Set(paths)],
  };
}

// The text keyword rules match against: the title and the requirements (§5 complexity.escalate).
export const keywordText = (spec) => [spec.title, ...spec.requirements.map((item) => item.text)].join('\n');

const VAGUE = /\b(should work|works correctly|is correct|properly|as expected|works fine|no errors)\b/i;
const RULE_ID = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/g;

// Errors block classify and task start; warnings are shown. Options:
//   task               the header must match its ticket, type and branch
//   keyPattern         ticket-key-shaped tokens are not rule references; a task whose ticket does not
//                      match it is a no-ticket task (the config keeps git.noTicketKey from matching it),
//                      whose header may name the NO-TICKET alias (Decided in P2)
//   ruleIds, ruleIdPrefixes   rule references must exist (from the compiled rulebook; skipped when empty)
//   isKnownPath(path)  a Context path exists in the work repo (at HEAD or on disk)
//   appRoot            in in-place mode, paths must not start with it (classify matches them as they are),
//                      unless isKnownPath finds the prefixed path in the work repo
export function lintSpec(text, { task, keyPattern, ruleIds = new Set(), ruleIdPrefixes = new Set(), isKnownPath, appRoot } = {}) {
  const spec = parseSpec(text);
  const errors = [];
  const warnings = [];
  if (!spec.title) errors.push('missing the "## Task: <title>" line');
  if (task) {
    const noTicket = Boolean(keyPattern) && !new RegExp(keyPattern).test(task.ticket);
    for (const [key, expected] of [['ticket', task.ticket], ['type', task.type], ['branch', task.branch]]) {
      const alias = key === 'ticket' && noTicket && spec.header.ticket === NO_TICKET_ALIAS;
      if (spec.header[key] !== expected && !alias) errors.push(`the header's ${key} is "${spec.header[key] ?? ''}", the task's is "${expected}"`);
    }
  }
  const present = SECTIONS.filter((name) => spec.sectionOrder.includes(name));
  if (present.length !== SECTIONS.length) errors.push(`missing sections: ${SECTIONS.filter((name) => !present.includes(name)).join(', ')}`);
  else if (spec.sectionOrder.filter((name) => SECTIONS.includes(name)).join('|') !== SECTIONS.join('|')) errors.push(`the sections must be in this order: ${SECTIONS.join(', ')}`);
  if (!spec.requirements.length) errors.push('no requirement R1');
  if (!spec.acceptance.length) errors.push('no acceptance criterion AC1');
  for (const [name, prefix] of [['Requirements', 'R'], ['Acceptance criteria', 'AC']]) {
    for (const [id] of listItems(spec.body(name), `${prefix}0\\d*`)) errors.push(`${id} has a leading zero: number the items ${prefix}1, ${prefix}2, …`);
  }
  const contiguous = (list) => list.every((item, i) => Number(item.id.replace(/\D/g, '')) === i + 1);
  if (!contiguous(spec.requirements)) errors.push('the requirement numbering is not contiguous');
  if (!contiguous(spec.acceptance)) errors.push('the acceptance criterion numbering is not contiguous');
  for (const item of spec.requirements) if (item.text === '…' || item.text === '') errors.push(`${item.id} is still a placeholder`);
  for (const ac of spec.acceptance) {
    if (ac.text.startsWith('…') || ac.text === '') errors.push(`${ac.id} is still a placeholder`);
    else if (VAGUE.test(ac.text)) warnings.push(`${ac.id} is vague: "${ac.text}"`);
    if (/every (new )?test fails on the unfixed code/i.test(ac.text)) {
      errors.push(`${ac.id}: only regression tests fail on the unfixed code; other tests fail when their behaviour is removed`);
    }
  }
  if (/Co-Authored-By|Generated with/i.test(text)) errors.push('a spec never contains attribution lines');
  if (text.includes('<why;')) errors.push('the Context placeholder is still in the spec');
  if (ruleIds.size) {
    const ticketKey = keyPattern ? new RegExp(keyPattern) : null;
    for (const match of text.matchAll(RULE_ID)) {
      const id = match[1];
      if (ruleIds.has(id) || (ticketKey && ticketKey.test(id))) continue;
      if ([...ruleIdPrefixes].some((prefix) => id.startsWith(`${prefix}-`))) errors.push(`${id} is not a rule of this project (cw rules list)`);
    }
  }
  for (const path of spec.paths) {
    const known = isKnownPath ? Boolean(isKnownPath(path)) : null;
    if (appRoot && appRoot !== '.' && path.startsWith(`${appRoot}/`)) {
      // The work repo may have a directory of the same name (Next.js, Laravel, Rails app/): a prefixed
      // path that exists there, or a new file in that directory, is a real path.
      const rest = path.slice(appRoot.length + 1);
      const ownDir = isKnownPath ? Boolean(isKnownPath(appRoot)) : false;
      if (known) warnings.push(`\`${path}\` is read relative to the work repo (${appRoot}/), as its own ${path}, which exists; if you meant ${rest} at the work repo root, drop the "${appRoot}/" prefix`);
      else if (ownDir) warnings.push(`\`${path}\` is a new file in the work repo's own ${appRoot}/ directory; if you meant ${rest} at the work repo root, drop the "${appRoot}/" prefix`);
      else errors.push(`\`${path}\`: paths are relative to the work repo (${appRoot}/); drop the "${appRoot}/" prefix`);
    } else if (known === false) {
      warnings.push(`\`${path}\` does not exist in the work repo yet (fine for a new file)`);
    }
  }
  return { spec, errors, warnings };
}
