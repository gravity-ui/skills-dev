# Repository overview eval

A portable, dependency-free Node.js 20+ benchmark for read-only repository investigations. Supports
Codex CLI, Claude Code and OpenCode. Live runs require an authenticated CLI; fixture tests do not.

## Ownership and updates

Install or update using the `repository-overview-eval-init` skill. The source of truth is
`gravity-ui/skills-dev`; `upstream.json` pins the release and hashes of the installed core. Updating
through the skill replaces reviewed upstream files only. Local modifications to managed files
produce conflicts before any write. Reconcile those files and retry; never force-copy the directory.
Unknown files are retained, including obsolete files from older releases.

```text
.agents/evals/repository-overview/
├── run.mjs, compare.mjs, lib/
├── artifact.schema.json, scenario.schema.json, upstream.json
├── scenarios/default.json       # upstream-owned
├── scenarios/repository/        # your committed scenarios, preserved on update
├── examples/                    # upstream-owned templates
├── fixtures/, tests/            # offline tests, included in CI
├── reports/runs/                # committed JSON + Markdown summaries
├── reports/comparisons/         # committed JSON + Markdown comparisons
└── .eval-artifacts/runs/        # ignored raw evidence
```

`scenarios/repository/` and `reports/` are created when needed. Ignore only the raw output:

```gitignore
/.agents/evals/repository-overview/.eval-artifacts/
```

The installer adds narrow exceptions when broader rules would hide the eval, and checks effective
Git visibility. Never ignore `reports/`. A run refuses to start if its report would be ignored;
a comparison also refuses to write an ignored report. Nested ignore rules can require local repair.

From the old `scenario.json` layout, `--update` preserves the original and creates
`scenarios/repository/legacy.json`, moves generic headings/citation checks to structural, and
increments its version. Use the migrated scenario explicitly. Modified legacy core files cause
conflicts; the bundled historical checksums identify the 1.1.1 core. Old result schemas are rejected
with a request to collect a new baseline.

### Use `upstream.json` and update the core

Commit `upstream.json` with the installed core. It records the source repository, release version,
and SHA-256 hashes of upstream-owned files. The installer uses those hashes to detect local edits;
it never updates itself or downloads a newer release. Custom scenarios and reports are not listed
and remain repository-owned. You do not need to edit or regenerate this file in a target repository.

Ask the agent to "Update the repository-overview eval in this repository" to use the installed
skill, or invoke its installer directly. First obtain the desired plugin release or a reviewed
`skills-dev` checkout. In the commands below, `<skill-dir>` is the directory containing the skill's
`SKILL.md` and `scripts/install.mjs`; in a source checkout it is
`<skills-dev-checkout>/skills/repository-overview-eval-init`. The installer is part of the skill,
not the vendored eval directory.

From the target repository root, preview the update:

```bash
node <skill-dir>/scripts/install.mjs --repo . --update --dry-run
```

Review `upstreamVersion` and `files` in the JSON output. The preview checks bundle hashes and local
conflicts without writing files. Effective ignore rules are checked after installation, so a
successful preview alone does not prove that reports will be visible to Git. Apply the update:

```bash
node <skill-dir>/scripts/install.mjs --repo . --update
node .agents/evals/repository-overview/run.mjs --help
node --test .agents/evals/repository-overview/tests/*.test.mjs
git status --short
git diff -- .agents/evals/repository-overview .gitignore
```

For a first installation, omit `--update` from both installer commands. After a successful update,
review and commit the changed core, `upstream.json`, and ignore rules together. Keep existing
reports; collect new baselines when the measurement contract changes. These checks do not launch
live models.

### Resolve installation and update errors

