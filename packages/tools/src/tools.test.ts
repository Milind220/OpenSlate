/**
 * Tool registry and builtin tool tests.
 * Updated for OpenCode-style tools.
 */

import { describe, test, expect } from "bun:test";
import { createToolRegistry, registerBuiltinTools, BUILTIN_TOOLS } from "./index.js";
import type { ToolCapability, ToolSchema } from "./types.js";

describe("ToolRegistry", () => {
  test("registers and lists tools", () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const all = registry.list();
    // We now have 19 tools in the OpenCode-style set (20 minus plan_exit)
    expect(all.length).toBe(19);

    const names = all.map((t) => t.definition.name);
    // File Operations
    expect(names).toContain("read");
    expect(names).toContain("write");
    expect(names).toContain("edit");
    expect(names).toContain("multiedit");
    expect(names).toContain("apply_patch");
    // File Search
    expect(names).toContain("glob");
    expect(names).toContain("grep");
    expect(names).toContain("list");
    // Shell
    expect(names).toContain("bash");
    // Web
    expect(names).toContain("fetch");
    expect(names).toContain("search");
    expect(names).toContain("code");
    // Agent/Task
    expect(names).toContain("task");
    expect(names).toContain("todo");
    expect(names).toContain("ask");
    // Code Intelligence
    expect(names).toContain("skill");
    expect(names).toContain("lsp");
    // Utilities
    expect(names).toContain("batch");
    expect(names).toContain("invalid");
  });

  test("listForCapabilities filters correctly", () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const readTools = registry.listForCapabilities(["read"]);
    expect(readTools.length).toBe(2); // read, list
    expect(readTools.every((t) => t.definition.capability === "read")).toBe(true);

    const writeTools = registry.listForCapabilities(["write"]);
    expect(writeTools.length).toBe(1); // write

    const editTools = registry.listForCapabilities(["edit"]);
    expect(editTools.length).toBe(3); // edit, multiedit, apply_patch

    const searchTools = registry.listForCapabilities(["search"]);
    expect(searchTools.length).toBe(2); // glob, grep

    const shellTools = registry.listForCapabilities(["shell"]);
    expect(shellTools.length).toBe(1); // bash

    const webTools = registry.listForCapabilities(["web"]);
    expect(webTools.length).toBe(3); // fetch, search, code

    const agentTools = registry.listForCapabilities(["agent"]);
    expect(agentTools.length).toBe(4); // task, todo, ask, invalid

    const skillTools = registry.listForCapabilities(["skill"]);
    expect(skillTools.length).toBe(1); // skill

    const lspTools = registry.listForCapabilities(["lsp"]);
    expect(lspTools.length).toBe(1); // lsp

    const batchTools = registry.listForCapabilities(["batch"]);
    expect(batchTools.length).toBe(1); // batch
  });

  test("getToolSet returns descriptions, parameters, and returns", () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const toolSet = registry.getToolSet(["read", "search"]);
    expect(Object.keys(toolSet)).toHaveLength(4); // 2 read (read, list) + 2 search (glob, grep)
    expect(toolSet.read).toBeDefined();
    expect(toolSet.read!.description).toContain("Read");
    expect(toolSet.read!.parameters).toBeDefined();
    expect(toolSet.read!.returns).toBeDefined();
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
      { id: "tc-1", name: "write", args: { filePath: "/tmp/test", content: "hi" } },
      ["read"] as ToolCapability[],
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("requires capability");
  });

  test("execute returns error for unknown tool", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-1", name: "nonexistent_tool", args: {} },
      ["read", "write", "search", "shell"] as ToolCapability[],
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("unknown tool");
  });

  test("BUILTIN_TOOLS constant has all 19 tools", () => {
    expect(BUILTIN_TOOLS).toHaveLength(19);
  });

  test("execute list succeeds and returns activity/data", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-list", name: "list", args: { path: import.meta.dir } },
      ["read"] as ToolCapability[],
    );

    expect(result.isError).toBe(false);
    expect(result.activity?.type).toBe("directory_list");
    expect(result.data).toBeDefined();

    const data = result.data as { entries?: string[] };
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries!.some((entry) => entry.endsWith("builtins.ts"))).toBe(true);
  });

  test("execute read succeeds with read capability", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    // Create a test file first
    const testFile = "/tmp/opencode_test_read.txt";
    await registry.execute(
      { id: "tc-write-setup", name: "write", args: { filePath: testFile, content: "test content" } },
      ["write"] as ToolCapability[],
    );

    const result = await registry.execute(
      { id: "tc-read-ok", name: "read", args: { filePath: testFile } },
      ["read"] as ToolCapability[],
    );

    expect(result.isError).toBe(false);
    expect(result.activity?.type).toBe("file_read");
    expect(result.content).toContain("test content");
  });

  test("execute surfaces invalid argument errors clearly", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-2", name: "read", args: {} },
      ["read"] as ToolCapability[],
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid or missing 'filePath' argument");
  });

  test("execute bash tool with shell capability", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-bash", name: "bash", args: { command: "echo hello", description: "Test echo" } },
      ["shell"] as ToolCapability[],
    );

    expect(result.isError).toBe(false);
    expect(result.activity?.type).toBe("shell_exec");
    expect(result.content).toContain("hello");
  });

  test("execute grep tool finds content", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    // Create a test file
    const testFile = "/tmp/opencode_test_grep.txt";
    await registry.execute(
      { id: "tc-write-grep", name: "write", args: { filePath: testFile, content: "line 1\nsearch target\nline 3" } },
      ["write"] as ToolCapability[],
    );

    const result = await registry.execute(
      { id: "tc-grep", name: "grep", args: { pattern: "search", path: "/tmp" } },
      ["search"] as ToolCapability[],
    );

    expect(result.isError).toBe(false);
    expect(result.activity?.type).toBe("grep_search");
  });

  test("execute todo tool manages tasks", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      {
        id: "tc-todo",
        name: "todo",
        args: {
          todos: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
            { id: "2", content: "Task 2", status: "completed", priority: "medium" },
          ],
        },
      },
      ["agent"] as ToolCapability[],
    );

    expect(result.isError).toBe(false);
    expect(result.activity?.type).toBe("todo_update");
    expect(result.content).toContain("Task 1");
    expect(result.content).toContain("Task 2");
  });
});
