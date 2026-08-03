#!/usr/bin/env node
// Validate skills plus the Codex plugin and marketplace manifests.
// Zero dependencies — a deliberately small YAML frontmatter reader handles the few
// keys we care about (name, description). Exits non-zero if any input is invalid.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const skillsDir = join(repoRoot, 'skills');
const triggerEvalsPath = join(repoRoot, 'evals', 'trigger-cases.json');

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;
const DESC_MAX = 1024;

const errors = [];
const warnings = [];

// Parse a leading `---` ... `---` YAML block into a flat object. Supports inline
// scalars (quoted or bare) and block scalars (`>`, `>-`, `|`, `|-`) — enough for
// SKILL.md frontmatter without pulling in a YAML dependency.
// Unwrap an inline YAML scalar: matched surrounding quotes, else a plain value with any
// trailing " # comment" removed. Only strips quotes when both ends match, so a value like
// `he said "hi"` is preserved rather than mangled.
function stripInlineScalar(v) {
  const q = v[0];
  if (v.length >= 2 && (q === '"' || q === "'")) {
    if (v[v.length - 1] === q) {
      return v.slice(1, -1);
    }
    // A quoted scalar may be followed by a comment (`"wiki" # note`): the value ends at the
    // first closing quote when only a comment trails it.
    const end = v.indexOf(q, 1);
    if (end !== -1 && /^\s*#/.test(v.slice(end + 1))) {
      return v.slice(1, end);
    }
  }
  return v.replace(/\s+#.*$/, '').trim();
}

// Frontmatter fences must sit at column 0 — an indented `---` inside a block scalar is
// content, not a fence, and matching it would silently truncate the frontmatter.
const FENCE = /^---\s*$/;

function parseFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!FENCE.test(lines[0])) return null;

  const body = [];
  let closed = false;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      closed = true;
      break;
    }
    body.push(lines[i]);
  }
  if (!closed) return null;

  const out = {};
  const BLOCK = /^[>|][0-9+-]*$/; // >, |, and indent/chomping variants: >-, |2, |4-, …
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!m) continue; // only top-level (column-0) keys; indented lines are folded in below

    const key = m[1];
    const rest = m[2].trim();

    if (rest === '' || BLOCK.test(rest)) {
      // Block scalar (or a nested mapping like `metadata:`): gather the indented lines.
      const literal = rest.startsWith('|');
      const collected = [];
      while (i + 1 < body.length && (body[i + 1].trim() === '' || /^\s/.test(body[i + 1]))) {
        collected.push(body[++i].replace(/^\s+/, ''));
      }
      out[key] = literal ? collected.join('\n').trim() : collected.join(' ').trim();
    } else {
      // Inline scalar. A plain scalar may fold onto following indented lines — gather them too,
      // or a multi-line description is truncated and its length check silently bypassed.
      const cont = [];
      while (i + 1 < body.length && /^\s/.test(body[i + 1]) && body[i + 1].trim() !== '') {
        cont.push(body[++i].trim());
      }
      out[key] = stripInlineScalar(cont.length ? [rest, ...cont].join(' ') : rest);
    }
  }
  return out;
}

function listSkills() {
  let entries;
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    errors.push(`skills/ directory not found at ${skillsDir}`);
    return [];
  }
  // A skill folder may itself be a symlink; isDirectory() is false for those, so follow it.
  return entries
    .filter((e) => e.isDirectory()
      || (e.isSymbolicLink() && statSync(join(skillsDir, e.name), { throwIfNoEntry: false })?.isDirectory()))
    .map((e) => e.name)
    .sort();
}

function validateSkill(name) {
  const dir = join(skillsDir, name);
  const skillPath = join(dir, 'SKILL.md');

  let raw;
  try {
    raw = readFileSync(skillPath, 'utf8');
  } catch {
    errors.push(`${name}: missing SKILL.md`);
    return;
  }

  const fm = parseFrontmatter(raw);
  if (!fm) {
    errors.push(`${name}: SKILL.md has no valid \`---\` frontmatter block`);
    return;
  }

  // name
  if (!fm.name) {
    errors.push(`${name}: frontmatter missing \`name\``);
  } else {
    if (fm.name !== name) {
      errors.push(`${name}: frontmatter name "${fm.name}" must equal the folder name "${name}"`);
    }
    if (!NAME_RE.test(fm.name)) {
      errors.push(`${name}: name "${fm.name}" must be kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$)`);
    }
    if (fm.name.length > NAME_MAX) {
      errors.push(`${name}: name is ${fm.name.length} chars (max ${NAME_MAX})`);
    }
  }

  // description
  if (!fm.description) {
    errors.push(`${name}: frontmatter missing \`description\``);
  } else {
    if (fm.description.length > DESC_MAX) {
      errors.push(`${name}: description is ${fm.description.length} chars (max ${DESC_MAX})`);
    }
    if (!/\b(use|when|for|if)\b/i.test(fm.description)) {
      warnings.push(`${name}: description should say *when* to use the skill (no trigger cue found)`);
    }
  }
}

