import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { main, registry } from '../../cli/cw.mjs';
import { ROLES } from '../../cli/commands/playbook.mjs';
import { formatError } from '../../cli/lib/out.mjs';
import { cw, cwBin, cwShim, inPlaceConfig, makeInPlace, pluginRoot, tempBase } from '../fixtures/repo.mjs';

// The version cw prints is the plugin's.
const { version } = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));

const io = (cwd) => {
  const streams = { stdout: '', stderr: '' };
  return {
    streams,
    io: {
      cwd,
      env: {},
      stdin: () => '',
      stdout: { write: (text) => (streams.stdout += text) },
      stderr: { write: (text) => (streams.stderr += text) },
      isTTY: false,
    },
  };
};

test('every registered command has a path, usage, summary, group and run', () => {
  for (const command of registry) {
    assert.ok(command.path.length > 0 && command.usage.startsWith('cw ') && command.summary, command.path.join(' '));
    assert.ok(['setup', 'orchestrator', 'implementer', 'reviewer'].includes(command.group), command.path.join(' '));
    assert.equal(typeof command.run, 'function');
  }
  const paths = registry.map((command) => command.path.join(' '));
  assert.equal(new Set(paths).size, paths.length, 'no duplicate command paths');
});

test('unknown commands and options are usage errors that name the fix', async (t) => {
  const base = tempBase(t);
  let run = io(base);
  assert.equal(await main(['nope'], run.io), 2);
  assert.match(run.streams.stderr, /unknown command: nope\nFix: Run cw help/);

  run = io(base);
  assert.equal(await main(['config', 'validate', '--bogus'], run.io), 2);
  assert.match(run.streams.stderr, /unknown option --bogus\nFix: See cw help config validate/);

  run = io(base);
  assert.equal(await main(['version', '--json'], run.io), 0);
  assert.deepEqual(JSON.parse(run.streams.stdout), { name: 'dev-workflow', version });

  run = io(base);
  assert.equal(await main(['help', 'config', 'show'], run.io), 0);
  assert.match(run.streams.stdout, /^cw config show/);
});

test('config commands work from inside app/ and mask package env values', (t) => {
  // A value of 6+ characters, one too short for masking in logs, and one that JSON escapes.
  const env = { API_TOKEN: 'super-secret-value', PW: 'pw123', DB_PASSWORD: 'pa"ss\\word99' };
  const fx = makeInPlace(t, { config: inPlaceConfig({ packages: [{ id: 'app', path: '.', areas: ['backend'], checks: { test: 'node --test' }, env }] }) });
  const leaks = (text) => ['super-secret-value', 'pw123', 'pa"ss', 'pa\\"ss', 'word99'].filter((value) => text.includes(value));
  const show = cw(fx.app, ['config', 'show', '--json'], { env: fx.env });
  assert.equal(show.code, 0, show.stderr);
  assert.equal(show.json().workRepo, realpathSync(fx.app));
  assert.deepEqual(show.json().config.packages[0].env, { API_TOKEN: '***', PW: '***', DB_PASSWORD: '***' });
  const human = cw(fx.app, ['config', 'show'], { env: fx.env });
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /"API_TOKEN": "\*\*\*"/);
  assert.deepEqual([...leaks(show.stdout + show.stderr), ...leaks(human.stdout + human.stderr)], []);
  // An error message that echoes a value is masked too.
  const failed = cw(fx.app, ['task', 'show', '--task', 'super-secret-value', '--json'], { env: fx.env });
  assert.equal(failed.code, 3);
  assert.match(failed.stderr, /No task \*\*\* in/);
  assert.deepEqual(leaks(failed.stdout + failed.stderr), []);
  // The JSON envelope escapes " and \, and that form is masked too.
  const escaped = cw(fx.app, ['task', 'show', '--task', 'pa"ss\\word99', '--json'], { env: fx.env });
  assert.equal(escaped.code, 3);
  assert.match(escaped.json().error, /^No task \*\*\* in/);
  assert.deepEqual(leaks(escaped.stdout + escaped.stderr), []);

  const validate = cw(fx.app, ['config', 'validate'], { env: fx.env });
  assert.equal(validate.code, 0, validate.stderr);
  assert.match(validate.stderr, /warning: \$\.packages\[0\]\.env\.PW is shorter than 6 characters/);
  assert.deepEqual(leaks(validate.stdout + validate.stderr), []);
  assert.equal(cw(fx.app, ['config', 'validate', '--json'], { env: fx.env }).json().warnings.length, 1);

  const outside = cw(fx.base, ['config', 'show'], { env: fx.env });
  assert.equal(outside.code, 3);
  assert.match(outside.stderr, /Fix: Run cw in the project directory or below it, .*setup\.sh/);
});

