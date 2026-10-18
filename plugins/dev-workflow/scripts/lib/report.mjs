// Structured outputs of the agents: dev report, review, investigation (merge, validate, save).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, tryGit } from './git.mjs';
import { CwError } from './out.mjs';
import { formatErrors, validateWith } from './schema.mjs';
import { parseSpec } from './spec.mjs';
import { taskPath } from './task.mjs';
import { readJson, writeJson } from './fsx.mjs';

export const fence = (value) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

export function latestChecks(ctx, task) {
  const dir = join(ctx.stateDir, 'tasks', task.id);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((name) => /^checks-.*\.json$/.test(name)).sort();
  return files.length ? { file: files.at(-1), data: readJson(join(dir, files.at(-1)), null) } : null;
}

export function buildDevReport(ctx, task, input, round) {
  const checks = latestChecks(ctx, task);
  const report = {
    kind: 'dev-report',
    version: 1,
    task: task.id,
    round,
    status: input.status,
    branch: tryGit(['branch', '--show-current'], { cwd: ctx.repoRoot }) ?? task.branch,
    worktree: ctx.repoRoot,
    head: tryGit(['rev-parse', 'HEAD'], { cwd: ctx.repoRoot }),
    changedFiles: task.base ? changedFiles(ctx.repoRoot, task.base.commit) : [],
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    proofs: readJson(taskPath(ctx, task, 'proofs.json'), []),
    checks: checks ? { file: checks.file, overall: checks.data?.overall ?? 'missing' } : { file: null, overall: 'missing' },
    migrations: input.migrations ?? 'none',
    docs: input.docs ?? [],
    openPoints: (input.openPoints ?? []).map((point) => (typeof point === 'string' ? { text: point } : point)),
    blocked: input.blocked ?? null,
    misclassified: input.misclassified ?? null,
  };
  return report;
}

export function validateDevReport(ctx, task, report) {
  const errors = validateWith('dev-report', report).map((error) => `${error.path}: ${error.message}`);
  if (report.status === 'done') {
    const spec = parseSpec(readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8'));
    for (const ac of spec.acceptance) {
      const entry = report.acceptanceCriteria.find((item) => item.id === ac.id);
      if (!entry) errors.push(`${ac.id} from the spec is missing in acceptanceCriteria`);
      else if (!entry.met) errors.push(`${ac.id} is not met; status cannot be done`);
      else if (!entry.evidence?.trim()) errors.push(`${ac.id} has no evidence`);
    }
    if (report.checks.overall !== 'pass' && report.checks.overall !== 'none') errors.push(`checks are ${report.checks.overall}; run cw checks --changed until they pass`);
    if (report.blocked || report.misclassified) errors.push('status done must not carry blocked/misclassified');
  }
  if (report.status === 'blocked' && !(report.blocked?.question && report.blocked?.needed)) errors.push('blocked needs { question, needed }');
  if (report.status === 'misclassified' && !report.misclassified?.reason) errors.push('misclassified needs { reason, suggested, branchCreated, dirty }');
  return errors;
}

export function validateReview(ctx, task, review, applicableIds) {
  const errors = validateWith('review', review).map((error) => `${error.path}: ${error.message}`);
  if (errors.length) return errors;
  const missing = applicableIds.filter((id) => !review.rulesChecked.includes(id));
  if (missing.length) errors.push(`rulesChecked lacks applicable rules: ${missing.join(', ')}`);
  const categories = new Set(['spec', 'scope', 'git', 'docs', 'migration', 'correctness', 'security', 'domain']);
  for (const finding of review.findings) {
    if (!categories.has(finding.rule) && !review.rulesChecked.includes(finding.rule)) errors.push(`${finding.id}: rule ${finding.rule} is neither an applicable rule ID nor a category`);
  }
  if (review.status === 'approved') {
    if (review.findings.some((finding) => finding.severity === 'blocking')) errors.push('approved with blocking findings');
    if (review.checks.some((check) => check.result !== 'pass')) errors.push('approved with failing checks');
    if (review.acceptanceCriteria.some((ac) => !ac.met)) errors.push('approved with unmet acceptance criteria');
    if ((review.mutations ?? []).some((mutation) => mutation.killed === false)) errors.push('approved with a surviving mutation');
  } else if (!review.findings.some((finding) => finding.severity === 'blocking')) {
    errors.push('changes_requested needs at least one blocking finding');
  }
  const spec = parseSpec(readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8'));
  for (const ac of spec.acceptance) if (!review.acceptanceCriteria.some((item) => item.id === ac.id)) errors.push(`${ac.id} not assessed`);
  return errors;
}

export function validateInvestigation(investigation) {
  return validateWith('investigation', investigation).map((error) => `${error.path}: ${error.message}`);
}

export function saveOrThrow(path, value, errors, label) {
  if (errors.length) throw new CwError(`The ${label} is not valid:\n- ${errors.join('\n- ')}`, { details: errors });
  writeJson(path, value);
  return value;
}

export { formatErrors };
