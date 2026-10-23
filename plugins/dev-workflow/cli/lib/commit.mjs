// Git conventions as data (D8, §10): commit messages built from and linted against the git preset
// (config.git.conventions), a task's commits and branch checked against it, and the commits on the
// task branch that belong elsewhere.
import { branchExists, commitsBetween, git, gitResult, lines } from './git.mjs';
import { failedError, preconditionError, usageError } from './out.mjs';
import { render, templateToRegExp } from './template.mjs';
import { NO_TICKET_ALIAS, isNoTicket } from './ticket.mjs';

const ATTRIBUTION = /^(Co-Authored-By|Signed-off-by):/i;
const FORBIDDEN_PREFIX = /^(fixup!|squash!|amend!|WIP\b)/i;
const URL = /https?:\/\//;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const CODE_LINE = /^(?: {4}|\t)/;
const LOWERCASE_START = /^\p{Ll}/u;

const escapeRegExp = (text) => String(text).replace(/[\\^$+*?.()|[\]{}]/g, '\\$&');
const bare = (value) => String(value).trim().replace(/^\[(.*)\]$/, '$1').toUpperCase();

// 'feature', 'FEATURE' and '[FEATURE]' -> '[FEATURE]'.
export function normalizeKeyword(preset, value) {
  const name = bare(value ?? '');
  if (!preset.commit.keywords.includes(name)) {
    throw usageError(`--keyword ${value} is not a commit keyword`, `Use one of ${preset.commit.keywords.join(', ')}.`);
  }
  return `[${name}]`;
}

// Flags in preset order, bracketed: ['security', '!!!'] -> ['[!!!]', '[SECURITY]'].
export function normalizeFlags(preset, values = []) {
  const names = values.map(bare);
  const unknown = names.filter((name) => !preset.commit.flags.includes(name));
  if (unknown.length) throw usageError(`--flag ${unknown.join(', ')} is not a commit flag`, `Use ${preset.commit.flags.join(' or ')}.`);
  return preset.commit.flags.filter((flag) => names.includes(flag)).map((flag) => `[${flag}]`);
}

// Lines inside a ``` fence, code indented by 4 spaces or a tab, list items, lines with a URL and single
// tokens are never wrapped (§10).
const isExempt = (line, width) => line.length <= width || CODE_LINE.test(line) || LIST_ITEM.test(line) || URL.test(line) || !/\s/.test(line.trim());

export function wrapText(text, width) {
  const out = [];
  let inFence = false;
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const isFence = line.trim().startsWith('```');
    if (isFence) inFence = !inFence;
    if (isFence || inFence || isExempt(line, width)) {
      out.push(line);
      continue;
    }
    const indent = /^\s*/.exec(line)[0];
    let current = '';
    for (const word of line.trim().split(/\s+/)) {
      if (current && `${indent}${current} ${word}`.length > width) {
        out.push(`${indent}${current}`);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    out.push(`${indent}${current}`);
  }
  return out.join('\n');
}

const summaryPattern = (preset) => {
  const flags = preset.commit.flags.map(escapeRegExp).join('|');
  const keywords = preset.commit.keywords.map(escapeRegExp).join('|');
  return new RegExp(`^((?:\\[(?:${flags})\\] ?)*)\\[(?:${keywords})\\] (.*)$`);
};

// "[!!!][FEATURE] Add x" or "[!!!] [FEATURE] Add x" -> { flags: ['!!!'], keyword: 'FEATURE', text: 'Add x' }.
export function parseSummary(summary, preset) {
  const result = { flags: [], keyword: null, text: String(summary) };
  let rest = String(summary);
  for (let match = /^\[([^\]]+)\]\s*/.exec(rest); match; match = /^\[([^\]]+)\]\s*/.exec(rest)) {
    if (preset.commit.flags.includes(match[1])) result.flags.push(match[1]);
    else if (!result.keyword && preset.commit.keywords.includes(match[1])) result.keyword = match[1];
    else break;
    rest = rest.slice(match[0].length);
  }
  result.text = rest.trim();
  return result;
}

// The PR/MR title (§8 Decided in P2): the oldest commit's keyword and text with the flags of all the
// commits, in preset order; null when the oldest commit has no keyword. commits: [{ subject }], oldest first.
export function titleOf(preset, commits) {
  const first = parseSummary(commits[0].subject, preset);
  if (!first.keyword) return null;
  const used = new Set(commits.flatMap((commit) => parseSummary(commit.subject, preset).flags));
  return `${preset.commit.flags.filter((flag) => used.has(flag)).map((flag) => `[${flag}]`).join('')}[${first.keyword}] ${first.text}`;
}

