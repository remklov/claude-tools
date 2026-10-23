import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { withDefaults } from '../../cli/lib/config.mjs';
import {
  LOCK_FILE, MARKER, OUT_DIR, applicableRules, buildRulebook, checkRulebook, findRule, parseRuleFile, ruleIdPrefixes, writeRulebook,
} from '../../cli/lib/rules.mjs';
import { pluginVersion } from '../../cli/lib/paths.mjs';
import { createTask, newTask } from '../../cli/lib/task.mjs';
import { loadWorkspace } from '../../cli/lib/workspace.mjs';
import { addAgentWorktree, cw, gitIn, inPlaceConfig, makeInPlace, makeWorktreeRepo, pluginRoot, tempBase, worktreeConfig, write } from '../fixtures/repo.mjs';

// In-process lib calls spawn git with process.env: keep them away from the developer's git config.
Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

const MM_PACKS = [
  'node-npm',
  { id: 'typescript', options: { moduleResolution: 'nodenext' } },
  { id: 'express', variant: '5', options: { appEntry: 'createApp()' } },
  { id: 'react-vite', variant: 'react-19', options: { vitestGlobals: false } },
  'vitest',
];
const MM_PROJECT = { name: 'Fixture', language: { repo: 'en', productCopy: 'de' } };
const MM_PACKAGES = [{ id: 'app', path: '.', areas: ['frontend', 'backend'], checks: { test: 'node --test' } }];

const wsAt = (configRoot, overrides = {}) => ({
  configRoot,
  config: withDefaults({ version: 1, project: MM_PROJECT, workspace: { mode: 'worktree' }, packs: MM_PACKS, packages: MM_PACKAGES, ...overrides }),
});
const build = (root, overrides) => buildRulebook(wsAt(root, overrides));
const ids = (rules) => rules.map((rule) => rule.id);
const failureOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('expected an error');
};
const output = (book, file) => book.outputs.find((item) => item.file === file)?.content;

const GLOBAL_CORE = [
  'CORE-SCOPE', 'CORE-SIMPLICITY', 'CORE-NAMING', 'CORE-STRUCTURE', 'CORE-COMMENTS', 'CORE-ERRORS', 'CORE-TEST-SPEC', 'CORE-TEST-BEHAVIOUR',
  'CORE-TEST-DETERMINISTIC', 'CORE-TEST-HONEST', 'CORE-DEPENDENCIES', 'CORE-LANGUAGE', 'CORE-SECRETS', 'CORE-INJECTION', 'CORE-LOGGING',
];

// ---- parsing ----

test('parseRuleFile reads headings, meta defaults, when and bodies', () => {
  const text = [
    '---', 'pack: x', '---', 'Intro text is ignored.', '',
    '## AB-ONE — First rule', '<!-- rule: severity=advisory; scope=areas:backend,data; protected=true -->', 'Body one.', '', 'More.', '',
    '## AB-TWO - Second', '<!-- rule: when=option:moduleResolution=nodenext -->', 'Body two.', '',
    '## AB-THREE — Third', '<!-- rule: scope=paths:**/*.{ts,tsx}|src/**; when=option:strict -->', 'Body three.',
  ].join('\n');
  const rules = parseRuleFile(text, 'x.md');
  assert.deepEqual(rules.map(({ id, title, severity, scope, protected: isProtected, when, body, line }) => ({ id, title, severity, scope, isProtected, when, body, line })), [
    { id: 'AB-ONE', title: 'First rule', severity: 'advisory', scope: 'areas:backend,data', isProtected: true, when: null, body: 'Body one.\n\nMore.', line: 6 },
    { id: 'AB-TWO', title: 'Second', severity: 'blocking', scope: 'all', isProtected: false, when: { option: 'moduleResolution', value: 'nodenext' }, body: 'Body two.', line: 12 },
    { id: 'AB-THREE', title: 'Third', severity: 'blocking', scope: 'paths:**/*.{ts,tsx}|src/**', isProtected: false, when: { option: 'strict', value: null }, body: 'Body three.', line: 16 },
  ]);
  assert.deepEqual(parseRuleFile(text.replace(/\n/g, '\r\n'), 'x.md'), rules);
});

test('parseRuleFile names file:line and the fix for each grammar error', () => {
  const cases = [
    ['## AB-X — T\nBody\n', /x\.md:1: rule AB-X has no "<!-- rule: … -->" line under its heading\. Add one, e\.g\. <!-- rule: severity=blocking; scope=all -->/],
    ['## AB-X — T\n<!-- rule: severity=blokcing -->\nBody\n', /x\.md:2: severity must be blocking or advisory \(got "blokcing"\)/],
    ['## AB-X — T\n<!-- rule: aliases=CQ-1 -->\nBody\n', /x\.md:2: unknown meta key "aliases" \(allowed: severity, scope, protected, when\)/],
    ['## AB-X — T\n<!-- rule: scope=bogus -->\nBody\n', /x\.md:2: scope must be all, areas:<a,b> or paths:<glob\|glob> \(got "bogus"\)/],
    ['## AB-X — T\n<!-- rule: protected=yes -->\nBody\n', /protected must be true or false/],
    ['## AB-X — T\n<!-- rule: when=sometimes -->\nBody\n', /when must be option:<name> or option:<name>=<value>/],
    ['## AB-X — T\n<!-- rule: scope=all -->\nBody\n\n## Not a rule\ntext\n', /x\.md:5: "## Not a rule" is not a rule heading\. Use "## RULE-ID — Title" or remove the line/],
    ['## AB-X — T\n<!-- rule: scope=all -->\n\n## AB-Y — U\n<!-- rule: scope=all -->\nBody\n', /x\.md:1: rule AB-X has an empty body/],
    ['## AB-X — T\n<!-- rule: scope=all -->\nA\n## AB-X — T\n<!-- rule: scope=all -->\nB\n', /x\.md:4: rule AB-X appears twice in this file/],
  ];
  for (const [text, pattern] of cases) {
    const error = failureOf(() => parseRuleFile(text, 'x.md'));
    assert.equal(error.exitCode, 1);
    assert.match(error.message, pattern);
  }
  const several = failureOf(() => parseRuleFile('## AB-X — T\n<!-- rule: severity=no; scope=no -->\nBody\n', 'x.md'));
  assert.equal(several.details.problems.length, 2);
});