test('config validate: a JSON syntax error is an invalid config (exit 1), as in cw init --write', async (t) => {
  const base = tempBase(t);
  writeFileSync(join(base, 'bad.json'), '{ "version": 1,');
  const run = io(base);
  assert.equal(await main(['config', 'validate', '--file', 'bad.json'], run.io), 1);
  assert.match(run.streams.stderr, /bad\.json is not valid JSON.*\nFix: Fix the JSON syntax/s);
});

test('only commands that take positionals accept them; a value that lost its quotes is a usage error', async (t) => {
  const base = tempBase(t);
  const takes = registry.filter((command) => command.positionals).map((command) => command.path.join(' ')).sort();
  assert.deepEqual(takes, ['playbook read', 'playbook show', 'prove', 'rules show', 'run']);
  for (const argv of [
    ['version', 'extra'],
    ['task', 'new', '--ticket', 'NO-TICKET', '--slug', 'add-helper', '--title', 'Add', 'the', 'helper', '--type', 'feature'],
    ['classify', '--task', 'x', '--set', 's', '--why', 'tiny', 'leftover'],
  ]) {
    const run = io(base);
    assert.equal(await main(argv, run.io), 2, argv.join(' '));
    assert.match(run.streams.stderr, /^cw: unexpected argument (extra|the|leftover)\nFix: Quote values with spaces/);
  }
});

test('a value after a flag that takes none is a usage error that names the flag, not the quoting', async (t) => {
  const base = tempBase(t);
  for (const [argv, flag] of [
    [['task', 'review', '--task', 'x', '--new-agent', 'the old one ended'], '--new-agent'],
    [['checks', '--changed', 'src/a.ts'], '--changed'],
    [['version', '--json', 'extra'], '--json'],
  ]) {
    const run = io(base);
    assert.equal(await main(argv, run.io), 2, argv.join(' '));
    assert.match(run.streams.stderr, new RegExp(`^cw: unexpected argument ${argv.at(-1)}\\nFix: ${flag} takes no value`), argv.join(' '));
    assert.doesNotMatch(run.streams.stderr, /Quote values/);
  }
});

test('help and --json: help prints JSON with --json, internal errors print a JSON document, cw run refuses --json', async (t) => {
  const base = tempBase(t);
  let run = io(base);
  assert.equal(await main(['help', '--json'], run.io), 0);
  const help = JSON.parse(run.streams.stdout);
  assert.ok(help.commands.some((command) => command.command === 'config show' && command.usage.startsWith('cw config show')));
  run = io(base);
  assert.equal(await main(['--json'], run.io), 0);
  assert.deepEqual(JSON.parse(run.streams.stdout).commands, help.commands);
  for (const argv of [['help', 'config', 'show', '--json'], ['config', 'show', '--help', '--json']]) {
    run = io(base);
    assert.equal(await main(argv, run.io), 0);
    assert.deepEqual(Object.keys(JSON.parse(run.streams.stdout)), ['command', 'usage', 'summary']);
  }
  run = io(base);
  assert.equal(await main(['--bogus'], run.io), 2);
  assert.match(run.streams.stderr, /unknown command: --bogus/);

  run = io(base);
  assert.equal(await main(['run', 'vitest:no-focus', '--json'], run.io), 2);
  assert.match(JSON.parse(run.streams.stdout).fix, /without --json/);

  const internal = formatError(new Error('boom'), { json: true });
  assert.equal(internal.exitCode, 4);
  assert.deepEqual(JSON.parse(internal.stdout), { ok: false, code: 4, error: 'boom' });
});

