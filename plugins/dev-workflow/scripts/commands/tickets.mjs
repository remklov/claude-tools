// Tickets, claims and intake (spec 02 §4.5, §4.7).
import { readFileSync, writeFileSync } from 'node:fs';
import * as claims from '../lib/claims.mjs';
import { currentBranch, gitResult, lines, tryGit } from '../lib/git.mjs';
import { color, CwError, EXIT, print, printJson, table, usageError } from '../lib/out.mjs';
import { commandExists, run } from '../lib/proc.mjs';
import { listTasks } from '../lib/task.mjs';
import { mergeBacklog } from '../lib/ticket/markdown-table.mjs';
import { ticketAdapter } from '../lib/ticket/index.mjs';
import { emit, load, need } from './common.mjs';

const remoteRef = (profile) => `${profile.tickets.claims.remote}/${profile.git.defaultBase}`;

function fetchBase(ctx, profile) {
  if (profile.tickets.claims.backend !== 'git-ref') return null;
  const result = gitResult(['fetch', '--quiet', profile.tickets.claims.remote, profile.git.defaultBase], { cwd: ctx.repoRoot, timeoutMs: 60_000 });
  return result.code === 0 ? remoteRef(profile) : null;
}

// Releases claims whose ticket no longer exists on the remote default branch (merged as done).
export function gcClaims(ctx, profile, adapter, ref) {
  const released = [];
  if (!ref || profile.tickets.adapter !== 'markdown-table') return released;
  const known = new Set(adapter.allIds({ ref }));
  const branches = claims.remoteBranches(ctx, profile.tickets.claims);
  for (const claim of claims.listClaims(ctx, profile.tickets.claims)) {
    if (claim.local || known.has(claim.ticket)) continue;
    // The row was on the default branch at intake and is gone now: the PR that deleted it was merged.
    // Rows that never reached the default branch (added in a task branch) only go when stale.
    if (!claim.onBase && !claims.isStale(claim, profile.tickets.claims, branches)) continue;
    try {
      if (claims.release(ctx, profile.tickets.claims, claim.ticket, { force: true })) released.push(claim.ticket);
    } catch {
      // Someone else updated it in between; the next gc retries.
    }
  }
  return released;
}

function describeClaim(claim, staleSet) {
  if (!claim) return '';
  const age = Math.round((Date.now() - Date.parse(claim.since ?? claim.updatedAt ?? Date.now())) / 60000);
  const ageText = age >= 120 ? `${Math.round(age / 60)} h` : `${age} min`;
  return `${claim.phase ?? '?'} · ${claim.holder?.host ?? '?'}${claim.holder?.session === claims.sessionId() ? ' (this session)' : ''} · since ${ageText}${staleSet?.has(claim.ticket) ? ' · STALE' : ''}${claim.local ? ' · local' : ''}`;
}

function availability(ctx, profile, adapter, ref) {
  const rows = adapter.list({ ref });
  const all = claims.listClaims(ctx, profile.tickets.claims);
  const byTicket = new Map(all.map((claim) => [claim.ticket, claim]));
  const branches = profile.tickets.claims.backend === 'git-ref' ? claims.remoteBranches(ctx, profile.tickets.claims) : new Set();
  const stale = new Set(all.filter((claim) => claims.isStale(claim, profile.tickets.claims, branches)).map((claim) => claim.ticket));
  const items = rows.map((row) => {
    const deps = adapter.dependencies(row.id, { ref });
    const claim = byTicket.get(row.id) ?? null;
    return { id: row.id, status: row.status, section: row.section, claim, deps, available: adapter.isOpen(row) && !claim && deps.length === 0 };
  });
  return { items, claims: all, stale };
}

