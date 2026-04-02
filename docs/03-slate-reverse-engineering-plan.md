# Slate Reverse Engineering Plan

Purpose: reduce the implementation uncertainty for OpenSlate by extracting architecture-level and implementation-level details from the local Slate install/binary and related local artifacts.

This plan assumes the user has explicit permission from the Slate founders to perform this reverse-engineering work for an open-source inspired project.

## Goal

We do not need to perfectly recover Slate.

We need to answer the few high-value questions that materially affect our architecture:

- what a `thread` is in runtime terms
- how `thread` differs from `query`
- what a worker run returns to the parent
- whether `Episode`-like objects exist explicitly and what they contain
- how compaction works in practice
- how parent/child sessions are persisted and resumed
- how child progress is surfaced to the UI/control plane
- which parts are local runtime behavior versus remote service behavior

## Non-Goals

- recovering every hidden prompt string
- cloning every UX detail
- copying proprietary wording blindly
- extracting unrelated auth secrets or personal data
- treating one recovered version as guaranteed truth for all future Slate versions

## High-Value Unknowns

These are the core engineering questions to answer.

### 1. Thread Lifecycle

- exact call path for `system.thread(...)`
- create vs alias reuse logic
- thread state transitions
- stop/bounded-completion condition
- abort/cancel behavior
- whether threads can recurse

### 2. Query Lifecycle

- exact differences between `system.query(...)` and `system.thread(...)`
- whether query is tool-less by contract or by config
- whether query results are stored differently from thread results

### 3. Episode Or Return Object

- exact return object shape from a bounded child run
- whether it is stored as:
  - message parts
  - standalone artifacts
  - session summaries
  - hidden metadata
- how it is referenced later by parent or sibling threads

### 4. Reintegration Semantics

- how the parent is notified of child completion
- whether the parent receives a summary, object, transcript slice, or reference id
- how multiple child returns are merged
- how conflicts or incomplete work are represented

### 5. Compaction / Context Management

- exact trigger conditions
- marker insertion format
- compaction writeback path
- what gets retained versus dropped
- whether compaction is thread-local, parent-local, or both
- relationship between compaction and prior episodes

### 6. Persistence Model

- on-disk object model for:
  - projects
  - sessions
  - messages
  - child linkage
  - summaries
  - episodes or analogous artifacts
  - tool calls
  - cache/checkpoint markers

### 7. Event / UI Model

- streamed events for child creation, update, completion, and reintegration
- how child sessions are surfaced in the local API
- what the UI learns versus what remains internal

### 8. Model Routing

- exact role-slot config shape
- where role selection happens in code
- whether thread/query/compaction each have their own route or just config overlays

## Investigation Strategy

Use a layered strategy, starting with the cheapest and highest-signal techniques.

## Phase 1. Static JS/Bun Bundle Recovery

Target: recover as much orchestration and storage logic as possible from the packaged JS/Bun payload before touching native tooling.

Methods:

- locate all shipped JS bundles, source maps, manifests, and embedded asset tables
- reconstruct and prettify source where possible
- search for:
  - `orchestrate`
  - `system.thread`
  - `system.query`
  - `childSessionIds`
  - `parentID`
  - `summary`
  - `compress`
  - `traceIds`
  - `existingMessages`
  - `behaviorMode`
  - `assistant_control_data`
  - `episode`
  - `handoff`
  - `cache`
  - `/session/`
  - `/v3/stream`
- map call graphs for:
  - thread spawn
  - query spawn
  - reintegration
  - compaction
  - storage read/write

Desired outputs:

- function-level map of orchestration paths
- candidate schemas for child runs and returns
- concrete evidence table with file/line/function references

## Phase 2. Local Storage Archaeology

Target: infer runtime object models from persisted state on disk.

Methods:

- inspect current and freshly generated state under paths such as:
  - `~/.slate/`
  - `~/.local/share/slate/`
  - `~/.local/state/slate/`
  - project-local `.slate/` paths if any
