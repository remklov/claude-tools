import assert from 'node:assert/strict';
import { test } from 'node:test';

import { withDefaults } from '../../cli/lib/config.mjs';
import { parseSummary } from '../../cli/lib/commit.mjs';
import { prBody, prTitle } from '../../cli/lib/pr.mjs';

const config = withDefaults({
  version: 1,
  project: { name: 'Fixture' },
  packs: [],
  packages: [{ id: 'app', path: '.', areas: ['backend'] }],
  git: { noTicketKey: 'NO-TICKET' },
});
const preset = config.git.conventions;
const commit = (subject, sha = 'a'.repeat(40)) => ({ sha, subject });
const task = (ticket = 'ABC-123') => ({ id: 't', ticket, title: 'Add the mul helper', round: 2 });

const SPEC = `## Task: Add the mul helper
**Ticket:** ABC-123 · **Type:** feature · **Branch:** ABC-123/feature/mul-helper

### Context
The calculator needs multiplication for the invoice totals.
Second line of the same paragraph.

Details that stay out of the PR.

### Requirements
- R1 Multiply two numbers
- R2: Reject non-numbers

### Acceptance criteria
- [ ] AC1 mul(2, 3) is 6
`;

test('parseSummary splits flags, keyword and text, with or without spaces', () => {
  assert.deepEqual(parseSummary('[!!!][SECURITY][FEATURE] Add x', preset), { flags: ['!!!', 'SECURITY'], keyword: 'FEATURE', text: 'Add x' });
  assert.deepEqual(parseSummary('[!!!] [BUGFIX] Fix y', preset), { flags: ['!!!'], keyword: 'BUGFIX', text: 'Fix y' });
  assert.deepEqual(parseSummary('Add z', preset), { flags: [], keyword: null, text: 'Add z' });
});

test('prTitle: the oldest summary with the flags of later commits', () => {
  assert.equal(prTitle({ preset, commits: [commit('[FEATURE] Add the mul helper')], taskId: 't' }), '[FEATURE] Add the mul helper');
  const commits = [commit('[FEATURE] Add the mul helper'), commit('[TASK] Tidy up'), commit('[SECURITY] [BUGFIX] Escape input'), commit('[!!!][TASK] Drop v1')];
  assert.equal(prTitle({ preset, commits, taskId: 't' }), '[!!!][SECURITY][FEATURE] Add the mul helper');
  assert.throws(() => prTitle({ preset, commits: [commit('Add things')], taskId: 't' }), (error) => error.exitCode === 1 && /no keyword/.test(error.message) && /cw commit lint --task t/.test(error.fix));
  // Rewording a commit in delivery moves the branch past the approved review: the fix opens the PR/MR by hand.
  const byHand = (error) => error.exitCode === 1 && error.fix.includes('cw pr record --task t --url <url>') && /would move the branch past the approved review/.test(error.fix);
  assert.throws(() => prTitle({ preset, commits: [commit(`[FEATURE] ${'x'.repeat(70)}`)], taskId: 't' }), (error) => byHand(error) && /limit is 72/.test(error.message));
  assert.throws(() => prTitle({ preset, commits: [commit('[FEATURE] Add the multiplication helper to the math utilities mod'), commit('[SECURITY][BUGFIX] Escape the input')], taskId: 't' }), (error) => byHand(error) && /has 75 characters/.test(error.message));
  assert.throws(() => prTitle({ preset, commits: [], taskId: 't' }), (error) => error.exitCode === 3);
});

