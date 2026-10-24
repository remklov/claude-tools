// cw playbook show <role> [--task <id>] (§6): a role's fixed set in one view: the role skill, the cw
// commands of the role, the procedures of the active packs and the project (selected for the task with
// --task), the pack scripts, the output contract and the guards. cw playbook read <file>: one step or
// reference file of the ticket skill.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { taskChangedFiles } from '../lib/cycle.mjs';
import { readText } from '../lib/fsx.mjs';
import { usageError } from '../lib/out.mjs';
import { loadProcedures, packGuards, resolvePacks, scopeScripts, selectProcedures } from '../lib/packs.mjs';
import { skillsDir } from '../lib/paths.mjs';
import { keywordText, parseSpec } from '../lib/spec.mjs';
import { readTask } from '../lib/task.mjs';
import { taskPath } from '../lib/workspace.mjs';
import { emit } from './common.mjs';

// commands: the cw commands that the role's §6 steps name, in step order (a role uses commands of
// other help groups too, e.g. the reviewer's cw commit lint in R7), then the other commands of the role's
// §8 table row, in its order (e.g. the implementer's cw step, which moves the band's step n/8).
export const ROLES = {
  orchestrator: {
    skill: 'ticket',
    contract: null,
    commands: [
      'doctor', 'task list', 'task new', 'ticket context', 'ticket save', 'spec save', 'spec lint', 'classify', 'task confirm', 'task start', 'task agent', 'report show',
      'task reset', 'git foreign-commits', 'task review', 'review show', 'task return', 'pr body', 'pr command', 'pr record', 'task cleanup', 'task end',
      'spec show', 'pr title', 'task show', 'playbook read',
    ],
  },
  implementer: {
    skill: 'implementer-playbook',
    contract: { command: 'cw report save', schema: 'schemas/dev-report.schema.json' },
    commands: ['ws setup', 'context', 'rules applicable', 'checks', 'commit msg', 'commit lint', 'prove', 'report save', 'step', 'run'],
  },
  reviewer: {
    skill: 'reviewer-playbook',
    contract: { command: 'cw review save', schema: 'schemas/review.schema.json' },
    commands: ['review scope', 'checks', 'prove', 'rules applicable', 'commit lint', 'review save'],
  },
};

async function show(ctx) {
  const [role, extra] = ctx.args;
  if (!ROLES[role]) throw usageError(`cw playbook show needs a role${role ? `, not "${role}"` : ''}`, `Pass one of ${Object.keys(ROLES).join(', ')}.`);
  if (extra) throw usageError(`unexpected argument ${extra}`, 'Pass one role.');
  const ws = ctx.workspace();
  const task = ctx.flags.task ? readTask(ws, ctx.flags.task) : null;
  const packs = resolvePacks(ws, { onWarning: (text) => ctx.out.warn(text) });
  const all = loadProcedures(ws, packs, { onWarning: (text) => ctx.out.warn(text) }).filter((procedure) => procedure.role === role);
  let procedures = all;
  if (task) {
    const files = [...new Set([...(task.paths ?? []), ...taskChangedFiles(ws, task)])];
    const text = keywordText(parseSpec(readText(taskPath(ws, task.id, 'spec.md'), '')));
    procedures = selectProcedures(all, { role, paths: files, areas: task.areas, text, phase: task.phase });
  }
  // The registry is read at run time; cw.mjs is loaded by then.
  const { registry } = await import('../cw.mjs');
  const byPath = new Map(registry.map((command) => [command.path.join(' '), command]));
  const skill = join(skillsDir, ROLES[role].skill, 'SKILL.md');
  const value = {
    role,
    task: task?.id ?? null,
    skill: { name: `dev-workflow:${ROLES[role].skill}`, path: skill, present: existsSync(skill) },
    commands: ROLES[role].commands.map((path) => byPath.get(path)).map((command) => ({ usage: command.usage, summary: command.summary })),
    procedures: procedures.map((procedure) => ({ name: procedure.name, origin: procedure.origin, description: procedure.description, when: procedure.when, scripts: procedure.scripts, rules: procedure.rules })),
    scripts: packs.flatMap((pack) => Object.keys(pack.manifest.scripts ?? {}).map((name) => `cw run ${pack.id}:${name}`)),
    scopeScripts: role === 'reviewer' ? scopeScripts(packs) : [],
    contract: ROLES[role].contract,
    guards: { ...packGuards(packs), config: ws.config.guards },
  };
  emit(ctx, value, () => {
    const { out } = ctx;
    out.print(`Playbook: ${role}${value.task ? ` · task ${value.task}` : ''}`);
    out.print(`Skill: ${value.skill.name} (${value.skill.present ? value.skill.path : 'not installed in this plugin version'})`);
    out.print('Commands:');
    for (const command of value.commands) out.print(`  ${command.usage}\n      ${command.summary}`);
    out.print(`Procedures${value.task ? ' selected for the task' : ''}:${value.procedures.length ? '' : ' none'}`);
    for (const procedure of value.procedures) out.print(`  ${procedure.name} (${procedure.origin}): ${procedure.description}`);
    if (value.scripts.length) out.print(`Pack scripts: ${value.scripts.join(', ')}`);
    if (value.scopeScripts.length) out.print(`Scope scripts (cw review scope runs them): ${value.scopeScripts.join(', ')}`);
    if (value.contract) out.print(`Output: ${value.contract.command}, validated against ${value.contract.schema}`);
    if (value.guards.dependencyCommands.length) out.print(`Guarded dependency commands: ${value.guards.dependencyCommands.join(', ')}`);
  });
}

// The orchestrator reads its step and reference files through Bash(cw *): the Read tool asks before a
// file outside the working directory (code.claude.com/docs/en/permissions), and the plugin is outside.
function read(ctx) {
  const [file, extra] = ctx.args;
  const dir = join(skillsDir, ROLES.orchestrator.skill);
  const files = ['steps', 'reference'].flatMap((sub) => readdirSync(join(dir, sub)).filter((name) => name.endsWith('.md')).sort().map((name) => `${sub}/${name}`));
  if (extra) throw usageError(`unexpected argument ${extra}`, 'Pass one file.');
  if (!files.includes(file)) {
    throw usageError(file ? `the ticket skill has no file ${file}` : 'cw playbook read needs a file', `Pass one of ${files.join(', ')}.`);
  }
  const text = readText(join(dir, file));
  emit(ctx, { file, text }, () => ctx.out.print(text.trimEnd()));
}

export const commands = [
  {
    path: ['playbook', 'show'],
    group: 'setup',
    usage: 'cw playbook show orchestrator|implementer|reviewer [--task <id>] [--json]',
    summary: "A role's playbook: skill, commands, procedures (selected for the task), scripts, output contract, guards",
    flags: { task: 'string' },
    run: show,
  },
  {
    path: ['playbook', 'read'],
    group: 'orchestrator',
    usage: 'cw playbook read steps/<file>.md|reference/<file>.md',
    summary: 'One step or reference file of the ticket skill, printed for the orchestrator (O1–O10)',
    flags: {},
    run: read,
  },
];
