# Phase 4: First Swarm Runtime

This document is the implementation-ready plan for the next phase after the Phase 3 single-session runtime.

It intentionally tightens the earlier roadmap.

Instead of spending a whole phase building a broad single-agent tool runtime first, this phase focuses on the smallest amount of tool support required to make OpenSlate genuinely swarm-native.

That means the goal is not:

- build a very good single-agent coding CLI

The goal is:

- build the first real orchestrator + child-thread runtime

This is the point where OpenSlate should start feeling meaningfully different from plain opencode-style single-agent systems.

## Why This Phase Exists

The Slate-inspired architecture we are trying to reproduce is built around:

- one strategic orchestrator
- persistent child threads
- alias-based child reuse
- bounded child execution
- structured reintegration
- later, rolling memory and compaction

Phase 3 gave us the substrate:

- provider-portable model routing
- local control plane
- session/message persistence
- event streaming
- a functioning single-session runtime

That substrate is enough.

From this point on, further investment in “nice single-agent mode” would be fake progress.

## What Phase 4 Must Prove

By the end of this phase, OpenSlate should be able to:

1. accept a parent/orchestrator task
2. spawn a real child thread session
3. give that child a limited capability/tool set
4. let the child do bounded work
5. persist the child independently from the parent
6. return a structured `WorkerReturn` to the parent
7. let the parent continue based on that structured result
8. reuse the same child session when the same alias is invoked again

If those eight things work, OpenSlate becomes swarm-native in the only sense that really matters.

## Non-Goals

Do not implement all of this yet:

- full compaction
- query mode heuristics beyond placeholders
- broad plugin/MCP work
- polished swarm-native TUI
- broad tool surface parity with opencode or Slate
- advanced multi-child scheduling heuristics
- perfect parallelism semantics
- exact hidden Slate compaction trigger behavior

This phase is about the first real thread runtime, not the final product surface.

## Phase Shift From The Original Plan

This phase intentionally compresses and partially reorders the earlier roadmap.

Instead of:

- broad tool runtime first
- thread runtime second
- reintegration third

This phase does:

- minimal tool runtime needed for threads
- thread runtime
- structured reintegration

Because those three things are one system.

## Core Design Principle

The parent should remain strategic.

The child thread should be given a tactical subproblem with bounded permissions and bounded expectations.

The parent should not consume the child transcript directly by default.
It should consume a structured `WorkerReturn`.

That is the center of gravity for this phase.

## Packages To Touch

Primary:

- `packages/core`
- `packages/tools`
- `packages/server`
- `packages/sdk`

Secondary:

- `packages/models`
  only if needed for role-slot use beyond `primary`
- `packages/tui`
  only for a very small smoke or manual-debug entrypoint

## Runtime Objects In Scope

This phase should actively use and/or implement:

- `Session`
- `ThreadSession`
- optional placeholder `QuerySession`
- `Message`
- `MessagePart`
- `Artifact`
- `WorkerReturn`

This phase should keep `HandoffState` mostly dormant except for schema compatibility.

Compaction is not the focus yet.

## Architectural Shape For This Phase

Target runtime flow:

1. user talks to parent session
2. parent decides to do work inline or dispatch a child thread
3. parent spawns or reuses child thread by alias
4. child runs a bounded tactical loop with limited tools
5. child stops and emits one `WorkerReturn`
6. parent persists the `WorkerReturn`
7. parent continues from the `WorkerReturn`, not from the raw child transcript by default

This is the first concrete implementation of thread weaving.

## Build Order Inside Phase 4

## Step 1. Minimal Tool Runtime

Build the narrowest set of tools required for a thread to do useful coding work.

Recommended minimum set:

- `read_file`
- `glob_files`
- `grep_content`
- `write_file`
- `apply_patch`
- `shell`

Optional if easy:

- `git_status`
- `git_diff`

Do not build a giant tool catalog.

### Tool requirements

Each tool should have:

- typed input
- typed output
- capability name for permission gating
- persisted call metadata
- persisted result artifact if output is meaningful

### Why this tool subset

This is the minimum required for:

- inspect code
- search code
- edit code
- run commands

That is enough to prove child threads are real workers.

