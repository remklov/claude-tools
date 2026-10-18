// Claim registry: who works on which ticket, visible to every session and machine (spec 01 §5.4).
// Backend git-ref: one parentless commit per claim at refs/claims/<ID> on the remote, created with
// an empty --force-with-lease (create-if-absent). Backend local: O_EXCL files in the common dir.
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { git, gitResult, lines, tryGit } from './git.mjs';
import { CwError, warn } from './out.mjs';
import { readJson, tryLock, writeJson } from './fsx.mjs';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'dev-workflow', GIT_AUTHOR_EMAIL: 'dev-workflow@localhost',
  GIT_COMMITTER_NAME: 'dev-workflow', GIT_COMMITTER_EMAIL: 'dev-workflow@localhost',
};
const NETWORK_ERROR = /(Could not read from remote|unable to access|Connection|timed out|Could not resolve host|Network is unreachable)/i;

export function sessionId() {
  return process.env.CLAUDE_CODE_SESSION_ID || `${hostname()}:${process.ppid}`;
}

export function holder(ctx) {
  let user = 'unknown';
  try {
    user = userInfo().username;
  } catch {
    // Containers without a passwd entry.
  }
  return { host: hostname(), user, session: sessionId(), checkout: ctx.mainCheckout };
}

const refName = (config, id) => `${config.namespace}/${id}`;
const localDir = (ctx) => join(ctx.stateDir, 'claims');
const localFile = (ctx, id) => join(localDir(ctx), `${id}.json`);

