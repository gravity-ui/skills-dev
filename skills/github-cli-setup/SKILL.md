---
name: github-cli-setup
description: Use before running `gh` for the first time in a session, and whenever a `gh` command fails on installation, authentication, or permissions. Checks that the GitHub CLI is present, logged in, and carries the token scopes the command needs, then explains how to fix each case — including why the agent must never run the interactive `gh auth login` itself. Triggers on "gh: command not found", "gh auth", "not logged into any GitHub hosts", "HTTP 404" from gh on a repository that exists, "настрой gh", "поставь gh", "залогинься в gh", "gh не работает".
---

# Setting up the GitHub CLI (`gh`)

Everything done against GitHub from a terminal — pull requests, reviews, issues, checks,
releases, workflow runs, gists — goes through `gh`, and every one of those fails the same
three ways: not installed, not authenticated, or authenticated without the scope the command
needs. Check that up front rather than diagnosing it halfway through a task.

## Preflight

```bash
gh --version && gh api user --jq .login
```

Both succeed → you are ready; skip the rest of this skill. Otherwise fix whichever step
failed.

Use `gh api user`, not `gh auth status`, as the authentication probe. `gh auth status` exits
**0** when `GH_TOKEN` is set to an invalid or expired value — it prints *"The token in
GH_TOKEN is invalid"* and still succeeds — so a preflight built on its exit code waves broken
credentials through. `gh api user` actually calls the API and exits 1. Keep `gh auth status`
for diagnosis, where its output is what you want.

Run this **once per session**, not before every `gh` invocation — nothing about the answer
changes between two commands a minute apart, and re-checking each time is pure noise.

## 1. `gh` is not installed

Symptom: `gh: command not found`.

Do not install it silently. Installing a package changes the user's machine and usually needs
`sudo`, so **show the command and let the user run it**, or ask for confirmation first.

| Platform | Command |
|----------|---------|
| macOS | `brew install gh` |
| Debian / Ubuntu | `sudo apt install gh` |
| Fedora / RHEL | `sudo dnf install gh` |
| Arch | `sudo pacman -S github-cli` |
| Windows | `winget install --id GitHub.cli` |

Official instructions, including the apt repository needed on older distributions where `gh`
is not packaged: <https://cli.github.com/> and
<https://github.com/cli/cli#installation>.

## 2. `gh` is installed but not authenticated

Two symptoms, and they need different fixes:

- **Not logged in at all** — `gh auth status` exits non-zero: *"You are not logged into any
  GitHub hosts"*. Pick one of the options below.
- **Logged in with a broken token** — `gh api user` fails with *"Bad credentials"* while
  `gh auth status` reports *"The token in GH_TOKEN is invalid"* and still exits 0. The token
  is expired or revoked; it must be replaced, not re-logged-in.

> **Never run `gh auth login` yourself.** It is interactive: it prompts for the protocol,
> opens a browser, and waits for a one-time code on a TTY. Started from an agent it hangs
> until it is killed, and the user sees nothing.

Offer the user these options and let them pick:

**a. Browser login (recommended).** Ask the user to run this in *their own* terminal, then
tell you when it is done:

```bash
gh auth login
```

**b. Token in the environment.** Works without any interactive step — `gh` picks it up
automatically:

```bash
export GH_TOKEN="<personal access token>"
```

**c. Token from a file**, for a persistent non-interactive setup:

```bash
gh auth login --with-token < /path/to/token.txt
```

**Never ask the user to paste a token into the chat, and never echo one** into a command
line, a log, or a file the repository tracks — terminal history and transcripts persist.
Point them at <https://github.com/settings/tokens> to create one instead.

## 3. Authenticated, but a command still fails

Almost always a missing token scope. `gh auth status` prints the scopes the token carries:

- **`repo`** — read and write repositories, including issues, pull requests, releases and
  check runs. The baseline for almost everything.
- **`workflow`** — required to push a branch that adds or edits anything under
  `.github/workflows/`. Without it the *push* is rejected, which reads as a confusing git
  error rather than an auth one.
- **`read:org`** — resolve organisation teams and membership, e.g. codeowner teams.

Adding a scope depends on how the user authenticated:

- **Browser login** — `gh auth refresh -s workflow` adds it without a full re-login. But this
  command **opens a browser and waits**, exactly like `gh auth login`, so the same rule
  applies: ask the user to run it in their own terminal, never run it yourself.
- **Token login** (`GH_TOKEN` or `--with-token`) — `gh auth refresh` does not work at all
  here; it fails with *"--hostname required when not running interactively"*. Scopes are
  fixed at token creation, so the user has to create a new token at
  <https://github.com/settings/tokens> with the scope ticked, and replace the old one.

Two more cases worth recognising:

- **Multiple accounts** (personal + work): `gh auth status` lists all of them and marks the
  active one; `gh auth switch` changes it. A command hitting the wrong account fails with a
  404 on a repository that plainly exists.
- **SAML SSO organisations**: the token must additionally be authorised for the organisation
  from the token settings page, or every request 404s the same way.

## Confirm you are where you think you are

Before acting on a repository, check that `gh` resolved the one you mean:

```bash
gh repo view --json nameWithOwner,defaultBranchRef
```

This catches a wrong working directory, a fork you cloned instead of the upstream, and a
default branch that is not `main`.
