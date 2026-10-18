// Shared plumbing for the plugin's command hooks: read stdin, find the workflow context, never
// break the session (errors go to <common-dir>/dev-workflow/hooks.log and the hook exits 0).
import { appendFileSync, mkdirSync, readFileSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { findContext } from '../scripts/lib/ctx.mjs';

export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

export function log(ctx, hook, message) {
  if (!ctx?.stateDir) return;
  try {
    mkdirSync(ctx.stateDir, { recursive: true });
    const file = join(ctx.stateDir, 'hooks.log');
    try {
      if (statSync(file).size > 1024 * 1024) renameSync(file, `${file}.1`);
    } catch {
      // No log yet.
    }
    appendFileSync(file, `${new Date().toISOString()} ${hook} ${message}\n`);
  } catch {
    // Logging must never fail the hook.
  }
}

// Runs a hook body with a hard time limit; prints its result (object → JSON) and exits 0 on any error.
export async function runHook(name, body, { timeoutMs = 5000 } = {}) {
  const timer = setTimeout(() => process.exit(0), timeoutMs);
  timer.unref();
  const input = readInput();
  let ctx = null;
  try {
    ctx = findContext(input.cwd || process.cwd());
    if (!ctx?.hasProfile) return;
    const result = await body({ input, ctx });
    if (result === undefined || result === null) return;
    process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result));
  } catch (error) {
    log(ctx, name, `error: ${error?.stack ?? error}`);
  } finally {
    clearTimeout(timer);
  }
}

export const roleOf = (agentType = '') => {
  const bare = String(agentType).replace(/^dev-workflow:/, '');
  if (!String(agentType).startsWith('dev-workflow:')) return null;
  if (bare.startsWith('implementer-')) return 'implementer';
  return ['orchestrator', 'reviewer', 'investigator'].includes(bare) ? bare : null;
};
