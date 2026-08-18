import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import type {
  PluginDiagnostic,
  PluginPackageInfo,
  PluginResourceCounts,
  PluginResourceInfo,
  PluginScope,
  PluginsResponse,
} from "@/lib/api-types";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

function emptyCounts(): PluginResourceCounts {
  return { extensions: 0, skills: 0, prompts: 0, themes: 0 };
}

/**
 * OMP plugin list output (omp plugin list --json):
 *   { npm: [...], marketplace: [...] }
 * Each entry: { name: string, version?: string, path?: string, ... }
 */
interface OmpPluginEntry {
  name: string;
  version?: string;
  path?: string;
  description?: string;
  enabled?: boolean;
}

interface OmpPluginListOutput {
  npm: OmpPluginEntry[];
  marketplace: OmpPluginEntry[];
}

async function getOmpBinary(): Promise<string> {
  return process.env.OMP_BINARY ?? "omp";
}

/**
 * Read plugins via `omp plugin list --json`.
 * Maps OMP's flat plugin list to the PluginsResponse format.
 */
async function readPlugins(cwd: string): Promise<PluginsResponse> {
  const ompBin = await getOmpBinary();
  const diagnostics: PluginDiagnostic[] = [];
  const packages: PluginPackageInfo[] = [];
  const totals = emptyCounts();

  try {
    const { stdout } = await execFileAsync(ompBin, ["plugin", "list", "--json"], {
      cwd,
      timeout: 30_000,
      env: { ...process.env },
    });

    let data: OmpPluginListOutput;
    try {
      data = JSON.parse(stdout) as OmpPluginListOutput;
    } catch {
      diagnostics.push({
        type: "error",
        message: "Failed to parse omp plugin list output",
      });
      return { packages, totals, diagnostics, projectResourcesLoaded: true };
    }

    const allEntries = [...(data.npm ?? []), ...(data.marketplace ?? [])];

    for (const entry of allEntries) {
      const scope: PluginScope = entry.path && entry.path.startsWith(cwd)
        ? "project"
        : "global";
      const counts = emptyCounts();
      const resources: PluginResourceInfo[] = [];

      // Note: `omp plugin list --json` does not enumerate individual
      // resources (extensions, skills, prompts, themes) per plugin.
      // We report the plugin as loaded but without resource breakdown.

      packages.push({
        source: entry.name,
        scope,
        filtered: false,
        disabled: entry.enabled === false,
        installedPath: entry.path,
        packageName: entry.name,
        version: entry.version,
        configuredVersion: undefined,
        counts,
        resources,
        status: entry.enabled === false
          ? "disabled"
          : entry.path
            ? "loaded"
            : "missing",
      });
    }
  } catch (error) {
    diagnostics.push({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return { packages, totals, diagnostics, projectResourcesLoaded: true };
}

/**
 * GET /api/plugins?cwd=<path>
 *
 * Returns installed plugins via `omp plugin list --json`.
 * OMP v17.3.5 does not return per-plugin resource counts (extensions, skills,
 * prompts, themes); those fields are populated as empty.
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
    return NextResponse.json(await readPlugins(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * POST /api/plugins body: { action, source?, scope?, cwd }
 *
 * Plugin management via `omp plugin <action>` CLI.
 * Supported actions: install, remove, enable, disable.
 * "update" is feature_unavailable: omp plugin upgrade exists but requires
 * interactive prompts; safe batch operation is not guaranteed.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      action?: PluginAction;
      source?: string;
      scope?: PluginScope;
      cwd?: string;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const ompBin = await getOmpBinary();
    const source = body.source?.trim();
    const scope = body.scope === "project" ? "--scope=project" : "";

    switch (body.action) {
      case "install": {
        if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
        const args = ["plugin", "install", source];
        if (scope) args.push(scope);
        await execFileAsync(ompBin, args, {
          cwd: body.cwd,
          timeout: 60_000,
          env: { ...process.env },
        });
        break;
      }
      case "remove": {
        if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
        const args = ["plugin", "uninstall", source];
        if (scope) args.push(scope);
        await execFileAsync(ompBin, args, {
          cwd: body.cwd,
          timeout: 60_000,
          env: { ...process.env },
        });
        break;
      }
      case "enable": {
        if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
        await execFileAsync(ompBin, ["plugin", "enable", source], {
          cwd: body.cwd,
          timeout: 30_000,
          env: { ...process.env },
        });
        break;
      }
      case "disable": {
        if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
        await execFileAsync(ompBin, ["plugin", "disable", source], {
          cwd: body.cwd,
          timeout: 30_000,
          env: { ...process.env },
        });
        break;
      }
      case "update": {
        return NextResponse.json(
          {
            error: "feature_unavailable",
            message: "OMP plugin upgrade may require interactive prompts. " +
              "Use `omp plugin upgrade` from the terminal.",
          },
          { status: 501 },
        );
      }
      default: {
        return NextResponse.json(
          { error: `Unsupported action: ${body.action}` },
          { status: 400 },
        );
      }
    }

    return NextResponse.json(await readPlugins(body.cwd));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}