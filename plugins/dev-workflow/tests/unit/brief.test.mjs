import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agentCall, agentDescription, findingsToFix, renderBrief, returnMessage } from '../../cli/lib/brief.mjs';
import { classify, configRules } from '../../cli/lib/classify.mjs';
import { withDefaults } from '../../cli/lib/config.mjs';
import { GUARDRAILS } from '../../cli/lib/guardrails.mjs';

const config = withDefaults({
  version: 1,
  project: { name: 'x' },
  workspace: { mode: 'in-place', appRoot: 'app' },
  packs: [],
  packages: [
    { id: 'web', path: 'packages/web', areas: ['frontend'], checks: { test: 'npm test' } },
    { id: 'api', path: 'packages/api', areas: ['backend'], checks: { test: 'npm test', lint: 'npm run lint' } },
  ],
  complexity: { escalate: [{ paths: ['packages/api/src/db/**'], min: 'l', reason: 'schema changes' }, { keywords: ['migration'], min: 'm', reason: 'data migrations' }] },
});
const prefixGlob = (path, glob) => path.startsWith(glob.replace('**', ''));

test('classify maps paths to packages and areas and takes the highest minimum', () => {
  const result = classify({
    config,
    rules: [...configRules(config), { keywords: ['endpoint'], min: 'm', reason: 'API surface', source: 'pack:express' }],
    paths: ['packages/api/src/db/schema.ts', 'packages/web/src/App.tsx', 'docs/x.md'],
    text: 'Add the endpoint and a migration',
    matchGlob: prefixGlob,
  });
  assert.deepEqual(result.packages, ['web', 'api']);
  assert.deepEqual(result.areas, ['frontend', 'backend']);
  assert.deepEqual(result.unowned, ['docs/x.md']);
  assert.equal(result.minComplexity, 'l');
  assert.deepEqual(result.matched.map((rule) => rule.hit), ['path packages/api/src/db/schema.ts ~ packages/api/src/db/**', 'keyword "migration"', 'keyword "endpoint"']);
  assert.match(result.reasons[0], /^l: schema changes/);
});

test('classify without paths selects nothing and warns', () => {
  const result = classify({ config, paths: [], text: '', matchGlob: prefixGlob });
  assert.equal(result.minComplexity, 's');
  assert.deepEqual(result.packages, []);
  assert.match(result.warnings[0], /names no paths/);
});

const task = {
  id: 'APP-42__feature__version-endpoint', ticket: 'APP-42', title: 'Add the version endpoint', branch: 'APP-42/feature/version-endpoint',
  complexity: 'm', round: 2, reviewRound: 1, areas: ['backend'], base: { branch: 'main', commit: 'abc123' }, workTree: '/p/app',
};
const inPlace = { mode: 'in-place', workRepo: '/p/app', config };
const worktree = { mode: 'worktree', workRepo: '/p', config };

test('the Agent call is exact: background off, isolation only for worktree implementers', () => {
  assert.deepEqual(agentCall(inPlace, task, 'implementer', '/s/brief.md'), {
    subagent_type: 'dev-workflow:implementer-m',
    description: 'APP-42 · Add the version endpoint',
    prompt: 'Task APP-42 · Add the version endpoint (task id APP-42__feature__version-endpoint).\nYour brief is /s/brief.md. Read it completely before anything else, then follow your playbook step by step.\nStart with `cw ws setup --task APP-42__feature__version-endpoint`.',
    run_in_background: false,
  });
  assert.equal(agentCall(worktree, task, 'implementer', '/b').isolation, 'worktree');
  assert.equal('isolation' in agentCall(worktree, task, 'reviewer', '/b'), false);
  assert.equal(agentCall(worktree, task, 'reviewer', '/b').subagent_type, 'dev-workflow:reviewer');
  assert.equal(agentDescription({ ticket: 'APP-1', title: 'x'.repeat(80) }, 'implementer').length, 60);
});

