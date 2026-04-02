# OpenSlate Architecture Plan

Goal: build an open-source coding agent inspired by Slate's swarm-native architecture while preserving the product feel of opencode.

This plan assumes a copy-first, rewrite-core implementation in this repo and treats these documents as the source of truth before shipping:

- `docs/01-slate-research.md`
- `docs/04-slate-runtime-findings.md`

## Product Definition

OpenSlate should feel like opencode at the surface and like Slate in the runtime.

That means:

- opencode-style TUI polish, theming, rendering, and usability
- Slate-style orchestration, context routing, bounded worker threads, and rolling session memory
- local-first developer workflow with transparent state, approvals, and replayability

## Product Principles

- Swarm-native by default, not as a bolted-on mode.
- Visible orchestration, not hidden magic.
- Minimal extra ceremony for simple tasks.
- Structured state everywhere.
- Reuse existing opencode ideas where they are already strong.
- Preserve user trust with local-first persistence and auditable actions.
- Preserve provider portability from the opencode side of the vision: users must be able to connect OpenAI, Anthropic, Fireworks, open-weight backends, and compatible custom providers without changing the swarm runtime.

## Locked Findings From RE

These are the runtime conclusions now strong enough to design around.

- parent/child orchestration is a real persisted mechanism, not a prompt trick
- `ThreadSession` is a real child-session concept with persistent lineage
- alias reuse is a first-class behavior and should be modeled explicitly
- parent reintegration is structured and tool-mediated, not just prose summarization
- each session should have one mutable rolling handoff/checkpoint object
- compaction should be modeled in two stages:
  - marker-stage
  - writeback-stage
- prompt rebuilding should use summary plus recent history, not full raw replay
- explicit compaction should exist in OpenSlate even though Slate's current `/compact` UX is effectively a no-op
- `query` should be treated as an internal/runtime primitive, not a user-facing behavior guarantee
- model choice should be role-specific so orchestration, execution, exploration, web research, and compaction can use different models
- a first-class `Episode` object is optional for OpenSlate, but reverse-engineering does not prove Slate stores a literal `Episode` entity as the core runtime primitive

## Non-Goals For V1

- perfect parity with closed-source Slate behavior
- hidden remote orchestration layers we cannot inspect
- autonomous background cloud workers
- benchmark-chasing novelty without product usability
- elaborate multi-agent social metaphors or roleplay

## Reuse vs Replace

This project should not be a pure fork and should not be a purity-driven greenfield rewrite.

The right posture is:

- copy or adapt opencode sections that already solve UI, control-plane, tooling, and ergonomics well
- rewrite the runtime core where swarm-native behavior changes the architecture materially
- avoid rebuilding boring infrastructure unless the existing shape blocks the new runtime

## Preserve From OpenCode-Inspired Shape

These are the product and platform traits we should preserve.

- client/server control plane boundary
- strong TUI and theming system
- typed tool schemas and approval system
- extensibility via plugins, MCP, and skills
- structured messages and rich renderable parts
- session-oriented UX with resume/replay/fork/share hooks

High-value likely copy/adapt candidates:

- TUI layout, rendering patterns, and theme system
- local server/control-plane skeleton
- SDK/OpenAPI patterns
- tool registry and typed schema conventions
- permission and approval flows
- provider adapter patterns
- MCP and plugin scaffolding
- transcript/message rendering primitives

Provider portability is a hard OpenSlate requirement coming from the opencode side of the product, not from Slate itself. OpenSlate should keep the opencode-style "bring your own provider/model" posture while replacing the runtime core.

DeepWiki on `sst/opencode` suggests the UI and shared app packages are relatively separable from the runtime core, while the server/API and session/tool layers are where orchestration changes would land.

## Replace Or Add For Swarm-Native Runtime

- primary orchestrator loop
- thread lifecycle and alias reuse
- rolling handoff/checkpoint model
- worker reintegration protocol
- two-stage compaction model
- role-specific model router
- orchestration-aware UI affordances

Likely rewrite-heavy areas:

