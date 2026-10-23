import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { withDefaults } from '../../cli/lib/config.mjs';
import { containsWord, loadProcedures, resolvePacks, selectProcedures } from '../../cli/lib/packs.mjs';
import { tempBase, write } from '../fixtures/repo.mjs';

const MM_PACKS = [
  'node-npm',
  { id: 'typescript', options: { moduleResolution: 'nodenext' } },
  { id: 'express', variant: '5', options: { appEntry: 'createApp()' } },
  { id: 'react-vite', variant: 'react-19', options: { vitestGlobals: false } },
  'vitest',
];

const wsAt = (configRoot, packs = MM_PACKS) => ({
  configRoot,
  config: withDefaults({ version: 1, project: { name: 'Fixture', language: { repo: 'en', productCopy: 'de' } }, packs, packages: [{ id: 'app', path: '.', areas: ['backend'] }] }),
});

const procedure = (frontmatter, body = '1. Do the thing.') => `---\n${frontmatter}\n---\n${body}\n`;

function load(root, packs = MM_PACKS) {
  const ws = wsAt(root, packs);
  const warnings = [];
  const procedures = loadProcedures(ws, resolvePacks(ws), { onWarning: (warning) => warnings.push(warning) });
  return { procedures, warnings };
}

test('pack procedures render their pack options; a project procedure replaces one in place', (t) => {
  const root = tempBase(t);
  const before = load(root).procedures;
  const route = before.find((item) => item.name === 'express-route');
  assert.match(route.body, /registered for `createApp\(\)`/);
  assert.match(route.body, /4xx in `\{ "error": "<message>" \}`/);
  assert.deepEqual(route.when, { paths: [], areas: ['backend'], keywords: ['route', 'endpoint', 'api', 'handler', 'middleware', 'request'], phases: [] });

  write(root, {
    '.claude/dev-workflow/procedures/implementer/express-route.md': procedure('name: express-route\nrole: implementer\ndescription: Our routes.\nwhen:\n  paths: ["src/routes/**/*.{ts,tsx}"]', '1. Use {project.language.repo} names.'),
    '.claude/dev-workflow/procedures/reviewer/always.md': procedure('name: always\nrole: reviewer\ndescription: Every review.'),
    '.claude/dev-workflow/procedures/orchestrator/handover.md': procedure('name: handover\nrole: orchestrator\ndescription: At delivery.\nwhen:\n  phases: [deliver]\nscripts: [vitest:no-focus, nope:x]'),
  });
  const { procedures, warnings } = load(root);
  assert.deepEqual(procedures.map((item) => `${item.origin}:${item.role}/${item.name}`), [
    'typescript:implementer/narrow-unknown',
    'project:implementer/express-route',
    'react-vite:implementer/ui-change',
    'react-vite:reviewer/ui-review',
    'project:orchestrator/handover',
    'project:reviewer/always',
  ]);
  assert.equal(procedures[1].body, '1. Use en names.');
  assert.deepEqual(procedures[1].when.paths, ['src/routes/**/*.{ts,tsx}']);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /script nope:x is not a script of an active pack/);
  assert.match(warnings[1], /project procedure implementer\/express-route replaces the one from pack express/);
});

test('invalid procedures fail together, each with its file', (t) => {
  const root = tempBase(t);
  write(root, {
    '.claude/dev-workflow/procedures/implementer/a-wrong-role.md': procedure('name: wrong-role\nrole: reviewer\ndescription: x'),
    '.claude/dev-workflow/procedures/implementer/b-no-description.md': procedure('name: no-description\nrole: implementer'),
    '.claude/dev-workflow/procedures/implementer/c-phases.md': procedure('name: phases\nrole: implementer\ndescription: x\nwhen:\n  phases: [deliver]'),
    '.claude/dev-workflow/procedures/implementer/d-unknown.md': procedure('name: unknown\nrole: implementer\ndescription: x\naliases: [y]\nwhen:\n  files: [a]'),
    '.claude/dev-workflow/procedures/implementer/e-scalar.md': procedure('name: scalar\nrole: implementer\ndescription: x\nrules: TS-NO-ANY'),
    '.claude/dev-workflow/procedures/implementer/f-options.md': procedure('name: options\nrole: implementer\ndescription: x', '1. Use {options.appEntry}.'),
    '.claude/dev-workflow/procedures/implementer/g-Bad_Name.md': procedure('name: Bad_Name\nrole: implementer\ndescription: x'),
    '.claude/dev-workflow/procedures/investigator/h.md': procedure('name: h\nrole: investigator\ndescription: x'),
  });
  let error;
  try {
    load(root);
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.exitCode, 1);
  const text = error.message;
  assert.match(text, /a-wrong-role\.md: role must be implementer/);
  assert.match(text, /b-no-description\.md: description is required/);
  assert.match(text, /c-phases\.md: when\.phases is only for orchestrator procedures/);
  assert.match(text, /d-unknown\.md: unknown key "aliases"/);
  assert.match(text, /d-unknown\.md: unknown key "when\.files"/);
  assert.match(text, /e-scalar\.md: rules must be a list/);
  assert.match(text, /f-options\.md: unresolved placeholder \{options\.appEntry\}: project procedures have no pack options/);
  assert.match(text, /g-Bad_Name\.md: name must be lowercase words/);
  assert.match(text, /investigator: unknown role directory \(roles: orchestrator, implementer, reviewer\)/);
});

