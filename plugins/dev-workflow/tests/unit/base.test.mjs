import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { listFlag, parseArgs } from '../../cli/lib/args.mjs';
import { acquireLock, cachedByMtime, readJson, withLock, writeAtomic, writeJson } from '../../cli/lib/fsx.mjs';
import { parseFrontmatter } from '../../cli/lib/frontmatter.mjs';
import { CwError, EXIT, createOutput, formatError, maskSecrets, preconditionError } from '../../cli/lib/out.mjs';
import { run, shell, which } from '../../cli/lib/proc.mjs';
import { validate } from '../../cli/lib/schema.mjs';
import { branchPattern, renderBranch } from '../../cli/lib/template.mjs';
import { pluginRoot, tempBase } from '../fixtures/repo.mjs';

const preset = JSON.parse(readFileSync(join(pluginRoot, 'presets', 'git', 'default.json'), 'utf8'));

// Runs node -e module scripts as processes that start their work at the same moment. spawnSync would
// run them one after another, and a lock test would pass without any lock.
function runTogether(scripts, env) {
  const startAt = Date.now() + 500;
  const barrier = `for (let left; (left = ${startAt} - Date.now()) > 0;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, left);\n`;
  return Promise.all(scripts.map((script) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `${barrier}${script}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => resolve({ status, stderr }));
  })));
}
const sink = () => {
  let text = '';
  return { write: (chunk) => (text += chunk), text: () => text };
};

test('errors with exit codes 1-3 need a fix and render with it', () => {
  assert.throws(() => new CwError('x', { exitCode: EXIT.precondition }), TypeError);
  const error = preconditionError('No config.', 'Run setup.sh.', { a: 1 });
  const rendered = formatError(error, { json: true });
  assert.equal(rendered.exitCode, 3);
  assert.equal(rendered.stderr, 'cw: No config.\nFix: Run setup.sh.\n');
  assert.deepEqual(JSON.parse(rendered.stdout), { ok: false, code: 3, error: 'No config.', fix: 'Run setup.sh.', details: { a: 1 } });
  const internal = formatError(new Error('boom'));
  assert.equal(internal.exitCode, 4);
  assert.match(internal.stderr, /^cw: internal error: boom/);
});

test('output masks secrets and keeps --json to one document', () => {
  assert.equal(maskSecrets('token s3cr3t-value and s3cr3t-value', ['s3cr3t-value', 'abc']), 'token *** and ***');
  // A value with " or \ is escaped in JSON text; that form is masked too, and the JSON stays valid.
  const quoted = 'pa"ss\\word99';
  const document = maskSecrets(JSON.stringify({ error: `No task ${quoted} here`, end: 'abcdef\\' }), [quoted, 'abcdef\\']);
  assert.deepEqual(JSON.parse(document), { error: 'No task *** here', end: '***' });
  assert.equal(maskSecrets(`raw ${quoted}`, [quoted]), 'raw ***');
  const stdout = sink();
  const out = createOutput({ json: true, stdout, stderr: sink(), secrets: ['s3cr3t-value'] });
  out.print('hidden');
  out.data({ token: 's3cr3t-value' });
  assert.deepEqual(JSON.parse(stdout.text()), { token: '***' });
  // Masked value by value before serializing: a secret that starts with an escape letter never splits
  // the "\n" in front of it, and a value with " or \ is found in its raw form.
  const escapes = sink();
  createOutput({ json: true, stdout: escapes, stderr: sink(), secrets: ['nabcdef9', quoted] }).data({ error: 'line\nabcdef9 in', other: `x ${quoted} y` });
  assert.deepEqual(JSON.parse(escapes.text()), { error: 'line\nabcdef9 in', other: 'x *** y' });
  const envelope = formatError(preconditionError(`No task ${quoted} or line\nabcdef9`, 'Pass an id.'), { json: true, secrets: ['nabcdef9', quoted] });
  assert.equal(JSON.parse(envelope.stdout).error, 'No task *** or line\nabcdef9');
  assert.equal(envelope.stderr, 'cw: No task *** or line\nabcdef9\nFix: Pass an id.\n');
  assert.equal(out.table([], ['a']), '');
  assert.equal(out.table([{ a: 1, bb: 'x' }], ['a', 'bb']), 'a  bb\n-  --\n1  x');
});

test('parseArgs follows the command spec', () => {
  const parsed = parseArgs(['pos', '--title', 'a b', '--paths', 'x,y', '--paths=z', '--json', '--', '--raw'], { title: 'string', paths: 'list' });
  assert.deepEqual(parsed.positionals, ['pos']);
  assert.equal(parsed.flags.title, 'a b');
  assert.equal(parsed.flags.json, true);
  assert.deepEqual(listFlag(parsed.flags, 'paths'), ['x', 'y', 'z']);
  assert.deepEqual(parsed.rest, ['--raw']);
  const bad = parseArgs(['--title', '--other', '--x', '--title=a', '--title=b'], { title: 'string', other: 'boolean' });
  assert.deepEqual(bad.unknown, ['--x']);
  assert.deepEqual(bad.errors, ['--title needs a value', '--title is given more than once']);
  // The boolean flag right before each positional, so a value given to it can be named.
  const strays = parseArgs(['a', '--other', 'b c', '--title', 't', 'd', '--json', 'e'], { title: 'string', other: 'boolean' });
  assert.deepEqual(strays.positionals, ['a', 'b c', 'd', 'e']);
  assert.deepEqual(strays.afterBoolean, [null, 'other', null, 'json']);
});

test('run reports exit codes and missing binaries; which scans PATH', () => {
  assert.equal(run(process.execPath, ['-e', 'process.exit(3)']).code, 3);
  assert.equal(run('definitely-missing-binary-xyz').code, 127);
  assert.equal(which('node'), which('node', process.env));
  assert.ok(which('node').startsWith('/'));
  assert.equal(which('definitely-missing-binary-xyz'), null);
  assert.equal(which('node', { PATH: '/nonexistent' }), null);
});

test('writeAtomic leaves no temp files; readJson reports broken JSON as exit 4', (t) => {
  const base = tempBase(t);
  writeJson(join(base, 'a', 'x.json'), { ok: true });
  assert.deepEqual(readdirSync(join(base, 'a')), ['x.json']);
  assert.deepEqual(readJson(join(base, 'missing.json'), { none: 1 }), { none: 1 });
  writeAtomic(join(base, 'broken.json'), '{');
  assert.throws(() => readJson(join(base, 'broken.json')), (error) => error.exitCode === 4 && /not valid JSON/.test(error.message));
});

test('the lock serialises read-modify-write across processes', async (t) => {
  const base = tempBase(t);
  const counter = join(base, 'counter.json');
  writeJson(counter, { n: 0 });
  const fsx = pathToFileURL(join(pluginRoot, 'cli', 'lib', 'fsx.mjs')).href;
  const script = `import { withLock, readJson, writeJson } from '${fsx}';
for (let i = 0; i < 25; i++) withLock('${join(base, 'lock')}', () => { const v = readJson('${counter}'); writeJson('${counter}', { n: v.n + 1 }); }, { timeoutMs: 20000 });`;
  const children = await runTogether(Array.from({ length: 8 }, () => script));
  for (const child of children) assert.equal(child.status, 0, child.stderr);
  assert.equal(readJson(counter).n, 200);
});

test('a stale lock is taken over and a fresh one times out with its fix', (t) => {
  const base = tempBase(t);
  const lock = join(base, 'state.lock');
  writeFileSync(lock, JSON.stringify({ pid: 999999, host: hostname(), at: new Date().toISOString(), nonce: 'dead' }));
  withLock(lock, () => {});
  assert.equal(existsSync(lock), false);

  const held = acquireLock(lock);
  try {
    assert.throws(() => acquireLock(lock, { timeoutMs: 100 }), (error) => error.exitCode === 3 && error.fix.includes(lock));
  } finally {
    held.release();
  }

  writeFileSync(lock, '');
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  withLock(lock, () => {}, { timeoutMs: 1000 });
});

test('cachedByMtime recomputes only when an input changes', (t) => {
  const base = tempBase(t);
  const input = join(base, 'in.txt');
  writeFileSync(input, 'a');
  let calls = 0;
  const compute = () => (calls += 1);
  cachedByMtime(join(base, 'cache.json'), [input], compute);
  cachedByMtime(join(base, 'cache.json'), [input], compute);
  assert.equal(calls, 1);
  writeFileSync(input, 'ab');
  cachedByMtime(join(base, 'cache.json'), [input], compute);
  assert.equal(calls, 2);
});

test('the schema subset reports readable paths', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['a'],
    properties: { a: { type: 'array', minItems: 1, items: { enum: ['x', 'y'] } }, b: { type: 'string', minLength: 1 } },
  };
  assert.deepEqual(validate(schema, { a: ['x'] }), []);
  assert.deepEqual(validate(schema, { a: ['z'], b: '', c: 1 }), [
    { path: '$.a[0]', message: 'must be one of x, y' },
    { path: '$.b', message: 'must not be empty' },
    { path: '$.c', message: 'is not allowed (allowed: a, b)' },
  ]);
  assert.deepEqual(validate(schema, {}), [{ path: '$.a', message: 'is required' }]);
});

test('branch names follow the default preset', () => {
  assert.equal(renderBranch(preset, { ticket: 'APP-42', type: 'feature', slug: 'version-endpoint' }), 'APP-42/feature/version-endpoint');
  for (const slug of ['Version', 'one', 'a-b-c-d-e']) assert.throws(() => renderBranch(preset, { ticket: 'APP-1', type: 'feature', slug }), (error) => error.exitCode === 2);
  assert.throws(() => renderBranch(preset, { ticket: 'APP-1', type: 'chore', slug: 'a-b' }), (error) => /feature, bugfix, hotfix/.test(error.fix));
  const pattern = branchPattern(preset, '^[A-Z][A-Z0-9]+-[0-9]+$', 'maintenance');
  for (const branch of ['NO-TICKET/bugfix/x-y', 'APP-1/hotfix/a-b', 'maintenance/feature/a-b']) assert.match(branch, pattern);
  for (const branch of ['main', 'release/1.2', 'APP-1/chore/a-b']) assert.doesNotMatch(branch, pattern);
});

test('frontmatter: scalars, lists, nested keys and errors with a line', () => {
  const { data, body } = parseFrontmatter(
    '---\nname: express-route\nrole: implementer\nwhen:\n  paths: ["src/**/*.{ts,tsx}", "a,b"]\n  keywords:\n    - route\n    - endpoint\nrules: [EXPRESS-ASYNC-ERRORS]\n---\n1. Step.\n',
  );
  assert.deepEqual(data, {
    name: 'express-route',
    role: 'implementer',
    when: { paths: ['src/**/*.{ts,tsx}', 'a,b'], keywords: ['route', 'endpoint'] },
    rules: ['EXPRESS-ASYNC-ERRORS'],
  });
  assert.equal(body, '1. Step.\n');
  assert.deepEqual(parseFrontmatter('no frontmatter').data, {});
  assert.throws(() => parseFrontmatter('---\nname: x\n  orphan: y\n---\n', 'p.md'), /p\.md: frontmatter line 3/);
});

// ---- config validation (single-test templates and globs) ----

// Imported here so that additions at the top of this file stay apart from these tests.
const configErrors = async (patch) => {
  const { validateConfig } = await import('../../cli/lib/config.mjs');
  return validateConfig({ version: 1, project: { name: 'Fixture' }, packs: [], packages: [{ id: 'app', path: '.', areas: ['backend'] }], ...patch });
};
const withTestSingle = (testSingle) => configErrors({ packages: [{ id: 'app', path: '.', areas: ['backend'], testSingle }] });

test('config: packages[].testSingle must contain {file}, so a proof never runs the whole suite', async () => {
  assert.deepEqual(await withTestSingle('npm test'), [{ path: '$.packages[0].testSingle', message: 'must contain {file} (without it a proof runs the whole suite)' }]);
  assert.deepEqual(await withTestSingle('node --test {file}'), []);
});

test('config: packages[].testSingle with {file} or {name} inside a longer quoted word or next to a quote is refused', async () => {
  for (const testSingle of ['node --test "./{file}"', 'node --test {file} --test-name-pattern="^{name}$"', 'node --test "a"{file}"b"']) {
    const errors = await withTestSingle(testSingle);
    assert.equal(errors.length, 1, testSingle);
    assert.equal(errors[0].path, '$.packages[0].testSingle');
    assert.match(errors[0].message, /inside a longer quoted word, next to a quote or after a \\ or \$, where the shell quoting of its value doesn't hold; quote it on its own/);
  }
  assert.deepEqual(await withTestSingle('npx vitest run "{file}" [-t "{name}"]'), []);
});

test('config: a complexity.escalate glob that cannot match is refused, without a word about Claude Code', async () => {
  const errors = await configErrors({ complexity: { escalate: [{ paths: ['db/**', 'src/[z-a]*.ts', 'photos [2024/**'], min: 'l', reason: 'x' }] } });
  assert.deepEqual(errors.map((error) => error.path), ['$.complexity.escalate[0].paths[1]', '$.complexity.escalate[0].paths[2]']);
  assert.match(errors[0].message, /invalid \[ … \] class/);
  // Only cw matches complexity paths; Claude Code never reads them.
  assert.equal(errors[1].message, 'unclosed "[": escape a literal [ as \\[');
});

test('shell masks a JSON-escaped secret in the log even when it arrives split across two chunks', async (t) => {
  const base = tempBase(t);
  const logFile = join(base, 'check.log');
  const secret = 'pa"ss\\word99';
  // The two printf calls write the JSON-escaped form pa\"ss\\word99 in two pieces.
  const command = `printf '%s' 'pa\\"s'; sleep 0.3; printf '%s\\n' 's\\\\word99'`;
  const outcome = await shell(command, { cwd: base, logFile, secrets: [secret] });
  assert.equal(outcome.code, 0);
  assert.equal(readFileSync(logFile, 'utf8'), '***\n');
});
