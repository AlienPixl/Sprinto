import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomView } from "./RoomView";
import type { Issue, IssueQueueItem, RoomSnapshot } from "../lib/types";

// RoomView runs setInterval(() => setNow(Date.now()), 1000) for the clock.
// In jsdom this interval fires indefinitely and causes React state updates that
// prevent act() from ever settling. We fake only setInterval/clearInterval so
// React's own setTimeout(fn, 0) scheduler still works normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
});

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    title: "PROJ-1 Implement feature",
    status: "voting",
    startedAt: new Date().toISOString(),
    externalSource: "manual",
    externalIssueId: "",
    externalIssueKey: "",
    externalIssueUrl: "",
    jiraFieldsSnapshot: {},
    jiraDeliveryStatus: {
      estimate: { sentAt: null, sentByUserId: "", sentByDisplayName: "", mode: "", storyPointsValue: null, originalEstimate: "" },
      report: { sentAt: null, sentByUserId: "", sentByDisplayName: "", finalValue: "", commentPosted: false, pdfUploaded: false },
      assignee: { sentAt: null, sentByUserId: "", sentByDisplayName: "", accountId: "", displayName: "" },
    },
    importedFromBoardId: "",
    importedFromSprintId: "",
    votes: {},
    events: [],
    stats: { average: null, median: null },
    ...overrides,
  };
}

