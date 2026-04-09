/**
 * Edit tool - performs exact string replacements with fuzzy matching.
 * Based on OpenCode's edit.ts implementation.
 */

import * as path from "node:path";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, optionalBooleanArg, returnsSchema } from "../types.js";

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0;
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;

/**
 * Levenshtein distance algorithm implementation
 */
function levenshtein(a: string, b: string): number {
  if (a === "" || b === "") {
    return Math.max(a.length, b.length);
  }
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      matrix[i]![j] = Math.min(
        (matrix[i - 1]?.[j] ?? 0) + 1,
        (matrix[i]?.[j - 1] ?? 0) + 1,
        (matrix[i - 1]?.[j - 1] ?? 0) + cost,
      );
    }
  }
  return matrix[a.length]?.[b.length] ?? 0;
}

type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n");
  const searchLines = find.split("\n");

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop();
  }

    for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j]?.trim() ?? "";
      const searchTrimmed = searchLines[j]?.trim() ?? "";

      if (originalTrimmed !== searchTrimmed) {
        matches = false;
        break;
      }
    }

    if (matches) {
      let matchStartIndex = 0;
      for (let k = 0; k < i; k++) {
        matchStartIndex += (originalLines[k]?.length ?? 0) + 1;
      }

      let matchEndIndex = matchStartIndex;
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k]?.length ?? 0;
        if (k < searchLines.length - 1) {
          matchEndIndex += 1;
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex);
    }
  }
};

const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n");
  const searchLines = find.split("\n");

  if (searchLines.length < 3) {
    return;
  }

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop();
  }

  const firstLineSearch = searchLines[0]?.trim() ?? "";
  const lastLineSearch = searchLines[searchLines.length - 1]?.trim() ?? "";
  const searchBlockSize = searchLines.length;

  // Collect all candidate positions where both anchors match
  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < originalLines.length; i++) {
    if ((originalLines[i]?.trim() ?? "") !== firstLineSearch) {
      continue;
    }

    for (let j = i + 2; j < originalLines.length; j++) {
      if ((originalLines[j]?.trim() ?? "") === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j });
        break;
      }
    }
  }

  if (candidates.length === 0) {
    return;
  }

  // Handle single candidate scenario
  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (!candidate) return;
    const { startLine, endLine } = candidate;
    const actualBlockSize = endLine - startLine + 1;

    let similarity = 0;
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j]?.trim() ?? "";
        const searchLine = searchLines[j]?.trim() ?? "";
        const maxLen = Math.max(originalLine.length, searchLine.length);
        if (maxLen === 0) {
          continue;
        }
        const distance = levenshtein(originalLine, searchLine);
        similarity += (1 - distance / maxLen) / linesToCheck;

        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
          break;
        }
      }
    } else {
      similarity = 1.0;
    }

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      let matchStartIndex = 0;
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += (originalLines[k]?.length ?? 0) + 1;
      }
      let matchEndIndex = matchStartIndex;
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k]?.length ?? 0;
        if (k < endLine) {
          matchEndIndex += 1;
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex);
    }
    return;
  }

  // Calculate similarity for multiple candidates
  let bestMatch: { startLine: number; endLine: number } | null = null;
  let maxSimilarity = -1;

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate;
    const actualBlockSize = endLine - startLine + 1;

    let similarity = 0;
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j]?.trim() ?? "";
        const searchLine = searchLines[j]?.trim() ?? "";
        const maxLen = Math.max(originalLine.length, searchLine.length);
        if (maxLen === 0) {
          continue;
        }
        const distance = levenshtein(originalLine, searchLine);
        similarity += 1 - distance / maxLen;
      }
      similarity /= linesToCheck;
    } else {
      similarity = 1.0;
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestMatch = candidate;
    }
  }

  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch;
    let matchStartIndex = 0;
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += (originalLines[k]?.length ?? 0) + 1;
    }
    let matchEndIndex = matchStartIndex;
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k]?.length ?? 0;
      if (k < endLine) {
        matchEndIndex += 1;
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex);
  }
};

const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();
  const normalizedFind = normalizeWhitespace(find);

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line;
    } else {
      const normalizedLine = normalizeWhitespace(line);
      if (normalizedLine.includes(normalizedFind)) {
        const words = find.trim().split(/\s+/).filter(Boolean);
        if (words.length > 0) {
          const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
          try {
            const regex = new RegExp(pattern);
            const match = line.match(regex);
            if (match?.[0]) {
              yield match[0];
            }
          } catch {
            // Invalid regex pattern, skip
          }
        }
      }
    }
  }

  const findLines = find.split("\n");
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length);
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n");
      }
    }
  }
};

