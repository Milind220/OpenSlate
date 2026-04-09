/**
 * Read tool - reads files and directories.
 * Based on OpenCode's read.ts implementation.
 */

import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline";
import {
  existsSync,
  statSync,
  readdirSync,
} from "node:fs";
import type { RegisteredTool, ToolActivity } from "../types.js";
import { createActivity, requiredStringArg, returnsSchema, optionalNumberArg } from "../types.js";

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = 50 * 1024;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;

// Binary file extensions
const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class", ".jar", ".war", ".7z",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
  ".bin", ".dat", ".obj", ".o", ".a", ".lib", ".wasm", ".pyc", ".pyo",
]);

async function isBinaryFile(filepath: string, fileSize: number): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;

  if (fileSize === 0) return false;

  const fh = await open(filepath, "r");
  try {
    const sampleSize = Math.min(4096, fileSize);
    const bytes = Buffer.alloc(sampleSize);
    const result = await fh.read(bytes, 0, sampleSize, 0);
    if (result.bytesRead === 0) return false;

    let nonPrintableCount = 0;
    for (let i = 0; i < result.bytesRead; i++) {
      const byte = bytes[i];
      if (byte === undefined) continue;
      if (byte === 0) return true;
      if (byte < 9 || (byte > 13 && byte < 32)) {
        nonPrintableCount++;
      }
    }
    // If >30% non-printable characters, consider it binary
    return nonPrintableCount / result.bytesRead > 0.3;
  } finally {
    await fh.close();
  }
}

async function* readLines(filepath: string, opts: { limit: number; offset: number }) {
  const stream = createReadStream(filepath, { encoding: "utf8" });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const start = opts.offset - 1;
  let count = 0;

  for await (const text of rl) {
    count += 1;
    if (count <= start) continue;
    if (count - start > opts.limit) {
      yield { text: null, count, more: true };
      break;
    }
    const line = text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text;
    yield { text: line, count, more: false };
  }

  rl.close();
  stream.destroy();
}

async function readFileContent(filepath: string, limit: number, offset: number): Promise<{
  raw: string[];
  count: number;
  cut: boolean;
  more: boolean;
  offset: number;
}> {
  const raw: string[] = [];
  let bytes = 0;
  let count = 0;
  let cut = false;
  let more = false;
  let actualOffset = offset;

  for await (const item of readLines(filepath, { limit, offset })) {
    if (item.text === null) {
      more = true;
      break;
    }
    count = item.count;
    more = item.more;

    const size = Buffer.byteLength(item.text, "utf-8") + (raw.length > 0 ? 1 : 0);
    if (bytes + size > MAX_BYTES) {
      cut = true;
      more = true;
      break;
    }

    raw.push(item.text);
    bytes += size;
  }

  return { raw, count, cut, more, offset: actualOffset };
}

function listDirectoryEntries(dirPath: string): string[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  return entries
    .map((entry) => {
      if (entry.isDirectory()) return entry.name + "/";
      return entry.name;
    })
    .sort((a, b) => a.localeCompare(b));
}

