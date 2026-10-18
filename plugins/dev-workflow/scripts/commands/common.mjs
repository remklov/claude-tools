// Shared loading for commands: context, profile, packs, task, claims config.
import { readFileSync } from 'node:fs';
import { requireProfileContext } from '../lib/ctx.mjs';
import { CwError, print, printJson, usageError } from '../lib/out.mjs';
import { resolvePacks } from '../lib/packs.mjs';
import { loadProfile } from '../lib/profile.mjs';
import { buildRulebook } from '../lib/rules.mjs';
import { loadTask, resolveTaskId } from '../lib/task.mjs';

export function load(flags) {
  const ctx = requireProfileContext(flags.cwd ?? process.cwd());
  const profile = loadProfile(ctx);
  const packs = resolvePacks(ctx, profile, { quiet: Boolean(flags.json) });
  return { ctx, profile, packs };
}

export function loadWithTask(flags) {
  const base = load(flags);
  const task = loadTask(base.ctx, resolveTaskId(base.ctx, flags.task));
  return { ...base, task };
}

export const rulebook = ({ ctx, profile, packs }) => buildRulebook(ctx, profile, packs);
export const profileText = (ctx) => readFileSync(ctx.profilePath, 'utf8');

export function emit(flags, value, human) {
  if (flags.json) printJson(value);
  else if (typeof human === 'function') human(value);
  else print(human ?? JSON.stringify(value, null, 2));
}

export function need(flags, key, hint) {
  const value = flags[key];
  if (value === undefined || value === true || value === '') throw usageError(`--${key} is required${hint ? ` (${hint})` : ''}`);
  return value;
}

export function readStdinJson() {
  let text;
  try {
    text = readFileSync(0, 'utf8');
  } catch {
    throw usageError('expected JSON on stdin');
  }
  const fenced = /```json\s*([\s\S]*?)```/.exec(text);
  try {
    return JSON.parse((fenced ? fenced[1] : text).trim());
  } catch (error) {
    throw new CwError(`stdin is not valid JSON: ${error.message}`);
  }
}
