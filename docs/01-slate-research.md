# Slate Research Summary

Sources used before design:

- Public blog: `https://randomlabs.ai/blog/slate`
- Local reverse-engineering notes: `/Users/milindsharma/Developer/slate-npm-disassembled/investigation.md`
- Local synthesis doc: `/Users/milindsharma/Developer/slate-npm-disassembled/slate-agent-architecture.md`
- Supporting notes: `/Users/milindsharma/Developer/slate-npm-disassembled/next-steps.md`

## Important Caveat

The directory `/Users/milindsharma/Developer/slate-npm-disassembled` is not itself the Random Labs agent source tree. Its top-level `package.json` is the open-source rich text editor package `slate@0.123.0`. The useful evidence for the coding agent lives in the reverse-engineering notes and extracted binary artifacts inside that folder.

## Executive Summary

Slate's public architecture is not just "use subagents". The distinctive pattern is a strategic main thread that repeatedly delegates bounded work to worker threads, then reintegrates compressed outputs called `episodes`. The system is built around context routing and synchronization, not around one giant transcript or rigid upfront planning.

The reverse-engineering notes are directionally consistent with the blog. They show explicit orchestration primitives, structured persisted messages, summary/compaction hooks, role-specific model slots, a file-backed local store, and a broad local tool/runtime surface.

The strongest design takeaway is this: if we build an open-source Slate-inspired system, the core primitive should be `bounded thread execution -> structured episode return -> orchestrator reintegration`, not plain subagent chat.

## Public Blog Summary

## Core Problem Statement

The blog argues that long-horizon software agents are mainly bottlenecked by systems design rather than raw model intelligence. The three coupled problems it focuses on are:

- long-horizon task execution
- strategy vs. tactics
- working memory and context management

The post frames large context windows as insufficient on their own. It introduces the idea of a practical working-memory limit where model attention quality degrades before nominal context capacity is exhausted.

## Critique Of Existing Patterns

The post critiques several common agent patterns:

- naive compaction: useful but unpredictably lossy
- naive subagents: good isolation, weak information transfer back to the parent
- markdown plans: can help strategy, but go stale
- explicit task trees: thorough, but rigid and less expressive
- recursive planning systems: expressive, but prone to over-decomposition and weak mid-course correction
- message-passing multi-agent systems: synchronization cost is too high and reconciliation is messy

The post is especially explicit that plain message passing is the wrong synchronization primitive for this kind of parent/worker architecture under current model behavior.

## Slate's Proposed Pattern

The blog's primary architectural primitive is the `thread`.

The operating model is:

- one orchestrator thread stays strategic
- worker threads execute bounded tactical actions
- each worker action returns a compressed artifact called an `episode`
- episodes can be passed into later threads as inputs
- the orchestrator repeatedly dispatches, reintegrates, and updates strategy

Random Labs calls this `thread weaving`.

The key claimed benefit is frequent, bounded synchronization. Instead of allowing workers to run for a long time and then hand back a long response, the system synchronizes at natural action boundaries and preserves only the information that matters.

## Why Episodes Matter

In the blog, an `episode` is the compressed representation of a completed action sequence. It is not just the worker's final prose answer. It is presented as the system's practical form of episodic memory.

Benefits claimed for episodes:

- smaller synchronization payloads
- cleaner context handoff between workers
- better reuse of prior work without replaying full traces
- natural boundaries for compaction
- a clean boundary for cross-model handoff

## Strategic vs Tactical Execution

Slate is trying to keep strategy in the orchestrator while preserving high tool expressivity in workers. The important nuance is that the system is not supposed to lock into a fixed explicit plan up front. Decomposition is meant to happen implicitly and adaptively as new information is discovered.

This is probably the most important product-level lesson from the blog: strategy should emerge through frequent synchronization, not through a brittle master markdown plan.

## Claimed Advantages

The blog claims this architecture improves:

- compaction quality
- strategic coherence
- flexible task decomposition
- context isolation without losing reuse
- practical parallelism
- cross-model composition

The post also claims the architecture combines ReAct-like expressivity with the context isolation and parallelism usually associated with multi-agent systems.

## Case Study Signals

The blog uses a browser-use TypeScript port as its flagship example and claims:

- 583 tool calls
- 311 requests
- a couple hours total runtime
- less than $60 total cost

The blog is not pretending the run was perfect. It explicitly admits early stopping, missed files, imperfect parity, and cleanup debt. That is useful because it suggests the authors see the system as powerful but still bounded by feedback loops, testing, and reintegration quality.

## Public-Blog Open Questions

The blog does not rigorously answer:

- what the exact episode schema is
- how retention vs loss is decided during episode creation
- how many episode hops can occur before quality decays
- how conflicting parallel outputs are reconciled
- when to reuse a thread alias vs spawn a new one
- what exact heuristics control thread creation

Those gaps matter because they are precisely where an open-source implementation will either feel magical or collapse into noisy orchestration.

## Reverse-Engineering Findings

## High-Confidence Findings

The local notes provide strong evidence for the following runtime shape.

### 1. Explicit orchestration primitives exist

The parent session appears to invoke an `orchestrate` tool that exposes a JS runtime with helpers such as:

- `system.thread(alias?, task, capabilities?, options?)`
- `system.query(prompt, options?)`
- `system.log(...)`
- `system.allocate(...)`
- `system.fromId(...)`

