// cw rules build [--check] | list | show <ID> | applicable --task <id> (§7 Queries).
import { failedError, usageError } from '../lib/out.mjs';
import { OUT_DIR, applicableForTask, buildRulebook, checkRulebook, findRule, writeRulebook } from '../lib/rules.mjs';
import { emit, loadTaskContext } from './common.mjs';

const summaryOf = (rule) => ({
  id: rule.id,
  title: rule.title,
  severity: rule.severity,
  protected: rule.protected,
  scope: rule.scope,
  source: rule.source,
});

const printRule = (ctx, rule) => {
  const tags = [rule.severity, rule.protected ? 'protected' : null].filter(Boolean).join(' · ');
  ctx.out.print(`## ${rule.id} — ${rule.title} · ${tags}`);
  ctx.out.print(ctx.out.color.dim(`scope ${rule.scope} · source ${rule.source}`));
  ctx.out.print('');
  ctx.out.print(rule.body);
};

function rejectArguments(ctx, command) {
  if (ctx.args.length) throw usageError(`unexpected argument ${ctx.args[0]}`, `See cw help ${command}.`);
}

function build(ctx) {
  rejectArguments(ctx, 'rules build');
  const ws = ctx.workspace();
  const book = buildRulebook(ws);
  if (ctx.flags.check) {
    // A failing check names its fix in the JSON too, as every failure does (§8).
    const result = { ...checkRulebook(ws, book), fix: null };
    if (!result.isCurrent) result.fix = 'Run cw rules build.';
    emit(ctx, result, () => {
      if (result.isCurrent) ctx.out.print('rulebook up to date');
      else {
        ctx.out.print('rulebook out of date:');
        for (const problem of result.problems) ctx.out.print(`- ${problem.message}`);
        ctx.out.print('Run: cw rules build');
      }
      for (const note of result.notes) ctx.out.print(ctx.out.color.dim(`note: ${note}`));
    });
    return result.isCurrent ? 0 : 1;
  }
  const { files, deleted } = writeRulebook(ws, book);
  const result = { rules: book.rules.length, files, deleted, disabled: book.disabled, inactive: book.inactive, warnings: book.warnings };
  emit(ctx, result, () => {
    ctx.out.print(`compiled ${result.rules} rules into ${files.length} files in ${OUT_DIR}/`);
    for (const file of deleted) ctx.out.print(`deleted ${file}`);
    for (const item of book.disabled) ctx.out.print(ctx.out.color.yellow(`disabled: ${item.id} (${item.reason})`));
    if (book.inactive.length) ctx.out.print(ctx.out.color.dim(`inactive: ${book.inactive.map((item) => `${item.id} (${item.reason})`).join(', ')}`));
    for (const warning of book.warnings) ctx.out.warn(warning);
  });
  return 0;
}

function list(ctx) {
  rejectArguments(ctx, 'rules list');
  const book = buildRulebook(ctx.workspace());
  const rows = book.rules.map((rule) => ({ ...summaryOf(rule), modified: rule.modified ?? null }));
  emit(ctx, rows, () => {
    const table = rows.map((row) => ({ ...row, severity: `${row.severity}${row.protected ? ' protected' : ''}` }));
    ctx.out.print(ctx.out.table(table, ['id', 'severity', 'scope', 'source', 'title']));
  });
  return 0;
}

function show(ctx) {
  const [given, extra] = ctx.args;
  if (!given) throw usageError('cw rules show needs a rule ID', 'Pass the ID, e.g. cw rules show CORE-SCOPE; list them with cw rules list.');
  if (extra) throw usageError(`unexpected argument ${extra}`, 'Pass one rule ID.');
  const id = given.toUpperCase();
  const found = findRule(buildRulebook(ctx.workspace()), id);
  if (!found) throw usageError(`Unknown rule ${id}.`, 'List the rules with: cw rules list');
  if (found.disabled) throw failedError(`${id} is disabled in this project: ${found.disabled.reason}`, `Remove ${id} from rules.disable in .claude/dev-workflow/config.json to use it.`);
  if (found.inactive) throw failedError(`${id} is inactive: ${found.inactive.reason}`, 'It applies once its pack option or package areas match; cw rules list shows the active rules.');
  const { rule } = found;
  emit(ctx, { ...summaryOf(rule), globs: rule.globs, modified: rule.modified ?? null, body: rule.body }, () => printRule(ctx, rule));
  return 0;
}

function applicable(ctx) {
  rejectArguments(ctx, 'rules applicable');
  const { ws, task } = loadTaskContext(ctx);
  const result = applicableForTask(ws, task);
  const value = { ...result, rules: result.rules.map((rule) => ({ ...summaryOf(rule), body: rule.body })) };
  emit(ctx, value, () => {
    ctx.out.print(`${result.rules.length} rules apply to task ${task.id} (${result.files.length} changed files in ${result.workTree})`);
    for (const rule of result.rules) {
      ctx.out.print('');
      printRule(ctx, rule);
    }
  });
  return 0;
}

export const commands = [
  {
    path: ['rules', 'build'],
    group: 'setup',
    usage: 'cw rules build [--check] [--json]',
    summary: 'Compile .claude/rules/dev-workflow/ and the lock; --check reports drift without writing',
    flags: { check: 'boolean' },
    run: build,
  },
  {
    path: ['rules', 'list'],
    group: 'setup',
    usage: 'cw rules list [--json]',
    summary: 'List the active rules of this project',
    flags: {},
    run: list,
  },
  {
    path: ['rules', 'show'],
    group: 'setup',
    usage: 'cw rules show <ID> [--json]',
    summary: 'Show one rule with its full text',
    flags: {},
    run: show,
  },
  {
    path: ['rules', 'applicable'],
    group: 'setup',
    usage: 'cw rules applicable --task <id> [--json]',
    summary: "The global rules plus the scoped rules matching the task's changed files and areas, with full text",
    flags: { task: 'string' },
    run: applicable,
  },
];
