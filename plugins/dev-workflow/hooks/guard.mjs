// PreToolUse (Bash|Agent|Edit|Write|NotebookEdit, §9): the deny-only guard. Prints a deny with the
// reason and the alternative, or nothing; it never allows or asks, so the permission rules decide.
import { denyOutput, evaluate } from './lib/guards.mjs';
import { runHook } from './lib/run.mjs';

await runHook('guard', ({ input, ws, guards, log }) => {
  const hit = evaluate({ input, ws, guards });
  if (!hit) return null;
  const subject = input.tool_input?.command ?? input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? input.tool_input?.subagent_type ?? '';
  log(`deny ${hit.id} for ${input.agent_type ?? 'the main session'}: ${String(subject).slice(0, 200)}`);
  return denyOutput(hit);
});