This is strong evidence that orchestration is a first-class runtime feature, not just a prompt convention.

### 2. Parent-child sessions are real persisted objects

The notes describe persisted child sessions with fields like:

- `parentID`
- `task`
- `alias`
- restricted `agentConfig.enabledTools`
- `behaviorMode: "actor"`

That is consistent with a session graph rather than a flat conversation log.

### 3. Query and thread are distinct execution forms

`system.query(...)` appears to create a child session with no tool access and behavior tuned for answering a focused question.

`system.thread(...)` appears to create or reuse a child session by alias, pass documents and trace references, and allow a restricted but meaningful tool palette.

This distinction matters. It implies Slate does not treat all child work as the same thing.

### 4. Context management and summarization are real subsystems

The reverse-engineering notes show a real compression path with:

- a dedicated compression model string: `randomlabs/compress-default-alpha`
- structured compression inputs:
  - `prior_session_summary`
  - `target_session_history`
  - `recent_session_history`
- a two-stage hook chain:
  - `postStep` inserts summary markers
  - `preStep` later compresses older windows

This is important evidence that context management is part of the runtime loop itself.

### 5. The persisted message model is rich and typed

The notes show message parts such as:

- `text`
- `reasoning`
- `tool`
- `snapshot`
- `patch`
- `agent`
- `retry`
- `assistant_message`
- `tool_calls`

That is much closer to an event log than a plain chat transcript.

### 6. Local-first persistence is likely central

The notes point to file-backed JSON storage for:

- project metadata
- sessions
- messages/artifacts
- prompt history
- preferences and theme
- auth state

That fits the product shape of a local-first coding harness with resumability and recoverability.

### 7. The API/control plane is broad

Recovered route families include session lifecycle, messaging, shell, diff, summarize, revert/unrevert, children, todo, project/config, auth, MCP, formatter, and TUI-specific endpoints.

That suggests a stable local control plane between UI and runtime, not a tightly coupled monolith.

### 8. Multi-model routing appears intentional

The notes show different observed models for different roles:

- main: `anthropic/claude-sonnet-4.6`
- explore: `z-ai/glm-5`
- execute: `openai/gpt-5.3-codex`

Even if the exact defaults change, the important point is that role-based model slotting is built into the runtime.

## Medium-Confidence Findings

The following ideas are plausible, but should be treated as design guidance rather than hard fact.

### 1. Episodes are probably first-class, but that exact object model is still partly inferred

The public blog is explicit about episodes. The reverse-engineering notes show child-thread scaffolding with `# Prior episodes`, but they do not fully prove the exact internal episode schema. The separate file `slate-agent-architecture.md` argues for first-class `Episode` objects, but it is itself a synthesis document rather than raw evidence.

### 2. There may be a server-side hidden master harness after `/v3/stream`

The notes confirm extensive local prompt and context scaffolding. They do not prove whether Random Labs adds additional hidden provider-facing instructions server-side after the client hits `/v3/stream`.

### 3. Caching is present, but exact semantics remain unclear

The notes show both message-level cache markers and provider-side cache accounting. It is still not fully clear whether this is only provider prompt caching, a local reusable checkpoint system, or both.

## Practical Implications For An Open-Source Build

The research points toward the following architectural requirements.

### 1. Build around episodes, not transcript forwarding

The core abstraction should be a bounded worker run that yields a structured return object carrying retained state, references, and next-step relevance.

### 2. Separate strategic orchestration from tactical execution

The parent loop should decide when to stay local, when to spawn a query, when to spawn or reuse a thread, and when to reintegrate or compact.

### 3. Make context engineering explicit

Codebase context, prior episodes, reference docs, task docs, skills, rules, and summary markers should be explicit runtime concepts.

### 4. Persist everything needed for replay and recovery

Messages, tool outputs, diffs, snapshots, and episode objects should be stored as structured artifacts. Replay and resume are product features, not debug-only features.

### 5. Use model slots by role

At minimum, the system should have configurable models for:

- primary orchestration
- execution
- exploration/query
- compression/summarization

### 6. Preserve tool expressivity

The worker plane needs real shell, search, file/edit, diff, MCP, and approval-gated destructive actions. Without that, the orchestration architecture will not feel materially different from simpler agents.

## What We Should Not Copy Blindly

- any closed-source prompt wording we cannot independently justify
- product behavior inferred only from one reverse-engineered version
- opaque magic around thread routing without observable state
- orchestration for its own sake when one direct step is enough

## Design Guardrails Derived From Research

- Prefer observable runtime objects over hidden prompt tricks.
- Prefer structured episode artifacts over freeform worker prose.
- Prefer natural synchronization boundaries over arbitrary long runs.
- Prefer local-first persistence and replayability.
- Prefer explicit model roles over one global default model.
- Prefer adaptive decomposition over rigid task trees.

## Bottom Line

The public blog and the local reverse-engineering notes tell a consistent story.

The essence of Slate is not simply "multiple agents". It is:

- a strategic orchestrator
- bounded worker threads
- structured episodic returns
- explicit context management and compaction
- role-based model routing
- persistent local state and a stable control plane

That is the architecture we should reproduce in open source, while keeping the product surface, theming, and ergonomics closer to opencode.
