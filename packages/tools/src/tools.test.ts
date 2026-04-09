/**
 * Tool registry and builtin tool tests.
 */

import { describe, test, expect } from "bun:test";
import { createToolRegistry, registerBuiltinTools, BUILTIN_TOOLS } from "./index.js";
import type { ToolCapability, ToolSchema } from "./types.js";

describe("ToolRegistry", () => {
  test("registers and lists tools", () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const all = registry.list();
    expect(all.length).toBe(11);

    const names = all.map((t) => t.definition.name);
    expect(names).toContain("read_file");
    expect(names).toContain("glob_files");
    expect(names).toContain("grep_content");
    expect(names).toContain("list_directory");
    expect(names).toContain("stat_path");
    expect(names).toContain("write_file");
    expect(names).toContain("apply_patch");
    expect(names).toContain("shell");
    expect(names).toContain("git_status");
    expect(names).toContain("git_diff");
    expect(names).toContain("git_log");
  });

  test("listForCapabilities filters correctly including git", () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const readTools = registry.listForCapabilities(["read"]);
    expect(readTools.length).toBe(4); // read_file, glob_files, list_directory, stat_path
    expect(readTools.every((t) => t.definition.capability === "read")).toBe(true);

    const writeTools = registry.listForCapabilities(["write"]);
    expect(writeTools.length).toBe(2); // write_file, apply_patch

    const searchTools = registry.listForCapabilities(["search"]);
    expect(searchTools.length).toBe(1); // grep_content

    const shellTools = registry.listForCapabilities(["shell"]);
    expect(shellTools.length).toBe(1); // shell

    const gitTools = registry.listForCapabilities(["git"]);
    expect(gitTools.length).toBe(3); // git_status, git_diff, git_log
    expect(gitTools.map((t) => t.definition.name)).toEqual(
      expect.arrayContaining(["git_status", "git_diff", "git_log"]),
    );
  });

  test("getToolSet returns descriptions, parameters, and returns", () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const toolSet = registry.getToolSet(["read", "search"]);
    expect(Object.keys(toolSet)).toHaveLength(5); // 4 read + 1 search
    expect(toolSet.read_file).toBeDefined();
    expect(toolSet.read_file!.description).toContain("Read");
    expect(toolSet.read_file!.parameters).toBeDefined();
    expect(toolSet.read_file!.returns).toBeDefined();
  });

  test("all builtins expose a returns schema with content", () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(tool.definition.returns).toBeDefined();
      const returns = tool.definition.returns as ToolSchema;
      expect(returns.type).toBe("object");
      const props = returns.properties as Record<string, unknown>;
      expect(props).toBeDefined();
      expect(props.content).toBeDefined();
    }
  });

  test("execute denies tool when capability not allowed", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-1", name: "write_file", args: { path: "/tmp/test", content: "hi" } },
      ["read"] as ToolCapability[],
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("requires capability");
  });

  test("execute denies git tool when git capability not allowed", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-git-denied", name: "git_status", args: { cwd: process.cwd() } },
      ["read", "write", "search", "shell"] as ToolCapability[],
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("requires capability \"git\"");
  });

  test("execute returns error for unknown tool", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-1", name: "nonexistent_tool", args: {} },
      ["read", "write", "search", "shell", "git"] as ToolCapability[],
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("unknown tool");
  });

  test("BUILTIN_TOOLS constant has all 11 tools", () => {
    expect(BUILTIN_TOOLS).toHaveLength(11);
  });

  test("execute list_directory succeeds and returns activity/data", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-list", name: "list_directory", args: { path: import.meta.dir } },
      ["read"] as ToolCapability[],
    );

    expect(result.isError).toBe(false);
    expect(result.activity?.type).toBe("list_directory");
    expect(result.data).toBeDefined();

    const data = result.data as { entries?: Array<{ path: string }> };
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries!.some((entry) => entry.path.endsWith("builtins.ts"))).toBe(true);
  });

  test("execute git_status succeeds with git capability", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-git-ok", name: "git_status", args: { cwd: process.cwd() } },
      ["git"] as ToolCapability[],
    );

    expect(result.isError).toBe(false);
    expect(result.activity?.type).toBe("git_status");
  });

  test("execute surfaces invalid argument errors clearly", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-2", name: "read_file", args: {} },
      ["read"] as ToolCapability[],
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid or missing 'path' argument");
  });
});
