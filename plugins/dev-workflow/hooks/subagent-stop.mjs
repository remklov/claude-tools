// SubagentStop: a dev-workflow agent may only finish with its saved, valid result (spec 06 §5).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJson } from '../scripts/lib/fsx.mjs';
import { formatErrors, validateWith } from '../scripts/lib/schema.mjs';
import { roleOf, runHook } from './hook-lib.mjs';

const KIND = { implementer: 'dev-report', reviewer: 'review', investigator: 'investigation' };
const COMMAND = { implementer: 'cw report save', reviewer: 'cw review save', investigator: 'cw investigation save' };
const MAX_BLOCKS = 2;

function lastJsonBlock(text) {
  const blocks = [...String(text ?? '').matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  try {
    return JSON.parse(blocks.at(-1)[1]);
  } catch {
    return undefined;
  }
}

function savedFile(ctx, value, kind) {
  const dir = join(ctx.stateDir, 'tasks', value.task ?? '');
  if (!value.task || !existsSync(dir)) return null;
  if (kind === 'investigation') return readJson(join(dir, 'investigation.json'), null);
  const name = kind === 'dev-report' ? `report-${value.round}.json` : `review-${value.round}.json`;
  return readJson(join(dir, name), null);
}

await runHook('subagent-stop', ({ input, ctx }) => {
  const role = roleOf(input.agent_type);
  if (!role || role === 'orchestrator') return null;
  const kind = KIND[role];
  const value = lastJsonBlock(input.last_assistant_message);
  let problem = null;
  if (value === null) problem = `there is no \`\`\`json block with the ${kind}`;
  else if (value === undefined) problem = `the last \`\`\`json block is not valid JSON`;
  else {
    const errors = validateWith(kind, value);
    if (errors.length) problem = `the ${kind} does not match its schema: ${formatErrors(errors).split('\n').slice(0, 4).join('; ')}`;
    else {
      const saved = savedFile(ctx, value, kind);
      if (!saved) problem = `the ${kind} was not saved with \`${COMMAND[role]}\``;
      else if (JSON.stringify(saved) !== JSON.stringify(value)) problem = `the JSON differs from the saved ${kind}; end with the exact output of \`${COMMAND[role]}\``;
    }
  }
  if (!problem) return null;
  const counterFile = join(ctx.stateDir, 'stop-attempts.json');
  const counters = readJson(counterFile, {});
  const count = counters[input.agent_id] ?? 0;
  if (count >= MAX_BLOCKS) return null;
  counters[input.agent_id] = count + 1;
  writeJson(counterFile, counters);
  return {
    decision: 'block',
    reason: `Your final message must be the complete JSON that \`${COMMAND[role]} --task <id>\` prints — it replaces your previous final message, so repeat everything in it. Problem: ${problem}. Run \`${COMMAND[role]}\` (fix what it reports) and end with its full output.`,
  };
});