export const readTool: RegisteredTool = {
  definition: {
    name: "read",
    description: `Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- The filePath parameter should be an absolute path.
- By default, this tool returns up to 2000 lines from the start of the file.
- The offset parameter is the line number to start from (1-indexed).
- To read later sections, call this tool again with a larger offset.
- Use the grep tool to find specific content in large files or files with long lines.
- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.
- Contents are returned with each line prefixed by its line number as \`<line>: <content>\`. For example, if a file has contents "foo\\n", you will receive "1: foo\\n". For directories, entries are returned one per line (without line numbers) with a trailing \`/\` for subdirectories.
- Any line longer than 2000 characters is truncated.
- Call this tool in parallel when you know there are multiple files you want to read.
- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.
- This tool can read image files and PDFs and return them as file attachments.`,
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The absolute path to the file or directory to read",
        },
        offset: {
          type: "number",
          description: "The line number to start reading from (1-indexed)",
        },
        limit: {
          type: "number",
          description: "The maximum number of lines to read (defaults to 2000)",
        },
      },
      required: ["filePath"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        path: { type: "string" },
        type: { type: "string", enum: ["file", "directory"] },
        offset: { type: "number" },
        limit: { type: "number" },
        totalLines: { type: "number" },
        truncated: { type: "boolean" },
      },
      required: ["path", "type"],
      additionalProperties: false,
    }),
    capability: "read",
  },

  async execute(args) {
    const filePath = requiredStringArg(args, "filePath");

    if (args.offset !== undefined && (typeof args.offset !== "number" || args.offset < 1)) {
      throw new Error("offset must be greater than or equal to 1");
    }

    let filepath = filePath;
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(process.cwd(), filepath);
    }

    // Check if file/directory exists
    if (!existsSync(filepath)) {
      // Try to suggest similar files
      const dir = path.dirname(filepath);
      const base = path.basename(filepath);
      try {
        const items = readdirSync(dir)
          .filter(
            (item) =>
              item.toLowerCase().includes(base.toLowerCase()) ||
              base.toLowerCase().includes(item.toLowerCase()),
          )
          .map((item) => path.join(dir, item))
          .slice(0, 3);

        if (items.length > 0) {
          throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${items.join("\n")}`);
        }
      } catch {
        // Directory might not exist either
      }
      throw new Error(`File not found: ${filepath}`);
    }

    const stats = statSync(filepath);

    // Handle directory
    if (stats.isDirectory()) {
      const entries = listDirectoryEntries(filepath);
      const limit = optionalNumberArg(args, "limit") ?? DEFAULT_READ_LIMIT;
      const offset = (optionalNumberArg(args, "offset") ?? 1) - 1;
      const sliced = entries.slice(offset, offset + limit);
      const truncated = offset + sliced.length < entries.length;

      return {
        content: [
          `<path>${filepath}</path>`,
          `<type>directory</type>`,
          `<entries>`,
          sliced.join("\n"),
          truncated
            ? `\n(Showing ${sliced.length} of ${entries.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length + 1})`
            : `\n(${entries.length} entries)`,
          `</entries>`,
        ].join("\n"),
        data: {
          path: filepath,
          type: "directory",
          offset: offset + 1,
          limit,
          totalLines: entries.length,
          truncated,
        },
        activity: createActivity("directory_read", `Read ${sliced.length} entries`, filepath, sliced.length),
      };
    }

    // Check for binary file
    if (await isBinaryFile(filepath, stats.size)) {
      throw new Error(`Cannot read binary file: ${filepath}`);
    }

    // Check if it's an image or PDF
    const mime = getMimeType(filepath);
    const isImage = mime.startsWith("image/") && mime !== "image/svg+xml";
    const isPdf = mime === "application/pdf";

    if (isImage || isPdf) {
      const content = Buffer.from(await readFileBuffer(filepath)).toString("base64");
      return {
        content: `${isImage ? "Image" : "PDF"} read successfully`,
        data: {
          path: filepath,
          type: "file",
          mime,
          base64: content,
        },
        activity: createActivity("file_read", `Read ${isImage ? "image" : "PDF"} file`, filepath),
      };
    }

    // Read text file
    const limit = optionalNumberArg(args, "limit") ?? DEFAULT_READ_LIMIT;
    const offset = optionalNumberArg(args, "offset") ?? 1;
    const file = await readFileContent(filepath, limit, offset);

    if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
      throw new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`);
    }

    let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>" + "\n"].join("\n");
    output += file.raw.map((line, i) => `${i + file.offset}: ${line}`).join("\n");

    const last = file.offset + file.raw.length - 1;
    const next = last + 1;
    const truncated = file.more || file.cut;
    if (file.cut) {
      output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`;
    } else if (file.more) {
      output += `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)`;
    } else {
      output += `\n\n(End of file - total ${file.count} lines)`;
    }
    output += "\n</content>";

    return {
      content: output,
      data: {
        path: filepath,
        type: "file",
        offset: file.offset,
        limit,
        totalLines: file.count,
        truncated,
      },
      activity: createActivity("file_read", `Read ${file.raw.length} lines`, filepath, file.raw.length),
    };
  },
};

async function readFileBuffer(filepath: string): Promise<Buffer> {
  const fh = await open(filepath, "r");
  try {
    const stats = await fh.stat();
    const buffer = Buffer.alloc(stats.size);
    await fh.read(buffer, 0, stats.size, 0);
    return buffer;
  } finally {
    await fh.close();
  }
}

function getMimeType(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".js": "application/javascript",
    ".ts": "application/typescript",
    ".html": "text/html",
    ".css": "text/css",
  };
  return mimeTypes[ext] || "application/octet-stream";
}
