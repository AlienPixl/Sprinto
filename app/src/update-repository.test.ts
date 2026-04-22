import { describe, expect, it } from "vitest";
import { parseGitHubRepositoryFromRemote, resolveUpdateRepository } from "./update-repository.js";

describe("update repository resolution", () => {
  it("parses GitHub repositories from HTTPS remotes", () => {
    expect(parseGitHubRepositoryFromRemote("https://github.com/AlienPixl/Sprinto.git")).toBe("AlienPixl/Sprinto");
  });

  it("parses GitHub repositories from SSH remotes", () => {
    expect(parseGitHubRepositoryFromRemote("git@github.com:AlienPixl/Sprinto.git")).toBe("AlienPixl/Sprinto");
  });

  it("prefers UPDATE_REPOSITORY over all other sources", () => {
    expect(
      resolveUpdateRepository({
        updateRepository: "AlienPixl/PublicSprinto",
        githubRepository: "AlienPixl/WrongRepo",
        fallbackRepository: "AlienPixl/FallbackRepo",
      }),
    ).toBe("AlienPixl/PublicSprinto");
  });

  it("falls back to GITHUB_REPOSITORY when UPDATE_REPOSITORY is missing", () => {
    expect(
      resolveUpdateRepository({
        githubRepository: "AlienPixl/Sprinto",
        fallbackRepository: "AlienPixl/FallbackRepo",
      }),
    ).toBe("AlienPixl/Sprinto");
  });

  it("uses the public Sprinto repo as the default fallback", () => {
    expect(resolveUpdateRepository({
      updateRepository: "",
      githubRepository: "",
      fallbackRepository: "AlienPixl/Sprinto",
    })).toBe("AlienPixl/Sprinto");
  });
});