| Error | What to do |
|---|---|
| `Eval already exists` | Use `--update --dry-run`, review the proposed changes, then use `--update`. |
| `Local managed-file conflicts; no files changed` | Follow the conflict procedure below. The installer has not written files. |
| `Bundle manifest is stale: <path>` | The source bundle differs from its manifest. Obtain a complete copy of the intended plugin release and retry. If you maintain `skills-dev` and intentionally changed the bundle, regenerate its manifest as described below. |
| Missing or invalid `upstream.json` | For the source bundle, obtain a complete release. For an installation that previously had a manifest, restore that exact installed manifest from its Git history. Do not substitute the new release's manifest for the old one; legacy 1.1.1 installations without a manifest are handled separately by the installer. |
| `Installation written, but Git visibility check failed` | Files have already been written. Inspect the reported path's ignore rules using the commands below, fix the responsible rule, and rerun the update and validation. Do not delete the installation or report history. |
| `Raw artifacts are not ignored` | Inspect rules for `.eval-artifacts/`, remove conflicting exceptions, and restore the raw-output ignore rule shown above. Rerun the update checks before adding files to Git. |
| `Refusing symlink` | Inspect the named path and its target. Use a real directory/file for the vendored copy, preserving any existing contents before replacing a link. The installer will not follow it. |
| `Legacy evals/repository-overview exists` | Migrate the old directory separately: review and preserve its scenarios, local changes and reports before moving it to `.agents/evals/repository-overview`. Then preview `--update`; do not install over both copies. |
| `Expected a Gravity UI origin or upstream remote` | Check `git remote -v` and the repository you selected. A personal fork needs its actual Gravity UI repository configured as `upstream`. Do not add a fictitious remote to bypass this check. |
| `git <command> failed` or missing Node.js | Check that Git works in the selected repository and that Node.js 20+ is available. Retry the preview after fixing the prerequisite. |
| `Unsafe managed path` or `Upstream must not own` | Stop using that bundle and obtain a reviewed release; its manifest violates the installer's ownership/path contract. |

For a local conflict, first save the affected files or their diff outside the managed core. Compare
them with both the previously installed release and the requested release. Move repository-specific
assertions into `scenarios/repository/`. If an upstream fix is still needed to preserve a local core
change, keep the current installation until that fix is available. When you have decided to accept
the upstream version, restore the affected core file to its exact previously installed version or
the exact requested version, then retry the preview. An arbitrary merged file still differs from
both hashes and will remain a conflict. For a conflicting migration destination such as
`scenarios/repository/legacy.json`, preserve the existing scenario under another repository-owned
name before retrying migration.

**Do not edit hashes in the installed `upstream.json` to silence a conflict.** They describe the
reviewed upstream files, not your local modifications. Changing them would hide the distinction
the installer uses to protect local work.

To diagnose ignore rules, substitute the path named by the error:

```bash
git check-ignore -v --no-index .agents/evals/repository-overview/reports/runs/example.json
git check-ignore -v --no-index .agents/evals/repository-overview/.eval-artifacts/raw.jsonl
```

The output identifies the rule's file and line, including nested `.gitignore`, `.git/info/exclude`
and global rules. A rule beginning with `!` is an exception. With `git check-ignore --no-index -q
<path>`, exit code 1 means visible (required for scenarios/reports); exit code 0 means ignored
(required for raw artifacts). Fix the owning rule rather than relying on `git add -f`.

### Maintain the source manifest

Only in a `skills-dev` source checkout, after intentional changes to the bundled files, run:

```bash
node skills/repository-overview-eval-init/scripts/manifest.mjs
node skills/repository-overview-eval-init/scripts/manifest.mjs --check
node scripts/validate_skills.mjs
```

Review and commit the generated `upstream.json` with the source changes. CI checks that every
managed file matches it. This command is not a repair procedure for local edits in a target repo.

## Add a scenario

1. Copy `examples/overview.json` or `examples/focused-task.json` into `scenarios/repository/`.
2. Replace every `YOUR_*` placeholder with reviewed facts, authoritative source paths and the task.
   The templates deliberately fail before customization. Adjust budgets to the task rather than
   retaining the illustrative limits without review.
3. Set a unique kebab-case `id` and positive integer `version`. Required fields are `id`, `version`,
   `prompt`, and a nonempty `assertions` array. Each assertion requires unique `id`, `type`, `group`;
   `description` is optional. See `scenario.schema.json` for the machine-readable contract.
4. Commit the scenario. Increment its version whenever prompt, assertions, ordering, optional
   behavior or budgets change. A SHA-256 digest also catches edits made without a version bump.
5. Run a one-attempt smoke test, then collect baseline and candidate with three attempts each.

The runner validates scenarios and regular expressions before launching a host. Assertions use
JavaScript regex strings (double-escape backslashes in JSON), default flags `iu`. Optional sources
are skipped only when absent from the repository; present-but-unvisited sources fail. Skipped
assertions are excluded from their group's score. A group without applicable checks scores `null`.
Unknown assertion types/properties, duplicate IDs and invalid budgets fail validation.

