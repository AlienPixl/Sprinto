import { execSync } from "node:child_process";

export function parseGitHubRepositoryFromRemote(remoteUrl) {
  const normalized = String(remoteUrl || "").trim();
  if (!normalized) return "";

  const httpsMatch = normalized.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return "";
}

export function resolveUpdateRepository({
  updateRepository = process.env.UPDATE_REPOSITORY,
  githubRepository = process.env.GITHUB_REPOSITORY,
  repoRoot,
  fallbackRepository = "AlienPixl/Sprinto",
} = {}) {
  const explicitRepository = String(updateRepository || githubRepository || "").trim();
  if (explicitRepository) {
    return explicitRepository;
  }

  if (repoRoot) {
    try {
      const remoteUrl = execSync("git config --get remote.origin.url", {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      });
      const derivedRepository = parseGitHubRepositoryFromRemote(remoteUrl);
      if (derivedRepository) {
        return derivedRepository;
      }
    } catch {
    }
  }

  return fallbackRepository;
}
