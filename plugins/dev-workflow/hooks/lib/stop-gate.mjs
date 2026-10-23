// The SubagentStop gate (§9): a workflow agent stops only once its round's file is saved, valid and
// newer than its start (SubagentStart) and the orchestrator's last read of its output (cw report show
// / cw review show stamp shownAt), so an agent continued with SendMessage saves again. At most
// MAX_STOP_BLOCKS blocks per agent id; last_assistant_message is only a cross-check when present (the
// Desktop app leaves it out, S7).
import { listTasks, readRoundFile } from '../../cli/lib/task.mjs';

export const MAX_STOP_BLOCKS = 2;

const ROLE = {
  implementer: { phase: 'implement', kind: 'report', command: 'cw report save', what: 'report (status done, blocked or misclassified)' },
  reviewer: { phase: 'review', kind: 'review', command: 'cw review save', what: 'review (status approved or changes_requested)' },
};

// The last ```json fence of the agent's final message, or the whole message as JSON; null otherwise.
function finalJson(message) {
  const text = String(message ?? '').trim();
  const fences = [...text.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/g)];
  for (const candidate of [fences.at(-1)?.[1], text]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Not JSON.
    }
  }
  return null;
}

const latest = (...stamps) => Math.max(...stamps.map((stamp) => Date.parse(stamp ?? '')).filter(Number.isFinite), Number.NEGATIVE_INFINITY);

// The task the stopping agent belongs to and what is wrong with its round's file:
// { task, file, problem } with problem null when it may stop; null for an agent of no known task or
// of a task that moved on to another phase. validate is validateSavedDevReport or validateSavedReview.
export function inspectStop({ ws, role, agentId, lastMessage, validate }) {
  const spec = ROLE[role];
  if (!spec || !agentId) return null;
  const task = listTasks(ws).find((candidate) => candidate.agents?.[role]?.id === agentId);
  if (!task || task.phase !== spec.phase) return null;
  let file;
  try {
    file = readRoundFile(ws, task, spec.kind);
  } catch (error) {
    return { task, file: null, problem: `${spec.kind}-${task.round}.json cannot be read (${error.message})` };
  }
  const name = `${spec.kind}-${task.round}.json`;
  if (!file.data) return { task, file, problem: `there is no ${name} for round ${task.round} yet` };
  const errors = validate(file.data);
  if (errors.length) return { task, file, problem: `${name} is not valid: ${errors.slice(0, 5).join('; ')}` };
  const agent = task.agents[role];
  const since = latest(agent.startedAt, agent.shownAt);
  if (!(Date.parse(file.data.savedAt) > since)) {
    return { task, file, problem: `${name} was saved at ${file.data.savedAt}, before your current turn began (${new Date(since).toISOString()}); it is the earlier ${spec.kind}` };
  }
  const said = finalJson(lastMessage);
  if (said && typeof said.status === 'string' && said.status !== file.data.status) {
    return { task, file, problem: `your final message says status ${said.status}, but ${name} says ${file.data.status}` };
  }
  return { task, file, problem: null };
}

// The block reason: the problem, the exact command, and the fence to end with.
export function blockReason({ role, task, problem, count }) {
  const spec = ROLE[role];
  return `dev-workflow stop check (${count}/${MAX_STOP_BLOCKS}): ${problem}. Save this round's ${spec.what}: pipe its JSON to \`${spec.command} --task ${task.id}\`, fix every point it reports, and end your turn with exactly the JSON fence it prints.`;
}
