import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { findContext } from '../../scripts/lib/ctx.mjs';
import { resolvePacks } from '../../scripts/lib/packs.mjs';
import { loadProfile, withDefaults } from '../../scripts/lib/profile.mjs';
import { applicableRules, buildRulebook, diffRulebook, findRules, parseRuleFile, writeRulebook } from '../../scripts/lib/rules.mjs';
import { makeProject, PROFILE } from '../helpers/repo.mjs';

const load = (root, profile) => {
  const ctx = findContext(root);
  const p = profile ? withDefaults(profile, ctx) : loadProfile(ctx);
  return { ctx, profile: p, packs: resolvePacks(ctx, p, { quiet: true }) };
};

test('rule files parse with meta, scope and aliases', () => {
  const rules = parseRuleFile('## A-B — Title\n<!-- rule: severity=advisory; scope=paths:x/**|y/**; protected=true; aliases=CQ-1 -->\nBody\n\n## C-D - Other\n<!-- rule: scope=all -->\nMore', 'src');
  assert.equal(rules.length, 2);
  assert.deepEqual([rules[0].severity, rules[0].scope, rules[0].protected, rules[0].aliases], ['advisory', 'paths:x/**|y/**', true, ['CQ-1']]);
  assert.equal(rules[1].body, 'More');
});

test('a missing meta line is an error', () => {
  assert.throws(() => parseRuleFile('## A-B — Title\nBody', 'src'), /no "<!-- rule/);
});

test('layering, variants, options, project rules, extend and aliases', () => {
  const { root } = makeProject();
  const s = load(root);
  const book = buildRulebook(s.ctx, s.profile, s.packs);
  const ids = book.rules.map((rule) => rule.id);
  for (const id of ['CORE-SCOPE', 'NPM-DEPS', 'VITEST-NO-FOCUS', 'SQL-MIGRATION-COMPAT', 'SQL-MIGRATION-NUMBERING', 'GHA-PIN', 'MINI-MONEY']) assert.ok(ids.includes(id), id);
  assert.match(findRules(book, 'CORE-NAMING')[0].body, /Project addition:\*\* Domain terms/);
  assert.match(findRules(book, 'SQL-NO-SCHEMA-PUSH')[0].body, /api\/migrations/);
  assert.deepEqual(findRules(book, 'SQL-MIGRATION-COMPAT')[0].globs, ['api/migrations/**']);
  assert.deepEqual(findRules(book, 'cq-27').map((rule) => rule.id).sort(), ['SQL-MIGRATION-COMPAT', 'SQL-MIGRATION-NUMBERING']);
  const area = book.outputs.find((output) => output.file === 'area-backend-data.md') ?? book.outputs.find((output) => output.file.startsWith('area-backend'));
  assert.ok(area.content.startsWith('---\npaths:\n  - "api/**"'));
});

test('disabling a protected rule needs allowProtected', () => {
  const { root } = makeProject();
  const ctx = findContext(root);
  const profile = withDefaults({ ...PROFILE, rules: { ...PROFILE.rules, disable: [{ id: 'CORE-SECRETS', reason: 'x' }] } }, ctx);
  assert.throws(() => buildRulebook(ctx, profile, resolvePacks(ctx, profile, { quiet: true })), /protected/);
});

test('unknown IDs in customizations and duplicate IDs fail', () => {
  const { root } = makeProject();
  const ctx = findContext(root);
  const profile = withDefaults({ ...PROFILE, rules: { ...PROFILE.rules, extend: { 'NOPE-RULE': 'x' } } }, ctx);
  assert.throws(() => buildRulebook(ctx, profile, resolvePacks(ctx, profile, { quiet: true })), /unknown rule NOPE-RULE/);
  writeFileSync(join(root, '.claude/workflow/rules/project.md'), '## CORE-SCOPE — Again\n<!-- rule: scope=all -->\nx\n');
  const s = load(root);
  assert.throws(() => buildRulebook(s.ctx, s.profile, s.packs), /Duplicate rule ID CORE-SCOPE/);
});

test('build writes files and a lock; check detects hand edits', () => {
  const { root } = makeProject();
  const s = load(root);
  const book = buildRulebook(s.ctx, s.profile, s.packs);
  const text = readFileSync(s.ctx.profilePath, 'utf8');
  writeRulebook(s.ctx, book, text);
  assert.equal(diffRulebook(s.ctx, book, text).isCurrent, true);
  const file = join(root, '.claude/rules/workflow/00-global.md');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nedited\n`);
  assert.equal(diffRulebook(s.ctx, book, text).isCurrent, false);
});

test('applicable rules follow the changed paths', () => {
  const { root } = makeProject();
  const s = load(root);
  const book = buildRulebook(s.ctx, s.profile, s.packs);
  const backend = applicableRules(book, ['api/sum.mjs']).map((rule) => rule.id);
  const frontend = applicableRules(book, ['app/view.mjs']).map((rule) => rule.id);
  assert.ok(backend.includes('MINI-MONEY') && !frontend.includes('MINI-MONEY'));
  assert.ok(frontend.includes('CORE-SCOPE'));
  assert.ok(applicableRules(book, ['api/migrations/002_x.sql']).some((rule) => rule.id === 'SQL-MIGRATION-COMPAT'));
});
