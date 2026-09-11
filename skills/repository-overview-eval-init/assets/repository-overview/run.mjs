#!/usr/bin/env node

import {spawn, spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {schemaVersion, runnerVersion, adapterVersion, effectiveScenario, digest, invalidReasons, validateArtifact} from './lib/contracts.mjs';
import {aggregate} from './lib/results.mjs';
import {repositoryState, stateDifference, canonicalPath} from './lib/repository.mjs';
import {sanitizedRun, renderRun, writeReportPair, uniqueId, assertReportVisible} from './lib/reports.mjs';
import * as codex from './lib/codex.mjs';
import * as claude from './lib/claude.mjs';
import * as opencode from './lib/opencode.mjs';
import {
  assertionScores,
  evaluateAssertions,
  listRepositoryFiles,
  parseArgs,
  validateOptions,
  parseJsonLines,
  readJson,
  referencedPaths,
} from './lib/shared.mjs';

const evalRoot = dirname(fileURLToPath(import.meta.url));
const adapters = {codex, claude, opencode};


async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options, ['help', 'host', 'repo', 'model', 'effort', 'repeat', 'timeoutMs', 'scenario', 'output']);
  if (options.help) return printHelp();

  const host = options.host ?? detectHost();
  if (!adapters[host]) throw new Error(`Unsupported host ${JSON.stringify(host)}. Use codex, claude, or opencode.`);
  const repo = canonicalPath(options.repo ?? process.cwd());
  const scenarioPath = resolve(options.scenario ?? resolve(evalRoot, 'scenarios/default.json'));
  const scenario = effectiveScenario(readJson(scenarioPath));
  const repeat = positiveInteger(options.repeat ?? 1, '--repeat');
  const timeoutMs = positiveInteger(options.timeoutMs ?? 600_000, '--timeout-ms');
  const runId = `${uniqueId()}-${host}`;
  const artifactRoot = resolve(evalRoot, '.eval-artifacts');
  const outputDir = resolve(options.output ?? resolve(artifactRoot, 'runs', runId));
  const reportsRoot = resolve(evalRoot, 'reports');
  assertReportVisible(resolve(reportsRoot, 'runs', `${runId}.json`));
  assertReportVisible(resolve(reportsRoot, 'runs', `${runId}.md`));
  const excludedRoots = [artifactRoot, reportsRoot, outputDir];
  if (evalRoot.startsWith(`${repo}${sep}`)) excludedRoots.push(evalRoot);
  const inventory = listRepositoryFiles(repo, excludedRoots);
  const before = repositoryState(repo, [artifactRoot, reportsRoot, outputDir]);
  const cliVersion = commandVersion(adapters[host].command({repo, model: options.model, effort: options.effort, prompt: ''}).executable);
  if (!cliVersion) throw new Error('Host CLI version unavailable');
  const attempts = [];
  let adapterContract;

  createFreshDirectory(outputDir, '--output');
  mkdirSync(resolve(outputDir, 'attempts'));
  for (let index = 1; index <= repeat; index++) {
    const attemptDir = resolve(outputDir, 'attempts', String(index));
    mkdirSync(attemptDir, {recursive: true});
    process.stderr.write(`repository-overview: ${host} attempt ${index}/${repeat}\n`);
    const policy = adapters[host].preflight ? await adapters[host].preflight({repo, model: options.model, effort: options.effort}) : {requested: {mode: 'plan'}, effective: {mode: 'plan'}, verification: 'CLI flags; Git mutation audit'};
    if (adapterContract && JSON.stringify(adapterContract) !== JSON.stringify(policy)) throw new Error('Adapter policy changed between attempts');
    adapterContract = policy;
    attempts.push(await runAttempt({
      adapter: adapters[host], host, repo, scenario, options, inventory, attemptDir, index, timeoutMs, excludedRoots: [artifactRoot, reportsRoot, outputDir],
    }));
  }

  const after = repositoryState(repo, [artifactRoot, reportsRoot, outputDir]);
  const result = {
    schemaVersion, runId,
    eval: {id: scenario.id, version: scenario.version, digest: digest(scenario), scenario},
    environment: {
      host,
      model: options.model ?? 'default',
      effort: options.effort ?? null,
      cliVersion,
      runnerVersion, adapterVersion, adapterContract,
      observedModelIdentifiers: [...new Set(attempts.flatMap((a) => a.observedModelIdentifiers))].sort(),
      nodeVersion: process.version,
      repo,
      git: before,
    },
    repeat,
    mutationDetected: stateDifference(before, after).detected || attempts.some((a) => a.mutationDetected),
    manualReview: {status: 'not-performed'},
    attempts,
    aggregate: aggregate(attempts),
    createdAt: new Date().toISOString(),
  };
  validateArtifact(result);
  writeFileSync(resolve(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const summary = sanitizedRun(result);
  writeFileSync(resolve(outputDir, 'report.md'), renderRun(summary));
  const report = writeReportPair(reportsRoot, 'runs', runId, summary, renderRun(summary));
  process.stdout.write(`Report: ${report}\n`);
  process.stdout.write(`${outputDir}\n`);
  if (result.mutationDetected || attempts.some((attempt) => invalidReasons(attempt).length)) process.exitCode = 1;
}

function createFreshDirectory(path, optionName) {
  mkdirSync(dirname(path), {recursive: true});
  try {
    mkdirSync(path);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`${optionName} already exists: ${path}`);
    throw error;
  }
}

