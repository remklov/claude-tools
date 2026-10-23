// Reviewer commands (§6 R1 and R8, §8): review scope and review save. Both read the work tree from
// task.json, whatever the cwd (D5), and never write to it; the reviewer re-runs checks and proofs with
// cw checks --changed and cw prove --recheck.
import { fence } from '../lib/report.mjs';
import { reviewScope, saveReview } from '../lib/review.mjs';
import { emit, loadTaskContext, readStdinJson } from './common.mjs';

const short = (sha) => String(sha ?? '').slice(0, 10);

function printScope(ctx, value) {
  const { out } = ctx;
  out.print(`Task ${value.task}: ${value.branch} in ${value.workTree}`);
  out.print(`base ${short(value.base)} · head ${short(value.head)} · ${value.commits} commit(s) · ${value.changedFiles.length} file(s) changed`);
  const rows = value.diffStat.files.map((file) => ({
    file: file.path, added: file.binary ? 'binary' : `+${file.added}`, deleted: file.binary ? '' : `-${file.deleted}`,
  }));
  if (rows.length) out.print(`${out.table(rows, ['file', 'added', 'deleted'])}\ntotal +${value.diffStat.added} -${value.diffStat.deleted}`);
  out.print(`Outside every package: ${value.unowned.join(', ') || 'none'}`);
  out.print(`Foreign commits: ${value.foreignCommits.length ? value.foreignCommits.map((commit) => `${commit.sha} ${commit.subject}`).join('; ') : 'none'}`);
  for (const hint of value.nonGoalHints) out.print(`Non-goal hint: "${hint.nonGoal}" (${hint.words.join(', ')}): ${hint.files.join(', ')}`);
  for (const script of value.scripts) {
    out.print(`Script ${script.script}: ${script.passed ? 'pass' : `fail (exit ${script.code})`}`);
    if (!script.passed && script.tail) out.print(script.tail.replace(/^/gm, '  '));
  }
  if (!value.blocking.length && !value.failingScripts.length) return out.print('No blocking scope problems.');
  if (value.blocking.length) {
    out.print('Blocking scope problems (each one is a blocking finding):');
    for (const problem of value.blocking) out.print(`- ${problem}`);
  }
  if (value.failingScripts.length) {
    out.print('Failing scope scripts (each one is a blocking finding, unless the change is accepted, for example the user approved the dependency: then a non-blocking finding with rule scope names the script and says why):');
    for (const problem of value.failingScripts) out.print(`- ${problem}`);
  }
}

export const commands = [
  {
    path: ['review', 'scope'],
    group: 'reviewer',
    usage: 'cw review scope --task <id> [--json]',
    summary: 'Show what the review covers: diff stat, files outside the packages, foreign commits, non-goal hints, pack scope scripts',
    flags: { task: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      emit(ctx, reviewScope({ ws, task }), (value) => printScope(ctx, value));
    },
  },
  {
    path: ['review', 'save'],
    group: 'reviewer',
    usage: 'cw review save --task <id> < <JSON file>',
    summary: 'Validate and save your review (JSON on stdin); end your turn with the printed JSON fence',
    flags: { task: 'string' },
    run(ctx) {
      const { ws, task } = loadTaskContext(ctx);
      const input = readStdinJson(ctx, `cw review save --task ${task.id} < <scratchpad>/${task.id}-review-1.json`);
      const { review } = saveReview({ ws, task, input });
      if (ctx.flags.json) ctx.out.data(review);
      else ctx.out.print(fence(review));
    },
  },
];
