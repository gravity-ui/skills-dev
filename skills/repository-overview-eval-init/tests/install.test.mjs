import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {install} from '../scripts/install.mjs';
import {effectiveScenario} from '../assets/repository-overview/lib/contracts.mjs';
const source = fileURLToPath(new URL('../assets/repository-overview/', import.meta.url));
function setup(t, ignore = '') {
  const repo = mkdtempSync(resolve(tmpdir(), 'overview-install-'));
  t.after(() => rmSync(repo, {recursive: true, force: true}));
  const git = (...args) => spawnSync('git', ['-C', repo, ...args], {encoding: 'utf8'});
  assert.equal(git('init', '-q').status, 0); git('remote', 'add', 'origin', 'https://github.com/gravity-ui/fixture.git');
  writeFileSync(resolve(repo, '.gitignore'), ignore);
  return {repo, git, dest: resolve(repo, '.agents/evals/repository-overview')};
}
for (const ignore of ['', '.agents/\n', '.agents/**\n', '*.json\n*.md\n', '.agents/\r\n']) test(`Installation preserves scenarios/reports and ignore semantics: ${JSON.stringify(ignore)}`, (t) => {
  const {repo, git, dest} = setup(t, ignore);
  const preview = install({repo, dryRun: true}); assert.ok(preview.files.length > 0); assert.deepEqual(readdirSync(repo).sort(), ['.git', '.gitignore']);
  install({repo});
  mkdirSync(resolve(dest, 'scenarios/repository'), {recursive: true}); writeFileSync(resolve(dest, 'scenarios/repository/custom.json'), '{"custom":true}');
  mkdirSync(resolve(dest, 'reports/runs'), {recursive: true}); writeFileSync(resolve(dest, 'reports/runs/history.json'), '{"history":true}');
  const before = readFileSync(resolve(repo, '.gitignore'), 'utf8');
  install({repo, update: true});
  assert.equal(readFileSync(resolve(dest, 'scenarios/repository/custom.json'), 'utf8'), '{"custom":true}');
  assert.equal(readFileSync(resolve(dest, 'reports/runs/history.json'), 'utf8'), '{"history":true}');
  assert.equal(readFileSync(resolve(repo, '.gitignore'), 'utf8'), before);
  for (const path of ['reports/runs/history.json', 'reports/new.md', 'scenarios/repository/custom.json', 'run.mjs']) assert.equal(git('check-ignore', '--no-index', '-q', `.agents/evals/repository-overview/${path}`).status, 1);
  assert.equal(git('check-ignore', '--no-index', '-q', '.agents/evals/repository-overview/.eval-artifacts/raw.jsonl').status, 0);
  if (ignore.startsWith('.agents/')) assert.equal(git('check-ignore', '--no-index', '-q', '.agents/unrelated.txt').status, 0);
  if (ignore.includes('\r\n')) assert.equal(before.replaceAll('\r\n', '').includes('\n'), false);
});
test('Conflicts and symlinks are rejected without changing managed files', (t) => {
  const {repo, dest} = setup(t); install({repo});
  writeFileSync(resolve(dest, 'run.mjs'), '// local change');
  const before = readFileSync(resolve(dest, 'upstream.json'), 'utf8');
  assert.throws(() => install({repo, update: true}), /conflicts/);
  assert.equal(readFileSync(resolve(dest, 'upstream.json'), 'utf8'), before);
  assert.equal(readFileSync(resolve(dest, 'run.mjs'), 'utf8'), '// local change');
  rmSync(resolve(dest, 'run.mjs')); symlinkSync(resolve(source, 'run.mjs'), resolve(dest, 'run.mjs'));
  assert.throws(() => install({repo, update: true}), /symlink/);
});
test('Legacy scenario migration preserves original and increments version', (t) => {
  const {repo, dest} = setup(t); mkdirSync(dest, {recursive: true});
  const old = {id: 'custom', version: 7, prompt: 'Overview', assertions: [{id: 'paths', type: 'answer-existing-paths', group: 'quality', minimum: 2}]};
  writeFileSync(resolve(dest, 'scenario.json'), JSON.stringify(old));
  install({repo, update: true});
  assert.deepEqual(JSON.parse(readFileSync(resolve(dest, 'scenario.json'), 'utf8')), old);
  const migrated = effectiveScenario(JSON.parse(readFileSync(resolve(dest, 'scenarios/repository/legacy.json'), 'utf8')));
  assert.equal(migrated.version, 8); assert.equal(migrated.assertions[0].group, 'structural');
  migrated.prompt = 'User-customized after migration'; migrated.version = 9;
  writeFileSync(resolve(dest, 'scenarios/repository/legacy.json'), JSON.stringify(migrated));
  install({repo, update: true});
  assert.equal(JSON.parse(readFileSync(resolve(dest, 'scenarios/repository/legacy.json'), 'utf8')).prompt, 'User-customized after migration');
});
test('Other repositories and old directory layout require explicit resolution', (t) => {
  const {repo, git} = setup(t);
  git('remote', 'set-url', 'origin', 'https://github.com/another/fixture.git');
  assert.throws(() => install({repo}), /Gravity UI/);
  git('remote', 'add', 'upstream', 'git@github.com:gravity-ui/fixture.git');
  mkdirSync(resolve(repo, 'evals/repository-overview'), {recursive: true});
  assert.throws(() => install({repo}), /Legacy/);
});

test('An upstream release updates known files and preserves unknown files', async (t) => {
  const {cpSync} = await import('node:fs');
  const {createHash} = await import('node:crypto');
  const {repo, dest} = setup(t); install({repo});
  writeFileSync(resolve(dest, 'local-notes.txt'), 'repository owned');
  const updated = mkdtempSync(resolve(tmpdir(), 'overview-release-'));
  t.after(() => rmSync(updated, {recursive: true, force: true}));
  cpSync(source, updated, {recursive: true});
  const content = `${readFileSync(resolve(updated, 'run.mjs'), 'utf8')}\n// Future upstream release\n`;
  writeFileSync(resolve(updated, 'run.mjs'), content);
  assert.throws(() => install({repo, update: true, source: updated}), /manifest is stale/);
  const manifest = JSON.parse(readFileSync(resolve(updated, 'upstream.json'), 'utf8'));
  manifest.version = '1.3.0'; manifest.files['run.mjs'] = createHash('sha256').update(content).digest('hex');
  writeFileSync(resolve(updated, 'upstream.json'), JSON.stringify(manifest));
  install({repo, update: true, source: updated});
  assert.equal(readFileSync(resolve(dest, 'run.mjs'), 'utf8'), content);
  assert.equal(readFileSync(resolve(dest, 'local-notes.txt'), 'utf8'), 'repository owned');
});
test('Global ignore rules are overridden only for eval, nested conflicting rules are reported', (t) => {
  const {repo, git, dest} = setup(t);
  const excludes = resolve(repo, '.git/global-excludes'); writeFileSync(excludes, '.agents/\n*.json\n');
  git('config', 'core.excludesFile', excludes); install({repo});
  assert.equal(git('check-ignore', '--no-index', '-q', '.agents/evals/repository-overview/reports/runs/x.json').status, 1);
  mkdirSync(resolve(dest, 'reports'), {recursive: true}); writeFileSync(resolve(dest, 'reports/.gitignore'), '*\n');
  assert.throws(() => install({repo, update: true}), /visibility check failed/);
});
