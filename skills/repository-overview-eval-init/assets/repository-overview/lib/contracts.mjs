import {createHash} from 'node:crypto';
import {readJson} from './shared.mjs';

export const schemaVersion = 2;
export const runnerVersion = 5;
export const adapterVersion = 2;
export const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
  return value;
}
export const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

// The checked-in schemas deliberately use only this dependency-free JSON Schema subset.
export function validate(value, schema, path = '$', root = schema) {
  if (schema.$ref) return validate(value, schema.$ref.slice(2).split('/').reduce((obj, key) => obj[key], root), path, root);
  if (schema.oneOf) {
    const valid = schema.oneOf.filter((branch) => { try { validate(value, branch, path, root); return true; } catch { return false; } });
    if (valid.length !== 1) throw new Error(`${path}: must match exactly one schema variant`);
  }
  if ('const' in schema && canonical(value) !== canonical(schema.const)) throw new Error(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => canonical(item) === canonical(value))) throw new Error(`${path}: unsupported value`);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && ![schema.type].flat().some((t) => t === type || t === 'integer' && Number.isInteger(value))) throw new Error(`${path}: expected ${schema.type}`);
  if (typeof value === 'number' && (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum)) throw new Error(`${path}: invalid number`);
  if (typeof value === 'string' && (schema.minLength && value.length < schema.minLength || schema.pattern && !new RegExp(schema.pattern, 'u').test(value))) throw new Error(`${path}: invalid string`);
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) throw new Error(`${path}: too few items`);
    if (schema.items) value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`, root));
  }
  if (type === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) throw new Error(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(item, schema.properties[key], `${path}.${key}`, root);
      else if (schema.additionalProperties === false) throw new Error(`${path}.${key}: unknown property`);
    }
  }
}

export function effectiveScenario(value) {
  validate(value, readJson(new URL('../scenario.schema.json', import.meta.url)));
  const scenario = structuredClone(value);
  const ids = new Set();
  for (const assertion of scenario.assertions) {
    if (ids.has(assertion.id)) throw new Error(`Duplicate assertion id: ${assertion.id}`);
    ids.add(assertion.id);
    assertion.optional ??= false;
    if (assertion.pattern || assertion.patterns) assertion.flags ??= 'iu';
    for (const pattern of [assertion.pattern, ...(assertion.patterns ?? []), ...(assertion.before ?? [])].filter(Boolean)) new RegExp(pattern, assertion.flags);
  }
  return scenario;
}

export function invalidReasons(attempt) {
  const reasons = [];
  if (attempt.success !== true) reasons.push('process unsuccessful');
  if (attempt.degraded === true) reasons.push('degraded');
  for (const key of ['hostErrorCount', 'malformedJsonLines', 'parserWarningCount', 'webSearchCalls']) {
    if (!Number.isFinite(attempt.metrics?.[key])) reasons.push(`${key} missing`);
    else if (attempt.metrics[key] > 0) reasons.push(`${key}=${attempt.metrics[key]}`);
  }
  if (attempt.mutationDetected) reasons.push('repository mutation');
  return reasons;
}

export function validateArtifact(result) {
  if (result.schemaVersion !== schemaVersion) throw new Error(`Unsupported artifact schema ${result.schemaVersion}; collect a new baseline with schema ${schemaVersion} / runner ${runnerVersion}.`);
  validate(result, readJson(new URL('../artifact.schema.json', import.meta.url)));
  if (result.repeat !== result.attempts.length) throw new Error('repeat does not match attempts.length');
  if (result.eval.scenario && digest(effectiveScenario(result.eval.scenario)) !== result.eval.digest) throw new Error('Scenario digest does not match effective scenario');
}
