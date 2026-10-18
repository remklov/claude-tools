import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessage, lintMessage, wrapText } from '../../scripts/lib/commit.mjs';
import { withDefaults } from '../../scripts/lib/profile.mjs';
import { lintSpec, parseSpec } from '../../scripts/lib/spec.mjs';
import { PROFILE } from '../helpers/repo.mjs';

const fisko = withDefaults(PROFILE, null);
const keyworded = withDefaults({
  ...PROFILE,
  git: { ...PROFILE.git, branch: '{ticket}/{type}/{slug}', branchTypes: ['feature', 'bugfix', 'hotfix'], commitSummary: '{keyword} {summary}', keywords: ['[FEATURE]', '[BUGFIX]', '[TASK]', '[DOCS]'], flags: ['[!!!]', '[SECURITY]'], commitTrailers: ['Relates to {ticket}'] },
}, null);

test('messages follow the profile: ticket suffix style', () => {
  assert.equal(buildMessage(fisko, { ticket: 'NV-9', summary: 'Fix the CRE totalIva' }), 'Fix the CRE totalIva (NV-9)\n');
  assert.equal(buildMessage(fisko, { ticket: 'NO-TICKET', summary: 'Tidy the README' }), 'Tidy the README\n');
  assert.deepEqual(lintMessage(fisko, 'Fix the CRE totalIva (NV-9)', { ticket: 'NV-9' }), []);
  assert.ok(lintMessage(fisko, 'Fix the CRE totalIva', { ticket: 'NV-9' }).length);
});

test('messages follow the profile: keyword, flag and trailer style', () => {
  const message = buildMessage(keyworded, { ticket: 'MM-42', summary: 'Add the version endpoint', keyword: '[FEATURE]', flag: '[!!!]', body: 'Why it matters.' });
  assert.equal(message, '[!!!] [FEATURE] Add the version endpoint\n\nWhy it matters.\n\nRelates to MM-42\n');
  assert.deepEqual(lintMessage(keyworded, message, { ticket: 'MM-42' }), []);
  assert.ok(lintMessage(keyworded, 'Add the version endpoint\n\nRelates to MM-42', { ticket: 'MM-42' }).some((p) => /does not match/.test(p)));
});

test('body wrapping keeps lists, URLs and code', () => {
  const text = wrapText('- a long bullet point that goes on and on and on beyond the limit of seventy-two characters for sure\nhttps://example.com/a/very/long/url/that/should/not/be/wrapped/at/all/because/links\n```\nconst x = "a very long line of code that is not wrapped either, no matter how long it gets";\n```', 72);
  const lines = text.split('\n');
  assert.ok(lines[1].startsWith('  '));
  assert.ok(lines.some((line) => line.startsWith('https://') && line.length > 72));
  assert.ok(lines.some((line) => line.startsWith('const x') && line.length > 72));
});

test('spec lint catches placeholders, numbering and the unfixed-code wording', () => {
  const bad = '## Task: X\n**Ticket:** AB-1 · **Type:** feature · **Complexity:** <s|m|l|xl>\n**Branch:** ab-1-x-y\n\n### Context\n<why; …>\n\n### Requirements\n- R2 thing\n\n### Acceptance criteria\n- [ ] AC1 every test fails on the unfixed code\n\n### Non-goals\n- none\n\n### Definition of done\n- ok\n';
  const { errors } = lintSpec(bad, { profile: fisko });
  assert.ok(errors.some((e) => /numbering/.test(e)));
  assert.ok(errors.some((e) => /unfixed code/.test(e)));
  assert.ok(errors.some((e) => /placeholder/.test(e)));
  assert.deepEqual(parseSpec(bad).acceptance.map((ac) => ac.id), ['AC1']);
});