test('prBody: verified testing only, unfixed findings as open points, the Relates to trailer', () => {
  const body = prBody({
    task: task(),
    config,
    ticket: { key: 'ABC-123', summary: 'Invoices need multiplication', url: 'https://example.atlassian.net/browse/ABC-123' },
    spec: SPEC,
    report: {
      risks: ['Rounding differs from the old helper'],
      openPoints: ['Document the helper', { text: 'Check the invoice PDF by eye', tag: 'manual' }],
      proofs: [
        { command: 'node --test src/mul.test.mjs', holds: true, failureLine: 'AssertionError: 5 !== 6' },
        { command: 'node --test src/other.test.mjs', holds: false },
      ],
    },
    reviews: [
      { round: 1, status: 'changes_requested', findings: [
        { severity: 'blocking', rule: 'CORE-TEST-SPEC', file: 'src/mul.mjs', issue: 'No test' },
        { severity: 'non_blocking', rule: 'CORE-NAMING', file: 'src/mul.mjs', line: 1, issue: 'Name a and b', sendAlong: true },
        { severity: 'non_blocking', rule: 'CORE-COMMENTS', file: 'src/mul.mjs', line: 2, issue: 'Explain the rounding', sendAlong: false },
      ] },
      { round: 2, status: 'approved', findings: [
        { severity: 'non_blocking', rule: 'CORE-COMMENTS', file: 'src/mul.mjs', line: 2, issue: 'Explain the rounding', sendAlong: false },
        { severity: 'non_blocking', rule: 'CORE-STRUCTURE', file: 'src/util.mjs', issue: 'Split the module', sendAlong: true },
      ] },
    ],
    checks: { packages: [{ id: 'app', path: '.', checks: [
      { name: 'test', command: 'npm test', result: 'pass' },
      { name: 'lint', command: 'npm run lint', result: 'fail' },
    ] }] },
    commits: [commit('[FEATURE] Add the mul helper'), commit('[SECURITY][TASK] Escape the input')],
  });
  assert.equal(body, `## What & why

[ABC-123](https://example.atlassian.net/browse/ABC-123): Invoices need multiplication

The calculator needs multiplication for the invoice totals.
Second line of the same paragraph.

- Multiply two numbers
- Reject non-numbers

## Testing

- \`npm test\` in \`.\` (app): pass
- Proof: \`node --test src/mul.test.mjs\` fails without the change (AssertionError: 5 !== 6) and passes with it

## Risks & deploy steps

- Rounding differs from the old helper
- Security-relevant change: [SECURITY][TASK] Escape the input

## Open points

- Document the helper
- Manual check (not verified here): Check the invoice PDF by eye
- CORE-COMMENTS: Explain the rounding (\`src/mul.mjs:2\`)
- CORE-STRUCTURE: Split the module (\`src/util.mjs\`)

Relates to ABC-123
`);
  assert.ok(!body.includes('Name a and b'), 'an earlier sendAlong finding was fixed');
  assert.ok(!/merge/i.test(body));
});

test('prBody leaves empty sections out and has no trailer for the no-ticket key', () => {
  const body = prBody({ task: task('NO-TICKET'), config, spec: '', reviews: [{ round: 1, findings: [] }] });
  assert.equal(body, '## What & why\n\nAdd the mul helper\n');
  const maintenance = withDefaults({ version: 1, project: { name: 'X' }, packs: [], packages: [{ id: 'a', path: '.', areas: ['x'] }] });
  assert.equal(prBody({ task: task('maintenance'), config: maintenance }), '## What & why\n\nAdd the mul helper\n');
  assert.ok(prBody({ task: task('NO-TICKET'), config: maintenance }).endsWith('\n\nAdd the mul helper\n'), 'NO-TICKET is an alias of the no-ticket key');
});

