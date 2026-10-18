// Prints the URL of an open PR for the given branch, or nothing. Usage: cw run git-github:pr-exists <branch>
import { spawnSync } from 'node:child_process';
const branch = process.argv[2];
if (!branch) {
  console.error('usage: pr-exists <branch>');
  process.exit(2);
}
const result = spawnSync('gh', ['pr', 'view', branch, '--json', 'url,state'], { encoding: 'utf8' });
if (result.status !== 0) process.exit(0);
const pr = JSON.parse(result.stdout);
if (pr.state === 'OPEN') console.log(pr.url);
