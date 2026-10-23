// cw classify (§6 O4): the packages, areas and minimum complexity of a task from its spec, then the
// orchestrator's choice with a one-sentence reason. A misclassified report (O7) classifies again.
import { listFlag } from '../lib/args.mjs';
import { classifyTask, writeClassification } from '../lib/cycle.mjs';
import { readText } from '../lib/fsx.mjs';
import { COMPLEXITIES, complexityRank } from '../lib/guardrails.mjs';
import { failedError, preconditionError, usageError } from '../lib/out.mjs';
import { buildRulebook } from '../lib/rules.mjs';
import { isActive, readRoundFile, transition, updateTask } from '../lib/task.mjs';
import { taskPath } from '../lib/workspace.mjs';
import { emit, loadTaskContext, requireFlag } from './common.mjs';
import { lintTaskSpec } from './spec.mjs';

const normalizePath = (path) => path.replace(/^\.\//, '');

function compute(ctx, ws, task) {
  if (!isActive(task)) throw preconditionError(`Task ${task.id} has ended (${task.outcome}).`, 'Start a new task with cw task new.');
  const report = task.phase === 'implement' ? readRoundFile(ws, task, 'report').data : null;
  if (!['spec', 'classify', 'confirm'].includes(task.phase) && report?.status !== 'misclassified') {
    throw preconditionError(`Task ${task.id} is in ${task.phase}; it is classified before cw task start.`, 'Only a misclassified report (cw report show) classifies a started task again.');
  }
  const book = buildRulebook(ws);
  const { errors } = lintTaskSpec(ws, task, book);
  if (errors.length) {
    throw failedError(`The spec of ${task.id} has ${errors.length} error(s):\n- ${errors.join('\n- ')}`, `Fix them and save the spec again: cw spec save --task ${task.id}.`, { errors });
  }
  const result = classifyTask(ws, readText(taskPath(ws, task.id, 'spec.md'), ''), listFlag(ctx.flags, 'paths').map(normalizePath));
  const reclassify = task.phase === 'implement';
  updateTask(ws, task.id, (current) => {
    if (current.phase !== 'classify') transition(current, 'classify', { note: reclassify ? `misclassified: ${report.misclassified.reason}` : 'classified', by: 'cw classify' });
    if (reclassify) {
      current.previousComplexity = current.complexity;
      current.resetPending = true;
    }
    current.complexity = null;
    current.confirmation = null;
    current.minComplexity = result.minComplexity;
    current.packages = result.packages;
    current.areas = result.areas;
    current.paths = result.paths;
  }, { expectRev: task.rev });
  writeClassification(ws, task, result);
  const value = {
    task: task.id,
    ...result,
    previousComplexity: reclassify ? task.complexity : null,
    suggested: reclassify ? report.misclassified.suggested : null,
    next: `cw classify --task ${task.id} --set <${COMPLEXITIES.filter((c) => complexityRank(c) >= complexityRank(result.minComplexity)).join('|')}> --why "<one sentence>"`,
  };
  emit(ctx, value, () => {
    const { out } = ctx;
    out.print(`packages: ${value.packages.join(', ') || '-'} · areas: ${value.areas.join(', ') || '-'}${value.unowned.length ? ` · outside every package: ${value.unowned.join(', ')}` : ''}`);
    out.print(`minimum complexity: ${value.minComplexity}`);
    for (const reason of value.reasons) out.print(`  ${reason}`);
    for (const warning of value.warnings) out.warn(warning);
    if (reclassify) out.print(`Reclassifying: it was ${value.previousComplexity}, the implementer suggests ${value.suggested}. Tell the user the old and the new complexity.`);
    out.print(`Next: ${value.next}. Between two levels, pick the higher one.`);
  });
}

function choose(ctx, ws, task) {
  const level = String(ctx.flags.set).toLowerCase();
  if (!COMPLEXITIES.includes(level)) throw usageError(`--set ${ctx.flags.set} is not a complexity`, `Use one of ${COMPLEXITIES.join(', ')}.`);
  const why = requireFlag(ctx.flags, 'why', 'Pass --why "<one sentence: why this complexity>".');
  if (task.phase !== 'classify' || !task.minComplexity) {
    throw preconditionError(`Task ${task.id} has no classification to choose from (phase ${task.phase}).`, `Run cw classify --task ${task.id} first.`);
  }
  const below = complexityRank(level) < complexityRank(task.minComplexity);
  // §5: going below the minimum needs --override "<reason>", approved by the user.
  const override = String(ctx.flags.override ?? '').trim();
  if (below && !override) {
    throw preconditionError(`${level} is below the minimum ${task.minComplexity} from the escalation rules.`, `Pick ${task.minComplexity} or higher, or ask the user and pass --override "<the reason the user approved>".`);
  }
  const { task: updated } = updateTask(ws, task.id, (current) => {
    current.complexity = level;
    current.classifyWhy = why;
    current.complexityOverride = below ? { min: current.minComplexity, chosen: level, why, reason: override } : null;
    current.history.push({ at: new Date().toISOString(), from: current.phase, to: current.phase, note: `complexity ${level}: ${why}`, by: 'cw classify --set' });
  }, { expectRev: task.rev });
  const confirm = ws.config.workflow.confirm.includes(level);
  const next = [
    ...(updated.resetPending ? [`cw task reset --task ${task.id}`] : []),
    confirm ? `AskUserQuestion with the spec summary and the classification, then cw task confirm --task ${task.id} --note "<what the user confirmed>"` : `cw task start --task ${task.id}`,
  ];
  const value = { task: task.id, complexity: level, minComplexity: updated.minComplexity, override: Boolean(below), previousComplexity: updated.previousComplexity, confirm, next };
  emit(ctx, value, () => ctx.out.print(`complexity ${level}${below ? ` (override of the minimum ${value.minComplexity})` : ''}${confirm ? '; needs the user\'s confirmation' : ''}. Next: ${next.join('; then ')}`));
}

export const commands = [
  {
    path: ['classify'],
    group: 'orchestrator',
    usage: 'cw classify --task <id> [--paths <file>[,<file>]] | cw classify --task <id> --set s|m|l|xl --why "<one sentence>" [--override "<reason>"]',
    summary: 'Classify the task from its spec (packages, areas, minimum complexity), then record the chosen complexity',
    flags: { task: 'string', paths: 'list', set: 'string', why: 'string', override: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      if (ctx.flags.set !== undefined) {
        if (ctx.flags.paths) throw usageError('--paths belongs to the classification, not to --set', `Run cw classify --task ${task.id} --paths … first, then --set.`);
        return choose(ctx, ws, task);
      }
      if (ctx.flags.why || ctx.flags.override) throw usageError('--why and --override go with --set', `cw classify --task ${task.id} --set <c> --why "<one sentence>".`);
      return compute(ctx, ws, task);
    },
  },
];