test('the ticket-suffix preset: the title is the oldest summary; Affected packages; no trailer', () => {
  const suffixConfig = withDefaults({
    version: 1,
    project: { name: 'Fixture' },
    packs: [],
    packages: [{ id: 'api', path: 'fisko-api', areas: ['backend'] }, { id: 'app', path: 'fisko-app', areas: ['frontend'] }],
    git: { preset: 'ticket-suffix' },
  });
  const suffix = suffixConfig.git.conventions;
  assert.equal(prTitle({ preset: suffix, commits: [commit('Fix the CRE (NV-9)'), commit('Add a test (NV-9)', 'b'.repeat(40))], taskId: 't' }), 'Fix the CRE (NV-9)');
  const body = prBody({ task: { ...task('NV-9'), packages: ['api'] }, config: suffixConfig, spec: SPEC });
  assert.match(body, /^## What & why\n\nAdd the mul helper[^]*## Affected packages\n\n- api \(`fisko-api`\)\n$/);
  assert.doesNotMatch(body, /Relates to/);
});

test('prBody: the summary of the orchestrator, several proofs by their test files, the risks of the spec and the decisions of the user', () => {
  const spec = SPEC.replace('### Acceptance criteria', '### Risks and deploy steps\n- Set INVOICE_ROUNDING=half-even in production.\n\n### Acceptance criteria');
  const final = { round: 2, reviewRound: 2, status: 'approved', findings: [
    { id: 'F1', severity: 'non_blocking', rule: 'correctness', file: 'src/mul.mjs', line: 4, issue: 'NaN passes through.' },
    { id: 'F2', severity: 'non_blocking', rule: 'security', file: 'src/mul.mjs', issue: 'Logs the raw input.' },
    { id: 'F3', severity: 'non_blocking', rule: 'CORE-COMMENTS', file: 'src/mul.mjs', issue: 'Explain the rounding' },
  ] };
  const decisions = [
    { review: 2, reviewRound: 2, finding: 'F1', as: 'accept', note: 'No caller passes NaN' },
    { review: 2, reviewRound: 2, finding: 'F2', as: 'fix', note: 'Fix now' },
    { review: 1, reviewRound: 1, finding: 'F1', as: 'ticket', note: 'An earlier review' },
  ];
  const body = prBody({
    task: task(),
    config,
    spec,
    what: '- `mul` multiplies the invoice amounts.\n- The invoice total uses it.',
    report: { proofs: [
      { command: 'node --test src/mul.test.mjs', testPath: 'src/mul.test.mjs', holds: true, failureLine: 'x' },
      { command: 'node --test src/invoice.test.mjs -t total', testPath: 'src/invoice.test.mjs', holds: true },
      { command: 'node --test src/invoice.test.mjs -t rounding', testPath: 'src/invoice.test.mjs', holds: true },
    ] },
    reviews: [{ round: 1, reviewRound: 1, findings: [{ id: 'F1', severity: 'non_blocking', rule: 'CORE-NAMING', issue: 'Old nit' }] }, final],
    checks: { packages: [{ id: 'app', path: '.', checks: [
      { name: 'typecheck', command: 'npm run typecheck', result: 'pass' },
      { name: 'test', command: 'npm test', result: 'pass' },
    ] }] },
    decisions,
  });
  assert.match(body, /^## What & why\n\nAdd the mul helper\n\nThe calculator needs multiplication for the invoice totals\.\nSecond line of the same paragraph\.\n\n- `mul` multiplies the invoice amounts\.\n- The invoice total uses it\.\n\n## Testing/);
  assert.ok(body.includes('- `npm run typecheck`, `npm test` in `.` (app): pass\n- Proofs: 3 tests fail without the change and pass with it (`mul.test.mjs`, `invoice.test.mjs`)'), body);
  assert.ok(body.includes('## Risks & deploy steps\n\n- Set INVOICE_ROUNDING=half-even in production.'), body);
  assert.ok(body.includes('## Open points\n\n- Accepted by the user (No caller passes NaN): correctness: NaN passes through. (`src/mul.mjs:4`)\n- CORE-COMMENTS: Explain the rounding (`src/mul.mjs`)\n'), body);
  assert.ok(!body.includes('Logs the raw input') && !body.includes('Old nit') && !body.includes('An earlier review'), 'a fix decision is not open; open points come from the final review');
});

test('prBody without a summary lists at most six requirements', () => {
  const many = SPEC.replace('- R1 Multiply two numbers\n- R2: Reject non-numbers', Array.from({ length: 8 }, (_, i) => `- R${i + 1} Requirement ${i + 1}`).join('\n'));
  const body = prBody({ task: task('NO-TICKET'), config, spec: many });
  assert.match(body, /- Requirement 6\n- … and 2 more requirements\n/);
  assert.ok(!body.includes('Requirement 7'));
});
