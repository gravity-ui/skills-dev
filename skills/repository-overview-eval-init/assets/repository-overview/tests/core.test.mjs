import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalize as codex} from '../lib/codex.mjs';
import {normalize as claude} from '../lib/claude.mjs';
import {normalize as opencode} from '../lib/opencode.mjs';
import {configurationFingerprint, configArgs, verifyPolicy, requested} from '../lib/codex-policy.mjs';
import {parseJsonLines, normalizeUsage, evaluateAssertions, assertionScores} from '../lib/shared.mjs';
import {effectiveScenario, digest, validateArtifact} from '../lib/contracts.mjs';
import {aggregate} from '../lib/results.mjs';
import {compareResults} from '../compare.mjs';
import {sanitizedRun} from '../lib/reports.mjs';
const fixture = (name) => parseJsonLines(readFileSync(new URL(`../fixtures/${name}.jsonl`, import.meta.url), 'utf8'));
const assertion = (type, fields = {}) => ({id: 'a', group: 'route', type, ...fields});
const runAssertion = (a, paths = [], context = {}, response = '') => evaluateAssertions([a], response, paths, ['README.md', 'docs/guide.md', 'src/main.js', 'package.json'], context)[0];
export function run(tokens = 1000) {
  const attempts = [1, 2, 3].map((index) => ({index, success: true, degraded: false, mutationDetected: false,
    metrics: {usage: normalizeUsage({input: tokens - 20, output: 20}), cost: {reportedUsd: null}, durationMs: 100, toolCalls: 2, failedToolCalls: 0, hostErrorCount: 0, hostWarningCount: 0, parserWarningCount: 0, malformedJsonLines: 0, webSearchCalls: 0, externalToolCalls: 0, uniquePaths: 2},
    scores: {quality: 1, route: 1, structural: 1}, pathSequence: ['README.md', 'package.json'], assertions: [{id: 'fact', group: 'quality', passed: true, skipped: false}]}));
  return {schemaVersion: 2, runId: 'fixture', eval: {id: 'fixture', version: 1, digest: 'a'.repeat(64)},
    environment: {host: 'codex', model: 'fixture-model', effort: 'high', cliVersion: 'fixture-cli', runnerVersion: 5, adapterVersion: 2, adapterContract: {requested, effective: requested, verification: 'fixture'}, git: {commit: 'fixture-commit', status: '', indexDigest: 'fixture-index'}},
    repeat: 3, mutationDetected: false, attempts, aggregate: aggregate(attempts), createdAt: '2026-09-07T00:00:00.000Z', manualReview: {status: 'not-performed'}};
}

