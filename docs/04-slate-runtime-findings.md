# Slate Runtime Findings

This document captures the final architecture-relevant conclusions from the reverse-engineering passes in `/Users/milindsharma/Developer/slate-npm-disassembled`.

Use this alongside `docs/01-slate-research.md` and `docs/02-openslate-plan.md`.

## Bottom Line

We know enough to design and build OpenSlate.

The remaining mystery is the exact fresh automatic trigger for non-empty compaction writeback. That is no longer a blocker for the architecture.

## Locked Findings

### 1. Parent/child orchestration is real

- parent sessions invoke structured orchestration
- child sessions are persisted independently
- child lineage is explicit
- parent reintegration is explicit and structured

### 2. Alias-backed threads are first-class

- reusing the same thread alias reuses the same child session id
- reused child sessions preserve prior context strongly enough to remember earlier work
- alias should be treated as a stable child-session lookup key, not just a label

### 3. Reintegration is structured

The strongest observed shape is a parent tool response containing:

- `_meta.childSessionIds`
- `sequence[].thread.{task,status,trace,output}`

This means parent reintegration should be modeled as a real runtime object, not a freeform child summary.

### 4. Rolling handoff state is real

Each session appears to maintain a mutable rolling handoff/checkpoint object with fields like:

- `__rollingCompressionState`
- `compressedSummary`
- `lastCompressionIndex`
- `lastPromptTokens`

The handoff object is updated in place over time.

### 5. Compaction is staged

The strongest supported model is:

- marker-stage compaction
- writeback-stage compaction

Historical storage shows marker-like handoffs such as:

- `{ "completed": false }`

Historical storage also shows rolling-state handoffs with:

- non-empty `compressedSummary`
- non-zero `lastCompressionIndex`

These should be modeled as distinct runtime states.

### 6. Prompt rebuilding consumes summary state

Static evidence and historical sessions strongly support a prompt rebuild model based on:

- written-back summary
- recent message window

This is supported by:

- bundle logic reading `compressedSummary`
- bundle logic rebuilding from `Math.max(lastCompressionIndex, ...)`
- historical prompt-token collapse after writeback

### 7. Explicit compaction should exist, but Slate’s current `/compact` is not the model

The current Slate TUI `/compact` path is effectively a no-op info branch.

At the same time, typed surfaces still expose:

- `session.compact`
- `session.compacted`
- `POST /session/{id}/summarize`

So OpenSlate should support real explicit compaction, but should not copy Slate's current `/compact` UX literally.

### 8. `query` exists, but should be treated as an internal/runtime primitive first

Bundle logic shows `system.query(...)` exists.

However, normal live prompt paths did not naturally choose it for tested tasks. OpenSlate should therefore treat query as a runtime primitive, not as a user-visible guarantee.

## Strong Inferences

- compaction writeback depends on more than absolute prompt token count
- compaction likely depends on hidden checkpoint/marker logic, token delta since checkpoint, or specific turn shape
- child sessions likely compact independently at least at the marker stage
- full rolling-summary writeback is only directly proven for parent sessions

## What We Failed To Prove Fresh

- a fresh current-version session that flips `compressedSummary` from empty to non-empty
- the exact hidden trigger for marker insertion and writeback
- a reachable current Slate wrapper path that exposes the summarize route for live Slate-created sessions in this environment

## Final Design Implications For OpenSlate

- model `ThreadSession` as a persisted first-class object
- model one mutable rolling handoff/checkpoint object per session
- model marker-stage and writeback-stage compaction separately
- use summary + recent history for prompt rebuilding
- make explicit compaction a real callable path
- use structured worker returns as the main parent-child reintegration mechanism
- treat any first-class `Episode` object as an OpenSlate design choice layered over worker returns, not as a detail we know Slate literally persists

## Recommendation

Stop reverse-engineering for now and move into implementation planning.

The current knowledge is enough to:

- lock the session graph
- lock the handoff/checkpoint model
- lock alias-based child reuse
- lock the worker-return reintegration contract
- lock the compaction architecture at the design level