export function preflight(ctx, profile, ticket) {
  const warnings = [];
  const errors = [];
  if (profile.git.host === 'github' && !(commandExists('gh') && run('gh', ['auth', 'status', '--hostname', 'github.com'], { timeoutMs: 15_000 }).code === 0)) {
    warnings.push('gh is missing or not logged in; the user runs `gh auth login` in their own terminal before the PR step');
  }
  const fetched = gitResult(['-C', ctx.mainCheckout, 'fetch', '--quiet', 'origin'], { timeoutMs: 60_000 });
  if (fetched.code !== 0) warnings.push(`git fetch origin failed: ${fetched.stderr.trim().split('\n')[0]}`);
  if (profile.isolation.mode === 'worktree') {
    const branch = currentBranch(ctx.mainCheckout);
    if (branch !== profile.git.defaultBase) warnings.push(`the main checkout is on ${branch || 'a detached HEAD'}, not ${profile.git.defaultBase}; worktrees start from its HEAD`);
  }
  const dirty = lines(tryGit(['status', '--porcelain'], { cwd: ctx.mainCheckout }) ?? '').map((line) => line.slice(3));
  if (profile.tickets.file && dirty.includes(profile.tickets.file)) errors.push(`${profile.tickets.file} has uncommitted changes in the main checkout; ask the owner to commit or discard them`);
  if (ticket && ticket !== profile.git.noTicketKey && profile.tickets.adapter === 'markdown-table') {
    const adapter = ticketAdapter({ ...ctx, repoRoot: ctx.mainCheckout }, profile);
    if (!adapter.exists(ticket, { ref: 'HEAD' })) errors.push(`${ticket} is not in ${profile.tickets.file} at the main checkout's HEAD; worktrees would not see its row`);
  }
  return { ok: errors.length === 0, warnings, errors, dirty };
}

export async function intake(flags, [id]) {
  const { ctx, profile } = load(flags);
  const adapter = ticketAdapter(ctx, profile);
  const config = profile.tickets.claims;
  const conflicts = claims.syncLocal(ctx, config);
  if (conflicts.length) throw new CwError(`Offline claims conflict with the remote: ${conflicts.map((c) => `${c.ticket} (held by ${c.remote?.holder?.host})`).join(', ')}. Stop and tell the user.`, { code: EXIT.precondition });
  const ref = fetchBase(ctx, profile);
  const released = gcClaims(ctx, profile, adapter, ref);
  const rowRef = ref ?? 'HEAD';
  let candidates;
  if (flags.next) {
    const { items } = availability(ctx, profile, adapter, rowRef);
    const order = adapter.order({ ref: rowRef });
    const rank = (item) => (order.includes(item.id) ? order.indexOf(item.id) : order.length + items.indexOf(item));
    candidates = items.filter((item) => item.available).sort((a, b) => rank(a) - rank(b)).slice(0, 5).map((item) => item.id);
    if (!candidates.length) throw new CwError('No available ticket (open, unclaimed, dependencies done).', { code: EXIT.precondition });
  } else {
    if (!id) throw usageError('usage: cw intake <ticket-id> | --next');
    if (!new RegExp(profile.tickets.idPattern).test(id) && id !== profile.git.noTicketKey) throw usageError(`${id} does not look like a ticket ID (${profile.tickets.idPattern})`);
    candidates = [id];
  }
  const dependencyWarnings = [];
  for (const ticket of candidates) {
    if (ticket !== profile.git.noTicketKey) {
      const row = adapter.show(ticket, { ref: rowRef });
      if (!row) throw new CwError(`${ticket} is not in the backlog${ref ? ` on ${ref}` : ''}.`, { code: EXIT.precondition });
      if (!adapter.isOpen(row)) throw new CwError(`${ticket} is not open (status: ${row.status}).`, { code: EXIT.precondition });
      // --next only picks tickets without open dependencies; a ticket the user names explicitly is
      // claimed with a warning, because the dependency column often holds soft prerequisites.
      const deps = adapter.dependencies(ticket, { ref: rowRef });
      if (deps.length) dependencyWarnings.push(`${ticket} lists ${deps.join(', ')} under ${profile.tickets.dependsColumn} (still open); confirm with the user that it can start now`);
    }
    const title = ticket === profile.git.noTicketKey ? '' : (adapter.show(ticket, { ref: rowRef })?.cells?.Task ?? '').slice(0, 120);
    const result = ticket === profile.git.noTicketKey ? { ok: true, claim: null } : claims.acquire(ctx, config, ticket, { title, onBase: Boolean(ref) });
    if (!result.ok) {
      if (flags.next) continue;
      const branches = config.backend === 'git-ref' ? claims.remoteBranches(ctx, config) : new Set();
      const isStale = result.claim ? claims.isStale(result.claim, config, branches) : false;
      const mine = listTasks(ctx).find((task) => task.ticket === ticket && claims.isMine(result.claim, task));
      if (mine || result.claim?.holder?.session === claims.sessionId()) {
        emit(flags, { ticket, claimed: true, resumed: true, claim: result.claim, task: mine?.id ?? null }, () => print(`${ticket} is already claimed by this session${mine ? ` (task ${mine.id}, phase ${mine.phase})` : ''}; continuing.`));
        return EXIT.ok;
      }
      emit(flags, { ticket, claimed: false, holder: result.claim, stale: isStale }, () => {
        print(color.red(`${ticket} is taken: ${describeClaim(result.claim, isStale ? new Set([ticket]) : null)}`));
        if (isStale) print(`The claim is stale. Take it over only after the user confirms: cw ticket steal ${ticket} --reason "<why>"`);
        print('Available instead: cw ticket list --available');
      });
      return EXIT.precondition;
    }
    const check = preflight(ctx, profile, ticket === profile.git.noTicketKey ? null : ticket);
    check.warnings.push(...dependencyWarnings);
    if (!check.ok) {
      if (result.claim) claims.release(ctx, config, ticket, { expectedSha: result.claim.sha });
      emit(flags, { ticket, claimed: false, preflight: check }, () => {
        print(color.red(`Preflight failed for ${ticket}; the claim was released again:`));
        for (const error of check.errors) print(`- ${error}`);
      });
      return EXIT.precondition;
    }
    const row = ticket === profile.git.noTicketKey ? null : adapter.show(ticket, { ref: rowRef });
    emit(flags, { ticket, claimed: true, claim: result.claim, row: row?.cells ?? null, preflight: check, gcReleased: released }, () => {
      print(color.green(`Claimed ${ticket}${result.claim?.local ? ' (locally; remote unreachable)' : ''}. Other sessions now see it as taken.`));
      if (row) for (const [key, value] of Object.entries(row.cells)) print(`${color.bold(key)}: ${value}`);
      for (const warning of check.warnings) print(color.yellow(`warning: ${warning}`));
      if (check.dirty.length) print(color.dim(`uncommitted in the main checkout (worktrees won't see them): ${check.dirty.join(', ')}`));
    });
    return EXIT.ok;
  }
  throw new CwError('All candidate tickets were claimed by other sessions meanwhile. Try again.', { code: EXIT.precondition });
}

