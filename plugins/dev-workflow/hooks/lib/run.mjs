// The frame of every hook script (D11): read the JSON input from stdin, stay inert without a project
// config, print the hook's JSON output, and fail open: an internal error is logged to
// <git common dir>/dev-workflow/hooks.log, prints nothing and exits 0. The deliberate guard denies and
// SubagentStop blocks are output, not errors.
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadHookWorkspace, locateProject } from './context.mjs';

export const LOG_FILE = 'hooks.log';
const LOG_MAX_BYTES = 1024 * 1024;
const TIME_LIMIT_MS = 10_000;

// Appends one line; keeps one rotated file. Logging never fails a hook.
export function log(stateDir, hook, message) {
  if (!stateDir) return;
  try {
    mkdirSync(stateDir, { recursive: true });
    const file = join(stateDir, LOG_FILE);
    try {
      if (statSync(file).size > LOG_MAX_BYTES) renameSync(file, `${file}.1`);
    } catch {
      // No log yet.
    }
    appendFileSync(file, `${new Date().toISOString()} ${hook} ${String(message).replace(/\n/g, '\n  ')}\n`);
  } catch {
    // A read-only state dir only loses the log line.
  }
}

// body({ input, place, ws, guards, log }) returns the output object or null. workspace: false skips
// loading the config (SessionStart's doctor loads and reports it itself).
export async function runHook(name, body, { workspace = true, timeLimitMs = TIME_LIMIT_MS } = {}) {
  // A hook that hangs (a held lock, a slow disk) must not hold the session: give up and let it go on.
  const timer = setTimeout(() => process.exit(0), timeLimitMs);
  timer.unref();
  let stateDir = null;
  try {
    const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    const place = locateProject(input.cwd);
    if (!place || (workspace && !place.stateDir)) return;
    stateDir = place.stateDir;
    const loaded = workspace ? loadHookWorkspace(place) : {};
    const output = await body({ input, place, ...loaded, log: (message) => log(stateDir, name, message) });
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    log(stateDir, name, `failed open: ${error?.stack ?? error}`);
  } finally {
    clearTimeout(timer);
  }
}