test('Codex normalizes commands, MCP, web, warnings and preserves nonempty response/output', () => {
  const r = codex(fixture('codex').events);
  assert.equal(r.response, 'The package is fixture-package (package.json).');
  assert.deepEqual(r.trace.map((t) => t.kind), ['command', 'mcp', 'web']);
  assert.equal(r.trace[0].output, 'useful partial output');
  assert.equal(r.trace.filter((t) => t.status === 'failed').length, 1);
  assert.equal(r.hostWarnings.length, 1); assert.equal(r.hostErrors.length, 0);
  assert.equal(r.parserWarnings.length, 0); assert.equal(r.usage.total, 1020);
  assert.equal(runAssertion(assertion('no-web-search'), [], {webSearchCalls: 1}).passed, false);
});
test('Unknown and fatal diagnostics, malformed and incomplete events block measurements', () => {
  assert.equal(fixture('malformed').malformed.length, 4);
  assert.equal(codex([{type: 'error', message: 'fatal'}]).hostErrors.length, 1);
  assert.equal(codex([], 'Unknown warning').hostErrors.length, 1);
  assert.equal(codex([{type: 'item.completed', item: {type: 'new-tool'}}]).parserWarnings.length, 1);
  assert.equal(codex([{type: 'item.started', item: {id: 'x', type: 'command_execution', command: 'cat README.md'}}]).parserWarnings.length, 1);
});
test('OpenCode and Claude use disjoint token counters, no duplicate steps or tool failures', () => {
  for (const r of [claude(fixture('claude').events), opencode(fixture('opencode').events)]) {
    assert.equal(r.usage.input, 550); assert.equal(r.usage.total, 570);
    assert.equal(r.trace.filter((t) => t.status === 'error').length, 1);
    assert.equal(r.hostErrors.length, 0);
    const a = run(); a.attempts.forEach((attempt) => attempt.metrics.usage = r.usage);
    assert.equal(aggregate(a.attempts).uncachedInputTokens.median, 100);
  }
  assert.equal(opencode(fixture('opencode').events).trace[0].output, 'earlier useful output');
});
test('Policy verifies effective settings and managed restrictions', () => {
  assert.deepEqual(verifyPolicy(requested, null).effective, requested);
  for (const key of Object.keys(requested)) assert.throws(() => verifyPolicy({...requested, [key]: 'wrong'}, null), new RegExp(key));
  assert.throws(() => verifyPolicy(requested, {allowedApprovalPolicies: ['never']}), /approval_policy/);
  assert.throws(() => verifyPolicy({}, null), /effective/);
});
test('Clean three-attempt comparison is valid; warning is benign', () => {
  const a = run(), b = run(500); b.attempts[0].metrics.hostWarningCount = 1;
  const r = compareResults(a, b); assert.equal(r.status, 'improved'); assert.equal(r.assessment.experiment.validity, 'valid');
  assert.equal(r.dimensions.totalTokens.candidateRange[0], 500);
});
for (const [name, corrupt] of Object.entries({
  degraded: (a) => a.degraded = true,
  malformed: (a) => a.metrics.malformedJsonLines = 42,
  hostError: (a) => a.metrics.hostErrorCount = 1,
  parserWarning: (a) => a.metrics.parserWarningCount = 1,
  web: (a) => a.metrics.webSearchCalls = 1,
  unsuccessful: (a) => a.success = false,
  mutation: (a) => a.mutationDetected = true,
})) test(`${name} in just one attempt invalidates comparison`, () => {
  const b = run(500); corrupt(b.attempts[0]);
  const r = compareResults(run(), b);
  assert.equal(r.status, 'inconclusive'); assert.equal(r.assessment.experiment.validity, 'invalid');
  assert.equal(r.candidate.aggregate.validAttempts, 2);
  assert.ok(r.assessment.experiment.findings.some((f) => f.title === 'candidate attempt 1'));
});
for (const key of ['host', 'model', 'effort', 'cliVersion', 'runnerVersion', 'adapterVersion', 'adapterContract']) test(`Reject incompatible ${key}`, () => {
  const b = run(500); b.environment[key] = key === 'host' ? 'claude' : key.endsWith('Version') && key !== 'cliVersion' ? 99 : key === 'adapterContract' ? {...b.environment[key], verification: 'different'} : 'different';
  const r = compareResults(run(), b); assert.equal(r.status, 'inconclusive'); assert.ok(r.incompatibilities.some((v) => v.field === key));
});
test('Digest, attempt count, old schemas, aggregate-only artifacts, and smoke limits', () => {
  const b = run(); b.eval.digest = 'b'.repeat(64); assert.equal(compareResults(run(), b).status, 'inconclusive');
  const a = run(); a.attempts.pop(); a.repeat = 2; assert.equal(compareResults(a, run()).assessment.experiment.validity, 'invalid');
  assert.equal(compareResults(a, a).assessment.experiment.validity, 'limited');
  assert.throws(() => compareResults({...run(), schemaVersion: 1}, run()), /new baseline/);
  const missing = run(); delete missing.attempts; assert.throws(() => validateArtifact(missing), /required/);
});
test('Scenario identity is key-order invariant but assertion-order sensitive, schema validates early', () => {
  const s = effectiveScenario({id: 'test', version: 1, prompt: 'test', assertions: [assertion('max-tool-calls', {maximum: 2}), assertion('no-web-search', {id: 'b'})]});
  assert.equal(digest(s), digest({...s, id: s.id}));
  assert.notEqual(digest(s), digest({...s, assertions: [...s.assertions].reverse()}));
  assert.throws(() => effectiveScenario({...s, assertions: [assertion('max-tool-calls', {maximum: -1})]}));
  assert.throws(() => effectiveScenario({...s, assertions: [assertion('unknown')]}));
  assert.throws(() => effectiveScenario({...s, assertions: [assertion('trace-path-required', {patterns: ['[']})]}));
  assert.throws(() => effectiveScenario({...s, assertions: [s.assertions[0], s.assertions[0]]}), /Duplicate/);
});
test('Budgets include boundary and fail above', () => {
  for (const type of ['max-tool-calls', 'max-failed-tool-calls', 'max-path-revisits', 'max-unique-paths']) {
    const paths = type === 'max-unique-paths' ? [{path: 'a'}, {path: 'b'}] : [{path: 'a'}, {path: 'a'}, {path: 'a'}];
    assert.equal(runAssertion(assertion(type, {maximum: 2}), paths, {toolCalls: 2, failedToolCalls: 2}).passed, true);
    assert.equal(runAssertion(assertion(type, {maximum: 1}), paths, {toolCalls: 2, failedToolCalls: 2}).passed, false);
  }
});
test('Docs must precede implementation, presence alone and same event do not suffice', () => {
  const a = assertion('trace-paths-before', {patterns: ['^docs/guide\\.md$'], before: ['^src/']});
  assert.equal(runAssertion(a, [{path: 'docs/guide.md', eventIndex: 0}, {path: 'src/main.js', eventIndex: 1}]).passed, true);
  for (const index of [1, 2]) assert.equal(runAssertion(a, [{path: 'src/main.js', eventIndex: 1}, {path: 'docs/guide.md', eventIndex: index}]).passed, false);
  assert.equal(runAssertion(a, [{path: 'src/main.js', eventIndex: 1}]).passed, false);
  assert.equal(runAssertion(assertion('trace-path-required', {patterns: ['missing']})).passed, false);
  assert.equal(runAssertion(assertion('trace-path-required', {patterns: ['missing'], optional: true})).skipped, true);
});
test('Headings and valid paths cannot yield perfect factual quality', () => {
  const assertions = [{id: 'heading', type: 'answer-regex', group: 'structural', pattern: 'Architecture'}, {id: 'citation', type: 'answer-existing-paths', group: 'structural', minimum: 2},
    {id: 'fact', type: 'answer-fact-with-source', group: 'quality', pattern: 'fixture-package', patterns: ['^package\\.json$']}];
  const bad = 'Applications and packages\n\nArchitecture\n\nTechnology stack\n\nInvariants\n\nWrong package (package.json, README.md)';
  const scores = assertionScores(evaluateAssertions(assertions, bad, [], ['package.json', 'README.md']));
  assert.equal(scores.structural, 1); assert.equal(scores.quality, 0);
  assert.equal(assertionScores(evaluateAssertions(assertions.slice(0, 2), bad, [], ['package.json', 'README.md'])).quality, null);
  assert.equal(runAssertion(assertions[2], [], {}, 'fixture-package (package.json)').passed, true);
  assert.equal(runAssertion(assertions[2], [], {}, 'fixture-package\n\npackage.json').passed, false);
});
test('Sanitized summaries retain comparison metadata but drop host output and absolute root', () => {
  const a = run(); a.environment.repo = '/private/local'; a.attempts[0].hostErrors = ['secret raw output']; a.attempts[0].response = 'secret answer';
  const saved = sanitizedRun(a); validateArtifact(saved);
  assert.ok(!JSON.stringify(saved).includes('/private/local')); assert.ok(!JSON.stringify(saved).includes('secret'));
  assert.equal(compareResults(saved, sanitizedRun(run(500))).status, 'improved');
});