## Step 2. Tool Permission Model

Add the first real permission/capability model for child threads.

At minimum, support:

- `read`
- `write`
- `search`
- `shell`

Rules:

- child thread capabilities are an explicit subset of parent capabilities
- a child cannot gain permissions the parent does not have
- permissions are persisted on the child session
- permissions are visible in runtime data and emitted events

This is important because the reverse-engineering evidence strongly suggests child sessions carry scoped tool sets.

## Step 3. ThreadSession Storage And Lifecycle

Extend the current session runtime to fully support `ThreadSession` as a real active session kind.

Required fields already exist or should be used meaningfully:

- `kind = "thread"`
- `parentId`
- `alias`
- session status

Add or ensure support for:

- child task
- enabled capabilities/tool set
- child lifecycle status:
  - `active`
  - `completed`
  - `failed`
  - `blocked`

### Required operations

- create child thread
- get child thread by id
- list children for a parent
- find child thread by `(parentId, alias)`
- reuse existing child thread when alias matches

Important:

Alias reuse is not a nice-to-have.
It is a first-class runtime behavior in this architecture.

## Step 4. Child Runtime Loop

Implement the first bounded child runtime loop.

This loop should be separate from the parent loop, even if it reuses some internal code.

Suggested behavior:

1. load child session
2. load child history
3. build child prompt from:
  - child task
  - recent parent context as needed
  - optional prior child history when alias is reused
  - allowed capabilities
4. run model turn using the `execute` slot
5. allow tool calls during the child run
6. stop at a bounded completion condition
7. emit one `WorkerReturn`

### Important design rule

Do not make the child a long-lived autonomous loop yet.

For this phase, a child run should be bounded to one tactical job execution cycle.

That is enough to prove the architecture.

## Step 5. Structured Tool-Calling Loop

This is the first place where the runtime stops being “chat with persistence” and becomes a coding agent.

Implement a minimal structured loop for a child thread:

1. child gets task
2. child can either:
   - respond with final bounded result
   - request one or more tool calls
3. runtime executes tools
4. tool results are persisted as message parts and/or artifacts
5. child receives tool results and continues
6. child eventually emits bounded completion

### Constraints

- keep the loop small and inspectable
- avoid adding planning frameworks here
- do not add recursive child spawning yet unless it falls out naturally and cheaply

## Step 6. WorkerReturn

Implement `WorkerReturn` as a real persisted runtime object.

Minimum fields:

- `id`
- `parentSessionId`
- `childSessionId`
- `childType`
- `alias`
- `task`
- `status`
- `output`
- `artifactRefs[]`
- `traceRef`
- `startedAt`
- `finishedAt`

### Behavioral rules

- every bounded child run produces exactly one `WorkerReturn`
- parent consumes `WorkerReturn` by default
- child transcript remains available for drill-down, but is not the primary reintegration payload

This is the most important object in the phase.

## Step 7. Parent Reintegration

Extend the parent/orchestrator path so it can:

- dispatch a child thread
- wait for the bounded child run to complete
- receive `WorkerReturn`
- persist and reference it
- produce a parent response informed by that return

For this phase, the parent can do reintegration serially.

Parallel orchestration can come later.

### Reintegration rule

The parent should not have to scrape the child transcript.

The parent should receive something shaped like:

- child id
- alias
- task
- status
- output summary
- trace/artifact refs

That is the behavior we are trying to preserve from Slate.

## Step 8. Alias Reuse

Implement explicit alias reuse behavior.

Required semantics:

- first use of alias creates a new child thread session
- later use of the same alias under the same parent reuses the same child session
- reused child session preserves prior history
- reused child session can emit a fresh `WorkerReturn` for the new bounded run

### Smoke case

This phase is not complete until alias reuse has been proven in a real end-to-end run.

## Step 9. Control-Plane Routes

Extend the local server with the minimum routes needed to expose thread behavior.

Recommended routes:

### `POST /sessions/:id/threads`

Create or reuse a child thread.

Request:

- `task`
- optional `alias`
- optional `capabilities[]`

Response:

- child session

### `GET /sessions/:id/children`

List child sessions.