// ---- layering ----

test('layering: core first, requires before dependents, a variant redefines in place', (t) => {
  const root = tempBase(t);
  const book = build(root, { packs: ['vitest', 'core'] });
  assert.deepEqual(ids(book.rules).slice(0, 16).every((id) => id.startsWith('CORE-')), true);
  assert.deepEqual(ids(book.rules).slice(16), ['VITEST-NO-FOCUS', 'VITEST-TIMERS']);

  const rule = (id, body) => `## ${id} — ${id}\n<!-- rule: scope=all -->\n${body}\n`;
  write(root, {
    '.claude/dev-workflow/packs/lib-a/pack.json': { id: 'lib-a', version: '0.1.0', title: 'A', requires: ['lib-b'], rules: 'rules.md' },
    '.claude/dev-workflow/packs/lib-a/rules.md': rule('LIBA-ONE', 'a'),
    '.claude/dev-workflow/packs/lib-b/pack.json': { id: 'lib-b', version: '0.1.0', title: 'B', rules: 'rules.md' },
    '.claude/dev-workflow/packs/lib-b/rules.md': rule('LIBB-ONE', 'b'),
    '.claude/dev-workflow/packs/varied/pack.json': {
      id: 'varied', version: '0.1.0', title: 'V', rules: 'rules.md', variants: { x: { description: 'X', rules: 'rules.x.md' } }, defaultVariant: 'x',
    },
    '.claude/dev-workflow/packs/varied/rules.md': `${rule('VAR-ONE', 'base one')}\n${rule('VAR-TWO', 'base two')}`,
    '.claude/dev-workflow/packs/varied/rules.x.md': rule('VAR-ONE', 'variant one'),
  });
  const layered = build(root, { packs: ['lib-a', 'varied'] });
  assert.deepEqual(ids(layered.rules).slice(16), ['LIBB-ONE', 'LIBA-ONE', 'VAR-ONE', 'VAR-TWO']);
  const varOne = layered.rules.find((item) => item.id === 'VAR-ONE');
  assert.equal(varOne.body, 'variant one');
  assert.equal(varOne.source, 'varied@x');
  assert.match(layered.warnings.join('\n'), /pack lib-b added because lib-a requires it/);
});

test('duplicate IDs across packs and between a pack and the project fail, naming both files', (t) => {
  const root = tempBase(t);
  write(root, {
    '.claude/dev-workflow/packs/twin/pack.json': { id: 'twin', version: '0.1.0', title: 'T', rules: 'rules.md' },
    '.claude/dev-workflow/packs/twin/rules.md': '## VITEST-TIMERS — Again\n<!-- rule: scope=all -->\nx\n',
    '.claude/dev-workflow/rules/project.md': 'Project rules.\n\n## CORE-SCOPE — Mine\n<!-- rule: scope=all -->\nx\n',
  });
  const error = failureOf(() => build(root, { packs: ['vitest', 'twin'] }));
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /Duplicate rule ID VITEST-TIMERS in vitest\/rules\.md:5 and \.claude\/dev-workflow\/packs\/twin\/rules\.md:1\. Rename the project rule/);
  assert.match(error.message, /Duplicate rule ID CORE-SCOPE in core\/rules\.md:1 and \.claude\/dev-workflow\/rules\/project\.md:3/);
});

// ---- placeholders and conditions ----

test('placeholders resolve from pack options, rule options and the project, also in extend and override', (t) => {
  const root = tempBase(t);
  write(root, {
    '.claude/dev-workflow/rules/limits.md': '## PRJ-LIMIT — Limit\n<!-- rule: scope=all -->\nAt most {ruleOptions.max} items in {project.name}.\n',
    'overrides/supertest.md': 'Use supertest on `{options.appEntry}` only.\n',
  });
  const book = build(root, {
    rules: {
      options: { 'PRJ-LIMIT': { max: 3 } },
      extend: { 'CORE-LANGUAGE': 'Copy reviews happen in {project.language.productCopy}.' },
      override: { 'EXPRESS-SUPERTEST': { file: 'overrides/supertest.md' } },
    },
  });
  const body = (id) => book.rules.find((rule) => rule.id === id).body;
  assert.match(body('CORE-NAMING'), /repository language \(`en`\)\. Allowed abbreviations: id, url, api, req, res, next, err, props, ref, and/);
  assert.match(body('CORE-LANGUAGE'), /language \(`en`\).*product language \(`de`\)/s);
  assert.match(body('CORE-LANGUAGE'), /\*\*Project addition:\*\* Copy reviews happen in de\.$/);
  assert.equal(body('PRJ-LIMIT'), 'At most 3 items in Fixture.');
  assert.equal(body('EXPRESS-SUPERTEST'), 'Use supertest on `createApp()` only.');
  assert.match(body('EXPRESS-RESPONSE-FLOW'), /'\/items\{\/:id\}'/);
  assert.match(body('EXPRESS-ERROR-RESPONSES'), /shape `\{ "error": "<message>" \}`/);

  const missing = failureOf(() => build(root, {}));
  assert.match(missing.message, /project\/PRJ-LIMIT: unresolved placeholder \{ruleOptions\.max\}\. Set rules\.options\.PRJ-LIMIT\.max in \.claude\/dev-workflow\/config\.json/);
  write(root, { '.claude/dev-workflow/rules/limits.md': '## PRJ-LIMIT — Limit\n<!-- rule: scope=all -->\nUse {options.x}.\n' });
  const packOption = failureOf(() => build(root, {}));
  assert.match(packOption.message, /PRJ-LIMIT: project rules have no pack options; replace \{options\.x\} with \{ruleOptions\.x\}/);
});

