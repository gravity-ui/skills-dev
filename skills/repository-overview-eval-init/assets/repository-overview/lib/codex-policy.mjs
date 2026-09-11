import {spawn} from 'node:child_process';
import {digest} from './contracts.mjs';

export const requested = {approval_policy: 'on-request', sandbox_mode: 'read-only', web_search: 'disabled'};
export const configArgs = ({model, effort} = {}) => Object.entries({...requested,
  ...(model ? {model} : {}), ...(effort ? {model_reasoning_effort: effort} : {}),
}).flatMap(([key, value]) => ['--config', `${key}=${JSON.stringify(value)}`]);
export function configurationFingerprint({config, layers}) {
  if (!config || !Array.isArray(layers) || !layers.length || layers.some((layer) => typeof layer.version !== 'string' || !layer.version || typeof layer.name?.type !== 'string')) {
    throw new Error('Codex configuration layers could not be fingerprinted; no model attempt started');
  }
  const pick = (keys) => Object.fromEntries(keys.map((key) => [key, config[key] ?? null]));
  return {
    modelDigest: digest(pick(['model', 'model_provider', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity', 'model_context_window', 'model_auto_compact_token_limit', 'review_model', 'service_tier'])),
    instructionsDigest: digest(pick(['instructions', 'developer_instructions', 'model_instructions_file', 'compact_prompt'])),
    // Opaque host-provided versions cover all config, including MCP definitions. Do not read
    // layer.config or MCP credentials, endpoints, arguments, or environment values.
    layersDigest: digest(layers.map((layer) => ({type: layer.name.type, version: layer.version, disabled: Boolean(layer.disabledReason)}))),
  };
}
export function verifyPolicy(config, requirements) {
  const effective = Object.fromEntries(Object.keys(requested).map((key) => [key, config?.[key] ?? null]));
  const allowedFields = {approval_policy: 'allowedApprovalPolicies', sandbox_mode: 'allowedSandboxModes', web_search: 'allowedWebSearchModes'};
  for (const [key, value] of Object.entries(requested)) {
    if (effective[key] !== value) throw new Error(`Codex policy ${key}: requested ${value}, effective ${JSON.stringify(effective[key])}`);
    const allowed = requirements?.[allowedFields[key]];
    if (allowed != null && (!Array.isArray(allowed) || !allowed.includes(value))) throw new Error(`Codex managed policy ${key}: requested ${value}, allowed ${JSON.stringify(allowed)}`);
  }
  return {requested, effective, verification: 'config/read + configRequirements/read'};
}

// No thread or turn is created. Persist policies and fingerprints, never raw configuration.
export async function preflight({repo, model, effort, executable = 'codex', timeoutMs = 15000}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...configArgs({model, effort}), 'app-server', '--listen', 'stdio://'], {cwd: repo, stdio: ['pipe', 'pipe', 'pipe']});
    let buffer = '';
    let config;
    let done = false;
    const timer = setTimeout(() => finish(new Error('Codex policy preflight timed out; no model attempt started')), timeoutMs);
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(value);
    }
    function send(id, method, params) { child.stdin.write(`${JSON.stringify({id, method, params})}\n`); }
    child.stdin.on('error', () => finish(new Error('Codex policy preflight pipe closed')));
    child.on('error', () => finish(new Error('Cannot start Codex policy preflight')));
    child.on('close', () => finish(new Error('Codex policy preflight exited before settings could be verified')));
    child.stderr.on('data', () => {}); // Never emit host configuration or unreviewed diagnostics.
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.error) throw new Error(`Codex policy RPC ${message.id} failed (code ${message.error.code}); no model attempt started`);
          if (message.id === 1) {
            child.stdin.write(`${JSON.stringify({method: 'initialized'})}\n`);
            send(2, 'config/read', {cwd: repo, includeLayers: true});
          } else if (message.id === 2) {
            config = message.result;
            send(3, 'configRequirements/read', {});
          } else if (message.id === 3) {
            if (!message.result || !Object.hasOwn(message.result, 'requirements')) throw new Error('Codex managed requirements could not be verified');
            finish(null, {...verifyPolicy(config?.config, message.result.requirements), configuration: configurationFingerprint(config ?? {})});
          }
        } catch (error) { finish(error); }
      }
    });
    send(1, 'initialize', {clientInfo: {name: 'repository-overview-eval', version: '5'}, capabilities: {experimentalApi: true}});
  });
}
