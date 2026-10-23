// The role context SubagentStart gives a workflow agent (§9): ≤ 6,000 characters with the task, the
// work tree and its mode, the git form to use, the packages with their checks, a guards summary and
// where the brief is. The brief itself stays the source of truth; this is the orientation.
import { relative } from 'node:path';
import { quote } from '../../cli/lib/host/index.mjs';
import { gitCwdNote, gitForm } from '../../cli/lib/workspace.mjs';

export const CONTEXT_MAX = 6000;

// The git prefix for the reviewer of a worktree task, which reads the implementer's worktree from its
// own cwd: plain git inside it, else git -C with the relative path.
export function treeGitForm(cwd, tree) {
  const rel = relative(cwd, tree);
  return rel === '' ? 'git' : `git -C ${quote(rel)}`;
}

function workLines({ ws, task, role, cwd }) {
  if (ws.mode === 'in-place') {
    // The form the brief and cw context print (cli/lib/workspace.mjs): git -C <appRoot> from the project root.
    const note = gitCwdNote(ws, cwd);
    return [
      `Mode: in-place · work tree ${ws.workRepo} (the application repo inside the project ${ws.configRoot}).`,
      `Git: \`${gitForm(ws)} …\` exactly in this form, from the project root (your Bash cwd stays there; never cd); use absolute paths for files.${role === 'reviewer' ? ' Read-only: log, diff, show, status.' : ''}`,
      ...(note ? [`Note: ${note}`] : []),
    ];
  }
  if (role === 'implementer') {
    return [
      `Mode: worktree · work tree: your own worktree ${cwd} (Claude Code created it for this Agent call; cw ws setup --task ${task.id} puts the task branch there).`,
      'Git: plain `git …` in your worktree; no `git -C` and no command substitution around git (the harness refuses them in an isolated agent).',
    ];
  }
  const tree = task.workTree;
  return [
    `Mode: worktree · work tree to review, read-only: ${tree ?? "the implementer's worktree (cw review scope names it)"}.`,
    `Git: ${tree ? `\`${treeGitForm(cwd, tree)} …\`` : '`git -C <that worktree> …`'} for log, diff, show and status; never cd.`,
  ];
}

function packageLines(ws, task, { short = false } = {}) {
  const ids = task.packages?.length ? task.packages : ws.config.packages.map((pkg) => pkg.id);
  const packages = ws.config.packages.filter((pkg) => ids.includes(pkg.id));
  return packages.map((pkg) => {
    const checks = Object.entries(pkg.checks ?? {});
    const listed = short ? checks.map(([name]) => name).join(', ') : checks.map(([name, command]) => `${name} \`${command}\``).join(' · ');
    return `- ${pkg.id} (path ${pkg.path}; areas ${(pkg.areas ?? []).join(', ') || '-'}): ${listed || 'no checks'}`;
  });
}

function guardLines({ ws, role, guards }) {
  const lines = [
    '- no force push; no git push, gh pr create/merge or glab mr create/merge: the orchestrator delivers after the user confirms.',
  ];
  if (role === 'reviewer') {
    lines.push('- read-only: no git write commands (commit, add, checkout, switch, reset, stash, …) and no redirection, tee, sed -i, cp, mv, rm or touch into the project.');
  }
  if (guards.dependencyCommands.length) {
    const what = role === 'implementer' ? 'report blocked with the package, the version and why' : 'raise it as a finding';
    lines.push(`- no dependency commands (${guards.dependencyCommands.join(', ')}): ${what}.`);
  }
  const commands = [...new Set([...ws.config.guards.commands, ...guards.commands])];
  if (commands.length) lines.push(`- blocked commands: ${commands.join(', ')}.`);
  const ports = [...new Set([...ws.config.guards.ports, ...guards.ports])];
  if (ports.length) lines.push(`- ports ${ports.join(', ')} belong to the developer's environment: use the test setup (supertest, port 0).`);
  if (ws.config.guards.devServer === 'never') {
    lines.push('- no dev servers: verify with the tests and the typecheck; list browser-only checks as open points with tag manual.');
  }
  return lines;
}

// The additionalContext text for the agent of task (as recorded by SubagentStart); cwd is the
// agent's Bash cwd (the hook input's cwd, canonical).
export function agentContext({ ws, task, role, guards, cwd }) {
  const finish = role === 'implementer' ? `cw report save --task ${task.id}` : `cw review save --task ${task.id}`;
  const review = role === 'reviewer' ? ` · review round ${task.reviewRound}/${ws.config.workflow.maxReviewRounds}` : '';
  const head = [
    `dev-workflow · you are the ${role} of task ${task.id} (${task.ticket} · ${task.title}) · round ${task.round}${review}.`,
    `Your brief file is named in your prompt: read it completely first. Your preloaded playbook (dev-workflow:${role}-playbook) is the procedure: follow it step by step. Pass --task ${task.id} to every cw command.`,
    ...workLines({ ws, task, role, cwd }),
  ];
  const tail = [
    'Guards (a hook denies these, naming the reason and the alternative):',
    ...guardLines({ ws, role, guards }),
    `Finish: pipe your JSON to \`${finish}\` and end with exactly the JSON fence it prints. A stop check holds you until this round's file is saved and valid.`,
  ];
  const render = (short) => [...head, 'Packages and checks (cw checks --changed runs them in the work tree):', ...packageLines(ws, task, { short }), ...tail].join('\n');
  let text = render(false);
  if (text.length > CONTEXT_MAX) text = render(true);
  return text.length > CONTEXT_MAX ? `${text.slice(0, CONTEXT_MAX - 1)}…` : text;
}