// Findings for the first line: { level: 'error' | 'advisory', message }.
export function lintSummary(preset, line) {
  const findings = [];
  const error = (message) => findings.push({ level: 'error', message });
  if (FORBIDDEN_PREFIX.test(line)) error('fixup!, squash!, amend! and WIP commits are not allowed; squash them into the commit they fix');
  const match = summaryPattern(preset).exec(line);
  if (!match) {
    error(`the summary "${line}" must start with one keyword ${preset.commit.keywords.map((k) => `[${k}]`).join(' ')}, flags ${preset.commit.flags.map((f) => `[${f}]`).join(' ')} before it`);
  } else if (!match[2].trim()) {
    error('the summary has no text after the keyword');
  } else if (LOWERCASE_START.test(match[2])) {
    error('start the summary text with a capital letter (imperative mood: "Add …")');
  }
  if (line.length > preset.commit.summaryMax) error(`the summary line is ${line.length} characters (max ${preset.commit.summaryMax})`);
  else if (line.length > preset.commit.summaryIdeal) findings.push({ level: 'advisory', message: `the summary line is ${line.length} characters (ideally ≤ ${preset.commit.summaryIdeal})` });
  return findings;
}

// The whole message: summary, blank second line, body width, and the Relates-to trailer (§10).
export function lintMessage(preset, message, { ticket, noTicket, noTicketKey }) {
  const lines = String(message).replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
  const findings = lintSummary(preset, lines[0]);
  const error = (text) => findings.push({ level: 'error', message: text });
  if (lines.length > 1 && lines[1].trim() !== '') error('the second line must be blank');
  let end = lines.length;
  while (end > 1 && (ATTRIBUTION.test(lines[end - 1]) || lines[end - 1].trim() === '')) end -= 1;
  const content = lines.slice(0, end);
  let inFence = false;
  content.slice(2).forEach((line, index) => {
    const isFence = line.trim().startsWith('```');
    if (isFence) inFence = !inFence;
    if (!isFence && !inFence && !isExempt(line, preset.commit.bodyWrap)) {
      error(`body line ${index + 3} is ${line.length} characters (wrap at ${preset.commit.bodyWrap}): "${line.slice(0, 40)}…"`);
    }
  });
  const trailers = [];
  for (let i = content.length - 1; i > 0 && /^Relates to \S+$/.test(content[i]); i -= 1) trailers.push(content[i]);
  if (noTicket) {
    const forbidden = [noTicketKey, NO_TICKET_ALIAS].map((key) => `Relates to ${key}`);
    if (content.some((line) => forbidden.includes(line))) error(`remove "Relates to ${noTicketKey}": the no-ticket key has no ticket to relate to`);
  } else {
    const expected = render(preset.commit.trailers[0] ?? 'Relates to {ticket}', { ticket });
    if (!trailers.includes(expected)) error(`the message must end with "${expected}" (attribution lines may follow it)`);
  }
  return findings;
}

// The branch must follow the preset's {ticket}/{type}/{slug} for the task's ticket.
export function lintBranch(preset, branch, ticket) {
  const pattern = templateToRegExp(preset.branch, {
    ticket: escapeRegExp(ticket),
    type: preset.types.map(escapeRegExp).join('|'),
    slug: String(preset.slug).replace(/^\^/, '').replace(/\$$/, ''),
  });
  return pattern.test(branch) ? [] : [{ level: 'error', message: `the branch ${branch} does not match ${preset.branch} for ${ticket} (types ${preset.types.join(', ')})` }];
}

// Builds the commit message; problems with the summary are exit 1, the ideal length a warning.
// trailers (e.g. Co-Authored-By lines an agent's instructions require) go last, after the ticket trailer.
export function buildMessage(preset, { ticket, noTicket, summary, keyword, flags = [], body = '', trailers = [] }) {
  const text = String(summary ?? '').trim();
  const fix = 'Pass --summary "<Imperative summary>" without the keyword; the keyword and flags come from --keyword and --flag.';
  if (!text) throw failedError('the summary is empty', fix);
  if (/\n/.test(text)) throw failedError('the summary must be one line', fix);
  if (text.startsWith('[')) throw failedError(`the summary "${text}" starts with "["`, fix);
  const first = `${flags.join('')}${keyword} ${text}`;
  const findings = lintSummary(preset, first);
  const errors = findings.filter((finding) => finding.level === 'error');
  if (errors.length) throw failedError(errors.map((finding) => finding.message).join('; '), 'Shorten or reword --summary.');
  const parts = [first];
  const wrapped = wrapText(String(body).trim(), preset.commit.bodyWrap);
  if (wrapped.trim()) parts.push(wrapped);
  const closing = [...(noTicket ? [] : preset.commit.trailers.map((trailer) => render(trailer, { ticket }))), ...trailers];
  if (closing.length) parts.push(closing.join('\n'));
  return { message: `${parts.join('\n\n')}\n`, warnings: findings.filter((finding) => finding.level === 'advisory').map((finding) => finding.message) };
}

