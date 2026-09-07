import {modelIdentifiers, diagnostics, eventCollector, toolClass} from './events.mjs';
import { findCost, normalizeUsage, textFromContent} from './shared.mjs';

export function command({repo, model, effort, prompt}) {
  const args = [
    '--print', prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--permission-mode', 'plan', '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return {executable: 'claude', args, cwd: repo};
}

export function normalize(events, stderr = '') {
  let response = '';
  let usage = normalizeUsage();
  let reportedCostUsd = null;
  const collector = eventCollector();
  const toolCalls = collector.byId;
  const hostErrors = stderr.split(/\r?\n/u);
  for (const event of events) {
    if (event.type === 'assistant') {
      const content = event.message?.content ?? [];
      const text = textFromContent(content);
      if (text) response += `${response ? '\n' : ''}${text}`;
      for (const part of content) {
        if (part?.type === 'tool_use') {
          collector.tool(part.id, part.name, part.input, null, 'in_progress', null, toolClass(part.name));
        }
      }
    }
    if (event.type === 'user') {
      const content = event.message?.content ?? [];
      for (const part of content) {
        if (part?.type !== 'tool_result') continue;
        const toolCall = toolCalls.get(part.tool_use_id);
        if (!toolCall) continue;
        const output = textFromContent(part.content);
        toolCall.output = output || part.content || null;
        toolCall.status = part.is_error ? 'error' : 'completed';
      }
    }
    if (event.type === 'result') {
      if (typeof event.result === 'string' && event.result) response = event.result;
      if (event.usage) usage = normalizeUsage(event.usage, {inputIncludesCache: false});
      if (event.is_error || event.subtype === 'error') hostErrors.push(event.result ?? event.error ?? 'Unknown Claude error');
    }
    if (event.type === 'error') hostErrors.push(event.error?.message ?? event.message ?? 'Unknown Claude error');
    if (!['assistant', 'user', 'result', 'error', 'system', 'rate_limit_event'].includes(event.type)) collector.parserWarnings.push(`Unsupported Claude event: ${event.type}`);
    const cost = findCost(event);
    if (cost !== null) reportedCostUsd = cost;
  }
  return {response, usage, reportedCostUsd, modelIdentifiers: modelIdentifiers(events), ...collector.finish(), ...diagnostics(hostErrors)};
}
