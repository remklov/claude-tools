// Setup and inspection: init, doctor, profile, playbook, rules.
import { readFileSync } from 'node:fs';
import { requireContext } from '../lib/ctx.mjs';
import { doctorCached, invalidateDoctorCache } from '../lib/doctor.mjs';
import { detect, registerMergeDriver, settingsFragment, updateGitignore, writeProfile, writeSettings, writeSnippet } from '../lib/init.mjs';
import { color, CwError, EXIT, print, printJson, table } from '../lib/out.mjs';
import { resolvePacks } from '../lib/packs.mjs';
import { playbookSkill, procedureApplies, proceduresFor } from '../lib/playbook.mjs';
import { loadProfile, readProfileFile, validateProfile, withDefaults } from '../lib/profile.mjs';
import { applicableRules, diffRulebook, findRules, writeRulebook } from '../lib/rules.mjs';
import { changedFiles } from '../lib/git.mjs';
import { formatErrors } from '../lib/schema.mjs';
import { parseSpec } from '../lib/spec.mjs';
import { taskPath } from '../lib/task.mjs';
import { emit, load, loadWithTask, need, profileText, rulebook } from './common.mjs';

export async function init(flags) {
  const ctx = requireContext(flags.cwd ?? process.cwd());
  if (flags['merge-driver']) {
    const profile = loadProfile({ ...ctx, profilePath: ctx.profilePath });
    print(registerMergeDriver(ctx, profile) ? 'merge driver registered' : 'no markdown-table backlog; nothing to register');
    invalidateDoctorCache(ctx);
    return;
  }
  if (flags.detect || !flags.write) {
    const result = detect(ctx);
    if (flags.json) printJson(result);
    else {
      print(JSON.stringify(result.profile, null, 2));
      print('\nOpen questions:');
      for (const question of result.questions) print(`- ${question}`);
      print('\nSave the profile to a file, adjust it, then run: cw init --write --profile <file>');
    }
    return;
  }
  const source = need(flags, 'profile', 'the profile file to install');
  const raw = readProfileFile(source);
  const errors = validateProfile(raw);
  if (errors.length) throw new CwError(`Profile invalid:\n${formatErrors(errors)}`);
  writeProfile(ctx, raw, { overwrite: Boolean(flags.yes) });
  const fresh = requireContext(ctx.cwd);
  const profile = withDefaults(raw, fresh);
  const packs = resolvePacks(fresh, profile);
  const settings = writeSettings(fresh, settingsFragment(fresh, profile, packs));
  print(`wrote ${fresh.profilePath}`);
  print(`merged ${settings.path}${settings.conflicts.length ? ` (kept existing values: ${settings.conflicts.join('; ')})` : ''}`);
  if (updateGitignore(fresh)) print('added !.claude/workflow/ to .gitignore');
  if (registerMergeDriver(fresh, profile)) print(`registered the backlog merge driver for ${profile.tickets.file}`);
  print(`updated ${writeSnippet(fresh)}`);
  const lock = writeRulebook(fresh, rulebook({ ctx: fresh, profile, packs }), readFileSync(fresh.profilePath, 'utf8'));
  print(`compiled ${lock.rules.length} rules into .claude/rules/workflow/`);
  invalidateDoctorCache(fresh);
  print('\nStart an orchestrator session with: claude --agent dev-workflow:orchestrator');
  print('Then say "starte mit Ticket <ID>" or "nimm das nächste Ticket".');
}

export async function doctor(flags) {
  const ctx = requireContext(flags.cwd ?? process.cwd());
  if (!ctx.hasProfile) {
    if (flags.hook) return;
    print('No workflow profile here. Run /dev-workflow:setup.');
    return EXIT.precondition;
  }
  const { results } = doctorCached(ctx, { fresh: Boolean(flags.fresh) });
  if (flags.json) {
    printJson(results);
  } else {
    for (const r of results) print(`${r.ok ? color.green('ok  ') : r.level === 'error' ? color.red('ERR ') : color.yellow('WARN')} ${r.message}`);
  }
  return results.some((r) => !r.ok && r.level === 'error') ? EXIT.failed : EXIT.ok;
}

export async function profile(flags, [sub]) {
  if (sub === 'validate') {
    const ctx = requireContext(flags.cwd ?? process.cwd());
    const errors = validateProfile(readProfileFile(flags.file ?? ctx.profilePath));
    emit(flags, { valid: errors.length === 0, errors }, () => print(errors.length ? formatErrors(errors) : 'profile valid'));
    return errors.length ? EXIT.failed : EXIT.ok;
  }
  const { profile: p } = load(flags);
  printJson(p);
}

