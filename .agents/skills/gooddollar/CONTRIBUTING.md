# Contributing to GoodSkills

This repository is an AI skill pack. The goal of each update is to make agent behavior more reliable, more explicit, and easier to audit.

## Update workflow

1. Define the user-facing problem first.
2. For contract-related updates, add or update Rich ABI first (`references/contracts/*.abi.yaml`), then refresh selectors.
3. Decide the remaining artifact types:
   - `references/guides/` for "what to do"
   - `references/deep-researches/` for "why it works this way"
   - `scripts/` for deterministic and repeatable execution
4. Update `SKILL.md` routing so the new artifact is discoverable.
5. Validate consistency (paths, naming, links, selectors, assumptions).

If a change touches contract behavior, treat Rich ABI update/add as mandatory first step before guides, deep-research, or scripts.

## Add or update a guide

Use guides for execution playbooks and operator workflows.

Required structure:

- title and one-line usage trigger
- `## Goal`
- `## Required inputs`
- `## Execution flow` as numbered steps
- deterministic snippet when execution is non-trivial
- failure handling and output contract

Guide rules:

- prefer explicit pre-checks before state-changing actions
- include only one primary workflow per file
- use [GoodProtocol `releases/deployment.json`](https://github.com/GoodDollar/GoodProtocol/blob/master/releases/deployment.json) as the **only** source for contract addresses (rich ABI `meta.deployments` mirrors those rows); use GoodDocs for behavior and UX, not for resolving addresses; use on-chain `NameService.getAddress` only when the deployment documents the string key
- avoid implementation-deep theory; keep that in deep-research files

After adding a guide:

- add it to `SKILL.md` in `Guides`
- add an entry in `Use-case to guide map`

## Add or update a deep-research note

Use deep-research files for architecture, rationale, tradeoffs, and root-cause logic.

Deep-research rules:

- explain causality, not only API surfaces
- distinguish current behavior from legacy behavior
- link source contracts/docs for traceability
- keep language natural and decision-oriented

Do not turn deep-research files into step-by-step runbooks; move operational steps into guides.

## Add or update Rich ABI YAML

Location: `references/contracts/`.

For each contract:

- create or update `Foo.abi.yaml`
- generate or refresh `Foo.selectors.yaml`
- include function-level notes for non-obvious behavior
- when `meta.deployments` lists concrete addresses, add **`creationBlock`** next to each **`address`** (placement: `references/contracts/_rich-abi-yaml-format.md`; using it as **`fromBlock`** for log or HyperSync fetches: `references/guides/hypersync-hyperrpc.md`)

Minimum ABI documentation quality:

- correct mutability, inputs, outputs
- access pattern (`owner`, `avatar`, `anyone`, etc.) where relevant
- emitted events and practical errors
- notes for routing/edge-case semantics

Source-of-truth policy:

- prefer canonical contract repos (GoodProtocol, GoodBridge, mento-core)
- avoid inferred behavior when source is unclear
- update notes when protocol behavior changed

Selector generation:

```bash
node scripts/selectors.mjs generate Foo.abi.yaml
```

## Add or update scripts

Location: `scripts/`.

Use scripts when:

- a workflow is repeated
- deterministic output is needed
- manual querying is error-prone

Script standards:

- require inputs through env vars or explicit args
- fail loudly with actionable messages
- print structured output for easy reuse
- keep script intent narrow

When a script supports a guide:

- reference it from that guide
- document expected inputs and outputs in the guide

## Naming and organization

- use lowercase kebab-case for guides and deep-research files
- keep one topic per file
- avoid duplicate guidance across files
- prefer updating existing files over creating near-duplicates

## Update checklist before merge

- `SKILL.md` routing updated
- links resolve and point to public sources
- guides and deep-research files respect "what" vs "why" separation
- ABI + selectors pairs are in sync
- new behavior is reflected in notes where needed
