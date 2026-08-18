/**
 * OMP skill discovery — reads skills from OMP agent directory and project
 * .agents/skills, replacing pi SDK's DefaultResourceLoader.
 *
 * OMP v17.3.5 skill sources:
 *   1. ~/.omp/agent/managed-skills/<name>/SKILL.md  — global managed skills
 *   2. <cwd>/.agents/skills/<name>/SKILL.md          — project skills
 *
 * No configured skill paths (settings.json) are read because OMP stores
 * skill configuration in config.yml, not in pi's settings.json format.
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { getAgentDir } from "@/lib/session-reader";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import type { ResourceDiagnostic } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";

/**
 * Parse minimal YAML frontmatter (---\n...\n---) from a SKILL.md file.
 * Returns the parsed frontmatter object and the body content after the
 * closing `---`.
 */
function parseSimpleFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim();
      let value: unknown = kv[2].trim();
      // Parse booleans
      if (value === "true") value = true;
      else if (value === "false") value = false;
      frontmatter[key] = value;
    }
  }
  return { frontmatter, body: match[2] };
}

function discoverSkillsInDir(
  skillsDir: string,
  scope: "global" | "project",
): SkillInfo[] {
  if (!existsSync(skillsDir)) return [];

  const skills: SkillInfo[] = [];
  try {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;

      try {
        const content = readFileSync(skillMdPath, "utf8");
        const { frontmatter } = parseSimpleFrontmatter(content);
        const name = (frontmatter.name as string) || entry.name;
        const description = (frontmatter.description as string) || "";
        const disableModelInvocation = frontmatter["disable-model-invocation"] === true;

        // Extract first heading or first paragraph as description fallback
        let bodyDesc = "";
        const bodyMatch = content.match(/^---[\s\S]*?---\r?\n?#+\s*(.+)/m);
        if (bodyMatch) {
          bodyDesc = bodyMatch[1].trim();
        }

        skills.push({
          name,
          description: description || bodyDesc || name,
          filePath: skillMdPath,
          baseDir: join(skillsDir, entry.name),
          disableModelInvocation,
          sourceInfo: {
            scope,
            source: scope === "global" ? "managed" : "project",
          },
        });
      } catch {
        // Skip unreadable skills
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return skills;
}

export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  const diagnostics: ResourceDiagnostic[] = [];

  // Global managed skills: ~/.omp/agent/managed-skills/
  const globalSkills = discoverSkillsInDir(
    join(agentDir, "managed-skills"),
    "global",
  );

  // Project skills: <cwd>/.agents/skills/
  const projectSkills = discoverSkillsInDir(
    join(cwd, ".agents", "skills"),
    "project",
  );

  const allSkills = [...globalSkills, ...projectSkills];

  // Annotate with install info from locks
  const annotated = annotateSkillsWithInstallInfo(allSkills, { cwd, agentDir });

  return {
    skills: annotated,
    diagnostics,
    projectResourcesLoaded: true,
  };
}