// UserPromptSubmit: in an orchestrator session, "starte mit Ticket NV-9" / "nimm das nächste Ticket"
// adds the ticket ID and the exact first command as context. It never claims by itself.
import { loadProfile } from '../scripts/lib/profile.mjs';
import { listTasks } from '../scripts/lib/task.mjs';
import { runHook } from './hook-lib.mjs';
import { detectIntent } from './intent.mjs';

await runHook('ticket-intent', ({ input, ctx }) => {
  const isOrchestrator = input.agent_type === 'dev-workflow:orchestrator' || listTasks(ctx).length > 0;
  if (!isOrchestrator) return null;
  const profile = loadProfile(ctx);
  const intent = detectIntent(input.prompt, profile.tickets.idPattern);
  if (!intent) return null;
  const text = intent.next
    ? 'Ticket request detected: the next available ticket. Workflow step O1 applies; its first command is `cw intake --next`.'
    : `Ticket request detected: ${intent.ids.join(', ')}. Workflow step O1 applies; its first command is \`cw intake ${intent.ids[0]}\`${intent.ids.length > 1 ? ' (the others follow one after another)' : ''}.`;
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } };
}, { timeoutMs: 2000 });
