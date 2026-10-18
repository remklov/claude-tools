// SubagentStart: give every dev-workflow agent the project context of its role (≤ 6,000 characters).
import { packGuards, resolvePacks } from '../scripts/lib/packs.mjs';
import { pluginVersion } from '../scripts/lib/paths.mjs';
import { proceduresFor } from '../scripts/lib/playbook.mjs';
import { loadProfile } from '../scripts/lib/profile.mjs';
import { roleOf, runHook } from './hook-lib.mjs';

const LIMIT = 6000;

function describeWhen(when) {
  const parts = [];
  if (when.paths.length) parts.push(when.paths.join(', '));
  if (when.areas.length) parts.push(`areas ${when.areas.join(', ')}`);
  if (when.keywords.length) parts.push(`keywords ${when.keywords.slice(0, 6).join(', ')}`);
  if (when.phases.length) parts.push(`phase ${when.phases.join(', ')}`);
  return parts.join('; ') || 'always';
}

await runHook('subagent-start', ({ input, ctx }) => {
  const role = roleOf(input.agent_type);
  if (!role) return null;
  const profile = loadProfile(ctx);
  const packs = resolvePacks(ctx, profile, { quiet: true });
  const guards = packGuards(packs);
  const procedures = proceduresFor(ctx, packs, role);
  const lines = [
    `dev-workflow context (profile ${ctx.profilePath}, plugin ${pluginVersion()})`,
    `Role: ${role}. Task files (brief, spec, reports) live in ${ctx.stateDir}/tasks/<task id>/; your prompt names your brief.`,
  ];
  if (role !== 'investigator') {
    lines.push(`Packages: ${profile.packages.map((pkg) => `${pkg.id} → ${pkg.paths.join(',')} (${pkg.areas.join(', ')}${Object.keys(pkg.checks).length ? `; checks ${Object.keys(pkg.checks).map((name) => name + (pkg.exclusive.includes(name) ? ' [exclusive]' : '')).join(', ')}` : ''})`).join(' · ')}`);
  }
  const guardParts = [];
  if (profile.guards.ports.length || guards.ports.length) guardParts.push(`ports ${[...new Set([...profile.guards.ports, ...guards.ports])].join(', ')}`);
  const commands = [...new Set([...profile.guards.commands, ...guards.commands])];
  if (commands.length) guardParts.push(`commands ${commands.join(', ')}`);
  if (guards.dependencyCommands.length) guardParts.push('no dependency installs');
  if (profile.guards.devServer === 'never') guardParts.push('no dev servers');
  if (profile.isolation.mode === 'worktree') guardParts.push(`never touch the main checkout ${profile.isolation.protectedCheckout}`);
  lines.push(`Guards (enforced by a hook): ${guardParts.join('; ') || 'none'}.`);
  if (profile.domain.neverGuess.length) lines.push(`Never guess on: ${profile.domain.neverGuess.join('; ')}.`);
  lines.push('Scripts: `cw help` lists every command; pack scripts run with `cw run <pack>:<script>`. Git only as plain `git …` in your working directory or through `cw`.');
  const header = lines.join('\n');
  const procedureLines = procedures.map((p) => `- ${p.name} (${p.origin}; when ${describeWhen(p.when)}): ${p.description} — ${p.path}`);
  let text = `${header}\nProcedures for this role (read one when its trigger applies):\n${procedureLines.join('\n') || '- none'}`;
  if (text.length > LIMIT) {
    text = `${header}\nProcedures for this role:\n${procedures.map((p) => `- ${p.name}: ${p.path}`).join('\n')}`;
  }
  return { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: text.slice(0, LIMIT) } };
});
