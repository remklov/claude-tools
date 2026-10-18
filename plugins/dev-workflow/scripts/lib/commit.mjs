// Commit message building and git convention lint (branch name, summaries, body wrap, trailers).
import { git, lines, tryGit } from './git.mjs';
import { render, SLUG_PATTERN, templateToRegExp } from './template.mjs';

export function wrapText(text, width) {
  const out = [];
  let inFence = false;
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    if (paragraph.trim().startsWith('```')) inFence = !inFence;
    if (inFence || paragraph.trim().startsWith('```') || paragraph.length <= width || /^\s*\S+$/.test(paragraph) || /https?:\/\//.test(paragraph)) {
      out.push(paragraph);
      continue;
    }
    const bullet = /^(\s*(?:[-*]|\d+\.)\s+)/.exec(paragraph)?.[1] ?? '';
    const indent = ' '.repeat(bullet.length);
    let line = bullet;
    for (const word of paragraph.slice(bullet.length).split(/\s+/)) {
      if (line.trim() && (line + word).length > width) {
        out.push(line.trimEnd());
        line = indent;
      }
      line += `${word} `;
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out.join('\n');
}

export function buildMessage(profile, { ticket, summary, keyword, flag, body }) {
  const isNoTicket = !ticket || ticket === profile.git.noTicketKey;
  const template = isNoTicket ? profile.git.commitSummaryNoTicket : profile.git.commitSummary;
  const first = render(template, { summary, ticket, keyword: [flag, keyword].filter(Boolean).join(' ') }).replace(/\s+/g, ' ').trim();
  const parts = [first];
  if (body?.trim()) parts.push(wrapText(body.trim(), profile.git.bodyWrap));
  const trailers = isNoTicket ? [] : profile.git.commitTrailers.map((trailer) => render(trailer, { ticket }));
  if (trailers.length) parts.push(trailers.join('\n'));
  return `${parts.join('\n\n')}\n`;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function keywordPattern(profile) {
  const { keywords, flags } = profile.git;
  if (!keywords.length) return '\\S+';
  const flagPart = flags.length ? `(?:(?:${flags.map(escapeRegex).join('|')}) )*` : '';
  return `${flagPart}(?:${keywords.map(escapeRegex).join('|')})`;
}

const tokens = (profile) => ({
  ticket: '[A-Za-z0-9#-]+',
  slug: SLUG_PATTERN,
  type: profile.git.branchTypes.length ? profile.git.branchTypes.join('|') : '[a-z]+',
  summary: '.+',
  keyword: keywordPattern(profile),
});

export function lintMessage(profile, message, { ticket } = {}) {
  const problems = [];
  const [summary, ...rest] = message.replace(/\n+$/, '').split('\n');
  const isNoTicket = !ticket || ticket === profile.git.noTicketKey;
  const template = isNoTicket ? profile.git.commitSummaryNoTicket : profile.git.commitSummary;
  if (!templateToRegExp(template, tokens(profile)).test(summary)) problems.push(`summary "${summary}" does not match ${template}`);
  if (summary.length > profile.git.summaryMax) problems.push(`summary is ${summary.length} characters (max ${profile.git.summaryMax})`);
  else if (profile.git.summaryIdeal && summary.length > profile.git.summaryIdeal) problems.push(`advisory: summary longer than ${profile.git.summaryIdeal} characters`);
  if (/^(fixup!|squash!|WIP\b)/i.test(summary)) problems.push('fixup/squash/WIP commits are not allowed');
  if (rest.length && rest[0].trim() !== '') problems.push('second line must be empty');
  let inFence = false;
  for (const line of rest) {
    if (line.trim().startsWith('```')) inFence = !inFence;
    if (!inFence && line.length > profile.git.bodyWrap && !/https?:\/\//.test(line) && /\s/.test(line.trim())) {
      problems.push(`body line longer than ${profile.git.bodyWrap}: "${line.slice(0, 40)}…"`);
    }
  }
  if (!isNoTicket) {
    for (const trailer of profile.git.commitTrailers.map((t) => render(t, { ticket }))) {
      if (!message.includes(trailer)) problems.push(`missing trailer "${trailer}"`);
    }
  }
  return problems;
}

export function lintBranch(profile, branch, ticket) {
  const template = !ticket || ticket === profile.git.noTicketKey ? profile.git.branchNoTicket : profile.git.branch;
  return templateToRegExp(template, tokens(profile)).test(branch) ? [] : [`branch ${branch} does not match ${template}`];
}

export function lintRange(ctx, profile, task, { last = false } = {}) {
  const findings = [];
  const branch = tryGit(['branch', '--show-current'], { cwd: ctx.repoRoot }) ?? '';
  findings.push(...lintBranch(profile, branch, task.ticket).map((message) => ({ commit: null, message })));
  const range = last ? ['-1'] : [`${task.base.commit}..HEAD`];
  const shas = lines(git(['log', '--format=%H', ...range], { cwd: ctx.repoRoot }));
  for (const sha of shas) {
    const message = git(['log', '-1', '--format=%B', sha], { cwd: ctx.repoRoot });
    const cleaned = message.split('\n').filter((line) => !/^(Co-Authored-By|Claude-Session|Signed-off-by):/i.test(line)).join('\n').replace(/\n+$/, '');
    for (const problem of lintMessage(profile, cleaned, { ticket: task.ticket })) findings.push({ commit: sha.slice(0, 10), message: problem });
  }
  return { commits: shas.length, findings, errors: findings.filter((f) => !f.message.startsWith('advisory:')) };
}

export function foreignCommits(ctx, task) {
  const shas = lines(tryGit(['log', '--format=%H', `${task.base.commit}..HEAD`], { cwd: ctx.repoRoot }) ?? '');
  const branch = tryGit(['branch', '--show-current'], { cwd: ctx.repoRoot });
  const foreign = [];
  for (const sha of shas) {
    const owners = lines(tryGit(['branch', '--format=%(refname:short)', '--contains', sha], { cwd: ctx.repoRoot }) ?? '')
      .filter((name) => name !== branch && !name.startsWith('worktree-agent-'));
    const authored = Date.parse(tryGit(['log', '-1', '--format=%aI', sha], { cwd: ctx.repoRoot }) ?? 0);
    if (owners.length || authored < Date.parse(task.createdAt) - 60_000) {
      foreign.push({ sha: sha.slice(0, 10), subject: tryGit(['log', '-1', '--format=%s', sha], { cwd: ctx.repoRoot }), alsoOn: owners });
    }
  }
  return foreign;
}
