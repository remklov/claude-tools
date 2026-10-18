// Doctor check: gh is installed and logged in to github.com.
import { spawnSync } from 'node:child_process';
const result = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], { encoding: 'utf8' });
if (result.error || result.status !== 0) {
  console.log('gh is missing or not logged in: run `gh auth login` and `gh auth setup-git` in your own terminal');
  process.exit(1);
}
console.log('gh logged in to github.com');