// The task's commits (base.commit..refs/heads/<branch>, oldest first) in its work tree, never the cwd.
export function taskCommits(workTree, task) {
  const raw = git(['log', '--reverse', '--format=%H%x1f%P%x1f%B%x1e', `${task.base.commit}..refs/heads/${task.branch}`], { cwd: workTree });
  return raw
    .split('\x1e')
    .map((chunk) => chunk.replace(/^\n/, ''))
    .filter(Boolean)
    .map((chunk) => {
      const [sha, parents, message] = chunk.split('\x1f');
      return { sha, parents: parents.split(' ').filter(Boolean), message, subject: message.split('\n')[0] };
    });
}

// The task branch, its copies on remotes, Claude Code's agent branches and remote HEADs.
function isOwnRef(ref, branch) {
  if (ref === `refs/heads/${branch}` || ref.startsWith('refs/heads/worktree-agent-')) return true;
  const remoteBranch = /^refs\/remotes\/[^/]+\/(.+)$/.exec(ref)?.[1];
  return remoteBranch === branch || remoteBranch === 'HEAD';
}

// Commits between the base and the branch tip that belong elsewhere: also on another branch, or
// authored before the task existed (a cherry-pick or a rebase onto the wrong base). Oldest first;
// index is the position among all task commits. Used by cw git foreign-commits and cw review scope.
export function foreignCommits(workTree, task) {
  const commits = commitsBetween(workTree, task.base.commit, `refs/heads/${task.branch}`).reverse();
  const created = Date.parse(task.createdAt);
  const foreign = [];
  commits.forEach((commit, index) => {
    const refs = lines(git(['for-each-ref', '--contains', commit.sha, '--format=%(refname)', 'refs/heads', 'refs/remotes'], { cwd: workTree }));
    const alsoOn = refs.filter((ref) => !isOwnRef(ref, task.branch)).map((ref) => ref.replace(/^refs\/(heads|remotes)\//, ''));
    const reasons = [];
    if (alsoOn.length) reasons.push('other-branch');
    if (Date.parse(git(['log', '-1', '--format=%aI', commit.sha], { cwd: workTree })) < created - 60_000) reasons.push('predates-task');
    if (reasons.length) foreign.push({ index, sha: commit.sha.slice(0, 10), fullSha: commit.sha, subject: commit.subject, alsoOn, reasons });
  });
  return { count: commits.length, foreign };
}

// cw commit lint: the branch name plus every task commit; merge commits are errors (rebase instead). The
// PR/MR title built from all the commits must fit the summary limit too, so cw pr title cannot fail
// after the review approved the branch; that finding sits on the oldest commit, also with last.
export function lintRange({ config, workTree, task, last = false }) {
  const preset = config.git.conventions;
  if (!task.base?.commit) throw preconditionError(`Task ${task.id} has no recorded base.`, `The orchestrator starts the task with cw task start --task ${task.id}.`);
  if (!branchExists(workTree, task.branch)) {
    throw preconditionError(`The task branch ${task.branch} does not exist in ${workTree}.`, `Run cw ws setup --task ${task.id} first.`);
  }
  const options = { ticket: task.ticket, noTicket: isNoTicket(config, task.ticket), noTicketKey: config.git.noTicketKey };
  const findings = lintBranch(preset, task.branch, task.ticket).map((finding) => ({ commit: null, ...finding }));
  const all = taskCommits(workTree, task);
  const commits = last ? all.slice(-1) : all;
  for (const commit of commits) {
    const sha = commit.sha.slice(0, 10);
    if (commit.parents.length > 1) findings.push({ commit: sha, level: 'error', message: 'merge commit in the task branch; rebase instead' });
    for (const finding of lintMessage(preset, commit.message, options)) findings.push({ commit: sha, ...finding });
  }
  const title = all.length ? titleOf(preset, all) : null;
  const max = preset.commit.summaryMax;
  // A first summary over the limit has its own finding already. Once the branch is pushed (or its
  // PR/MR recorded) the title is set already and rebuilding the branch would need a force push, so
  // the finding is only advisory then.
  if (title && title.length > max && all[0].subject.length <= max) {
    const delivered = Boolean(task.prUrl) || gitResult(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${task.branch}`], { cwd: workTree }).code === 0;
    findings.push({
      commit: all[0].sha.slice(0, 10),
      level: delivered ? 'advisory' : 'error',
      kind: 'pr-title',
      message: delivered
        ? `the PR/MR title "${title}" would be ${title.length} characters (max ${max}); the branch is pushed already, so keep the commits and shorten the PR/MR title by hand if it is created again`
        : `the PR/MR title "${title}" is ${title.length} characters (max ${max}): it is this commit's summary with the flags of all the task's commits; shorten this commit's summary`,
    });
  }
  return {
    task: task.id,
    branch: task.branch,
    workTree,
    base: task.base.commit,
    commits: commits.map((commit) => ({ sha: commit.sha.slice(0, 10), subject: commit.subject })),
    findings,
    errors: findings.filter((finding) => finding.level === 'error').length,
  };
}
