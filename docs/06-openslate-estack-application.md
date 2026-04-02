# OpenSlate E-Stack Application

This document applies the local `e-stack` skills from `/Users/milindsharma/Developer/pcb-ai/copper/.agents/skills` to OpenSlate.

Purpose:

- identify the real bottleneck
- cut fake work
- decide what must be founder-owned versus delegated
- challenge inherited assumptions before implementation starts

This is not a replacement for `docs/05-openslate-implementation-plan.md`.
It is a set of execution guardrails for how to use that plan correctly.

## 1. Bottleneck Execution

### SHIP TARGET:

An engineer can point OpenSlate at a real codebase, talk to one orchestrator, and get a real multi-step code task completed through provider-portable execution with real child threads, alias reuse, and structured reintegration.

### CURRENT BOTTLENECK:

There is no working runtime core yet.

More specifically, the dominating constraint is:

- no provider-portable single-session runtime exists yet with the same object model we need for swarm execution

Until that exists, work on swarm UI, advanced compaction polish, desktop shells, or plugin breadth is fake progress.

### WHY THIS IS THE BOTTLENECK:

- if the single-session runtime is not real, thread orchestration has nothing stable to build on
- if provider portability is not baked in early, the runtime will ossify around one backend and become expensive to unwind later
- if message persistence and tool execution are not real, thread/session abstractions are theater

### REJECTED DISTRACTIONS:

- building the swarm timeline UI first
- trying to exactly match Slate's hidden compaction trigger behavior before we have our own handoff model
- desktop packaging early
- external tmux-driven agent backends before native runtime truth exists
- extensive plugin work before the core session graph is stable

### UGLY EFFECTIVE PATH:

- build a narrow but real provider-portable single-session harness first
- then add real `ThreadSession` + alias reuse
- then add `WorkerReturn`
- then add `HandoffState` and compaction

Do not wait for elegance.
Get the core runtime into reality first.

### KILL METRIC:

OpenSlate can:

- run a real code task in a local repo
- use configurable providers and model slots
- persist session state and tool outputs
- complete the task correctly in single-session mode

### NEXT REALITY CHECK:

Implement the minimal package skeleton plus provider layer plus single-session runtime, then use it on one real repo task immediately.

### DECISION:

The one thing to do now is build the provider-portable single-session runtime, not the swarm UX.

## 2. Elon Execution

### FOUNDER MUST OWN:

- the runtime object model:
  - `Session`
  - `ThreadSession`
  - `QuerySession`
  - `HandoffState`
  - `WorkerReturn`
- orchestrator behavior and delegation heuristics
- role-based model routing design
- compaction model:
  - marker-stage
  - writeback-stage
- trust boundaries and approval model
- evaluation criteria for whether thread orchestration is actually better than single-session execution

### WHY:

These are the product physics.
If these are wrong, OpenSlate loses its reason to exist.

### DELEGATE WITH REVIEW:

- provider adapters
- storage migrations
- server route plumbing
- event streaming
- tool wrappers
- core-path tests
- UI wiring for thread/worker-return display

### DELEGATE ENTIRELY:

- boilerplate package setup
- repetitive schema wiring
- standard CRUD scaffolding
- docs formatting
- non-critical test scaffolding
- config and CI setup

### STOP TOUCHING:

- speculative desktop polish
- non-critical visual refinement
- platform breadth before core runtime truth
- fancy episode storytelling if worker returns already solve the core problem

### WHAT YOU STILL NEED TO UNDERSTAND DEEPLY:

- why the thread model is better than plain subagents
- when alias reuse should happen
- how parent reintegration should stay structured
- how handoff state should influence prompt rebuilding
- how different model slots affect quality/cost tradeoffs

### NEXT FOUNDER ACTION:

Personally lock the runtime contracts and provider-routing design before delegating implementation.

## 3. Elon Algorithm

### STEP 1. QUESTION:

Question these requirements immediately:

- do we need a first-class `Episode` persisted object in v1, or are `WorkerReturn` + transcript + artifacts enough?
- do we need `QuerySession` in the first cut, or can the orchestrator launch only threads initially?
- do we need web, desktop, and terminal surfaces early, or is terminal-only enough?
- do we need broad plugin support before the runtime core is proven?
- do we need elaborate compaction automation before a working explicit summarize path exists?