function makeQueueItem(overrides: Partial<IssueQueueItem> = {}): IssueQueueItem {
  return {
    id: "queued-1",
    title: "PROJ-2 Fix bug",
    source: "manual",
    externalSource: "manual",
    externalIssueId: "",
    externalIssueKey: "",
    externalIssueUrl: "",
    jiraFieldsSnapshot: {},
    jiraDeliveryStatus: {
      estimate: { sentAt: null, sentByUserId: "", sentByDisplayName: "", mode: "", storyPointsValue: null, originalEstimate: "" },
      report: { sentAt: null, sentByUserId: "", sentByDisplayName: "", finalValue: "", commentPosted: false, pdfUploaded: false },
      assignee: { sentAt: null, sentByUserId: "", sentByDisplayName: "", accountId: "", displayName: "" },
    },
    importedFromBoardId: "",
    importedFromSprintId: "",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<RoomSnapshot["room"]> = {}): RoomSnapshot {
  return {
    room: {
      id: "room-1",
      name: "Sprint 1",
      categoryId: null,
      deck: ["1", "2", "3", "5", "8", "13"],
      highlightMode: "none",
      queueSort: "issue",
      autoOpenJiraUrl: false,
      status: "voting",
      createdAt: new Date().toISOString(),
      participants: [
        { id: "user-1", firstName: "Alice", lastName: "A", email: "", voted: false, canVote: true },
      ],
      currentIssue: makeIssue(),
      issueHistory: [],
      issueQueue: [],
      revealed: false,
      completedCount: 0,
      ...overrides,
    },
    stats: { average: null, median: null },
  };
}

const noop = vi.fn().mockResolvedValue(undefined);

const defaultProps = {
  currentUserId: "user-1",
  canVote: true,
  canManageRound: true,
  canManageCardHighlight: false,
  canViewHistory: true,
  canViewVotesOfOthers: true,
  canDeleteRoom: false,
  canRenameRoom: false,
  canImportJiraIssues: false,
  canSendToJira: false,
  requireStoryId: false,
  onVote: vi.fn().mockResolvedValue(undefined),
  onReveal: noop,
  onCancelIssue: noop,
  onClose: noop,
  onDeleteRoom: noop,
  onQueueIssue: vi.fn().mockResolvedValue(undefined),
  onUpdateQueuedIssue: noop,
  onDeleteQueuedIssue: noop,
  onStartQueuedIssue: vi.fn().mockResolvedValue(undefined),
  onUpdateAutoOpenJiraUrl: noop,
  onUpdateHighlightMode: noop,
  onUpdateQueueSort: noop,
  onFetchJiraBoards: vi.fn().mockResolvedValue([]),
  onFetchJiraSprints: vi.fn().mockResolvedValue([]),
  onFetchJiraStatuses: vi.fn().mockResolvedValue([]),
  onFetchJiraLabels: vi.fn().mockResolvedValue([]),
  onPreviewJiraIssues: vi.fn().mockResolvedValue([]),
  onSearchJiraIssues: vi.fn().mockResolvedValue([]),
  onImportSearchedJiraIssues: vi.fn().mockResolvedValue({ addedCount: 0, skippedCount: 0, addedIssueKeys: [], skippedIssueKeys: [] }),
  onImportJiraIssues: vi.fn().mockResolvedValue({ added: 0, updated: 0, removed: 0 }),
  onApplyJiraIssueEstimate: vi.fn().mockResolvedValue({ updatedFields: [] }),
  onFetchJiraAssignableUsers: vi.fn().mockResolvedValue([]),
  onAssignJiraIssueAssignee: vi.fn().mockResolvedValue({ accountId: "" }),
  onPostJiraIssueReport: vi.fn().mockResolvedValue({ commentPosted: false, pdfUploaded: false }),
  onRenameRoom: noop,
};

function renderRoom(snapshotOverrides: Partial<RoomSnapshot["room"]> = {}, propOverrides: Record<string, unknown> = {}) {
  const snapshot = makeSnapshot(snapshotOverrides);
  render(<RoomView snapshot={snapshot} {...defaultProps} {...propOverrides} />);
  return { snapshot };
}

describe("RoomView — room header", () => {
  it("displays the room name", () => {
    renderRoom({ name: "Sprint 42" });
    expect(screen.getAllByText("Sprint 42").length).toBeGreaterThan(0);
  });

  it("shows the rename button when canRenameRoom is true", () => {
    renderRoom({}, { canRenameRoom: true });
    expect(screen.getAllByRole("button", { name: /rename room/i }).length).toBeGreaterThan(0);
  });

  it("hides the rename button when canRenameRoom is false", () => {
    renderRoom({}, { canRenameRoom: false });
    expect(screen.queryAllByRole("button", { name: /rename room/i })).toHaveLength(0);
  });
});

describe("RoomView — active issue", () => {
  it("displays the active issue title", () => {
    renderRoom({ currentIssue: makeIssue({ title: "AUTH-10 Login refactor" }) });
    expect(screen.getAllByText("AUTH-10 Login refactor").length).toBeGreaterThan(0);
  });

  it("renders deck cards when canVote is true", () => {
    renderRoom({}, { canVote: true });
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("13")).toBeTruthy();
  });

  it("does not render deck cards when canVote is false", () => {
    renderRoom({}, { canVote: false });
    expect(screen.queryAllByText("13")).toHaveLength(0);
  });

  it("calls onVote with the selected value when a card is clicked", async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    renderRoom({}, { onVote, canVote: true });
    await act(async () => {
      fireEvent.click(screen.getByText("5"));
    });
    expect(onVote).toHaveBeenCalledWith("user-1", "5");
  });

  it("shows reveal button for a manager during voting", () => {
    renderRoom({ status: "voting", revealed: false }, { canManageRound: true });
    const buttons = screen.getAllByRole("button");
    expect(buttons.some((b) => b.textContent?.toLowerCase().includes("reveal"))).toBe(true);
  });

  it("hides reveal button for non-managers", () => {
    renderRoom({ status: "voting", revealed: false }, { canManageRound: false });
    const buttons = screen.getAllByRole("button");
    expect(buttons.some((b) => b.textContent?.toLowerCase().includes("reveal"))).toBe(false);
  });
});

describe("RoomView — cancel issue", () => {
  it("shows 'Return to queue' button for managers during active voting", () => {
    renderRoom({ status: "voting" }, { canManageRound: true });
    const buttons = screen.getAllByRole("button");
    expect(buttons.some((b) => b.textContent?.toLowerCase().includes("return to queue"))).toBe(true);
  });

  it("hides 'Return to queue' button for non-managers", () => {
    renderRoom({ status: "voting" }, { canManageRound: false });
    const buttons = screen.queryAllByRole("button");
    expect(buttons.some((b) => b.textContent?.toLowerCase().includes("return to queue"))).toBe(false);
  });
});