- session graph and storage model
- main agent/orchestrator loop
- child session lifecycle
- thread alias reuse semantics
- reintegration contracts and worker return objects
- compaction and context routing strategy
- prompt assembly around summaries, docs, traces, and model roles

## Adoption Strategy

Use a `copy-first, rewrite-core` migration strategy.

### Copy Or Adapt When

- the subsystem is mostly product surface or infrastructure
- the subsystem is swarm-agnostic
- the subsystem already has good UX and reasonable abstraction boundaries
- copying it avoids weeks of rebuilding non-differentiating code

### Rewrite When

- the subsystem defines agent cognition or session semantics
- the existing design assumes a flat chat transcript
- the existing design does not expose thread/episode boundaries cleanly
- forcing reuse would create a permanent architectural tax

### Operating Rule

We should feel free to copy entire usable sections of opencode where license allows and where the code is actually good, but we should not contort the swarm runtime to preserve legacy assumptions from that code.

### Practical Rule

When choosing between:

- copying a proven opencode subsystem with light adaptation
- rebuilding the same infrastructure from scratch

default to copying.

When choosing between:

- forcing the swarm runtime into an opencode-shaped core that does not fit
- rewriting the core cleanly

default to rewriting.

## Proposed System Topology

```text
TUI / Desktop / SDK clients
  -> Local control plane server
    -> Session graph store
    -> Orchestrator runtime
    -> Worker thread runtime
    -> Query runtime
    -> Tool runtime
    -> Context + compaction engine
    -> Model router
    -> Event bus / stream layer
```

## Core Runtime Model

## 1. Session Graph

Use a graph, not a flat chat log.

Core node types:

- `Project`
- `Session`
- `ThreadSession`
- `QuerySession`
- `Message`
- `Artifact`
- `HandoffState`
- `WorkerReturn`
- optional `Episode`
- `Snapshot`
- `TodoState`

Key relationships:

- parent session -> child session
- session -> messages
- message -> parts
- session -> one mutable handoff state
- thread/query run -> worker return
- optional episode -> derived from worker returns and artifacts
- project -> sessions

## 2. Message and Part Model

Use structured parts so the UI and compaction engine can reason over them.

Required part families:

- `text`
- `reasoning`
- `tool_call`
- `tool_result`
- `snapshot`
- `patch`
- `agent`
- `status`
- `handoff`
- `summary_marker`
- `worker_return_ref`
- `approval_request`
- `approval_result`

This should support rendering, replay, compaction, and audit without text scraping.

## 3. Rolling Handoff State

This is one of the key primitives directly supported by the reverse-engineering evidence.

Suggested fields:

- `id`
- `sessionId`
- `kind` (`rolling_state|marker`)
- `compressedSummary`
- `lastCompressionIndex`
- `lastPromptTokens`
- `markerCompleted`
- `updatedAt`

Rules:

- one session owns one rolling handoff/checkpoint object
- the rolling object is updated in place as the session evolves
- marker-stage compaction should be modeled separately from summary writeback
- compaction should be possible automatically and explicitly

## 4. Worker Return Model

The reverse-engineering evidence strongly supports a structured reintegration contract. OpenSlate should preserve that idea directly.

Suggested fields:

- `id`
- `parentSessionId`
- `childSessionId`
- `childType` (`thread|query`)
- `alias`
- `task`
- `status`
- `output`
- `traceRef`
- `artifactRefs[]`
- `startedAt`
- `finishedAt`

Rules:

- every bounded child run returns exactly one worker return object to the parent
- parent orchestration consumes worker returns by default, not raw transcripts
- child transcripts remain persisted for audit and drill-down
- OpenSlate may additionally expose a higher-level `Episode` object as a derived abstraction for UX, planning, or reuse

## 5. Thread Model

There should be two child-execution primitives.

### Query

Use for focused investigation or synthesis.

- default no tool access or tightly limited read-only tools
- short-lived
- expected output is answer plus optional evidence refs
- internal/runtime primitive first; do not assume ordinary user prompts will reliably choose it

### Thread

Use for tactical execution.

- can be spawned with capability subset
- may reuse alias to preserve continuity
- produces a bounded worker return on every run
- can be resumed or interrupted by parent

## Orchestrator Loop

