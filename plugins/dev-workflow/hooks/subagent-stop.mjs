// SubagentStop (^dev-workflow:(implementer-(s|m|l|xl)|reviewer)$, §9): blocks a workflow agent that
// ends without this round's saved, valid and fresh report or review, naming the command to run; at
// most twice per agent id, then it lets the agent stop (the orchestrator's cw report show / cw review
// show names the gap).
import { bumpStopBlocks } from '../cli/lib/task.mjs';
import { roleOf } from './lib/context.mjs';
import { runHook } from './lib/run.mjs';
import { MAX_STOP_BLOCKS, blockReason, inspectStop } from './lib/stop-gate.mjs';

await runHook('subagent-stop', async ({ input, ws, log }) => {
  const role = roleOf(input.agent_type);
  if (!role) return null;
  // The validators pull in most of cw's libs: load them only for a workflow agent.
  const validate = role === 'implementer'
    ? (await import('../cli/lib/report.mjs')).validateSavedDevReport
    : (await import('../cli/lib/review.mjs')).validateSavedReview;
  const found = inspectStop({ ws, role, agentId: input.agent_id, lastMessage: input.last_assistant_message, validate });
  if (!found?.problem) return null;
  const { task, problem } = found;
  if ((task.stopBlocks?.[input.agent_id] ?? 0) >= MAX_STOP_BLOCKS) {
    log(`let ${role} ${input.agent_id} of ${task.id} stop after ${MAX_STOP_BLOCKS} blocks: ${problem}`);
    return null;
  }
  const count = bumpStopBlocks(ws, task.id, input.agent_id);
  if (count > MAX_STOP_BLOCKS) return null;
  log(`blocked ${role} ${input.agent_id} of ${task.id} (${count}/${MAX_STOP_BLOCKS}): ${problem}`);
  return { decision: 'block', reason: blockReason({ role, task, problem, count }) };
});
