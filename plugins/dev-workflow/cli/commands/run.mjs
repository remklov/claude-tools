// cw run <pack>:<script>: runs a pack script in the task's work tree, or in the work repo without
// --task (§6 point 3). The script's output and exit code pass through.
import { existsSync } from 'node:fs';
import { tryGit } from '../lib/git.mjs';
import { failedError, preconditionError, usageError } from '../lib/out.mjs';
import { SCRIPT_TIMEOUT_MS, packScript, resolvePacks, runPackScript } from '../lib/packs.mjs';
import { readTask } from '../lib/task.mjs';
import { taskDir, workTreeOf } from '../lib/workspace.mjs';

function runScript(ctx) {
  const [reference, extra] = ctx.args;
  if (ctx.flags.json) throw usageError('cw run has no --json: the script output and exit code pass through as they are.', `Run cw run ${reference ?? '<pack>:<script>'} without --json.`);
  if (!reference) throw usageError('cw run needs <pack>:<script>', 'e.g. cw run vitest:no-focus --task <id>.');
  if (extra) throw usageError(`unexpected argument ${extra}`, `Pass script arguments after --, e.g. cw run ${reference} -- --base <sha>.`);
  const ws = ctx.workspace();
  const packs = resolvePacks(ws);
  packScript(packs, reference);
  const task = ctx.flags.task ? readTask(ws, ctx.flags.task) : null;
  const workTree = task ? workTreeOf(ws, task) : ws.workRepo;
  if (!workTree || !existsSync(workTree)) {
    throw preconditionError(
      `work tree ${workTree ?? '(not set up yet)'} is missing`,
      task ? `Run cw ws setup --task ${task.id}, or check the task with cw task show --task ${task.id}.` : 'Check workspace.appRoot in .claude/dev-workflow/config.json.',
    );
  }
  let base = task?.base?.commit ?? '';
  if (ctx.flags.base) {
    base = tryGit(['rev-parse', '--verify', '--quiet', `${ctx.flags.base}^{commit}`], { cwd: workTree });
    if (!base) throw usageError(`--base ${ctx.flags.base} names no commit in ${workTree}`, 'Pass a branch, tag or commit of the work repo.');
  }
  const result = runPackScript(packs, reference, {
    workTree,
    configRoot: ws.configRoot,
    task: task?.id ?? '',
    taskDir: task ? taskDir(ws, task.id) : '',
    base,
    defaultBase: ws.config.git.defaultBase,
    packageDirs: ws.config.packages.map((pkg) => pkg.path),
    args: ctx.rest,
  });
  if (result.stdout) ctx.out.raw(result.stdout);
  if (result.stderr) ctx.out.rawError(result.stderr);
  if (result.timedOut) {
    throw failedError(`cw run ${reference}: timed out after ${SCRIPT_TIMEOUT_MS / 1000} s`, `Run the script in ${workTree} directly to see where it hangs.`);
  }
  return result.code;
}

export const commands = [
  {
    path: ['run'],
    group: 'implementer',
    usage: 'cw run <pack>:<script> [--task <id>] [--base <ref>] [-- <script args>…]',
    summary: "Run a pack script in the task's work tree (or the work repo)",
    flags: { task: 'string', base: 'string' },
    run: runScript,
  },
];
