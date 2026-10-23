// Implementer commands (§6 implementer steps 1-8, §8): ws setup, context, checks, commit msg, commit lint,
// prove (with --recheck for the reviewer), report save and step. Every --task command works in the work
// tree recorded in task.json, whatever the cwd (D5).
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { listFlag } from '../lib/args.mjs';
import { checksExitCode, runChecks } from '../lib/checks.mjs';
import { buildMessage, isTemplated, lintRange, normalizeFlags, normalizeKeyword } from '../lib/commit.mjs';
import { packageById } from '../lib/config.mjs';
import { readText, writeAtomic } from '../lib/fsx.mjs';
import { changedFiles, currentBranch, tryGit } from '../lib/git.mjs';
import { EXIT, preconditionError, usageError } from '../lib/out.mjs';
import { resolvePacks } from '../lib/packs.mjs';
import { applicableForTask, applicableRules, buildRulebook } from '../lib/rules.mjs';
import { prove, recheck, singleTestTemplate } from '../lib/prove.mjs';
import { fence, saveDevReport } from '../lib/report.mjs';
import { testSpecRule } from '../lib/review.mjs';
import { STEPS_TOTAL, isActive, markStep } from '../lib/task.mjs';
import { isNoTicket } from '../lib/ticket.mjs';
import { gitCwdNote, gitForm, taskPath } from '../lib/workspace.mjs';
import { requireWorkTree, setupWorkTree } from '../lib/ws.mjs';
import { emit, loadTaskContext, readStdinJson, readStdinText, requireFlag } from './common.mjs';

const quote = (text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`);
const short = (sha) => (sha ? sha.slice(0, 10) : '(none)');

// The fixes of failing results; --json results carry them as fix too (§8: every failure names the fix).
const CHECKS_FIX = 'fix the failures (never loosen a check), then run cw checks --changed again.';
// It names the rule the reviewer's finding cites: review save refuses CORE-TEST-SPEC when it does not apply.
const recheckFix = (ws, task) => `a proof that no longer holds is a blocking ${testSpecRule(applicableForTask(ws, task).rules.map((rule) => rule.id)).finding}.`;
function proofFix(proof) {
  if (proof.failedWithout) return 'fix the code or the test, then run cw prove again.';
  if (!proof.crossPackage) return 'make the test fail when the change is reverted, then run cw prove again.';
  return `the test passes with the change reverted. If it reaches ${proof.change.join(', ')} through node_modules (another workspace package), it loads the work tree's copy, which prove does not revert (§8): prove the change with a test inside that package. Otherwise make the test fail when the change is reverted. Then run cw prove again.`;
}

function recheckState(result) {
  if (result.stale) return `stale (${result.stale}); not counted`;
  if (result.holds) return 'holds';
  if (result.failedControl) return `does not hold (passes in the work tree, fails at HEAD in a clean checkout${result.failureLine ? `: ${result.failureLine}` : ''})`;
  return `does not hold (${result.failedWithout ? 'fails with the change' : 'passes without the change'})`;
}

function activeTask(ctx) {
  const { ws, task } = loadTaskContext(ctx);
  if (!isActive(task)) throw preconditionError(`Task ${task.id} has ended (${task.outcome}).`, 'Nothing to do for an ended task; the orchestrator starts a new one with cw task new.');
  return { ws, task };
}

// The progress band shows the implementer's steps only (§11).
const stepDone = (ws, task, n, note) => {
  if (task.phase === 'implement') markStep(ws, task.id, n, note);
};

// The fix of failing commit lint findings. The PR/MR title finding (lintRange) sits on the first commit,
// which git commit --amend cannot reach.
function lintFix(ws, task, findings) {
  const errors = findings.filter((finding) => finding.level === 'error');
  const title = errors.find((finding) => finding.kind === 'pr-title');
  const git = gitForm(ws);
  const fixes = [];
  if (errors.some((finding) => finding !== title)) fixes.push(`Reword the commits: ${git} commit --amend -F <file> for the last one, otherwise rebuild the branch`);
  if (title) {
    fixes.push(`Shorten the summary of the first commit ${title.commit}, which the PR/MR title is built from: interactive rebase is not available to agents, so rebuild the branch with ${git} reset --soft ${task.base.commit} and new commits (cw commit msg, then ${git} commit -F <file>), or ask the orchestrator`);
  }
  return `${fixes.join('. ')}; then run cw commit lint again.`;
}

