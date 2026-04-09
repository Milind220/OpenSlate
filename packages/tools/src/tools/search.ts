/**
 * Search tool - web search via Exa AI API.
 * Based on OpenCode's websearch.ts implementation.
 */

import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, optionalNumberArg, optionalStringArg, returnsSchema } from "../types.js";

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  DEFAULT_NUM_RESULTS: 8,
} as const;

interface McpSearchRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: {
      query: string;
      numResults?: number;
      livecrawl?: "fallback" | "preferred";
      type?: "auto" | "fast" | "deep";
      contextMaxCharacters?: number;
    };
  };
}

interface McpSearchResponse {
  jsonrpc: string;
  result: {
    content: Array<{
      type: string;
      text: string;
    }>;
  };
}

export const searchTool: RegisteredTool = {
  definition: {
    name: "search",
    description: `Web search via Exa AI API.

Usage:
- Searches the web for relevant information
- Returns search results with summaries
- Useful for finding current information, documentation, or research
- Results may be live-crawled for freshness
- Can specify search type: auto, fast, or deep`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Web search query",
        },
        numResults: {
          type: "number",
          description: "Number of search results to return (default: 8)",
        },
        livecrawl: {
          type: "string",
          enum: ["fallback", "preferred"],
          description: "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
        },
        type: {
          type: "string",
          enum: ["auto", "fast", "deep"],
          description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
        },
        contextMaxCharacters: {
          type: "number",
          description: "Maximum characters for context string optimized for LLMs (default: 10000)",
        },
      },
      required: ["query"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        query: { type: "string" },
        results: { type: "number" },
        content: { type: "string" },
      },
      required: ["query", "results"],
      additionalProperties: false,
    }),
    capability: "web",
  },

  async execute(args) {
    const query = requiredStringArg(args, "query");
    const numResults = optionalNumberArg(args, "numResults") ?? API_CONFIG.DEFAULT_NUM_RESULTS;
    const livecrawl = optionalStringArg(args, "livecrawl") as "fallback" | "preferred" | undefined ?? "fallback";
    const searchType = optionalStringArg(args, "type") as "auto" | "fast" | "deep" | undefined ?? "auto";
    const contextMaxCharacters = optionalNumberArg(args, "contextMaxCharacters");

    const searchRequest: McpSearchRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query,
          type: searchType,
          numResults,
          livecrawl,
          contextMaxCharacters,
        },
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const headers: Record<string, string> = {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      };

      const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
        method: "POST",
        headers,
        body: JSON.stringify(searchRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Search error (${response.status}): ${errorText}`);
      }

      const responseText = await response.text();

      // Parse SSE response
      const lines = responseText.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data: McpSearchResponse = JSON.parse(line.substring(6));
            if (data.result?.content?.[0]?.text) {
              const content = data.result.content[0].text;
              return {
                content,
                data: {
                  query,
                  results: numResults,
                  content,
                },
                activity: createActivity("web_search", `Searched: ${query}`, query, numResults),
              };
            }
          } catch {
            // Continue to next line
          }
        }
      }

      return {
        content: "No search results found. Please try a different query.",
        data: {
          query,
          results: 0,
          content: "No results found",
        },
        activity: createActivity("web_search", "No results found", query, 0),
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Search request timed out");
      }

      throw error;
    }
  },
};
