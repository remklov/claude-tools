import assert from 'node:assert/strict';
import { test } from 'node:test';

import { abbreviationsIn, booleanNames, declaredNames, hintLines, parseDiff, ruleHints, wordsOf } from '../../cli/lib/hints.mjs';
import { gitIn, makeInPlace, write } from '../fixtures/repo.mjs';

// In-process git calls use process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const ALLOWED = new Set(['id', 'url', 'api', 'req', 'res', 'next', 'err', 'props', 'ref', 'dte']);

test('parseDiff: the added lines with their numbers and the removed lines per hunk', () => {
  const files = parseDiff([
    'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts',
    '@@ -3 +3 @@', '-const total=a+b;', '+const total = a + b;',
    '@@ -10,0 +11,2 @@', '+const tx = 1;', '+\\ No newline at end of file',
    'diff --git a/gone.ts b/gone.ts', '--- a/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-x',
  ].join('\n'));
  assert.deepEqual(files, [{ file: 'src/a.ts', hunks: [
    { start: 3, removed: ['const total=a+b;'], added: [{ line: 3, text: 'const total = a + b;' }] },
    { start: 11, removed: [], added: [{ line: 11, text: 'const tx = 1;' }, { line: 12, text: '\\ No newline at end of file' }] },
  ] }]);
});

test('names: declarations, parameters and the abbreviations reviewers returned rounds for', () => {
  assert.deepEqual(wordsOf('billingLaunchPending'), ['billing', 'launch', 'pending']);
  assert.deepEqual(wordsOf('HTTPServer_pow10'), ['http', 'server', 'pow']);
  assert.deepEqual(declaredNames('await db.transaction(async (tx) => {'), ['tx']);
  assert.deepEqual(declaredNames('export function applyFacts(facts: Fact[], { source }: Opts, ...rest) {'), ['applyFacts', 'facts', 'rest']);
  assert.deepEqual(declaredNames('const items = list.map((i) => i.id); } catch (e) {'), ['items', 'i', 'e']);
  assert.deepEqual(abbreviationsIn('tx', ALLOWED), ['tx']);
  assert.deepEqual(abbreviationsIn('pow10', ALLOWED), ['pow']);
  assert.deepEqual(abbreviationsIn('e', ALLOWED), ['e']);
  assert.deepEqual(abbreviationsIn('i', ALLOWED), [], 'a loop index');
  assert.deepEqual(abbreviationsIn('dteCfg', ALLOWED), ['cfg'], 'the allowed list counts');
  assert.deepEqual(abbreviationsIn('htmlBody', ALLOWED), [], 'a usual acronym');
  assert.deepEqual(abbreviationsIn('retainedAccessError', ALLOWED), []);
});

test('booleans: typed, assigned or compared, without is, has, can or should', () => {
  assert.deepEqual(booleanNames('const billingEnabled = config.billing === "on";'), ['billingEnabled']);
  assert.deepEqual(booleanNames('  launchPending: boolean;'), ['launchPending']);
  assert.deepEqual(booleanNames('let expired = !membership.active;'), ['expired']);
  assert.deepEqual(booleanNames('const isExpired = false;'), []);
  assert.deepEqual(booleanNames('const total = a > b ? a : b;'), [], 'a ternary is no boolean');
  assert.deepEqual(booleanNames('const IS_PROD = env === "production";'), []);
});

test('ruleHints: a whitespace-only hunk, an abbreviation, a boolean and a helper with few references', (t) => {
  const fx = makeInPlace(t);
  const git = gitIn(fx.app, fx.env);
  write(fx.app, { 'src/billing.ts': 'export function total(a, b) {\n  return a+b;\n}\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  write(fx.app, {
    'src/billing.ts': [
      'export function total(a, b) {',
      '  return a+b;  ',
      '}',
      'function retainedAccessError(code) {',
      '  return new Error(code);',
      '}',
      'export const first = () => retainedAccessError("A");',
      'export const second = () => retainedAccessError("B");',
      'export const run = (db) => db.transaction(async (tx) => tx.commit());',
      'export const billingEnabled = process.env.BILLING === "on";',
      '',
    ].join('\n'),
    'src/new.ts': 'export const isNew = true;\n',
  });
  const hints = ruleHints({ workTree: fx.app, base, rules: ['CORE-SCOPE', 'CORE-NAMING', 'CORE-SIMPLICITY'], allowed: [...ALLOWED] });
  assert.deepEqual(hints.map((hint) => `${hint.rule} ${hint.file}:${hint.line}`), [
    'CORE-SCOPE src/billing.ts:2',
    'CORE-SIMPLICITY src/billing.ts:4',
    'CORE-NAMING src/billing.ts:9',
    'CORE-NAMING src/billing.ts:9',
    'CORE-NAMING src/billing.ts:10',
  ]);
  assert.match(hints[0].text, /^this line changes only whitespace/);
  assert.equal(hints[1].text, 'retainedAccessError has 2 references: a helper needs three call sites, otherwise inline it');
  assert.deepEqual([hints[2].text, hints[3].text], ['db: db is not an allowed abbreviation', 'tx: tx is not an allowed abbreviation']);
  assert.equal(hints[4].text, 'billingEnabled is a boolean without is, has, can or should');
  assert.deepEqual(ruleHints({ workTree: fx.app, base, rules: ['CORE-NAMING'], allowed: [...ALLOWED, 'tx', 'db'] }).map((hint) => hint.line), [10], 'only the rules that apply, with the allowed list');
  assert.deepEqual(ruleHints({ workTree: fx.app, base, rules: ['CORE-TEST-SPEC'] }), []);
  assert.match(hintLines(hints)[0], /^ {2}CORE-SCOPE src\/billing\.ts:2: this line changes only whitespace/);
});