function payloadCommit(ctx, payload) {
  const cwd = ctx.repoRoot;
  const unique = { ...payload, nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` };
  const blob = git(['hash-object', '-w', '--stdin'], { cwd, input: `${JSON.stringify(unique, null, 2)}\n` });
  const tree = git(['mktree'], { cwd, input: `100644 blob ${blob}\tclaim.json\n` });
  return git(['commit-tree', tree, '-m', `claim ${payload.ticket}`], { cwd, env: IDENTITY });
}

function remoteSha(ctx, config, id) {
  const result = gitResult(['ls-remote', config.remote, refName(config, id)], { cwd: ctx.repoRoot, timeoutMs: 30_000 });
  if (result.code !== 0) {
    if (NETWORK_ERROR.test(result.stderr)) throw new CwError('remote unreachable', { details: { network: true } });
    throw new CwError(`git ls-remote failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split('\t')[0] || null;
}

function pushRef(ctx, config, id, { sha, expected }) {
  const ref = refName(config, id);
  const lease = `--force-with-lease=${ref}:${expected ?? ''}`;
  const spec = sha ? `${sha}:${ref}` : `:${ref}`;
  const result = gitResult(['push', '--quiet', lease, config.remote, spec], { cwd: ctx.repoRoot, timeoutMs: 60_000 });
  if (result.code !== 0 && NETWORK_ERROR.test(result.stderr)) return { ok: false, network: true, stderr: result.stderr };
  return { ok: result.code === 0, stderr: result.stderr };
}

function readPayload(ctx, sha) {
  const text = tryGit(['cat-file', '-p', `${sha}:claim.json`], { cwd: ctx.repoRoot });
  if (!text) return null;
  try {
    return { ...JSON.parse(text), sha };
  } catch {
    return null;
  }
}

function fetchClaim(ctx, config, id) {
  const sha = remoteSha(ctx, config, id);
  if (!sha) return null;
  tryGit(['fetch', '--quiet', config.remote, `+${refName(config, id)}:refs/dw/claims/${id}`], { cwd: ctx.repoRoot, timeoutMs: 60_000 });
  return readPayload(ctx, sha) ?? { ticket: id, sha, unreadable: true };
}

export function listClaims(ctx, config) {
  const claims = [];
  if (config.backend === 'git-ref') {
    const result = gitResult(['fetch', '--quiet', '--prune', config.remote, `+${config.namespace}/*:refs/dw/claims/*`], { cwd: ctx.repoRoot, timeoutMs: 60_000 });
    if (result.code !== 0) warn(`could not fetch claims from ${config.remote}: ${result.stderr.trim().split('\n')[0]}`);
    for (const line of lines(tryGit(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/dw/claims/'], { cwd: ctx.repoRoot }) ?? '')) {
      const [sha, ref] = line.split(' ');
      const payload = readPayload(ctx, sha);
      claims.push(payload ?? { ticket: ref.split('/').pop(), sha, unreadable: true });
    }
  }
  if (existsSync(localDir(ctx))) {
    for (const file of readdirSync(localDir(ctx)).filter((name) => name.endsWith('.json'))) {
      const claim = readJson(join(localDir(ctx), file), null);
      if (claim && !claims.some((other) => other.ticket === claim.ticket)) claims.push({ ...claim, local: true });
    }
  }
  return claims.sort((a, b) => String(a.ticket).localeCompare(String(b.ticket)));
}

export function getClaim(ctx, config, id) {
  if (config.backend === 'git-ref') {
    try {
      const remote = fetchClaim(ctx, config, id);
      if (remote) return remote;
    } catch (error) {
      if (!error.details?.network) throw error;
    }
  }
  const local = readJson(localFile(ctx, id), null);
  return local ? { ...local, local: true } : null;
}

const basePayload = (ctx, id, fields) => ({
  version: 1,
  ticket: id,
  title: fields.title ?? '',
  phase: fields.phase ?? 'intake',
  round: fields.round ?? 0,
  branch: fields.branch ?? null,
  task: fields.task ?? null,
  prUrl: fields.prUrl ?? null,
  onBase: fields.onBase ?? false,
  holder: holder(ctx),
  since: fields.since ?? new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

function acquireLocal(ctx, id, payload, unsynced) {
  if (!tryLock(localFile(ctx, id), { staleMs: Number.MAX_SAFE_INTEGER })) {
    return { ok: false, claim: { ...readJson(localFile(ctx, id), {}), local: true } };
  }
  writeJson(localFile(ctx, id), { ...payload, unsynced });
  return { ok: true, claim: { ...payload, local: true, unsynced } };
}

// Returns { ok: true, claim } or { ok: false, claim: <current holder> }.
export function acquire(ctx, config, id, fields = {}) {
  const payload = basePayload(ctx, id, fields);
  if (config.backend === 'local') return acquireLocal(ctx, id, payload, false);
  const sha = payloadCommit(ctx, payload);
  const pushed = pushRef(ctx, config, id, { sha, expected: '' });
  if (pushed.network) {
    warn(`remote ${config.remote} unreachable; claiming ${id} locally (unsynced). It is pushed on the next cw call that reaches the remote.`);
    return acquireLocal(ctx, id, payload, true);
  }
  const current = remoteSha(ctx, config, id);
  if (pushed.ok && current === sha) return { ok: true, claim: { ...payload, sha } };
  return { ok: false, claim: current ? fetchClaim(ctx, config, id) : null };
}

export function isMine(claim, task) {
  if (!claim) return false;
  if (task?.claim?.sha && claim.sha && task.claim.sha === claim.sha) return true;
  return claim.holder?.session === sessionId();
}

// Updates a claim this session holds; fields are merged into the payload.
export function update(ctx, config, id, expectedSha, fields) {
  const current = getClaim(ctx, config, id);
  if (!current) throw new CwError(`Claim ${id} no longer exists.`);
  const payload = { ...basePayload(ctx, id, { ...current, ...fields }), holder: current.holder ?? holder(ctx), since: current.since };
  if (current.local) {
    writeJson(localFile(ctx, id), { ...payload, unsynced: current.unsynced });
    return { ...payload, local: true };
  }
  if (expectedSha && current.sha !== expectedSha) throw new CwError(`Claim ${id} changed on the remote (held by ${current.holder?.host ?? 'someone else'}).`);
  const sha = payloadCommit(ctx, payload);
  const pushed = pushRef(ctx, config, id, { sha, expected: current.sha });
  if (!pushed.ok) throw new CwError(`Could not update claim ${id}: ${pushed.stderr.trim()}`);
  return { ...payload, sha };
}

export function release(ctx, config, id, { expectedSha, force = false } = {}) {
  const current = getClaim(ctx, config, id);
  if (!current) return false;
  if (current.local) {
    unlinkSync(localFile(ctx, id));
    return true;
  }
  if (!force && expectedSha && current.sha !== expectedSha) throw new CwError(`Claim ${id} is held by another session; use --force with --reason.`);
  const pushed = pushRef(ctx, config, id, { sha: null, expected: current.sha });
  if (!pushed.ok) throw new CwError(`Could not release claim ${id}: ${pushed.stderr.trim()}`);
  tryGit(['update-ref', '-d', `refs/dw/claims/${id}`], { cwd: ctx.repoRoot });
  return true;
}

export function steal(ctx, config, id, reason) {
  const current = getClaim(ctx, config, id);
  if (!current) return acquire(ctx, config, id);
  const payload = { ...basePayload(ctx, id, current), stolenFrom: current.holder ?? null, stealReason: reason };
  if (current.local) {
    writeJson(localFile(ctx, id), payload);
    return { ok: true, claim: { ...payload, local: true } };
  }
  const sha = payloadCommit(ctx, payload);
  const pushed = pushRef(ctx, config, id, { sha, expected: current.sha });
  return pushed.ok ? { ok: true, claim: { ...payload, sha } } : { ok: false, claim: fetchClaim(ctx, config, id) };
}

// Pushes local claims that were created offline; reports conflicts.
export function syncLocal(ctx, config) {
  if (config.backend !== 'git-ref' || !existsSync(localDir(ctx))) return [];
  const conflicts = [];
  for (const file of readdirSync(localDir(ctx)).filter((name) => name.endsWith('.json'))) {
    const claim = readJson(join(localDir(ctx), file), null);
    if (!claim?.unsynced) continue;
    const sha = payloadCommit(ctx, { ...claim, unsynced: undefined });
    const pushed = pushRef(ctx, config, claim.ticket, { sha, expected: '' });
    if (pushed.network) return conflicts;
    if (pushed.ok) unlinkSync(join(localDir(ctx), file));
    else conflicts.push({ ticket: claim.ticket, remote: fetchClaim(ctx, config, claim.ticket) });
  }
  return conflicts;
}

export function isStale(claim, config, remoteBranches) {
  const age = Date.now() - Date.parse(claim.updatedAt ?? claim.since ?? 0);
  const hasBranch = claim.branch ? remoteBranches.has(claim.branch) : false;
  return age > config.staleHours * 3600_000 && !hasBranch;
}

export function remoteBranches(ctx, config) {
  const out = tryGit(['ls-remote', '--heads', config.remote], { cwd: ctx.repoRoot, timeoutMs: 30_000 }) ?? '';
  return new Set(lines(out).map((line) => line.split('\t')[1]?.replace('refs/heads/', '')).filter(Boolean));
}

// Reserves the next free ID for a prefix (e.g. NV) across the backlog and earlier reservations.
export function reserveId(ctx, config, prefix, knownIds) {
  const reserved = new Set();
  if (config.backend === 'git-ref') {
    for (const line of lines(tryGit(['ls-remote', config.remote, `${config.idNamespace}/${prefix}-*`], { cwd: ctx.repoRoot, timeoutMs: 30_000 }) ?? '')) {
      reserved.add(line.split('\t')[1].split('/').pop());
    }
  }
  const numbers = [...knownIds, ...reserved]
    .map((id) => new RegExp(`^${prefix}-(\\d+)`).exec(id)?.[1])
    .filter(Boolean)
    .map(Number);
  let next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  for (let attempt = 0; attempt < 20; attempt += 1, next += 1) {
    const id = `${prefix}-${next}`;
    if (config.backend === 'local') {
      if (tryLock(join(ctx.stateDir, 'ticket-ids', id), { staleMs: Number.MAX_SAFE_INTEGER })) return id;
      continue;
    }
    const sha = payloadCommit(ctx, { ticket: id, reservedBy: holder(ctx), at: new Date().toISOString() });
    const ref = `${config.idNamespace}/${id}`;
    const result = gitResult(['push', '--quiet', `--force-with-lease=${ref}:`, config.remote, `${sha}:${ref}`], { cwd: ctx.repoRoot, timeoutMs: 60_000 });
    if (result.code === 0) return id;
  }
  throw new CwError(`Could not reserve an ID for prefix ${prefix}.`);
}