export async function ticket(flags, [sub, id]) {
  const { ctx, profile } = load(flags);
  const adapter = ticketAdapter(ctx, profile);
  const config = profile.tickets.claims;
  switch (sub) {
    case 'list': {
      const ref = fetchBase(ctx, profile) ?? 'HEAD';
      const { items, stale } = availability(ctx, profile, adapter, ref);
      const shown = flags.available ? items.filter((item) => item.available) : flags.open ? items.filter((item) => adapter.isOpen({ status: item.status })) : items;
      return emit(flags, shown, (list) => print(table(list.map((item) => ({
        id: item.id, status: item.status.slice(0, 16), 'in progress': describeClaim(item.claim, stale), waits: item.deps.join(','),
      })), ['id', 'status', 'in progress', 'waits'])));
    }
    case 'show':
      return emit(flags, { row: adapter.show(need({ id }, 'id')), claim: claims.getClaim(ctx, config, id) });
    case 'claims': {
      const list = claims.listClaims(ctx, config);
      return emit(flags, list, () => print(table(list.map((claim) => ({ ticket: claim.ticket, phase: claim.phase, host: claim.holder?.host, branch: claim.branch ?? '', since: claim.since })), ['ticket', 'phase', 'host', 'branch', 'since']) || 'no claims'));
    }
    case 'claim': {
      const result = claims.acquire(ctx, config, need({ id }, 'id'), { phase: 'manual' });
      emit(flags, result, () => print(result.ok ? `claimed ${id}` : `${id} is taken: ${describeClaim(result.claim)}`));
      return result.ok ? EXIT.ok : EXIT.precondition;
    }
    case 'release': {
      const current = claims.getClaim(ctx, config, need({ id }, 'id'));
      if (!current) return print(`${id} has no claim`);
      const isOwn = current.holder?.session === claims.sessionId() || listTasks(ctx, { all: true }).some((task) => task.ticket === id && claims.isMine(current, task));
      if (!isOwn && !(flags.force && typeof flags.reason === 'string')) throw new CwError(`${id} is held by ${describeClaim(current)}; use --force --reason "<why>" after the user confirms.`, { code: EXIT.precondition });
      claims.release(ctx, config, id, { force: true });
      return print(`released ${id}`);
    }
    case 'steal': {
      const reason = need(flags, 'reason');
      const current = claims.getClaim(ctx, config, need({ id }, 'id'));
      const branches = claims.remoteBranches(ctx, config);
      if (current && !claims.isStale(current, config, branches) && !flags.force) throw new CwError(`${id} is not stale (${describeClaim(current)}).`, { code: EXIT.precondition });
      const result = claims.steal(ctx, config, id, reason);
      return print(result.ok ? `took over ${id}` : `could not take over ${id}`);
    }
    case 'gc': {
      const released = gcClaims(ctx, profile, adapter, fetchBase(ctx, profile));
      return emit(flags, { released }, () => print(released.length ? `released ${released.join(', ')}` : 'nothing to release'));
    }
    case 'reserve-id': {
      const prefix = need({ id }, 'id', 'ID prefix such as NV');
      const ref = fetchBase(ctx, profile);
      const known = new Set([...adapter.allIds({}), ...(ref ? adapter.allIds({ ref }) : [])]);
      const reserved = claims.reserveId(ctx, config, prefix.toUpperCase(), known);
      return emit(flags, { id: reserved }, () => print(reserved));
    }
    case 'done': {
      const ok = adapter.done(need({ id }, 'id'));
      return print(ok ? `deleted the row of ${id} in ${adapter.file}` : `${id} not found in ${adapter.file}`);
    }
    case 'new-row': {
      const section = need(flags, 'section');
      const prefix = profile.tickets.newRowSections[Object.keys(profile.tickets.newRowSections).find((key) => section.startsWith(key))] ?? need(flags, 'prefix');
      const ref = fetchBase(ctx, profile);
      const known = new Set([...adapter.allIds({}), ...(ref ? adapter.allIds({ ref }) : [])]);
      const newId = claims.reserveId(ctx, config, prefix, known);
      const cells = JSON.parse(flags.cells ?? '{}');
      adapter.newRow({ section, id: newId, cells });
      return emit(flags, { id: newId }, () => print(`added ${newId} to ${adapter.file}`));
    }
    case 'migrate-status': {
      const rows = adapter.list().filter((row) => !adapter.isOpen(row) && /in progress|🔄/i.test(row.status));
      if (!flags.apply) return emit(flags, rows.map((row) => ({ id: row.id, status: row.status })), (list) => print(list.length ? `${list.map((row) => `${row.id}: ${row.status}`).join('\n')}\nRun with --apply reset (status back to open) or --apply claim.` : 'no in-progress markers'));
      const path = `${ctx.repoRoot}/${profile.tickets.file}`;
      let text = readFileSync(path, 'utf8');
      for (const row of rows) {
        if (flags.apply === 'claim') claims.acquire(ctx, config, row.id, { phase: 'migrated' });
        text = text.replace(row.raw, row.raw.replace(row.status, profile.tickets.statusOpen));
      }
      writeFileSync(path, text);
      return print(`reset ${rows.length} status cell(s)${flags.apply === 'claim' ? ' and created claims' : ''}; commit ${profile.tickets.file}`);
    }
    default:
      throw usageError('usage: cw ticket <list [--available]|show|claims|claim|release|steal|gc|reserve-id|done|new-row|migrate-status> …');
  }
}

// git merge driver: cw merge-driver ticket-table %O %A %B
export async function mergeDriver(flags, [kind, base, ours, theirs]) {
  if (kind !== 'ticket-table' || !base || !ours || !theirs) throw usageError('usage: cw merge-driver ticket-table %O %A %B');
  const ctxColumns = { id: 'ID', status: 'Status' };
  let columns = ctxColumns;
  try {
    columns = load({ ...flags, json: true }).profile.tickets.columns;
  } catch {
    // Outside a profile (rare): default columns.
  }
  const { text, conflicts } = mergeBacklog(readFileSync(base, 'utf8'), readFileSync(ours, 'utf8'), readFileSync(theirs, 'utf8'), columns);
  writeFileSync(ours, text);
  return conflicts.length ? EXIT.failed : EXIT.ok;
}

export { printJson };
