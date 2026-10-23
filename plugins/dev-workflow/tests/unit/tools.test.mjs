import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MATRIX, frontmatterOf, renderImplementer, run } from '../../tools/generate-agents.mjs';
import { PRIVATE_TERMS, externalTerms, lint } from '../../tools/repo-lint.mjs';

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools');

// Built from the list, so the term appears only in repo-lint.mjs itself.
const [termD] = PRIVATE_TERMS;
// Stand-ins for the private list, which lives outside the repository.
const termA = 'acmecorp';
const termB = 'old employer';
const capitalized = (term) => term[0].toUpperCase() + term.slice(1);

const REVIEWER = `---
name: reviewer
model: ${MATRIX.reviewer.model}
effort: ${MATRIX.reviewer.effort}
disallowedTools: Edit, Agent
color: ${MATRIX.reviewer.color}
---
Body.
`;

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dw-tools-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
}

const marketplace = (entry = {}) =>
  JSON.stringify({ name: 'mkt', owner: { name: 'Example' }, plugins: [{ name: 'one', source: './plugins/one', ...entry }] });

// A minimal valid marketplace checkout; extra files are added or replaced per test.
function repo(t, extra = {}) {
  const root = tempDir(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  write(root, {
    '.claude-plugin/marketplace.json': marketplace(),
    'plugins/one/.claude-plugin/plugin.json': JSON.stringify({ name: 'one', version: '0.1.0' }),
    ...extra,
  });
  return root;
}

test('generated implementers follow the matrix and carry no forbidden fields', () => {
  for (const size of ['s', 'm', 'l', 'xl']) {
    const fields = frontmatterOf(renderImplementer(size));
    assert.equal(fields.model, MATRIX[`implementer-${size}`].model);
    assert.equal(fields.effort, MATRIX[`implementer-${size}`].effort);
    assert.equal(fields.disallowedTools, 'Agent');
    for (const forbidden of ['permissionMode', 'hooks', 'mcpServers', 'initialPrompt', 'isolation']) {
      assert.equal(forbidden in fields, false, `${size}: ${forbidden}`);
    }
  }
});

test('the generator check passes after writing and reports drift', (t) => {
  const dir = tempDir(t);
  write(dir, { 'reviewer.md': REVIEWER });
  assert.deepEqual(run(dir, { write: true }).problems, []);
  assert.deepEqual(run(dir, { write: false }).problems, []);

  const path = join(dir, 'implementer-m.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
  assert.deepEqual(run(dir, { write: false }).problems, [], 'CRLF line endings are not drift');

  writeFileSync(path, readFileSync(path, 'utf8') + 'edited\n');
  const { outdated, problems } = run(dir, { write: false });
  assert.deepEqual(outdated, [path]);
  assert.match(problems.join('\n'), /implementer-m\.md: out of date/);
});

test('the generator check compares the reviewer with the matrix', (t) => {
  const dir = tempDir(t);
  assert.match(run(dir, { write: true }).problems.join('\n'), /reviewer\.md: missing/);

  write(dir, {
    'reviewer.md': REVIEWER.replace(/^effort: .*$/m, 'effort: low')
      .replace('disallowedTools: Edit, Agent', 'disallowedTools: Agent')
      .replace('---\nBody', 'permissionMode: plan\nisolation: worktree\n---\nBody'),
  });
  const { outdated, problems } = run(dir, { write: false });
  assert.deepEqual(outdated, []);
  const text = problems.join('\n');
  assert.match(text, /effort is "low"/);
  assert.match(text, /disallowedTools must be "Edit, Agent"/);
  assert.match(text, /remove "permissionMode"/);
  assert.match(text, /remove "isolation"/);

  write(dir, { 'reviewer.md': REVIEWER.replace(`model: ${MATRIX.reviewer.model}`, `model: "${MATRIX.reviewer.model}"`).replace(/\n/g, '\r\n') });
  assert.deepEqual(run(dir, { write: false }).problems, [], 'quoted values and CRLF are fine');
});

test('repo-lint accepts a valid checkout', (t) => {
  assert.deepEqual(lint(repo(t)), []);
});

test('repo-lint refuses a directory that is not the top of a git checkout', (t) => {
  const root = repo(t);
  mkdirSync(join(root, 'sub'));
  assert.deepEqual(lint(join(root, 'sub')), [`${join(root, 'sub')}: not the top of a git checkout`]);
  assert.match(lint(join(root, 'missing'))[0], /not the top of a git checkout/);
});

test('repo-lint reports terms of the private list in files and paths, masked, also in non-ASCII names', (t) => {
  const root = repo(t, {
    'docs/notes.md': `line one\nCopied from ${capitalized(termB)}.\n`,
    [`docs/${termA}.md`]: 'x\n',
    'docs/über.md': `${termB}\n`,
    'docs/PLAN.md': `${termA}\n`,
  });
  const problems = lint(root, { terms: [termA, termB] });
  const masked = (term) => '*'.repeat(term.length);
  assert.ok(problems.includes(`docs/notes.md:2: a term of the private list ("${masked(termB)}"); remove it`), problems.join('\n'));
  assert.ok(problems.includes(`docs/${masked(termA)}.md: the path contains a term of the private list; rename it`), problems.join('\n'));
  assert.ok(problems.includes(`docs/über.md:1: a term of the private list ("${masked(termB)}"); remove it`), problems.join('\n'));
  assert.ok(problems.includes(`docs/PLAN.md:1: a term of the private list ("${masked(termA)}"); remove it`), problems.join('\n'));
  assert.ok(!problems.join('\n').includes(termA), 'the report never shows a term');
  assert.deepEqual(lint(root), [], 'without a list only the built-in terms are checked');
});

test('repo-lint checks commit messages, author and committer of a range against the private list', (t) => {
  const root = repo(t);
  const git = (args, env = {}) => execFileSync('git', args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  const as = (email) => ({ GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.com' });
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base'], as('a@example.com'));
  git(['commit', '-q', '--allow-empty', '-m', `Port from ${capitalized(termB)}`], as('a@example.com'));
  git(['commit', '-q', '--allow-empty', '-m', 'Clean'], as(`a@${termA}.example`));
  const problems = lint(root, { terms: [termA, termB], range: 'HEAD~2..HEAD' });
  assert.equal(problems.filter((problem) => /^commit [0-9a-f]+: the message contains/.test(problem)).length, 1, problems.join('\n'));
  assert.equal(problems.filter((problem) => /^commit [0-9a-f]+: the author or committer contains/.test(problem)).length, 1, problems.join('\n'));
  assert.deepEqual(lint(root, { terms: [termA, termB], range: 'HEAD~2..HEAD~1' }).length, 1);
});

test('the private list comes from FORBIDDEN_TERMS, else the file; comments and blank lines are skipped', (t) => {
  const file = join(tempDir(t), 'terms');
  writeFileSync(file, '# list\nAcmeCorp\n\n  Old Employer \n');
  assert.deepEqual(externalTerms({}, file), ['acmecorp', 'old employer']);
  assert.deepEqual(externalTerms({ FORBIDDEN_TERMS: 'x\ny' }, file), ['x', 'y']);
  assert.equal(externalTerms({}, join(dirname(file), 'missing')), null);
});

test('repo-lint allows the MIT attribution of the adapted mod only in the mod', (t) => {
  const attribution = `Adapted from ${termD}-progress (MIT).\n`;
  const mod = {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mkt',
      owner: { name: 'Example' },
      plugins: [
        { name: 'one', source: './plugins/one' },
        { name: 'agents-progress', source: './plugins/agents-progress' },
      ],
    }),
    'plugins/agents-progress/.claude-plugin/plugin.json': JSON.stringify({ name: 'agents-progress', version: '0.1.0' }),
    'plugins/agents-progress/README.md': attribution,
  };
  assert.deepEqual(lint(repo(t, mod)), []);
  assert.ok(lint(repo(t, { 'README.md': attribution })).includes(`README.md:1: private term "${termD}"; remove it`));
});

test('repo-lint enforces the skill budgets', (t) => {
  assert.deepEqual(lint(repo(t, { 'plugins/one/skills/x/SKILL.md': 'line\n'.repeat(200) })), []);
  const root = repo(t, {
    'plugins/one/skills/x/SKILL.md': 'line\n'.repeat(201),
    'plugins/one/skills/x/steps/1.md': 'line\n'.repeat(81),
    'plugins/one/skills/x/reference/sub/a.md': 'line\n'.repeat(151),
  });
  const problems = lint(root).join('\n');
  assert.match(problems, /SKILL\.md: 201 lines, the budget is 200/);
  assert.match(problems, /steps\/1\.md: 81 lines, the budget is 80/);
  assert.match(problems, /reference\/sub\/a\.md: 151 lines, the budget is 150/);
});

test('repo-lint enforces the manifest rules', (t) => {
  const root = repo(t, {
    '.claude-plugin/marketplace.json': marketplace({ version: '1.0.0', dependencies: ['two'] }),
    'plugins/one/.claude-plugin/plugin.json': JSON.stringify({ name: 'one', version: '1.0', dependencies: ['two'] }),
    'plugins/one/settings.json': '{}',
    'plugins/two/README.md': 'not listed\n',
  });
  const problems = lint(root).join('\n');
  assert.match(problems, /plugin "one": remove "version"/);
  assert.match(problems, /plugin "one": remove "dependencies"/);
  assert.match(problems, /version must be semver/);
  assert.match(problems, /plugin\.json: remove "dependencies"/);
  assert.match(problems, /plugins\/one\/settings\.json: remove it/);
  assert.match(problems, /plugins\/two: not listed/);
});

test('repo-lint checks the source form and reports a broken manifest once', (t) => {
  assert.deepEqual(lint(repo(t, { '.claude-plugin/marketplace.json': marketplace({ source: './plugins/one/' }) })), []);
  assert.match(lint(repo(t, { '.claude-plugin/marketplace.json': marketplace({ source: 'plugins/one' }) })).join('\n'), /source must be "\.\/plugins\/<name>"/);

  const problems = lint(repo(t, { 'plugins/one/.claude-plugin/plugin.json': '{ broken' }));
  assert.equal(problems.filter((p) => /plugin\.json: invalid JSON/.test(p)).length, 1, problems.join('\n'));
});

test('repo-lint reports invalid JSON and forbidden agent fields', (t) => {
  const root = repo(t, {
    'plugins/one/data.json': '{ broken',
    'plugins/one/agents/a.md': '---\nname: a\nhooks: x\n---\nBody\n',
    'plugins/one/agents/b.md': '---\r\nname: b\r\nisolation: worktree\r\n---\r\nBody\r\n',
  });
  const problems = lint(root).join('\n');
  assert.match(problems, /plugins\/one\/data\.json: invalid JSON/);
  assert.match(problems, /plugins\/one\/agents\/a\.md: remove "hooks"/);
  assert.match(problems, /plugins\/one\/agents\/b\.md: remove "isolation"/);
});

test('both tools run and exit 1 when started through a symlinked path', (t) => {
  const link = join(tempDir(t), 'tools');
  symlinkSync(TOOLS, link);

  const broken = repo(t, { 'plugins/one/data.json': '{ broken' });
  const lintRun = spawnSync(process.execPath, [join(link, 'repo-lint.mjs'), '--root', broken], { encoding: 'utf8' });
  assert.equal(lintRun.status, 1, lintRun.stderr);
  assert.match(lintRun.stderr, /data\.json: invalid JSON/);
  assert.equal(spawnSync(process.execPath, [join(link, 'repo-lint.mjs'), '--root', repo(t)]).status, 0);
  assert.equal(spawnSync(process.execPath, [join(link, 'repo-lint.mjs'), '--root']).status, 2);

  const empty = tempDir(t);
  const generatorRun = spawnSync(process.execPath, [join(link, 'generate-agents.mjs'), '--check', '--out', empty], { encoding: 'utf8' });
  assert.equal(generatorRun.status, 1);
  assert.match(generatorRun.stderr, /out of date/);
  assert.match(generatorRun.stderr, /Regenerate:/);
});
