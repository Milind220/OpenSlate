import type {
  Session,
  Message,
  MessagePart,
  WorkerReturn,
  Episode,
  ThreadRunCard,
} from "@openslate/core";

interface RehydrationInput {
  messages: Message[];
  workerReturns: WorkerReturn[];
  episodes: Episode[];
  children: Session[];
}

interface RehydrationResult {
  byAssistantMessageId: Map<string, ThreadRunCard[]>;
  orphanThreadRuns: ThreadRunCard[];
}

type DelegationEntry = Extract<
  MessagePart,
  { kind: "delegation_plan" }
>["entries"][number];

export function rehydrateThreadRunsFromSessionData(
  input: RehydrationInput,
): RehydrationResult {
  const workerReturnById = new Map(
    input.workerReturns.map((wr) => [wr.id, wr]),
  );
  const episodeByWorkerReturnId = new Map(
    input.episodes.map((episode) => [episode.workerReturnId, episode]),
  );
  const childById = new Map(input.children.map((child) => [child.id, child]));

  const referencedWorkerReturnIds = new Set<string>();
  const byAssistantMessageId = new Map<string, ThreadRunCard[]>();

  for (const message of input.messages) {
    if (message.role !== "assistant") continue;

    const planPart = message.parts.find(
      (part): part is Extract<MessagePart, { kind: "delegation_plan" }> =>
        part.kind === "delegation_plan",
    );

    const workerReturnRefs = message.parts.filter(
      (part): part is Extract<MessagePart, { kind: "worker_return_ref" }> =>
        part.kind === "worker_return_ref",
    );

    if (workerReturnRefs.length === 0) continue;

    const cards: ThreadRunCard[] = [];

    for (const ref of workerReturnRefs) {
      const workerReturn = workerReturnById.get(ref.workerReturnId);
      if (!workerReturn) continue;

      referencedWorkerReturnIds.add(workerReturn.id);

      const episode = episodeByWorkerReturnId.get(workerReturn.id) ?? null;
      const child = childById.get(workerReturn.childSessionId) ?? null;
      const delegationEntry = findDelegationEntry(
        planPart,
        workerReturn,
        child,
      );

      cards.push(
        buildThreadRunCard(workerReturn, episode, child, delegationEntry),
      );
    }

    if (cards.length > 0) {
      byAssistantMessageId.set(message.id, cards);
    }
  }

  const orphanThreadRuns = input.workerReturns
    .filter((workerReturn) => !referencedWorkerReturnIds.has(workerReturn.id))
    .sort(
      (a, b) => Date.parse(a.startedAt || "") - Date.parse(b.startedAt || ""),
    )
    .map((workerReturn) => {
      const episode = episodeByWorkerReturnId.get(workerReturn.id) ?? null;
      const child = childById.get(workerReturn.childSessionId) ?? null;
      return buildThreadRunCard(workerReturn, episode, child, null);
    });

  return { byAssistantMessageId, orphanThreadRuns };
}

function findDelegationEntry(
  part: Extract<MessagePart, { kind: "delegation_plan" }> | undefined,
  workerReturn: WorkerReturn,
  child: Session | null,
): DelegationEntry | null {
  if (!part) return null;
  const byAlias = part.entries.find(
    (entry) =>
      entry.alias === workerReturn.alias || entry.alias === child?.alias,
  );
  if (byAlias) return byAlias;

  const normalizedTask = workerReturn.task.trim();
  const byTask = part.entries.find(
    (entry) => entry.task.trim() === normalizedTask,
  );
  return byTask ?? null;
}

function buildThreadRunCard(
  workerReturn: WorkerReturn,
  episode: Episode | null,
  child: Session | null,
  delegationEntry: DelegationEntry | null,
): ThreadRunCard {
  const runtime = episode?.runtime;
  const startedAtMs = Date.parse(workerReturn.startedAt || "");
  const finishedAtMs = Date.parse(workerReturn.finishedAt || "");
  const computedDurationMs =
    Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
      ? Math.max(0, finishedAtMs - startedAtMs)
      : null;

  const fallbackAlias =
    workerReturn.alias ?? child?.alias ?? delegationEntry?.alias ?? null;
  const fallbackTask =
    workerReturn.task || delegationEntry?.task || child?.title || "(no task)";

  return {
    alias: fallbackAlias,
    task: fallbackTask,
    childSessionId: workerReturn.childSessionId,
    status: workerReturn.status,
    reused: false,
    output: workerReturn.output,
    summary: episode?.summary ?? runtime?.structuredReturn?.summary ?? null,
    keyFindings:
      episode?.keyFindings ?? runtime?.structuredReturn?.keyFindings ?? [],
    filesRead:
      episode?.filesRead ??
      runtime?.structuredReturn?.filesRead ??
      runtime?.filesRead ??
      [],
    filesChanged:
      episode?.filesChanged ??
      runtime?.structuredReturn?.filesChanged ??
      runtime?.filesChanged ??
      [],
    toolCallCount: runtime?.toolCalls.length ?? 0,
    durationMs: runtime?.durationMs ?? computedDurationMs,
    model: runtime?.model ?? null,
    tokenUsage: runtime?.tokenUsage ?? null,
    estimatedCostUsd: runtime?.estimatedCostUsd ?? null,
    completionContractValidity: episode?.completionContract.validity ?? null,
    workerReturnId: workerReturn.id,
    episodeId: episode?.id ?? `episode-missing:${workerReturn.id}`,
    inputEpisodeIds:
      episode?.inputEpisodeIds ?? delegationEntry?.inputEpisodeIds ?? [],
    startedAt: workerReturn.startedAt,
    finishedAt: workerReturn.finishedAt,
    delegationReason: delegationEntry?.reason ?? null,
    expectedOutput: delegationEntry?.expectedOutput ?? null,
    capabilities: delegationEntry?.capabilities ?? [],
    iterations: runtime?.iterations ?? 0,
  };
}

export function inferLastToolFromThreadRun(run: ThreadRunCard): string | null {
  if (run.output) {
    const toolMatch = run.output.match(/tool\s*:\s*([a-zA-Z0-9_.:-]+)/i);
    if (toolMatch?.[1]) return toolMatch[1];
  }
  return null;
}

export type { RehydrationInput, RehydrationResult };