| Type | Group | Fields and semantics |
|---|---|---|
| `answer-regex` | structural or quality | `pattern`, optional `flags`; final answer matches. Use quality only for repository facts, not headings. |
| `answer-existing-paths` | structural | `minimum`; cites at least this many existing files. |
| `answer-fact-with-source` | quality | `pattern`, `patterns` for source paths, optional `flags`, `optional`; fact and an existing source citation occur in the same paragraph. |
| `trace-path-if-present` | route | `patterns`, optional `flags`; at least one matching existing file is visited; skips if none exist. |
| `trace-path-required` | route | `patterns`, optional `flags`, `optional`; every pattern must have an existing, visited match. Missing sources fail by default. |
| `trace-paths-before` | route | `patterns` for required docs, `before` for implementation paths, optional `flags`, `optional`; first visits for every required pattern precede the first observed implementation event. Same-event reads cannot prove ordering. |
| `trace-path-not-seen` | route | `patterns`, optional `flags`; no matching path observed. |
| `max-tool-calls` | route | `maximum`; total calls at or below budget. |
| `max-failed-tool-calls` | route | `maximum`; failed calls at or below budget. |
| `max-path-revisits` | route | `maximum`; references minus distinct paths at or below budget. |
| `max-unique-paths` | route | `maximum`; distinct observed paths at or below budget. |
| `no-web-search` | route | Zero normalized web-search calls. |

Budgets are nonnegative integers and inclusive. `optional: true` is supported only by
`answer-fact-with-source`, `trace-path-required`, and `trace-paths-before`. No overlays or batch suite
manifest are provided: each scenario is an independent versioned experiment.

The default checks structure and generic navigation; its quality is **unavailable**, not perfect.
Repository quality assertions belong in repository scenarios. Routes measure paths observed in tool
inputs, not proof of successful reading or context injected invisibly by a host. Fact-with-source checks are bounded
automated evidence, not proof of every claim or an entailment check against source contents.

## Conduct an experiment

Run this workflow when a live experiment is requested; installation and fixture tests alone do
not authorize model runs. Work from the target Git repository with Node.js 20+ and an authenticated
CLI. Check `upstream.json` and Git visibility: scenarios and `reports/` must remain visible, while
raw `.eval-artifacts/` stay ignored.

Choose a committed repository scenario with all template placeholders replaced, and pin the host,
model and effort. Start with a smoke attempt:

```bash
node .agents/evals/repository-overview/run.mjs \
  --host codex --repo . --model <model-id> --effort <effort> \
  --scenario .agents/evals/repository-overview/scenarios/repository/overview.json \
  --repeat 1
```

Inspect the smoke answer and assertion evidence. Resolve host/parser failures before collecting
measurements; do not bypass failed policy checks. For a baseline, use the same command with
`--repeat 3` and save the printed report path. Change the harness, then run the same three-attempt
command for the candidate. Keep the scenario and measurement contract identical; do not adjust
assertions to improve the candidate's score. Git state may differ between the two runs as intended,
but mutations during a run invalidate it.

Compare the retained JSON files:

```bash
node .agents/evals/repository-overview/compare.mjs \
  --baseline .agents/evals/repository-overview/reports/runs/<baseline>.json \
  --candidate .agents/evals/repository-overview/reports/runs/<candidate>.json
```

