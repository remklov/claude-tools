import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as claims from '../../scripts/lib/claims.mjs';
import { findContext } from '../../scripts/lib/ctx.mjs';
import { loadProfile } from '../../scripts/lib/profile.mjs';
import { mergeBacklog, parseBacklog } from '../../scripts/lib/ticket/markdown-table.mjs';
import { BACKLOG, cleanEnv, cw, cwBin, git, makeProject } from '../helpers/repo.mjs';

const runCw = (cwd, args, session) => new Promise((resolve) => {
  const child = spawn('node', [cwBin, ...args], { cwd, env: cleanEnv({ CLAUDE_CODE_SESSION_ID: session }) });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ code, out }));
});

test('two sessions race for one ticket: exactly one wins, both see the claim', async () => {
  const { root, base } = makeProject();
  const second = join(base, 'second');
  git(base, 'clone', '-q', join(base, 'remote.git'), second);
  const [a, b] = await Promise.all([runCw(root, ['intake', 'AB-1'], 'session-a'), runCw(second, ['intake', 'AB-1'], 'session-b')]);
  assert.deepEqual([a.code, b.code].sort(), [0, 3]);
  const loser = a.code === 3 ? a : b;
  assert.match(loser.out, /AB-1 is taken/);
  const listed = cw(second, ['ticket', 'claims', '--json']);
  assert.equal(JSON.parse(listed.stdout)[0].ticket, 'AB-1');
});

test('the same session re-entering intake continues; others get exit 3', () => {
  const { root } = makeProject();
  assert.equal(cw(root, ['intake', 'AB-2']).code, 0);
  assert.match(cw(root, ['intake', 'AB-2']).stdout, /already claimed by this session/);
  assert.equal(cw(root, ['intake', 'AB-2'], { env: { CLAUDE_CODE_SESSION_ID: 'other' } }).code, 3);
});

test('intake --next follows the suggested order and skips claimed and non-open tickets', () => {
  const { root } = makeProject();
  const first = JSON.parse(cw(root, ['intake', '--next', '--json']).stdout);
  assert.equal(first.ticket, 'AB-2');
  const second = JSON.parse(cw(root, ['intake', '--next', '--json'], { env: { CLAUDE_CODE_SESSION_ID: 'other' } }).stdout);
  assert.equal(second.ticket, 'AB-1');
  const available = JSON.parse(cw(root, ['ticket', 'list', '--available', '--json']).stdout).map((item) => item.id);
  assert.deepEqual(available, []);
});

test('an explicit ticket with open dependencies is claimed with a warning', () => {
  const { root } = makeProject();
  const result = JSON.parse(cw(root, ['intake', 'AB-3', '--json']).stdout);
  assert.equal(result.claimed, true);
  assert.match(result.preflight.warnings.join(' '), /AB-1/);
});

test('update with a stale lease fails; release frees the ticket', () => {
  const { root } = makeProject();
  const ctx = findContext(root);
  const config = loadProfile(ctx).tickets.claims;
  const won = claims.acquire(ctx, config, 'AB-1', { title: 't' });
  assert.equal(won.ok, true);
  const updated = claims.update(ctx, config, 'AB-1', won.claim.sha, { phase: 'implement' });
  assert.throws(() => claims.update(ctx, config, 'AB-1', won.claim.sha, { phase: 'review' }), /changed on the remote/);
  assert.equal(claims.getClaim(ctx, config, 'AB-1').phase, 'implement');
  claims.release(ctx, config, 'AB-1', { expectedSha: updated.sha });
  assert.equal(claims.getClaim(ctx, config, 'AB-1'), null);
});

test('reserve-id hands out unique IDs across the backlog and earlier reservations', () => {
  const { root } = makeProject();
  const one = cw(root, ['ticket', 'reserve-id', 'AB']).stdout.trim();
  const two = cw(root, ['ticket', 'reserve-id', 'AB']).stdout.trim();
  assert.deepEqual([one, two], ['AB-5', 'AB-6']);
});

test('gc releases the claim once the row is gone from the remote default branch', () => {
  const { root } = makeProject();
  assert.equal(cw(root, ['intake', 'AB-1']).code, 0);
  const path = join(root, 'plan/NEXT_STEPS.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\| AB-1 .*\n/, ''));
  git(root, 'commit', '-qam', 'AB-1 done');
  git(root, 'push', '-q', 'origin', 'main');
  assert.deepEqual(JSON.parse(cw(root, ['ticket', 'gc', '--json']).stdout).released, ['AB-1']);
});

test('the backlog parser reads tables, statuses and sections', () => {
  const rows = parseBacklog(BACKLOG, { id: 'ID', status: 'Status' });
  assert.deepEqual(rows.map((row) => row.id), ['AB-1', 'AB-2', 'AB-3', 'AB-4']);
  assert.equal(rows[3].status, '👤 Owner');
  assert.equal(rows[0].section, 'Area A');
});

test('the merge driver merges rows by ID: parallel deletions and additions', () => {
  const base = BACKLOG;
  const ours = BACKLOG.replace(/\| AB-1 .*\n/, '').replace('| AB-4 |', '| AB-5 | Ours | ⬜ Open | — |\n| AB-4 |');
  const theirs = BACKLOG.replace(/\| AB-2 .*\n/, '').replace(/(\| AB-4 .*\n)/, '$1| AB-6 | Theirs | ⬜ Open | — |\n');
  const { text, conflicts } = mergeBacklog(base, ours, theirs, { id: 'ID', status: 'Status' });
  assert.deepEqual(conflicts, []);
  assert.deepEqual(parseBacklog(text, { id: 'ID', status: 'Status' }).map((row) => row.id).sort(), ['AB-3', 'AB-4', 'AB-5', 'AB-6']);
});

test('the merge driver keeps ours and notes a row changed on both sides', () => {
  const ours = BACKLOG.replace('Add the sum helper', 'Ours');
  const theirs = BACKLOG.replace('Add the sum helper', 'Theirs');
  const { text, conflicts } = mergeBacklog(BACKLOG, ours, theirs, { id: 'ID', status: 'Status' });
  assert.deepEqual(conflicts, ['AB-1']);
  assert.match(text, /\| AB-1 \| Ours/);
  assert.match(text, /dw: AB-1 changed on both sides/);
});