export async function playbook(flags, [sub, role]) {
  if (sub !== 'show' || !role) throw new CwError('usage: cw playbook show <orchestrator|implementer|reviewer|investigator> [--task <id>]', { code: EXIT.usage });
  const base = flags.task ? loadWithTask(flags) : load(flags);
  const { ctx, profile: p, packs, task } = base;
  const skill = playbookSkill(role);
  let applies = null;
  if (task) {
    const spec = parseSpec(readFileSync(taskPath(ctx, task, 'spec.md'), 'utf8'));
    applies = { paths: spec.paths, areas: task.areas, text: `${spec.title}\n${spec.body('Requirements')}` };
  }
  const procedures = proceduresFor(ctx, packs, role).map((procedure) => ({
    name: procedure.name, origin: procedure.origin, description: procedure.description, when: procedure.when, path: procedure.path,
    ...(applies ? { applies: procedureApplies(procedure, applies) } : {}),
  }));
  const result = {
    role, skill: skill.skill, steps: skill.steps, procedures,
    packages: p.packages.map((pkg) => ({ id: pkg.id, paths: pkg.paths, areas: pkg.areas, checks: pkg.checks })),
    guards: p.guards,
  };
  emit(flags, result, () => {
    print(`${color.bold(`Playbook ${role}`)} — skill ${skill.skill} (${skill.steps.length} step files)`);
    for (const step of skill.steps) print(`  ${step}`);
    print(`\n${color.bold('Procedures')}`);
    for (const procedure of procedures) {
      const flag = procedure.applies === undefined ? '' : procedure.applies ? color.green(' [applies]') : color.dim(' [not triggered]');
      print(`- ${procedure.name} (${procedure.origin})${flag}: ${procedure.description}\n  ${color.dim(procedure.path)}`);
    }
    print(`\n${color.bold('Packages')}\n${table(result.packages.map((pkg) => ({ id: pkg.id, paths: pkg.paths.join(','), areas: pkg.areas.join(','), checks: Object.keys(pkg.checks).join(',') })), ['id', 'paths', 'areas', 'checks'])}`);
  });
}

export async function rules(flags, [sub, arg]) {
  const base = flags.task && sub === 'applicable' ? loadWithTask(flags) : load(flags);
  const { ctx } = base;
  const book = rulebook(base);
  switch (sub) {
    case 'build': {
      if (flags.check) {
        const diff = diffRulebook(ctx, book, profileText(ctx));
        emit(flags, diff, () => print(diff.isCurrent ? 'rulebook up to date' : `rulebook out of date:\n- ${diff.problems.join('\n- ')}\nRun: cw rules build`));
        return diff.isCurrent ? EXIT.ok : EXIT.failed;
      }
      const lock = writeRulebook(ctx, book, profileText(ctx));
      invalidateDoctorCache(ctx);
      for (const item of book.disabled) print(color.yellow(`disabled ${item.id}: ${item.reason}`));
      if (book.inactive.length) print(color.dim(`inactive (no package with that area): ${book.inactive.join(', ')}`));
      print(`compiled ${lock.rules.length} rules into ${book.outputs.length} files in .claude/rules/workflow/`);
      return;
    }
    case 'check': {
      const diff = diffRulebook(ctx, book, profileText(ctx));
      emit(flags, diff, () => print(diff.isCurrent ? 'rulebook up to date' : `rulebook out of date:\n- ${diff.problems.join('\n- ')}`));
      return diff.isCurrent ? EXIT.ok : EXIT.failed;
    }
    case 'list':
      return emit(flags, book.rules.map(({ id, title, source, scope, severity, protected: isProtected, modified, aliases }) => ({ id, title, source, scope, severity, protected: isProtected, modified: modified ?? null, aliases })),
        (list) => print(table(list.map((rule) => ({ id: rule.id, severity: rule.severity + (rule.protected ? ' 🔒' : ''), scope: rule.scope, source: rule.source, title: rule.title })), ['id', 'severity', 'scope', 'source', 'title'])));
    case 'show': {
      const found = findRules(book, need({ arg }, 'arg', 'rule ID or alias'));
      if (!found.length) throw new CwError(`No rule ${arg}`);
      return emit(flags, found, () => found.forEach((rule) => print(`## ${rule.id} — ${rule.title} · ${rule.severity}${rule.protected ? ' · protected' : ''}\n${color.dim(`scope ${rule.scope} · source ${rule.source}${rule.aliases.length ? ` · aliases ${rule.aliases.join(', ')}` : ''}`)}\n\n${rule.body}\n`)));
    }
    case 'applicable': {
      const commit = base.task?.base?.commit ?? flags.base;
      if (!commit) throw new CwError('cw rules applicable needs --task <id> or --base <sha>', { code: EXIT.usage });
      const files = changedFiles(ctx.repoRoot, commit);
      const list = applicableRules(book, files);
      return emit(flags, { files, rules: list.map(({ id, title, severity, protected: isProtected, scope, body }) => ({ id, title, severity, protected: isProtected, scope, body })) },
        (value) => {
          print(`${value.rules.length} rules apply to ${files.length} changed files:`);
          for (const rule of value.rules) print(`- ${rule.id} — ${rule.title} (${rule.severity}${rule.protected ? ', protected' : ''})`);
        });
    }
    default:
      throw new CwError('usage: cw rules <build [--check]|check|list|show <ID>|applicable --task <id>>', { code: EXIT.usage });
  }
}
