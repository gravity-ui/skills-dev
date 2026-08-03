# Gravity UI Dev Skills

Agent Skills for **developing inside the [Gravity UI](https://gravity-ui.com) repositories** —
the conventions, checks, and workflows shared across `gravity-ui/*`.

> Looking for skills about *using* Gravity UI in your own application — picking the right
> package, component APIs, theming, icons? Those live in
> [gravity-ui/skills](https://github.com/gravity-ui/skills). This repository is for
> contributors and maintainers working on the libraries themselves.

## Quick start

**Claude Code**:

```
/plugin marketplace add gravity-ui/skills-dev
/plugin install gravity-ui-dev-skills
```

**Codex**:

```bash
codex plugin marketplace add gravity-ui/skills-dev
codex

# Then inside Codex: `/plugins` → marketplace `gravity-ui-dev-marketplace` → `gravity-ui-dev-skills` → Install
# And start a new session
```

The plugin itself needs no tokens or configuration — the skills only need an authenticated
[`gh`](https://cli.github.com/), and one of them exists to set that up. To check it works,
open a Gravity UI repository and ask the agent: "what should the title of this pull request
be?"

## Skills

| Skill | What it does | Example requests |
|-------|--------------|------------------|
| [gravity-ui-pr-create](skills/gravity-ui-pr-create/SKILL.md) | Opening a pull request in `gravity-ui/*`: the Conventional Commits title that becomes the released commit, what to write in the description, the `gh pr create` invocation | "Open a PR for this change", "What should the PR title be?" |
| [github-cli-setup](skills/github-cli-setup/SKILL.md) | Checks that `gh` is installed, logged in, and carries the right token scopes, and fixes each failure. Used before any GitHub work — pull requests, issues, checks, releases | "gh: command not found", "gh isn't logged in", "настрой gh" |

Skills activate automatically from context. The full command list for each skill is in its
`SKILL.md`.

## `AGENTS.md` for a Gravity UI repository

Skill auto-activation is unreliable — around 50% in public evals. A pointer in the
repository's `AGENTS.md`, which agents read unconditionally, is what makes the skills
actually fire.

[`templates/AGENTS.md`](templates/AGENTS.md) is the starting point for that file: shared
conventions to copy and adapt, plus a marker-delimited block pointing at these skills that
stays maintained centrally. See [`templates/README.md`](templates/README.md) for how to adopt
it in a repository that does or does not already have an `AGENTS.md`.

## Other installation methods

### Project-level install (for a team)

To make the skills appear automatically for everyone working in your repository, commit the
plugin configuration to it.

**Claude Code** — run in the project root:

```bash
claude plugin marketplace add gravity-ui/skills-dev --scope project
claude plugin install gravity-ui-dev-skills --scope project
```

These write `extraKnownMarketplaces` and `enabledPlugins` (key
`"gravity-ui-dev-skills@gravity-ui-dev-marketplace"`) into the project's
`.claude/settings.json` — commit it, and Claude Code will offer the plugin to your colleagues
when they first open the project.

**Codex** — commit `.agents/plugins/marketplace.json` to your repository. The marketplace name
must differ from `gravity-ui-dev-marketplace`: Codex does not allow two marketplaces with the
same name, and contributors may already have added that one from the Quick start above.

```json
{
  "name": "myproject-gravity-ui",
  "plugins": [
    {
      "name": "gravity-ui-dev-skills",
      "source": {
        "source": "url",
        "url": "https://github.com/gravity-ui/skills-dev.git",
        "ref": "main"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

Each contributor then runs `codex plugin marketplace add .` in the repository root once and
installs the plugin from `/plugins` — the current Codex CLI does not auto-install from
`policy.installation`.

### npx skills (OpenCode and other agents)

```bash
npx skills add gravity-ui/skills-dev \
  --skill '*' \
  --global \
  --agent opencode \
  --yes
```

### For development (Claude Code)

```bash
git clone https://github.com/gravity-ui/skills-dev.git
claude --plugin-dir ./skills-dev
```

## Updating

Marketplace installs update automatically (Codex:
`codex plugin marketplace upgrade gravity-ui-dev-marketplace`). For clone-based installs
(`--plugin-dir`) — `git pull`.

## Contributing

See [AGENTS.md](./AGENTS.md) for the repository layout, how to write a skill, the version bump
rule, and validation. Trigger eval cases live in
[`evals/trigger-cases.json`](evals/trigger-cases.json): each maps a realistic user prompt to
the skills expected to activate. Include both positive and negative cases when adding a skill.
Run `node scripts/validate_skills.mjs` before pushing.

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
