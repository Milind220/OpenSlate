import { describe, expect, test } from "bun:test";
import type { Episode, Message, Session, WorkerReturn } from "@openslate/core";
import { rehydrateThreadRunsFromSessionData } from "./session-cards.js";

function asSessionId(value: string) {
  return value as any;
}

function makeSession(id: string, alias: string | null): Session {
  return {
    id: asSessionId(id),
    projectId: "proj-1" as any,
    kind: "thread",
    status: "active",
    parentId: asSessionId("parent-1"),
    alias,
    title: alias ?? "child",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeWorkerReturn(id: string, childSessionId: string): WorkerReturn {
  return {
    id,
    parentSessionId: asSessionId("parent-1"),
    childSessionId: asSessionId(childSessionId),
    childType: "thread",
    alias: "researcher",
    task: "Inspect auth flow",
    status: "completed",
    output: "done",
    traceRef: null,
    artifactRefs: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:03.000Z",
  };
}

function makeEpisode(workerReturnId: string): Episode {
  return {
    id: "ep-1",
    parentSessionId: asSessionId("parent-1"),
    childSessionId: asSessionId("child-1"),
    workerReturnId,
    childType: "thread",
    alias: "researcher",
    task: "Inspect auth flow",
    status: "completed",
    traceRef: null,
    artifactRefs: [],
    inputEpisodeIds: ["ep-prev"],
    summary: "Found root cause",
    keyFindings: ["missing store wiring"],
    filesRead: ["a.ts"],
    filesChanged: ["b.ts"],
    openQuestions: [],
    nextActions: [],
    completionContract: { validity: "valid", issues: [] },
    runtime: {
      iterations: 2,
      structuredReturn: {
        summary: "Found root cause",
        keyFindings: ["missing store wiring"],
        filesRead: ["a.ts"],
        filesChanged: ["b.ts"],
        openQuestions: [],
        nextActions: [],
      },
      completionContract: { validity: "valid", issues: [] },
      toolCalls: [
        {
          tool: "file.read",
          args: {},
          result: "ok",
          isError: false,
        },
      ],
      filesRead: ["a.ts"],
      filesChanged: ["b.ts"],
      durationMs: 3000,
      model: "gpt-x",
      tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      estimatedCostUsd: 0.02,
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:03.000Z",
    createdAt: "2026-01-01T00:00:03.100Z",
  };
}

describe("rehydrateThreadRunsFromSessionData", () => {
  test("rebuilds assistant-linked cards from persisted parts, returns, and episodes", () => {
    const assistantMessage: Message = {
      id: "msg-a" as any,
      sessionId: asSessionId("parent-1"),
      role: "assistant",
      createdAt: "2026-01-01T00:00:04.000Z",
      parts: [
        {
          kind: "delegation_plan",
          planId: "plan-1",
          policy: {
            maxThreadsPerTurn: 3,
            preferredThreadsPerTurn: 2,
            childMaxIterations: 5,
            defaultCapabilities: ["read"],
            episodeSelection: {
              maxForOrchestrator: 6,
              maxForChildPrompt: 3,
            },
          },
          entries: [
            {
              alias: "researcher",
              task: "Inspect auth flow",
              reason: "need detailed trace",
              expectedOutput: "summary",
              capabilities: ["read", "search"],
              inputEpisodeIds: ["ep-prev"],
            },
          ],
        },
        { kind: "worker_return_ref", workerReturnId: "wr-1" },
      ],
    };

    const result = rehydrateThreadRunsFromSessionData({
      messages: [assistantMessage],
      workerReturns: [makeWorkerReturn("wr-1", "child-1")],
      episodes: [makeEpisode("wr-1")],
      children: [makeSession("child-1", "researcher")],
    });

    const cards = result.byAssistantMessageId.get("msg-a");
    expect(cards).toBeDefined();
    expect(cards?.length).toBe(1);
    const card = cards?.[0]!;

    expect(card.summary).toBe("Found root cause");
    expect(card.model).toBe("gpt-x");
    expect(card.tokenUsage?.totalTokens).toBe(30);
    expect(card.estimatedCostUsd).toBe(0.02);
    expect(card.completionContractValidity).toBe("valid");
    expect(card.delegationReason).toBe("need detailed trace");
  });

  test("surfaces orphan worker returns not referenced by message parts", () => {
    const result = rehydrateThreadRunsFromSessionData({
      messages: [],
      workerReturns: [makeWorkerReturn("wr-orphan", "child-1")],
      episodes: [makeEpisode("wr-orphan")],
      children: [makeSession("child-1", "researcher")],
    });

    expect(result.byAssistantMessageId.size).toBe(0);
    expect(result.orphanThreadRuns).toHaveLength(1);
    expect(result.orphanThreadRuns[0]?.workerReturnId).toBe("wr-orphan");
  });
});