test('only blocking and sendAlong findings go back to the implementer', () => {
  const review = {
    findings: [
      { severity: 'blocking', rule: 'CORE-ERRORS', file: 'src/a.ts', line: 3, issue: 'Swallowed error', suggestion: 'Rethrow' },
      { severity: 'non_blocking', rule: 'CORE-NAMING', file: 'src/b.ts', issue: 'Name', sendAlong: true },
      { severity: 'non_blocking', issue: 'Style only' },
    ],
  };
  assert.deepEqual(findingsToFix(review), ['- [blocking · CORE-ERRORS] src/a.ts:3: Swallowed error — Rethrow', '- [also · CORE-NAMING] src/b.ts: Name']);
  assert.match(returnMessage(task, review, '/b.md'), /Review round 1 requests changes[\s\S]*cw report save --task APP-42__feature__version-endpoint/);
  assert.match(returnMessage(task, review, '/b.md'), /commit \(cw commit msg, then the git commit -F it prints\)/, 'no bare git commit for an in-place implementer');
});

test('the implementer brief carries the spec, packages, rules, procedures, guardrails and findings', () => {
  const brief = renderBrief({
    ws: inPlace,
    task,
    role: 'implementer',
    specText: '## Task: Add the version endpoint\n',
    ticket: { key: 'APP-42', summary: 'Version endpoint', url: 'https://example.atlassian.net/browse/APP-42', savedAt: '2026-10-19T10:00:00.000Z', acceptanceCriteria: ['200 with version'] },
    packages: [config.packages[1]],
    rules: [{ id: 'CORE-SECRETS', title: 'No secrets in code', severity: 'blocking', protected: true }],
    procedures: [{ name: 'express-route', origin: 'pack:express', description: 'New route', body: '1. Register it in createApp().' }],
    guardrails: GUARDRAILS.m,
    findings: ['- [blocking · CORE-ERRORS] src/a.ts:3: Swallowed error'],
  });
  for (const expected of [
    '# Brief: implementer · APP-42 · Add the version endpoint',
    '- Mode: in-place · work tree `/p/app`: run git as `git -C app …`, exactly in this form, from the project root (the Bash cwd stays there; never `cd`); use absolute paths for files.',
    '## Ticket (snapshot 2026-10-19T10:00:00.000Z)',
    '| api | packages/api | backend | test, lint |',
    '- CORE-SECRETS — No secrets in code (blocking, protected); full text: cw rules show CORE-SECRETS',
    '### express-route (pack:express) — New route',
    '1. Register it in createApp().',
    '## Guardrails for complexity M',
    '## Review findings to fix',
    'Your final message is exactly the JSON fence `cw report save --task APP-42__feature__version-endpoint` prints.',
  ]) assert.ok(brief.includes(expected), expected);
  assert.ok(!brief.includes('\n\n\n'));
  const spacedConfig = { ...config, workspace: { mode: 'in-place', appRoot: 'my app' } };
  const spaced = renderBrief({ ws: { ...inPlace, workRepo: '/p/my app', config: spacedConfig }, task: { ...task, workTree: '/p/my app' }, role: 'implementer', specText: 'x', decision: 'Fix F1 only.' });
  assert.ok(spaced.includes("run git as `git -C 'my app' …`"), 'an appRoot with a space is quoted');
  assert.ok(spaced.includes("## The user's decision after the escalation\n\nFix F1 only."));
  assert.match(returnMessage(task, { findings: [] }, '/b.md', { decision: 'Fix F1 only.' }), /^The user decided after the escalation: Fix F1 only\.\nReview round 1/);
  const linear = { key: 'APP-42', summary: 'Version endpoint', url: 'https://linear.app/acme/issue/APP-42', source: 'linear', context: 'docs/specs/APP-42.md', savedAt: '2026-10-23T10:00:00.000Z' };
  const withContext = renderBrief({ ws: { ...inPlace, configRoot: '/p' }, task, role: 'implementer', specText: 'x', ticket: linear });
  assert.ok(withContext.includes('APP-42: Version endpoint (https://linear.app/acme/issue/APP-42)\n\nTechnical context (read-only; read it with the spec): /p/docs/specs/APP-42.md'), withContext);
  const local = { key: 'APP-42', summary: 'Version endpoint', source: 'local', path: 'docs/specs/APP-42.md', savedAt: '2026-10-23T10:00:00.000Z' };
  assert.ok(renderBrief({ ws: { ...worktree, configRoot: '/p' }, task, role: 'reviewer', specText: 'x', ticket: local }).includes('Ticket file (read-only): /p/docs/specs/APP-42.md'));
  const reviewer = renderBrief({ ws: worktree, task, role: 'reviewer', specText: 'spec', reportPath: '/s/report-2.json', previousReviewPath: '/s/review-1.json' });
  assert.ok(reviewer.includes('- Your previous review: /s/review-1.json'));
  assert.ok(!reviewer.includes('Guardrails'));
  assert.ok(reviewer.includes(`- Mode: worktree · the implementer's worktree: read its history with \`cw review diff|log|status --task ${task.id}\`, never with git; never \`cd\`. Read its files by absolute path.`), reviewer);
  const inPlaceReviewer = renderBrief({ ws: inPlace, task, role: 'reviewer', specText: 'spec' });
  assert.ok(inPlaceReviewer.includes(`- Mode: in-place · work tree \`/p/app\`: read its history with \`cw review diff|log|status --task ${task.id}\`; never \`cd\`.`), inPlaceReviewer);
  assert.ok(!reviewer.includes('`/p/app`'), 'the absolute worktree path is no git form');
  assert.ok(reviewer.includes('- Work tree to review, read-only (absolute, for the Read tool): /p/app'), reviewer);
  assert.ok(renderBrief({ ws: worktree, task, role: 'implementer', specText: 'spec' }).includes('no `git -C`'));
});

