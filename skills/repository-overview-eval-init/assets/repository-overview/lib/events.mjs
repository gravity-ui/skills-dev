import {finalToolEvent} from './shared.mjs';

// Exact diagnostic from Codex CLI 0.153.4 (ext/skills/src/render.rs).
// New wording requires a fixture and review; do not match arbitrary warning substrings.
export const benignCodexDiagnostics = new Set(['Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.']);
export function diagnostics(messages = [], host = '') {
  const hostWarnings = [];
  const hostErrors = [];
  for (const message of messages) {
    const text = typeof message === 'string' ? message.trim() : JSON.stringify(message);
    if (!text) continue;
    (host === 'codex' && benignCodexDiagnostics.has(text) ? hostWarnings : hostErrors).push(text);
  }
  return {hostWarnings, hostErrors};
}
export function toolClass(name = '') {
  if (/web[_-]?search|WebSearch/u.test(name)) return 'web';
  if (/^mcp|mcp_tool_call/u.test(name)) return 'mcp';
  if (/^(command_execution|shell|bash|Bash|exec_command|Read|Glob|Grep|read|glob|grep)$/u.test(name)) return 'command';
  return 'external';
}
export function eventCollector() {
  const trace = [];
  const byId = new Map();
  const parserWarnings = [];
  function tool(id, name, input, output, status, exitCode, kind = toolClass(name)) {
    let event = id == null ? undefined : byId.get(id);
    if (!event) {
      event = finalToolEvent(name, input, output, null, {id: id ?? null, kind, status, exitCode});
      trace.push(event);
      if (id != null) byId.set(id, event);
    } else {
      if (input != null) event.input = input;
      if (output != null && output !== '') event.output = output;
      if (status != null) event.status = status;
      if (exitCode != null) event.exitCode = exitCode;
    }
    return event;
  }
  function finish() {
    for (const event of trace) {
      if (!['completed', 'failed', 'error', 'cancelled'].includes(event.status)) parserWarnings.push(`Incomplete tool event: ${event.id ?? event.name}`);
      if (event.input === null) parserWarnings.push(`Missing tool input: ${event.id ?? event.name}`);
    }
    return {trace, parserWarnings};
  }
  return {tool, finish, parserWarnings, byId};
}

export function modelIdentifiers(events) {
  const values = [];
  for (const event of events) {
    const part = event.part ?? event.data?.part;
    for (const value of [event.model, event.model_version, event.message?.model, part?.modelID, part?.model?.modelID]) {
      if (typeof value === 'string' && value) values.push(value);
    }
  }
  return [...new Set(values)].sort();
}
