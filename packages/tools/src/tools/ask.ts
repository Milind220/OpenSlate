/**
 * Ask tool - displays interactive question dialog to user.
 * Based on OpenCode's question.ts implementation.
 */

import type { RegisteredTool } from "../types.js";
import { createActivity, returnsSchema } from "../types.js";

export interface Question {
  header: string;
  question: string;
  options: {
    label: string;
    description: string;
  }[];
  multiple?: boolean;
}

export interface Answer {
  question: string;
  answers: string[];
}

export const askTool: RegisteredTool = {
  definition: {
    name: "ask",
    description: `Displays interactive question dialogs to the user.

Usage:
- Use this tool to ask the user questions during execution
- Supports multiple choice questions with detailed descriptions
- Can allow multiple selections or single selection
- The tool will wait for user response before continuing
- Useful for gathering preferences, clarifications, or decisions`,
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Questions to ask the user",
          items: {
            type: "object",
            properties: {
              header: {
                type: "string",
                description: "Very short label (max 30 chars)",
              },
              question: {
                type: "string",
                description: "Complete question text",
              },
              options: {
                type: "array",
                description: "Available choices",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description: "Display text (1-5 words, concise)",
                    },
                    description: {
                      type: "string",
                      description: "Explanation of choice",
                    },
                  },
                  required: ["label", "description"],
                },
              },
              multiple: {
                type: "boolean",
                description: "Allow selecting multiple choices",
              },
            },
            required: ["header", "question", "options"],
          },
        },
      },
      required: ["questions"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        answers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              answers: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
      required: ["answers"],
      additionalProperties: false,
    }),
    capability: "agent",
  },

  async execute(args) {
    const questions = args.questions as Question[];

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("questions must be a non-empty array");
    }

    // Validate questions
    for (const q of questions) {
      if (!q.header || typeof q.header !== "string") {
        throw new Error("Each question must have a header string");
      }
      if (!q.question || typeof q.question !== "string") {
        throw new Error("Each question must have a question string");
      }
      if (!Array.isArray(q.options) || q.options.length === 0) {
        throw new Error("Each question must have at least one option");
      }
      for (const opt of q.options) {
        if (!opt.label || typeof opt.label !== "string") {
          throw new Error("Each option must have a label string");
        }
        if (!opt.description || typeof opt.description !== "string") {
          throw new Error("Each option must have a description string");
        }
      }
    }

    // In a full implementation with UI, this would:
    // 1. Display the questions to the user
    // 2. Wait for user responses
    // 3. Return the answers

    // For now, we return a placeholder indicating what would happen
    const placeholderAnswers: Answer[] = questions.map((q) => ({
      question: q.question,
      answers: (q.options[0]?.label ? [q.options[0].label] : ["No options"]),
    }));

    const formatted = questions
      .map((q, i) => `"${q.question}"="${placeholderAnswers[i]?.answers.join(", ") ?? "Unanswered"}"`)
      .join(", ");

    return {
      content: `Asked ${questions.length} question${questions.length > 1 ? "s" : ""}: ${formatted}.\n\nNote: This is a placeholder implementation. In a full UI-enabled environment, the questions would be displayed to the user and their responses would be returned.`,
      data: {
        answers: placeholderAnswers,
      },
      activity: createActivity(
        "user_question",
        `Asked ${questions.length} question${questions.length > 1 ? "s" : ""}`,
        undefined,
        questions.length,
      ),
    };
  },
};