test('a when.paths glob that cannot match and a placeholder with other characters fail at load, not at selection', (t) => {
  const root = tempBase(t);
  // The file holds photos \[2024\]/**: one backslash before each bracket, as the frontmatter keeps it.
  const escaped = 'photos \\[2024\\]/**';
  write(root, {
    '.claude/dev-workflow/procedures/implementer/a-range.md': procedure(`name: range\nrole: implementer\ndescription: x\nwhen:\n  paths: ["src/[z-a]*.ts", "${escaped}"]`),
    '.claude/dev-workflow/procedures/implementer/b-placeholder.md': procedure('name: placeholder\nrole: implementer\ndescription: x', '1. Ask {project.owner-team}.'),
    '.claude/dev-workflow/procedures/implementer/c-unclosed.md': procedure('name: unclosed\nrole: implementer\ndescription: x\nwhen:\n  paths: ["photos [2024/**"]'),
  });
  let error;
  try {
    load(root);
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.exitCode, 1);
  assert.match(error.message, /a-range\.md: when\.paths src\/\[z-a\]\*\.ts: invalid \[ … \] class \(Range out of order in character class\)/);
  assert.doesNotMatch(error.message, /photos \\\[/, 'the escaped glob is valid');
  assert.match(error.message, /b-placeholder\.md: invalid placeholder \{project\.owner-team\}: the names after the dot may use only letters, digits and _\. Correct it to one of the project placeholders: \{project\.name\}, \{project\.language\.repo\}, \{project\.language\.productCopy\}$/m);
  // Only cw matches when.paths, so the message says nothing about Claude Code.
  assert.match(error.message, /c-unclosed\.md: when\.paths photos \[2024\/\*\*: unclosed "\[": escape a literal \[ as \\\[$/m);

  write(root, { '.claude/dev-workflow/procedures/implementer/a-range.md': procedure(`name: range\nrole: implementer\ndescription: x\nwhen:\n  paths: ["${escaped}"]`) });
  rmSync(join(root, '.claude/dev-workflow/procedures/implementer/b-placeholder.md'));
  rmSync(join(root, '.claude/dev-workflow/procedures/implementer/c-unclosed.md'));
  const range = load(root).procedures.find((item) => item.name === 'range');
  assert.deepEqual(range.when.paths, [escaped]);
  assert.deepEqual(selectProcedures([range], { role: 'implementer', paths: ['photos [2024]/a.jpg'] }).map((item) => item.name), ['range']);
  assert.deepEqual(selectProcedures([range], { role: 'implementer', paths: ['photos 2/a.jpg'] }), []);
});

test('selection is deterministic: empty when, phase, paths, areas and whole-word keywords', (t) => {
  const root = tempBase(t);
  write(root, {
    '.claude/dev-workflow/procedures/implementer/always.md': procedure('name: always\nrole: implementer\ndescription: Every task.'),
    '.claude/dev-workflow/procedures/implementer/migrations.md': procedure('name: migrations\nrole: implementer\ndescription: x\nwhen:\n  paths: ["db/**/*.sql"]'),
    '.claude/dev-workflow/procedures/orchestrator/handover.md': procedure('name: handover\nrole: orchestrator\ndescription: x\nwhen:\n  phases: [deliver]'),
  });
  const { procedures } = load(root);
  const names = (input) => selectProcedures(procedures, input).map((item) => item.name);
  assert.deepEqual(names({ role: 'implementer' }), ['always']);
  assert.deepEqual(names({ role: 'implementer', text: 'Add an endpoint for versions' }), ['express-route', 'always']);
  assert.deepEqual(names({ role: 'implementer', text: 'Refactor the router' }), ['always']);
  assert.deepEqual(names({ role: 'implementer', areas: ['backend'] }), ['express-route', 'always']);
  assert.deepEqual(names({ role: 'implementer', areas: ['frontend'] }), ['ui-change', 'always']);
  assert.deepEqual(names({ role: 'implementer', paths: ['db/schema/001.sql'] }), ['always', 'migrations']);
  assert.deepEqual(names({ role: 'implementer', text: 'Parse the JSON body' }), ['narrow-unknown', 'always']);
  assert.deepEqual(names({ role: 'implementer', text: 'Parse the JSON body of the request' }), ['narrow-unknown', 'express-route', 'always']);
  assert.deepEqual(names({ role: 'implementer', text: 'jsonify the logs' }), ['always']);
  assert.deepEqual(names({ role: 'reviewer', areas: ['frontend'] }), ['ui-review']);
  assert.deepEqual(names({ role: 'reviewer', areas: ['backend'] }), []);
  assert.deepEqual(names({ role: 'orchestrator', phase: 'deliver' }), ['handover']);
  assert.deepEqual(names({ role: 'orchestrator', phase: 'review' }), []);
  const input = { role: 'implementer', areas: ['frontend', 'backend'], text: 'json endpoint' };
  assert.deepEqual(names(input), names(input));
});

test('containsWord matches whole words in any script, case-insensitively', () => {
  assert.equal(containsWord('Add a Route.', 'route'), true);
  assert.equal(containsWord('the router', 'route'), false);
  assert.equal(containsWord('reroute', 'route'), false);
  assert.equal(containsWord('Größe ändern', 'größe'), true);
  assert.equal(containsWord('Größenangabe', 'größe'), false);
  assert.equal(containsWord('a (c++) b', 'c++'), true);
});
