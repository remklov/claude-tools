// Inspection commands: version, config show, config validate.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatConfigErrors, validateConfig, withDefaults } from '../lib/config.mjs';
import { MASK_MIN_LENGTH, failedError, preconditionError } from '../lib/out.mjs';
import { pluginVersion } from '../lib/paths.mjs';
import { CONFIG_RELATIVE, findConfigRoot } from '../lib/workspace.mjs';
import { emit, readConfigInput } from './common.mjs';

// Every packages[].env value as *** (§5: masked in all output). Replaced as a whole: masking text finds a
// value only verbatim, JSON escapes " and \, and short values are not masked in text.
const maskEnv = (packages) => packages.map((pkg) => ({ ...pkg, env: Object.fromEntries(Object.keys(pkg.env).map((key) => [key, '***'])) }));

// The env values that the masking of check logs and messages skips.
const shortEnvValues = (raw) => raw.packages.flatMap((pkg, i) => Object.entries(pkg.env ?? {})
  .filter(([, value]) => value.length < MASK_MIN_LENGTH)
  .map(([key]) => `$.packages[${i}].env.${key} is shorter than ${MASK_MIN_LENGTH} characters, so cw does not mask it in check logs and messages; use a longer value if it is a secret.`));

export const commands = [
  {
    path: ['version'],
    group: 'setup',
    usage: 'cw version',
    summary: 'Print the dev-workflow plugin version',
    flags: {},
    run(ctx) {
      emit(ctx, { name: 'dev-workflow', version: pluginVersion() }, (value) => ctx.out.print(`${value.name} ${value.version}`));
    },
  },
  {
    path: ['config', 'show'],
    group: 'setup',
    usage: 'cw config show [--json]',
    summary: 'Print the effective config with every default (secret values masked)',
    flags: {},
    run(ctx) {
      const ws = ctx.workspace();
      const effective = { ...ws.config, packages: maskEnv(ws.config.packages), git: { ...ws.config.git, conventions: ws.config.git.conventions.id } };
      emit(ctx, { configPath: ws.configPath, mode: ws.mode, workRepo: ws.workRepo, stateDir: ws.stateDir, config: effective }, (value) =>
        ctx.out.print(JSON.stringify(value, null, 2)),
      );
    },
  },
  {
    path: ['config', 'validate'],
    group: 'setup',
    usage: 'cw config validate [--file <path>]',
    summary: 'Validate a config file; every error names the field and the problem',
    flags: { file: 'string' },
    run(ctx) {
      let path = ctx.flags.file ? resolve(ctx.cwd, ctx.flags.file) : null;
      if (!path) {
        const root = findConfigRoot(ctx.cwd);
        if (!root) throw preconditionError(`No ${CONFIG_RELATIVE} in ${ctx.cwd} or any parent directory.`, 'Pass --file <path>, or run setup.sh in the project root.');
        path = resolve(root, CONFIG_RELATIVE);
      }
      if (!existsSync(path)) throw preconditionError(`${path} does not exist.`, 'Pass the path of a config file with --file.');
      const raw = readConfigInput(path);
      const errors = validateConfig(raw);
      if (errors.length) {
        throw failedError(`${path} is invalid:\n${formatConfigErrors(errors)}`, 'Correct these fields, then run cw config validate again.', { errors });
      }
      withDefaults(raw);
      const warnings = shortEnvValues(raw);
      for (const warning of warnings) ctx.out.warn(warning);
      emit(ctx, { ok: true, path, warnings }, () => ctx.out.print(`${path}: valid`));
    },
  },
];
