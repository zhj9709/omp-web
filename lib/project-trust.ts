/**
 * Project trust for OMP.
 *
 * OMP v17.3.5 does not have a project trust system equivalent to the pi SDK's
 * ProjectTrustStore. The OMP agent directory has no trust database, and the
 * `omp` CLI has no `trust` command. Project-local resources (extensions,
 * .agents/skills) are always loaded without a trust gate.
 *
 * All requests return a default "trusted" status. The GET/POST project-trust
 * routes report this state explicitly and disable the trust-POST operation.
 */
import type { ProjectTrustStatus } from "./api-types";

export function getProjectTrustStatus(_cwd: string, _agentDir: string): ProjectTrustStatus {
  return { requiresTrust: false, trusted: true };
}

export function trustProject(_cwd: string, _agentDir: string): ProjectTrustStatus {
  return { requiresTrust: false, trusted: true };
}

export function projectTrustReloadOptions(
  _cwd: string,
  _agentDir: string,
): undefined {
  // OMP loads all resources unconditionally; no trust gate needed.
  return undefined;
}