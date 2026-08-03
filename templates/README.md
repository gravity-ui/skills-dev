# `AGENTS.md` template

[`AGENTS.md`](./AGENTS.md) is the starting point for the agent instructions file of a Gravity
UI repository. It has two parts with deliberately different owners.

**Everything outside the markers belongs to the repository.** It arrives by copying this
template once and is then edited freely — conventions genuinely differ across the ecosystem
(`page-constructor` keeps five release branches alive, `uikit` runs visual tests in Docker,
`i18n` and `dashkit` have no `CONTRIBUTING.md`), and those local adjustments must survive.
The trade-off is that later edits to this template do **not** propagate. Only put things here
that are stable for years.

**The block between the markers belongs to `skills-dev`.**

```markdown
<!-- BEGIN:gravity-ui-dev-skills -->
...
<!-- END:gravity-ui-dev-skills -->
```

It is a pointer — which skill to invoke when — not a place for rules. Rules live in the
skills, where they can be long and are updated with a single pull request to this repository.
The block is short because it sits in the agent's context on every request, and it changes
only when a skill is added or removed.

It exists because skill auto-activation is unreliable — around 50% in public evals, as
[`gravity-ui/skills`](https://github.com/gravity-ui/skills) notes in its own README. An
`AGENTS.md` is read unconditionally, so a pointer there is what makes the skills actually
fire.

## Adopting it in a repository

**No `AGENTS.md` yet** — copy this template to the repository root, fill in every `TODO`,
delete the sections that do not apply. The block comes along with it.

**An agent instructions file already exists** — `uikit`, `charts`, `page-constructor`,
`markdown-editor`, `blog-constructor`, `create`, and `navigation` — do not overwrite it. Copy
only the block, markers included, and append it at the end.

Check the filename before assuming: `navigation` spells it lowercase `agents.md`. Adding an
uppercase `AGENTS.md` beside it gives that repository two competing instruction files on
Linux, and a case collision on macOS and Windows checkouts. Match whatever is already there.

Either way, this is a normal pull request to that repository and follows the usual rules:

```
docs: add AGENTS.md
docs: add gravity-ui dev skills block to AGENTS.md
```

## Rules for the block

- **Do not rename or reformat the markers.** They are how the block is located; a changed
  marker silently drops the repository out of every future rollout.
- **Do not edit the text inside the block locally.** The next rollout overwrites it. If
  something in it is wrong for your repository, fix it here instead — or put your exception
  outside the block, where it is safe.
- **Do not add a second block.** One per file; the rollout replaces the first match.

## Changing the block

Edit it in [`AGENTS.md`](./AGENTS.md) here — this file is the single source of truth, which
is why no separate copy of the block is kept. Then roll it out: for each repository, replace
everything between `BEGIN:gravity-ui-dev-skills` and `END:gravity-ui-dev-skills` with the new
text and open a pull request. Repositories whose `AGENTS.md` has no such block are the ones
that have not adopted it yet — that is the adoption list, not an error.

There is no rollout script yet. Write one once there is enough to roll out — until then the
edit is a handful of small pull requests, and the marker convention is what makes automating
it later a mechanical job. When that script is written, marker validation belongs in it, run
against the target repositories: that is where markers actually get lost, by teams who never
read this file.
