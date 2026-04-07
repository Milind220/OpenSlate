/**
 * Tool registry — manages tool registration, lookup, and execution.
 */

import type {
  ToolCapability,
  ToolCall,
  ToolResult,
  RegisteredTool,
  ToolRegistry,
} from "./types.js";

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();

  return {
    register(tool: RegisteredTool): void {
      tools.set(tool.definition.name, tool);
    },

    get(name: string): RegisteredTool | undefined {
      return tools.get(name);
    },

    list(): RegisteredTool[] {
      return Array.from(tools.values());
    },

    listForCapabilities(capabilities: ToolCapability[]): RegisteredTool[] {
      const capSet = new Set(capabilities);
      return Array.from(tools.values()).filter(
        (t) => capSet.has(t.definition.capability)
      );
    },

    getToolSet(capabilities: ToolCapability[]): Record<string, { description: string; parameters: Record<string, unknown> }> {
      const result: Record<string, { description: string; parameters: Record<string, unknown> }> = {};
      for (const tool of this.listForCapabilities(capabilities)) {
        result[tool.definition.name] = {
          description: tool.definition.description,
          parameters: tool.definition.parameters,
        };
      }
      return result;
    },

    async execute(call: ToolCall, allowedCapabilities: ToolCapability[]): Promise<ToolResult> {
      const start = Date.now();
      const tool = tools.get(call.name);

      if (!tool) {
        return {
          toolCallId: call.id,
          toolName: call.name,
          content: `Error: unknown tool "${call.name}"`,
          isError: true,
          durationMs: Date.now() - start,
        };
      }

      const capSet = new Set(allowedCapabilities);
      if (!capSet.has(tool.definition.capability)) {
        return {
          toolCallId: call.id,
          toolName: call.name,
          content: `Error: tool "${call.name}" requires capability "${tool.definition.capability}" which is not allowed`,
          isError: true,
          durationMs: Date.now() - start,
        };
      }

      try {
        const content = await tool.execute(call.args);
        return {
          toolCallId: call.id,
          toolName: call.name,
          content,
          isError: false,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          toolCallId: call.id,
          toolName: call.name,
          content: `Error: ${message}`,
          isError: true,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}
