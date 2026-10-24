// The context size of a workflow agent from its Claude Code transcript (ADR 0012): the last real
// assistant message counts, the file is found by the recorded path or under the config dir, and an
// unknown size is a reason, never an exception.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { claudeConfigDir, findAgentTranscript, kTokens, lastContextTokens, measureAgentContext } from '../../cli/lib/transcript.mjs';
import { tempBase } from '../fixtures/repo.mjs';
import { assistantLine, transcriptLines } from '../fixtures/transcript.mjs';

const writeAt = (path, text) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
};

test('lastContextTokens: input, cache creation and cache read of the last real assistant message', (t) => {
  const base = tempBase(t);
  const file = writeAt(join(base, 'a.jsonl'), transcriptLines(451_000));
  assert.deepEqual(lastContextTokens(file), { tokens: 451_000, at: '2026-10-24T08:00:02.000Z' });

  // A synthetic message (an API error) after it, a user line and a half-written last line do not count.
  const synthetic = JSON.stringify({ type: 'assistant', timestamp: 'x', message: { model: '<synthetic>', usage: { input_tokens: 0, cache_read_input_tokens: 0 } } });
  const tail = `${transcriptLines(200_000)}${synthetic}\n${JSON.stringify({ type: 'user', message: { content: 'next' } })}\n{"type":"assistant","message":{"usa`;
  assert.equal(lastContextTokens(writeAt(join(base, 'b.jsonl'), tail)).tokens, 200_000);
  assert.equal(lastContextTokens(writeAt(join(base, 'c.jsonl'), '')), null);
  assert.equal(lastContextTokens(writeAt(join(base, 'd.jsonl'), '{"type":"user"}\nnot json\n')), null);
});

test('lastContextTokens reads backwards across chunks and across a line longer than a chunk', (t) => {
  const base = tempBase(t);
  const huge = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(700_000) } });
  const filler = Array.from({ length: 2000 }, (_, i) => JSON.stringify({ type: 'user', message: { content: `line ${i} ${'y'.repeat(200)}` } })).join('\n');
  const text = `${assistantLine(10_000)}\n${assistantLine(123_456)}\n${huge}\n${filler}\n`;
  assert.equal(lastContextTokens(writeAt(join(base, 'long.jsonl'), text)).tokens, 123_456);
  // The last assistant line itself spans the chunk boundary.
  const big = assistantLine(98_765, { pad: 600_000 });
  assert.equal(lastContextTokens(writeAt(join(base, 'big.jsonl'), `${assistantLine(1)}\n${big}\n`)).tokens, 98_765);
});

test('findAgentTranscript: the recorded path of this agent, else <config dir>/projects/*/<session>/subagents/', (t) => {
  const base = tempBase(t);
  const env = { HOME: join(base, 'home') };
  assert.equal(claudeConfigDir(env), join(base, 'home', '.claude'));
  assert.equal(claudeConfigDir({ ...env, CLAUDE_CONFIG_DIR: join(base, 'cfg') }), join(base, 'cfg'));

  const found = writeAt(join(base, 'home', '.claude', 'projects', 'any-folder-name', 's1', 'subagents', 'agent-a1.jsonl'), transcriptLines(5));
  assert.equal(findAgentTranscript({ id: 'a1', session: 's1' }, env), found);
  assert.equal(findAgentTranscript({ id: 'a1', session: 's2' }, env), null, 'another session');
  assert.equal(findAgentTranscript({ id: 'a1', session: null }, env), null);
  assert.equal(findAgentTranscript({ id: 'a1', session: 's1' }, { HOME: join(base, 'nowhere') }), null);

  const recorded = writeAt(join(base, 'elsewhere', 'agent-a1.jsonl'), transcriptLines(7));
  assert.equal(findAgentTranscript({ id: 'a1', session: 's1', transcript: recorded }, env), recorded);
  // The recorded path of an earlier agent in the same slot does not count for this one.
  assert.equal(findAgentTranscript({ id: 'a2', session: 's9', transcript: recorded }, env), null);
  assert.equal(findAgentTranscript({ id: 'a1', session: 's1', transcript: join(base, 'gone', 'agent-a1.jsonl') }, env), found, 'a recorded file that is gone falls back to the search');
  assert.equal(findAgentTranscript(null, env), null);
});

test('measureAgentContext: the size, or a reason when the transcript is missing or unreadable', (t) => {
  const base = tempBase(t);
  const env = { HOME: join(base, 'home') };
  const dir = join(base, 'home', '.claude', 'projects', 'p', 's1', 'subagents');
  writeAt(join(dir, 'agent-ok.jsonl'), transcriptLines(451_234));
  writeAt(join(dir, 'agent-empty.jsonl'), '{"type":"user"}\n');
  mkdirSync(join(dir, 'agent-dir.jsonl'));

  assert.deepEqual(measureAgentContext({ id: 'ok', session: 's1' }, env), { tokens: 451_234, at: '2026-10-24T08:00:02.000Z', path: join(dir, 'agent-ok.jsonl') });
  assert.match(measureAgentContext({ id: 'none', session: 's1' }, env).reason, /^no transcript of none under .*\.claude\/projects$/);
  assert.match(measureAgentContext({ id: 'empty', session: 's1' }, env).reason, /agent-empty\.jsonl holds no assistant message with token usage$/);
  const unreadable = measureAgentContext({ id: 'dir', session: 's1' }, env);
  assert.equal(unreadable.tokens, null);
  assert.match(unreadable.reason, /agent-dir\.jsonl cannot be read \(EISDIR\)$/);
  assert.equal(kTokens(451_234), '451k');
  assert.equal(kTokens(150_000), '150k');
});
