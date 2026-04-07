/**
 * Model adapter — bridges SessionService's ModelCallFn with ModelRouter.
 *
 * This is the thin translation layer between the provider-agnostic
 * session service and the provider-aware model router.
 *
 * Lives in core because it translates core types, but imports from models.
 */

import type { MessagePart, TextPart, ReasoningPart } from "./types/message.js";
import type { ModelCallFn, ModelCallResult } from "./session-service.js";

/**
 * Adapt a ModelRouter.complete call into a ModelCallFn.
 *
 * Takes a generic complete function to avoid importing @openslate/models directly.
 * The server wiring layer provides the actual ModelRouter.complete binding.
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

    // Translate model output into structured MessageParts
    const parts: MessagePart[] = [];

    if (result.reasoning) {
      parts.push({ kind: "reasoning", content: result.reasoning } satisfies ReasoningPart);
    }

    if (result.text) {
      parts.push({ kind: "text", content: result.text } satisfies TextPart);
    }

    // Ensure at least one part
    if (parts.length === 0) {
      parts.push({ kind: "text", content: "" } satisfies TextPart);
    }

    return {
      parts,
      usage: result.usage,
    };
  };
}
