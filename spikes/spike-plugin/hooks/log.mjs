import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.out');
mkdirSync(out, { recursive: true });
export const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
export const log = (tag) => appendFileSync(join(out, 'hooks.log'), `${tag} ${JSON.stringify(input)}\n`);
export const countFile = join(out, 'stop-count');
