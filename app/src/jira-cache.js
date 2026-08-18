// Short-lived cache for Jira *metadata* only — boards, sprints, statuses, labels and
// issue link types. These lists change rarely, but every picker in the UI needs them,
// so without a cache a handful of users opening the import dialog is enough to hit the
// Jira API rate limit.
//
// Issue data is deliberately never cached. Priorities, statuses, assignees and estimates
// change while a room is in session, so previews, imports and worklog reports always go
// straight to Jira and show the live state.

const entries = new Map(); // key -> { value, expiresAt }
const inflight = new Map(); // key -> Promise

// Sweep expired entries so a long-running instance does not grow unbounded.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(key);
    }
  }
}, 60_000);
sweepTimer.unref?.();

export function buildJiraCacheKey(settings, ...parts) {
  const jira = settings?.integrations?.jira || settings?.jira || settings || {};
  const site = String(jira.baseUrl || "").trim().replace(/\/+$/, "").toLowerCase();
  const account = String(jira.serviceAccountEmail || "").trim().toLowerCase();
  return [site, account, ...parts.map((part) => String(part ?? ""))].join("|");
}

/**
 * Returns the cached value for `key`, or runs `loader` and caches its result.
 * Concurrent callers for the same key share a single in-flight request, so ten
 * users opening the same picker at once produce one call to Jira.
 * Failures are never cached.
 */
export async function withJiraCache(key, ttlMs, loader) {
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  const promise = (async () => loader())();
  inflight.set(key, promise);

  try {
    const value = await promise;
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  } finally {
    inflight.delete(key);
  }
}

/** Drops cached metadata. Without a prefix the whole cache is cleared. */
export function clearJiraCache(prefix = "") {
  if (!prefix) {
    entries.clear();
    return;
  }
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) {
      entries.delete(key);
    }
  }
}

export function getJiraCacheSize() {
  return entries.size;
}
