import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildJiraCacheKey, clearJiraCache, withJiraCache } from "./jira-cache.js";

describe("jira metadata cache", () => {
  beforeEach(() => {
    clearJiraCache();
    vi.useRealTimers();
  });

  it("serves the second call from the cache", async () => {
    const loader = vi.fn().mockResolvedValue(["board-1"]);

    expect(await withJiraCache("boards", 60_000, loader)).toEqual(["board-1"]);
    expect(await withJiraCache("boards", 60_000, loader)).toEqual(["board-1"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight request between concurrent callers", async () => {
    let resolveLoader: (value: string[]) => void = () => {};
    const loader = vi.fn(() => new Promise<string[]>((resolve) => {
      resolveLoader = resolve;
    }));

    const first = withJiraCache("sprints", 60_000, loader);
    const second = withJiraCache("sprints", 60_000, loader);
    resolveLoader(["sprint-1"]);

    expect(await first).toEqual(["sprint-1"]);
    expect(await second).toEqual(["sprint-1"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("refetches once the entry expires", async () => {
    const loader = vi.fn().mockResolvedValueOnce(["old"]).mockResolvedValueOnce(["new"]);
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValue(0);
    expect(await withJiraCache("labels", 1_000, loader)).toEqual(["old"]);

    nowSpy.mockReturnValue(1_500);
    expect(await withJiraCache("labels", 1_000, loader)).toEqual(["new"]);
    expect(loader).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it("never caches a failed load", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("Jira is down"))
      .mockResolvedValueOnce(["status-1"]);

    await expect(withJiraCache("statuses", 60_000, loader)).rejects.toThrow("Jira is down");
    expect(await withJiraCache("statuses", 60_000, loader)).toEqual(["status-1"]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("clears only the entries matching a prefix", async () => {
    const boards = vi.fn().mockResolvedValue(["board"]);
    const labels = vi.fn().mockResolvedValue(["label"]);

    await withJiraCache("site|boards", 60_000, boards);
    await withJiraCache("site|labels", 60_000, labels);

    clearJiraCache("site|boards");

    await withJiraCache("site|boards", 60_000, boards);
    await withJiraCache("site|labels", 60_000, labels);

    expect(boards).toHaveBeenCalledTimes(2);
    expect(labels).toHaveBeenCalledTimes(1);
  });

  it("keys metadata per Jira site and service account", () => {
    const first = buildJiraCacheKey({ baseUrl: "https://one.atlassian.net/", serviceAccountEmail: "Bot@example.com" }, "boards");
    const second = buildJiraCacheKey({ baseUrl: "https://one.atlassian.net", serviceAccountEmail: "bot@example.com" }, "boards");
    const other = buildJiraCacheKey({ baseUrl: "https://two.atlassian.net", serviceAccountEmail: "bot@example.com" }, "boards");

    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });
});
