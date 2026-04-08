/**
 * Model adapter — bridges SessionService's ModelCallFn with ModelRouter.
 *
 * This is the thin translation layer between the provider-agnostic
 * session service and the provider-aware model router.
 *
 * Phase 4 adds createChildModelCallAdapter for tool-calling child threads.
 */

import type { MessagePart, TextPart, ReasoningPart } from "./types/message.js";
import type { ModelCallFn, ModelCallResult } from "./session-service.js";
import type {
  ChildModelCallFn,
  ChildModelCallResult,
  ChildToolCall,
} from "./child-runtime.js";

/**
 * Adapt a ModelRouter.complete call into a ModelCallFn (parent/chat mode).
 */
export interface CompleteFn {
  (options: {
    messages: Array<{ role: string; content: string }>;
    system?: string;
  }): Promise<{
    text: string;
    reasoning?: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }>;
}

export function createModelCallAdapter(completeFn: CompleteFn): ModelCallFn {
  return async (input): Promise<ModelCallResult> => {
    const result = await completeFn({
      messages: input.messages,
      system: input.system,
    });

    const parts: MessagePart[] = [];

    if (result.reasoning) {
      parts.push({
        kind: "reasoning",
        content: result.reasoning,
      } satisfies ReasoningPart);
    }

    if (result.text) {
      parts.push({ kind: "text", content: result.text } satisfies TextPart);
    }

    if (parts.length === 0) {
      parts.push({ kind: "text", content: "" } satisfies TextPart);
    }

    return {
      parts,
      usage: result.usage,
    };
  };
}

/**
 * Adapt a ModelRouter for child thread tool-calling mode.
 *
 * This adapter handles the Vercel AI SDK generateText response shape
 * which includes toolCalls and finishReason.
 */
export interface ChildCompleteFn {
  (options: {
    messages: Array<{
      role: string;
      content: string;
      toolCallId?: string;
      toolCalls?: ChildToolCall[];
    }>;
    system?: string;
    tools?: Record<
      string,
      { description: string; parameters: Record<string, unknown> }
    >;
  }): Promise<{
    text: string;
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }>;
    finishReason: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    model?: string;
    estimatedCostUsd?: number | null;
  }>;
}
export function createChildModelCallAdapter(
  completeFn: ChildCompleteFn,
): ChildModelCallFn {
  return async (input): Promise<ChildModelCallResult> => {
    const result = await completeFn({
      messages: input.messages,
      system: input.system,
      tools: input.tools,
    });

    const toolCalls: ChildToolCall[] = (result.toolCalls ?? []).map((tc) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      args: tc.args,
    }));

    let finishReason: ChildModelCallResult["finishReason"];
    switch (result.finishReason) {
      case "stop":
        finishReason = "stop";
        break;
      case "tool-calls":
        finishReason = "tool-calls";
        break;
      case "length":
        finishReason = "length";
        break;
      case "error":
        finishReason = "error";
        break;
      default:
        finishReason = "unknown";
        break;
    }

    return {
      text: result.text ?? "",
      toolCalls,
      finishReason,
      usage: result.usage,
      model: result.model,
      estimatedCostUsd: result.estimatedCostUsd ?? null,
    };
  };
}
