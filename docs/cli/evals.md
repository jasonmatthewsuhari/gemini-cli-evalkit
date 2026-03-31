# `/evals` Guide

This fork treats `/evals` as a contributor product, not just a hidden
maintenance command.

The command family is designed to support four jobs:

1. browse the current eval ecosystem
2. find missing coverage
3. generate local eval-rule pairs
4. decide whether an eval should stay local or move upstream

## Product Model

The product has two kinds of evals:

- marketplace evals
  - come from the upstream registry
  - install locally as rule fragments
  - can be enabled, disabled, and uninstalled
- generated evals
  - are created locally from `/generate-eval`
  - live in `.gemini/evals/`
  - carry contribution-fit and duplicate-review metadata

## Commands

### `/evals`

Opens the interactive TUI.

Tabs:

- `All`
  - shows marketplace and generated evals together
- `Installed`
  - shows locally active or disabled evals
- `Coverage`
  - shows coverage gaps plus ranked next-eval suggestions
- `Generate`
  - lets you create a local eval-rule combo from a short correction
- `GEMINI.md`
  - shows currently active rule fragments

### `/evals list`

Lists installed marketplace evals and locally generated evals in a flat output.

Use this when:

- you do not want the full TUI
- you are working headless
- you want a quick summary in the current session history

### `/evals browse`

Lists registry evals in flat output.

If the registry cannot be fetched:

- cached registry data is used when available
- the command explains that the data is stale
- if no cache is available, local workflows still continue

### `/evals coverage`

Shows:

- tool coverage
- behavioral coverage
- suggested next evals

Each suggested next eval includes:

- target
- kind (`tool` or `behavior`)
- rationale
- a ready-to-copy `/generate-eval ...` seed
- an upstream-worthiness hint

This is the main entry point for contributors who want to ask:

“What eval should I work on next?”

### `/evals show <name>`

Displays details for an eval that exists:

- in the marketplace registry
- in local installed state
- or in local generated state

This is useful for:

- checking rule text and metadata
- inspecting generated contribution hints
- reviewing analytics before proposing upstream

### `/evals install <name>`

Installs a marketplace eval-rule combo.

This activates its rule locally and tracks analytics in local state.

### `/evals uninstall <name>`

Removes an installed marketplace eval-rule combo from local state.

### `/evals enable <name>` / `/evals disable <name>`

Turns an installed or generated eval-rule combo on or off without deleting it.

### `/evals delete <name>`

Deletes a generated local eval and its associated local rule file.

## `/generate-eval`

`/generate-eval` converts a failure description into a local eval-rule pair.

Example:

```bash
/generate-eval agent should ask for clarification before running a destructive shell command
```

The generation flow now includes:

- duplicate review hints
- contribution-fit assessment
- local save into `.gemini/evals/` and `.gemini/eval-rules/`

### Duplicate review hints

Generated evals may include:

- `duplicateOf`
  - a strong duplicate; generation stops
- `duplicateCandidates`
  - nearby evals worth reviewing before contributing upstream

### Contribution-fit assessment

Generated evals receive one of:

- `likely-upstream`
- `needs-review`
- `likely-personal`

This is heuristic guidance, not a maintainer decision.

The purpose is to reduce low-signal proposals by helping contributors ask:

- Is this a broad Gemini CLI behavior?
- Or is this a repo-specific/team-specific preference?

## TUI Details View

When you highlight an eval in the TUI, the details panel now shows:

- current status
- source
- category
- analytics
- local file paths for generated evals
- contribution-fit assessment for generated evals
- a rule preview
- registry status when marketplace data is stale

For generated evals, proposing upstream from the TUI now warns when the eval
looks personal or still needs review.

## Offline Behavior

The registry fetch path now tries to behave like a product instead of a
prototype:

- fresh network data is used when available
- cached registry data is used when the network fetch fails
- the UI and flat commands explain when cached data is stale
- local generated and installed eval workflows do not depend on network access

## Local Storage

```text
.gemini/
  GEMINI.md
  evals/
    example.eval.ts
  eval-rules/
    index.json
    example.rule.md
```

`index.json` stores:

- install/generation timestamps
- enabled state
- analytics
- duplicate review hints for generated evals
- contribution-fit assessment for generated evals

## Suggested Contributor Workflow

1. Run `/evals coverage`
2. Pick one suggested next eval
3. Run `/generate-eval <suggested prompt>`
4. Inspect it with `/evals show <name>` or in the TUI
5. Check duplicate hints and contribution fit
6. Keep it local, refine it, or propose it upstream

## Testing

Useful targeted tests for this product surface:

```bash
npm run test --workspace @google/gemini-cli-core -- coverageAnalyzer.test.ts
npm run test --workspace @google/gemini-cli -- evalsCommand.test.ts
npm run test --workspace @google/gemini-cli -- generateEvalCommand.test.ts
npm run test --workspace @google/gemini-cli -- evalsWorkflow.test.ts
```

## Design Intent

The important product goal is not only “generate evals.”

It is to make the contributor loop coherent:

- discover
- generate
- inspect
- assess
- contribute

That is the standard this fork is trying to move toward.
