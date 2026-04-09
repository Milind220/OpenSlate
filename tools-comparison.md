# OpenSlate vs OpenCode Tools Comparison

## Quick Comparison Table

| Category | OpenSlate (11 tools) | OpenCode (21+ tools) |
|----------|---------------------|---------------------|
| **File Read** | `read_file` | `read` |
| **File Write** | `write_file` | `write` |
| **File Edit** | `apply_patch` | `edit`, `apply_patch`, `multiedit` |
| **File Search** | `glob_files`, `grep_content` | `glob`, `grep` |
| **Directory List** | `list_directory` | `list` |
| **Metadata** | `stat_path` | (via `read`) |
| **Shell** | `shell` | `bash` |
| **Git** | `git_status`, `git_diff`, `git_log` | (via `bash`) |
| **Web Fetch** | — | `fetch` |
| **Web Search** | — | `search`, `code` |
| **User Ask** | — | `ask` |
| **Subagent Task** | — | `task` |
| **Todo Management** | — | `todo` |
| **Skill Loading** | — | `skill` |
| **LSP/Code Intel** | — | `lsp` |
| **Batch Execution** | — | `batch` |
| **Plan Mode** | — | `plan_exit` |

## Tool Count by Category

| Category | OpenSlate | OpenCode |
|----------|-----------|----------|
| File Operations | 5 | 8 |
| Shell/Execution | 2 | 1 |
| Git | 3 | 0 |
| Web | 0 | 3 |
| Agent/Session | 0 | 4 |
| Code Intelligence | 0 | 1 |
| UI/Interaction | 0 | 1 |
| **Total** | **11** | **21+** |

## Capability Matrix

| Capability | OpenSlate | OpenCode |
|------------|-----------|----------|
| Basic file I/O | ✓ | ✓ |
| Pattern matching search | ✓ | ✓ |
| Shell command execution | ✓ | ✓ |
| Git operations | ✓ (native) | ✓ (via shell) |
| Web content fetch | ✗ | ✓ |
| Web search | ✗ | ✓ |
| Interactive user prompts | ✗ | ✓ |
| Subagent spawning | ✗ | ✓ |
| LSP integration | ✗ | ✓ |
| Skill system | ✗ | ✓ |
| Batch operations | ✗ | ✓ |

---

## Post-Note: OpenCode Tool Details

### File Locations
All OpenCode tools are in: `opencode/packages/opencode/src/tool/`

Registry file: `opencode/packages/opencode/src/tool/registry.ts` (lines 138-155)

### Detailed Tool Descriptions

| Tool ID | File Path | What It Does |
|---------|-----------|--------------|
| `invalid` | `invalid.ts` | Fallback handler for unknown/invalid tool calls. Returns error message. |
| `ask` | `question.ts` | Displays interactive question dialog to user with multiple choice options. Waits for user response. |
| `bash` | `bash.ts` | Executes shell commands with permission checking. Supports command parsing for file operation detection. Timeout support (default 2min). |
| `read` | `read.ts` | Reads file contents with optional offset/limit for large files. Returns file metadata (path, lines, total). |
| `glob` | `glob.ts` | Finds files matching glob patterns using Bun.Glob. Returns sorted file paths with limit. |
| `grep` | `grep.ts` | Searches file contents using regex patterns. Returns matching lines with file:line format. |
| `edit` | `edit.ts` | Edits files using fuzzy matching algorithms. Supports replaceAll and single occurrence replacement. |
| `write` | `write.ts` | Writes/creates files with content. Auto-creates parent directories. Overwrites existing files. |
| `task` | `task.ts` | Spawns subagent tasks. Supports task resumption via task_id. Creates child sessions with specific agent types (explore, general, etc.). |
| `fetch` | `webfetch.ts` | Fetches web content from URLs. Converts to markdown, text, or HTML. Uses fetch API. |
| `todo` | `todo.ts` | Manages session todo lists. Creates structured task lists with status tracking. |
| `search` | `websearch.ts` | Web search via Exa AI API. Returns search results with summaries. |
| `code` | `codesearch.ts` | Code/API documentation search via Exa AI. Specialized for programming queries. |
| `skill` | `skill.ts` | Loads specialized skills from `/skills/` directory. Injects SKILL.md content and bundled resources into context. |
| `apply_patch` | `apply_patch.ts` | Applies unified diff patches to files. Alternative to edit for LLM-generated patches. |
| `lsp` | `lsp.ts` | LSP operations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls. |
| `batch` | `batch.ts` | Experimental batch tool execution. Runs multiple tools in sequence. |
| `plan_exit` | `plan.ts` | Exits plan mode, switches to build agent. Shows approval dialog before switching. |
| `list` | `ls.ts` | Lists directory contents with ignore patterns (node_modules, .git, etc.). Returns tree structure. |
| `multiedit` | `multiedit.ts` | Applies multiple sequential edits to a single file. Wraps edit tool in batch. |

### Conditional/Experimental Tools

| Tool | Condition | Notes |
|------|-----------|-------|
| `ask` | `client in [app, cli, desktop]` or `OPENCODE_ENABLE_QUESTION_TOOL` | Not available in headless mode |
| `lsp` | `OPENCODE_EXPERIMENTAL_LSP_TOOL` flag | Experimental LSP integration |
| `batch` | `config.experimental.batch_tool === true` | Experimental batch execution |
| `plan_exit` | `OPENCODE_EXPERIMENTAL_PLAN_MODE && client === cli` | Plan mode workflow |
| `apply_patch` | Auto-enabled for GPT models | Replaces edit/write for certain models |

### Custom Tool Loading

OpenCode supports dynamic tool loading from:

1. **Filesystem**: `{tool,tools}/*.{js,ts}` in config directories
   - Scanned at: `registry.ts` lines 112-125
   - Dynamically imported and registered

2. **Plugins**: Via `Plugin.Service` tool definitions
   - Loaded at: `registry.ts` lines 127-132
   - From `p.tool` object in plugins

### Tool Infrastructure Files

| File | Path | Purpose |
|------|------|---------|
| `tool.ts` | `src/tool/tool.ts` | Base `Tool` namespace with `define()` and `defineEffect()` |
| `registry.ts` | `src/tool/registry.ts` | Main registry, tool registration, dependency injection |
| `schema.ts` | `src/tool/schema.ts` | Zod schema definitions for tool parameters |
| `truncate.ts` | `src/tool/truncate.ts` | Output truncation utility |
| `external-directory.ts` | `src/tool/external-directory.ts` | External directory permission assertions |
| `invalid.ts` | `src/tool/invalid.ts` | Invalid tool handler |
