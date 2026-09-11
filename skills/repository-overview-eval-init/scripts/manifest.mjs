#!/usr/bin/env node
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/repository-overview');
const files = {};
function walk(dir, prefix = '') {
  for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix + entry.name;
    if (['upstream.json', '.eval-artifacts', 'reports', 'scenarios/repository'].includes(path)) continue;
    if (entry.isDirectory()) walk(resolve(dir, entry.name), `${path}/`);
    else if (entry.isFile()) files[path] = createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
    else throw new Error(`Unexpected bundle symlink: ${path}`);
  }
}
walk(root);
const version = JSON.parse(readFileSync(resolve(root, '../../../../package.json'), 'utf8')).version;
const content = `${JSON.stringify({repository: 'gravity-ui/skills-dev', version, files}, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(resolve(root, 'upstream.json'), 'utf8') !== content) throw new Error('Stale upstream.json; run node skills/repository-overview-eval-init/scripts/manifest.mjs');
  console.log('Bundle manifest matches all managed files');
} else writeFileSync(resolve(root, 'upstream.json'), content);
