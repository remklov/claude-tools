// Subagent transcripts as Claude Code writes them (JSONL; the fields cw reads, as in the transcripts of
// CLI 2.1.310, ADR 0012), and where the tests put them. Helpers here never end in .test.mjs, so the
// test glob does not run them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// One assistant message whose last API call read `tokens` input tokens (mostly from the cache, as
// for a long-running agent). pad makes the line longer.
export function assistantLine(tokens, { at = '2026-10-24T08:00:02.000Z', pad = 0 } = {}) {
  const created = Math.min(1000, Math.max(0, tokens - 2));
  return JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    timestamp: at,
    message: {
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: `done${'.'.repeat(pad)}` }],
      usage: { input_tokens: Math.min(2, tokens), cache_creation_input_tokens: created, cache_read_input_tokens: tokens - Math.min(2, tokens) - created, output_tokens: 800 },
    },
  });
}

// A short transcript: a prompt, an earlier call, the tool result and the last call with `tokens`.
export const transcriptLines = (tokens) => [
  JSON.stringify({ type: 'user', isSidechain: true, timestamp: '2026-10-24T08:00:00.000Z', message: { role: 'user', content: 'Task …' } }),
  assistantLine(18_000, { at: '2026-10-24T08:00:01.000Z' }),
  JSON.stringify({ type: 'user', isSidechain: true, timestamp: '2026-10-24T08:00:01.500Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
  assistantLine(tokens),
].join('\n').concat('\n');

// Where Claude Code keeps the transcript of a subagent of session under the hermetic HOME of a fixture.
export const homeTranscriptPath = (env, agentId, session = 'test-session') =>
  join(env.HOME, '.claude', 'projects', '-fixture-project', session, 'subagents', `agent-${agentId}.jsonl`);

export function writeTranscript(path, tokens) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, transcriptLines(tokens));
  return path;
}