const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n");
    const nonEmptyLines = lines.filter((l) => (l?.trim() ?? "").length > 0);
    if (nonEmptyLines.length === 0) return text;

    const minIndent = Math.min(
      ...nonEmptyLines.map((l) => {
        const match = l?.match(/^(\s*)/);
        return match?.[1]?.length ?? 0;
      }),
    );

    return lines.map((l) => ((l?.trim() ?? "").length === 0 ? l : l?.slice(minIndent) ?? "")).join("\n");
  };

  const normalizedFind = removeIndentation(find);
  const contentLines = content.split("\n");
  const findLines = find.split("\n");

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n");
    if (removeIndentation(block) === normalizedFind) {
      yield block;
    }
  }
};

const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n");
  if (findLines.length < 3) {
    return;
  }

  if (findLines[findLines.length - 1] === "") {
    findLines.pop();
  }

  const contentLines = content.split("\n");
  const firstLine = findLines[0]?.trim() ?? "";
  const lastLine = findLines[findLines.length - 1]?.trim() ?? "";

  for (let i = 0; i < contentLines.length; i++) {
    if ((contentLines[i]?.trim() ?? "") !== firstLine) continue;

    for (let j = i + 2; j < contentLines.length; j++) {
      if ((contentLines[j]?.trim() ?? "") === lastLine) {
        const blockLines = contentLines.slice(i, j + 1);

        if (blockLines.length === findLines.length) {
          let matchingLines = 0;
          let totalNonEmptyLines = 0;

          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k]?.trim() ?? "";
            const findLine = findLines[k]?.trim() ?? "";

            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++;
              if (blockLine === findLine) {
                matchingLines++;
              }
            }
          }

          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield blockLines.join("\n");
            break;
          }
        }
        break;
      }
    }
  }
};

const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let startIndex = 0;

  while (true) {
    const index = content.indexOf(find, startIndex);
    if (index === -1) break;

    yield find;
    startIndex = index + find.length;
  }
};

export function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

export function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text;
  return text.replaceAll("\n", "\r\n");
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.");
  }

  let notFound = true;

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      notFound = false;
      if (replaceAll) {
        return content.replaceAll(search, newString);
      }
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) continue;
      return content.substring(0, index) + newString + content.substring(index + search.length);
    }
  }

  if (notFound) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    );
  }
  throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.");
}

export const editTool: RegisteredTool = {
  definition: {
    name: "edit",
    description: `Performs exact string replacements in files.

Usage:
- You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + colon + space (e.g., \`1: \`). Everything after that space is the actual file content to match. Never include any part of the line number prefix in the oldString or newString.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if oldString is not found in the file with an error "oldString not found in content".
- The edit will FAIL if oldString is found multiple times in the file with an error "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match." Either provide a larger string with more surrounding context to make it unique or use replaceAll to change every instance of oldString.
- Use replaceAll for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The absolute path to the file to modify",
        },
        oldString: {
          type: "string",
          description: "The text to replace",
        },
        newString: {
          type: "string",
          description: "The text to replace it with (must be different from oldString)",
        },
        replaceAll: {
          type: "boolean",
          description: "Replace all occurrences of oldString (default false)",
        },
      },
      required: ["filePath", "oldString", "newString"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        applied: { type: "boolean" },
        oldString: { type: "string" },
        newString: { type: "string" },
      },
      required: ["path", "applied"],
      additionalProperties: false,
    }),
    capability: "edit",
  },

  async execute(args) {
    const filePath = requiredStringArg(args, "filePath");
    const oldString = requiredStringArg(args, "oldString");
    const newString = requiredStringArg(args, "newString");
    const replaceAll = optionalBooleanArg(args, "replaceAll") ?? false;

    if (oldString === newString) {
      throw new Error("No changes to apply: oldString and newString are identical.");
    }

    // Ensure absolute path
    let filepath = filePath;
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(process.cwd(), filepath);
    }

    // Check file exists and is not a directory
    if (!existsSync(filepath)) {
      throw new Error(`File not found: ${filepath}`);
    }

    const stats = statSync(filepath);
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${filepath}`);
    }

    // Read file content
    const content = readFileSync(filepath, "utf-8");

    // Detect line ending
    const ending = detectLineEnding(content);
    const old = convertToLineEnding(normalizeLineEndings(oldString), ending);
    const next = convertToLineEnding(normalizeLineEndings(newString), ending);

    // Perform replacement with fuzzy matching
    const newContent = replace(content, old, next, replaceAll);

    // Write back
    writeFileSync(filepath, newContent, "utf-8");

    return {
      content: `Successfully edited ${filepath}${replaceAll ? " (replaced all occurrences)" : ""}`,
      data: {
        path: filepath,
        applied: true,
        oldString,
        newString,
      },
      activity: createActivity("file_edit", `Edited ${filepath}`, filepath),
    };
  },
};