function validateTriggerEvals(skills) {
  let cases;
  try {
    cases = JSON.parse(readFileSync(triggerEvalsPath, 'utf8'));
  } catch (err) {
    errors.push(`evals/trigger-cases.json: unreadable or invalid JSON (${err.message})`);
    return;
  }

  if (!Array.isArray(cases) || cases.length === 0) {
    errors.push('evals/trigger-cases.json: must contain a non-empty array');
    return;
  }

  const knownSkills = new Set(skills);
  const ids = new Set();
  const positiveCoverage = new Set();
  const negativeCoverage = new Set();

  for (const [index, testCase] of cases.entries()) {
    const label = `evals/trigger-cases.json[${index}]`;
    if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
      errors.push(`${label}: must be an object`);
      continue;
    }
    if (typeof testCase.id !== 'string' || !NAME_RE.test(testCase.id)) {
      errors.push(`${label}: \`id\` must be a kebab-case string`);
    } else if (ids.has(testCase.id)) {
      errors.push(`${label}: duplicate id "${testCase.id}"`);
    } else {
      ids.add(testCase.id);
    }
    if (typeof testCase.prompt !== 'string' || !testCase.prompt.trim()) {
      errors.push(`${label}: \`prompt\` must be a non-empty string`);
    }
    if (!Array.isArray(testCase.expectedSkills)) {
      errors.push(`${label}: \`expectedSkills\` must be an array`);
      continue;
    }

    const expected = new Set();
    for (const skill of testCase.expectedSkills) {
      if (typeof skill !== 'string' || !knownSkills.has(skill)) {
        errors.push(`${label}: unknown skill ${JSON.stringify(skill)}`);
      } else if (expected.has(skill)) {
        errors.push(`${label}: duplicate expected skill "${skill}"`);
      } else {
        expected.add(skill);
        positiveCoverage.add(skill);
      }
    }
    for (const skill of skills) {
      if (!expected.has(skill)) negativeCoverage.add(skill);
    }
  }

  for (const skill of skills) {
    if (!positiveCoverage.has(skill)) {
      errors.push(`evals/trigger-cases.json: no positive trigger case for "${skill}"`);
    }
    if (!negativeCoverage.has(skill)) {
      errors.push(`evals/trigger-cases.json: no negative trigger case for "${skill}"`);
    }
  }
}

// Each manifest is read and parsed once; repeat callers share the result, so a broken
// file is reported exactly once no matter how many checks consult it.
const manifestCache = new Map();

function readJsonManifest(rel) {
  if (manifestCache.has(rel)) return manifestCache.get(rel);
  let parsed = null;
  try {
    const raw = JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      parsed = raw;
    } else {
      // JSON-valid but useless content (null, a number, an array) must not pass silently.
      errors.push(`${rel}: must contain a JSON object (got ${JSON.stringify(raw)})`);
    }
  } catch (err) {
    errors.push(`${rel}: unreadable or invalid JSON (${err.message})`);
  }
  manifestCache.set(rel, parsed);
  return parsed;
}

// The version is declared in three manifests (npm/pi, Claude plugin, Codex plugin);
// marketplace caches key off it, so a mismatch means some agents silently miss updates.
function validateVersions() {
  const manifests = [
    'package.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
  ];
  const versions = {};
  for (const rel of manifests) {
    const manifest = readJsonManifest(rel);
    if (manifest) versions[rel] = manifest.version;
  }
  const distinct = new Set(Object.values(versions));
  if (distinct.size > 1) {
    const detail = Object.entries(versions).map(([f, v]) => `${f}=${v}`).join(', ');
    errors.push(`version mismatch across manifests: ${detail}`);
  }
}

// Claude Code resolves installs by the marketplace entry whose name matches the plugin
// manifest — the same pairing validateCodexMarketplace enforces for the Codex side.
function validateClaudeManifests() {
  const rel = '.claude-plugin/marketplace.json';
  const marketplace = readJsonManifest(rel);
  const plugin = readJsonManifest('.claude-plugin/plugin.json');
  if (!marketplace || !plugin) return;

  if (typeof plugin.name !== 'string' || !plugin.name.trim()) {
    errors.push('.claude-plugin/plugin.json: `name` must be a non-empty string');
    return;
  }
  const entry = Array.isArray(marketplace.plugins)
    ? marketplace.plugins.find((candidate) => candidate?.name === plugin.name)
    : null;
  if (!entry) {
    errors.push(`${rel}: missing marketplace entry for plugin "${plugin.name}"`);
    return;
  }
  if (typeof entry.source !== 'string'
    || !existsSync(join(repoRoot, entry.source, '.claude-plugin', 'plugin.json'))) {
    errors.push(
      `${rel}: plugin "${plugin.name}" \`source\` must point at a directory containing .claude-plugin/plugin.json`,
    );
  }
}