The orchestrator is the main session runtime.

Loop shape:

1. ingest user input and current project/session state
2. decide direct action vs query vs thread spawn/reuse
3. dispatch work with scoped context
4. receive structured worker returns or answer artifacts
5. update strategy, todo state, and rolling handoff state
6. decide whether to continue, compact, emit an explicit summary marker, or answer user
7. persist all state and stream updates to clients

Critical heuristic: do not spawn threads unless the task benefits from decomposition, parallelism, or context isolation. Simple asks should remain single-threaded.

## Thread Spawn Heuristics

Spawn a thread when one or more are true:

- a task has a clear tactical subgoal
- work can proceed in parallel
- the local context would become noisy if the work stayed inline
- the work may need multiple tool calls before a useful summary exists
- the result is reusable later as a child thread memory or structured worker return

Reuse a thread alias when one or more are true:

- the thread owns an ongoing subdomain of the task
- continuity is useful for local context
- prior child-session memory for that alias is directly relevant

Use a query instead of a thread when:

- tool use is unnecessary
- the goal is research, summarization, or classification
- the parent mainly needs a decision input

## Context Architecture

Use layered context.

### Active Working Context

- current user goal
- current strategic state
- recent high-value messages
- todo state
- latest worker return refs
- rolling handoff state
- relevant permissions and constraints

### Child Memory

- child-session transcripts
- alias-backed continuity within reused threads
- structured worker returns and traces

### Derived Episodic Memory

- optional higher-level `Episode` views derived from worker returns
- addressable by id if OpenSlate chooses to expose them explicitly
- reusable across later runs and UI summaries

### Persistent History

- full session and tool transcript
- snapshots
- patches
- artifacts

### Static Context Inputs

- codebase context
- workspace metadata
- project instructions
- skill metadata
- model/router config

## Compaction Strategy

Compaction should happen at natural boundaries, especially after thread completion, not only at token thresholds.

Recommended approach:

- keep one mutable handoff/checkpoint object per session
- model marker-stage and writeback-stage separately
- maintain summary markers in the message timeline
- compact older windows into structured summaries
- rebuild prompt windows from summary + recent history
- keep high-value artifacts lossless
- keep child transcripts and worker returns stable even when prompt windows are compacted
- keep a narrow recent window uncompressed for local coherence

Implementation stance:

- automatic compaction is required
- explicit compaction should also exist as a real callable path in OpenSlate
- explicit compaction must actually work, unlike the misleading current Slate `/compact` surface

This is one of the biggest places where quality will be won or lost.

## Model Routing

Support explicit model slots.

Required slots:

- `primary`: strategic orchestration
- `execute`: code and tool heavy work
- `explore`: research/query tasks
- `search`: web research and lightweight retrieval work
- `compress`: summarization/compaction
- optional `title` and `classify`

Routing rules should be observable in config and session metadata. The user should be able to inspect which model handled which phase.

Design intent:

- use stronger reasoning models for orchestration when needed
- use coding-optimized models for execution
- use cheaper/faster models for exploration or lightweight search when quality permits
- use specialized low-cost models for compaction/title/classification work where possible
- let users override slot assignments per provider/model without changing runtime behavior

## Provider Architecture

Provider support must remain broad.

This section describes an OpenSlate product requirement inherited from the opencode side of the vision, not a behavior reverse-engineered from Slate.

Requirements:

- users can configure multiple providers at once
- model slots can point at different providers
- provider choice is orthogonal to orchestration design
- open-weight and hosted models should both work through the same runtime contracts
- provider-specific quirks should be normalized behind adapters, not leaked into session logic
- per-role model routing must work across providers, not just within a single provider

Minimum provider capabilities:

- streamed chat/completions
- tool calling or tool emulation layer
- structured output / JSON mode support where available
- token/cost accounting
- retry/error classification
- configurable base URL, headers, and API key handling

Recommended abstraction:

- `ModelProvider` interface for raw provider calls
- `ModelAdapter` layer for normalizing tool calls, streaming events, reasoning metadata, and usage accounting
- `ModelRouter` above adapters to choose the right model per role/slot

