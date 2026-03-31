# Gemini CLI Evalkit

`gemini-cli-evalkit` is an eval-focused fork of Gemini CLI for building and
validating a behavioral eval workflow around `/generate-eval` and `/evals`. The
fork is centered on one product loop: detect a bad agent behavior, turn it into
a local eval-rule combo, inspect coverage and registry state, and optionally
prepare that work for upstream contribution.

This repository is not a general-purpose rebrand of Gemini CLI. It is a working
implementation and research sandbox for a validated eval ecosystem: misbehavior
detection, eval generation, local rule lifecycle management, marketplace-backed
discovery, and coverage analysis.

## What This Fork Adds

- `/generate-eval` for creating a local eval + rule from failure context or a
  manual correction
- `/evals` as a tabbed TUI for browsing, managing, and generating eval-rule
  combos
- Flat `/evals` subcommands for list, browse, coverage, show, enable, disable,
  install, uninstall, and delete flows
- Misbehavior detection that captures user corrections and seeds eval generation
- A local-first eval-rule lifecycle under `.gemini/`
- Registry-backed marketplace discovery through `eval-registry.json`
- Static coverage analysis for tool and behavioral gaps

## Core Workflow

### 1. Generate an eval from a failure

Start the CLI, reproduce a behavior issue, then run:

```bash
/generate-eval agent should have asked for clarification before running the command
```

If misbehavior detection has already captured context from the conversation,
`/generate-eval` can reuse that pending context automatically. Otherwise, it
builds a draft from the recent conversation history or from the manual
description you provide.

### 2. Manage evals through `/evals`

Open the eval UI:

```bash
/evals
```

The TUI provides:

- `All` to browse official, community, and generated evals
- `Installed` to manage locally active eval-rule combos
- `Coverage` to inspect current tool and behavioral gaps
- `Generate` to create a new eval-rule combo directly from the UI
- `GEMINI.md` to inspect active generated rule blocks

### 3. Persist behavior locally

Generated and installed eval-rule combos are stored under `.gemini/`, where the
eval files, rule files, metadata, and managed `GEMINI.md` rule fragments live
together. This keeps the workflow local-first and usable even when marketplace
or upstream flows are unavailable.

## Command Surface

### `/generate-eval`

```bash
/generate-eval <describe what the agent did wrong>
```

Behavior:

- uses pending misbehavior context when available
- otherwise derives context from recent conversation history
- generates an eval draft and a paired rule fragment
- saves accepted drafts into `.gemini/evals/` and `.gemini/eval-rules/`
- updates `.gemini/GEMINI.md` with managed rule blocks

### `/evals`

Default behavior opens the eval marketplace TUI.

Supported subcommands:

- `/evals list`
- `/evals browse`
- `/evals coverage`
- `/evals show <name>`
- `/evals install <name>`
- `/evals uninstall <name>`
- `/evals enable <name>`
- `/evals disable <name>`
- `/evals delete <name>`

## Local State

The eval workflow is local-first and persists under `.gemini/`:

```text
.gemini/
  GEMINI.md
  evals/
    <generated>.eval.ts
  eval-rules/
    index.json
    <generated-or-installed>.rule.md
```

Key files:

- `.gemini/evals/`: generated local evals
- `.gemini/eval-rules/index.json`: installed/generated metadata and analytics
- `.gemini/GEMINI.md`: active managed rule fragments

## Architecture Summary

The CLI layer handles user actions and presentation through `/generate-eval`,
`/evals`, and the `EvalsMarketplaceView` TUI. The core eval domain in
`packages/core/src/evals/` owns the lifecycle logic: misbehavior detection,
draft generation, registry fetching and caching, coverage analysis, and local
state management.

Data flow is local-first. Installs and generated artifacts are written to
`.gemini/`, while remote registry access is optional and used only for
marketplace discovery. This lets the core eval workflow continue to function
even when network-backed features are unavailable.

## Repository Guide

- [`packages/core/src/evals`](./packages/core/src/evals) Core eval logic:
  generation, registry, coverage, rule management, types
- [`packages/cli/src/ui/commands`](./packages/cli/src/ui/commands) CLI
  entrypoints for `/evals` and `/generate-eval`
- [`packages/cli/src/ui/components/views`](./packages/cli/src/ui/components/views)
  TUI implementation, including `EvalsMarketplaceView`
- [`eval-registry.json`](./eval-registry.json) Marketplace registry data used by
  the eval browser
- [`docs/cli/evals.md`](./docs/cli/evals.md) Contributor-facing guide for the
  `/evals` and `/generate-eval` workflow
- [`docs/reference/commands.md`](./docs/reference/commands.md) Slash command
  reference, including `/evals` and `/generate-eval`
- [`evals/README.md`](./evals/README.md) Behavioral eval suite documentation
  inherited from the upstream project

## Development

Install dependencies:

```bash
npm ci
```

Start the CLI in development mode:

```bash
npm run start
```

Useful commands:

```bash
npm run build
npm run lint
npm run typecheck
```

Run the eval suites:

```bash
npm run test:always_passing_evals
npm run test:all_evals
```

Run integration tests:

```bash
npm run test:integration:sandbox:none
```

## Why This Fork Exists

The product problem here is not just "write more eval files." It is how to make
behavioral eval work discoverable, local-first, and contribution-ready:

- detect failures from real user interactions
- convert those failures into reproducible evals
- pair evals with local behavior rules
- manage them through a dedicated `/evals` surface
- understand what coverage is still missing

This fork exists to build and validate that workflow end to end.