### STEP 2. DELETE:

Delete or delay for v1:

- desktop shell work
- fancy orchestration visualizations
- external-agent tmux backend
- broad plugin system before core runtime proof
- any requirement for perfect Slate behavioral parity

### STEP 3. SIMPLIFY:

Simplify the build to:

- one runtime
- one local control plane
- one single-session mode first
- one thread primitive next
- one worker return contract
- one handoff object per session

Use the fewest moving parts needed to prove the architecture.

### STEP 4. ACCELERATE:

Accelerate these loops:

- package build/typecheck loop
- provider integration test loop
- session-runtime test loop
- real-repo dogfooding loop
- compaction regression loop

The goal is faster reality contact, not prettier internal abstractions.

### STEP 5. AUTOMATE:

Automate only after the path is real:

- provider conformance tests
- session graph fixtures
- regression tasks for thread reuse and reintegration
- compaction scenario tests

### DECISION:

The correct reduced v1 is: provider-portable single-session runtime -> threads -> worker returns -> handoff/compaction -> swarm UI.

## 4. Physics Exception

### CLAIM UNDER ATTACK:

"We need to fully understand Slate's exact hidden compaction trigger before we can build OpenSlate correctly."

### NAMED OWNER:

This assumption has no strong owner. It is mostly fear of building without perfect reverse-engineered parity.

### REAL CONSTRAINTS:

- we need a workable long-session memory model
- we need structured parent-child reintegration
- we need provider portability preserved
- we need a compaction system that is explicit and debuggable

### FAKE OR WEAK CONSTRAINTS:

- exact parity with Slate's hidden writeback trigger
- exact reuse of Slate's current `/compact` UX
- exact reproduction of an internal `Episode` object that may not literally exist in the way we first imagined

### WHAT WOULD HAVE TO BE TRUE:

For exact Slate parity to matter, we would need evidence that:

- their hidden trigger is load-bearing to the product win rate
- a simpler explicit + automatic compaction model would fail materially
- users care about internal parity rather than product behavior

We do not have evidence for that.

### PHYSICS VS HABIT:

- physics: long sessions need bounded memory and prompt rebuilding
- habit: we must copy Slate's hidden compaction mechanics exactly

### CHEAPEST REALITY TEST:

Implement OpenSlate with:

- one rolling handoff object per session
- explicit summarize path
- automatic compaction at natural boundaries
- summary + recent-history prompt rebuild

Then dogfood it on long tasks.

### DECISION:

Stop treating hidden Slate compaction trigger parity as a blocker. Build the clearer OpenSlate version.

## 5. Idiot Index

### THING BEING ANALYZED:

OpenSlate implementation complexity.

### RAW INPUTS:

- TypeScript monorepo
- copied/adapted opencode UI/control-plane/provider patterns
- rewritten runtime core

### DELIVERED COST:

Potentially months of work if we overbuild too early.

### IDIOT INDEX:

The main stupidity risk is paying high complexity cost for layers that do not move product truth:

- multiple UI surfaces too early
- plugin breadth too early
- exact closed-source parity chasing
- decorative multi-agent UX before the runtime is real

### REAL COST DRIVERS:

- session graph design
- provider normalization
- tool runtime reliability
- reintegration contracts
- compaction quality

### STUPIDITY DRIVERS:

- building a platform before proving the harness
- polishing non-bottleneck UX
- adding infrastructure for hypothetical future needs

### WHAT TO PULL IN-HOUSE:

- runtime contracts
- orchestration heuristics
- compaction design
- evaluation criteria

### WHAT TO REDESIGN OR DELETE:

- any plan that front-loads desktop/web/polish over runtime truth
- any assumption that plugin architecture must be broad on day one

### CHEAPEST HIGH-LEVERAGE CHANGE:

Cut v1 to terminal-first, native runtime only, with provider portability preserved.

## Final E-Stack Decision

The correct execution stance for OpenSlate is:

- build terminal-first
- build provider portability first
- build single-session runtime before swarm behavior
- build native threads before fancy UX
- make compaction explicit and debuggable rather than mystical
- stop chasing hidden Slate parity where it does not affect product truth

## Immediate Action

The next concrete action after this document is:

1. create the opencode `copy / adapt / rewrite` matrix
2. lock the core runtime schemas
3. start Phase 1 and Phase 2 implementation work
