/**
 * Skill tool - loads specialized skills.
 * Based on OpenCode's skill.ts implementation.
 */

import * as path from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { RegisteredTool } from "../types.js";
import { createActivity, requiredStringArg, returnsSchema } from "../types.js";

// Skill definition
export interface Skill {
  name: string;
  description: string;
  location: string;
  content: string;
  files: string[];
}

// Skill registry - in production this would scan a skills directory
const skillsDir = process.env.SKILLS_DIR || path.join(process.cwd(), ".openslate", "skills");

function discoverSkills(): Skill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: Skill[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(skillsDir, entry.name);
      const skillFile = path.join(skillPath, "SKILL.md");

      if (!existsSync(skillFile)) continue;

      try {
        const content = readFileSync(skillFile, "utf-8");

        // Extract description from first paragraph
        const lines = content.split("\n");
        const description = lines
          .find((line) => line.trim() && !line.startsWith("#"))
          ?.trim() ?? "No description available";

        // List additional files
        const files: string[] = [];
        try {
          const fileEntries = readdirSync(skillPath, { withFileTypes: true, recursive: true });
          for (const fileEntry of fileEntries) {
            if (!fileEntry.isDirectory() && fileEntry.name !== "SKILL.md") {
              const fullPath = path.join(skillPath, fileEntry.name);
              files.push(fullPath);
            }
          }
        } catch {
          // Ignore errors listing files
        }

        skills.push({
          name: entry.name,
          description,
          location: skillPath,
          content,
          files: files.slice(0, 10), // Limit to 10 files
        });
      } catch {
        // Skip skills that can't be read
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return skills;
}

function formatSkillList(skills: Skill[], verbose = false): string {
  if (skills.length === 0) {
    return "No skills available.";
  }

  const lines = skills.map((skill) => {
    if (verbose) {
      return [`- **${skill.name}**: ${skill.description}`, `  Location: ${skill.location}`].join("\n");
    }
    return `- ${skill.name}: ${skill.description}`;
  });

  return lines.join("\n");
}

export const skillTool: RegisteredTool = {
  definition: {
    name: "skill",
    description: `Load a specialized skill that provides domain-specific instructions and workflows.

Usage:
- When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.
- The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.
- Tool output includes a \`<skill_content name="...">\` block with the loaded content.
- Invoke this tool to load a skill when a task matches one of the available skills listed below.`,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name of the skill from available_skills",
        },
      },
      required: ["name"],
    },
    returns: returnsSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        content: { type: "string" },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["name", "description", "content"],
      additionalProperties: false,
    }),
    capability: "skill",
  },

  async execute(args) {
    const name = requiredStringArg(args, "name");

    // Discover available skills
    const availableSkills = discoverSkills();

    // Find the requested skill
    const skill = availableSkills.find((s) => s.name === name);

    if (!skill) {
      const available = availableSkills.map((s) => s.name).join(", ") || "none";
      throw new Error(`Skill "${name}" not found. Available skills: ${available}`);
    }

    // Format file list
    const fileList = skill.files.map((f) => `<file>${f}</file>`).join("\n");

    const output = [
      `<skill_content name="${skill.name}">`,
      `# Skill: ${skill.name}`,
      "",
      skill.content.trim(),
      "",
      `Base directory for this skill: file://${skill.location}`,
      "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
      "Note: file list is sampled.",
      "",
      "<skill_files>",
      fileList || "No additional files",
      "</skill_files>",
      "</skill_content>",
    ].join("\n");

    return {
      content: output,
      data: {
        name: skill.name,
        description: skill.description,
        content: skill.content,
        files: skill.files,
      },
      activity: createActivity("skill_load", `Loaded skill: ${skill.name}`, skill.name),
    };
  },
};

// Export skill discovery for use in description generation
export { discoverSkills, formatSkillList };