Read experiment-validity findings before interpreting token/cost deltas. Inspect medians and
ranges, structural/quality/route scores, warnings, parser errors, tool classes and path budgets.
Review substantive claims against repository sources and record any manual factual review as
described in [Retained evidence and long-term comparisons](#retained-evidence-and-long-term-comparisons).

Repeat independently for a representative focused-task scenario. Report trade-offs per scenario,
link the retained reports, state their identities and validity, and separate automated scores from
manual review. Include any focused-task regressions before making a net-win claim. Review and commit
the scenarios and sanitized JSON/Markdown reports with the harness change; keep raw logs ignored.
After changing the measurement contract, collect a new baseline. Historical scenario-v5/runner-v4
measurements are observations only and cannot serve as corrected baselines.

`compare.mjs` also accepts raw run directories containing `result.json`; it never needs raw logs
when using saved summaries. Every invocation writes a new timestamp/UUID-named comparison. Optional
`--output file.json` refuses existing outputs; `--threshold 5` sets the efficiency materiality
threshold; `--fail-on-regression` returns nonzero for `regressed` or `mixed` results.

`run.mjs --help` lists options. `--host claude` and `--host opencode` select the other adapters;
`--output` changes only the raw directory. Reports always go beside the installed core. The default
timeout is ten minutes per attempt. Run exit code is nonzero for invalid attempts or mutations;
assertion results describe quality/route independently of process completion.

## What is measured

- Completed attempts are process successes with a nonempty answer; valid attempts additionally
  have no degradation, host/parser errors, web searches or repository mutation.
- Commands, MCP, web searches and external tools normalize to one event per identifiable call;
  start/completion updates preserve earlier useful output. Failed commands count once and are
  distinct from host failures. Unknown event shapes invalidate parser health instead of silently
  undercounting tool calls. Unknown diagnostic text is a host error.
- Codex retains the last nonempty answer. Its reviewed skill-description-shortening diagnostic
  (exact text captured from Codex CLI 0.153.4 in `fixtures/codex.jsonl`) is a warning. Other wording remains blocking until captured and reviewed as a fixture.
- Token `input` includes uncached input, cache reads and cache creation. Claude/OpenCode disjoint
  counters are normalized before totals; Codex's inclusive counter is not added twice.
  `uncachedInputTokens` subtracts both cache classes. Unknown usage is not invented. Cost is recorded only when the host reports it.
- Scores are independent structural, factual quality, and route fractions. Efficiency medians and
  min/max use eligible attempts only; diagnostic counters remain visible across all attempts.
- Git audits compare commit, index identities, status and file-content hashes before/after attempts,
  including already-dirty files. Reports and configured raw outputs are excluded. Observed Codex
  file-change events also invalidate attempts. Detected mutations are reported, never rolled back.

Codex preflight calls local app-server `config/read` and `configRequirements/read` without creating
a thread or turn. It verifies `read-only`, `on-request`, `web_search=disabled` under the same explicit
config overrides used for `exec --json --ephemeral`. User/project config is loaded consistently for
both commands; requested and effective policy values are recorded. Unsupported preflight protocols,
incompatible managed restrictions, and unverifiable settings fail before a model attempt. See the
[Codex app-server protocol](https://developers.openai.com/codex/app-server). Claude and OpenCode use
their plan modes with Git auditing; reports identify their weaker, CLI-flag-based verification.

## Retained evidence and long-term comparisons

Each run automatically writes a compact JSON and Markdown pair under `reports/runs/`. Each comparison
embeds both summaries under `reports/comparisons/`. These contain scenario ID/version/digest,
per-attempt metrics, median/ranges, Git commit/dirty-state metadata, model/effort/CLI, runner/adapter
contracts, timestamps, invalidation reasons and manual factual-review status. Raw responses,
commands, tool output, stderr, prompts and absolute repository roots are omitted. Relative paths
and Git status remain; inspect reports before committing them with the scenario and harness change.
The runner does not commit or publish files.

Record optional human review by setting `manualReview.status` to `passed` or `failed` with `notes`
in the retained JSON, then regenerate a comparison. It is independent of automated scores. Run
Markdown is the original snapshot; the new comparison renders the updated review status.

A formally compatible pair requires matching scenario digest, host, model, effort, CLI, runner,
adapter version/contract, artifact schema and attempt count. One ineligible attempt invalidates
the entire experiment with exact reasons, even if other attempts look faster. Missing required
artifact fields fail validation; old schemas require new baselines.

- `invalid`: incompatible contracts, failed/degraded attempts, web searches or mutations; verdict
  is always `inconclusive`.
- `limited`: compatible clean measurements but fewer than three attempts, unspecified model/effort,
  or no factual quality assertions. Metric movement is descriptive; it cannot prove a net win.
- `valid`: compatible, fully specified, three-or-more clean attempts with factual checks. This is
  automated experimental validity, not a guarantee of factual completeness or statistical significance.

Maintain a separate history for every scenario. After changing the measurement contract, collect
new baselines; retain older reports as historical observations. Model identifiers/revisions exposed by host events are retained and compared as well. Provider aliases can change even
with the same model name, so exact reproducibility is not promised without an immutable revision.
Inspect cache reads/writes, alternate run order when appropriate, and compare ranges as well as
percentages. A net-win claim needs an overview gain without a material quality, route, or efficiency
regression on a representative focused task. There is no cross-scenario median that hides regressions.

## CI and contributor integration

Cost is an optional host-reported metric (`reportedUsd`). If the CLI does not report it, it remains
`null`; token, duration and tool metrics still work. No pricing configuration is needed.

```bash
node --test .agents/evals/repository-overview/tests/*.test.mjs
```

CI should run these offline tests and native lint/format checks. Include the vendored code in those
checks instead of broadly excluding `.agents/`. Add an appropriate task alias and link this README
from contributor/navigation documentation. Keep live baseline/candidate runs a manual maintainer
workflow: CI must not start paid models or require their credentials.
