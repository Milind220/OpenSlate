/**
 * Apply Patch tool - applies unified diff patches to files.
 * Based on OpenCode's apply_patch.ts implementation.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, statSync } from "node:fs";
import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, returnsSchema } from "../types.js";

// Unified diff patch parser
interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

interface FilePatch {
  oldFile: string;
  newFile: string;
  hunks: PatchHunk[];
  isNewFile: boolean;
  isDeleted: boolean;
  isRename: boolean;
  oldMode?: string;
  newMode?: string;
}

function parsePatch(patchText: string): FilePatch[] {
  const lines = patchText.split("\n");
  const patches: FilePatch[] = [];
  let currentPatch: FilePatch | null = null;
  let currentHunk: PatchHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Start of a new file patch
    if (line.startsWith("--- ")) {
      if (currentPatch) {
        patches.push(currentPatch);
      }

      const oldFileMatch = line.match(/^--- (.*?)(?:\t.*)?$/);
      const newFileLine = lines[i + 1];
      if (!newFileLine) continue;
      const newFileMatch = newFileLine.match(/^\+\+\+ (.*?)(?:\t.*)?$/);

      if (oldFileMatch?.[1] && newFileMatch?.[1]) {
        const oldFile = oldFileMatch[1].replace(/^a\//, "");
        const newFile = newFileMatch[1].replace(/^b\//, "");

        currentPatch = {
          oldFile,
          newFile,
          hunks: [],
          isNewFile: oldFile === "/dev/null",
          isDeleted: newFile === "/dev/null",
          isRename: false,
        };
        i++; // Skip the +++ line
      }
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(/^@@ -(\d+)(?:(\d+))? \+(\d+)(?:(\d+))? @@/);
    if (hunkMatch && currentPatch) {
      if (currentHunk) {
        currentPatch.hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1] ?? "0"),
        oldLines: parseInt(hunkMatch[2] || "1"),
        newStart: parseInt(hunkMatch[3] ?? "0"),
        newLines: parseInt(hunkMatch[4] || "1"),
        lines: [],
      };
      continue;
    }

    // Hunk content lines
    if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }

  // Push the last hunk and patch
  if (currentHunk && currentPatch) {
    currentPatch.hunks.push(currentHunk);
  }
  if (currentPatch) {
    patches.push(currentPatch);
  }

  return patches;
}

function applyHunk(content: string, hunk: PatchHunk): string {
  const lines = content.split("\n");
  const result: string[] = [];

  // Calculate actual line indices (1-based to 0-based)
  const startLine = hunk.oldStart - 1;

  // Copy lines before the hunk
  for (let i = 0; i < startLine && i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined) {
      result.push(line);
    }
  }

  // Apply hunk changes
  let oldLineIndex = startLine;
  let contextLines = 0;

  for (const line of hunk.lines) {
    if (line.startsWith(" ")) {
      // Context line - should match
      result.push(line.substring(1));
      oldLineIndex++;
      contextLines++;
    } else if (line.startsWith("-")) {
      // Line to remove
      const expectedLine = line.substring(1);
      const currentLine = lines[oldLineIndex];
      if (oldLineIndex < lines.length && currentLine === expectedLine) {
        oldLineIndex++;
      }
      // Don't add to result (removing)
    } else if (line.startsWith("+")) {
      // Line to add
      result.push(line.substring(1));
    } else if (line === "\\ No newline at end of file") {
      // Special marker, ignore
    }
  }

  // Copy remaining lines after the hunk
  for (let i = oldLineIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined) {
      result.push(line);
    }
  }

  return result.join("\n");
}

export const applyPatchTool: RegisteredTool = {
  definition: {
    name: "apply_patch",
    description: `Applies a unified diff patch to files. The patch should be in standard unified diff format.

Usage:
- Applies unified diff patches (the format used by git diff)
- Can create new files, modify existing files, and delete files
- Supports multiple file changes in a single patch
- Alternative to edit tool for LLM-generated patches
- Use this when you have a diff/patch to apply rather than making individual edits`,
    parameters: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description: "The unified diff patch content to apply",
        },
      },
      required: ["patch"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        applied: { type: "boolean" },
        files: { type: "array", items: { type: "string" } },
        created: { type: "array", items: { type: "string" } },
        modified: { type: "array", items: { type: "string" } },
        deleted: { type: "array", items: { type: "string" } },
      },
      required: ["applied", "files"],
      additionalProperties: false,
    }),
    capability: "edit",
  },

  async execute(args) {
    const patchText = requiredStringArg(args, "patch");

    // Parse the patch
    let patches: FilePatch[];
    try {
      patches = parsePatch(patchText);
    } catch (error) {
      throw new Error(`Failed to parse patch: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (patches.length === 0) {
      throw new Error("No valid patches found in the provided content");
    }

    const results = {
      applied: true,
      files: [] as string[],
      created: [] as string[],
      modified: [] as string[],
      deleted: [] as string[],
      errors: [] as string[],
    };

    // Apply each patch
    for (const patch of patches) {
      const targetFile = patch.isDeleted || patch.isNewFile ? patch.newFile : patch.oldFile;

      // Ensure absolute path
      let filepath = targetFile;
      if (!path.isAbsolute(filepath)) {
        filepath = path.resolve(process.cwd(), filepath);
      }

      results.files.push(filepath);

      try {
        if (patch.isDeleted) {
          // Delete file
          if (existsSync(filepath)) {
            unlinkSync(filepath);
            results.deleted.push(filepath);
          }
          continue;
        }

        if (patch.isNewFile) {
          // Create new file
          const newContent = applyHunk("", { oldStart: 0, oldLines: 0, newStart: 1, newLines: 0, lines: patch.hunks[0]?.lines || [] });

          mkdirSync(path.dirname(filepath), { recursive: true });
          writeFileSync(filepath, newContent, "utf-8");
          results.created.push(filepath);
          continue;
        }

        // Modify existing file
        if (!existsSync(filepath)) {
          throw new Error(`File not found: ${filepath}`);
        }

        const stats = statSync(filepath);
        if (stats.isDirectory()) {
          throw new Error(`Path is a directory: ${filepath}`);
        }

        let content = readFileSync(filepath, "utf-8");

        // Apply all hunks
        for (const hunk of patch.hunks) {
          content = applyHunk(content, hunk);
        }

        writeFileSync(filepath, content, "utf-8");
        results.modified.push(filepath);
      } catch (error) {
        results.errors.push(`${filepath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const success = results.errors.length === 0;
    const activity = createActivity(
      "patch_apply",
      success ? `Applied patch to ${results.files.length} files` : `Patch failed for ${results.errors.length} files`,
      results.files.join(", "),
      results.files.length,
    );

    return {
      content: success
        ? `Successfully applied patch to ${results.files.length} file(s):\nCreated: ${results.created.join(", ") || "none"}\nModified: ${results.modified.join(", ") || "none"}\nDeleted: ${results.deleted.join(", ") || "none"}`
        : `Partially applied patch. Success: ${results.files.length - results.errors.length}, Failed: ${results.errors.length}\n\nErrors:\n${results.errors.join("\n")}`,
      data: {
        applied: success,
        files: results.files,
        created: results.created,
        modified: results.modified,
        deleted: results.deleted,
        errors: results.errors,
      },
      activity,
    };
  },
};