describe("RoomView — queue", () => {
  it("renders queued issue titles", () => {
    renderRoom({ issueQueue: [makeQueueItem({ title: "PROJ-5 Fix pagination" })] });
    // formatQueuePrimaryLine rewrites "PROJ-5 Fix pagination" → "PROJ-5 - Fix pagination"
    expect(screen.getAllByText(/PROJ-5.*Fix pagination/).length).toBeGreaterThan(0);
  });

  it("shows queue filter controls when there is a queue", () => {
    renderRoom({ issueQueue: [makeQueueItem()] });
    expect(screen.getByRole("combobox", { name: /filter queue/i })).toBeTruthy();
  });

  it("offers manual add to managers", () => {
    renderRoom({}, { canManageRound: true });
    expect(screen.getAllByRole("button", { name: /add manually/i }).length).toBeGreaterThan(0);
  });

  it("hides manual add from non-managers", () => {
    renderRoom({}, { canManageRound: false });
    expect(screen.queryAllByRole("button", { name: /add manually/i })).toHaveLength(0);
  });

  it("shows the issue fields in the manual add panel when requireStoryId is true", async () => {
    renderRoom({}, { requireStoryId: true, canManageRound: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    });
    expect(screen.getByRole("textbox", { name: /^story id$/i })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /^issue title$/i })).toBeTruthy();
  });

  it("always offers the story ID field regardless of requireStoryId", async () => {
    renderRoom({}, { requireStoryId: false, canManageRound: true });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    });
    expect(screen.getByRole("textbox", { name: /^story id$/i })).toBeTruthy();
  });
});

describe("RoomView — participants", () => {
  it("renders participant names", () => {
    renderRoom({
      participants: [
        { id: "user-1", firstName: "Alice", lastName: "A", email: "", voted: false, canVote: true },
        { id: "user-2", firstName: "Bob", lastName: "B", email: "", voted: false, canVote: true },
      ],
    });
    expect(screen.getByText(/Alice/)).toBeTruthy();
    expect(screen.getByText(/Bob/)).toBeTruthy();
  });
});

describe("RoomView — revealed state", () => {
  it("displays vote values after reveal", () => {
    renderRoom({
      status: "revealed",
      revealed: true,
      currentIssue: makeIssue({
        status: "revealed",
        votes: {
          "user-1": { userId: "user-1", value: "8", votedAt: new Date().toISOString() },
        },
      }),
    });
    expect(screen.getAllByText("8").length).toBeGreaterThan(0);
  });
});

describe("RoomView — queue sort", () => {
  it("renders the sort queue dropdown", () => {
    renderRoom();
    expect(screen.getByRole("combobox", { name: /sort queue/i })).toBeTruthy();
  });

  it("reflects the current queueSort value in the dropdown", () => {
    renderRoom({ queueSort: "priority" });
    const select = screen.getByRole("combobox", { name: /sort queue/i }) as HTMLSelectElement;
    expect(select.value).toBe("priority");
  });

  it("calls onUpdateQueueSort when the dropdown changes", async () => {
    const onUpdateQueueSort = vi.fn().mockResolvedValue(undefined);
    renderRoom({}, { onUpdateQueueSort });
    const select = screen.getByRole("combobox", { name: /sort queue/i });
    await act(async () => {
      fireEvent.change(select, { target: { value: "reporter" } });
    });
    expect(onUpdateQueueSort).toHaveBeenCalledWith("reporter");
  });

  it("calls onUpdateQueueSort with 'priority' when priority is selected", async () => {
    const onUpdateQueueSort = vi.fn().mockResolvedValue(undefined);
    renderRoom({ queueSort: "issue" }, { onUpdateQueueSort });
    const select = screen.getByRole("combobox", { name: /sort queue/i });
    await act(async () => {
      fireEvent.change(select, { target: { value: "priority" } });
    });
    expect(onUpdateQueueSort).toHaveBeenCalledWith("priority");
  });
});

