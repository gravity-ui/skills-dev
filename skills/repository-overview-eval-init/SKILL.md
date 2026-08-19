---
name: repository-overview-eval-init
description: Use when initializing or installing the portable repository-overview eval in a Gravity UI repository. Copies the bundled benchmark into .agents/evals/repository-overview and configures its nested artifact ignore rule. Triggers on "init repository overview eval", "install the repository-overview benchmark", "copy the eval into this repo", "инициализируй repository-overview eval", "добавь эвал обзора репозитория", "скопируй эвал в новый репозиторий".
---

# Initializing the repository overview eval

The eval is bundled with this skill so a repository gets a complete, versioned copy without
depending on the plugin installation path at runtime. Initialization is intentionally one-way:
never overwrite an existing eval, because repositories may add local assertions to `scenario.json`.

## Preflight

1. Resolve the repository root with `git rev-parse --show-toplevel`. Stop if the working directory
   is not inside a Git repository.
2. Confirm that an `origin` or `upstream` remote belongs to `github.com/gravity-ui/*`. Personal
   forks are in scope when their `upstream` remote points to Gravity UI. If neither remote does,
   explain that this skill is limited to repositories developed under Gravity UI and make no
   changes.
3. Resolve `assets/repository-overview` relative to this `SKILL.md`; do not hardcode the plugin's
   installation path.
4. Check `<repo-root>/.agents/evals/repository-overview`. If any file, directory, or symlink already
   exists there, stop without changing it and report that initialization was skipped. Do not merge,
   delete, or update an existing installation.
5. Check the legacy path `<repo-root>/evals/repository-overview`. If any file, directory, or symlink
   exists there, stop before creating `.agents`, explain that automatic migration could overwrite
   repository-specific assertions, and ask the user to migrate it as a separate task.

## Initialize

1. Create `<repo-root>/.agents/evals/` if needed, including `.agents`, then recursively copy the
   bundled `assets/repository-overview` directory to
   `<repo-root>/.agents/evals/repository-overview`. Preserve file contents and relative paths; do
   not copy `SKILL.md` or any previous `.eval-artifacts`.
2. Inspect the repository-root `.gitignore`. If a repository-owned rule already ignores
   `.agents/evals/repository-overview/.eval-artifacts`, leave it unchanged. Otherwise add this exact
   entry, preserving the file's existing content and newline style:

   ```gitignore
   /.agents/evals/repository-overview/.eval-artifacts/
   ```

3. Run `node .agents/evals/repository-overview/run.mjs --help` from the repository root. This
   validates the installed entry point without starting an agent session or creating benchmark
   artifacts.
4. Show `git status --short` and report the installed path, the `.gitignore` outcome, and whether
   the validation succeeded. Do not run the eval itself unless the user separately asks for it.

If Node.js is missing or older than version 20, keep the copied files, explain the requirement, and
report validation as pending rather than attempting to install or upgrade Node.

## After initialization

The user can ask an agent to run `.agents/evals/repository-overview/EVAL.md`, or invoke the runner
directly:

```bash
node .agents/evals/repository-overview/run.mjs --host <codex|claude|opencode> --repo .
```

Repository-specific assertions are deliberately not generated during initialization. The generic
`scenario.json` is the reproducible starting point; customize it later as a separate task.
