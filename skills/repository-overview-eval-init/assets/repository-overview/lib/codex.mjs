import {findCost, normalizeUsage, textFromContent} from './shared.mjs';
import {modelIdentifiers, diagnostics, eventCollector} from './events.mjs';
export {preflight} from './codex-policy.mjs';
import {configArgs} from './codex-policy.mjs';

export function command({repo, model, effort, prompt}) {
  const args = ['--ask-for-approval', 'on-request', ...configArgs(), 'exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--cd', repo];
  if (model) args.push('--model', model);
  if (effort) args.push('--config', `model_reasoning_effort=${JSON.stringify(effort)}`);
  args.push(prompt);
  return {executable: 'codex', args, cwd: repo};
}

export function normalize(events, stderr = '') {
  let response = '';
  let usage = normalizeUsage();
  let reportedCostUsd = null;
  const collector = eventCollector();
  const messages = stderr.split(/\r?\n/u);
  for (const event of events) {
    const item = event.item ?? {};
    if (event.type === 'item.completed' && item.type === 'agent_message') {
      const text = item.text || textFromContent(item.content);
      if (typeof text === 'string' && text.trim()) response = text;
    }
    if (['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
      const kinds = {command_execution: 'command', mcp_tool_call: 'mcp', tool_call: 'external', web_search: 'web', file_change: 'external'};
      if (kinds[item.type]) {
        collector.tool(item.id, item.name ?? item.type, item.command ?? item.arguments ?? item.input ?? item.query ?? item.changes,
          item.aggregated_output ?? item.output ?? item.result, item.status ?? (event.type === 'item.completed' ? 'completed' : 'in_progress'), item.exit_code ?? null, kinds[item.type]);
      } else if (!['agent_message', 'reasoning', 'todo_list', 'error', 'warning'].includes(item.type)) {
        collector.parserWarnings.push(`Unsupported Codex item: ${item.type}`);
      }
      if (['error', 'warning'].includes(item.type)) messages.push(item.message ?? 'Unknown Codex diagnostic');
    } else if (['error', 'warning', 'turn.failed'].includes(event.type)) {
      messages.push(event.message ?? event.error?.message ?? 'Unknown Codex error');
    } else if (!['thread.started', 'turn.started', 'turn.completed'].includes(event.type)) {
      collector.parserWarnings.push(`Unsupported Codex event: ${event.type}`);
    }
    if (event.type === 'turn.completed' && event.usage) usage = normalizeUsage(event.usage);
    const cost = findCost(event);
    if (cost !== null) reportedCostUsd = cost;
  }
  return {response, usage, reportedCostUsd, modelIdentifiers: modelIdentifiers(events), ...collector.finish(), ...diagnostics(messages, 'codex')};
}