describe("RoomView — closed room", () => {
  it("does not show the issue title when room is closed", () => {
    renderRoom({
      status: "closed",
      currentIssue: makeIssue({ title: "AUTH-99 Very Specific Closed Issue" }),
    });
    expect(screen.queryByText("AUTH-99 Very Specific Closed Issue")).toBeNull();
  });

  it("hides the add-issue form when room is closed", () => {
    renderRoom({ status: "closed" }, { canManageRound: true });
    expect(screen.queryByRole("button", { name: /add issue manually/i })).toBeNull();
  });

  it("hides the close poker button when room is already closed", () => {
    renderRoom({ status: "closed" }, { canManageRound: true });
    const buttons = screen.getAllByRole("button");
    expect(buttons.some((b) => b.textContent?.toLowerCase().includes("close poker"))).toBe(false);
  });
});

describe("RoomView — history access", () => {
  it("shows history button when canViewHistory is true", () => {
    renderRoom({}, { canViewHistory: true, canManageRound: false });
    const buttons = screen.getAllByRole("button");
    expect(buttons.some((b) => b.textContent?.toLowerCase().includes("history"))).toBe(true);
  });

  it("hides history button when both canViewHistory and canManageRound are false", () => {
    renderRoom({}, { canViewHistory: false, canManageRound: false });
    const buttons = screen.queryAllByRole("button");
    expect(buttons.some((b) => b.textContent?.toLowerCase().includes("history"))).toBe(false);
  });
});

describe("RoomView — delete room", () => {
  it("shows delete button when canDeleteRoom is true", () => {
    renderRoom({}, { canDeleteRoom: true });
    const buttons = screen.getAllByRole("button");
    const hasDelete = buttons.some(
      (b) =>
        b.textContent?.toLowerCase().includes("delete") ||
        b.getAttribute("aria-label")?.toLowerCase().includes("delete")
    );
    expect(hasDelete).toBe(true);
  });

  it("hides delete button when canDeleteRoom is false", () => {
    renderRoom({}, { canDeleteRoom: false });
    const buttons = screen.queryAllByRole("button");
    const hasDelete = buttons.some(
      (b) =>
        b.textContent?.toLowerCase().includes("delete") ||
        b.getAttribute("aria-label")?.toLowerCase().includes("delete")
    );
    expect(hasDelete).toBe(false);
  });
});

function makeSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    id: "700",
    key: "PROJ-7",
    title: "Login redirect loops",
    issueUrl: "https://example.atlassian.net/browse/PROJ-7",
    reporter: "Alice",
    priority: { id: "2", name: "High" },
    storyPoints: null,
    originalEstimateSeconds: null,
    status: "In Progress",
    issueType: "Bug",
    jiraFieldsSnapshot: {},
    ...overrides,
  };
}

async function openJiraSearchPanel(propOverrides: Record<string, unknown> = {}) {
  renderRoom({}, { canImportJiraIssues: true, canManageRound: true, ...propOverrides });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /find in jira/i }));
  });
}

