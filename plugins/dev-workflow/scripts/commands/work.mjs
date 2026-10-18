// Implementer, reviewer and investigator commands.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runChecks } from '../lib/checks.mjs';
import { buildMessage, foreignCommits, lintRange } from '../lib/commit.mjs';
import { changedFiles, currentBranch, git, isClean, lines, tryGit } from '../lib/git.mjs';
import { color, CwError, EXIT, preconditionError, print, printJson, table, usageError } from '../lib/out.mjs';
import { packageById, packagesOf } from '../lib/profile.mjs';
import { packById, packScript } from '../lib/packs.mjs';
import { procedureApplies, proceduresFor } from '../lib/playbook.mjs';
import { mutate, prove } from '../lib/prove.mjs';
import { run } from '../lib/proc.mjs';
import { buildDevReport, fence, saveOrThrow, validateDevReport, validateInvestigation, validateReview } from '../lib/report.mjs';
import { applicableRules } from '../lib/rules.mjs';
import { parseSpec } from '../lib/spec.mjs';
import { loadTask, saveTask, setSteps, taskPath } from '../lib/task.mjs';
import { ticketAdapter } from '../lib/ticket/index.mjs';
import { emit, load, loadWithTask, need, readStdinJson, rulebook } from './common.mjs';

export async function ws(flags, [sub]) {
  if (sub !== 'setup') throw usageError('usage: cw ws setup --task <id>');
  const { ctx, profile, task } = loadWithTask(flags);
  if (profile.isolation.mode === 'in-place') {
    const app = join(ctx.mainCheckout, profile.isolation.appRoot);
    if (!isClean(app)) throw preconditionError(`${app} has uncommitted changes: report blocked.`);
    if (currentBranch(app) !== task.base.branch) throw preconditionError(`${app} is not on ${task.base.branch}: report blocked.`);
    git(['switch', '-c', task.branch], { cwd: app });
    task.worktree = app;
  } else {
    if (!ctx.isLinkedWorktree) throw preconditionError('Not inside a linked worktree. Implementers work only in their isolated worktree.');
    const branch = currentBranch(ctx.repoRoot);
    if (branch !== task.branch) {
      if (tryGit(['rev-parse', '--verify', `refs/heads/${task.branch}`], { cwd: ctx.repoRoot })) throw preconditionError(`Branch ${task.branch} already exists locally; ask the orchestrator.`);
      git(['branch', '-m', task.branch], { cwd: ctx.repoRoot });
    }
    if (task.buildsOn) {
      if (task.buildsOn.startsWith('origin/')) git(['fetch', '--quiet', 'origin'], { cwd: ctx.repoRoot, timeoutMs: 120_000 });
      if (!isClean(ctx.repoRoot)) throw preconditionError('Worktree is not clean; cannot reset to the builds-on branch.');
      git(['reset', '--hard', task.buildsOn], { cwd: ctx.repoRoot });
    }
    const missing = profile.isolation.symlink.filter((dir) => !existsSync(join(ctx.repoRoot, dir)));
    if (missing.length) print(color.yellow(`missing in the worktree (checks may fail): ${missing.join(', ')}`));
    task.worktree = ctx.repoRoot;
  }
  saveTask(ctx, task, profile);
  setSteps(ctx, profile, task, 1, 'workspace');
  print(`workspace ready: ${task.worktree} on ${task.branch} (base ${task.base.branch}@${task.base.commit.slice(0, 10)})`);
}