test('placeholders: a name with other characters is a build error, not left in the output', (t) => {
  const root = tempBase(t);
  write(root, { '.claude/dev-workflow/rules/limits.md': '## PRJ-LIMIT — Limit\n<!-- rule: scope=all -->\nAt most {ruleOptions.max-items} items; owner {project.owner-team}.\n' });
  const error = failureOf(() => build(root, { rules: { options: { 'PRJ-LIMIT': { 'max-items': 3 } } } }));
  assert.equal(error.exitCode, 1);
  for (const token of ['{ruleOptions.max-items}', '{project.owner-team}']) {
    const escaped = token.replace(/[{}.]/g, '\\$&');
    assert.match(error.message, new RegExp(`project/PRJ-LIMIT: invalid placeholder ${escaped}: the names after the dot may use only letters, digits and _\\. Correct it`));
  }
  // An option can be renamed; a {project.…} name can only be one of the project placeholders.
  assert.match(error.message, /\{ruleOptions\.max-items\}: .*, and rename the option it refers to if there is one \(e\.g\. max-items to max_items\)$/m);
  assert.match(error.message, /\{project\.owner-team\}: .*\. Correct it to one of the project placeholders: \{project\.name\}, \{project\.language\.repo\}, \{project\.language\.productCopy\}$/m);
  assert.equal(error.details.problems.length, 2);
});

test('placeholders: an unknown {project.…} path names the existing ones instead of a config key the schema rejects', (t) => {
  const root = tempBase(t);
  write(root, { '.claude/dev-workflow/rules/copy.md': '## PRJ-COPY — Copy\n<!-- rule: scope=all -->\nWrite copy in {project.language.productcopy}.\n' });
  const error = failureOf(() => build(root));
  assert.match(error.message, /project\/PRJ-COPY: unresolved placeholder \{project\.language\.productcopy\}\. The project placeholders are \{project\.name\}, \{project\.language\.repo\}, \{project\.language\.productCopy\}; correct the rule text/);
  assert.doesNotMatch(error.message, /Set project\./);
});

test('when=option rules: inactive with a reason, case-insensitive values, errors for unknown options', (t) => {
  const root = tempBase(t);
  const byDefault = build(root, { packs: ['typescript', { id: 'react-vite', options: { vitestGlobals: true } }] });
  assert.deepEqual(byDefault.inactive, [
    { id: 'TS-ESM-IMPORTS', reason: 'option moduleResolution is bundler (needs nodenext)' },
    { id: 'RTL-CLEANUP', reason: 'option vitestGlobals is true (needs false)' },
  ]);
  assert.ok(!ids(byDefault.rules).includes('TS-ESM-IMPORTS'));
  for (const value of ['nodenext', 'NodeNext']) {
    assert.ok(ids(build(root, { packs: [{ id: 'typescript', options: { moduleResolution: value } }] }).rules).includes('TS-ESM-IMPORTS'), value);
  }
  const extended = build(root, { packs: ['typescript'], rules: { extend: { 'TS-ESM-IMPORTS': 'x' } } });
  assert.match(extended.warnings.join('\n'), /rules\.extend\.TS-ESM-IMPORTS has no effect: TS-ESM-IMPORTS is inactive/);

  write(root, {
    '.claude/dev-workflow/packs/cond/pack.json': { id: 'cond', version: '0.1.0', title: 'C', rules: 'rules.md' },
    '.claude/dev-workflow/packs/cond/rules.md': '## COND-X — X\n<!-- rule: when=option:nope -->\nx\n',
    '.claude/dev-workflow/rules/p.md': '## PRJ-W — W\n<!-- rule: when=option:strict -->\nx\n',
  });
  const error = failureOf(() => build(root, { packs: ['cond'] }));
  assert.match(error.message, /\.claude\/dev-workflow\/packs\/cond\/rules\.md:1: when=option:nope is not an option of pack cond \(options: none\)/);
  assert.match(error.message, /PRJ-W: project rules have no pack options, so when=option:strict cannot apply/);
});

// ---- customizations ----

