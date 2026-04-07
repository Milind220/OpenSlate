/**
 * Tool registry and builtin tool tests.
 */

import { describe, test, expect } from "bun:test";
import { createToolRegistry, registerBuiltinTools, BUILTIN_TOOLS } from "./index.js";
import type { ToolCapability } from "./types.js";

describe("ToolRegistry", () => {
  test("registers and lists tools", () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const all = registry.list();
    expect(all.length).toBe(6);

    const names = all.map((t) => t.definition.name);
    expect(names).toContain("read_file");
    expect(names).toContain("glob_files");
    expect(names).toContain("grep_content");
    expect(names).toContain("write_file");
    expect(names).toContain("apply_patch");
    expect(names).toContain("shell");
  });

  test("listForCapabilities filters correctly", () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const readTools = registry.listForCapabilities(["read"]);
    expect(readTools.length).toBe(2); // read_file, glob_files
    expect(readTools.every((t) => t.definition.capability === "read")).toBe(true);

    const writeTools = registry.listForCapabilities(["write"]);
    expect(writeTools.length).toBe(2); // write_file, apply_patch

    const searchTools = registry.listForCapabilities(["search"]);
    expect(searchTools.length).toBe(1); // grep_content

    const shellTools = registry.listForCapabilities(["shell"]);
    expect(shellTools.length).toBe(1); // shell
  });

  test("getToolSet returns descriptions and parameters", () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const toolSet = registry.getToolSet(["read", "search"]);
    expect(Object.keys(toolSet)).toHaveLength(3); // read_file, glob_files, grep_content
    expect(toolSet.read_file).toBeDefined();
    expect(toolSet.read_file!.description).toContain("Read");
    expect(toolSet.read_file!.parameters).toBeDefined();
  });

  test("execute denies tool when capability not allowed", async () => {
    const registry = createToolRegistry();
    registerBuiltinTools(registry);

    const result = await registry.execute(
      { id: "tc-1", name: "write_file", args: { path: "/tmp/test", content: "hi" } },
      ["read"] as ToolCapability[], // only read allowed
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

  test("BUILTIN_TOOLS constant has all 6 tools", () => {
    expect(BUILTIN_TOOLS).toHaveLength(6);
  });
});
