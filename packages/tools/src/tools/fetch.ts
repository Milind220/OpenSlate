/**
 * Fetch tool - fetches web content from URLs.
 * Based on OpenCode's webfetch.ts implementation.
 */

import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, optionalStringArg, optionalNumberArg, returnsSchema } from "../types.js";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes

// Simple HTML to text converter
function htmlToText(html: string): string {
  // Remove script and style elements
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Replace common block elements with newlines
  text = text
    .replace(/<\/?(div|p|h[1-6]|li|td|tr|br)[^>]*>/gi, "\n")
    .replace(/<\/?(ul|ol|table|thead|tbody)[^>]*>/gi, "\n\n");

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Clean up whitespace
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// Simple HTML to markdown converter
function htmlToMarkdown(html: string): string {
  let markdown = html;

  // Headers
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, "##### $1\n\n");
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, "###### $1\n\n");

  // Bold and italic
  markdown = markdown.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, "**$2**");
  markdown = markdown.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, "*$2*");

  // Code
  markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");
  markdown = markdown.replace(/<pre[^>]*>(.*?)<\/pre>/gi, "```\n$1\n```\n\n");

  // Links
  markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");

  // Images
  markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  markdown = markdown.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, "![$1]($2)");

  // Lists
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  markdown = markdown.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");

  // Paragraphs and breaks
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");
  markdown = markdown.replace(/<br\s*\/?>/gi, "\n");

  // Remove remaining tags
  markdown = markdown.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  markdown = markdown
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  return markdown.trim();
}

export const fetchTool: RegisteredTool = {
  definition: {
    name: "fetch",
    description: `Fetches content from a specified URL.

Usage:
- The URL must be a fully-formed valid URL (http:// or https://)
- HTTP URLs will be automatically upgraded to HTTPS
- Format options: "markdown" (default), "text", or "html"
- This tool is read-only and does not modify any files
- Results may be summarized if the content is very large
- Optional timeout in seconds (max 120)`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch content from",
        },
        format: {
          type: "string",
          enum: ["text", "markdown", "html"],
          description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
        },
        timeout: {
          type: "number",
          description: "Optional timeout in seconds (max 120)",
        },
      },
      required: ["url"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        url: { type: "string" },
        format: { type: "string" },
        contentType: { type: "string" },
        length: { type: "number" },
        truncated: { type: "boolean" },
      },
      required: ["url", "format", "length"],
      additionalProperties: false,
    }),
    capability: "web",
  },

  async execute(args) {
    let url = requiredStringArg(args, "url");
    const format = optionalStringArg(args, "format") ?? "markdown";
    const timeoutSeconds = optionalNumberArg(args, "timeout") ?? (DEFAULT_TIMEOUT / 1000);

    // Upgrade HTTP to HTTPS
    if (url.startsWith("http://")) {
      url = url.replace("http://", "https://");
    }

    if (!url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://");
    }

    const timeout = Math.min(timeoutSeconds * 1000, MAX_TIMEOUT);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      };

      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Request failed with status code: ${response.status}`);
      }

      // Check content length
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
        throw new Error("Response too large (exceeds 5MB limit)");
      }

      const contentType = response.headers.get("content-type") || "";
      const mime = contentType.split(";")[0]?.trim().toLowerCase() || "";

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
        throw new Error("Response too large (exceeds 5MB limit)");
      }

      // Check if response is an image
      const isImage = mime.startsWith("image/") && mime !== "image/svg+xml";
      const isPdf = mime === "application/pdf";

      if (isImage || isPdf) {
        const base64Content = Buffer.from(arrayBuffer).toString("base64");
        return {
          content: `${isImage ? "Image" : "PDF"} fetched successfully`,
          data: {
            url,
            format,
            contentType: mime,
            length: arrayBuffer.byteLength,
            truncated: false,
            base64: base64Content,
          },
          activity: createActivity("web_fetch", `Fetched ${isImage ? "image" : "PDF"}`, url),
        };
      }

      // Convert to text
      const content = new TextDecoder().decode(arrayBuffer);

      // Handle content based on requested format
      let output: string;
      switch (format) {
        case "markdown":
          if (mime.includes("text/html")) {
            output = htmlToMarkdown(content);
          } else {
            output = content;
          }
          break;
        case "text":
          if (mime.includes("text/html")) {
            output = htmlToText(content);
          } else {
            output = content;
          }
          break;
        case "html":
        default:
          output = content;
          break;
      }

      // Truncate if too long
      const maxLength = 100000;
      const truncated = output.length > maxLength;
      if (truncated) {
        output = output.substring(0, maxLength) + "\n\n... (content truncated)";
      }

      return {
        content: output,
        data: {
          url,
          format,
          contentType: mime,
          length: output.length,
          truncated,
        },
        activity: createActivity("web_fetch", `Fetched ${url}`, url),
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request timed out");
      }

      throw error;
    }
  },
};