OpenSlate should ship with first-party support for at least:

- OpenAI-compatible providers
- Anthropic
- Fireworks
- local/open-weight endpoints that expose OpenAI-compatible APIs

This should make it straightforward to connect Codex/OpenAI models, Fireworks-hosted open-weight models, and custom compatible providers without changing the core swarm runtime.

## Tool Runtime

Required core tools:

- filesystem read/write/edit/status
- ripgrep/glob/symbol search
- terminal/pty
- git diff/status/revert helpers
- web fetch/search
- todo/scratchpad
- MCP tools
- formatter/LSP hooks

Each tool call must have:

- typed input schema
- typed output schema
- persisted result artifact
- approval metadata where relevant

## Permissions And Safety

Permissions must survive swarm execution.

Rules:

- worker threads inherit or narrow parent tool permissions
- destructive tools require explicit approval policy
- every approval decision is persisted and renderable
- child thread permissions are visible in UI

## Control Plane API

Expose the runtime through a local API from day one.

Minimum route families:

- `/project`
- `/config`
- `/session`
- `/session/{id}`
- `/session/{id}/message`
- `/session/{id}/children`
- `/session/{id}/todo`
- `/session/{id}/thread`
- `/session/{id}/query`
- `/session/{id}/handoff`
- `/session/{id}/worker-return`
- optional `/session/{id}/episode`
- `/session/{id}/summarize`
- `/session/{id}/shell`
- `/session/{id}/diff`
- `/session/{id}/revert`
- `/permissions/...`
- `/event`
- `/tui/...`

The API should treat handoff state and worker returns as first-class objects. Episodes, if added, should be explicit derived artifacts rather than vague prose summaries.

## Storage Strategy

Prefer local-first structured storage.

V1 recommendation:

- SQLite for indexed relational state
- filesystem blob storage for large tool outputs and snapshots

Suggested tables:

- `projects`
- `sessions`
- `messages`
- `message_parts`
- `artifacts`
- `handoff_states`
- `worker_returns`
- optional `episodes`
- optional `episode_artifacts`
- `todos`
- `permissions`
- `model_events`
- `tool_calls`

This is slightly more opinionated than the file-backed JSON seen in the reverse-engineering notes, but it is a better open-source foundation for queryability, migrations, and UI performance. We can still export/import JSON for portability.

## UI Plan

The UI should feel like opencode with swarm-native visibility layered in.

Preserve:

- overall terminal aesthetic
- theme system
- session transcript rendering
- prompt ergonomics
- approval flows
- keyboard-first navigation

Add:

- thread lane or child-session panel
- worker return cards with status and outcomes
- compaction/handoff state indicators
- model-slot badges per step
- orchestration timeline view
- active context meter and compaction markers
- clearer distinction between direct steps, queries, and worker threads

Important UX rule: the swarm should be visible when useful and ignorable when not.

## Package Layout Recommendation

Use explicit boundaries that make selective code adoption easy.

```text
packages/
  core/         # session graph, handoff state, worker returns, orchestration
  server/       # control plane api, event streaming
  tools/        # built-in tools and permission gates
  models/       # provider adapters and role router
  tui/          # terminal ui, theming, session rendering
  app/          # shared ui components if desktop/web are added
  sdk/          # typed client for local api
  plugins/      # extension surface
```

If we choose to fork or vendor parts of opencode later, this separation gives us a place to slot preserved UI and SDK pieces without contaminating the runtime core.

Even without a fork, this layout gives us clear landing zones for copied/adapted opencode subsystems versus rewritten swarm-native core logic.

## Suggested Build Order

## Phase 0. Foundation

- create repo skeleton
- write README with first line explicitly saying it is inspired by Slate
- identify opencode copy/adapt candidates before writing major infrastructure
- create an adoption map: `copy`, `adapt`, `rewrite`
- define core types: session, message, part, artifact, handoff state, worker return
- lock provider abstraction boundaries before session logic spreads provider assumptions everywhere
- stand up local server and event stream

Success condition: we know what we are reusing before we start rebuilding solved problems.

## Phase 1. Single-Session Runtime

