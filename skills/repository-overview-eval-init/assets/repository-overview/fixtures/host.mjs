#!/usr/bin/env node
// Offline CLI double. It never calls a provider or executes model-generated commands.
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) console.log('fixture-cli 1');
else if (args.includes('app-server')) {
  const config = {approval_policy: 'on-request', sandbox_mode: 'read-only', web_search: 'disabled'};
  for (let i = 0; i < args.length; i++) if (args[i] === '--config') {
    const separator = args[i + 1].indexOf('=');
    config[args[i + 1].slice(0, separator)] = JSON.parse(args[i + 1].slice(separator + 1));
  }
  const stream = createInterface({input: process.stdin});
  stream.on('line', (line) => {
    const request = JSON.parse(line);
    if (!request.id) return;
    const result = request.method === 'config/read' ? {config, layers: [{name: {type: 'sessionFlags'}, version: JSON.stringify(config)}]} : request.method === 'configRequirements/read' ? {requirements: null} : {};
    console.log(JSON.stringify({id: request.id, result}));
  });
} else {
  const model = args[args.indexOf('--model') + 1];
  if (model === 'fixture-mutation') writeFileSync('README.md', 'Changed existing dirty content');
  if (model === 'fixture-malformed') console.log('malformed-json');
  if (model === 'fixture-warning') console.log(JSON.stringify({type: 'warning', message: 'Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.'}));
  if (model === 'fixture-fatal') console.log(JSON.stringify({type: 'error', message: 'Unknown fatal diagnostic'}));
  for (const event of [
    {type: 'item.completed', item: {id: 'read', type: 'command_execution', command: 'cat README.md package.json', status: 'completed', exit_code: 0}},
    {type: 'item.completed', item: {type: 'agent_message', text: 'Applications and packages\n\nArchitecture\n\nTechnology stack\n\nInvariants\n\nFixture package (package.json, README.md).'}},
    {type: 'item.completed', item: {type: 'agent_message'}},
    {type: 'turn.completed', usage: {input_tokens: 100, cached_input_tokens: 40, output_tokens: 20}},
  ]) console.log(JSON.stringify(event));
}