async function runAttempt({adapter, host, repo, scenario, options, inventory, attemptDir, index, timeoutMs, excludedRoots}) {
  const invocation = adapter.command({repo, model: options.model, effort: options.effort, prompt: scenario.prompt});
  const before = repositoryState(repo, excludedRoots);
  const started = Date.now();
  const completed = await execute(invocation, timeoutMs);
  const durationMs = Date.now() - started;
  const mutation = stateDifference(before, repositoryState(repo, excludedRoots));
  writeFileSync(resolve(attemptDir, 'raw.jsonl'), completed.stdout);
  writeFileSync(resolve(attemptDir, 'stderr.log'), completed.stderr);

  const {events, malformed} = parseJsonLines(completed.stdout);
  const normalized = adapter.normalize(events, completed.stderr);
  if (normalized.trace.some((event) => event.name === 'file_change' && event.status === 'completed')) { mutation.detected = true; mutation.traceDetected = true; }
  const paths = referencedPaths(normalized.trace, repo, inventory);
  const failedToolCalls = normalized.trace.filter((event) => (
    event.status === 'failed'
      || event.status === 'error'
      || (typeof event.exitCode === 'number' && event.exitCode !== 0)
  )).length;
  const hostErrors = normalized.hostErrors ?? [];
  const webSearchCalls = normalized.trace.filter((event) => event.kind === 'web').length;
  const externalToolCalls = normalized.trace.filter((event) => ['mcp', 'external'].includes(event.kind)).length;
  const parserWarnings = normalized.parserWarnings ?? [];
  if (normalized.usage.total === null || normalized.usage.input === null || normalized.usage.output === null) parserWarnings.push('Missing token usage');
  const assertions = evaluateAssertions(scenario.assertions, normalized.response, paths, inventory, {
    toolCalls: normalized.trace.length,
    failedToolCalls, webSearchCalls,
  });
  const scores = assertionScores(assertions);
  const success = completed.code === 0 && !completed.timedOut && Boolean(normalized.response.trim());
  const metrics = {
    durationMs,
    usage: normalized.usage,
    cost: {reportedUsd: normalized.reportedCostUsd},
    toolCalls: normalized.trace.length,
    failedToolCalls,
    hostErrorCount: hostErrors.length, hostWarningCount: normalized.hostWarnings.length,
    parserWarningCount: parserWarnings.length, webSearchCalls, externalToolCalls,
    uniquePaths: new Set(paths.map(({path}) => path)).size,
    referencedPathCount: new Set(paths.map(({path}) => path)).size,
    malformedJsonLines: malformed.length,
    timedOut: completed.timedOut,
  };
  const trace = {events: normalized.trace, referencedPaths: paths};

  writeFileSync(resolve(attemptDir, 'response.md'), normalized.response);
  writeFileSync(resolve(attemptDir, 'trace.json'), `${JSON.stringify(trace, null, 2)}\n`);
  writeFileSync(resolve(attemptDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  return {
    index,
    success,
    degraded: hostErrors.length > 0 || malformed.length > 0 || parserWarnings.length > 0,
    mutationDetected: mutation.detected, mutation,
    observedModelIdentifiers: normalized.modelIdentifiers,
    exitCode: completed.code,
    signal: completed.signal,
    responsePath: `attempts/${index}/response.md`,
    tracePath: `attempts/${index}/trace.json`,
    rawPath: `attempts/${index}/raw.jsonl`,
    metrics,
    scores,
    pathSequence: paths.map(({path}) => path),
    hostErrors, hostWarnings: normalized.hostWarnings, parserWarnings,
    assertions,
    parseWarnings: malformed,
  };
}

function execute({executable, args, cwd}, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimeout;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(killTimeout);
      resolvePromise({stdout, stderr, code, signal, timedOut});
    });
  });
}

function commandVersion(executable) {
  const result = spawnSync(executable, ['--version'], {encoding: 'utf8'});
  return result.status === 0 ? result.stdout.trim() || result.stderr.trim() : null;
}

function detectHost() {
  if (process.env.CODEX_THREAD_ID || process.env.CODEX_SANDBOX) return 'codex';
  if (process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CLAUDECODE) return 'claude';
  if (process.env.OPENCODE) return 'opencode';
  const installed = Object.keys(adapters).filter((host) => {
    const executable = adapters[host].command({repo: process.cwd(), prompt: ''}).executable;
    return spawnSync(executable, ['--version'], {stdio: 'ignore'}).status === 0;
  });
  if (installed.length === 1) return installed[0];
  throw new Error(`Cannot choose a host automatically (${installed.join(', ') || 'none'} detected); pass --host.`);
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage: node run.mjs [options]\n\n` +
    `  --host <codex|claude|opencode>\n` +
    `  --repo <path>             Repository to inspect (default: cwd)\n` +
    `  --model <id>              Host-specific model id\n` +
    `  --effort <value>          Host-specific effort/variant\n` +
    `  --repeat <n>              Attempts (default: 1; use 3 for benchmark)\n` +
    `  --timeout-ms <n>          Per-attempt timeout (default: 600000)\n` +
    `  --scenario <path>         Scenario JSON\n` +
    `  --output <path>           Artifact directory\n`);
}

main().catch((error) => {
  process.stderr.write(`repository-overview: ${error.message}\n`);
  process.exitCode = 1;
});
