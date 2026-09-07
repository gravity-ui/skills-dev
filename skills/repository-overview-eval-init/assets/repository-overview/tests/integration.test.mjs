import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {repositoryState, stateDifference} from '../lib/repository.mjs';
import {referencedPaths, evaluateAssertions} from '../lib/shared.mjs';
import {validateArtifact, effectiveScenario} from '../lib/contracts.mjs';
const source = fileURLToPath(new URL('..', import.meta.url));
function setup(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'overview-fixture-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const repo = resolve(root, 'repo'); mkdirSync(repo);
  const git = (...args) => { const r = spawnSync('git', args, {cwd: repo, encoding: 'utf8'}); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  writeFileSync(resolve(repo, 'README.md'), 'Original'); writeFileSync(resolve(repo, 'package.json'), '{}');
  writeFileSync(resolve(repo, '.gitignore'), '/.agents/evals/repository-overview/.eval-artifacts/\n');
  const evalDir = resolve(repo, '.agents/evals/repository-overview');
  cpSync(source, evalDir, {recursive: true, filter: (path) => !/(?:^|\/)(?:reports|\.eval-artifacts)(?:\/|$)/u.test(path)});
  git('add', '.'); git('commit', '-qm', 'fixture');
  const bin = resolve(root, 'bin'); mkdirSync(bin);
  cpSync(resolve(source, 'fixtures/host.mjs'), resolve(bin, 'codex')); chmodSync(resolve(bin, 'codex'), 0o755);
  const cli = (script, args) => spawnSync(process.execPath, [resolve(evalDir, script), ...args], {cwd: repo, env: {...process.env, PATH: `${bin}:${process.env.PATH}`}, encoding: 'utf8', timeout: 15000});
  return {root, repo, git, evalDir, cli};
}
for (const [model, valid] of [['fixture', true], ['fixture-warning', true], ['fixture-malformed', false], ['fixture-fatal', false], ['fixture-mutation', false]]) test(`Runner CLI: ${model}`, (t) => {
  const {repo, evalDir, cli, git} = setup(t);
  if (model === 'fixture-mutation') writeFileSync(resolve(repo, 'README.md'), 'Already dirty');
  const result = cli('run.mjs', ['--host', 'codex', '--repo', repo, '--model', model, '--effort', 'high', '--repeat', '3']);
  assert.equal(result.status, valid ? 0 : 1, result.stderr);
  const files = readdirSync(resolve(evalDir, 'reports/runs')).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1);
  const reportPath = resolve(evalDir, 'reports/runs', files[0]);
  const summary = JSON.parse(readFileSync(reportPath, 'utf8')); validateArtifact(summary);
  assert.equal(summary.aggregate.validAttempts, valid ? 3 : model === 'fixture-mutation' ? 2 : 0);
  if (model === 'fixture-mutation') assert.ok(summary.attempts[0].mutation.changedPaths.includes('README.md'));
  assert.ok(!JSON.stringify(summary).includes(repo));
  assert.ok(git('status', '--short').includes('reports/'));
  const raw = resolve(evalDir, '.eval-artifacts');
  const rawRun = resolve(raw, 'runs', readdirSync(resolve(raw, 'runs'))[0], 'result.json');
  validateArtifact(JSON.parse(readFileSync(rawRun, 'utf8')));
  rmSync(raw, {recursive: true});
  const compared = cli('compare.mjs', ['--baseline', reportPath, '--candidate', reportPath]);
  assert.equal(compared.status, 0, compared.stderr);
  const comparisonFile = readdirSync(resolve(evalDir, 'reports/comparisons')).find((f) => f.endsWith('.json'));
  const comparison = JSON.parse(readFileSync(resolve(evalDir, 'reports/comparisons', comparisonFile), 'utf8'));
  assert.equal(comparison.assessment.experiment.validity, valid ? 'limited' : 'invalid');
});
test('Git mutation audit detects dirty content changes, staging, new files, and ignores its own outputs', (t) => {
  const {repo, git, evalDir} = setup(t);
  writeFileSync(resolve(repo, 'README.md'), 'dirty');
  const excluded = [resolve(evalDir, '.eval-artifacts'), resolve(evalDir, 'reports')];
  const before = repositoryState(repo, excluded);
  mkdirSync(resolve(evalDir, 'reports')); writeFileSync(resolve(evalDir, 'reports/example.json'), '{}');
  assert.equal(stateDifference(before, repositoryState(repo, excluded)).detected, false);
  writeFileSync(resolve(repo, 'README.md'), 'different dirty content');
  assert.deepEqual(stateDifference(before, repositoryState(repo, excluded)).changedPaths, ['README.md']);
  const dirty = repositoryState(repo, excluded); git('add', 'README.md');
  assert.equal(stateDifference(dirty, repositoryState(repo, excluded)).detected, true);
  writeFileSync(resolve(repo, 'new.txt'), 'new'); assert.ok(stateDifference(before, repositoryState(repo, excluded)).changedPaths.includes('new.txt'));
});
test('Every bundled scenario/template validates', () => {
  for (const path of ['scenarios/default.json', 'examples/overview.json', 'examples/focused-task.json']) effectiveScenario(JSON.parse(readFileSync(resolve(source, path), 'utf8')));
});

test('Directory references cannot bypass the eval-source exclusion', (t) => {
  const {repo} = setup(t);
  const paths = referencedPaths([{name: 'command_execution', input: 'ls .agents/evals/repository-overview/'}], repo, []);
  assert.equal(paths[0].path, '.agents/evals/repository-overview/');
  const [result] = evaluateAssertions([{id: 'avoid', group: 'route', type: 'trace-path-not-seen', patterns: ['^\\.agents/evals/repository-overview/']}], '', paths, []);
  assert.equal(result.passed, false);
});

test('Removed pricing option fails before launching the host', (t) => {
  const {evalDir, cli} = setup(t);
  const result = cli('run.mjs', ['--prices', 'old-prices.json']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported option: --prices/u);
  assert.equal(readdirSync(evalDir).includes('reports'), false);
  assert.equal(readdirSync(evalDir).includes('.eval-artifacts'), false);
});
