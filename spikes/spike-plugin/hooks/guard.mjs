import { input, log } from './log.mjs';
log('PreToolUse');
const cmd = String(input.tool_input?.command ?? '');
if (input.tool_name === 'Bash' && cmd.includes('forbidden')) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'SPIKE-GUARD: forbidden word' } }));
}
if (input.tool_name === 'Agent' && (input.tool_input?.model || input.tool_input?.effort)) log('AgentOverrideSeen');