- compare before/after snapshots for controlled runs:
  - simple inline task
  - query-like research task
  - thread-heavy decomposition task
  - long enough task to trigger compaction
- identify artifacts created at each step
- correlate message ids, session ids, parent ids, and child ids

Desired outputs:

- actual storage object taxonomy
- parent/child lineage map
- evidence of summary markers or episode-like objects
- evidence of cache/checkpoint behavior

## Phase 3. Local API / Control Plane Tracing

Target: understand the local contract between UI/CLI and runtime.

Methods:

- locate server routes in bundled code
- if server mode or local endpoints can be exercised safely, trace requests and responses
- inspect event streams or emitted child-session metadata
- capture route payloads for:
  - session creation
  - message send
  - child thread/query creation
  - summarize/compaction
  - shell/diff/todo operations

Desired outputs:

- local API map with request/response shapes
- event timeline for thread lifecycle
- concrete answer on whether episodes are exposed directly or encoded indirectly

## Phase 4. Runtime Instrumentation

Target: observe behavior that static analysis cannot resolve.

Methods:

- instrument JS execution points around orchestration helpers and storage writes
- intercept function arguments/returns for thread/query/compaction paths
- observe child creation and reintegration in real runs
- if needed, use dynamic instrumentation tools to hook native or Bun runtime boundaries

Tool options:

- Frida for dynamic hooks
- `lldb` for process inspection
- platform-native tracing where appropriate

Desired outputs:

- actual runtime argument and return shapes
- confirmed bounded stop conditions for child runs
- evidence for compaction trigger thresholds or marker insertion timing

## Phase 5. Native Boundary Analysis

Target: inspect only the native edges that static/dynamic JS analysis cannot explain.

Methods:

- use professional RE tools like Ghidra, Hopper, or Binary Ninja on native binaries or Bun-packed native boundaries
- focus on:
  - PTY/shell interfaces
  - bundled runtime shims
  - possible storage/network wrappers

Do not start here unless earlier phases leave critical gaps.

Desired outputs:

- confirmation of native support layers
- clarification of shell/PTY/event plumbing if not clear from JS

## Phase 6. Controlled Experiment Matrix

Target: make runtime behavior legible through carefully chosen tasks.

Run small, observable prompts designed to isolate one mechanism at a time.

Suggested experiments:

1. `query-only`
Ask for a small research answer with no code change. Goal: see whether `query` sessions are created and how they persist.

2. `single-thread tactical`
Ask for a narrow code edit. Goal: see whether the main session stays inline or spawns a child.

3. `parallelizable task`
Ask for something naturally decomposable. Goal: observe multiple child sessions and reintegration shape.

4. `alias reuse`
Give a follow-up that should continue previous child work. Goal: confirm alias reuse and prior-history injection.

5. `compaction trigger`
Run a sufficiently long session. Goal: capture summary markers, storage updates, and new prompt structure.

6. `abort/cancel`
Interrupt a long child run. Goal: understand cancel propagation and persisted state.

## Recommended Tools

Use the least invasive tool that answers the question.

### Bundle / JS Recovery

- source map recovery tools
- Bun bundle unpacking/deobfuscation tools
- prettifiers / AST viewers
- ripgrep-based code search

### Binary / Native RE

- Ghidra
- Hopper
- Binary Ninja
- `otool`, `lipo`, `nm`, `strings`

### Dynamic Analysis

- Frida
- `lldb`
- process/file/network tracing tools

### Traffic / API Observation

- Proxyman
- Charles
- mitmproxy

### Filesystem / State Observation

- snapshot/diff tooling for Slate data directories
- structured JSON diffing

## Evidence Standards

Every claim should be tagged as one of:

- `confirmed`: directly observed in code, runtime, storage, or API traffic
- `strong inference`: multiple independent signals support it
- `speculative`: plausible but not adequately evidenced

Every important claim should include:

- source artifact or file path
- function name or route if available
- line range or offset if available
- short explanation of why the evidence supports the claim

## Deliverables

The investigation should produce these outputs.

### 1. Architecture Findings Memo

