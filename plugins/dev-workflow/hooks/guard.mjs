// PreToolUse guard for Bash and Agent calls (spec 06 §4). Denies with a reason and an alternative;
// never returns "allow". Fails open: internal errors are logged and the call proceeds.
import { packGuards, resolvePacks } from '../scripts/lib/packs.mjs';
import { loadProfile } from '../scripts/lib/profile.mjs';
import { evaluate } from './guard-rules.mjs';
import { log, runHook } from './hook-lib.mjs';

await runHook('guard', ({ input, ctx }) => {
  const profile = loadProfile(ctx);
  const guards = packGuards(resolvePacks(ctx, profile, { quiet: true }));
  const result = evaluate({ input, ctx, profile, guards });
  if (result) log(ctx, 'guard', `${input.agent_type ?? 'main'} denied: ${result.hookSpecificOutput.permissionDecisionReason} :: ${String(input.tool_input?.command ?? input.tool_input?.subagent_type ?? '').slice(0, 200)}`);
  return result;
});
