import { beforeEach, describe, expect, it, vi } from "vitest";
import { getToken, setToken, getHistoryIssue, previewJiraIssues } from "./api";

function mockFetch(payload: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(JSON.stringify(payload)),
    })
  );
}

describe("getToken / setToken", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null when no token is stored", () => {
    expect(getToken()).toBeNull();
  });

  it("stores and retrieves a token", () => {
    setToken("abc123");
    expect(getToken()).toBe("abc123");
  });

  it("removes the token when null is passed", () => {
    setToken("abc123");
    setToken(null);
    expect(getToken()).toBeNull();
  });
});

describe("previewJiraIssues URL selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uses the sprint-scoped URL when sprintId is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ issues: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await previewJiraIssues("board-1", "sprint-42", {});

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/sprints/sprint-42/issues/preview");
  });

  it("uses the board-scoped URL when sprintId is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ issues: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await previewJiraIssues("board-1", "", {});

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/boards/board-1/issues/preview");
    expect(calledUrl).not.toContain("/sprints/");
  });

  it("uses the board-scoped URL when sprintId is undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ issues: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await previewJiraIssues("board-1", undefined, {});

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("/sprints/");
  });
});

describe("getHistoryIssue", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const baseIssue = {
    id: "issue-1",
    title: "AUTH-42 Harden login",
    durationSeconds: 120,
    avg: "5",
    median: "5",
    votes: 3,
    externalSource: "jira",
    externalIssueId: "10001",
    externalIssueKey: "AUTH-42",
    externalIssueUrl: "https://example.atlassian.net/browse/AUTH-42",
    jiraFieldsSnapshot: {},
    importedFromBoardId: "board-1",
    importedFromSprintId: "sprint-1",
    playback: {
      durationSeconds: 120,
      users: [
        { id: "user-1", display_name: "Alice", can_vote: true },
        { id: "user-2", display_name: "Bob", can_vote: true },
      ],
      events: [
        { type: "vote", userId: "user-1", atMs: 10000, payload: { value: "5" } },
        { type: "vote", userId: "user-2", atMs: 20000, payload: { value: "8" } },
        { type: "reveal", userId: "user-1", atMs: 90000 },
      ],
    },
  };

  it("maps basic fields correctly", async () => {
    mockFetch({ issue: baseIssue });
    const issue = await getHistoryIssue("room-1", "issue-1");

    expect(issue.id).toBe("issue-1");
    expect(issue.title).toBe("AUTH-42 Harden login");
    expect(issue.status).toBe("done");
    expect(issue.externalIssueKey).toBe("AUTH-42");
    expect(issue.importedFromBoardId).toBe("board-1");
    expect(issue.importedFromSprintId).toBe("sprint-1");
  });

  it("maps votes from playback events", async () => {
    mockFetch({ issue: baseIssue });
    const issue = await getHistoryIssue("room-1", "issue-1");

    expect(issue.votes["user-1"].value).toBe("5");
    expect(issue.votes["user-2"].value).toBe("8");
  });

  it("maps events with participant names from playback users", async () => {
    mockFetch({ issue: baseIssue });
    const issue = await getHistoryIssue("room-1", "issue-1");

    const voteEvent = issue.events.find((e) => e.type === "vote" && e.participantId === "user-1");
    expect(voteEvent?.participantName).toBe("Alice");
    expect(voteEvent?.value).toBe("5");
  });

  it("maps numeric stats correctly", async () => {
    mockFetch({ issue: baseIssue });
    const issue = await getHistoryIssue("room-1", "issue-1");

    expect(issue.stats.average).toBe(5);
    expect(issue.stats.median).toBe(5);
  });

  it("returns null stats when avg/median are '-'", async () => {
    mockFetch({ issue: { ...baseIssue, avg: "-", median: "-" } });
    const issue = await getHistoryIssue("room-1", "issue-1");

    expect(issue.stats.average).toBeNull();
    expect(issue.stats.median).toBeNull();
  });

  it("returns null stats when avg/median are null", async () => {
    mockFetch({ issue: { ...baseIssue, avg: null, median: null } });
    const issue = await getHistoryIssue("room-1", "issue-1");

    expect(issue.stats.average).toBeNull();
    expect(issue.stats.median).toBeNull();
  });

  it("derives revealedAt from the last reveal event", async () => {
    mockFetch({ issue: baseIssue });
    const issue = await getHistoryIssue("room-1", "issue-1");

    expect(new Date(issue.revealedAt).getTime()).toBe(90000);
  });

  it("falls back to durationSeconds for revealedAt when no reveal event exists", async () => {
    const issueWithoutReveal = {
      ...baseIssue,
      playback: {
        ...baseIssue.playback,
        events: [{ type: "vote", userId: "user-1", atMs: 10000, payload: { value: "5" } }],
      },
    };
    mockFetch({ issue: issueWithoutReveal });
    const issue = await getHistoryIssue("room-1", "issue-1");

    expect(new Date(issue.revealedAt).getTime()).toBe(120 * 1000);
  });

  it("handles missing playback gracefully", async () => {
    const issueWithoutPlayback = { ...baseIssue, playback: undefined };
    mockFetch({ issue: issueWithoutPlayback });
    const issue = await getHistoryIssue("room-1", "issue-1");

    expect(issue.votes).toEqual({});
    expect(issue.events).toHaveLength(0);
  });

  it("uses durationSeconds from issue root when playback duration is missing", async () => {
    const issueRootDuration = {
      ...baseIssue,
      durationSeconds: 60,
      playback: { users: [], events: [] },
    };
    mockFetch({ issue: issueRootDuration });
    const issue = await getHistoryIssue("room-1", "issue-1");

    expect(new Date(issue.endedAt).getTime()).toBe(60 * 1000);
  });
});
