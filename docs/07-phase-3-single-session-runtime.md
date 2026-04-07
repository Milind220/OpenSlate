# Phase 3: Single-Session Runtime

This document turns Phase 3 from `docs/05-openslate-implementation-plan.md` into an implementation-ready build spec.

OpenSlate is aiming to become an open-source, swarm-native coding agent inspired by Slate while borrowing heavily from opencode wherever that is the pragmatic move.

Phase 3 is intentionally not swarm execution yet.

Its job is to create a real local agent runtime that:

- persists sessions and messages correctly
- talks to the provider/model layer through role-based routing
- exposes a local control plane
- streams runtime updates
- is built in a way that later supports:
  - child threads
  - structured reintegration
  - rolling handoff state
  - compaction

If this phase is weak, all later swarm behavior will be fake or brittle.

## Phase Goal

Ship a working terminal-first, single-session OpenSlate runtime with:

- session creation and persistence
- message persistence
- a basic orchestrator loop using the `primary` model slot
- a real local server/control plane
- an event stream for runtime updates

No child threads yet.
No query mode yet.
No compaction logic yet.
No fancy UI yet.

## What Phase 3 Must Prove

By the end of this phase, OpenSlate should be able to:

1. create a session
2. accept a user message
3. persist that message
4. run a single-session model turn through `ModelRouter`
5. persist the assistant response as structured message parts
6. expose the full interaction through the local control plane
7. stream session/message lifecycle events to a client

That is the first real proof that OpenSlate is a runtime and not just package scaffolding.

## Non-Goals

Do not implement any of the following in Phase 3:

- child thread execution
- query sessions
- worker returns beyond type placeholders
- handoff mutation logic beyond maybe initial placeholder creation
- compaction behavior
- tool execution beyond placeholder hooks
- swarm-native visualizations
- plugin breadth
- desktop/web shells

These are later phases.

## Architectural Positioning

This phase should borrow aggressively from opencode where it helps:

- local control-plane shape
- typed server/client boundary
- session/message rendering assumptions
- provider integration patterns

But it should be designed for Slate-like runtime evolution:

- session graph, even if only one session kind is active at runtime initially
- structured message parts, not raw transcript blobs
- persistence that can later support child sessions and reintegration
- event stream that can later carry thread and compaction state

## Packages To Touch

Primary packages for this phase:

- `packages/core`
- `packages/server`
- `packages/models`
- `packages/sdk`

Secondary packages:

- `packages/tui`
  only if needed for a tiny smoke entrypoint
- `packages/tools`
  only for placeholder interfaces, not real tool execution yet

## Runtime Objects In Scope

Phase 3 actively uses these objects:

- `Session`
- `Message`
- `MessagePart`
- `Artifact` (only if needed for persistence structure)

Phase 3 should keep placeholders ready for later use:

- `ThreadSession`
- `QuerySession`
- `HandoffState`
- `WorkerReturn`

Important rule:

Even though threads are not active yet, Phase 3 must not lock the storage or API into a flat-chat-only design.

## Build Order Inside Phase 3

## Step 1. Storage Shape

First, lock the persistence shape.

Use a minimal durable store.
Recommended:

- SQLite for structured rows
- optional file/blob storage later

Minimum persisted entities for this phase:

### sessions

- `id`
- `project_id`
- `kind`
- `status`
- `parent_id`
- `alias`
- `title`
- `created_at`
- `updated_at`

### messages

- `id`
- `session_id`
- `role`
- `created_at`

### message_parts

- `id`
- `message_id`
- `kind`
- `position`
- `payload_json`

Optional for this phase:

### handoff_states

- `id`
- `session_id`
- `kind`
- `compressed_summary`
- `last_compression_index`
- `last_prompt_tokens`
- `marker_completed`
- `updated_at`

Even if handoff logic is not active yet, it is acceptable to create the table now if that makes later evolution cleaner.

### Why this storage order matters

Do not begin with server routes or model calls.
If storage shape is wrong, everything above it will be wrong.

## Step 2. Core Repositories / Services

Implement repository or service modules in `packages/core` for:

- `SessionStore`
- `MessageStore`
- optional `HandoffStore`

Minimum behaviors:

### SessionStore

- create session
- get session by id
- list sessions
- update session status/title/timestamps

### MessageStore

- append message with parts
- list messages for session in order
- get message by id

### Optional HandoffStore

- create initial handoff state when session is created
- get handoff by session id

Design rule:

Repositories should stay provider-agnostic and server-agnostic.
They are runtime/storage primitives.

## Step 3. Session Service

Add a higher-level service in `packages/core` that coordinates single-session behavior.

Suggested name:

- `SessionService`

Responsibilities:

- create a new primary session
- accept a user message
- persist the user message
- call the orchestrator/model layer
- persist the assistant response
- emit runtime events

Do not put HTTP concerns here.
Do not put UI concerns here.

This should be the first actual runtime seam.

## Step 4. Minimal Single-Session Orchestrator

Implement a very small orchestrator loop for the single-session case.

Suggested behavior:

1. load session state
2. load message history
3. construct model input from the session transcript
4. call `ModelRouter.complete("primary", ...)`
5. translate the model output into one or more assistant `MessagePart`s
6. persist the assistant message
7. emit events

Important:

