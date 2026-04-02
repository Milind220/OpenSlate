# OpenSlate Implementation Plan

This is the practical build order for OpenSlate.

It turns the architecture in `docs/02-openslate-plan.md` into an execution sequence with explicit dependencies and success criteria.

Use this as the primary implementation roadmap.

## Guiding Strategy

Build OpenSlate in this order:

1. lock the runtime objects and package boundaries
2. preserve provider portability from the opencode side
3. ship a strong single-session agent before swarm behavior
4. add real child threads and structured reintegration
5. add rolling handoff state and compaction after the session graph is real
6. layer in swarm-native UX only after the runtime truth exists

This order intentionally avoids building the flashy swarm UI before the core runtime is correct.

## Phase 0. Architecture Lock

Purpose:

- freeze the core concepts before implementation spreads assumptions everywhere

Deliverables:

- final `copy / adapt / rewrite` map against opencode
- locked runtime types:
  - `Session`
  - `ThreadSession`
  - `QuerySession`
  - `Message`
  - `MessagePart`
  - `Artifact`
  - `HandoffState`
  - `WorkerReturn`
- locked provider abstractions:
  - `ModelProvider`
  - `ModelAdapter`
  - `ModelRouter`
- initial storage schema draft
- initial package boundary decision

Dependencies:

- `docs/02-openslate-plan.md`
- `docs/04-slate-runtime-findings.md`

Done means:

- we can explain the core runtime in one page without ambiguity
- we know what is copied/adapted from opencode versus rewritten
- provider-specific assumptions are not leaking into session design

## Phase 1. Monorepo Scaffold

Purpose:

- create clean implementation boundaries before feature work starts

Deliverables:

- Bun + TypeScript + Turbo repo setup
- package layout:

```text
packages/
  core/
  server/
  models/
  tools/
  tui/
  sdk/
  plugins/
```

- shared tsconfig, formatting, test config
- build and typecheck pipeline

Dependencies:

- Phase 0 package decisions

Done means:

- all packages build/typecheck cleanly
- boundaries are ready for incremental implementation

## Phase 2. Provider Layer

Purpose:

- preserve opencode-style provider portability before runtime logic hardcodes one backend

Deliverables:

- multi-provider config model
- provider adapters for at least:
  - OpenAI-compatible
  - Anthropic
  - Fireworks
- role-based model slots:
  - `primary`
  - `execute`
  - `explore`
  - `search`
  - `compress`
  - optional `title`
  - optional `classify`
- inspectable routing metadata
- token and cost accounting normalization
- retry and error classification

Dependencies:

- Phase 0 abstractions
- Phase 1 package scaffold

Done means:

- one runtime can call multiple providers
- different roles can use different models across providers
- provider portability is preserved without touching the orchestrator design

## Phase 3. Single-Session Runtime

Purpose:

- ship a useful non-swarm OpenSlate core before adding child-session complexity

Deliverables:

- `Session` CRUD
- `Message` and `MessagePart` persistence
- basic orchestrator loop with no child threads yet
- local server/control-plane skeleton
- event stream for session updates

Dependencies:

- Phase 1 scaffold
- Phase 2 provider layer

Done means:

- OpenSlate works as a competent single-agent coding harness
- session and message persistence are real
- the control plane exists and clients can stream state

## Phase 4. Tool Runtime

Purpose:

- make the single-session runtime actually useful for coding work

Deliverables:

- filesystem tools
- search/glob tools
- shell/PTY tools
- git helpers
- web fetch/search tools
- approval and permission policy
- persisted tool artifacts and tool-call metadata

Dependencies:

- Phase 3 runtime

Done means:

- the agent can perform real codebase work end-to-end
- every tool call is structured and persisted

## Phase 5. Thread Runtime

Purpose:

- add real persisted child sessions with continuity

Deliverables:

- `ThreadSession`
- `QuerySession`
- parent -> child lineage persistence
- alias-based thread reuse
- scoped tool permission inheritance
- bounded child execution contract

Dependencies:

- Phase 3 runtime
- Phase 4 tool runtime

Done means:

- parent can spawn real child sessions
- same alias can reuse the same child session when appropriate
- child state persists independently from the parent transcript

## Phase 6. Structured Reintegration

Purpose:

- make thread weaving real instead of fake subagent summaries