describe("RoomView — Jira issue search", () => {
  it("hides the search button without the Jira import permission", () => {
    renderRoom({}, { canImportJiraIssues: false, canManageRound: true });
    expect(screen.queryAllByRole("button", { name: /find in jira/i })).toHaveLength(0);
  });

  it("shows the search button with the Jira import permission", () => {
    renderRoom({}, { canImportJiraIssues: true, canManageRound: true });
    expect(screen.getAllByRole("button", { name: /find in jira/i }).length).toBeGreaterThan(0);
  });

  it("does not search while typing", async () => {
    const onSearchJiraIssues = vi.fn().mockResolvedValue([]);
    await openJiraSearchPanel({ onSearchJiraIssues });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search jira issues/i), { target: { value: "PROJ-7" } });
    });
    expect(onSearchJiraIssues).not.toHaveBeenCalled();
  });

  it("searches when the search button is pressed", async () => {
    const onSearchJiraIssues = vi.fn().mockResolvedValue([makeSearchResult()]);
    await openJiraSearchPanel({ onSearchJiraIssues });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search jira issues/i), { target: { value: "login" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    });
    expect(onSearchJiraIssues).toHaveBeenCalledWith("login");
    expect(screen.getAllByText(/Login redirect loops/).length).toBeGreaterThan(0);
  });

  it("imports only the selected issues", async () => {
    const onSearchJiraIssues = vi.fn().mockResolvedValue([
      makeSearchResult(),
      makeSearchResult({ id: "800", key: "PROJ-8", title: "Refactor deck editor" }),
    ]);
    const onImportSearchedJiraIssues = vi.fn().mockResolvedValue({
      addedCount: 1,
      skippedCount: 0,
      addedIssueKeys: ["PROJ-8"],
      skippedIssueKeys: [],
    });
    await openJiraSearchPanel({ onSearchJiraIssues, onImportSearchedJiraIssues });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search jira issues/i), { target: { value: "proj" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/select PROJ-8/i));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add 1 to queue/i }));
    });
    expect(onImportSearchedJiraIssues).toHaveBeenCalledWith(["PROJ-8"]);
  });

  it("marks an issue already in the queue as not selectable", async () => {
    const onSearchJiraIssues = vi.fn().mockResolvedValue([makeSearchResult()]);
    renderRoom(
      { issueQueue: [makeQueueItem({ id: "queued-7", externalIssueId: "700", externalIssueKey: "PROJ-7", title: "PROJ-7 Login redirect loops" })] },
      { canImportJiraIssues: true, canManageRound: true, onSearchJiraIssues }
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /find in jira/i }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search jira issues/i), { target: { value: "login" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    });
    expect((screen.getByLabelText(/select PROJ-7/i) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText(/in queue/i).length).toBeGreaterThan(0);
  });


  it("closes the search panel and returns to the queue after a successful import", async () => {
    const onSearchJiraIssues = vi.fn().mockResolvedValue([
      makeSearchResult(),
      makeSearchResult({ id: "800", key: "PROJ-8", title: "Refactor deck editor" }),
    ]);
    const onImportSearchedJiraIssues = vi.fn().mockResolvedValue({
      addedCount: 2,
      skippedCount: 0,
      addedIssueKeys: ["PROJ-7", "PROJ-8"],
      skippedIssueKeys: [],
    });
    await openJiraSearchPanel({ onSearchJiraIssues, onImportSearchedJiraIssues });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search jira issues/i), { target: { value: "proj" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/select PROJ-7/i));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/select PROJ-8/i));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add 2 to queue/i }));
    });

    expect(screen.queryAllByLabelText(/search jira issues/i)).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /find in jira/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 added to the queue/i).length).toBeGreaterThan(0);
  });

  it("keeps the search panel open when the import fails", async () => {
    const onSearchJiraIssues = vi.fn().mockResolvedValue([makeSearchResult()]);
    const onImportSearchedJiraIssues = vi.fn().mockRejectedValue(new Error("Jira rejected the import"));
    await openJiraSearchPanel({ onSearchJiraIssues, onImportSearchedJiraIssues });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search jira issues/i), { target: { value: "login" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/select PROJ-7/i));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add 1 to queue/i }));
    });

    expect(screen.getAllByLabelText(/search jira issues/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Jira rejected the import/).length).toBeGreaterThan(0);
  });

  it("shows a message when the search finds nothing", async () => {
    const onSearchJiraIssues = vi.fn().mockResolvedValue([]);
    await openJiraSearchPanel({ onSearchJiraIssues });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search jira issues/i), { target: { value: "nothing" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    });
    expect(screen.getAllByText(/no matching jira issues/i).length).toBeGreaterThan(0);
  });

  it("shows the failure separately from an empty result", async () => {
    const onSearchJiraIssues = vi.fn().mockRejectedValue(new Error("Jira is unreachable"));
    await openJiraSearchPanel({ onSearchJiraIssues });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/search jira issues/i), { target: { value: "boom" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    });
    expect(screen.getAllByText(/Jira is unreachable/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/no matching jira issues/i)).toHaveLength(0);
  });
});

