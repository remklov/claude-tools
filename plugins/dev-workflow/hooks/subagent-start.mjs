// SubagentStart (^dev-workflow:, §9): records the agent of the task that waits for this role in this
// session (agent id, type, start time, round, session) and gives it its role context. A workflow
// agent no task waits for gets nothing; so does one that several tasks wait for (logged, not guessed).
import { recordAgentStart, tasksAwaitingAgent } from '../cli/lib/task.mjs';
import { agentContext } from './lib/agent-context.mjs';
import { roleOf } from './lib/context.mjs';
import { runHook } from './lib/run.mjs';

await runHook('subagent-start', ({ input, ws, guards, log }) => {
  const role = roleOf(input.agent_type);
  if (!role || !input.agent_id) return null;
  const waiting = tasksAwaitingAgent(ws, { sessionId: input.session_id, role, agentType: input.agent_type });
  if (waiting.length > 1) {
    log(`recorded no ${role} ${input.agent_id} (${input.agent_type}): ${waiting.length} tasks wait for one (${waiting.map((task) => task.id).join(', ')})`);
    return null;
  }
  if (!waiting.length) return null;
  const at = new Date().toISOString();
  const { task } = recordAgentStart(ws, waiting[0].id, { role, agentId: input.agent_id, agentType: input.agent_type, at, session: input.session_id ?? null });
  log(`recorded ${role} ${input.agent_id} (${input.agent_type}) for ${task.id} round ${task.round}`);
  return { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: agentContext({ ws, task, role, guards, cwd: ws.cwd }) } };
});
