---
name: gravity-ui-pr-create
description: Use when opening a new pull request in a Gravity UI repository (github.com/gravity-ui/*), or when deciding the Conventional Commits type, scope or breaking-change syntax for a change there. Creating only — not for reviewing an existing pull request. Triggers on "create a PR", "open a pull request", "what should the PR title be", "feat or fix", "conventional commit type", "will this be released", "changelog entry", "breaking change", "сделай пр", "открой пул реквест", "название пул реквеста", "какой тип коммита", "попадёт ли в релиз".
---

# Opening a pull request in a Gravity UI repository

Applies to repositories under <https://github.com/gravity-ui>. They share one release
toolchain (Conventional Commits → `gravity-ui/release-action` → release-please → npm), so the
title rules below hold across the ecosystem.

If the repository has an `AGENTS.md` (`navigation` spells it lowercase `agents.md`), a
`CONTRIBUTING.md` / `CONTRIBUTING`, or a `contribute/` directory, read it — where it
disagrees with this skill, **the repository wins**, and say so to the user.

**Prerequisite:** `gh` must be installed and authenticated. Run the preflight from the
`github-cli-setup` skill before anything else.

## 1. Title

```
<type>(<scope>): <subject>
```

- **type** — one of the types defined by
  [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification):
  `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
  `revert`.
- **scope** — optional, but the convention is the **component name** in `PascalCase` for
  component repositories (`Button`, `TextInput`, `Select`), or the affected area otherwise
  (`i18n`, `styles`, `deps`).
- **subject** — imperative mood, lower case, no trailing period. Keep the whole header under
  100 characters.

```
fix(TextInput): fix clear button styles
feat(Button): add loading property
docs(Select): improve styling section description
```

Only three types release anything: **`feat`**, **`fix`** and **`perf`**. Every other type is
valid and merges fine, but produces no release. So choose the type by what the change does to
users, not by what feels tidy — a user-visible fix filed as `chore` fails *silently*, with a
green CI and a merged PR that never reaches anyone.

### Give the last commit the same message as the title

Pull requests are squash-merged: the branch collapses into one commit on the base branch, and
**that commit's message** — not the pull request title as such — is what release-please
parses. Which text ends up in it depends on a per-repository setting:

| `squash_merge_commit_title` | Squash message comes from |
|---|---|
| `PR_TITLE` | the pull request title, always |
| `COMMIT_OR_PR_TITLE` | the **commit message** when the branch has exactly one commit; the title otherwise |

Most Gravity UI repositories are `COMMIT_OR_PR_TITLE` — `page-constructor`, `dashkit`,
`i18n`, `navigation` and `table` among them — while `uikit`, `charts` and `markdown-editor`
are `PR_TITLE`. So a one-commit branch committed as `wip` in `page-constructor` puts `wip` on
the base branch however well the pull request is titled, and the change ships nothing.

Do not branch on the setting — make it irrelevant:

```bash
git commit --amend -m "fix(TextInput): fix clear button styles"
```

To check the setting anyway:
`gh api repos/gravity-ui/<repo> --jq .squash_merge_commit_title`

Every commit in the branch must be a valid Conventional Commit for the same reason, and most
repositories enforce it with a husky `commit-msg` hook running `npx commitlint -e` — so
`git commit -m "wip"` is rejected outright. Never bypass it with `--no-verify`: that hook is
what keeps a malformed message out of the squash.

### Breaking changes

Put `!` before the colon. **This is what drives the major bump**, and it reaches the squash
commit through the title in every repository:

```
feat(Button)!: remove deprecated view values
```

The `BREAKING CHANGE:` footer belongs in the **commit body**. No Gravity UI repository copies
the pull request description into the squash commit — the body is either blank (`uikit`,
`charts`, `icons`, `markdown-editor`) or assembled from the branch's commit messages
(`page-constructor`, `dashkit`, `i18n`, `navigation`, `table`, `graph`). A footer written only
in the pull request description never reaches the changelog:

```bash
git commit --amend -m 'feat(Button)!: remove deprecated view values' \
  -m 'BREAKING CHANGE: view="action" is removed, use view="normal" with selected.'
```

Describe it in the pull request description as well — that is what the reviewer reads.

## 2. Description

**Look for a template first.** Check `.github/pull_request_template.md`,
`.github/PULL_REQUEST_TEMPLATE.md`, `docs/pull_request_template.md`, and any file under
`.github/PULL_REQUEST_TEMPLATE/`. If one exists, fill it in and ignore the structure below.
No public Gravity UI repository ships one today, but forks and new repositories may.

Otherwise write the description from this structure. **Include only the sections that
apply** — delete a heading entirely rather than leaving it empty or filling it with "N/A".

```markdown
## Description

What is wrong or missing, from the user's point of view. Two or three sentences.
Do not restate the diff — the reviewer can read it.

## Related issue

Closes #123

## Reproduction

<link to a reproduction, or the steps that trigger the bug>

## Breaking change

What breaks, and what to do instead.
```

| Section | When to include it |
|---------|--------------------|
| Description | Always. |
| Related issue | When an issue exists. `Closes #123` links it and closes it on merge. |
| Reproduction | Bug fixes only — skip it for features. A link to a running reproduction (preview build, Storybook, CodeSandbox) is worth more than prose; steps are the fallback. |
| Breaking change | Only when the title carries `!`. Mirrors the commit footer for the reviewer's benefit — the changelog is fed by the commit, not by this text. Name the removed API and its replacement explicitly. |

Do not add a test plan or a list of checks you ran; CI reports that.

### CLA for first-time contributors

Contributors outside Yandex accept the CLA once, on their **first** pull request to the
organisation. Determine whether this is one instead of asking:

```bash
gh search prs --owner gravity-ui --author @me --limit 1 --json number --jq 'length'
```

`0` — no pull request in the organisation yet, so add the CLA line to the description.
Anything else — the CLA has already been accepted; skip this step silently, without
mentioning it to the user.

Take the wording and the link from that repository's own contributing file rather than from
memory: the URL differs between repositories (`yandex.ru/legal/cla/?lang=en` in most,
`yandex.ru/legal/cla/en/` in `aikit` and `timeline`). The file is usually `CONTRIBUTING.md`,
but `dashkit` and `i18n` name it `CONTRIBUTING`, with no extension.

## 3. Show it, then create it

Assemble the title and the body, and **show them to the user as markdown before anything is
posted.** A pull request is public the moment it exists, and its title is what gets released —
both are far cheaper to fix before the fact than after:

````markdown
fix(TextInput): fix clear button styles

---

## Description

The clear button overlaps the text when the input is `size="s"`, so the last character
is unreachable.

## Related issue

Closes #2758
````

Wait for the user to confirm or amend it. Then push the branch — `gh pr create` can push for
you, but only by prompting, which fails in a non-interactive session.

Where you push depends on whether the user can write to the repository. Check first, because
an external contributor — exactly the person the CLA step above is written for — has no write
access and the push will 403:

```bash
gh repo view --json viewerPermission --jq .viewerPermission
```

`WRITE` or `ADMIN`:

```bash
git push -u origin HEAD
gh pr create --title "fix(TextInput): fix clear button styles" --body-file /tmp/pr-body.md
```

Anything else — work through a fork:

```bash
gh repo fork --remote --remote-name fork
git push -u fork HEAD
gh pr create --repo gravity-ui/<repo> --head "$(gh api user --jq .login):$(git branch --show-current)" \
  --title "fix(TextInput): fix clear button styles" --body-file /tmp/pr-body.md
```

Add `--base <branch>` when the change targets a maintained older major rather than the
default branch — several repositories keep those alive (`page-constructor` has
`version-1.x.x/fixes` through `version-5.x.x`, `navigation` has `3.x` through `v7`,
`dashkit` has `release/v10`). List them with
`gh api repos/gravity-ui/<repo>/branches --jq '.[].name'`.

**Use `--body-file`, never `--body`.** A multi-line markdown body handed to `--body` goes
through the shell, where backticks execute, `$` expands, and quotes inside the text terminate
the argument — the body arrives mangled or the command fails outright.

Add `--draft` when the work is not ready for review.
