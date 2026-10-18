// Runs the checks of the affected packages with services, exclusive locks and logs (spec 02 §4.4).
import { join } from 'node:path';
import { changedFiles } from './git.mjs';
import { maskEnv } from './out.mjs';
import { packageById, packagesOf } from './profile.mjs';
import { run, shell } from './proc.mjs';
import { withLock, writeJson } from './fsx.mjs';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function selectPackages(profile, { files, only }) {
  if (only?.length) return { packages: only.map((id) => packageById(profile, id)).filter(Boolean), unowned: [], reasons: Object.fromEntries(only.map((id) => [id, 'selected'])) };
  const { packages, unowned } = packagesOf(profile, files);
  const reasons = Object.fromEntries(packages.map((pkg) => [pkg.id, 'changed']));
  const queue = [...packages];
  while (queue.length) {
    const pkg = queue.shift();
    for (const id of pkg.alsoCheck) {
      if (reasons[id]) continue;
      reasons[id] = `alsoCheck of ${pkg.id}`;
      const other = packageById(profile, id);
      if (other) queue.push(other);
    }
  }
  return { packages: profile.packages.filter((pkg) => reasons[pkg.id]), unowned, reasons };
}

function ensureService(profile, id, cwd, log) {
  const service = profile.services[id];
  const isUp = () => run('sh', ['-c', service.check], { cwd, timeoutMs: 30_000 }).code === 0;
  if (isUp()) return { id, wasUp: true, started: false };
  if (!service.start) return { id, wasUp: false, started: false, error: 'down and no start command' };
  log(`starting service ${id}: ${service.start}`);
  run('sh', ['-c', service.start], { cwd, timeoutMs: 60_000 });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (isUp()) return { id, wasUp: false, started: true };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return { id, wasUp: false, started: true, error: 'did not come up within 60 s' };
}

export async function runChecks(ctx, profile, { base, changed = true, only = [], onlyChecks = [], outDir, log = () => {} }) {
  const files = changed ? changedFiles(ctx.repoRoot, base) : [];
  const selection = changed || only.length ? selectPackages(profile, { files, only }) : { packages: profile.packages, unowned: [], reasons: Object.fromEntries(profile.packages.map((pkg) => [pkg.id, 'all'])) };
  const ts = stamp();
  const logDir = outDir ? join(outDir, `checks-${ts}`) : join(ctx.stateDir, 'checks', ts);
  const services = [];
  for (const id of new Set(selection.packages.flatMap((pkg) => pkg.services))) services.push(ensureService(profile, id, ctx.repoRoot, log));
  const result = { kind: 'checks', base: base ?? null, head: null, changedFiles: files.length, unowned: selection.unowned, services, packages: [], overall: 'pass' };
  try {
    for (const pkg of selection.packages) {
      const entry = { id: pkg.id, reason: selection.reasons[pkg.id], checks: [] };
      result.packages.push(entry);
      for (const [name, command] of Object.entries(pkg.checks)) {
        if (onlyChecks.length && !onlyChecks.includes(name)) continue;
        const cwd = join(ctx.repoRoot, pkg.paths[0]);
        const logFile = join(logDir, `${pkg.id}-${name}.log`);
        const exec = () => shell(command, { cwd, env: pkg.env, logFile, timeoutMs: profile.workflow.checkTimeoutMinutes * 60_000 });
        log(`${pkg.id}: ${name} → ${command}`);
        const outcome = pkg.exclusive.includes(name)
          ? await withLock(join(ctx.stateDir, 'locks', `${pkg.id}-${name}.lock`), exec, {
            owner: ctx.repoRoot,
            onWait: (holder) => log(`waiting for the exclusive ${pkg.id}:${name} lock (held by ${holder?.owner ?? holder?.pid ?? 'another run'})`),
          })
          : await exec();
        const isPass = outcome.code === 0;
        if (!isPass) result.overall = 'fail';
        entry.checks.push({
          name, command, cwd: pkg.paths[0], exit: outcome.code, durationMs: outcome.durationMs,
          result: isPass ? 'pass' : outcome.timedOut ? 'timeout' : 'fail', log: logFile, tail: maskEnv(outcome.tail, pkg.env),
        });
        log(`${pkg.id}: ${name} ${isPass ? 'pass' : 'FAIL'} (${Math.round(outcome.durationMs / 1000)} s)`);
      }
    }
  } finally {
    for (const service of services) {
      const spec = profile.services[service.id];
      if (service.started && spec.stopIfStarted && spec.stop) {
        run('sh', ['-c', spec.stop], { cwd: ctx.repoRoot, timeoutMs: 60_000 });
        service.stopped = true;
      }
    }
  }
  if (result.packages.every((pkg) => pkg.checks.length === 0)) result.overall = selection.packages.length ? 'pass' : 'none';
  result.head = run('git', ['rev-parse', 'HEAD'], { cwd: ctx.repoRoot }).stdout.trim();
  if (outDir) {
    const file = join(outDir, `checks-${ts}.json`);
    writeJson(file, result);
    result.file = file;
  }
  return result;
}
