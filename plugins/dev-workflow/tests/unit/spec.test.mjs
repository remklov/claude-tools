import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withDefaults } from '../../cli/lib/config.mjs';
import { keywordText, lintSpec, parseSpec, specTemplate } from '../../cli/lib/spec.mjs';
import { isNoTicket, normalizeTicketKey, ticketFileOf, validateSnapshot } from '../../cli/lib/ticket.mjs';

const task = { ticket: 'APP-42', type: 'feature', branch: 'APP-42/feature/version-endpoint', title: 'Add the version endpoint' };

const good = `## Task: Add the version endpoint

**Ticket:** APP-42 · **Type:** feature · **Branch:** APP-42/feature/version-endpoint

### Context
The API has no version route. Routes live in \`src/routes/index.ts\`.

### Requirements
- R1 GET /api/version returns the package version.

### Acceptance criteria
- [ ] AC1 GET /api/version answers 200 with { version } from package.json.

### Non-goals
- No changelog endpoint.

### Definition of done
- Checks pass.
`;

const errorsOf = (text, options = {}) => lintSpec(text, { task, ...options }).errors;

test('the template parses, keeps the header and fails only on its placeholders', () => {
  const text = specTemplate(task);
  const spec = parseSpec(text);
  assert.deepEqual(spec.header, { ticket: 'APP-42', type: 'feature', branch: 'APP-42/feature/version-endpoint' });
  assert.deepEqual(errorsOf(text), ['R1 is still a placeholder', 'AC1 is still a placeholder', 'the Context placeholder is still in the spec']);
});

test('a complete spec is clean and yields its paths and keyword text', () => {
  const result = lintSpec(good, { task, isKnownPath: () => true });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.spec.paths, ['src/routes/index.ts']);
  assert.match(keywordText(result.spec), /version route|GET \/api\/version/);
});

