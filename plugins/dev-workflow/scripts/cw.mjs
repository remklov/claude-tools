#!/usr/bin/env node
// cw — the deterministic half of the dev workflow. See plan/spec/02-cw-cli.md.
import { parseArgs } from './lib/args.mjs';
import { CwError, EXIT, print } from './lib/out.mjs';
import { pluginRoot, pluginVersion } from './lib/paths.mjs';
import { run } from './lib/proc.mjs';
import { doctor, init, playbook, profile, rules } from './commands/setup.mjs';
import { intake, mergeDriver, ticket } from './commands/tickets.mjs';
import { baseMovedCommand, classifyCommand, prCommand, specCommand, taskCommand } from './commands/tasks.mjs';
import {
  checks, commit, context, deps, gitCommand, investigationCommand, kb, mutateCommand, proveCommand, reportCommand,
  reviewCommand, runCommand, step, ws,
} from './commands/work.mjs';

const HELP = `cw — dev-workflow CLI (plugin ${pluginVersion()})

Setup and inspection
  cw init --detect | --write --profile <file> [--yes] | --merge-driver
  cw doctor [--fresh] [--json]
  cw profile show | validate [--file <f>]
  cw playbook show <role> [--task <id>]
  cw rules build [--check] | list | show <ID|alias> | applicable --task <id>

Tickets and claims
  cw intake <ticket> | --next             claim atomically + preflight (orchestrator's first command)
  cw ticket list [--available] | show <id> | claims | claim <id> | release <id> | steal <id> --reason <r>
  cw ticket gc | reserve-id <PREFIX> | done <id> | new-row --section <s> --cells '<json>' | migrate-status [--apply reset|claim]

Orchestrator
  cw task new --ticket <id> --slug <slug> --title <t> [--type feature|bugfix|chore] [--builds-on <ref>] [--parent <task>]
  cw spec save --task <id> < spec.md | show --task <id> | lint --task <id>
  cw classify --task <id> [--paths <globs>] | --set <s|m|l|xl> --why "<sentence>" [--override "<reason>"]
  cw task confirm --task <id> --note "<what the user confirmed>"
  cw task start --task <id>               → agent, description, prompt for the implementer
  cw task agent --task <id> --role <r> --id <agentId>
  cw task review --task <id>              → reviewer agent call or SendMessage text
  cw task return --task <id>              → SendMessage text for the implementer (or escalation)
  cw task investigate --task <id> --question "<q>"
  cw task phase --task <id> <phase> [--note]
  cw base-moved --task <id>
  cw pr title | body [--out f] [--stdin] | record --url <url>   (--task <id>)
  cw task end --task <id> --outcome done|escalated|aborted [--no-pr <reason>]
  cw task cleanup --task <id>
  cw task show [<id>] | list [--all]

Implementer
  cw ws setup --task <id>
  cw context --task <id>
  cw step --task <id> --done <n> [--note <text>]
  cw prove --task <id> --test <pkg>:<file>[::<name>] --change <file>[,<file>]
  cw checks [--task <id>] [--changed] [--package <id>] [--only <check,…>]
  cw kb check --task <id>
  cw commit msg --task <id> --summary "<text>" [--keyword K] [--body-file f] --out <file>
  cw git lint --task <id> [--last] | foreign-commits --task <id>
  cw report save --task <id> < report.json

Reviewer and investigator
  cw review scope --task <id> | save --task <id> < review.json
  cw mutate --task <id> --test <pkg>:<file>[::<name>] --remove <file>:<start>-<end> [--replace <text>]
  cw investigation save --task <id> < investigation.json

Other
  cw run <pack>:<script> [args]
  cw deps where <package>
  cw agents eject [--out .claude/agents]
  cw merge-driver ticket-table %O %A %B   (git merge driver)
  cw version | help

Exit codes: 0 ok · 1 failed/findings · 2 usage · 3 precondition · 4 internal.`;

async function agents(flags, [sub]) {
  if (sub !== 'eject') throw new CwError('usage: cw agents eject [--out <dir>]', { code: EXIT.usage });
  const out = typeof flags.out === 'string' ? flags.out : '.claude/agents';
  const args = [`${pluginRoot}/tools/generate-agents.mjs`, '--out', out, '--eject'];
  if (typeof flags.matrix === 'string') args.push('--matrix', flags.matrix);
  const result = run('node', args);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.code === 0) print('Set "workflow": { "agentPrefix": "" } in the profile so cw hands out the local agent names.');
  return result.code;
}

const COMMANDS = {
  init, doctor, profile, playbook, rules,
  intake, ticket, 'merge-driver': mergeDriver,
  task: taskCommand, spec: specCommand, classify: classifyCommand, 'base-moved': baseMovedCommand, pr: prCommand,
  ws, context, step, checks, prove: proveCommand, mutate: mutateCommand, kb, commit, git: gitCommand, report: reportCommand,
  review: reviewCommand, investigation: investigationCommand, run: runCommand, deps, agents,
  version: async () => print(`dev-workflow ${pluginVersion()} · node ${process.versions.node}`),
  help: async () => print(HELP),
};

// A closed pipe (cw … | head) ends output quietly instead of crashing.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw error;
});

async function main() {
  const { positionals, flags, rest } = parseArgs(process.argv.slice(2));
  const [command, ...args] = positionals;
  if (!command || flags.help || command === 'help') {
    print(HELP);
    return EXIT.ok;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    print(`unknown command ${command}\n\n${HELP}`);
    return EXIT.usage;
  }
  const code = await handler(flags, args, rest);
  return typeof code === 'number' ? code : EXIT.ok;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof CwError) {
      process.stderr.write(`cw: ${error.message}\n`);
      process.exitCode = error.code;
    } else {
      process.stderr.write(`cw: internal error: ${error?.stack ?? error}\n`);
      process.exitCode = EXIT.internal;
    }
  },
);