- no child sessions
- no tools yet
- no compaction yet
- no explicit planning system yet

This is not the final orchestrator.
It is the minimal viable runtime loop.

## Step 5. Local Control Plane

Replace the placeholder server with a real local control-plane surface in `packages/server`.

Recommended routes for this phase:

### `GET /health`

Returns service health.

### `POST /sessions`

Create a primary session.

Request:

- optional `title`
- optional `projectId`

Response:

- created session object

### `GET /sessions/:id`

Return session metadata.

### `GET /sessions/:id/messages`

Return ordered session messages and parts.

### `POST /sessions/:id/messages`

Append a user message and trigger one single-session model turn.

Request:

- `content`

Response:

- created user message
- created assistant message
- maybe event ids or usage metadata

Design rule:

Keep the routes narrow.
Do not add thread routes, summarize routes, or tool routes yet.

## Step 6. Event Stream

Add a minimal event stream in `packages/server`.

Recommended events for this phase:

- `session.created`
- `message.created`
- `assistant.started`
- `assistant.completed`
- `session.updated`

This can be SSE if that is the simplest local path.

The point is not sophistication.
The point is to establish the runtime pattern that later phases will extend with:

- thread events
- reintegration events
- compaction events

## Step 7. SDK Surface

In `packages/sdk`, create the minimal typed client shape for the routes above.

Required client capabilities:

- create session
- fetch session
- fetch messages
- send message
- subscribe to event stream if implemented in this phase

Do not overgenerate the SDK yet.
Just make the typed boundary real.

## Step 8. Minimal Smoke Entry

Optional but recommended:

Add a tiny local smoke entrypoint so you can prove the runtime end-to-end without full UI work.

Examples:

- a tiny CLI runner in `packages/tui`
- or a simple script that:
  - starts the server
  - creates a session
  - sends a user message
  - prints the assistant response

The point is to dogfood the control plane immediately.

## Data Shape Guidance

Assistant responses should already be stored as structured parts, not one opaque blob.

For this phase, a minimal assistant message can use:

- `text`
- optional `reasoning`
- optional `status`

Do not wait for tool execution to make message parts real.

## Package-Level Work Breakdown

## `packages/core`

Implement:

- storage schemas/interfaces
- repositories/services
- single-session orchestrator loop
- message-part translation helper(s)

## `packages/server`

Implement:

- local server bootstrap
- routes for session/message flow
- event stream endpoint if included
- wiring to `SessionService`

## `packages/models`

Use existing provider/router foundation.

Only add what is necessary for:

- one real `complete("primary", ...)` path
- usage metadata handling if available

Do not broaden provider/auth scope unless a Phase 3 blocker demands it.

## `packages/sdk`

Implement:

- typed client calls for Phase 3 routes

## `packages/tui`

Optional:

- tiny smoke entry only

## Concrete Success Criteria

Phase 3 is complete when all of the following are true:

1. `bun run typecheck` passes
2. `bun run test` passes
3. a local server can start
4. `POST /sessions` creates a session
5. `POST /sessions/:id/messages` stores a user message and produces an assistant message through `ModelRouter`
6. `GET /sessions/:id/messages` returns the persisted structured transcript
7. runtime events are emitted during the turn
8. the architecture still leaves clean room for threads, reintegration, and handoff state later

## The Smallest Real End-To-End Demo

The minimum acceptable demo for this phase is:

1. start the local server
2. create a session
3. send: `Summarize what this repository is for based on the docs`
4. receive an assistant response through the `primary` slot
5. confirm that:
  - session row exists
  - user message exists
  - assistant message exists
  - assistant message parts are structured
  - events fired during the turn

If this works, the runtime is real.

## Risks To Avoid

### 1. Server-first bloat

Do not build a giant API before the core services are real.

### 2. Provider leakage

Do not let request handlers know about provider-specific quirks.

### 3. Flat transcript trap

Do not store messages as one giant string transcript.
That would fight the whole future architecture.

### 4. Premature tool loop

Do not start building tool execution in the middle of Phase 3.
That belongs in Phase 4.

### 5. Premature swarm abstractions

Do not try to activate child sessions just because the types exist.

## Founder-Owned Decisions In This Phase

These decisions should be made consciously, not left to drift:

- exact storage engine choice for initial implementation
- whether `HandoffState` table exists now or lands in Phase 7
- exact shape of the first control-plane routes
- exact event names for the single-session runtime
- exact translation from model output into `MessagePart[]`

## Recommended Build Sequence

If one agent were executing this phase, the order should be:

1. add storage package/module and schemas
2. implement `SessionStore` and `MessageStore`
3. implement `SessionService`
4. implement minimal orchestrator loop via `ModelRouter.complete("primary", ...)`
5. replace placeholder server with real routes
6. add event stream
7. add SDK client helpers
8. add one smoke script or minimal TUI entry
9. verify the end-to-end demo

## What This Unlocks Next

If Phase 3 is done correctly, then Phase 4 and Phase 5 become straightforward:

- tools can be added to a real runtime instead of a stub
- child sessions can be added to a real session graph instead of a chat toy
- reintegration can extend a real transcript/event model
- handoff state can plug into a real session lifecycle

That is the point.

Phase 3 is where OpenSlate stops being a design and starts being a runtime.