test('a corrupt task file is reported with its repair fix, also with --json', (t) => {
  const fx = makeInPlace(t);
  const dir = join(fx.root, '.git', 'dev-workflow', 'tasks', 'NO-TICKET__feature__x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'task.json'), '{ "id": ');
  const shown = cw(fx.root, ['task', 'show', '--task', 'NO-TICKET__feature__x', '--json'], { env: fx.env });
  assert.equal(shown.code, 4);
  assert.match(shown.stderr, /task\.json is not valid JSON.*\nFix: Repair or delete .*task\.json\.\n$/s);
  assert.doesNotMatch(shown.stderr, /\n {4}at /, 'no stack trace for a diagnosed error');
  assert.match(shown.json().fix, /^Repair or delete /);
});

// The registry paths of the `cw …` commands that a part of docs/PLAN.md §6 names, in order.
function planCommands(from, to) {
  const plan = readFileSync(join(pluginRoot, '..', '..', 'docs', 'PLAN.md'), 'utf8');
  const section = plan.slice(plan.indexOf(from), plan.indexOf(to, plan.indexOf(from)));
  const paths = [];
  for (const [, text] of section.matchAll(/`cw ([^`]+)`/g)) {
    const words = text.split(/\s+/);
    const command = registry.filter((entry) => entry.path.every((part, i) => words[i] === part)).sort((a, b) => b.path.length - a.path.length)[0];
    assert.ok(command, `§6 names an unknown command: cw ${text}`);
    if (!paths.includes(command.path.join(' '))) paths.push(command.path.join(' '));
  }
  return paths;
}

// The registry paths of the commands in a role's row of the docs/PLAN.md §8 table, in order; an
// alternative of the command words (`spec save\|show\|lint`) is a command of its own.
function tableCommands(role) {
  const plan = readFileSync(join(pluginRoot, '..', '..', 'docs', 'PLAN.md'), 'utf8');
  const row = plan.split('\n').find((line) => line.startsWith(`| ${role} |`));
  const paths = [];
  for (const [, text] of row.matchAll(/`([^`]+)`/g)) {
    const [first, ...alternatives] = text.split(/ (?=--|<|\[)/)[0].split('\\|');
    const words = first.trim().split(/\s+/);
    for (const candidate of [words, ...alternatives.map((alternative) => [...words.slice(0, -1), alternative.trim()])]) {
      const command = registry.filter((entry) => entry.path.every((part, i) => candidate[i] === part)).sort((a, b) => b.path.length - a.path.length)[0];
      assert.ok(command, `§8 names an unknown command: cw ${candidate.join(' ')}`);
      if (!paths.includes(command.path.join(' '))) paths.push(command.path.join(' '));
    }
  }
  return paths;
}

test('playbook show lists the cw commands of the role\'s §6 steps, then the rest of its §8 row', () => {
  const expected = (from, to, role) => [...new Set([...planCommands(from, to), ...tableCommands(role)])];
  assert.deepEqual(ROLES.orchestrator.commands, expected('**Orchestrator**', '**The misclassified reset**', 'Orchestrator'));
  assert.deepEqual(ROLES.implementer.commands, expected('**Implementer**', '**Reviewer**', 'Implementer'));
  assert.deepEqual(ROLES.reviewer.commands, expected('**Reviewer** (', '## 7.', 'Reviewer'));
  assert.ok(ROLES.reviewer.commands.includes('commit lint') && ROLES.orchestrator.commands.includes('doctor'));
  // cw step marks the steps that no other command marks done (the band's step n/8).
  for (const path of ['step', 'run']) assert.ok(ROLES.implementer.commands.includes(path), path);
  for (const path of ['pr title', 'spec show', 'task show', 'task list']) assert.ok(ROLES.orchestrator.commands.includes(path), path);
});

test('bin/cw is executable and works through a symlink and from a path with a space', (t) => {
  assert.ok(statSync(cwShim).mode & 0o111);
  const base = tempBase(t);
  symlinkSync(cwShim, join(base, 'cw'));
  const linked = spawnSync(join(base, 'cw'), ['version'], { encoding: 'utf8' });
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(linked.stdout, `dev-workflow ${version}\n`);
  const spaced = join(base, 'a dir');
  symlinkSync(base, spaced);
  assert.equal(cwBin(spaced, ['version']).code, 0);
});
