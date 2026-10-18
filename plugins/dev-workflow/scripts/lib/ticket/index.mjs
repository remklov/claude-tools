// Ticket adapters. They provide backlog content only; "in progress" lives in the claim registry.
import { run } from '../proc.mjs';
import { CwError } from '../out.mjs';
import { createMarkdownTableAdapter } from './markdown-table.mjs';

function createGithubIssuesAdapter(ctx) {
  const gh = (args) => {
    const result = run('gh', args, { cwd: ctx.repoRoot, timeoutMs: 60_000 });
    if (result.code !== 0) throw new CwError(`gh ${args.join(' ')} failed: ${result.stderr.trim()}`);
    return JSON.parse(result.stdout || 'null');
  };
  const toRow = (issue) => ({ id: `#${issue.number}`, status: issue.state === 'OPEN' ? 'open' : 'closed', cells: { Task: issue.title }, section: '', title: issue.title, labels: (issue.labels ?? []).map((label) => label.name) });
  const number = (id) => String(id).replace(/^#/, '');
  return {
    name: 'github-issues',
    file: null,
    list({ open = false } = {}) {
      return gh(['issue', 'list', '--state', open ? 'open' : 'all', '--limit', '500', '--json', 'number,title,state,labels']).map(toRow);
    },
    show(id) {
      return toRow(gh(['issue', 'view', number(id), '--json', 'number,title,state,labels,body']));
    },
    exists(id) {
      try {
        return Boolean(this.show(id));
      } catch {
        return false;
      }
    },
    isOpen: (row) => row.status === 'open',
    dependencies: () => [],
    order: () => [],
    done: () => false,
    newRow: () => {
      throw new CwError('github-issues: create the issue with gh issue create');
    },
    allIds() {
      return this.list().map((row) => row.id);
    },
  };
}

function createNoneAdapter() {
  return {
    name: 'none',
    file: null,
    list: () => [],
    show: (id) => ({ id, status: 'open', cells: {}, section: '' }),
    exists: () => true,
    isOpen: () => true,
    dependencies: () => [],
    order: () => [],
    done: () => false,
    newRow: ({ id }) => id,
    allIds: () => [],
  };
}

export function ticketAdapter(ctx, profile) {
  switch (profile.tickets.adapter) {
    case 'markdown-table':
      return createMarkdownTableAdapter(ctx, profile);
    case 'github-issues':
      return createGithubIssuesAdapter(ctx, profile);
    default:
      return createNoneAdapter();
  }
}
