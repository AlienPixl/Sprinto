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
  onPreviewJiraIssues: vi.fn().mockResolvedValue([]),
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

  it("shows add-issue form for managers", () => {
    renderRoom({}, { canManageRound: true });
    expect(screen.getByRole("textbox", { name: /add issue manually/i })).toBeTruthy();
  });

  it("shows story ID input when requireStoryId is true", () => {
    renderRoom({}, { requireStoryId: true, canManageRound: true });
    expect(screen.getByRole("textbox", { name: /story id/i })).toBeTruthy();
  });

  it("always shows story ID input regardless of requireStoryId", () => {
    renderRoom({}, { requireStoryId: false, canManageRound: true });
    expect(screen.getByRole("textbox", { name: /story id/i })).toBeTruthy();
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
