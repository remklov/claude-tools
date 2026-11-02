// The PreToolUse guard catalog (§9, D3, D12): deny-only, each refusal says why and what to do
// instead. A backstop for the playbooks, not a security boundary; keep it small.
//   G-ORCH-EDIT       the main session that owns an active task: Edit/Write/NotebookEdit in the project
//   G-CD              that main session and workflow subagents: a cd/pushd outside a ( … ) subshell
//   G-AGENT-PARAMS    everyone: model/effort on Agent calls; worktree mode: an implementer without isolation
//   G-FORCE           everyone: git push --force, -f, --force-with-lease, +refspec
//   G-PUSH            workflow subagents: git push, gh pr create/merge, glab mr create/merge
//   G-REVIEWER-WRITE  reviewer: git write subcommands (config and remote writes too); redirection, tee,
//                     sed -i, cp, mv, rm, find -delete, git --output … into the repo; Edit, NotebookEdit,
//                     and Write into the project
//   G-DEPS            workflow subagents: the packs' dependency commands (npm install …)
//   G-COMMANDS        workflow subagents: guards.commands of the config and the packs
//   G-PORTS           workflow subagents: guards.ports of the config and the packs (bound or contacted,
//                     not mentioned in grep, echo, cw or a git commit)
//   G-DEVSERVER       workflow subagents: dev servers when guards.devServer is never
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { activeTasksOwnedBy } from '../../cli/lib/task.mjs';
import { canonical, isInside, roleOf } from './context.mjs';
import { commandName, parseShell } from './shell.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const IMPLEMENTER_AGENT = /^(dev-workflow:)?implementer-(s|m|l|xl)$/;
const CONFIG = '.claude/dev-workflow/config.json';

const deny = (id, reason) => ({ id, reason: `${id}: ${reason}` });

// --- command shapes ---------------------------------------------------------------------------------

const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix']);

