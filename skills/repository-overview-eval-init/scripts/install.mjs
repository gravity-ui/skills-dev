#!/usr/bin/env node
import {existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {canonicalPath} from '../assets/repository-overview/lib/repository.mjs';
import {effectiveScenario} from '../assets/repository-overview/lib/contracts.mjs';
import {parseArgs, readJson} from '../assets/repository-overview/lib/shared.mjs';

const bundle = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/repository-overview');
const targetPath = '.agents/evals/repository-overview';
const hash = (data) => createHash('sha256').update(data).digest('hex');
function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], {encoding: 'utf8'});
  if (r.status !== 0) throw new Error(`git ${args[0]} failed`);
  return r.stdout.trim();
}
function safe(root, path) {
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => ['..', '.', ''].includes(part))) throw new Error(`Unsafe managed path: ${path}`);
  const file = resolve(root, path);
  let current = file;
  while (current !== root) {
    if (existsSync(current) || (() => { try { return lstatSync(current).isSymbolicLink(); } catch { return false; } })()) {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${current}`);
    }
    current = dirname(current);
  }
  return file;
}
export function install({repo, update = false, dryRun = false, source = bundle}) {
  repo = git(resolve(repo), ['rev-parse', '--show-toplevel']);
  const remotes = git(repo, ['remote', '-v']);
  if (!/^(?:origin|upstream)\s+(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)gravity-ui\/[^\s]+/mu.test(remotes)) throw new Error('Expected a Gravity UI origin or upstream remote');
  const destination = safe(repo, targetPath);
  const legacyDir = safe(repo, 'evals/repository-overview');
  if (existsSync(legacyDir)) throw new Error('Legacy evals/repository-overview exists; migrate that directory separately before installation');
  if (existsSync(destination) && !update) throw new Error('Eval already exists; use --update to preserve repository scenarios and refresh managed files');
  const upstream = readJson(resolve(source, 'upstream.json'));
  const statePath = safe(repo, `${targetPath}/upstream.json`);
  const legacy = readJson(resolve(dirname(fileURLToPath(import.meta.url)), '../references/legacy-files.json'));
  const previous = existsSync(statePath) ? readJson(statePath) : existsSync(destination) ? legacy : {files: {}};
  const writes = [];
  const conflicts = [];
  for (const [path, expected] of Object.entries(upstream.files)) {
    if (/^(?:scenarios\/repository|reports|\.eval-artifacts)(?:\/|$)/u.test(path)) throw new Error(`Upstream must not own ${path}`);
    const to = safe(repo, `${targetPath}/${path}`);
    const content = readFileSync(safe(source, path));
    if (hash(content) !== expected) throw new Error(`Bundle manifest is stale: ${path}`);
    if (existsSync(to) && hash(readFileSync(to)) !== expected && hash(readFileSync(to)) !== previous.files[path]) conflicts.push(path);
    else if (!existsSync(to) || hash(readFileSync(to)) !== expected) writes.push([to, content]);
  }
  // Preserve the original file; migrate a separate scenario to the new explicit contract.
  const oldScenario = safe(repo, `${targetPath}/scenario.json`);
  if (existsSync(oldScenario) && !existsSync(statePath)) {
    const to = safe(repo, `${targetPath}/scenarios/repository/legacy.json`);
    const scenario = readJson(oldScenario);
    scenario.version += 1;
    for (const assertion of scenario.assertions) {
      assertion.group ??= assertion.type.startsWith('answer-') ? 'quality' : 'route';
      if (assertion.type === 'answer-existing-paths') { assertion.group = 'structural'; assertion.minimum ??= 1; }
      if (['answer-applications', 'answer-architecture', 'answer-stack', 'answer-invariants'].includes(assertion.id)) assertion.group = 'structural';
    }
    const content = Buffer.from(`${JSON.stringify(effectiveScenario(scenario), null, 2)}\n`);
    if (existsSync(to) && !readFileSync(to).equals(content)) conflicts.push('scenarios/repository/legacy.json');
    else if (!existsSync(to)) writes.push([to, content]);
  }
  if (conflicts.length) throw new Error(`Local managed-file conflicts; no files changed: ${conflicts.join(', ')}. Review and reconcile against the bundled version, then retry.`);
  const ignorePath = safe(repo, '.gitignore');
  const oldIgnore = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : '';
  const eol = oldIgnore.includes('\r\n') ? '\r\n' : '\n';
  const begin = '# BEGIN repository-overview-eval';
  const end = '# END repository-overview-eval';
  const lines = [];
  for (const parent of ['.agents', '.agents/evals']) {
    const ignored = spawnSync('git', ['-C', repo, 'check-ignore', '--no-index', '-q', `${parent}/`]).status === 0;
    if (ignored) lines.push(`/${parent}/*`);
    lines.push(`!/${parent}/`);
  }
  lines.push(`!/${targetPath}/`, `!/${targetPath}/**`, `/${targetPath}/.eval-artifacts/`);
  const block = [begin, ...lines, end].join(eol);
  // Preserve earlier parent restrictions on repeated updates.
  const start = oldIgnore.indexOf(begin);
  const stop = oldIgnore.indexOf(end);
  let newIgnore;
  if (start >= 0 && stop >= start) {
    const oldBlock = oldIgnore.slice(start, stop + end.length);
    const keep = oldBlock.split(/\r?\n/u).filter((line) => /^\/\.agents(?:\/evals)?\/\*$/u.test(line));
    const ordered = lines.filter((line) => !keep.includes(line));
    for (const rule of keep) ordered.splice(ordered.indexOf(`!${rule.slice(0, -1)}`), 0, rule);
    const updated = [begin, ...ordered, end].join(eol);
    newIgnore = oldIgnore.slice(0, start) + updated + oldIgnore.slice(stop + end.length);
  } else newIgnore = oldIgnore + (oldIgnore && !oldIgnore.endsWith('\n') ? eol : '') + block + eol;
  writes.push([statePath, Buffer.from(`${JSON.stringify(upstream, null, 2)}\n`)]);
  if (newIgnore !== oldIgnore) writes.push([ignorePath, Buffer.from(newIgnore)]);
  if (!dryRun) {
    for (const [path, content] of writes) { mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, content); }
    for (const path of ['run.mjs', 'scenarios/repository/example.json', 'reports/runs/example.json', 'reports/runs/example.md', 'reports/comparisons/example.json']) {
      const r = spawnSync('git', ['-C', repo, 'check-ignore', '--no-index', '-q', `${targetPath}/${path}`]);
      if (r.status !== 1) throw new Error(`Installation written, but Git visibility check failed for ${path}; inspect nested/global ignore rules`);
    }
    if (spawnSync('git', ['-C', repo, 'check-ignore', '--no-index', '-q', `${targetPath}/.eval-artifacts/raw.jsonl`]).status !== 0) throw new Error('Raw artifacts are not ignored; inspect nested ignore rules');
  }
  return {mode: dryRun ? 'dry-run' : update ? 'updated' : 'installed', upstreamVersion: upstream.version, files: writes.map(([path]) => relative(repo, path).split(sep).join('/'))};
}
if (process.argv[1] && canonicalPath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2), ['update', 'dry-run']);
    if (options.help) console.log('Usage: node install.mjs --repo <path> [--update] [--dry-run]');
    else console.log(JSON.stringify(install({repo: options.repo ?? process.cwd(), ...options}), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