export async function context(flags) {
  const base = loadWithTask(flags);
  const { ctx, profile, packs, task } = base;
  const spec = parseSpec(readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8'));
  const trigger = { paths: spec.paths, areas: task.areas, text: `${spec.title}\n${spec.body('Requirements')}` };
  const docs = [...new Set(task.packages.flatMap((id) => packageById(profile, id)?.docs ?? []))];
  const procedures = proceduresFor(ctx, packs, 'implementer').filter((procedure) => procedureApplies(procedure, trigger));
  const book = rulebook(base);
  const files = [...new Set([...spec.paths, ...changedFiles(ctx.repoRoot, task.base?.commit)])];
  const scoped = applicableRules(book, files.length ? files : task.packages.map((id) => `${packageById(profile, id)?.paths[0]}/x`));
  setSteps(ctx, profile, task, 2, 'understand');
  emit(flags, { docs, procedures: procedures.map((p) => ({ name: p.name, path: p.path, description: p.description })), rules: scoped.map((r) => ({ id: r.id, title: r.title })) }, (v) => {
    print(color.bold('Read first:'));
    for (const doc of v.docs) print(`- ${doc}`);
    print(color.bold('\nProcedures that apply:'));
    for (const p of v.procedures) print(`- ${p.name}: ${p.description}\n  ${p.path}`);
    print(color.bold('\nRules for these paths (full text: cw rules show <ID>):'));
    for (const r of v.rules) print(`- ${r.id} — ${r.title}`);
  });
}

export async function step(flags) {
  const { ctx, profile, task } = loadWithTask(flags);
  setSteps(ctx, profile, task, Number(need(flags, 'done')), typeof flags.note === 'string' ? flags.note : undefined);
  print(`step ${task.steps.done}/${task.steps.total}`);
}

export async function checks(flags) {
  const base = flags.task ? loadWithTask(flags) : load(flags);
  const { ctx, profile, task } = base;
  const commit = typeof flags.base === 'string' ? flags.base : task?.base?.commit;
  const only = [].concat(flags.package ?? []).flatMap((p) => String(p).split(','));
  const onlyChecks = typeof flags.only === 'string' ? flags.only.split(',') : [];
  const result = await runChecks(ctx, profile, {
    base: commit, changed: Boolean(flags.changed) || Boolean(task), only, onlyChecks,
    outDir: task ? join(ctx.stateDir, 'tasks', task.id) : null,
    log: flags.json ? () => {} : (line) => print(color.dim(line)),
  });
  if (task && result.overall === 'pass') setSteps(ctx, profile, task, 6, 'checks');
  emit(flags, result, () => {
    const rows = result.packages.flatMap((pkg) => pkg.checks.map((check) => ({ package: pkg.id, check: check.name, result: check.result, seconds: Math.round(check.durationMs / 1000), log: check.log })));
    print(table(rows, ['package', 'check', 'result', 'seconds', 'log']) || 'no checks for the changed packages');
    for (const pkg of result.packages) for (const check of pkg.checks.filter((c) => c.result !== 'pass')) print(`\n${color.red(`${pkg.id}:${check.name}`)}\n${check.tail}`);
    if (result.unowned.length) print(color.yellow(`files outside any package: ${result.unowned.join(', ')}`));
    print(`\noverall: ${result.overall}${result.file ? ` · ${result.file}` : ''}`);
  });
  return result.overall === 'fail' ? EXIT.failed : EXIT.ok;
}

export async function proveCommand(flags) {
  const { ctx, profile, packs, task } = loadWithTask(flags);
  const change = [].concat(flags.change ?? []).flatMap((c) => String(c).split(','));
  if (!change.length) throw usageError('--change <file>[,<file>] is required');
  const proof = await prove(ctx, profile, packs, task, { test: need(flags, 'test'), change });
  if (proof.failedWithout && proof.passesWith) setSteps(ctx, profile, task, 5, 'prove');
  emit(flags, proof, () => print(proof.failedWithout && proof.passesWith
    ? color.green(`proved: fails without the change (${proof.failureLine ?? 'non-zero exit'}), passes with it`)
    : color.red(`not proved: ${!proof.failedWithout ? `the test passes without the change\n${proof.tailWithout ?? ''}` : `the test fails with the change\n${proof.tailWith ?? ''}`}`)));
  return proof.failedWithout && proof.passesWith ? EXIT.ok : EXIT.failed;
}

export async function mutateCommand(flags) {
  const { ctx, profile, packs, task } = loadWithTask(flags);
  const result = await mutate(ctx, profile, packs, task, { test: need(flags, 'test'), remove: need(flags, 'remove'), replace: flags.replace });
  emit(flags, result, () => print(result.killed ? color.green(`mutation killed: the test fails without ${result.removed}`) : color.red(`mutation survived: the test still passes without ${result.removed} (blocking CORE-TEST-SPEC finding)`)));
  return result.killed ? EXIT.ok : EXIT.failed;
}

export async function kb(flags, [sub]) {
  if (sub !== 'check') throw usageError('usage: cw kb check --task <id>');
  const { ctx, profile, task } = loadWithTask(flags);
  const files = changedFiles(ctx.repoRoot, task.base.commit);
  const kbConf = profile.knowledgeBase;
  const warnings = [];
  const touchesSource = files.some((file) => !/\.(md|MD)$/.test(file) && !/(^|\/)(docs|plan)\//.test(file));
  if (kbConf.features && task.type === 'feature' && touchesSource && !files.includes(kbConf.features)) warnings.push(`feature task without a change to ${kbConf.features}`);
  if (kbConf.lessons && task.type === 'bugfix' && !files.includes(kbConf.lessons)) warnings.push(`bug fix without an entry in ${kbConf.lessons} (needed for non-trivial bugs)`);
  if (profile.tickets.deleteRowWhenDone && profile.tickets.file && task.ticket !== profile.git.noTicketKey) {
    const adapter = ticketAdapter(ctx, profile);
    if (adapter.exists(task.ticket)) warnings.push(`${task.ticket} still has its row in ${profile.tickets.file}; delete it with cw ticket done ${task.ticket} when the ticket is fully done`);
  }
  setSteps(ctx, profile, task, 7, 'knowledge base');
  emit(flags, { warnings }, () => print(warnings.length ? warnings.map((w) => `- ${w}`).join('\n') : 'knowledge base: nothing missing'));
}

export async function commit(flags, [sub]) {
  if (sub !== 'msg') throw usageError('usage: cw commit msg --task <id> --summary "<text>" [--keyword K] [--flag F] [--body-file f] --out <file>');
  const { profile, task } = loadWithTask(flags);
  const body = typeof flags['body-file'] === 'string' ? readFileSync(flags['body-file'], 'utf8') : typeof flags.body === 'string' ? flags.body : '';
  const message = buildMessage(profile, { ticket: task.ticket, summary: need(flags, 'summary'), keyword: flags.keyword, flag: flags.flag, body });
  const out = need(flags, 'out', 'file to write the message to');
  writeFileSync(out, message);
  print(`wrote ${out}; append your attribution lines if your instructions require them, then: git commit -F ${out}`);
}

export async function gitCommand(flags, [sub]) {
  const { ctx, profile, task } = loadWithTask(flags);
  if (sub === 'lint') {
    const result = lintRange(ctx, profile, task, { last: Boolean(flags.last) });
    if (!result.errors.length && result.commits > 0) setSteps(ctx, profile, task, 8, 'commit');
    emit(flags, result, () => print(result.findings.length ? result.findings.map((f) => `${f.commit ?? 'branch'}: ${f.message}`).join('\n') : `git conventions ok (${result.commits} commit(s))`));
    return result.errors.length ? EXIT.failed : EXIT.ok;
  }
  if (sub === 'foreign-commits') {
    const foreign = foreignCommits(ctx, task);
    emit(flags, foreign, () => print(foreign.length ? `${foreign.map((c) => `${c.sha} ${c.subject}${c.alsoOn.length ? ` (also on ${c.alsoOn.join(', ')})` : ''}`).join('\n')}\nFix: git rebase --onto ${task.base.commit} <last foreign commit> (keep only this task's commits)` : 'only this task\'s commits'));
    return foreign.length ? EXIT.failed : EXIT.ok;
  }
  throw usageError('usage: cw git <lint|foreign-commits> --task <id>');
}

export async function reportCommand(flags, [sub]) {
  if (sub !== 'save') throw usageError('usage: cw report save --task <id> < report.json');
  const { ctx, profile, task } = loadWithTask(flags);
  const input = readStdinJson();
  const round = Number(flags.round ?? task.round);
  const report = buildDevReport(ctx, task, input, round);
  saveOrThrow(taskPath(ctx, task, `report-${round}.json`), report, validateDevReport(ctx, task, report), 'dev report');
  setSteps(ctx, profile, loadTask(ctx, task.id), 9, `report ${report.status}`);
  print(fence(report));
}

export async function reviewCommand(flags, [sub]) {
  const base = loadWithTask(flags);
  const { ctx, profile, task } = base;
  if (sub === 'scope') {
    const files = changedFiles(ctx.repoRoot, task.base.commit);
    const { packages, unowned } = packagesOf(profile, files);
    const outside = files.filter((file) => !task.packages.some((id) => packagesOf(profile, [file]).packages.some((pkg) => pkg.id === id)));
    const stat = tryGit(['diff', '--stat', `${task.base.commit}...HEAD`], { cwd: ctx.repoRoot }) ?? '';
    const foreign = foreignCommits(ctx, task);
    const spec = parseSpec(readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8'));
    const added = (tryGit(['diff', `${task.base.commit}...HEAD`], { cwd: ctx.repoRoot }) ?? '').split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n').toLowerCase();
    const nonGoalHits = spec.nonGoals.filter((goal) => goal.split(/\W+/).filter((word) => word.length > 5).some((word) => added.includes(word.toLowerCase())));
    const scripts = [];
    for (const ref of ['vitest:no-focus', 'docker:image-pins', 'node-npm:dependency-changes']) {
      const [packId] = ref.split(':');
      if (!packById(base.packs, packId)) continue;
      const { pack, path } = packScript(base.packs, ref);
      const outcome = run('node', [path, '--base', task.base.commit], { cwd: ctx.repoRoot, env: { CW_REPO_ROOT: ctx.repoRoot, CW_PACK_OPTIONS: JSON.stringify(pack.options) } });
      scripts.push({ script: ref, exit: outcome.code, output: outcome.stdout.trim() });
    }
    const result = { files, packages: packages.map((p) => p.id), outsideTaskPackages: outside, unowned, foreignCommits: foreign, nonGoalHits, scripts, stat };
    return emit(flags, result, () => {
      print(stat);
      if (outside.length) print(color.yellow(`files outside the task's packages: ${outside.join(', ')}`));
      if (foreign.length) print(color.red(`foreign commits (blocking scope finding): ${foreign.map((c) => c.sha).join(', ')}`));
      if (nonGoalHits.length) print(color.yellow(`check non-goals: ${nonGoalHits.join(' | ')}`));
      for (const s of scripts) if (s.output) print(`${s.script}: ${s.output}`);
    });
  }
  if (sub === 'save') {
    const input = readStdinJson();
    const reviewRound = Number(flags.round ?? task.round);
    const files = changedFiles(ctx.repoRoot, task.base.commit);
    const applicable = applicableRules(rulebook(base), files).map((rule) => rule.id);
    const mutations = JSON.parse(existsSync(taskPath(ctx, task, `mutations-${reviewRound}.json`)) ? readFileSync(taskPath(ctx, task, `mutations-${reviewRound}.json`), 'utf8') : '[]');
    const review = { kind: 'review', version: 1, task: task.id, round: reviewRound, mutations, ...input };
    review.rulesChecked = [...new Set([...(input.rulesChecked ?? [])])];
    saveOrThrow(taskPath(ctx, task, `review-${reviewRound}.json`), review, validateReview(ctx, task, review, applicable), 'review');
    return print(fence(review));
  }
  throw usageError('usage: cw review <scope|save> --task <id>');
}

export async function investigationCommand(flags, [sub]) {
  if (sub !== 'save') throw usageError('usage: cw investigation save --task <id> < investigation.json');
  const { ctx, task } = loadWithTask(flags);
  const value = { kind: 'investigation', version: 1, task: task.id, ...readStdinJson() };
  saveOrThrow(taskPath(ctx, task, 'investigation.json'), value, validateInvestigation(value), 'investigation');
  print(fence(value));
}

// Everything after <pack>:<script> goes to the script, except cw's own --task/--cwd/--json.
function scriptArgs(reference) {
  const raw = process.argv.slice(process.argv.indexOf(reference) + 1);
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '--task' || raw[i] === '--cwd') i += 1;
    else if (raw[i] !== '--json' && raw[i] !== '--' && !raw[i].startsWith('--task=') && !raw[i].startsWith('--cwd=')) out.push(raw[i]);
  }
  return out;
}

export async function runCommand(flags, [reference]) {
  const base = load(flags);
  const { pack, path } = packScript(base.packs, need({ reference }, 'reference', '<pack>:<script>'));
  const task = flags.task ? loadTask(base.ctx, String(flags.task)) : null;
  const result = run('node', [path, ...scriptArgs(reference)], {
    cwd: base.ctx.repoRoot,
    env: {
      CW_REPO_ROOT: base.ctx.repoRoot, CW_COMMON_DIR: base.ctx.commonDir, CW_PROFILE: base.ctx.profilePath,
      CW_PACK_OPTIONS: JSON.stringify(pack.options), CW_TASK: task?.id ?? '', CW_BASE: task?.base?.commit ?? '',
      CW_TASK_DIR: task ? join(base.ctx.stateDir, 'tasks', task.id) : '', CW_DEFAULT_BASE: base.profile.git.defaultBase,
    },
    timeoutMs: 10 * 60_000,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.code;
}

export async function deps(flags, [sub, name]) {
  if (sub !== 'where' || !name) throw usageError('usage: cw deps where <package>');
  const { ctx, profile } = load(flags);
  const found = [];
  for (const dir of ['.', ...profile.packages.map((pkg) => pkg.paths[0])]) {
    const lockFile = join(ctx.repoRoot, dir, 'package-lock.json');
    if (!existsSync(lockFile)) continue;
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    for (const [key, value] of Object.entries(lock.packages ?? {})) {
      if (key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)) found.push({ lockfile: join(dir, 'package-lock.json'), path: join(dir, key), version: value.version });
    }
  }
  emit(flags, found, () => print(found.length ? table(found, ['version', 'path', 'lockfile']) : `${name} not found in any package-lock.json`));
}

export { printJson, CwError, lines };
