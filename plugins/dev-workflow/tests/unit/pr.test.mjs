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