Deliverables:

- `WorkerReturn` schema
- parent consumption of worker returns by default
- persisted fields at minimum:
  - `childSessionId`
  - `childType`
  - `alias`
  - `task`
  - `status`
  - `output`
  - `traceRef`
  - `artifactRefs`
- prompt assembly that prefers worker returns over raw child transcript replay
- optional derived `Episode` view only after worker returns are stable

Dependencies:

- Phase 5 thread runtime

Done means:

- parent/child synchronization is structured
- long child runs reintegrate cleanly
- the runtime now resembles the core Slate pattern

## Phase 7. Rolling Handoff State

Purpose:

- introduce explicit rolling session memory and checkpoint state

Deliverables:

- one mutable `HandoffState` per session
- separate storage for rolling state from ordinary messages
- tracked fields at minimum:
  - `compressedSummary`
  - `lastCompressionIndex`
  - `lastPromptTokens`
  - marker/writeback state
- prompt assembly wired to read handoff state

Dependencies:

- Phase 3 runtime
- Phase 6 reintegration contract

Done means:

- long-session runtime state is explicit
- prompt assembly can evolve independently from full transcript persistence

## Phase 8. Two-Stage Compaction

Purpose:

- keep long sessions usable without transcript bloat or silent context collapse

Deliverables:

- marker-stage compaction
- writeback-stage compaction
- summary + recent-window prompt rebuilding
- explicit summarize/compact route that actually works
- automatic compaction policies
- compaction model slot usage

Dependencies:

- Phase 7 rolling handoff state

Done means:

- long sessions remain stable
- compaction is observable and debuggable
- explicit compaction is real, not cosmetic

## Phase 9. Query Mode

Purpose:

- support lightweight internal delegation distinct from tool-heavy threads

Deliverables:

- `QuerySession` behavior tuned for focused synthesis/research
- query-specific capability restrictions
- query-specific worker return shape if needed
- orchestrator heuristics for choosing query vs thread

Dependencies:

- Phase 5 thread runtime
- Phase 6 reintegration

Done means:

- the orchestrator has both tactical threads and lightweight query delegation
- query remains a runtime primitive, not a UX promise

## Phase 10. Swarm-Native UX

Purpose:

- expose the swarm architecture without making the interface noisy

Deliverables:

- opencode-like terminal feel
- thread lane / child-session panel
- worker return cards
- compaction / handoff indicators
- model-slot badges
- orchestration timeline

Dependencies:

- Phase 6 reintegration
- Phase 8 compaction

Done means:

- users can understand what the swarm is doing
- simple tasks still feel simple

## Phase 11. Extensibility

Purpose:

- make the runtime usable beyond built-in tools and providers

Deliverables:

- MCP integration
- plugin hooks
- custom provider registration
- skills or script hooks where useful

Dependencies:

- stable core runtime and tool interfaces

Done means:

- OpenSlate can be extended without core rewrites

## Phase 12. Hardening

Purpose:

- make OpenSlate robust enough for real daily use

Deliverables:

- crash recovery
- replay/export
- provider conformance tests
- long-horizon benchmark tasks
- compaction regression tests
- performance tuning

Dependencies:

- Phases 2 through 11

Done means:

- the system is stable under long sessions and real codebase work

## Core Milestones

If reduced to the true milestones, the build order is:

1. provider-portable single-session agent
2. real child threads with alias reuse
3. structured reintegration
4. rolling handoff + compaction
5. swarm-native UI

## What Not To Build First

Do not start with:

- desktop packaging
- fancy multi-agent visualizations
- external tmux-driven agent backends
- exact Slate parity on hidden compaction triggers
- polish-heavy UI work before runtime truth exists

## First Three Immediate Work Items

If implementation starts now, do these first:

1. create the package skeleton
2. lock the schema for `Session`, `ThreadSession`, `HandoffState`, and `WorkerReturn`
3. implement provider adapters and role-based model routing before anything else

## Success Criteria For The Whole Project

OpenSlate is on the right track when it can do all of the following:

- run as a strong single-session coding agent
- spawn and reuse child threads with stable identity
- reintegrate child work through structured returns
- maintain explicit rolling handoff state per session
- compact long sessions while preserving useful context
- let users route different runtime roles to different providers/models
- still feel as polished and ergonomic as opencode at the surface