- concise summary of confirmed mechanisms
- open questions that remain
- confidence labels on each major claim

### 2. Thread/Query Lifecycle Spec

- step-by-step lifecycle for parent, thread, and query
- session creation/reuse/resume/stop semantics

### 3. Episode/Return Object Spec

- best reconstructed schema
- examples from runtime or storage
- how parents consume it

### 4. Compaction Spec

- trigger conditions
- marker behavior
- retained vs dropped content
- relationship to child sessions and prior episodes

### 5. Storage Schema Map

- directory layout
- object types
- linkage between projects, sessions, messages, children, summaries, tool outputs

### 6. API/Event Map

- local control-plane routes
- event stream payloads relevant to threads and summaries

### 7. OpenSlate Design Implications

- what should be copied conceptually
- what should be deliberately changed in the open-source implementation

## Time-Boxing Recommendation

Do not let this turn into an endless archaeology project.

Recommended time-box:

- Day 1: static bundle recovery + storage archaeology
- Day 2: API tracing + controlled experiments
- Day 3: runtime instrumentation + synthesis

Escalate to native-binary tooling only if the JS/runtime layers do not answer the critical questions.

## Success Criteria

This investigation is successful if it gives us enough evidence to lock:

- the OpenSlate `ThreadSession` contract
- the OpenSlate `Episode` schema
- the OpenSlate compaction model
- the `copy/adapt/rewrite` boundaries relative to opencode-derived code

## Agent Prompt

Use the following prompt for a dedicated research/reverse-engineering agent.

```text
You are doing a deep reverse-engineering investigation of a locally installed Slate agent runtime to answer specific implementation questions for an open-source inspired architecture project.

Important context:
- The user has explicit permission from the Slate founders to do this work.
- The goal is architectural understanding, not credential extraction or indiscriminate dumping.
- Focus on the local install/binary/runtime artifacts and any local reverse-engineering notes already present.
- You are allowed to use professional reverse-engineering tools and methods where appropriate.

Mission:
Recover as many implementation-level details as possible about Slate’s swarm-native runtime, especially threads, queries, child sessions, episodic returns, compaction, persistence, and local control-plane behavior.

You must answer these questions if at all possible:
1. What is the exact lifecycle of `system.thread(...)`?
2. What is the exact lifecycle of `system.query(...)`?
3. What object or artifact does a bounded child run return to the parent?
4. Is there an explicit `Episode`-like object? If yes, what fields does it have and where is it stored?
5. How does parent-child reintegration work?
6. How does compaction actually trigger, write back, and affect later prompts?
7. How are parent, child, summary, and tool artifacts persisted on disk?
8. What local API routes or event payloads expose child-thread state?
9. What model-routing roles exist and where are they selected?

Prioritize the following evidence sources in order:
1. existing local reverse-engineering notes and extracted artifacts
2. packaged JS/Bun bundles and source maps
3. local storage/state generated by controlled runs
4. local API tracing and event capture
5. runtime instrumentation
6. native-binary analysis only where needed

Use a confidence model for every major claim:
- confirmed
- strong inference
- speculative

Do not spend much time on low-value tasks like recovering every prompt string or cosmetic UI details.
Spend your time on the runtime mechanics that affect implementation design.

Suggested working method:
- build a call graph for orchestration, thread/query creation, reintegration, compaction, and storage writes
- compare before/after filesystem state for controlled experiments
- trace route payloads and event emissions where possible
- instrument runtime functions if static recovery is insufficient
- only use native RE tools after exhausting the higher-level surfaces

Deliverables:
1. Architecture findings memo
2. Thread lifecycle spec
3. Query lifecycle spec
4. Episode/return-object spec
5. Compaction spec
6. Storage schema map
7. API/event map
8. Open questions that remain unanswered
9. A short section: “What this means for OpenSlate implementation”

Output requirements:
- Be concrete.
- Cite file paths, functions, offsets, routes, or storage paths whenever possible.
- Distinguish hard evidence from inference.
- Organize the final answer by mechanism, not by chronology.
- Do not bury the most important findings.
```