function validateCodexPlugin() {
  const rel = '.codex-plugin/plugin.json';
  const manifest = readJsonManifest(rel);
  if (!manifest) return;

  const requiredStrings = ['name', 'version', 'description'];
  for (const field of requiredStrings) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) {
      errors.push(`${rel}: \`${field}\` must be a non-empty string`);
    }
  }
  if (!manifest.author || typeof manifest.author.name !== 'string' || !manifest.author.name.trim()) {
    errors.push(`${rel}: \`author.name\` must be a non-empty string`);
  }
  if (typeof manifest.skills !== 'string' || !existsSync(join(repoRoot, manifest.skills))) {
    errors.push(`${rel}: \`skills\` must point at an existing directory (got ${JSON.stringify(manifest.skills)})`);
  }

  const ui = manifest.interface;
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) {
    errors.push(`${rel}: \`interface\` must be an object`);
    return;
  }
  for (const field of [
    'displayName',
    'shortDescription',
    'longDescription',
    'developerName',
    'category',
  ]) {
    if (typeof ui[field] !== 'string' || !ui[field].trim()) {
      errors.push(`${rel}: \`interface.${field}\` must be a non-empty string`);
    }
  }
  if (
    !Array.isArray(ui.capabilities)
    || !ui.capabilities.every((value) => typeof value === 'string' && value.trim())
  ) {
    errors.push(`${rel}: \`interface.capabilities\` must be an array of non-empty strings`);
  }

  const prompts = Array.isArray(ui.defaultPrompt) ? ui.defaultPrompt : [ui.defaultPrompt];
  if (
    prompts.length === 0
    || prompts.length > 3
    || !prompts.every((value) => typeof value === 'string' && value.trim() && value.length <= 128)
  ) {
    errors.push(
      `${rel}: \`interface.defaultPrompt\` must contain 1–3 non-empty strings of at most 128 chars`,
    );
  }
}

function validateCodexMarketplace() {
  const rel = '.agents/plugins/marketplace.json';
  const marketplace = readJsonManifest(rel);
  const plugin = readJsonManifest('.codex-plugin/plugin.json');
  if (!marketplace || !plugin) return;

  const entry = Array.isArray(marketplace.plugins)
    ? marketplace.plugins.find((candidate) => candidate?.name === plugin.name)
    : null;
  if (!entry) {
    errors.push(`${rel}: missing marketplace entry for plugin "${plugin.name}"`);
    return;
  }

  const policy = entry.policy;
  const installPolicies = new Set(['NOT_AVAILABLE', 'AVAILABLE', 'INSTALLED_BY_DEFAULT']);
  const authPolicies = new Set(['ON_INSTALL', 'ON_USE']);
  if (!policy || !installPolicies.has(policy.installation)) {
    errors.push(`${rel}: plugin "${plugin.name}" has invalid or missing \`policy.installation\``);
  }
  if (!policy || !authPolicies.has(policy.authentication)) {
    errors.push(`${rel}: plugin "${plugin.name}" has invalid or missing \`policy.authentication\``);
  }
  if (typeof entry.category !== 'string' || !entry.category.trim()) {
    errors.push(`${rel}: plugin "${plugin.name}" must have a non-empty \`category\``);
  }

  const source = entry.source;
  if (!source || typeof source !== 'object') {
    errors.push(`${rel}: plugin "${plugin.name}" must declare a \`source\` object`);
  } else if (source.source === 'local') {
    // Local sources resolve relative to the marketplace repo root and must land on a plugin.
    if (typeof source.path !== 'string'
      || !existsSync(join(repoRoot, source.path, '.codex-plugin', 'plugin.json'))) {
      errors.push(
        `${rel}: plugin "${plugin.name}" \`source.path\` must point at a directory containing .codex-plugin/plugin.json`,
      );
    }
  }
}

const skills = listSkills();
if (skills.length === 0 && errors.length === 0) {
  errors.push('no skills found under skills/');
}
for (const name of skills) validateSkill(name);
validateTriggerEvals(skills);
validateVersions();
validateClaudeManifests();
validateCodexPlugin();
validateCodexMarketplace();

for (const w of warnings) process.stdout.write(`⚠ ${w}\n`);
for (const e of errors) process.stdout.write(`✗ ${e}\n`);

if (errors.length) {
  process.stdout.write(`\n${errors.length} error(s) across ${skills.length} skill(s).\n`);
  process.exit(1);
}
process.stdout.write(
  `✓ ${skills.length} skill(s), trigger evals, and plugin/marketplace manifests valid`
    + `${warnings.length ? `, ${warnings.length} warning(s)` : ''}.\n`,
);