test('each lint rule names the problem', () => {
  assert.deepEqual(errorsOf(good.replace('APP-42/feature/version-endpoint', 'APP-42/feature/other')), ['the header\'s branch is "APP-42/feature/other", the task\'s is "APP-42/feature/version-endpoint"']);
  assert.deepEqual(errorsOf(good.replace('### Non-goals', '### Goals')), ['missing sections: Non-goals']);
  assert.deepEqual(errorsOf(good.replace('- R1 GET', '- R2 GET')), ['the requirement numbering is not contiguous']);
  assert.deepEqual(errorsOf(`${good}\nCo-Authored-By: someone\n`), ['a spec never contains attribution lines']);
  assert.deepEqual(errorsOf(good.replace('answers 200 with { version } from package.json.', 'every test fails on the unfixed code.')), [
    'AC1: only regression tests fail on the unfixed code; other tests fail when their behaviour is removed',
  ]);
  const swapped = good.replace(/### Requirements[\s\S]*?(### Acceptance criteria[\s\S]*?)(### Non-goals)/, (match, ac, rest) => `${ac}### Requirements\n- R1 x\n\n${rest}`);
  assert.deepEqual(errorsOf(swapped), ['the sections must be in this order: Context, Requirements, Acceptance criteria, Non-goals, Definition of done']);
});

test('vague criteria and unknown paths are warnings; an unknown app/-prefixed path is an error naming the fix', () => {
  const vague = lintSpec(good.replace('answers 200 with { version } from package.json.', 'works correctly.'), { task, isKnownPath: () => false, appRoot: 'app' });
  assert.deepEqual(vague.errors, []);
  assert.match(vague.warnings[0], /AC1 is vague/);
  assert.match(vague.warnings[1], /does not exist in the work repo yet/);
  // classify matches the escalation globs against these paths, so the prefix must not pass (VALIDATION-8).
  const prefixed = lintSpec(good.replace('`src/routes/index.ts`', '`app/src/routes/index.ts`'), { task, appRoot: 'app' });
  assert.deepEqual(prefixed.errors, ['`app/src/routes/index.ts`: paths are relative to the work repo (app/); drop the "app/" prefix']);
  assert.deepEqual(prefixed.warnings, []);
  const unknown = lintSpec(good.replace('`src/routes/index.ts`', '`app/src/routes/index.ts`'), { task, appRoot: 'app', isKnownPath: () => false });
  assert.deepEqual(unknown.errors, prefixed.errors);
});

test('an app/-prefixed path that exists in the work repo (its own app/ directory) stays valid, with a warning', () => {
  const newRoute = lintSpec(good.replace('`src/routes/index.ts`', '`app/about/page.tsx`'), { task, appRoot: 'app', isKnownPath: (path) => path === 'app' });
  assert.deepEqual(newRoute.errors, [], 'a new file under the work repo\'s own app/ directory');
  assert.deepEqual(newRoute.warnings, ['`app/about/page.tsx` is a new file in the work repo\'s own app/ directory; if you meant about/page.tsx at the work repo root, drop the "app/" prefix']);
  // A Next.js, Laravel or Rails work repo has a top-level app/ of its own (R2-A1).
  const known = (path) => path === 'app/page.tsx';
  const own = lintSpec(good.replace('`src/routes/index.ts`', '`app/page.tsx`'), { task, appRoot: 'app', isKnownPath: known });
  assert.deepEqual(own.errors, []);
  assert.deepEqual(own.warnings, ['`app/page.tsx` is read relative to the work repo (app/), as its own app/page.tsx, which exists; if you meant page.tsx at the work repo root, drop the "app/" prefix']);
  assert.deepEqual(own.spec.paths, ['app/page.tsx'], 'classify matches the path as it is');
});

test('criteria and requirements take any list marker and indentation; ids have no leading zero', () => {
  const markers = good
    .replace('- R1 GET', '* R1 GET')
    .replace(/- \[ \] AC1 (.*)\n/, '- [ ] AC1 $1\n* [ ] AC2 answers 404 for POST.\n  - [x] AC3 sets no cookie.\n1. AC4 logs nothing.\n2) AC5 needs no auth.\n+ AC6 is cached for 60 s.\n');
  const spec = parseSpec(markers);
  assert.deepEqual(spec.requirements.map((item) => item.id), ['R1']);
  assert.deepEqual(spec.acceptance.map((ac) => [ac.id, ac.text]), [
    ['AC1', 'GET /api/version answers 200 with { version } from package.json.'],
    ['AC2', 'answers 404 for POST.'], ['AC3', 'sets no cookie.'], ['AC4', 'logs nothing.'], ['AC5', 'needs no auth.'], ['AC6', 'is cached for 60 s.'],
  ]);
  assert.deepEqual(errorsOf(markers), []);

  // The report and review schemas take AC1, never AC01 (VALIDATION-12).
  const padded = good.replace('- R1 GET', '- R01 GET').replace('- [ ] AC1 GET', '- [ ] AC01 GET');
  assert.deepEqual(parseSpec(padded).acceptance, []);
  assert.deepEqual(errorsOf(padded), [
    'no requirement R1',
    'no acceptance criterion AC1',
    'R01 has a leading zero: number the items R1, R2, …',
    'AC01 has a leading zero: number the items AC1, AC2, …',
  ]);
});

test('a no-ticket task accepts the NO-TICKET alias in the header; a ticket task does not', () => {
  const keyPattern = '^[A-Z][A-Z0-9]+-[0-9]+$';
  const maintenance = { ...task, ticket: 'maintenance', branch: 'maintenance/feature/version-endpoint' };
  const header = (ticket) => good.replace('**Ticket:** APP-42', `**Ticket:** ${ticket}`).replace('APP-42/feature/version-endpoint', maintenance.branch);
  assert.deepEqual(lintSpec(header('NO-TICKET'), { task: maintenance, keyPattern }).errors, []);
  assert.deepEqual(lintSpec(header('maintenance'), { task: maintenance, keyPattern }).errors, []);
  assert.deepEqual(lintSpec(good.replace('**Ticket:** APP-42', '**Ticket:** NO-TICKET'), { task, keyPattern }).errors, ['the header\'s ticket is "NO-TICKET", the task\'s is "APP-42"']);
});

test('rule references must exist; ticket keys are not rules', () => {
  const options = { ruleIds: new Set(['CORE-SCOPE']), ruleIdPrefixes: new Set(['CORE', 'TS']), keyPattern: '^[A-Z][A-Z0-9]+-[0-9]+$' };
  assert.deepEqual(errorsOf(good.replace('No changelog endpoint.', 'Follow CORE-SCOPE and CORE-FOO; see APP-42.'), options), ['CORE-FOO is not a rule of this project (cw rules list)']);
});

test('ticket keys, the NO-TICKET alias and the snapshot', () => {
  const config = withDefaults({ version: 1, project: { name: 'x' }, packs: [], packages: [{ id: 'a', path: '.', areas: ['backend'] }], tickets: { source: 'jira' } });
  assert.equal(normalizeTicketKey(config, 'APP-42'), 'APP-42');
  assert.equal(normalizeTicketKey(config, 'NO-TICKET'), 'maintenance');
  assert.ok(isNoTicket(config, 'maintenance'));
  assert.ok(isNoTicket(config, 'NO-TICKET'));
  assert.ok(!isNoTicket(config, 'APP-42'));
  assert.throws(() => normalizeTicketKey(config, 'mm-42'), (error) => error.exitCode === 2 && /APP-42, or maintenance/.test(error.fix));

  const snapshot = { key: 'APP-42', summary: 'Version endpoint', url: 'https://example.atlassian.net/browse/APP-42', acceptanceCriteria: ['200 with version'] };
  const ok = validateSnapshot(config, { ticket: 'APP-42' }, snapshot, { now: new Date('2026-10-19T10:00:00Z') });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value.savedAt, '2026-10-19T10:00:00.000Z');
  assert.equal(ok.value.source, 'jira');
  assert.deepEqual(validateSnapshot(config, { ticket: 'APP-43' }, snapshot).errors, ["$.key: is APP-42, the task's ticket is APP-43"]);
  assert.deepEqual(validateSnapshot(config, { ticket: 'APP-42' }, { ...snapshot, url: 'http://x' }).errors, ['$.url: must match ^https://']);
  assert.deepEqual(validateSnapshot(config, { ticket: 'APP-42' }, { key: 'APP-42', summary: 's' }).errors, ['$.url: is required for a Jira snapshot']);
  assert.deepEqual(validateSnapshot(config, { ticket: 'maintenance' }, { key: 'maintenance', summary: 's', source: 'notes' }).errors, []);
});