test('customizations: add, override with and without heading, extend, disable', (t) => {
  const root = tempBase(t);
  write(root, {
    'extra/more.md': '## PRJ-EXTRA — Extra\n<!-- rule: severity=advisory -->\nExtra rule.\n',
    'overrides/naming.md': '## CORE-NAMING — Names\n<!-- rule: severity=advisory; scope=paths:src/** -->\nUse {project.language.repo} names.\n',
    'overrides/comments.md': 'Comments explain why.\n',
  });
  const book = build(root, {
    rules: {
      add: ['extra/more.md'],
      override: { 'CORE-NAMING': { file: 'overrides/naming.md' }, 'CORE-COMMENTS': { file: 'overrides/comments.md' } },
      extend: { 'CORE-SCOPE': 'Keep diffs small.', 'CORE-COMMENTS': 'Link the ADR.' },
      disable: [{ id: 'CORE-STRUCTURE', reason: 'legacy code base' }],
    },
  });
  const rule = (id) => book.rules.find((item) => item.id === id);
  assert.equal(rule('PRJ-EXTRA').source, 'project');
  assert.deepEqual(
    (({ title, severity, scope, body, modified }) => ({ title, severity, scope, body, modified }))(rule('CORE-NAMING')),
    { title: 'Names', severity: 'advisory', scope: 'paths:src/**', body: 'Use en names.', modified: 'override' },
  );
  assert.equal(rule('CORE-COMMENTS').body, 'Comments explain why.\n\n**Project addition:** Link the ADR.');
  assert.equal(rule('CORE-COMMENTS').modified, 'override+extend');
  assert.match(rule('CORE-SCOPE').body, /\n\n\*\*Project addition:\*\* Keep diffs small\.$/);
  assert.equal(rule('CORE-SCOPE').modified, 'extend');
  assert.equal(rule('CORE-STRUCTURE'), undefined);
  assert.deepEqual(book.disabled, [{ id: 'CORE-STRUCTURE', reason: 'legacy code base' }]);
  assert.match(output(book, '00-global.md'), /## Disabled in this project\n\n- CORE-STRUCTURE: legacy code base\n$/);
  assert.equal(rule('CORE-NAMING').output, 'paths-core-1.md');
  assert.equal(rule('CORE-REPRODUCIBLE-BUILDS').output, 'paths-core-2.md');
});

test('unknown IDs in disable, extend, override and options come in one error', (t) => {
  const error = failureOf(() => build(tempBase(t), {
    rules: {
      disable: [{ id: 'NOPE-A', reason: 'x' }],
      extend: { 'NOPE-B': 'x' },
      override: { 'NOPE-C': { file: 'x.md' } },
      options: { 'NOPE-D': {} },
    },
  }));
  assert.equal(error.exitCode, 1);
  for (const [section, id] of [['disable', 'A'], ['extend', 'B'], ['override', 'C'], ['options', 'D']]) {
    assert.match(error.message, new RegExp(`rules\\.${section}: unknown rule NOPE-${id}\\. Check the ID with: cw rules list`));
  }
  assert.equal(error.details.problems.length, 4);
});

test('protected rules need allowProtected and a reason to be disabled or overridden', (t) => {
  const root = tempBase(t);
  write(root, { 'overrides/logging.md': '## CORE-LOGGING — Logging\n<!-- rule: protected=false -->\nNever log secrets.\n' });
  const disable = (reason, allowProtected) => () => build(root, { rules: { disable: [{ id: 'CORE-SECRETS', reason }], allowProtected } });
  assert.match(failureOf(disable('vault', false)).message, /rules\.disable: CORE-SECRETS is protected\. Set rules\.allowProtected to true and give a reason, or keep the rule/);
  assert.match(failureOf(disable('', true)).message, /rules\.disable: CORE-SECRETS needs a reason/);
  assert.match(failureOf(() => build(root, { rules: { disable: [{ id: 'REACT-NO-RAW-HTML', reason: 'x' }] } })).message, /REACT-NO-RAW-HTML is protected/);
  assert.match(failureOf(() => build(root, { rules: { disable: [{ id: 'VITE-ENV-SECRETS', reason: 'x' }] } })).message, /VITE-ENV-SECRETS is protected/);
  const disabled = disable('secrets live in the vault plugin', true)();
  assert.match(disabled.warnings.join('\n'), /protected rule CORE-SECRETS is disabled: secrets live in the vault plugin/);

  const override = (reason) => () => build(root, { rules: { override: { 'CORE-LOGGING': { file: 'overrides/logging.md', reason } }, allowProtected: true } });
  assert.match(failureOf(override(undefined)).message, /rules\.override: CORE-LOGGING is protected/);
  const overridden = override('shorter text')();
  const logging = overridden.rules.find((rule) => rule.id === 'CORE-LOGGING');
  assert.equal(logging.body, 'Never log secrets.');
  assert.equal(logging.protected, true, 'an override cannot drop the protection');
  assert.match(overridden.warnings.join('\n'), /protected rule CORE-LOGGING is overridden by overrides\/logging\.md: shorter text/);
});

// ---- scopes and outputs ----

test('scopes: area globs per package, inactive areas, appRoot prefixes and glob errors', (t) => {
  const root = tempBase(t);
  const single = build(root);
  assert.deepEqual(single.rules.find((rule) => rule.id === 'EXPRESS-SUPERTEST').globs, ['**/*']);
  const split = build(root, { packages: [{ id: 'api', path: 'api', areas: ['backend'] }, { id: 'web', path: 'web', areas: ['frontend'] }] });
  assert.deepEqual(split.rules.find((rule) => rule.id === 'EXPRESS-SUPERTEST').globs, ['api/**/*']);
  assert.deepEqual(split.rules.find((rule) => rule.id === 'REACT-A11Y').globs, ['web/**/*']);

  const frontendOnly = build(root, { packages: [{ id: 'web', path: 'web', areas: ['frontend'] }] });
  const expressIds = ['EXPRESS-ERROR-RESPONSES', 'EXPRESS-INPUT-VALIDATION', 'EXPRESS-SUPERTEST', 'EXPRESS-ASYNC-ERRORS', 'EXPRESS-RESPONSE-FLOW'];
  assert.deepEqual(frontendOnly.inactive.filter((item) => item.id.startsWith('EXPRESS-')), expressIds.map((id) => ({ id, reason: 'no package has area backend' })));
  assert.match(frontendOnly.warnings.join('\n'), /EXPRESS-SUPERTEST is inactive: no package has area backend/);

  const inPlace = build(root, { workspace: { mode: 'in-place', appRoot: 'app' } });
  const supertest = inPlace.rules.find((rule) => rule.id === 'EXPRESS-SUPERTEST');
  assert.deepEqual([supertest.globs, supertest.outputGlobs], [['**/*'], ['app/**/*']]);
  assert.match(output(inPlace, 'area-backend.md'), /^---\npaths:\n {2}- "app\/\*\*\/\*"\n---\n<!-- Generated by dev-workflow/);
  assert.match(output(inPlace, '00-global.md'), /^---\npaths:\n {2}- "app\/\*\*"\n---\n/);
  assert.match(output(inPlace, 'paths-vitest-1.md'), /- "app\/\*\*\/\*\.\{test,spec\}\./);
  assert.ok(output(single, '00-global.md').startsWith(`${MARKER}\n`));
  assert.match(output(single, 'area-backend.md'), /^---\npaths:\n {2}- "\*\*\/\*"\n---\n/);

  write(root, { '.claude/dev-workflow/rules/photos.md': '## PRJ-PHOTOS — Photos\n<!-- rule: scope=paths:photos [2024/** -->\nx\n' });
  // A rule scope ends up in the paths: of .claude/rules, so here the message says what Claude Code does.
  assert.match(failureOf(() => build(root)).message, /photos \[2024\/\*\* in PRJ-PHOTOS: unclosed "\[": escape a literal \[ as \\\[ \(Claude Code ignores such a pattern in the paths of \.claude\/rules\)$/m);
});

test('scopes: an escaped [ builds and matches; a class that does not compile is a build error, not a crash later', (t) => {
  const root = tempBase(t);
  write(root, { '.claude/dev-workflow/rules/photos.md': '## PRJ-PHOTOS — Photos\n<!-- rule: scope=paths:photos \\[2024\\]/**|app/\\[id\\]/** -->\nx\n' });
  const book = build(root);
  assert.deepEqual(book.rules.find((rule) => rule.id === 'PRJ-PHOTOS').globs, ['photos \\[2024\\]/**', 'app/\\[id\\]/**']);
  assert.ok(ids(applicableRules(book, { files: ['photos [2024]/a.jpg'] })).includes('PRJ-PHOTOS'));
  assert.ok(ids(applicableRules(book, { files: ['app/[id]/page.tsx'] })).includes('PRJ-PHOTOS'));
  assert.ok(!ids(applicableRules(book, { files: ['src/a.ts'] })).includes('PRJ-PHOTOS'));

  write(root, { '.claude/dev-workflow/rules/photos.md': '## PRJ-RANGE — Range\n<!-- rule: scope=paths:src/[z-a]*.ts -->\nx\n' });
  const error = failureOf(() => build(root));
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /src\/\[z-a\]\*\.ts in PRJ-RANGE: invalid \[ … \] class \(Range out of order in character class\)\. Correct the class, or escape a literal \[ as \\\[/);
});

test('scopes: ./ and a trailing / are normalized before the appRoot prefix', (t) => {
  const root = tempBase(t);
  write(root, { '.claude/dev-workflow/rules/dot.md': '## PRJ-DOT — Dot\n<!-- rule: scope=paths:./src/**|docs/ -->\nx\n' });
  const inPlace = build(root, { workspace: { mode: 'in-place', appRoot: 'app' } });
  const dot = inPlace.rules.find((rule) => rule.id === 'PRJ-DOT');
  assert.deepEqual([dot.globs, dot.outputGlobs], [['src/**', 'docs/**'], ['app/src/**', 'app/docs/**']]);
  assert.match(output(inPlace, dot.output), /^---\npaths:\n {2}- "app\/src\/\*\*"\n {2}- "app\/docs\/\*\*"\n---\n/);
  assert.deepEqual(build(root).rules.find((rule) => rule.id === 'PRJ-DOT').outputGlobs, ['src/**', 'docs/**']);
});

test('area output files: area names with hyphens never share a file, so a build is current right after it', (t) => {
  const root = tempBase(t);
  write(root, { '.claude/dev-workflow/rules/ui.md': '## PRJ-ONE — One\n<!-- rule: scope=areas:shared-ui -->\none\n## PRJ-TWO — Two\n<!-- rule: scope=areas:shared,ui -->\ntwo\n' });
  const packages = [{ id: 'a', path: 'pa', areas: ['shared-ui'] }, { id: 'b', path: 'pb', areas: ['shared', 'ui'] }];
  const ws = wsAt(root, { packs: [], packages });
  const book = buildRulebook(ws);
  const names = book.outputs.map((item) => item.file);
  assert.deepEqual(names, [...new Set(names)]);
  assert.deepEqual(book.rules.filter((rule) => rule.id.startsWith('PRJ-')).map((rule) => rule.output), ['area-shared-ui.md', 'area-shared+ui.md']);
  writeRulebook(ws, book);
  assert.match(readFileSync(join(root, OUT_DIR, 'area-shared-ui.md'), 'utf8'), /## PRJ-ONE/);
  assert.equal(checkRulebook(ws, buildRulebook(ws)).isCurrent, true);
});

test('a project pack that shadows a bundled pack keeps its protected rules', (t) => {
  const root = tempBase(t);
  const coreRules = readFileSync(join(pluginRoot, 'packs', 'core', 'rules.md'), 'utf8');
  const shadow = (rules) => write(root, {
    '.claude/dev-workflow/packs/core/pack.json': readFileSync(join(pluginRoot, 'packs', 'core', 'pack.json'), 'utf8'),
    '.claude/dev-workflow/packs/core/rules.md': rules,
  });
  const disableSecrets = (allowProtected) => () => build(root, { rules: { disable: [{ id: 'CORE-SECRETS', reason: 'vault' }], allowProtected } });

  shadow(coreRules.replaceAll('; protected=true', ''));
  const kept = build(root);
  assert.deepEqual(kept.rules.filter((rule) => rule.protected).map((rule) => rule.id).slice(0, 3), ['CORE-SECRETS', 'CORE-INJECTION', 'CORE-LOGGING']);
  assert.match(failureOf(disableSecrets(false)).message, /rules\.disable: CORE-SECRETS is protected\. Set rules\.allowProtected to true/);

  shadow(coreRules.replace(/## CORE-SECRETS[\s\S]*?(?=\n## )/, ''));
  const dropped = failureOf(() => build(root));
  assert.equal(dropped.exitCode, 1);
  assert.match(dropped.message, /project pack core \(\.claude\/dev-workflow\/packs\/core\) drops the protected rule CORE-SECRETS of the bundled pack core\. Keep CORE-SECRETS in the project pack, or set rules\.allowProtected to true/);
  const allowed = build(root, { rules: { allowProtected: true } });
  assert.ok(!ids(allowed.rules).includes('CORE-SECRETS'));
  assert.match(allowed.warnings.join('\n'), /project pack core .* drops the protected rule CORE-SECRETS/);
});

test('outputs: file set, marker, sources without versions, preamble, stable bytes', (t) => {
  const root = tempBase(t);
  const book = build(root);
  assert.equal(book.rules.length, 35);
  assert.deepEqual(book.outputs.map((item) => item.file), [
    '00-global.md', 'area-backend.md', 'area-frontend.md', 'paths-core-1.md', 'paths-node-npm-1.md', 'paths-node-npm-2.md',
    'paths-typescript-1.md', 'paths-typescript-2.md', 'paths-vitest-1.md',
  ]);
  for (const item of book.outputs) {
    assert.ok(item.content.includes(MARKER), item.file);
    assert.ok(item.content.includes('<!-- Sources: core, node-npm, typescript, express (5), react-vite (react-19), vitest -->'), item.file);
  }
  const global = output(book, '00-global.md');
  assert.match(global, /# dev-workflow rules: all files\n\nThese rules apply to every change in this project/);
  assert.match(global, /the spec wins over a rule, except for protected rules/);
  assert.match(global, /## CORE-SECRETS — Secrets · blocking · protected\n\nNever commit secrets/);
  assert.deepEqual(book.rules.filter((rule) => rule.output === 'paths-typescript-1.md').map((rule) => rule.id), ['TS-NO-ANY', 'TS-NO-CAST']);
  assert.match(output(book, 'paths-typescript-1.md'), /# dev-workflow rules: \*\*\/\*\.\{ts,tsx,mts,cts\}/);
  assert.deepEqual(build(root).outputs, book.outputs);

  write(root, { '.claude/dev-workflow/rules/data.md': '## PRJ-DATA — Data\n<!-- rule: scope=areas:data,backend -->\nx\n## PRJ-LAKE — Lake\n<!-- rule: scope=areas:lake -->\ny\n' });
  const withData = build(root, { packages: [...MM_PACKAGES, { id: 'etl', path: 'etl', areas: ['data'] }] });
  assert.equal(withData.rules.find((rule) => rule.id === 'PRJ-DATA').output, 'area-backend+data.md');
  assert.match(output(withData, 'area-backend+data.md'), /paths:\n {2}- "\*\*\/\*"\n {2}- "etl\/\*\*\/\*"/);
  assert.match(output(withData, '00-global.md'), /Sources: .*, vitest, project -->/);
  assert.deepEqual(withData.inactive.at(-1), { id: 'PRJ-LAKE', reason: 'no package has area lake' });

  const allOff = GLOBAL_CORE.map((id) => ({ id, reason: 'test' }));
  const empty = build(root, { packs: [], rules: { disable: allOff, allowProtected: true } });
  assert.deepEqual(empty.outputs.map((item) => item.file).filter((file) => file === '00-global.md'), ['00-global.md']);
  assert.ok(!/^## CORE-/m.test(output(empty, '00-global.md')));
});

test('writeRulebook writes outputs and lock, deletes stale marked files and keeps foreign ones', (t) => {
  const root = tempBase(t);
  const dir = join(root, OUT_DIR);
  write(root, { [`${OUT_DIR}/notes.md`]: 'my notes\n', [`${OUT_DIR}/paths-old-1.md`]: `${MARKER}\nold\n` });
  const ws = wsAt(root);
  const book = buildRulebook(ws);
  const { lock, files, deleted } = writeRulebook(ws, book);
  assert.deepEqual(readdirSync(dir).sort(), [...book.outputs.map((item) => item.file), 'notes.md'].sort());
  assert.deepEqual(deleted, [`${OUT_DIR}/paths-old-1.md`]);
  assert.equal(files.length, 9);
  for (const item of book.outputs) assert.equal(readFileSync(join(dir, item.file), 'utf8'), item.content);
  const written = JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8'));
  assert.deepEqual(written, lock);
  assert.deepEqual(Object.keys(written), ['version', 'generator', 'packs', 'rules', 'inactive', 'disabled', 'outputs']);
  assert.deepEqual(Object.keys(written.rules[0]), ['id', 'title', 'source', 'severity', 'scope', 'protected', 'hash']);
  assert.match(written.rules[0].hash, /^sha256:[0-9a-f]{16}$/);
  assert.deepEqual(written.packs.find((pack) => pack.id === 'express'), { id: 'express', version: '0.1.0', variant: '5', source: 'plugin' });
  assert.equal(written.outputs[0].file, `${OUT_DIR}/00-global.md`);

  writeFileSync(join(dir, '00-global.md'), 'hand-written\n');
  const refused = failureOf(() => writeRulebook(ws, book));
  assert.equal(refused.exitCode, 1);
  assert.match(refused.message, /\.claude\/rules\/dev-workflow\/00-global\.md exists and was not generated by cw/);
  assert.equal(readFileSync(join(dir, '00-global.md'), 'utf8'), 'hand-written\n');

  write(root, { '.claude/dev-workflow/rules/big.md': `## PRJ-BIG — Big\n<!-- rule: scope=all -->\n${'x'.repeat(13 * 1024)}\n` });
  assert.match(build(root).warnings.join('\n'), /00-global\.md is larger than 12 KB/);
});

test('checkRulebook reports each kind of drift and never writes; versions alone are notes', (t) => {
  const root = tempBase(t);
  const dir = join(root, OUT_DIR);
  const ws = wsAt(root);
  const check = (overrides) => checkRulebook(wsAt(root, overrides), build(root, overrides));
  const kinds = (result) => result.problems.map((problem) => `${problem.kind} ${problem.id ?? problem.file}`);

  assert.deepEqual(kinds(check()), [`no-lock ${LOCK_FILE}`, ...build(root).outputs.map((item) => `missing ${OUT_DIR}/${item.file}`)]);
  assert.equal(existsSync(dir), false, 'check writes nothing');
  writeRulebook(ws, buildRulebook(ws));
  assert.deepEqual(check(), { isCurrent: true, problems: [], notes: [] });

  appendFileSync(join(dir, '00-global.md'), 'extra line\n');
  assert.deepEqual(kinds(check()), [`hand-edited ${OUT_DIR}/00-global.md`]);
  rmSync(join(dir, 'area-backend.md'));
  write(root, { [`${OUT_DIR}/paths-gone-1.md`]: `${MARKER}\n` });
  assert.deepEqual(kinds(check()), [`hand-edited ${OUT_DIR}/00-global.md`, `missing ${OUT_DIR}/area-backend.md`, `stale ${OUT_DIR}/paths-gone-1.md`]);
  assert.equal(existsSync(join(dir, 'area-backend.md')), false);

  writeRulebook(ws, buildRulebook(ws));
  const extended = check({ rules: { extend: { 'CORE-NAMING': 'Prefer domain terms.' } } });
  assert.equal(extended.isCurrent, false);
  assert.deepEqual(kinds(extended), ['changed CORE-NAMING']);
  assert.equal(extended.problems[0].message, 'changed CORE-NAMING');
  const moved = check({ packages: [{ ...MM_PACKAGES[0], path: 'web' }] });
  assert.deepEqual(kinds(moved), [`outdated ${OUT_DIR}/area-backend.md`, `outdated ${OUT_DIR}/area-frontend.md`]);

  const withoutVitest = check({ packs: MM_PACKS.slice(0, 4) });
  assert.deepEqual(kinds(withoutVitest), ['removed VITEST-NO-FOCUS', 'removed VITEST-TIMERS', `stale ${OUT_DIR}/paths-vitest-1.md`]);

  const lock = JSON.parse(readFileSync(join(root, LOCK_FILE), 'utf8'));
  lock.generator.version = '0.0.9';
  lock.packs.find((pack) => pack.id === 'vitest').version = '0.0.1';
  writeFileSync(join(root, LOCK_FILE), JSON.stringify(lock));
  assert.deepEqual(check(), { isCurrent: true, problems: [], notes: [`dev-workflow 0.0.9 → ${pluginVersion()}`, 'pack vitest 0.0.1 → 0.1.0'] });
});

// ---- queries ----

test('applicableRules: global rules plus scoped rules by changed files and areas, in layer order', (t) => {
  const book = build(tempBase(t), { packages: [{ id: 'api', path: 'api', areas: ['backend'] }, { id: 'web', path: 'web', areas: ['frontend'] }] });
  const apply = (files, areas) => ids(applicableRules(book, { files, areas }));
  assert.deepEqual(apply([]), GLOBAL_CORE);
  const server = apply(['api/src/server.ts']);
  assert.deepEqual(server, [
    ...GLOBAL_CORE, 'NPM-WORKSPACE-IMPORTS', 'TS-NO-ANY', 'TS-NO-CAST', 'TS-ESM-IMPORTS',
    'EXPRESS-ERROR-RESPONSES', 'EXPRESS-INPUT-VALIDATION', 'EXPRESS-SUPERTEST', 'EXPRESS-ASYNC-ERRORS', 'EXPRESS-RESPONSE-FLOW',
  ]);
  assert.deepEqual(apply(['api/src/a.test.ts']), [...server, 'VITEST-NO-FOCUS', 'VITEST-TIMERS']);
  assert.ok(apply([], ['frontend']).includes('REACT-A11Y'));
  assert.ok(!apply([], ['frontend']).includes('EXPRESS-SUPERTEST'));
  assert.deepEqual(apply(['Dockerfile']), [...GLOBAL_CORE.slice(0, 11), 'CORE-REPRODUCIBLE-BUILDS', ...GLOBAL_CORE.slice(11), 'NPM-CI']);
});

test('findRule and ruleIdPrefixes', (t) => {
  const book = build(tempBase(t), { packs: ['typescript', 'vitest'], rules: { disable: [{ id: 'VITEST-TIMERS', reason: 'none' }] } });
  assert.equal(findRule(book, 'TS-NO-ANY').rule.id, 'TS-NO-ANY');
  assert.deepEqual(findRule(book, 'VITEST-TIMERS'), { disabled: { id: 'VITEST-TIMERS', reason: 'none' } });
  assert.deepEqual(findRule(book, 'TS-ESM-IMPORTS'), { inactive: { id: 'TS-ESM-IMPORTS', reason: 'option moduleResolution is bundler (needs nodenext)' } });
  assert.equal(findRule(book, 'NOPE-X'), null);
  assert.deepEqual([...ruleIdPrefixes(book)], ['CORE', 'TS', 'VITEST']);
});

// ---- cw rules (integration) ----

const exampleInPlace = (t, rules) =>
  makeInPlace(t, { config: inPlaceConfig({ project: MM_PROJECT, packs: MM_PACKS, packages: MM_PACKAGES, ...(rules ? { rules } : {}) }) });

const snapshot = (dir) => Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name), 'utf8')]));

function createRulesTask(cwd, { base, workTree } = {}) {
  const ws = loadWorkspace({ cwd });
  const task = newTask(ws, { ticket: 'NO-TICKET', title: 'Rules', type: 'feature', slug: 'rules-check', branch: 'NO-TICKET/feature/rules-check', ownerSession: 'test-session', base });
  if (workTree) task.workTree = workTree;
  createTask(ws, task);
  return task.id;
}

test('cw rules build in place: outputs in the outer repo with appRoot globs, same from inside app/', (t) => {
  const fx = exampleInPlace(t);
  const first = cw(fx.root, ['rules', 'build'], { env: fx.env });
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout.split('\n')[0], 'compiled 35 rules into 9 files in .claude/rules/dev-workflow/');
  const dir = join(fx.root, OUT_DIR);
  const files = snapshot(dir);
  assert.ok(existsSync(join(fx.root, LOCK_FILE)));
  assert.ok(!existsSync(join(fx.app, '.claude')));
  for (const [name, content] of Object.entries(files)) {
    assert.ok(content.includes(MARKER), name);
    for (const glob of content.match(/^ {2}- ".*"$/gm) ?? []) assert.ok(glob.startsWith('  - "app/'), `${name}: ${glob}`);
    if (name !== '00-global.md') assert.match(content, /^---\npaths:\n/);
  }
  const again = cw(join(fx.app, 'src'), ['rules', 'build', '--json'], { env: fx.env });
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.json().rules, 35);
  assert.deepEqual(snapshot(dir), files);

  const check = cw(fx.app, ['rules', 'build', '--check', '--json'], { env: fx.env });
  assert.equal(check.code, 0, check.stderr);
  assert.equal(check.json().isCurrent, true);
  assert.equal(check.json().fix, null);
  appendFileSync(join(dir, '00-global.md'), 'edited\n');
  const drift = cw(fx.root, ['rules', 'build', '--check'], { env: fx.env });
  assert.equal(drift.code, 1);
  assert.equal(drift.stdout, `rulebook out of date:\n- ${OUT_DIR}/00-global.md was edited by hand\nRun: cw rules build\n`);
  assert.equal(readFileSync(join(dir, '00-global.md'), 'utf8').endsWith('edited\n'), true, '--check writes nothing');
  assert.equal(cw(fx.root, ['rules', 'build'], { env: fx.env }).code, 0);

  const configPath = join(fx.root, '.claude', 'dev-workflow', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  writeFileSync(configPath, JSON.stringify({ ...config, rules: { extend: { 'CORE-NAMING': 'Prefer domain terms.' } } }));
  const changed = cw(fx.root, ['rules', 'build', '--check', '--json'], { env: fx.env });
  assert.equal(changed.code, 1);
  assert.deepEqual(changed.json().problems.map((problem) => problem.message), ['changed CORE-NAMING']);
  assert.equal(changed.json().fix, 'Run cw rules build.', 'a failing JSON result names its fix');
});

test('cw rules applicable --task reads the task work tree and base, whatever the cwd', (t) => {
  const fx = exampleInPlace(t);
  const git = gitIn(fx.app, fx.env);
  const base = { branch: 'main', commit: git('rev-parse', 'HEAD') };
  const id = createRulesTask(fx.root, { base });
  git('switch', '-q', '-c', 'NO-TICKET/feature/rules-check');
  write(fx.app, { 'src/a.test.ts': "it('works', () => {});\n" });
  git('add', '-A');
  git('commit', '-q', '-m', 'add test');

  const outputs = [fx.root, fx.app, join(fx.app, 'src')].map((cwd) => cw(cwd, ['rules', 'applicable', '--task', id, '--json'], { env: fx.env }));
  for (const result of outputs) assert.equal(result.code, 0, result.stderr);
  assert.equal(outputs[1].stdout, outputs[0].stdout);
  assert.equal(outputs[2].stdout, outputs[0].stdout);
  const result = outputs[0].json();
  assert.equal(result.task, id);
  assert.equal(result.workTree, realpathSync(fx.app));
  assert.equal(result.base, base.commit);
  assert.deepEqual(result.files, ['src/a.test.ts']);
  const found = ids(result.rules);
  for (const global of GLOBAL_CORE) assert.ok(found.includes(global), global);
  assert.ok(found.includes('VITEST-NO-FOCUS'));
  assert.ok(!found.includes('CORE-REPRODUCIBLE-BUILDS'));
  for (const rule of result.rules) assert.ok(rule.body.length > 0, rule.id);
  assert.deepEqual(Object.keys(result.rules[0]), ['id', 'title', 'severity', 'protected', 'scope', 'source', 'body']);

  const human = cw(fx.root, ['rules', 'applicable', '--task', id], { env: fx.env });
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /^\d+ rules apply to task NO-TICKET__feature__rules-check \(1 changed files in /);
  const missing = cw(fx.root, ['rules', 'applicable'], { env: fx.env });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--task is required\nFix: Pass --task <id>; active tasks: NO-TICKET__feature__rules-check\./);
});

test('cw rules in worktree mode: unprefixed globs; applicable uses the agent worktree diff', (t) => {
  const fx = makeWorktreeRepo(t, { config: worktreeConfig({ project: MM_PROJECT, packs: MM_PACKS, packages: MM_PACKAGES }) });
  assert.equal(cw(fx.root, ['rules', 'build'], { env: fx.env }).code, 0);
  const files = snapshot(join(fx.root, OUT_DIR));
  assert.ok(files['00-global.md'].startsWith(`${MARKER}\n`));
  assert.match(files['area-backend.md'], /^---\npaths:\n {2}- "\*\*\/\*"\n---\n/);

  const agent = addAgentWorktree(fx.root, fx.env, 'r1');
  const base = { branch: 'main', commit: gitIn(fx.root, fx.env)('rev-parse', 'HEAD') };
  const id = createRulesTask(fx.root, { base, workTree: realpathSync(agent) });
  const git = gitIn(agent, fx.env);
  git('switch', '-q', '-c', 'NO-TICKET/feature/rules-check');
  write(agent, { 'Dockerfile': 'FROM node:22.13.1-alpine\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'docker');
  write(fx.root, { 'scratch.test.ts': 'not part of the task\n' });
  const result = cw(fx.root, ['rules', 'applicable', '--task', id, '--json'], { env: fx.env });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.json().files, ['Dockerfile']);
  assert.ok(ids(result.json().rules).includes('CORE-REPRODUCIBLE-BUILDS'));
  assert.ok(!ids(result.json().rules).includes('VITEST-NO-FOCUS'));
});

test('cw rules list, show and the error exits', (t) => {
  const fx = exampleInPlace(t, { disable: [{ id: 'CORE-STRUCTURE', reason: 'legacy code' }] });
  const list = cw(fx.root, ['rules', 'list', '--json'], { env: fx.env });
  assert.equal(list.code, 0, list.stderr);
  assert.equal(list.json().length, 34);
  assert.deepEqual(list.json()[0], { id: 'CORE-SCOPE', title: 'Scope', severity: 'blocking', protected: false, scope: 'all', source: 'core', modified: null });
  const table = cw(fx.root, ['rules', 'list'], { env: fx.env });
  assert.match(table.stdout, /^id +severity +scope +source +title\n/);
  assert.match(table.stdout, /CORE-SECRETS +blocking protected +all +core +Secrets/);

  const secrets = cw(fx.app, ['rules', 'show', 'core-secrets', '--json'], { env: fx.env });
  assert.equal(secrets.code, 0, secrets.stderr);
  assert.equal(secrets.json().protected, true);
  assert.match(secrets.json().body, /^Never commit secrets/);
  assert.match(cw(fx.root, ['rules', 'show', 'TS-NO-ANY'], { env: fx.env }).stdout, /^## TS-NO-ANY — No `any` · blocking\n/);

  const unknown = cw(fx.root, ['rules', 'show', 'NOPE-X'], { env: fx.env });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown rule NOPE-X\.\nFix: List the rules with: cw rules list/);
  const disabled = cw(fx.root, ['rules', 'show', 'CORE-STRUCTURE'], { env: fx.env });
  assert.equal(disabled.code, 1);
  assert.match(disabled.stderr, /CORE-STRUCTURE is disabled in this project: legacy code/);
  assert.equal(cw(fx.root, ['rules', 'show'], { env: fx.env }).code, 2);
  assert.equal(cw(fx.root, ['rules', 'frobnicate'], { env: fx.env }).code, 2);

  const outside = cw(fx.base, ['rules', 'build'], { env: fx.env });
  assert.equal(outside.code, 3);
  assert.match(outside.stderr, /Fix: Run cw in the project directory or below it, .*setup\.sh/);

  mkdirSync(join(fx.root, '.claude', 'dev-workflow', 'rules'), { recursive: true });
  writeFileSync(join(fx.root, '.claude', 'dev-workflow', 'rules', 'broken.md'), '## PRJ-X — X\n<!-- rule: severity=blokcing -->\nx\n');
  const broken = cw(fx.root, ['rules', 'build', '--json'], { env: fx.env });
  assert.equal(broken.code, 1);
  assert.match(broken.json().error, /\.claude\/dev-workflow\/rules\/broken\.md:2: severity must be blocking or advisory/);
});
