# Project Rules

## Scope

This repo holds skills for **developing inside the Gravity UI repositories** — conventions,
checks, and workflows a contributor or maintainer needs while working on `gravity-ui/*`
itself. It is not the place for skills about *consuming* the design system in an application:
those live in [gravity-ui/skills](https://github.com/gravity-ui/skills).

A skill belongs here if it applies across several Gravity UI repositories. Something true only
of one repository generally belongs in that repository's own `AGENTS.md`.

## Layout

Canonical skills live in `skills/<name>/` (Agent Skills standard: `SKILL.md` plus optional
`scripts/` and `references/`). The repo is a single plugin for both Claude Code
(`.claude-plugin/plugin.json`) and Codex (`.codex-plugin/plugin.json`); `.claude/skills`,
`.agents/skills`, and `.opencode/skills` are committed symlinks to `skills/` so agents
discover skills from a working copy.

Skills may include executable scripts. CI syntax-checks every `skills/**/*.mjs` file with
`node --check`; when adding another script type, add its corresponding syntax check as well
(for example, `bash -n` for shell scripts).

## The AGENTS.md template

`templates/AGENTS.md` is the starting point for the agent instructions file of a Gravity UI
repository. It carries a marker-delimited block (`BEGIN:gravity-ui-dev-skills` …
`END:gravity-ui-dev-skills`) that points at the skills in this plugin and is maintained
centrally — everything outside the markers is copied once and then owned by the repository.
That template is the single source of truth for the block; no separate copy is kept. Read
`templates/README.md` before editing it.

## Writing a skill

- Folder name and frontmatter `name` must match, and both must be kebab-case.
- `description` is what the agent matches on to decide whether to load the skill — say *when*
  to use it and include the concrete trigger words (package names, file paths, commands,
  phrasings in both English and Russian where users mix them).
- Keep `SKILL.md` itself short; push long material into `references/*.md` and link to it, so
  the agent only pays for what it needs.
- Prefer statements an agent can verify in the repository over prose it has to trust.
- Documentation is written in English.

## Version Bump

For every PR, bump the version according to SemVer in all three manifests, keeping them
identical (CI enforces this):

- `package.json`
- `.claude-plugin/plugin.json`
- `.codex-plugin/plugin.json`

This does not need to happen on every commit within the branch:

- Patch for backwards-compatible fixes and documentation-only changes.
- Minor for backwards-compatible new functionality.
- Major for breaking changes.

This is required so Claude Code and Codex pick up marketplace cache updates.

## Validation

Run `node scripts/validate_skills.mjs` before pushing — it checks SKILL.md frontmatter and
naming, Claude and Codex plugin/marketplace pairing (entry names and source paths), Codex
interface metadata, and version sync across the manifests.