// The path with symlinks resolved as far as it exists, so /var and /private/var compare equal.
function canonical(path) {
  const rest = [];
  let dir = path;
  while (!existsSync(dir) && dirname(dir) !== dir) {
    rest.unshift(basename(dir));
    dir = dirname(dir);
  }
  return join(realpathSync(dir), ...rest);
}

const isInside = (path, dir) => {
  const rel = relative(dir, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

function printChecks(ctx, result) {
  const { out } = ctx;
  const rows = result.packages.flatMap((pkg) =>
    pkg.checks.map((check) => ({ package: pkg.id, check: check.name, result: check.result, seconds: Math.round(check.durationMs / 1000) })),
  );
  const empty = result.overall === 'none' ? `nothing changed since ${short(result.base)}` : 'no checks ran';
  out.print(out.table(rows, ['package', 'check', 'result', 'seconds']) || empty);
  for (const pkg of result.packages) {
    for (const check of pkg.checks.filter((item) => item.result !== 'pass')) {
      out.print(`\n${out.color.red(`${pkg.id}:${check.name} ${check.result}`)} (log: ${check.log})\n${check.tail}`);
    }
  }
  for (const warning of result.warnings) out.warn(warning);
  out.print(`\noverall: ${result.overall}${result.file ? ` · ${result.file}` : ''}`);
  if (result.overall === 'fail') out.print(`Fix: ${CHECKS_FIX}`);
}

function printContext(ctx, value) {
  const { out } = ctx;
  out.print(`Task ${value.task} (${value.mode}): work tree ${value.workTree}`);
  out.print(value.mode === 'in-place'
    ? `Git: ${value.git} … exactly in this form, from the project root ${value.projectRoot} (the Bash cwd stays there; never cd); file paths in it are relative to the work tree, as listed under Changed so far, or absolute`
    : 'Git: plain git … inside your worktree; no git -C and no $(…) around git');
  if (value.cwdNote) out.print(`Note: ${value.cwdNote}`);
  const base = value.base ? `${value.base.branch}@${short(value.base.commit)}` : '(not recorded)';
  out.print(`Branch: ${value.branch} (now on ${value.currentBranch || 'a detached HEAD'}) · base ${base}`);
  out.print('Packages:');
  for (const pkg of value.packages) {
    const checks = Object.entries(pkg.checks).map(([name, command]) => `${name}: ${command}`).join(' · ') || 'no checks';
    out.print(`  ${pkg.id} (${pkg.path}): ${checks} · single test: ${pkg.testSingle ?? 'none'}`);
  }
  out.print(`Changed so far: ${value.changedFiles.join(', ') || 'nothing'}`);
  out.print(`Rules that apply (full text: cw rules show <ID>; the set grows with your changes): ${value.rules.map((rule) => `${rule.id}${rule.severity === 'blocking' ? '' : ' (advisory)'}`).join(', ') || 'none'}`);
  if (value.spec) out.print(`Spec: ${value.spec}`);
  out.print('Next:');
  for (const command of value.next) out.print(`  ${command}`);
}

// --body-file - reads the body from stdin, so no agent writes a file for it.
function readBody(ctx) {
  if (ctx.flags['body-file'] === '-') return readStdinText(ctx, "cw commit msg … --body-file - <<'EOF' … EOF");
  const file = resolve(ctx.cwd, ctx.flags['body-file']);
  const text = readText(file);
  if (text === null) throw usageError(`--body-file ${file} cannot be read`, 'Pass a readable file with the commit body.');
  return text;
}

// --out is optional (default: the task dir); a file inside the work tree would be committed (Decided in P2).
function messageFile(ctx, ws, task, workTree) {
  const fallback = taskPath(ws, task.id, 'commit-msg.txt');
  if (!ctx.flags.out) return fallback;
  const out = resolve(ctx.cwd, ctx.flags.out);
  if (isInside(canonical(out), realpathSync(workTree))) {
    throw usageError(`--out ${out} is inside the work tree ${workTree}; the message file would end up in a commit.`, `Leave out --out (default ${fallback}) or pass a path outside the work tree.`);
  }
  return out;
}

export const commands = [
  {
    path: ['ws', 'setup'],
    group: 'implementer',
    usage: 'cw ws setup --task <id>',
    summary: 'Create the task branch in the work tree (in-place: app/ on its base; worktree: your isolated worktree)',
    flags: { task: 'string' },
    run(ctx) {
      const { ws, task } = activeTask(ctx);
      const result = setupWorkTree(ws, task, { cwd: ctx.cwd });
      emit(ctx, result, (value) =>
        ctx.out.print(`workspace ready: ${value.workTree} on ${value.branch} (base ${value.base.branch}@${short(value.base.commit)})${value.created ? '' : ', already set up'}`),
      );
    },
  },
  {
    path: ['context'],
    group: 'implementer',
    usage: 'cw context --task <id>',
    summary: 'Print the work tree, the git form to use, base, packages with checks and the next commands',
    flags: { task: 'string' },
    run(ctx) {
      const { ws, task } = activeTask(ctx);
      const workTree = requireWorkTree(ws, task);
      const ids = task.packages.length ? task.packages : ws.config.packages.map((pkg) => pkg.id);
      const packs = resolvePacks(ws);
      const changed = task.base?.commit ? changedFiles(workTree, task.base.commit) : [];
      const rules = applicableRules(buildRulebook(ws, packs), { files: [...new Set([...(task.paths ?? []), ...changed])], areas: task.areas });
      const spec = taskPath(ws, task.id, 'spec.md');
      const { keywords } = ws.config.git.conventions.commit;
      const keywordFlag = keywords.length ? ` --keyword ${keywords.join('|')}` : '';
      const git = gitForm(ws);
      const value = {
        task: task.id,
        mode: ws.mode,
        workTree,
        git,
        projectRoot: ws.configRoot,
        cwdNote: gitCwdNote(ws),
        branch: task.branch,
        currentBranch: currentBranch(workTree),
        base: task.base,
        packages: ids.map((id) => packageById(ws.config, id)).filter(Boolean).map((pkg) => ({
          id: pkg.id, path: pkg.path, checks: pkg.checks, testSingle: singleTestTemplate(ws, pkg, packs)?.template ?? null,
        })),
        changedFiles: changed,
        rules: rules.map((rule) => ({ id: rule.id, title: rule.title, severity: rule.severity, protected: rule.protected })),
        spec: existsSync(spec) ? spec : null,
        next: [
          `cw rules applicable --task ${task.id}`,
          `cw checks --changed --task ${task.id}`,
          // With -C <appRoot>, git reads the paths from the work tree, not from the project root.
          ws.mode === 'in-place' ? `${git} add <files relative to ${ws.appRoot}/, or absolute>` : `${git} add <files>`,
          `cw commit msg --task ${task.id} --summary "<Imperative summary>"${keywordFlag}`,
          `${git} commit -F ${quote(taskPath(ws, task.id, 'commit-msg.txt'))}`,
          `cw commit lint --task ${task.id}`,
          `cw prove --task ${task.id} --test <package>:<file> --change <file>`,
          `cw report save --task ${task.id} < <scratchpad>/${task.id}-report-1.json`,
        ],
      };
      stepDone(ws, task, 2, 'context');
      emit(ctx, value, (data) => printContext(ctx, data));
    },
  },
  {
    path: ['checks'],
    group: 'implementer',
    usage: 'cw checks [--task <id>] [--changed] [--package <id>[,<id>]] [--only <check>[,<check>]]',
    summary: "Run the checks of the changed, the given or all packages in the task's work tree",
    flags: { task: 'string', changed: 'boolean', package: 'list', only: 'list' },
    async run(ctx) {
      let ws;
      let task = null;
      let workTree;
      let base;
      if (ctx.flags.task) {
        ({ ws, task } = activeTask(ctx));
        workTree = requireWorkTree(ws, task);
        base = task.base?.commit ?? null;
      } else {
        ws = ctx.workspace();
        workTree = ws.workRepo;
        if (!existsSync(workTree)) throw preconditionError(`The work repo ${workTree} does not exist.`, `Clone the application into ${ws.appRoot}, or pass --task <id>.`);
        base = tryGit(['merge-base', 'HEAD', ws.config.git.defaultBase], { cwd: workTree });
      }
      const result = await runChecks({
        ws,
        task,
        workTree,
        base,
        changed: Boolean(ctx.flags.changed),
        packageIds: listFlag(ctx.flags, 'package'),
        only: listFlag(ctx.flags, 'only'),
        onProgress: (line) => ctx.out.print(ctx.out.color.dim(line)),
      });
      if (task && result.overall === 'pass') stepDone(ws, task, 5, 'checks');
      emit(ctx, result.overall === 'fail' ? { ...result, fix: CHECKS_FIX } : result, (value) => printChecks(ctx, value));
      return checksExitCode(result);
    },
  },
  {
    path: ['commit', 'msg'],
    group: 'implementer',
    usage: 'cw commit msg --task <id> --summary <text> [--keyword <FEATURE|BUGFIX|TASK|DOCS>] [--flag <!!!|SECURITY>] [--body-file <file>|-] [--trailer "<Key: value>"]… [--out <file>]',
    summary: 'Write the commit message of the git preset to a file for git commit -F (body from a file or stdin, trailers last)',
    flags: { task: 'string', summary: 'string', keyword: 'string', flag: 'list', 'body-file': 'string', trailer: 'list', out: 'string' },
    run(ctx) {
      const { ws, task } = activeTask(ctx);
      const preset = ws.config.git.conventions;
      const workTree = requireWorkTree(ws, task);
      const summary = requireFlag(ctx.flags, 'summary', 'Pass --summary "<Imperative summary>".');
      // A templated preset (commit.summary) has no keywords or flags; values passed anyway are ignored.
      let keyword = null;
      let flags = [];
      if (isTemplated(preset)) {
        if (ctx.flags.keyword || listFlag(ctx.flags, 'flag').length) ctx.out.warn(`the git preset ${preset.id} has no keywords or flags; --keyword and --flag are ignored`);
      } else {
        keyword = normalizeKeyword(preset, requireFlag(ctx.flags, 'keyword', `Pass --keyword ${preset.commit.keywords.join('|')}.`));
        flags = normalizeFlags(preset, listFlag(ctx.flags, 'flag'));
      }
      const body = ctx.flags['body-file'] ? readBody(ctx) : '';
      // Each --trailer is one line as given (no comma splitting): "Co-Authored-By: Name <mail>".
      const trailers = (ctx.flags.trailer ?? []).map((line) => line.trim());
      const badTrailer = trailers.find((line) => !/^[A-Za-z][A-Za-z-]*: \S/.test(line));
      if (badTrailer !== undefined) throw usageError(`--trailer "${badTrailer}" is not a "Key: value" line`, 'Pass each trailer as --trailer "Co-Authored-By: Name <mail>".');
      const file = messageFile(ctx, ws, task, workTree);
      const { message, warnings } = buildMessage(preset, { ticket: task.ticket, noTicket: isNoTicket(ws.config, task.ticket), summary, keyword, flags, body, trailers });
      writeAtomic(file, message);
      const next = `${gitForm(ws)} commit -F ${quote(file)}`;
      for (const warning of warnings) ctx.out.warn(warning);
      emit(ctx, { file, message, warnings, next }, (value) => {
        ctx.out.print(`wrote ${value.file}`);
        ctx.out.print(`Run: ${value.next} (attribution lines your instructions require go in with --trailer; never edit the file)`);
      });
    },
  },
  {
    path: ['commit', 'lint'],
    group: 'implementer',
    usage: 'cw commit lint --task <id> [--last]',
    summary: "Check the task's branch name and commits (or only the last one) against the git conventions",
    flags: { task: 'string', last: 'boolean' },
    run(ctx) {
      const { ws, task } = activeTask(ctx);
      const workTree = requireWorkTree(ws, task);
      const result = lintRange({ config: ws.config, workTree, task, last: Boolean(ctx.flags.last) });
      const ok = result.errors === 0 && result.commits.length > 0;
      const fix = result.commits.length ? lintFix(ws, task, result.findings) : `There are no commits on ${task.branch} since the base: commit your work first (step 6).`;
      if (ok) stepDone(ws, task, 6, 'commit');
      emit(ctx, { ...result, ok, fix: ok ? null : fix }, (value) => {
        for (const finding of value.findings) ctx.out.print(`${finding.commit ?? 'branch'}: ${finding.level}: ${finding.message}`);
        if (ok) ctx.out.print(`git conventions ok (${value.commits.length} commit(s))`);
        else ctx.out.print(`commit lint failed: ${value.errors} error(s), ${value.commits.length} commit(s)\nFix: ${fix}`);
      });
      return ok ? EXIT.ok : EXIT.failed;
    },
  },
  {
    path: ['prove'],
    group: 'implementer',
    usage: 'cw prove --task <id> --test <package>:<file>[::<test name>] --change <file>[,<file>] [<file> …] | cw prove --task <id> --recheck',
    summary: 'Prove a test fails with the change reverted and passes with it; --recheck re-runs the recorded proofs',
    flags: { task: 'string', test: 'string', change: 'list', recheck: 'boolean' },
    async run(ctx) {
      const { ws, task } = activeTask(ctx);
      if (ctx.flags.recheck) {
        if (ctx.flags.test || ctx.flags.change || ctx.args.length) throw usageError('--recheck takes no --test or --change', `Run cw prove --task ${task.id} --recheck alone.`);
        const entry = await recheck({ ws, task });
        emit(ctx, entry.allHold ? entry : { ...entry, fix: recheckFix(ws, task) }, (value) => {
          if (value.empty) return ctx.out.print('no holding proofs to recheck');
          for (const result of value.results) ctx.out.print(`${result.proof} ${result.test}: ${recheckState(result)}`);
          if (!value.allHold) ctx.out.print(`Fix: ${value.fix}`);
        });
        return entry.allHold ? EXIT.ok : EXIT.failed;
      }
      const test = requireFlag(ctx.flags, 'test', 'Pass --test <package>:<file>[::<test name>].');
      const proof = await prove({ ws, task, test, change: [...listFlag(ctx.flags, 'change'), ...ctx.args] });
      if (proof.holds && proof.crossPackage) {
        ctx.out.warn(`${proof.id} reverts files outside the package of its test: imports across workspaces resolve through node_modules to the work tree, so this proof may be weaker (§8).`);
      }
      emit(ctx, proof.holds ? proof : { ...proof, fix: proofFix(proof) }, (value) => {
        if (value.holds) return ctx.out.print(ctx.out.color.green(`${value.id} proved: fails without the change (${value.failureLine ?? `exit ${value.exitWithout}`}), passes with it`));
        const why = value.failedWithout ? 'the test fails with the change' : 'the test passes without the change';
        ctx.out.print(`${ctx.out.color.red(`${value.id} not proved: ${why}`)}\n${value.tailWith ?? value.tailWithout ?? ''}\nFix: ${value.fix}`);
      });
      return proof.holds ? EXIT.ok : EXIT.failed;
    },
  },
  {
    path: ['report', 'save'],
    group: 'implementer',
    usage: 'cw report save --task <id> < <JSON file>',
    summary: 'Validate and save your report (JSON on stdin); end your turn with the printed JSON fence',
    flags: { task: 'string' },
    run(ctx) {
      const { ws, task } = activeTask(ctx);
      const input = readStdinJson(ctx, `cw report save --task ${task.id} < <scratchpad>/${task.id}-report-1.json`);
      const { report } = saveDevReport({ ws, task, input });
      for (const warning of report.warnings) ctx.out.warn(warning);
      if (ctx.flags.json) ctx.out.data(report);
      else ctx.out.print(fence(report));
    },
  },
  {
    path: ['step'],
    group: 'implementer',
    usage: 'cw step --task <id> --done <1-8> [--note <text>]',
    summary: 'Mark playbook step n as done (the progress band shows step n/8)',
    flags: { task: 'string', done: 'string', note: 'string' },
    run(ctx) {
      const { ws, task } = activeTask(ctx);
      const raw = requireFlag(ctx.flags, 'done', `Pass --done 1 to ${STEPS_TOTAL}.`);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > STEPS_TOTAL) throw usageError(`--done ${raw} is not a step number`, `Pass --done 1 to ${STEPS_TOTAL}.`);
      const { task: updated } = markStep(ws, task.id, n, ctx.flags.note ?? '');
      emit(ctx, { task: task.id, steps: updated.steps }, (value) => ctx.out.print(`step ${value.steps.done}/${value.steps.total}`));
    },
  },
];
