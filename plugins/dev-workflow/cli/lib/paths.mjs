// Plugin-internal locations, found from this file (D10: CLAUDE_PLUGIN_ROOT does not reach Bash commands).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const schemasDir = join(pluginRoot, 'schemas');
export const packsDir = join(pluginRoot, 'packs');
export const presetsDir = join(pluginRoot, 'presets', 'git');
export const skillsDir = join(pluginRoot, 'skills');
export const templatesDir = join(pluginRoot, 'templates');

let version;
export function pluginVersion() {
  if (version === undefined) {
    try {
      version = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? '0.0.0';
    } catch {
      version = '0.0.0';
    }
  }
  return version;
}
