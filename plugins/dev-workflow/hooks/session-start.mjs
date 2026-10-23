// SessionStart (startup|resume, §9): the quick setup check, without network. Silent without a project
// config and when every check passes; otherwise a one-line systemMessage plus the facts with their
// fixes in additionalContext (cw doctor's hook output).
import { hookOutput, runDoctor } from '../cli/lib/doctor.mjs';
import { runHook } from './lib/run.mjs';

await runHook('session-start', ({ place }) => {
  const report = runDoctor({ cwd: place.cwd, env: process.env, quick: true });
  return hookOutput(report.results, { cached: report.cached });
}, { workspace: false });
