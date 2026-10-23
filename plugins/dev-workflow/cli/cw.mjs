// cw: the deterministic dev-workflow CLI (docs/PLAN.md §8). Parses argv against the command registry,
// runs the handler and maps errors to exit codes: 0 ok · 1 check/lint/validation failed ·
// 2 usage error · 3 precondition not met · 4 internal error.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { secretValues } from './lib/config.mjs';
import { EXIT, createOutput, formatError, usageError } from './lib/out.mjs';
import { pluginVersion } from './lib/paths.mjs';
import { loadWorkspace } from './lib/workspace.mjs';
import * as classify from './commands/classify.mjs';
import * as cycle from './commands/cycle.mjs';
import * as delivery from './commands/delivery.mjs';
import * as implementer from './commands/implementer.mjs';
import * as inspect from './commands/inspect.mjs';
import * as playbook from './commands/playbook.mjs';
import * as reviewer from './commands/reviewer.mjs';
import * as rules from './commands/rules.mjs';
import * as run from './commands/run.mjs';
import * as setup from './commands/setup.mjs';
import * as spec from './commands/spec.mjs';
import * as task from './commands/task.mjs';

// The commands that take positional arguments. Every other command refuses them, so a value that lost
// its quotes (--title Add the helper) is a usage error instead of a shorter title.
const POSITIONALS = ['playbook show', 'playbook read', 'rules show', 'run', 'prove'];

export const registry = [inspect, setup, playbook, rules, task, spec, classify, cycle, delivery, implementer, reviewer, run]
  .flatMap((module) => module.commands)
  .map((command) => ({ ...command, positionals: POSITIONALS.includes(command.path.join(' ')) }));

const GROUPS = [
  ['setup', 'Setup and inspection'],
  ['orchestrator', 'Orchestrator'],
  ['implementer', 'Implementer'],
  ['reviewer', 'Reviewer'],
];

function generalHelp() {
  const lines = [`cw ${pluginVersion()}: the dev-workflow CLI`, '', 'Usage: cw <command> [options]   (--json for machine output)', ''];
  for (const [group, title] of GROUPS) {
    const entries = registry.filter((command) => command.group === group);
    if (!entries.length) continue;
    lines.push(`${title}:`);
    for (const command of entries) lines.push(`  ${command.path.join(' ').padEnd(22)} ${command.summary}`);
    lines.push('');
  }
  lines.push('Exit codes: 0 ok · 1 check/lint/validation failed · 2 usage error · 3 precondition not met · 4 internal error.');
  lines.push('Details: cw help <command>');
  return `${lines.join('\n')}\n`;
}

const commandHelp = (command) => `${command.usage}\n\n${command.summary}\n`;

const describe = (command) => ({ command: command.path.join(' '), usage: command.usage, summary: command.summary });

// The general help or one command's, as text or, with --json, as one JSON document.
function helpText(command, json) {
  if (!json) return command ? commandHelp(command) : generalHelp();
  const value = command ? describe(command) : { version: pluginVersion(), commands: registry.map((entry) => ({ ...describe(entry), group: entry.group })) };
  return `${JSON.stringify(value, null, 2)}\n`;
}

// The registered command whose path is the longest prefix of the leading words.
function findCommand(argv) {
  const words = [];
  for (const token of argv) {
    if (token.startsWith('-')) break;
    words.push(token);
  }
  let best = null;
  for (const command of registry) {
    const matches = command.path.every((part, i) => words[i] === part);
    if (matches && (!best || command.path.length > best.path.length)) best = command;
  }
  return best;
}

export async function main(argv, io) {
  const json = argv.includes('--json');
  const secrets = [];
  const out = createOutput({ json, stdout: io.stdout, stderr: io.stderr, isTTY: io.isTTY, secrets });
  const fail = (error) => {
    const formatted = formatError(error, { json, secrets });
    if (formatted.stdout) io.stdout.write(formatted.stdout);
    io.stderr.write(formatted.stderr);
    return formatted.exitCode;
  };
  try {
    // --json changes only the form of the help, so cw --json and cw help --json are help too.
    const words = argv.filter((token) => token !== '--json');
    if (words.length === 0 || ['help', '--help', '-h'].includes(words[0])) {
      const target = words[0] === 'help' && words.length > 1 ? findCommand(words.slice(1)) : null;
      if (words.length > 1 && words[0] === 'help' && !target) throw usageError(`unknown command: ${words.slice(1).join(' ')}`, 'Run cw help for the list of commands.');
      io.stdout.write(helpText(target, json));
      return EXIT.ok;
    }
    const command = findCommand(argv);
    if (!command) {
      const names = argv.filter((token) => !token.startsWith('-')).join(' ');
      throw usageError(`unknown command: ${names || argv.join(' ')}`, 'Run cw help for the list of commands.');
    }
    const parsed = parseArgs(argv.slice(command.path.length), command.flags);
    if (parsed.flags.help) {
      io.stdout.write(helpText(command, json));
      return EXIT.ok;
    }
    const problems = [...parsed.unknown.map((flag) => `unknown option ${flag}`), ...parsed.errors];
    if (problems.length) throw usageError(problems.join('; '), `See cw help ${command.path.join(' ')}.`);
    if (parsed.positionals.length && !command.positionals) {
      const flag = parsed.afterBoolean[0];
      const fix = flag ? `--${flag} takes no value; remove the argument after it` : 'Quote values with spaces, e.g. --title "Add the helper"';
      throw usageError(`unexpected argument ${parsed.positionals[0]}`, `${fix}; see cw help ${command.path.join(' ')}.`);
    }
    let workspace;
    const ctx = {
      flags: parsed.flags,
      args: parsed.positionals,
      rest: parsed.rest,
      cwd: io.cwd,
      env: io.env,
      stdin: io.stdin,
      out,
      // Loaded on first use, so help, version and config validate work without a project.
      workspace() {
        if (!workspace) {
          workspace = loadWorkspace({ cwd: io.cwd });
          secrets.push(...secretValues(workspace.config));
        }
        return workspace;
      },
    };
    const code = await command.run(ctx);
    return typeof code === 'number' ? code : EXIT.ok;
  } catch (error) {
    return fail(error);
  }
}

export function runCli() {
  process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
  });
  main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdin: () => readFileSync(0, 'utf8'),
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: Boolean(process.stdout.isTTY),
  }).then((code) => {
    // exitCode instead of process.exit, so the output drains first.
    process.exitCode = code;
  });
}

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isMain()) runCli();
