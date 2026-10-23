// Ticket keys, the ticket file of a key and the ticket snapshot. tickets.source names where tickets come
// from: Jira or Linear, read through their MCP servers, or a local file at tickets.contextPath (ADR 0009).
// cw never writes to a ticket system (D6); the orchestrator reads the ticket and pipes the snapshot to
// cw ticket save.
import { posix } from 'node:path';
import { usageError } from './out.mjs';
import { validateWith } from './schema.mjs';

// NO-TICKET is accepted as an alias of the configured no-ticket key (decided in P2).
export const NO_TICKET_ALIAS = 'NO-TICKET';
export const isNoTicket = (config, key) => key === config.git.noTicketKey || key === NO_TICKET_ALIAS;

// The sources whose snapshot links the ticket, by display name.
const LINKED_SOURCES = { jira: 'Jira', linear: 'Linear' };

// The key a task records: the configured no-ticket key for the alias, else the key itself.
export function normalizeTicketKey(config, key) {
  if (isNoTicket(config, key)) return config.git.noTicketKey;
  if (!new RegExp(config.tickets.keyPattern).test(key)) {
    throw usageError(
      `${key} is not a ticket key (tickets.keyPattern ${config.tickets.keyPattern}) or the no-ticket key ${config.git.noTicketKey}.`,
      `Use the key as the ticket shows it, e.g. APP-42, or ${config.git.noTicketKey}.`,
    );
  }
  return key;
}

// The project-relative file that tickets.contextPath names for a key: the ticket itself for source
// local, technical context for Jira and Linear. Null without a contextPath and for the no-ticket key.
export function ticketFileOf(config, key) {
  if (!config.tickets.contextPath || isNoTicket(config, key)) return null;
  const file = posix.normalize(config.tickets.contextPath.replaceAll('{key}', key));
  if (file.startsWith('/') || file === '..' || file.startsWith('../')) {
    throw usageError(`The ticket file of ${key} would be ${file}, outside the project.`, 'Narrow tickets.keyPattern so that a key cannot contain "/" or "..".');
  }
  return file;
}

// { value, errors }: the stored snapshot (with savedAt) or the reasons it is refused.
export function validateSnapshot(config, task, input, { now = new Date() } = {}) {
  const errors = validateWith('ticket', input).map((error) => `${error.path}: ${error.message}`);
  const sameKey = input?.key === task.ticket || (isNoTicket(config, input?.key) && isNoTicket(config, task.ticket));
  if (typeof input?.key === 'string' && !sameKey) errors.push(`$.key: is ${input.key}, the task's ticket is ${task.ticket}`);
  const source = input?.source ?? config.tickets.source;
  if (!errors.length && !isNoTicket(config, task.ticket)) {
    const file = ticketFileOf(config, task.ticket);
    if (source !== config.tickets.source && ['jira', 'linear', 'local'].includes(source)) {
      errors.push(`$.source: is ${source}, tickets.source is ${config.tickets.source}`);
    } else if (LINKED_SOURCES[source] && !input.url) {
      errors.push(`$.url: is required for a ${LINKED_SOURCES[source]} snapshot`);
    }
    if (source === 'local' && input.path !== file) errors.push(`$.path: is ${input.path ?? 'missing'}, the ticket file of ${task.ticket} is ${file}`);
    if (source !== 'local' && input.path !== undefined) errors.push('$.path: only a local snapshot has a path');
    if (input.context !== undefined && (source === 'local' || input.context !== file)) {
      errors.push(source === 'local'
        ? '$.context: a local snapshot has none; its path is the ticket'
        : `$.context: is ${input.context}, the context file of ${task.ticket} is ${file ?? 'not configured (tickets.contextPath)'}`);
    }
  }
  if (errors.length) return { value: null, errors };
  return { value: { version: 1, ...input, source, savedAt: now.toISOString() }, errors };
}
