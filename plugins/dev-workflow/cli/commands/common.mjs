// Shared command plumbing: required flags, the task context, stdin, a given config file, and output.
import { readConfigFile } from '../lib/config.mjs';
import { CwError, failedError, usageError } from '../lib/out.mjs';
import { parseAgentJson } from '../lib/report.mjs';
import { listTasks, readTask } from '../lib/task.mjs';

// A config file to validate or write: a JSON syntax error counts as an invalid config (exit 1).
export function readConfigInput(path) {
  try {
    return readConfigFile(path);
  } catch (error) {
    if (error instanceof CwError) throw failedError(error.message, error.fix);
    throw error;
  }
}

export function requireFlag(flags, key, fix) {
  const value = flags[key];
  if (value === undefined || value === '' || value === true) throw usageError(`--${key} is required`, fix ?? `Pass --${key} <value>.`);
  return value;
}

// { ws, task } for a --task command. There is no implicit task: the id is always explicit (D5).
export function loadTaskContext(ctx) {
  const ws = ctx.workspace();
  if (!ctx.flags.task) {
    const ids = listTasks(ws).map((task) => task.id);
    throw usageError('--task is required', ids.length ? `Pass --task <id>; active tasks: ${ids.join(', ')}.` : 'Pass --task <id>; there is no active task.');
  }
  return { ws, task: readTask(ws, ctx.flags.task) };
}

export function readStdinText(ctx, example = '') {
  const text = ctx.stdin();
  if (!text.trim()) throw usageError('stdin is empty', `Pass the content on stdin${example ? `: ${example}` : '.'}`);
  return text;
}

// JSON from stdin: the whole text, or the last ```json fence in it (as an agent prints it).
export const readStdinJson = (ctx, example) => parseAgentJson(readStdinText(ctx, example));

// Prints value as JSON with --json (or always, for commands whose output Claude reads), else human text.
export function emit(ctx, value, human, { alwaysJson = false } = {}) {
  if (ctx.flags.json || alwaysJson || !human) ctx.out.data(value);
  else human(value);
}
