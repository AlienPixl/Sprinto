import { describe, expect, it } from "vitest";
import {
  buildPublicChangelogIndex,
  collectPublicReleaseFiles,
  collectPublicChangelogFiles,
  compareSemanticReleaseTags,
  normalizeReleaseTag,
  parsePublicReleaseManifest,
  validateReleaseNotesContent,
  validateReleaseVersion,
} from "./public-release.js";

describe("public release manifest", () => {
  it("parses the supported scalar and list keys", () => {
    const manifest = parsePublicReleaseManifest(`
publicRepository: AlienPixl/Sprinto
publicBranch: main
releaseSourceBranch: main
versionFile: app/package.json
lockVersionFile: app/package-lock.json
changelogDir: changelog
publicChangelogFromTag: v1.0.0
include:
  - README.md
  - app
exclude:
  - .ai-context
  - wiki
`);

    expect(manifest).toEqual({
      publicRepository: "AlienPixl/Sprinto",
      publicBranch: "main",
      releaseSourceBranch: "main",
      versionFile: "app/package.json",
      lockVersionFile: "app/package-lock.json",
      changelogDir: "changelog",
      publicChangelogFromTag: "v1.0.0",
      include: ["README.md", "app"],
      exclude: [".ai-context", "wiki"],
    });
  });

  it("keeps only allowlisted tracked files and removes denied paths", () => {
    const files = collectPublicReleaseFiles(
      [
        "LICENSE",
        "NOTICE",
        "README.md",
        "TRADEMARKS.md",
        "app/package.json",
        "app/src/server.js",
        ".ai-context/current_state.md",
        "wiki/Home.md",
      ],
      {
        include: ["LICENSE", "NOTICE", "README.md", "TRADEMARKS.md", "app", ".ai-context"],
        exclude: [".ai-context", "wiki"],
      },
    );

    expect(files).toEqual([
      "LICENSE",
      "NOTICE",
      "README.md",
      "TRADEMARKS.md",
      "app/package.json",
      "app/src/server.js",
    ]);
  });

  it("keeps only public changelog files from the configured floor tag onward", () => {
    const files = collectPublicChangelogFiles(
      [
        "changelog/v0.0.49.md",
        "changelog/v1.0.0.md",
        "changelog/v1.0.1.md",
        "README.md",
      ],
      {
        changelogDir: "changelog",
        publicChangelogFromTag: "v1.0.0",
      },
    );

    expect(files).toEqual([
      "changelog/v1.0.1.md",
      "changelog/v1.0.0.md",
    ]);
  });

  it("builds a filtered public changelog index", () => {
    expect(buildPublicChangelogIndex([
      "changelog/v1.0.1.md",
      "changelog/v1.0.0.md",
    ])).toContain("- [v1.0.1](changelog/v1.0.1.md)\n- [v1.0.0](changelog/v1.0.0.md)");
  });
});

describe("public release validation", () => {
  it("compares semantic release tags", () => {
    expect(compareSemanticReleaseTags("v1.0.1", "v1.0.0")).toBe(1);
    expect(compareSemanticReleaseTags("v1.0.0", "v1.0.1")).toBe(-1);
    expect(compareSemanticReleaseTags("v1.0.0", "v1.0.0")).toBe(0);
  });

  it("accepts valid version alignment", () => {
    expect(() => validateReleaseVersion({
      tag: "v1.0.0",
      packageVersion: "1.0.0",
      lockfileVersion: "1.0.0",
    })).not.toThrow();
  });

  it("rejects tags without the v prefix", () => {
    expect(() => normalizeReleaseTag("1.0.0")).toThrow('Release tag must start with "v"');
  });

  it("rejects non-semantic changelog floor tags", () => {
    expect(() => compareSemanticReleaseTags("v1", "v1.0.0")).toThrow("semantic version format");
  });

  it("rejects a tag that does not match the package version", () => {
    expect(() => validateReleaseVersion({
      tag: "v1.0.0",
      packageVersion: "0.9.0",
      lockfileVersion: "1.0.0",
    })).toThrow("does not match app/package.json version");
  });

  it("rejects release notes that start with a top-level title", () => {
    expect(() => validateReleaseNotesContent("# Sprinto v1.0.0\n\n## Highlights", "v1.0.0")).toThrow("must not start with a top-level title");
  });

  it("accepts release notes that start directly with section content", () => {
    expect(() => validateReleaseNotesContent("## Highlights\n\n- Ready.", "v1.0.0")).not.toThrow();
  });
});
