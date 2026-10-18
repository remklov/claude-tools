import { input, log } from './log.mjs';
log('SubagentStart');
const filler = 'x'.repeat(12000);
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: `SPIKE-CTX-MARKER-4417 ${filler} END-OF-CONTEXT-TAIL` } }));
