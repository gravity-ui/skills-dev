import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve, relative, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonicalPath} from './repository.mjs';
import {aggregate} from './results.mjs';
import {invalidReasons} from './contracts.mjs';

export const uniqueId = () => `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
const safePath = (value) => typeof value === 'string' && !value.startsWith('/') && !/^[A-Za-z]:|(^|\/)\.\.(\/|$)/u.test(value);
const numbers = (object) => Object.fromEntries(Object.entries(object ?? {}).filter(([, v]) => v === null || typeof v === 'number' || typeof v === 'boolean').map(([k, v]) => [k, v]));
export function sanitizedRun(result) {
  const {host, model, effort, cliVersion, runnerVersion, adapterVersion, adapterContract, nodeVersion, git, observedModelIdentifiers = []} = result.environment;
  const attempts = result.attempts.map((a) => ({
    index: a.index, success: a.success, degraded: a.degraded, mutationDetected: a.mutationDetected,
    metrics: {...numbers(a.metrics), usage: numbers(a.metrics.usage), cost: {reportedUsd: a.metrics.cost.reportedUsd}},
    scores: numbers(a.scores), observedModelIdentifiers: a.observedModelIdentifiers ?? [],
    pathSequence: (a.pathSequence ?? []).filter(safePath),
    assertions: a.assertions.map(({id, group, passed, skipped}) => ({id, group, passed, skipped})),
    invalidReasons: invalidReasons(a),
    mutation: a.mutation ? {...a.mutation, changedPaths: a.mutation.changedPaths.filter(safePath)} : undefined,
  }));
  return {
    schemaVersion: result.schemaVersion, kind: 'run-summary', runId: result.runId,
    eval: {id: result.eval.id, version: result.eval.version, digest: result.eval.digest},
    environment: {host, model, effort, cliVersion, runnerVersion, adapterVersion, adapterContract, observedModelIdentifiers, nodeVersion, git: {commit: git.commit, status: git.status, indexDigest: git.indexDigest}},
    repeat: result.repeat, mutationDetected: result.mutationDetected, attempts, aggregate: aggregate(attempts),
    createdAt: result.createdAt, manualReview: result.manualReview ?? {status: 'not-performed'},
  };
}
export function assertReportVisible(path) {
  path = canonicalPath(path);
  let parent = dirname(path);
  while (!existsSync(parent)) {
    const next = dirname(parent);
    if (next === parent) throw new Error(`Cannot resolve report directory: ${path}`);
    parent = next;
  }
  const owner = spawnSync('git', ['-C', parent, 'rev-parse', '--show-toplevel'], {encoding: 'utf8'});
  if (owner.status !== 0) throw new Error(`Report output is outside a Git repository: ${path}. Choose an output inside the repository that will retain the report.`);
  const repo = canonicalPath(owner.stdout.trim());
  const r = spawnSync('git', ['-C', repo, 'check-ignore', '--no-index', '-q', relative(repo, path)], {encoding: 'utf8'});
  if (r.status === 0) throw new Error(`Report is ignored by Git: ${relative(repo, path)}. Update the eval installation / ignore rules before benchmarking.`);
  if (r.status !== 1) throw new Error(`Cannot verify report Git visibility in ${repo}: ${relative(repo, path)}`);
  return repo;
}
export function writeReportPair(root, category, id, value, markdown) {
  const dir = resolve(root, category);
  mkdirSync(dir, {recursive: true});
  const json = resolve(dir, `${id}.json`);
  const md = resolve(dir, `${id}.md`);
  assertReportVisible(json); assertReportVisible(md);
  writeFileSync(json, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'});
  writeFileSync(md, markdown, {flag: 'wx'});
  return json;
}
export function renderRun(result) {
  const rows = Object.entries(result.aggregate).filter(([, value]) => value && typeof value === 'object' && 'median' in value)
    .map(([key, value]) => `| ${key} | ${value.median ?? 'n/a'} | ${value.min ?? 'n/a'} | ${value.max ?? 'n/a'} |`).join('\n');
  const metadata = {runId: result.runId, scenario: result.eval, environment: result.environment, createdAt: result.createdAt, manualReview: result.manualReview};
  return `# Repository overview measurement\n\n` +
    `Completed: ${result.aggregate.completedAttempts}/${result.repeat}; valid: ${result.aggregate.validAttempts}/${result.repeat}.\n\n` +
    `Automated structural, quality and route scores are separate. Manual factual review: ${result.manualReview?.status ?? 'not-performed'}.\n\n` +
    `| Metric | Median | Min | Max |\n|---|---:|---:|---:|\n${rows}\n\n` +
    `## Attempt eligibility\n\n${result.attempts.map((a) => `- Attempt ${a.index}: ${invalidReasons(a).join('; ') || 'valid'}`).join('\n')}\n\n` +
    `## Reproduction metadata\n\n\x60\x60\x60json\n${JSON.stringify(metadata, null, 2)}\n\x60\x60\x60\n`;
}
