import {addUsage, findCost, normalizeUsage} from './shared.mjs';
import {modelIdentifiers, diagnostics, eventCollector} from './events.mjs';

export function command({repo, model, effort, prompt}) {
  const args = ['run', prompt, '--format', 'json', '--pure', '--agent', 'plan', '--dir', repo];
  if (model) args.push('--model', model);
  if (effort) args.push('--variant', effort);
  return {executable: 'opencode', args, cwd: repo};
}
export function normalize(events, stderr = '') {
  let response = '';
  let usage = normalizeUsage();
  let reportedCostUsd = null;
  const collector = eventCollector();
  const messages = stderr.split(/\r?\n/u);
  const steps = new Set();
  const texts = new Map();
  for (const event of events) {
    const part = event.part ?? event.data?.part ?? {};
    if ((event.type === 'text' || part.type === 'text') && typeof (part.text ?? event.text) === 'string') {
      if (part.id) texts.set(part.id, part.text ?? event.text);
      else response += part.text ?? event.text;
    } else if (event.type === 'tool_use' || part.type === 'tool') {
      collector.tool(part.id, part.tool ?? part.name ?? event.name, part.state?.input ?? part.input ?? event.input,
        part.state?.output ?? part.output, part.state?.status ?? 'in_progress', part.state?.metadata?.exit ?? null);
    } else if (event.type === 'error') messages.push(event.error?.message ?? event.message ?? 'Unknown OpenCode error');
    else if (event.type === 'step_finish' || part.type === 'step-finish') {
      if (part.id && steps.has(part.id)) continue;
      if (part.id) steps.add(part.id);
      // OpenCode's normalized step tokens use disjoint input/cache counters (including Anthropic).
      usage = addUsage(usage, normalizeUsage(part.tokens ?? event.tokens ?? event.usage, {inputIncludesCache: false}));
      const cost = findCost(part);
      if (cost !== null) reportedCostUsd = (reportedCostUsd ?? 0) + cost;
    } else if (!['step_start', 'reasoning'].includes(event.type)) collector.parserWarnings.push(`Unsupported OpenCode event: ${event.type}`);
  }
  response += [...texts.values()].join('');
  return {response, usage, reportedCostUsd, modelIdentifiers: modelIdentifiers(events), ...collector.finish(), ...diagnostics(messages, 'opencode')};
}
