import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { withDefaults } from '../../cli/lib/config.mjs';
import { buildRulebook } from '../../cli/lib/rules.mjs';
import { pluginRoot, tempBase } from '../fixtures/repo.mjs';

const repoRoot = join(pluginRoot, '..', '..');
const migration = readFileSync(join(repoRoot, 'docs', 'migration', 'cq-rules.md'), 'utf8');
const plan = readFileSync(join(repoRoot, 'docs', 'PLAN.md'), 'utf8');
const ID = /[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+/g;

// The rows of the first "| Old rule | Successor |" table: [{ old, successors }].
function mappingRows(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^\| Old rule \| Successor \|$/.test(line.trim()));
  assert.ok(start !== -1, 'the table header "| Old rule | Successor |" exists');
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const [old, successors] = line.split('|').slice(1, 3).map((cell) => cell.trim());
    rows.push({ old, successors: successors.split('+').map((item) => item.trim().replace(/`/g, '')) });
  }
  return rows;
}

// Successor IDs that are not active rules (missing, inactive or disabled).
const missingSuccessors = (markdown, activeIds) => mappingRows(markdown).flatMap((row) => row.successors.filter((id) => !activeIds.has(id)));

// The Acme Shop pack set (docs/migration/cq-rules.md, "Project layer for P6"), in place.
const exampleBook = (t) =>
  buildRulebook({
    configRoot: tempBase(t),
    config: withDefaults({
      version: 1,
      project: { name: 'Acme Shop', language: { repo: 'en', productCopy: 'de' } },
      workspace: { mode: 'in-place', appRoot: 'app' },
      packs: [
        'node-npm',
        { id: 'typescript', options: { moduleResolution: 'nodenext' } },
        { id: 'express', variant: '5', options: { appEntry: 'createApp()' } },
        { id: 'react-vite', variant: 'react-19', options: { vitestGlobals: false } },
        'vitest',
      ],
      packages: [{ id: 'app', path: '.', areas: ['frontend', 'backend'], checks: { test: 'npm test' } }],
    }),
  });

test('the migration map covers CQ-1 to CQ-23 exactly once, and every successor is an active rule', (t) => {
  const rows = mappingRows(migration);
  assert.deepEqual(rows.map((row) => row.old), Array.from({ length: 23 }, (_, i) => `CQ-${i + 1}`));
  const book = exampleBook(t);
  assert.equal(book.rules.length, 35);
  assert.deepEqual(book.inactive, []);
  const active = new Set(book.rules.map((rule) => rule.id));
  assert.deepEqual(missingSuccessors(migration, active), []);
  const mapped = new Set(rows.flatMap((row) => row.successors));
  const unmapped = [...active].filter((id) => !mapped.has(id));
  assert.deepEqual(unmapped, ['CORE-LANGUAGE', 'TS-ESM-IMPORTS'], 'the rules from the CLAUDE.md conventions');
  for (const id of unmapped) assert.match(migration, new RegExp(`\\| [^|]+ \\| ${id}`), `${id} is in the conventions table`);

  const misspelled = migration.replace('| CQ-9 | CORE-ERRORS |', '| CQ-9 | CORE-ERROR |');
  assert.deepEqual(missingSuccessors(misspelled, active), ['CORE-ERROR'], 'the check catches a wrong successor');
});

test('every rule ID of the plan’s v1 packs table exists, protected exactly where the plan marks it', (t) => {
  const lines = plan.split('\n');
  const start = lines.findIndex((line) => line.startsWith('**v1 packs**'));
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (rows.length && !line.startsWith('|')) break;
    if (/^\| `[a-z-]+`/.test(line)) rows.push(line);
  }
  assert.equal(rows.length, 6, 'the six v1 pack rows');
  const planned = new Map();
  for (const row of rows) {
    // Cells split on unescaped pipes; the core row escapes the pipes of its glob list.
    const rulesCell = row.split(/(?<!\\)\|/)[2];
    for (const match of rulesCell.matchAll(ID)) planned.set(match[0], rulesCell.slice(match.index + match[0].length).startsWith(' 🔒'));
  }
  assert.equal(planned.size, 35);
  const book = exampleBook(t);
  const actual = new Map(book.rules.map((rule) => [rule.id, rule.protected]));
  assert.deepEqual([...actual.keys()].sort(), [...planned.keys()].sort());
  for (const [id, isProtected] of planned) assert.equal(actual.get(id), isProtected, id);
  assert.deepEqual([...planned].filter(([, isProtected]) => isProtected).map(([id]) => id).sort(), [
    'CORE-INJECTION', 'CORE-LOGGING', 'CORE-SECRETS', 'REACT-NO-RAW-HTML', 'VITE-ENV-SECRETS',
  ]);
});
