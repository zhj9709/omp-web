import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@/lib/session-reader";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

/**
 * Minimal YAML frontmatter parser — extracts key-value pairs from the
 * `---\n...\n---` block at the start of a SKILL.md file.
 * Used for the PATCH handler to toggle disable-model-invocation.
 */
function parseSimpleFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const fm: Record<string, unknown> = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim();
      let value: unknown = kv[2].trim();
      if (value === "true") value = true;
      else if (value === "false") value = false;
      fm[key] = value;
    }
  }
  return fm;
}

/**
 * GET /api/skills?cwd=<path>
 *
 * Discovers skills from OMP managed-skills directory and project .agents/skills.
 * Returns skill metadata including install info and disable-model-invocation status.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await loadSkillsWithInstallInfo(cwd));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * PATCH /api/skills — toggle disable-model-invocation on a SKILL.md file.
 *
 * Performs surgical edit of the frontmatter: adds or removes the
 * `disable-model-invocation: true` key while preserving all other YAML fields.
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { filePath: string; disableModelInvocation: boolean };
    const { filePath, disableModelInvocation } = body;
    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    // The write whitelist covers ~/.omp/agent wholesale (skills live inside);
    // narrow the *target* to SKILL.md so config/credential files in that
    // directory can never be touched by the frontmatter editor.
    if (path.basename(filePath) !== "SKILL.md") {
      return NextResponse.json({ error: "Only SKILL.md files can be modified" }, { status: 400 });
    }
    if (!existsSync(filePath)) return NextResponse.json({ error: "file not found" }, { status: 404 });
    const allowedRoots = new Set(await getAllowedFileRoots());
    allowedRoots.add(getAgentDir());
    // Globally installed skills live in ~/.agents/skills and are symlinked into
    // the agent's skills dir; isExistingFilePathAllowed resolves the symlink, so
    // the real target sits outside getAgentDir(). Allow the global skills root
    // too (the SDK always treats ~/.agents/skills as trusted).
    const globalSkillsDir = path.join(homedir(), ".agents", "skills");
    if (existsSync(globalSkillsDir)) allowedRoots.add(globalSkillsDir);
    if (!isExistingFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const content = readFileSync(filePath, "utf8");
    const key = "disable-model-invocation";

    const frontmatter = parseSimpleFrontmatter(content);
    const alreadySet = Boolean(frontmatter[key]);

    let updated = content;
    if (disableModelInvocation && !alreadySet) {
      // Add key after the opening --- line
      updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
      // If no frontmatter exists, create one
      if (updated === content) updated = `---\n${key}: true\n---\n${content}`;
    } else if (!disableModelInvocation && alreadySet) {
      // Remove the key line entirely
      updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
    }

    writeFileSync(filePath, updated, "utf8");
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}