test('the ticket file of a key, and the Linear and local snapshots', () => {
  const configOf = (tickets) => withDefaults({ version: 1, project: { name: 'x' }, packs: [], packages: [{ id: 'a', path: '.', areas: ['backend'] }], tickets });
  const linear = configOf({ source: 'linear', contextPath: 'docs/specs/{key}.md' });
  const local = configOf({ source: 'local', contextPath: './docs/specs/{key}.md' });
  assert.equal(ticketFileOf(linear, 'APP-123'), 'docs/specs/APP-123.md');
  assert.equal(ticketFileOf(local, 'APP-123'), 'docs/specs/APP-123.md');
  assert.equal(ticketFileOf(local, 'NO-TICKET'), null);
  assert.equal(ticketFileOf(configOf({}), 'APP-123'), 'docs/tickets/APP-123.md', 'local tickets in docs/tickets/ by default');
  assert.equal(ticketFileOf(configOf({ source: 'jira' }), 'APP-123'), null);
  assert.throws(() => ticketFileOf(configOf({ keyPattern: '.+', contextPath: '{key}.md' }), '../../x'), (error) => error.exitCode === 2 && /outside the project/.test(error.message));

  const save = (config, input) => validateSnapshot(config, { ticket: 'APP-123' }, { key: 'APP-123', summary: 's', ...input });
  const url = 'https://linear.app/acme/issue/APP-123/s';
  assert.deepEqual(save(linear, { url }).errors, []);
  assert.equal(save(linear, { url }).value.source, 'linear');
  assert.deepEqual(save(linear, { url, context: 'docs/specs/APP-123.md' }).errors, []);
  assert.deepEqual(save(linear, {}).errors, ['$.url: is required for a Linear snapshot']);
  assert.deepEqual(save(linear, { url, source: 'jira' }).errors, ['$.source: is jira, tickets.source is linear']);
  assert.deepEqual(save(linear, { url, context: 'docs/APP-123.md' }).errors, ['$.context: is docs/APP-123.md, the context file of APP-123 is docs/specs/APP-123.md']);
  assert.deepEqual(save(linear, { url, path: 'docs/specs/APP-123.md' }).errors, ['$.path: only a local snapshot has a path']);
  assert.deepEqual(save(configOf({ source: 'jira' }), { url: 'https://example.atlassian.net/browse/APP-123', context: 'docs/specs/APP-123.md' }).errors,
    ['$.context: is docs/specs/APP-123.md, the context file of APP-123 is not configured (tickets.contextPath)']);

  assert.deepEqual(save(local, { path: 'docs/specs/APP-123.md' }).errors, []);
  assert.deepEqual(save(local, {}).errors, ['$.path: is missing, the ticket file of APP-123 is docs/specs/APP-123.md']);
  assert.deepEqual(save(local, { path: 'docs/specs/APP-123.md', context: 'docs/specs/APP-123.md' }).errors, ['$.context: a local snapshot has none; its path is the ticket']);
  assert.deepEqual(save(local, { source: 'pasted' }).errors, []);
});

test('a nested dotted sub-id (AC1.1, R1.1) is a note of its parent, not a second item', () => {
  const text = parseSpec('## Task: Mul\n\n### Requirements\n- R1 Export mul.\n  - R1.1 It handles negative numbers.\n- R2 Document it.\n\n### Acceptance criteria\n- [ ] AC1 mul(2, 3) returns 6.\n  - AC1.1 mul(-2, 3) returns -6.\n- [ ] AC2: The README names mul.\n- AC3. Typed.\n');
  assert.deepEqual(text.requirements.map((item) => item.id), ['R1', 'R2']);
  assert.deepEqual(text.acceptance.map((item) => [item.id, item.text]), [['AC1', 'mul(2, 3) returns 6.'], ['AC2', 'The README names mul.'], ['AC3', 'Typed.']]);
});