describe("RoomView — Jira writeback for a hand-picked issue", () => {
  const jiraIntegration = { enabled: true, writeStoryPointsEnabled: true } as unknown as Record<string, unknown>;

  // A searched issue lands in the queue with no board/sprint scope. Voting on it must still end in
  // "Send to Jira" — the button keys off externalSource + externalIssueKey, never off import scope.
  it("enables Send to Jira for a revealed issue that has no import scope", () => {
    renderRoom(
      {
        status: "revealed",
        revealed: true,
        currentIssue: makeIssue({
          title: "PROJ-7 - Login redirect loops",
          status: "revealed",
          externalSource: "jira",
          externalIssueId: "700",
          externalIssueKey: "PROJ-7",
          externalIssueUrl: "https://example.atlassian.net/browse/PROJ-7",
          importedFromBoardId: "",
          importedFromSprintId: "",
        }),
      },
      { canSendToJira: true, canManageRound: true, jiraIntegration }
    );

    const sendButton = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.toLowerCase().includes("send to jira")) as HTMLButtonElement;
    expect(sendButton).toBeTruthy();
    expect(sendButton.disabled).toBe(false);
  });
});

async function openManualAddPanel(propOverrides: Record<string, unknown> = {}) {
  renderRoom({}, { canManageRound: true, ...propOverrides });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
  });
}

describe("RoomView — manual add panel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps the issue fields out of the queue toolbar until the panel is opened", () => {
    renderRoom({}, { canManageRound: true });
    expect(screen.queryAllByLabelText(/^story id$/i)).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /add manually/i }).length).toBeGreaterThan(0);
  });

  it("adds an issue with its story ID", async () => {
    const onQueueIssue = vi.fn().mockResolvedValue(undefined);
    await openManualAddPanel({ onQueueIssue });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^story id$/i), { target: { value: "PROJ-12" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^issue title$/i), { target: { value: "Fix pagination" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add to queue$/i }));
    });
    expect(onQueueIssue).toHaveBeenCalledWith("Fix pagination", "PROJ-12");
  });

  it("stays open with cleared fields after adding by default", async () => {
    const onQueueIssue = vi.fn().mockResolvedValue(undefined);
    await openManualAddPanel({ onQueueIssue });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^issue title$/i), { target: { value: "Fix pagination" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add to queue$/i }));
    });
    const titleField = screen.getByLabelText(/^issue title$/i) as HTMLInputElement;
    expect(titleField.value).toBe("");
  });

  it("closes the panel after adding when the close option is ticked", async () => {
    const onQueueIssue = vi.fn().mockResolvedValue(undefined);
    await openManualAddPanel({ onQueueIssue });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/close after adding/i));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^issue title$/i), { target: { value: "Fix pagination" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add to queue$/i }));
    });
    expect(screen.queryAllByLabelText(/^issue title$/i)).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /add manually/i }).length).toBeGreaterThan(0);
  });

  it("remembers the close-after-adding choice across reopens", async () => {
    await openManualAddPanel();
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/close after adding/i));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    });
    expect((screen.getByLabelText(/close after adding/i) as HTMLInputElement).checked).toBe(true);
  });

  it("refuses to add an issue without a title", async () => {
    const onQueueIssue = vi.fn().mockResolvedValue(undefined);
    await openManualAddPanel({ onQueueIssue });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add to queue$/i }));
    });
    expect(onQueueIssue).not.toHaveBeenCalled();
    expect(screen.getAllByText(/title is required/i).length).toBeGreaterThan(0);
  });

  it("refuses to add an issue without a story ID when the setting requires one", async () => {
    const onQueueIssue = vi.fn().mockResolvedValue(undefined);
    await openManualAddPanel({ onQueueIssue, requireStoryId: true });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^issue title$/i), { target: { value: "Fix pagination" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add to queue$/i }));
    });
    expect(onQueueIssue).not.toHaveBeenCalled();
    expect(screen.getAllByText(/story id is required/i).length).toBeGreaterThan(0);
  });
});
