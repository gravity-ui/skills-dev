---
name: repository-overview-eval-init
description: Use when installing, updating, or migrating the portable repository-overview eval in a Gravity UI repository, or adding custom scenarios and retained reports. Triggers on "init repository overview eval", "copy the eval into this repo", "migrate repository-overview", "update the repository-overview benchmark", "add an eval scenario", "инициализируй эвал", "скопируй эвал в новый репозиторий", "мигрируй старый эвал repository-overview", "обнови repository-overview", "добавь сценарий эвала". Preserves repository-owned scenarios and report history.
---

# Repository overview eval installation and updates

The bundled eval is dependency-free (Node.js 20+) and independent of the plugin path after
installation. Use the deterministic installer; do not recursively overwrite an existing copy.

## Install or update

1. Resolve `scripts/install.mjs` relative to this skill. Run:

   ```bash
   node <skill-dir>/scripts/install.mjs --repo <repository-root> --dry-run
   node <skill-dir>/scripts/install.mjs --repo <repository-root>
   ```

   For an existing installation, use `--update` on both commands. The installer checks the Git
   root and Gravity UI origin/upstream remote, refuses symlinks, and checks all conflicts before
   writing. An old `evals/repository-overview` directory requires separate migration.
2. If a managed file conflicts, inspect the local and bundled versions and preserve the local
   intent when reconciling. Do not force-copy the directory or remove repository scenarios.
   `upstream.json` records the source release and managed file hashes. Unknown files, reports,
   and custom scenarios are never silently overwritten. Review `obsoleteFiles`: unchanged dropped
   upstream files are deleted; modified ones are preserved and require manual review. Retire stale
   runbooks after preserving useful local content in the current README.
3. Run these checks from the repository root:

   ```bash
   node .agents/evals/repository-overview/run.mjs --help
   node --test .agents/evals/repository-overview/tests/*.test.mjs
   git status --short
   ```

4. Report the installed version, changed/obsolete files, scenario migration, ignore-rule checks and test
   outcome. The installer keeps `.eval-artifacts/` ignored and verifies that core files, custom
   scenarios, and `reports/` remain visible to Git, including under broad `.agents/` ignore rules.
   Treat a failed visibility check as unfinished integration and show the offending rule.

Installation/update alone does not authorize live model runs. If Node.js is unavailable or older
than 20, report the prerequisite; do not install it automatically.

## Repository scenarios and evidence

Read [README.md](assets/repository-overview/README.md) for the complete scenario contract, assertion
catalog, examples, interpretation limits, and update ownership rules. Follow its
[Conduct an experiment](assets/repository-overview/README.md#conduct-an-experiment) section when
running an authorized experiment.

- Keep `scenarios/default.json` upstream-owned. Add files under `scenarios/repository/` and commit
  them. Start from `examples/overview.json` and `examples/focused-task.json`, replacing all
  placeholders with repository facts and source paths. Do not claim factual quality from headings.
- Updates from the old layout preserve `scenario.json` and create a schema-compatible
  `scenarios/repository/legacy.json` with a distinct `<old-id>-legacy` ID and incremented version.
  Both 1.1.0 and 1.1.1 core hashes are recognized. Use the migrated file explicitly.
- Link the eval from contributor/navigation documentation and expose native test/run aliases if
  the repository uses a task runner. Include vendored files in the repository's lint/format checks;
  do not ignore `.agents/` wholesale. CI runs fixtures only, never live benchmarks.
- Keep JSON and Markdown in `reports/` committed with benchmark claims. They remain usable for
  comparison after raw logs are removed. Review the small reports before committing; the runner
  never commits or publishes automatically.
- Collect a new baseline after changing a scenario or measurement contract. Report overview and
  focused-task results separately before making a net-win claim.
