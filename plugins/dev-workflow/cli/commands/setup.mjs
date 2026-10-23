// Setup commands: cw init (detect, ask, write; §8, §12) and cw doctor (§9 SessionStart checks, D11).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hookOutput, runDoctor } from '../lib/doctor.mjs';
import {
  assertOutsideClaudeCode, askQuestions, createPrompter, detectProject, openNotes, pendingQuestions, proposeConfig, writeProject,
} from '../lib/init.mjs';
import { EXIT, preconditionError, usageError } from '../lib/out.mjs';
import { CONFIG_RELATIVE, NO_CONFIG_FIX } from '../lib/workspace.mjs';
import { emit, readConfigInput } from './common.mjs';

const MODES = ['detect', 'interactive', 'write'];

function printDetection(ctx, value) {
  ctx.out.print(`Project root: ${value.projectRoot} (${value.mode}${value.appRoot ? `, app repo ${value.appRoot}/` : ''})`);
  if (value.host.kind !== 'none') ctx.out.print(`Host: ${value.host.kind} (${value.host.hostname}/${value.host.repo})`);
  for (const warning of value.warnings) ctx.out.print(`Note: ${warning}`);
  ctx.out.print('\nProposed .claude/dev-workflow/config.json:');
  ctx.out.print(JSON.stringify(value.config, null, 2));
  ctx.out.print('\nOpen questions (cw init --interactive asks them in your terminal):');
  for (const question of value.questions) ctx.out.print(`  ${question.text} [${question.default}]`);
}

function printWrite(ctx, value) {
  ctx.out.print(value.changed.length ? `Wrote ${value.changed.join(', ')}.` : 'No file changed.');
  for (const conflict of value.conflicts) ctx.out.print(`Kept your setting ${conflict}.`);
  for (const warning of value.warnings) ctx.out.print(`Warning: ${warning}`);
  ctx.out.print(`Files to commit: ${value.files.join(', ')}.`);
  for (const step of value.next) ctx.out.print(`Next: ${step}`);
}

function readGivenConfig(ctx) {
  const path = resolve(ctx.cwd, ctx.flags.write);
  if (!existsSync(path)) throw usageError(`${path} does not exist.`, 'Pass the path of a config file, e.g. the "config" of cw init --detect --json saved to a file.');
  return readConfigInput(path);
}

const initCommand = {
  path: ['init'],
  group: 'setup',
  usage: 'cw init --detect [--json] | --interactive [--yes] [--force] | --write <config.json> [--force]',
  summary: 'Detect the project and propose a config, or write it with the compiled rules, settings, CLAUDE.md section and bootstrap script',
  flags: { detect: 'boolean', interactive: 'boolean', write: 'string', yes: 'boolean', force: 'boolean' },
  async run(ctx) {
    const modes = MODES.filter((mode) => ctx.flags[mode] !== undefined);
    if (modes.length !== 1) {
      throw usageError('Pass exactly one of --detect, --interactive and --write <file>.', 'cw init --detect shows the proposal; cw init --interactive asks and writes; cw init --write <config.json> writes a prepared config.');
    }
    if (ctx.flags.detect) {
      const detection = detectProject(ctx.cwd);
      const config = proposeConfig(detection);
      const value = { ...detection, config, questions: pendingQuestions(config, detection) };
      emit(ctx, value, () => printDetection(ctx, value));
      return EXIT.ok;
    }
    assertOutsideClaudeCode(ctx.env, `cw init --${modes[0]}`);
    let detection = detectProject(ctx.cwd);
    let config;
    if (ctx.flags.write) {
      config = readGivenConfig(ctx);
    } else {
      const prompter = ctx.flags.yes ? null : createPrompter({ input: process.stdin, output: process.stderr });
      try {
        if (prompter && detection.appRootCandidates.length > 1) {
          const appRoot = await prompter.ask(`Application repository (${detection.appRootCandidates.join(', ')}, or . for none)`, detection.appRoot);
          detection = detectProject(ctx.cwd, { appRoot });
        }
        // Every detection note (packages to add by hand, a default variant, no checks) goes to stderr
        // before the questions, so the answers can take it into account.
        for (const warning of detection.warnings) ctx.out.warn(warning);
        config = await askQuestions(proposeConfig(detection), detection, { prompter, yes: Boolean(ctx.flags.yes) });
      } finally {
        prompter?.close();
      }
    }
    const result = writeProject({ projectRoot: detection.projectRoot, config, detection, force: Boolean(ctx.flags.force) });
    // The result lists only the notes the written config leaves open (no checks, the guessed base branch).
    const notes = openNotes(detection, config);
    if (ctx.flags.write) for (const note of notes) ctx.out.warn(note);
    const value = { ...result, warnings: [...notes, ...result.warnings], next: [`Open Claude Code in ${result.projectRoot}, trust the folder, and run /dev-workflow:ticket <KEY>.`] };
    emit(ctx, value, () => printWrite(ctx, { ...value, warnings: result.warnings }));
    return EXIT.ok;
  },
};

const mark = (result) => (result.ok ? 'ok   ' : result.level === 'error' ? 'ERROR' : 'warn ');

const doctorCommand = {
  path: ['doctor'],
  group: 'setup',
  usage: 'cw doctor [--hook] [--quick] [--fresh] [--json]',
  summary: 'Check the setup without network: Node, git, claude, config, work repo, packs, rules drift, host CLI, Jira plugin, sandbox',
  flags: { hook: 'boolean', quick: 'boolean', fresh: 'boolean' },
  run(ctx) {
    const options = { cwd: ctx.cwd, env: ctx.env, quick: Boolean(ctx.flags.quick), fresh: Boolean(ctx.flags.fresh) };
    if (ctx.flags.hook) {
      // SessionStart: silent when all is well or without a config; never fails the session (D11).
      try {
        const report = runDoctor(options);
        const output = hookOutput(report.results, { cached: report.cached });
        if (output) ctx.out.data(output);
      } catch (error) {
        ctx.out.warn(`doctor --hook failed: ${error.message}`);
      }
      return EXIT.ok;
    }
    const report = runDoctor(options);
    if (!report.configRoot) {
      throw preconditionError(`No ${CONFIG_RELATIVE} in ${ctx.cwd} or any parent directory.`, NO_CONFIG_FIX);
    }
    emit(ctx, report, (value) => {
      for (const result of value.results) {
        ctx.out.print(`${mark(result)}  ${result.message}${result.ok ? '' : ` Fix: ${result.fix}`}`);
      }
      if (value.cached) ctx.out.print('(cached result; cw doctor --fresh checks again)');
    });
    return report.results.some((result) => !result.ok && result.level === 'error') ? EXIT.failed : EXIT.ok;
  },
};

export const commands = [initCommand, doctorCommand];