// git [global options] <sub> <args>; null for other commands.
export function gitCall(argv) {
  if (argv[0] !== 'git') return null;
  let i = 1;
  while (i < argv.length && argv[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(argv[i]) ? 2 : 1;
  return { sub: argv[i] ?? null, args: argv.slice(i + 1) };
}

// Package-manager options that take the next word as their value, so `npm -w app install` is install.
const VALUE_OPTIONS = new Set(['-w', '--workspace', '--prefix', '-C', '--cwd', '--dir', '--filter', '-F', '--cache', '--userconfig', '--registry', '--loglevel', '-R', '--repo']);

export function positionals(args, values = VALUE_OPTIONS) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') break;
    if (arg.startsWith('-') && arg !== '-') {
      if (values.has(arg)) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

// The command a package runner starts: npx/bunx <bin> …, npm|pnpm|yarn|bun exec|dlx|x <bin> …
function runnerTarget(argv) {
  const [name, ...args] = argv;
  let rest = null;
  if (name === 'npx' || name === 'bunx') rest = args;
  else if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) {
    const verb = args.findIndex((arg) => ['exec', 'dlx', 'x'].includes(arg));
    if (verb !== -1 && positionals(args)[0] === args[verb]) rest = args.slice(verb + 1);
  }
  if (!rest) return null;
  let i = 0;
  while (i < rest.length && rest[i].startsWith('-')) i += ['-p', '--package', '-c', '--call'].includes(rest[i]) ? 2 : 1;
  const target = rest.slice(i);
  return target.length ? [commandName(target[0]), ...target.slice(1)] : null;
}

// A guard command such as "npm install" matches when the program is the same and its first positional
// arguments are the remaining words; also behind npx and the package runners.
export function matchesCommand(argv, pattern) {
  const words = pattern.trim().split(/\s+/).filter(Boolean);
  if (!argv.length || !words.length) return false;
  if (argv[0] === commandName(words[0])) {
    const given = positionals(argv.slice(1));
    if (words.slice(1).every((word, i) => given[i] === word)) return true;
  }
  const inner = runnerTarget(argv);
  return inner ? matchesCommand(inner, pattern) : false;
}

// --- G-FORCE, G-PUSH ----------------------------------------------------------------------------------

// git push --force, -f (also in a cluster such as -fu), --force-with-lease[=…], or a +refspec: the
// git-push manual names --force and "the optional leading + to a refspec" as the ways to force.
const forcesPush = (args) =>
  args.some((arg) => arg === '--force' || arg.startsWith('--force-with-lease') || /^-[A-Za-z0-9]*f[A-Za-z0-9]*$/.test(arg) || /^\+./.test(arg));

const PR_COMMANDS = { gh: ['pr', ['create', 'new', 'merge']], glab: ['mr', ['create', 'new', 'for', 'merge', 'accept']] };

function deliveryCommand(argv) {
  const git = gitCall(argv);
  if (git?.sub === 'push') return 'git push';
  const spec = PR_COMMANDS[argv[0]];
  if (!spec) return null;
  const [noun, verb] = positionals(argv.slice(1));
  return noun === spec[0] && spec[1].includes(verb) ? `${argv[0]} ${noun} ${verb}` : null;
}

// --- G-REVIEWER-WRITE ---------------------------------------------------------------------------------

const GIT_WRITES = new Set([
  'add', 'am', 'checkout', 'cherry-pick', 'clean', 'commit', 'fetch', 'gc', 'merge', 'mv', 'prune', 'pull', 'push', 'rebase', 'reset', 'restore', 'revert', 'rm', 'switch', 'update-index', 'update-ref',
]);
const BRANCH_WRITE_FLAGS = /^(--delete|--move|--copy|--force|--set-upstream-to(=.*)?|--unset-upstream|--edit-description|--track(=.*)?|--no-track|-[A-Za-z]*[dDmMcCfut][A-Za-z]*)$/;
const BRANCH_LIST_FLAGS = /^(--list|--all|--remotes|--contains|--no-contains|--merged|--no-merged|--points-at|--show-current|--format|--sort)(=.*)?$|^-[A-Za-z]*[lar][A-Za-z]*$/;
const TAG_WRITE_FLAGS = /^(--delete|--annotate|--sign|--local-user(=.*)?|--force|--message(=.*)?|--file(=.*)?|--edit|-[A-Za-z]*[dasufmFe][A-Za-z]*)$/;
const TAG_LIST_FLAGS = /^(--list|--contains|--no-contains|--merged|--no-merged|--points-at|--sort|--format|--verify)(=.*)?$|^-[lnv][0-9]*$/;

// git config reads one key; a value, a write option or a write subcommand changes .git/config.
const CONFIG_WRITE_FLAGS = /^(--add|--unset|--unset-all|--replace-all|--rename-section|--remove-section|-e|--edit)$/;
const CONFIG_READ_FLAGS = /^(--get|--get-all|--get-regexp|--get-urlmatch|--get-color|--get-colorbool|-l|--list)$/;
const CONFIG_VALUE_OPTIONS = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value']);

function configWrites(args) {
  if (args.some((arg) => CONFIG_WRITE_FLAGS.test(arg))) return true;
  if (args.some((arg) => CONFIG_READ_FLAGS.test(arg))) return false;
  const given = positionals(args, CONFIG_VALUE_OPTIONS);
  if (['set', 'unset', 'rename-section', 'remove-section', 'edit'].includes(given[0])) return true;
  if (['get', 'list'].includes(given[0])) return false;
  return given.length > 1;
}

export function gitWrites({ sub, args }) {
  if (GIT_WRITES.has(sub)) return true;
  const first = args.find((arg) => !arg.startsWith('-'));
  switch (sub) {
    case 'config':
      return configWrites(args);
    case 'remote':
      return ['add', 'remove', 'rm', 'rename', 'set-url', 'set-head', 'set-branches', 'prune', 'update'].includes(first);
    case 'apply':
      return args.includes('--apply') || !args.some((arg) => ['--check', '--stat', '--numstat', '--summary'].includes(arg));
    case 'branch':
      return args.some((arg) => BRANCH_WRITE_FLAGS.test(arg)) || (Boolean(first) && !args.some((arg) => BRANCH_LIST_FLAGS.test(arg)));
    case 'tag':
      return args.some((arg) => TAG_WRITE_FLAGS.test(arg)) || (Boolean(first) && !args.some((arg) => TAG_LIST_FLAGS.test(arg)));
    case 'stash':
      return !['list', 'show'].includes(first);
    case 'worktree':
      return first !== 'list';
    case 'notes':
      return Boolean(first) && !['list', 'show'].includes(first);
    default:
      return false;
  }
}

// -i alone or after switches without a value (-ni, -pi); not -Mstrict or -Ilib.
const IN_PLACE = { sed: /^-[nrEsuz]*i/, perl: /^-[lnpaswtTWX]*i/ };

// sed -i / perl -i: the files after the script (-e/-f values or the first positional).
function inPlaceFiles(argv) {
  const [name, ...args] = argv;
  const inPlace = args.some((arg) => arg === '--in-place' || arg.startsWith('--in-place=') || IN_PLACE[name].test(arg));
  if (!inPlace) return [];
  const files = [];
  let script = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      files.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('--expression') || arg.startsWith('--file')) {
      script = true;
      if (!arg.includes('=')) i += 1;
      continue;
    }
    if (/^-[A-Za-z]+$/.test(arg) && /[ef]$/.test(arg)) {
      script = true;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    if (arg === '') continue;
    if (!script) script = true;
    else files.push(arg);
  }
  return files;
}

const operands = (args) => args.filter((arg) => !arg.startsWith('-') && arg !== '');

function targetDirectory(args) {
  const index = args.findIndex((arg) => arg === '-t' || arg === '--target-directory');
  if (index !== -1) return args[index + 1] ?? null;
  return args.find((arg) => arg.startsWith('--target-directory='))?.slice('--target-directory='.length) ?? null;
}

// The values of an option given as `--name value` or `--name=value`.
function optionValues(args, names) {
  return args.flatMap((arg, i) => {
    if (names.includes(arg)) return args[i + 1] === undefined ? [] : [args[i + 1]];
    const name = names.find((candidate) => candidate.startsWith('--') && arg.startsWith(`${candidate}=`));
    return name ? [arg.slice(name.length + 1)] : [];
  });
}

// The files git writes outside the repository's own state: git diff/log --output, format-patch -o.
function gitOutputTargets(argv) {
  const git = gitCall(argv);
  if (!git) return [];
  return optionValues(git.args, git.sub === 'format-patch' ? ['--output', '-o', '--output-directory'] : ['--output']);
}

// What find removes or changes: its start paths, with -delete or an -exec/-execdir/-ok/-okdir command
// that writes {} (rm, sed -i, …), and the files of -fprint/-fls.
function findTargets(args) {
  let i = 0;
  while (i < args.length && /^-([HLP]|D|O\d*)$/.test(args[i])) i += args[i] === '-D' ? 2 : 1;
  const starts = [];
  while (i < args.length && !/^[-(!]/.test(args[i])) starts.push(args[i++]);
  const roots = starts.length ? starts : ['.'];
  const targets = [];
  for (; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-delete') targets.push(...roots);
    else if (['-fprint', '-fprint0', '-fls', '-fprintf'].includes(arg) && args[i + 1] !== undefined) targets.push(args[i + 1]);
    else if (['-exec', '-execdir', '-ok', '-okdir'].includes(arg)) {
      let end = i + 1;
      while (end < args.length && args[end] !== ';' && args[end] !== '+') end += 1;
      const inner = args.slice(i + 1, end);
      if (inner.length) {
        for (const root of roots) {
          const argv = [commandName(inner[0]), ...inner.slice(1)].map((word) => word.replaceAll('{}', root));
          targets.push(...writeTargets({ argv, redirects: [] }));
        }
      }
      i = end;
    }
  }
  return targets;
}

// The paths a command writes: redirections, tee, sed -i, perl -i, dd of=, the coreutils that create,
// change or remove files, git --output, and find -delete/-exec. A cp source is read, not written (§9).
export function writeTargets(command) {
  const targets = command.redirects.filter((redirect) => redirect.write).map((redirect) => redirect.target);
  const [name, ...args] = command.argv;
  switch (name) {
    case 'tee':
    case 'touch':
    case 'rm':
    case 'rmdir':
    case 'mkdir':
    case 'truncate':
      targets.push(...operands(args.filter((arg, i) => !(name === 'truncate' && ['-s', '--size', '-r', '--reference'].includes(args[i - 1])))));
      break;
    case 'mv':
      targets.push(...operands(args));
      break;
    case 'cp':
    case 'ln':
    case 'install': {
      const dir = targetDirectory(args);
      const rest = operands(args.filter((arg, i) => !['-t', '--target-directory'].includes(args[i - 1])));
      if (dir) targets.push(dir);
      else if (rest.length) targets.push(rest.at(-1));
      break;
    }
    case 'sed':
    case 'perl':
      targets.push(...inPlaceFiles(command.argv));
      break;
    case 'dd':
      targets.push(...args.filter((arg) => arg.startsWith('of=')).map((arg) => arg.slice(3)));
      break;
    case 'git':
      targets.push(...gitOutputTargets(command.argv));
      break;
    case 'find':
      targets.push(...findTargets(args));
      break;
    default:
      break;
  }
  return targets;
}

// A literal path inside one of the roots. Words with an unresolved expansion are not judged, except
// $PWD and ~.
function insideRoots(target, cwd, roots) {
  let path = String(target);
  if (!path || path.startsWith('/dev/')) return false;
  path = path.replace(/^(\$PWD|\$\{PWD\})(?=\/|$)/, cwd);
  if (path === '~' || path.startsWith('~/')) path = join(homedir(), path.slice(1));
  if (/[$`]|^~/.test(path)) return false;
  const absolute = canonical(resolve(cwd, path));
  return roots.some((root) => isInside(absolute, root));
}

// An Edit/Write/NotebookEdit path inside one of the roots. The tools take the path literally, so a
// $ (Remix and TanStack route files such as app/routes/$id.tsx) is a character, not an expansion.
function literalInsideRoots(file, cwd, roots) {
  const absolute = canonical(resolve(cwd, String(file)));
  return roots.some((root) => isInside(absolute, root));
}

// The directories that hold the project: the config root, the work repo and the main checkout.
function projectRoots(ws) {
  const roots = [ws.configRoot, ws.workRepo];
  if (basename(ws.commonDir) === '.git') roots.push(dirname(ws.commonDir));
  return [...new Set(roots.map((root) => canonical(root)))];
}

// --- G-PORTS, G-DEVSERVER -----------------------------------------------------------------------------

// Commands that only read or record text: a port in their words is a mention (grep "localhost:5173",
// a commit summary), not a bind or a connection. git counts only outside its network subcommands.
const TEXT_COMMANDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'cat', 'sed', 'echo', 'printf', 'cw']);
const GIT_NETWORK = new Set(['clone', 'fetch', 'pull', 'push', 'ls-remote', 'remote', 'submodule', 'archive', 'daemon', 'instaweb', 'send-email', 'request-pull']);

const mentionsOnly = (argv) => TEXT_COMMANDS.has(argv[0]) || (argv[0] === 'git' && !GIT_NETWORK.has(gitCall(argv).sub));

function usesPort(command, port) {
  if (mentionsOnly(command.argv)) return false;
  const p = String(port);
  const words = [...command.assignments, ...command.argv];
  return words.some((word, i) => {
    const previous = words[i - 1] ?? '';
    return new RegExp(`:${p}(?![0-9])`).test(word)
      || new RegExp(`^--?[A-Za-z-]*port=${p}$`, 'i').test(word)
      || new RegExp(`^[A-Za-z_]*PORT=${p}$`, 'i').test(word)
      || new RegExp(`^-p${p}$`).test(word)
      || (word === p && /^(--?[A-Za-z-]*port|-p)$/i.test(previous));
  });
}

const DEV_SCRIPT = /^(dev|start|serve|preview|watch)(:.+)?$/;
// Options of the dev binaries that take the next word as their value (vite --config vite.config.ts,
// next -p 3001), so the value is not read as the subcommand.
const DEV_VALUE_OPTIONS = new Set(['-c', '--config', '-m', '--mode', '--port', '-p', '--base', '--host', '-H', '--hostname', '-l', '--logLevel']);
// Commands that start a long-running server, by common convention (a heuristic, not a full list).
// vite's positional is a subcommand or the project root (a path) of its dev server.
const DEV_BINARIES = {
  vite: (sub) => !sub || ['dev', 'serve', 'preview'].includes(sub) || /[./]/.test(sub),
  next: (sub) => ['dev', 'start'].includes(sub),
  nuxt: (sub) => ['dev', 'preview', 'start'].includes(sub),
  nuxi: (sub) => ['dev', 'preview', 'start'].includes(sub),
  astro: (sub) => ['dev', 'preview'].includes(sub),
  webpack: (sub) => sub === 'serve',
  ng: (sub) => sub === 'serve',
  'react-scripts': (sub) => sub === 'start',
  tsx: (sub) => sub === 'watch',
  'webpack-dev-server': () => true,
  nodemon: () => true,
  'http-server': () => true,
  'live-server': () => true,
  serve: () => true,
};

export function isDevServer(argv) {
  const [name, ...args] = argv;
  const given = positionals(args);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) {
    if (['run', 'run-script'].includes(given[0])) return DEV_SCRIPT.test(given[1] ?? '');
    if (name === 'npm' ? given[0] === 'start' : DEV_SCRIPT.test(given[0] ?? '')) return true;
  }
  if (name === 'node' && args.some((arg) => arg === '--watch' || arg.startsWith('--watch='))) return true;
  if (Object.hasOwn(DEV_BINARIES, name) && DEV_BINARIES[name](positionals(args, DEV_VALUE_OPTIONS)[0])) return true;
  const inner = runnerTarget(argv);
  return inner ? isDevServer(inner) : false;
}

// --- the catalog --------------------------------------------------------------------------------------

function orchestratorEdit({ input, ws }) {
  const owned = activeTasksOwnedBy(ws, input.session_id);
  if (!owned.length) return null;
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  // Files outside the project (scratch files, Claude Code's own memory) are not the task's code.
  if (file && !literalInsideRoots(file, ws.cwd, projectRoots(ws))) return null;
  const task = owned[0];
  const others = owned.length > 1 ? ` (and ${owned.slice(1).map((entry) => entry.id).join(', ')})` : '';
  return deny('G-ORCH-EDIT', `this session orchestrates task ${task.id}${others} (phase ${task.phase}), so it does not edit project files itself (D3). Delegate the change: in implement the implementer does it (SendMessage to it, or the Agent call cw prints); put text into the task through cw on stdin (cw spec save --task ${task.id}); or, after asking the user, end the task first with cw task end --task ${task.id} --outcome <done|escalated|aborted>, then edit.`);
}

// The reviewer writes only its review file, into its scratchpad outside the project (R8).
function reviewerEdit({ input, ws }) {
  const tool = input.tool_name;
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (tool === 'Write' && file && !literalInsideRoots(file, ws.cwd, projectRoots(ws))) return null;
  return deny('G-REVIEWER-WRITE', `the reviewer is read-only, and ${tool} ${tool === 'Write' ? `of ${file} writes inside the project` : 'changes a file'}. Report the change as a finding; write only the review file into your scratchpad directory and save it with cw review save --task <id> < <that file>.`);
}

// A cd that stays: the git and cw forms of the workflow assume the Bash cwd does not move.
function persistentCd({ input, ws, role }) {
  if (!role && (input.agent_id || !activeTasksOwnedBy(ws, input.session_id).length)) return null;
  return deny('G-CD', `cd moves the Bash working directory for every later command of this ${role ? 'agent' : 'session'}, and the git and cw forms of the workflow expect it to stay. Use absolute paths and git exactly in the form cw prints (git -C …); ${role ? 'to run one command in another directory, use a subshell: (cd <dir> && <command>)' : 'the orchestrator never changes the directory'}.`);
}

function agentParams({ input, ws }) {
  const call = input.tool_input ?? {};
  const given = ['model', 'effort'].filter((key) => call[key] !== undefined && call[key] !== null && call[key] !== '');
  if (given.length) {
    return deny('G-AGENT-PARAMS', `${given.join(' and ')} ${given.length > 1 ? 'are' : 'is'} fixed per agent by the plugin (D4). Call the Agent tool again without ${given.join(' and ')}; for a dev-workflow agent, with exactly the parameters cw printed.`);
  }
  if (ws.mode === 'worktree' && IMPLEMENTER_AGENT.test(String(call.subagent_type ?? '')) && call.isolation !== 'worktree') {
    return deny('G-AGENT-PARAMS', `in worktree mode an implementer works in its own worktree (D4, D5). Call the Agent tool again with isolation: "worktree" — exactly the parameters cw task start printed.`);
  }
  return null;
}

// Each Bash command of a workflow subagent against the role's guards; null when none applies.
function bashGuards({ command, role, ws, guards, cwd, roots }) {
  const { argv } = command;
  const git = gitCall(argv);
  if (git?.sub === 'push' && forcesPush(git.args)) {
    return deny('G-FORCE', 'a force push rewrites published history and is never part of the workflow. Push without --force/-f/--force-with-lease/+refspec; if the branch really needs it, the user does it in their own terminal.');
  }
  if (!role) return null;
  const delivery = deliveryCommand(argv);
  if (delivery) {
    return deny('G-PUSH', `${delivery} is the orchestrator's step after the user confirms (cw pr command prints it). ${role === 'implementer' ? 'Commit your work on the task branch and finish with cw report save.' : 'Finish your review with cw review save.'}`);
  }
  if (role === 'reviewer') {
    if (git && gitWrites(git)) {
      return deny('G-REVIEWER-WRITE', `the reviewer is read-only, and git ${git.sub} changes the repository. Read with git log/diff/show and cw review scope; report what must change as a finding in cw review save.`);
    }
    const target = writeTargets(command).find((path) => insideRoots(path, cwd, roots));
    if (target !== undefined) {
      return deny('G-REVIEWER-WRITE', `the reviewer is read-only, and this writes ${target} inside the project. Report the change as a finding in cw review save; to try something, copy the files to a temp dir outside the project and work there.`);
    }
  }
  const dependency = guards.dependencyCommands.find((pattern) => matchesCommand(argv, pattern));
  if (dependency) {
    return deny('G-DEPS', `${dependency} changes the dependencies, which needs the user (CORE-DEPENDENCIES). ${role === 'implementer' ? 'Report blocked (cw report save, status blocked) with the package, the version and why you need it.' : 'Raise the missing or changed dependency as a finding in cw review save.'}`);
  }
  const blocked = [...ws.config.guards.commands, ...guards.commands].find((pattern) => matchesCommand(argv, pattern));
  if (blocked) {
    return deny('G-COMMANDS', `"${blocked}" is blocked in this project (guards.commands in ${CONFIG} or an active pack). Reach the goal another way, or ${role === 'implementer' ? 'report blocked and say why you need it' : 'note it in your review'}.`);
  }
  const port = [...new Set([...ws.config.guards.ports, ...guards.ports])].find((candidate) => usesPort(command, candidate));
  if (port !== undefined) {
    return deny('G-PORTS', `port ${port} belongs to the developer's own environment (guards.ports in ${CONFIG}). Use the test setup instead, for example supertest on the app or a server on port 0.`);
  }
  if (ws.config.guards.devServer === 'never' && isDevServer(argv)) {
    return deny('G-DEVSERVER', `this project runs no dev servers in agents (guards.devServer is never in ${CONFIG}). Verify with the tests and the typecheck, and list every check only a browser can confirm as an open point with tag manual.`);
  }
  return null;
}

// The deny of the first guard that applies to the tool call, as { id, reason }; null otherwise.
export function evaluate({ input, ws, guards }) {
  const tool = input.tool_name;
  if (EDIT_TOOLS.has(tool)) {
    if (!input.agent_id) return orchestratorEdit({ input, ws });
    return roleOf(input.agent_type) === 'reviewer' ? reviewerEdit({ input, ws }) : null;
  }
  if (tool === 'Agent') return agentParams({ input, ws });
  if (tool !== 'Bash') return null;
  const role = roleOf(input.agent_type);
  const roots = role === 'reviewer' ? projectRoots(ws) : [];
  let cwd = canonical(input.cwd || ws.cwd);
  for (const command of parseShell(input.tool_input?.command)) {
    // A literal cd moves the base of the relative paths that follow it.
    if (['cd', 'pushd'].includes(command.argv[0])) {
      const stays = command.persistent ? persistentCd({ input, ws, role }) : null;
      if (stays) return stays;
      const dir = operands(command.argv.slice(1))[0];
      if (dir === undefined) cwd = homedir();
      else if (!/[$`]/.test(dir)) cwd = canonical(resolve(cwd, dir.replace(/^~(?=\/|$)/, homedir())));
      continue;
    }
    const hit = bashGuards({ command, role, ws, guards, cwd, roots });
    if (hit) return hit;
  }
  return null;
}

// The hook output for a deny.
export const denyOutput = (hit) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: hit.reason },
});