test('Raw host streams match reviewed normalized fixture projections', () => {
  const expected = JSON.parse(readFileSync(new URL('../fixtures/expected-normalized.json', import.meta.url), 'utf8'));
  for (const [host, normalize] of Object.entries({codex, claude, opencode})) {
    const r = normalize(fixture(host).events);
    const {input, cachedInput, cacheCreationInput, output, total} = r.usage;
    assert.deepEqual({response: r.response, input, cachedInput, cacheCreationInput, output, total,
      toolKinds: r.trace.map((e) => e.kind), failedTools: r.trace.filter((e) => ['failed', 'error'].includes(e.status)).length,
      warnings: r.hostWarnings.length, errors: r.hostErrors.length}, expected[host]);
  }
});

test('Exposed model identifiers are retained and mismatches prevent comparison', () => {
  assert.deepEqual(claude([{type: 'system', model: 'immutable-model-revision'}]).modelIdentifiers, ['immutable-model-revision']);
  const a = run(); a.environment.observedModelIdentifiers = ['immutable-model-revision'];
  const b = run(); b.environment.observedModelIdentifiers = ['different-revision'];
  assert.deepEqual(sanitizedRun(a).environment.observedModelIdentifiers, ['immutable-model-revision']);
  assert.equal(compareResults(a, b).assessment.experiment.validity, 'invalid');
});

