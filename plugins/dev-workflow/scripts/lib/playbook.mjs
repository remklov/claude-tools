// Resolves the procedures that extend a role's playbook (packs first, project last) and their triggers.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchAny } from './glob.mjs';
import { CwError, warn } from './out.mjs';
import { skillsDir } from './paths.mjs';
import { withPackOptions } from './packs.mjs';
import { parseYaml } from './yaml-lite.mjs';

export const ROLES = ['orchestrator', 'implementer', 'reviewer', 'investigator'];

export function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  return { data: parseYaml(match[1]) ?? {}, body: text.slice(match[0].length) };
}

function readProcedure(path, role, origin, pack) {
  const raw = readFileSync(path, 'utf8');
  const text = pack ? withPackOptions(raw, pack) : raw;
  const { data } = parseFrontmatter(text);
  if (!data.name || !data.description) throw new CwError(`${path}: procedures need name and description`);
  if (data.role !== role) throw new CwError(`${path}: role is ${data.role}, expected ${role}`);
  const when = data.when ?? {};
  return {
    name: data.name,
    role,
    description: data.description,
    origin,
    path,
    when: {
      paths: [].concat(when.paths ?? []),
      areas: [].concat(when.areas ?? []),
      keywords: [].concat(when.keywords ?? []),
      phases: [].concat(when.phases ?? []),
    },
    scripts: [].concat(data.scripts ?? []),
    rules: [].concat(data.rules ?? []),
  };
}

export function proceduresFor(ctx, packs, role) {
  if (!ROLES.includes(role)) throw new CwError(`Unknown role ${role} (${ROLES.join(', ')})`);
  const byName = new Map();
  for (const pack of packs) {
    for (const file of pack.manifest.playbooks?.[role] ?? []) {
      const procedure = readProcedure(join(pack.root, file), role, pack.id, pack);
      byName.set(procedure.name, procedure);
    }
  }
  const projectDir = join(ctx.workflowDir, 'playbooks', role);
  if (existsSync(projectDir)) {
    for (const file of readdirSync(projectDir).filter((name) => name.endsWith('.md')).sort()) {
      const procedure = readProcedure(join(projectDir, file), role, 'project', null);
      if (byName.has(procedure.name)) warn(`project procedure ${procedure.name} shadows the one from ${byName.get(procedure.name).origin}`);
      byName.set(procedure.name, procedure);
    }
  }
  return [...byName.values()];
}

const wordRegex = (word) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
export const containsWord = (text, word) => wordRegex(word).test(text);

// A procedure applies when any of its triggers hits; an empty `when` always applies.
export function procedureApplies(procedure, { paths = [], areas = [], text = '', phase } = {}) {
  const { when } = procedure;
  const isEmpty = !when.paths.length && !when.areas.length && !when.keywords.length && !when.phases.length;
  if (isEmpty) return true;
  if (when.phases.length && phase && when.phases.includes(phase)) return true;
  if (when.paths.length && paths.some((path) => matchAny(path, when.paths))) return true;
  if (when.areas.length && areas.some((area) => when.areas.includes(area))) return true;
  if (when.keywords.length && when.keywords.some((word) => containsWord(text, word))) return true;
  return false;
}

export function playbookSkill(role) {
  const dir = join(skillsDir, `${role}-playbook`);
  const steps = existsSync(join(dir, 'steps')) ? readdirSync(join(dir, 'steps')).filter((f) => f.endsWith('.md')).sort() : [];
  return { skill: `dev-workflow:${role}-playbook`, dir, steps };
}