test('a takeover brief lists the branch state and the handover, capped, and never a diff (ADR 0012)', () => {
  const files = Array.from({ length: 83 }, (_, i) => `src/file-${String(i).padStart(2, '0')}.ts`);
  const commits = Array.from({ length: 22 }, (_, i) => ({ sha: `${String(i).padStart(2, '0')}${'f'.repeat(38)}`, subject: `[FEATURE] Step ${i}` }));
  const handover = { decisions: ['The version comes from package.json at build time'], rejected: [], testing: ['npm test -- version'], pitfalls: ['The route list is cached'], deviations: ['No ETag: CORE-HTTP-CACHE does not apply here'] };
  const report = { round: 1, data: { status: 'done', handover, risks: ['Deploy order'], openPoints: [{ text: 'Check the header', tag: 'manual' }] } };
  const brief = renderBrief({ ws: inPlace, task, role: 'implementer', specText: '## Task: x', takeover: { report, branch: { head: 'beef'.repeat(10), commits, files } }, findings: ['- [blocking · CORE-ERRORS] src/a.ts:3: Swallowed error'] });
  for (const part of [
    '## Taking over from an earlier implementer', 'You take APP-42/feature/version-endpoint over from an earlier implementer',
    '- Head `beefbeefbe` · 22 commit(s) since the base `abc123`, newest first:', '  - `00ffffffff` [FEATURE] Step 0', '  - … and 2 older commit(s)',
    '- Changed files since the base (83):', '  - src/file-79.ts', '  - … and 3 more',
    '### Handover from the report of round 1 (done)', 'Decisions and why:', 'Test commands and setups:', 'Pitfalls:', '- No ETag: CORE-HTTP-CACHE does not apply here',
    'Risks:\n- Deploy order', '- (manual) Check the header',
  ]) assert.ok(brief.includes(part), part);
  assert.ok(!brief.includes('src/file-80.ts') && !brief.includes('Step 20'), 'the lists are capped');
  assert.ok(!brief.includes('Rejected approaches:'), 'an empty list is left out');
  assert.ok(brief.indexOf('## Taking over') < brief.indexOf('## Review findings to fix'));
  assert.ok(!renderBrief({ ws: inPlace, task, role: 'implementer', specText: '' }).includes('## Taking over'), 'only a fresh implementer gets it');
  const old = renderBrief({ ws: inPlace, task, role: 'implementer', specText: '', takeover: { report: { round: 1, data: { status: 'blocked' } }, branch: null } });
  assert.ok(old.includes('That report has no handover.') && !old.includes('### Branch state'));
});