### `GET /sessions/:id/worker-returns`

List parent worker returns.

### `POST /sessions/:id/messages`

This can remain the parent entrypoint, but should now allow the parent to internally dispatch child threads as part of the turn.

Do not overbuild the HTTP surface yet.

## Step 10. Event Stream Extension

Add the first swarm-relevant runtime events.

Recommended events:

- `thread.created`
- `thread.reused`
- `thread.started`
- `thread.completed`
- `thread.failed`
- `worker_return.created`

The goal is visibility and debuggability.

## Package-Level Work Breakdown

## `packages/tools`

Implement:

- tool interfaces
- tool registry
- minimum built-in tool set
- tool execution result types

## `packages/core`

Implement:

- thread session persistence/lifecycle
- child runtime loop
- tool-call loop integration
- `WorkerReturn` persistence
- parent reintegration path
- alias lookup/reuse
- new runtime events

## `packages/server`

Implement:

- thread routes
- children listing routes
- worker-return routes
- event stream updates

## `packages/sdk`

Implement:

- typed thread/session/worker-return client calls

## `packages/models`

Only adjust if needed for:

- `execute` slot usage
- child-specific model routing
- tool-calling compatibility quirks

## Concrete Success Criteria

Phase 4 is complete when all of the following are true:

1. `bun run typecheck` passes
2. `bun run test` passes
3. a parent session can spawn a child thread session
4. a child thread can perform at least one useful bounded code task using the minimal tool set
5. the child session is persisted independently
6. the child run emits one `WorkerReturn`
7. the parent can consume that `WorkerReturn`
8. the same alias can be reused and resolves to the same child session
9. events make the thread lifecycle visible

## Minimum Acceptable Demo

The minimum demo for this phase should be something like:

1. create a parent session
2. ask the parent to inspect a repo and answer a focused question by delegating to a child thread
3. child thread uses:
   - file read
   - glob or grep
4. child completes and emits `WorkerReturn`
5. parent answers based on that `WorkerReturn`
6. ask a follow-up that reuses the same alias
7. verify the same child session id is reused

If that works, OpenSlate is no longer just single-agent infrastructure.

## Suggested First Demo Task

A good first bounded thread task is:

- parent asks child alias `doc-check` to inspect docs and summarize what the repo is for

Why this is good:

- it uses search/read tools
- it does not require complicated editing yet
- alias reuse is easy to test
- parent reintegration is easy to inspect

## Risks To Avoid

### 1. Overbuilding tools before threads are real

If you spend too long making the tool catalog impressive, you have missed the point of the phase.

### 2. Fake child threads

If the parent is really just stuffing child output into a transcript without real child persistence and structured return objects, that is not the architecture.

### 3. Transcript scraping reintegration

Do not make the parent read arbitrary child logs to decide what happened.

### 4. Premature compaction work

Do not get pulled into rolling handoff/compaction yet unless it directly blocks child runtime correctness.

### 5. Premature parallelism

One correct child thread path is worth more than an elaborate but brittle multi-thread scheduler.

## Founder-Owned Decisions In This Phase

These decisions matter enough that they should be made consciously:

- exact bounded stop condition for a child run
- exact minimum tool set
- exact alias reuse semantics
- exact `WorkerReturn` fields
- whether parent dispatch is explicit-only at first or can emerge from the parent agent loop immediately

## Recommended Build Sequence

If one coding agent were executing this phase, the order should be:

1. implement the minimum tool registry and tool interfaces
2. implement the minimum built-in tool set
3. extend session persistence for real thread lifecycle and alias lookup
4. implement child runtime loop using the `execute` slot
5. implement `WorkerReturn` persistence
6. implement parent reintegration path
7. expose minimal thread routes and events
8. prove alias reuse with an end-to-end smoke task

## What This Unlocks Next

If Phase 4 is done correctly, then the later phases become much more grounded:

- compaction can be attached to real parent/child behavior
- query mode can be introduced as a distinct internal primitive
- swarm-native UX can render actual thread state instead of mocks
- broader tools and plugins can extend a real runtime rather than scaffolding

This is the phase where OpenSlate should first feel like “open-source Slate” rather than “yet another coding CLI.”