- bring over reusable UI/control-plane/tooling infrastructure from opencode-shaped patterns
- implement provider adapters and multi-provider config first
- implement role-based model slotting early, even before swarm execution
- basic session CRUD
- prompt loop
- tool execution and persistence
- direct single-thread workflow only

Success condition: usable opencode-like local agent without swarm behavior and with provider portability intact.

## Phase 2. Thread Runtime

- add `query` and `thread` child session types
- implement alias-based thread reuse
- implement bounded thread execution contract
- persist child sessions and structured reintegration events

Success condition: parent can spawn/read/reuse children with persisted lineage.

## Phase 3. Reintegration Contract

- define worker return schema and UI rendering
- require every bounded child run to emit a structured worker return
- make parent consume worker returns by default
- add worker-return references to prompts and API
- if useful, define a derived `Episode` view after worker returns are stable

Success condition: thread weaving is real, not just child-chat.

## Phase 4. Rolling Handoff And Compaction

- add one rolling handoff/checkpoint object per session
- add marker-stage and writeback-stage compaction states
- add compaction hooks
- route compaction through dedicated model slot
- preserve high-value artifacts and worker returns during compaction
- implement a real explicit summarize/compact path

Success condition: long sessions stay usable without severe quality collapse.

## Phase 5. Swarm-Native UX

- add thread panel, worker-return cards, orchestration timeline
- expose child permissions and model slots in UI
- improve resume/fork/share flows

Success condition: the product visibly communicates the swarm runtime.

## Phase 6. Extensibility

- MCP integration
- plugin hooks
- skills system
- custom agents/instructions

Success condition: runtime is usable beyond built-in tools.

## Phase 7. Hardening

- crash recovery
- replay and export
- benchmark harnesses
- end-to-end dogfooding on large repos
- performance tuning for transcript rendering and storage
- provider conformance tests across multiple backends

## Evaluation Plan

We need to test the architecture, not just whether prompts look good.

Primary metrics:

- task completion rate on long-horizon code changes
- premature-completion rate
- context failure rate after long runs
- successful reintegration rate for threaded work
- cost per completed task
- latency per orchestrator cycle
- usability of resumed sessions after compaction
- provider portability regressions across supported backends
- quality/cost wins from role-specific model routing

Qualitative review prompts:

- Did the system spawn threads only when justified?
- Were worker returns actually useful downstream?
- Could a user understand what happened from the UI alone?
- Did compaction preserve the right facts?
- Did the product still feel as clean as opencode?

## Key Risks

- derived episode objects become vague prose and stop being machine-useful
- thread spawning becomes overactive and hurts latency
- compaction degrades critical state
- the UI becomes cluttered by swarm internals
- model routing becomes hard to understand or configure
- provider adapters leak backend quirks into runtime logic
- model-slot routing becomes opaque or too hard to tune
- persistence design makes replay hard or expensive

## Decisions I Recommend Locking Early

- one mutable handoff/checkpoint object exists per session
- marker-stage and writeback-stage compaction are separate runtime concepts
- worker returns are the primary parent-child reintegration contract
- alias-backed threads are first-class persisted objects
- child execution is bounded by contract
- queries and threads are distinct modes
- queries are an internal/runtime primitive first, not a UX guarantee
- model routing is explicit and inspectable
- provider support remains adapter-driven and backend-agnostic at the session/runtime layer
- per-role model selection is first-class and user-configurable
- the UI keeps opencode-level polish instead of becoming a debug console
- simple tasks stay single-threaded by default

## Immediate Next Step

Before writing implementation code, do these first:

1. Make an opencode subsystem adoption map: `copy`, `adapt`, `rewrite`.
2. Decide the initial storage and session graph schema.
3. Lock the first thread/handoff/worker-return contract before touching TUI-heavy work.

My recommendation is:

1. Copy/adapt UI, control-plane, and tooling infrastructure aggressively.
2. Rewrite the runtime core cleanly around orchestrator, threads, handoff state, and worker returns.
3. Add swarm-native UI affordances only after the core thread loop is real.

This keeps the product feeling close to opencode while avoiding the mistake of preserving a non-swarm-native core just because it already exists.
