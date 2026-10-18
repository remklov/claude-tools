import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { input, log, countFile } from './log.mjs';
log('SubagentStop');
const n = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) : 0;
if (!String(input.last_assistant_message ?? '').includes('VALID') && n < 1) {
  writeFileSync(countFile, String(n + 1));
  console.log(JSON.stringify({ decision: 'block', reason: 'Answer with the single word VALID.' }));
}
