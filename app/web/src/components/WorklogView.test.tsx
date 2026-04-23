import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorklogView } from "./WorklogView";

describe("WorklogView", () => {
  it("applies the Safari-safe date input class to the range fields", async () => {
    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadReport={vi.fn().mockResolvedValue({ rows: [] })}
        onLoadUsers={vi.fn().mockResolvedValue([])}
      />
    );

    expect(screen.getByLabelText("From").getAttribute("class")).toContain("settings-time-input");
    expect(screen.getByLabelText("To").getAttribute("class")).toContain("settings-time-input");
  });

  it("renders results returned by the loader", async () => {
    const onLoadReport = vi.fn().mockResolvedValue({
      rows: [
        {
          issueKey: "PROJ-1",
          issueTitle: "Implement worklog",
          accountId: "abc",
          author: "Alice",
          startedAt: "2026-04-01T10:00:00.000Z",
          secondsSpent: 3600,
        },
      ],
    });
    const onLoadIssue = vi.fn().mockResolvedValue({
      key: "PROJ-1",
      title: "Implement worklog",
      issueType: "Task",
    });
    const onLoadIssues = vi.fn().mockResolvedValue([]);
    const onLoadUsers = vi.fn().mockResolvedValue([]);
    render(
      <WorklogView
        onLoadIssue={onLoadIssue}
        onLoadIssues={onLoadIssues}
        onLoadReport={onLoadReport}
        onLoadUsers={onLoadUsers}
      />
    );

    await waitFor(() => expect(onLoadUsers).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "View report" }));

    await waitFor(() => expect(onLoadReport).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText("PROJ-1")).length).toBeGreaterThan(0);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.queryByText("Jira Worklog Report")).toBeNull();
  });

  it("shows loader errors", async () => {
    const onLoadReport = vi.fn().mockRejectedValue(new Error("Boom"));
    const onLoadIssue = vi.fn().mockResolvedValue({
      key: "PROJ-1",
      title: "Implement worklog",
      issueType: "Task",
    });
    const onLoadIssues = vi.fn().mockResolvedValue([]);
    const onLoadUsers = vi.fn().mockResolvedValue([]);
    render(
      <WorklogView
        onLoadIssue={onLoadIssue}
        onLoadIssues={onLoadIssues}
        onLoadReport={onLoadReport}
        onLoadUsers={onLoadUsers}
      />
    );
    await waitFor(() => expect(onLoadUsers).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "View report" }));

    expect(await screen.findByText("Boom")).toBeTruthy();
  });
});