test('Host-reported cost survives normalization, saved reports and comparisons', () => {
  const normalized = [
    codex([{type: 'turn.completed', usage: {input_tokens: 100, output_tokens: 20}, total_cost_usd: 0.25}]),
    claude([{type: 'result', usage: {input_tokens: 100, output_tokens: 20}, total_cost_usd: 0.25}]),
    opencode([{type: 'step_finish', part: {id: 'cost-step', tokens: {input: 100, output: 20}, cost: 0.25}}]),
  ];
  for (const result of normalized) assert.equal(result.reportedCostUsd, 0.25);
  const baseline = run(), candidate = run();
  baseline.attempts.forEach((attempt) => attempt.metrics.cost.reportedUsd = 0.5);
  candidate.attempts.forEach((attempt) => attempt.metrics.cost.reportedUsd = normalized[0].reportedCostUsd);
  const saved = sanitizedRun(candidate);
  validateArtifact(saved);
  assert.deepEqual(saved.attempts[0].metrics.cost, {reportedUsd: 0.25});
  assert.equal(saved.aggregate.reportedCostUsd.median, 0.25);
  assert.equal(compareResults(baseline, saved).dimensions.reportedCostUsd.signal, 'better');
  assert.equal(sanitizedRun(run()).aggregate.reportedCostUsd.median, null);
});

for (const [host, normalize] of Object.entries({claude, opencode})) {
  test(`${host} WebFetch is a web call and invalidates a repository-only experiment`, () => {
    const normalized = normalize(fixture(`${host}-webfetch`).events);
    assert.deepEqual(normalized.trace.map((event) => event.kind), ['web']);
    assert.deepEqual(normalized.parserWarnings, []);
    const webSearchCalls = normalized.trace.filter((event) => event.kind === 'web').length;
    assert.equal(runAssertion(assertion('no-web-search'), [], {webSearchCalls}).passed, false);
    const candidate = run(500); candidate.attempts[0].metrics.webSearchCalls = webSearchCalls;
    assert.equal(compareResults(run(), candidate).assessment.experiment.validity, 'invalid');
  });
  test(`${host} allows only reviewed diagnostic text and its attached hint`, () => {
    const stderr = readFileSync(new URL('../fixtures/node-sqlite.stderr', import.meta.url), 'utf8');
    const normalized = normalize(fixture(host).events, stderr);
    assert.equal(normalized.hostWarnings.length, 2);
    assert.deepEqual(normalized.hostErrors, []);
    const candidate = run(500); candidate.attempts[0].metrics.hostWarningCount = normalized.hostWarnings.length;
    assert.equal(compareResults(run(), candidate).assessment.experiment.validity, 'valid');
    for (const text of ['ExperimentalWarning: Unreviewed feature', stderr.split('\n')[1], 'fatal error']) {
      assert.equal(normalize([], text).hostErrors.length, 1);
    }
    assert.equal(normalize([], 'Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.').hostErrors.length, 1);
    assert.equal(codex([], stderr).hostErrors.length, 2);
  });
}
test('Codex config fingerprints block model, instruction and MCP-layer drift without exposing configuration', () => {
  const input = {config: {model: 'fixture', developer_instructions: 'private instructions'}, layers: [
    {name: {type: 'user', file: '/private/config.toml'}, version: 'opaque-v1', config: {mcp_servers: {fixture: {env: {TOKEN: 'secret-sentinel'}}}}},
  ]};
  const fingerprint = configurationFingerprint(input);
  const a = run(); a.environment.adapterContract.configuration = fingerprint;
  assert.equal(compareResults(a, structuredClone(a)).assessment.experiment.validity, 'valid');
  for (const change of [
    (value) => value.config.model = 'another-model',
    (value) => value.config.developer_instructions = 'other instructions',
    (value) => value.layers[0].version = 'opaque-v2-after-mcp-change',
  ]) {
    const changed = structuredClone(input); change(changed);
    const b = structuredClone(a); b.environment.adapterContract.configuration = configurationFingerprint(changed);
    assert.equal(compareResults(a, b).assessment.experiment.validity, 'invalid');
  }
  assert.ok(!JSON.stringify(sanitizedRun(a)).includes('secret-sentinel'));
  assert.ok(!JSON.stringify(fingerprint).includes('private'));
  // Credential-bearing config objects are deliberately never inspected by the fingerprint.
  Object.defineProperty(input.layers[0], 'config', {get() { throw new Error('must not read config'); }});
  assert.deepEqual(configurationFingerprint(input), fingerprint);
  assert.throws(() => configurationFingerprint({config: {}, layers: null}), /could not be fingerprinted/);
  assert.throws(() => configurationFingerprint({config: {}, layers: [{name: {type: 'user'}}]}), /could not be fingerprinted/);
  const args = configArgs({model: 'fixture', effort: 'high'});
  assert.ok(args.includes('model="fixture"')); assert.ok(args.includes('model_reasoning_effort="high"'));
});
