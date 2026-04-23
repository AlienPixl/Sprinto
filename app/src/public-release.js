function parseScalar(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parsePublicReleaseManifest(rawManifest) {
  const manifest = {
    publicRepository: "",
    publicBranch: "",
    releaseSourceBranch: "",
    versionFile: "",
    lockVersionFile: "",
    changelogDir: "",
    publicChangelogFromTag: "",
    include: [],
    exclude: [],
  };

  let activeListKey = "";
  for (const rawLine of String(rawManifest || "").split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    const line = withoutComment.trimEnd();
    if (!line.trim()) continue;

    if (/^\S[^:]*:\s*$/.test(line)) {
      const key = line.slice(0, line.indexOf(":")).trim();
      if (key === "include" || key === "exclude") {
        activeListKey = key;
        continue;
      }
      throw new Error(`Unsupported manifest section "${key}".`);
    }

    const itemMatch = line.match(/^\s*-\s+(.+)$/);
    if (itemMatch) {
      if (!activeListKey) {
        throw new Error("Manifest list item is outside of include/exclude.");
      }
      manifest[activeListKey].push(parseScalar(itemMatch[1]));
      continue;
    }

    const scalarMatch = line.match(/^([^:]+):\s+(.+)$/);
    if (scalarMatch) {
      const key = scalarMatch[1].trim();
      if (!(key in manifest) || key === "include" || key === "exclude") {
        throw new Error(`Unsupported manifest key "${key}".`);
      }
      manifest[key] = parseScalar(scalarMatch[2]);
      activeListKey = "";
      continue;
    }

    throw new Error(`Cannot parse manifest line: ${rawLine}`);
  }

  if (!manifest.publicRepository) {
    throw new Error("Manifest must define publicRepository.");
  }
  if (!manifest.publicBranch) {
    throw new Error("Manifest must define publicBranch.");
  }
  if (!manifest.releaseSourceBranch) {
    throw new Error("Manifest must define releaseSourceBranch.");
  }
  if (!manifest.versionFile) {
    throw new Error("Manifest must define versionFile.");
  }
  if (!manifest.lockVersionFile) {
    throw new Error("Manifest must define lockVersionFile.");
  }
  if (!manifest.changelogDir) {
    throw new Error("Manifest must define changelogDir.");
  }

  return manifest;
}

function normalizePathSpec(pathSpec) {
  return String(pathSpec || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function matchesPathSpec(filePath, pathSpec) {
  const normalizedFilePath = normalizePathSpec(filePath);
  const normalizedSpec = normalizePathSpec(pathSpec);
  if (!normalizedSpec) return false;
  return normalizedFilePath === normalizedSpec || normalizedFilePath.startsWith(`${normalizedSpec}/`);
}

export function collectPublicReleaseFiles(trackedFiles, manifest) {
  const include = manifest.include.map(normalizePathSpec).filter(Boolean);
  const exclude = manifest.exclude.map(normalizePathSpec).filter(Boolean);

  return trackedFiles
    .map((file) => normalizePathSpec(file))
    .filter(Boolean)
    .filter((file) => include.some((pathSpec) => matchesPathSpec(file, pathSpec)))
    .filter((file) => !exclude.some((pathSpec) => matchesPathSpec(file, pathSpec)))
    .sort();
}

function parseSemanticReleaseTag(tag) {
  const normalized = normalizeReleaseTag(tag);
  const match = normalized.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Release tag must use semantic version format vX.Y.Z, received "${normalized}".`);
  }

  return match.slice(1).map((part) => Number(part));
}

export function compareSemanticReleaseTags(leftTag, rightTag) {
  const left = parseSemanticReleaseTag(leftTag);
  const right = parseSemanticReleaseTag(rightTag);

  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }

  return 0;
}

export function collectPublicChangelogFiles(trackedFiles, manifest) {
  const normalizedChangelogDir = normalizePathSpec(manifest.changelogDir);
  const minimumTag = String(manifest.publicChangelogFromTag || "").trim();

  return trackedFiles
    .map((file) => normalizePathSpec(file))
    .filter((file) => file.startsWith(`${normalizedChangelogDir}/`) && file.endsWith(".md"))
    .filter((file) => {
      if (!minimumTag) return true;
      const tag = `v${pathBasename(file).replace(/\.md$/i, "").replace(/^v/i, "")}`;
      return compareSemanticReleaseTags(tag, minimumTag) >= 0;
    })
    .sort((left, right) => {
      const leftTag = `v${pathBasename(left).replace(/\.md$/i, "").replace(/^v/i, "")}`;
      const rightTag = `v${pathBasename(right).replace(/\.md$/i, "").replace(/^v/i, "")}`;
      return compareSemanticReleaseTags(rightTag, leftTag);
    });
}

export function buildPublicChangelogIndex(changelogFiles) {
  const lines = [
    "# Changelog",
    "",
    "Public release notes for Sprinto.",
    "",
    "## Releases",
    "",
  ];

  for (const relativePath of changelogFiles) {
    const tag = pathBasename(relativePath).replace(/\.md$/i, "");
    lines.push(`- [${tag}](${relativePath})`);
  }

  return `${lines.join("\n")}\n`;
}

export function mapPublicReleaseOutputPath(relativePath) {
  const normalizedPath = normalizePathSpec(relativePath);
  if (normalizedPath === "docker-compose.yml") {
    return "docker-compose.example.yml";
  }
  return normalizedPath;
}

function pathBasename(relativePath) {
  return String(relativePath || "").split("/").pop() || "";
}

export function normalizeReleaseTag(tag) {
  const normalized = String(tag || "").trim();
  if (!/^v.+/.test(normalized)) {
    throw new Error(`Release tag must start with "v", received "${normalized || "(empty)"}".`);
  }
  return normalized;
}

export function validateReleaseVersion({ tag, packageVersion, lockfileVersion }) {
  const normalizedTag = normalizeReleaseTag(tag).slice(1);
  const normalizedPackageVersion = String(packageVersion || "").trim();
  const normalizedLockfileVersion = String(lockfileVersion || "").trim();

  if (normalizedPackageVersion !== normalizedTag) {
    throw new Error(`Release tag ${tag} does not match app/package.json version ${normalizedPackageVersion || "(empty)"}.`);
  }
  if (normalizedLockfileVersion !== normalizedTag) {
    throw new Error(`Release tag ${tag} does not match app/package-lock.json version ${normalizedLockfileVersion || "(empty)"}.`);
  }
}

export function validateReleaseNotesContent(content, tag) {
  const firstMeaningfulLine = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstMeaningfulLine) {
    throw new Error(`Release notes for ${tag} are empty.`);
  }

  if (firstMeaningfulLine.startsWith("# ")) {
    throw new Error(`Release notes for ${tag} must not start with a top-level title. Start directly with section content such as "## Highlights".`);
  }
}
