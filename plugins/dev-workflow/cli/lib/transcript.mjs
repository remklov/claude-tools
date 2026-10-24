// The context size of a workflow agent (ADR 0012): the input tokens of the last API call in its Claude
// Code transcript, that is input_tokens + cache_creation_input_tokens + cache_read_input_tokens of the
// last assistant message. SubagentStop records the transcript path Claude Code reports
// (agent_transcript_path); without it the file is looked up as
// <config dir>/projects/*/<session>/subagents/agent-<id>.jsonl. The projects/ folder name is not
// derived from a path: CLAUDE_CODE_PROJECT_DIR_NAME can replace it, so every folder is tried. Nothing
// here throws: an agent whose size cannot be read is { tokens: null, reason }.
import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const CHUNK_BYTES = 256 * 1024;
// A transcript line can hold a whole tool result; past this much tail the size counts as unknown.
const MAX_TAIL_BYTES = 32 * 1024 * 1024;
const USAGE_KEYS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];

export const transcriptName = (agentId) => `agent-${agentId}.jsonl`;

// Claude Code keeps settings, session history and plugins under CLAUDE_CONFIG_DIR, by default ~/.claude.
export const claudeConfigDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude');

// The transcript file of agent { id, session, transcript }, or null. A recorded path counts only when
// it is this agent's file.
export function findAgentTranscript(agent, env = process.env) {
  if (!agent?.id) return null;
  const name = transcriptName(agent.id);
  if (agent.transcript && basename(agent.transcript) === name && existsSync(agent.transcript)) return agent.transcript;
  if (!agent.session) return null;
  const projects = join(claudeConfigDir(env), 'projects');
  let folders;
  try {
    folders = readdirSync(projects);
  } catch {
    return null;
  }
  for (const folder of folders) {
    const candidate = join(projects, folder, agent.session, 'subagents', name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// The tokens of one transcript line when it is an assistant message of a real API call; a synthetic
// message (an API error, an interruption) carries no usage worth counting.
function lineTokens(line) {
  if (!line.trim()) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const usage = entry?.type === 'assistant' ? entry.message?.usage : null;
  if (!usage || entry.message.model === '<synthetic>') return null;
  const tokens = USAGE_KEYS.reduce((sum, key) => sum + (Number.isFinite(usage[key]) ? usage[key] : 0), 0);
  return tokens > 0 ? { tokens, at: entry.timestamp ?? null } : null;
}

// { tokens, at } of the last assistant message in a JSONL transcript, read backwards from its end;
// null when there is none. Throws when the file cannot be read.
export function lastContextTokens(path) {
  const fd = openSync(path, 'r');
  try {
    let end = fstatSync(fd).size;
    const size = end;
    let pending = Buffer.alloc(0);
    while (end > 0 && size - end < MAX_TAIL_BYTES) {
      const start = Math.max(0, end - CHUNK_BYTES);
      const chunk = Buffer.alloc(end - start);
      readSync(fd, chunk, 0, chunk.length, start);
      pending = Buffer.concat([chunk, pending]);
      end = start;
      // Before the first newline the line may go on in the bytes not read yet; at the file start it may not.
      const cut = end === 0 ? -1 : pending.indexOf(0x0a);
      if (cut === -1 && end > 0) continue;
      const complete = pending.subarray(cut + 1).toString('utf8').split('\n');
      for (let i = complete.length - 1; i >= 0; i -= 1) {
        const found = lineTokens(complete[i]);
        if (found) return found;
      }
      pending = pending.subarray(0, cut + 1);
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

// { tokens, at, path } of the agent's last API call, or { tokens: null, path, reason }.
export function measureAgentContext(agent, env = process.env) {
  const path = findAgentTranscript(agent, env);
  if (!path) return { tokens: null, path: null, reason: `no transcript of ${agent?.id ?? 'the agent'} under ${join(claudeConfigDir(env), 'projects')}` };
  try {
    const found = lastContextTokens(path);
    return found ? { tokens: found.tokens, at: found.at, path } : { tokens: null, path, reason: `${path} holds no assistant message with token usage` };
  } catch (error) {
    return { tokens: null, path, reason: `${path} cannot be read (${error.code ?? error.message})` };
  }
}

// 451234 → "451k", for the one-line reasons.
export const kTokens = (tokens) => `${Math.round(tokens / 1000)}k`;
