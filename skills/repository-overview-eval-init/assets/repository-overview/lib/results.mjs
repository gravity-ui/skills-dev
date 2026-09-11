import {summarize} from './shared.mjs';
import {invalidReasons} from './contracts.mjs';

export function aggregate(attempts) {
  const valid = attempts.filter((attempt) => invalidReasons(attempt).length === 0);
  const metric = (get) => summarize(valid.map(get));
  const result = {
    completedAttempts: attempts.filter((attempt) => attempt.success).length,
    validAttempts: valid.length,
    invalidAttempts: attempts.length - valid.length,
  };
  for (const [name, field] of Object.entries({totalTokens: 'total', inputTokens: 'input', cachedInputTokens: 'cachedInput', cacheCreationInputTokens: 'cacheCreationInput', outputTokens: 'output', reasoningTokens: 'reasoning'})) result[name] = metric((a) => a.metrics.usage[field]);
  result.uncachedInputTokens = metric((a) => {
    const u = a.metrics.usage;
    return u.input === null ? null : Math.max(0, u.input - (u.cachedInput ?? 0) - (u.cacheCreationInput ?? 0));
  });
  for (const key of ['durationMs', 'toolCalls', 'failedToolCalls', 'uniquePaths']) result[key] = metric((a) => a.metrics[key]);
  // Diagnostics must remain visible even when the affected attempt is excluded from efficiency medians.
  for (const [key, field] of Object.entries({webSearchCalls: 'webSearchCalls', externalToolCalls: 'externalToolCalls', hostErrors: 'hostErrorCount', hostWarnings: 'hostWarningCount', malformedJsonLines: 'malformedJsonLines', parserWarnings: 'parserWarningCount'})) result[key] = summarize(attempts.map((a) => a.metrics[field]));
  for (const key of ['quality', 'structural', 'route']) result[`${key}Score`] = metric((a) => a.scores[key]);
  result.reportedCostUsd = metric((a) => a.metrics.cost.reportedUsd);
  result.pathSequences = valid.map((a) => a.pathSequence ?? []);
  const counts = new Map();
  for (const a of valid) for (const path of new Set(a.pathSequence ?? [])) counts.set(path, (counts.get(path) ?? 0) + 1);
  result.paths = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)).map(([path, count]) => [path, {attempts: count, rate: count / valid.length}]));
  return result;
}
