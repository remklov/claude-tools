// Locations inside the plugin, resolved from this file.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const libDir = dirname(fileURLToPath(import.meta.url));
export const pluginRoot = join(libDir, '..', '..');
export const schemasDir = join(pluginRoot, 'schemas');
export const packsDir = join(pluginRoot, 'packs');
export const templatesDir = join(pluginRoot, 'templates');
export const skillsDir = join(pluginRoot, 'skills');

let manifest;
export function pluginVersion() {
  if (!manifest) {
    try {
      manifest = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
    } catch {
      manifest = { version: '0.0.0' };
    }
  }
  return manifest.version;
}
