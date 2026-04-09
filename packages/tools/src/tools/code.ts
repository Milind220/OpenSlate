/**
 * Code tool - code/API documentation search via Exa AI.
 * Based on OpenCode's codesearch.ts implementation.
 */

import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, optionalNumberArg, returnsSchema } from "../types.js";

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    CONTEXT: "/mcp",
  },
} as const;

interface McpCodeRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: {
      query: string;
      tokensNum: number;
    };
  };
}

interface McpCodeResponse {
  jsonrpc: string;
  result: {
    content: Array<{
      type: string;
      text: string;
    }>;
  };
}

export const codeTool: RegisteredTool = {
  definition: {
    name: "code",
    description: `Code/API documentation search via Exa AI.

Usage:
- Search query to find relevant context for APIs, Libraries, and SDKs
- Examples: 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'
- Number of tokens to return (1000-50000). Default is 5000 tokens.
- Adjust token count based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
        },
        tokensNum: {
          type: "number",
          minimum: 1000,
          maximum: 50000,
          description: "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
        },
      },
      required: ["query"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        query: { type: "string" },
        tokensNum: { type: "number" },
        content: { type: "string" },
      },
      required: ["query", "tokensNum"],
      additionalProperties: false,
    }),
    capability: "web",
  },

  async execute(args) {
    const query = requiredStringArg(args, "query");
    const tokensNum = Math.min(
      Math.max(optionalNumberArg(args, "tokensNum") ?? 5000, 1000),
      50000,
    );

    const codeRequest: McpCodeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_code_context_exa",
        arguments: {
          query,
          tokensNum,
        },
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const headers: Record<string, string> = {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      };

      const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`, {
        method: "POST",
        headers,
        body: JSON.stringify(codeRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Code search error (${response.status}): ${errorText}`);
      }

      const responseText = await response.text();

      // Parse SSE response
      const lines = responseText.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data: McpCodeResponse = JSON.parse(line.substring(6));
            if (data.result?.content?.[0]?.text) {
              const content = data.result.content[0].text;
              return {
                content,
                data: {
                  query,
                  tokensNum,
                  content,
                },
                activity: createActivity("code_search", `Code search: ${query}`, query),
              };
            }
          } catch {
            // Continue to next line
          }
        }
      }

      return {
        content:
          "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
        data: {
          query,
          tokensNum,
          content: "No results found",
        },
        activity: createActivity("code_search", "No code results found", query, 0),
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Code search request timed out");
      }

      throw error;
    }
  },
};
