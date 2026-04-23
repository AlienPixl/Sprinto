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
          issueUrl: "https://example.atlassian.net/browse/PROJ-1",
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
    expect(screen.getByRole("link", { name: "PROJ-1" }).getAttribute("href")).toBe("https://example.atlassian.net/browse/PROJ-1");
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

  it("submits selected Jira projects as project scope filters", async () => {
    const onLoadReport = vi.fn().mockResolvedValue({ rows: [] });
    const onLoadIssues = vi.fn().mockResolvedValue([
      {
        key: "MED",
        title: "Mediox",
        issueType: "Project",
        scopeType: "project",
      },
    ]);
    const onLoadUsers = vi.fn().mockResolvedValue([]);

    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={onLoadIssues}
        onLoadReport={onLoadReport}
        onLoadUsers={onLoadUsers}
      />
    );

    await waitFor(() => expect(onLoadUsers).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Issue"), { target: { value: "Mediox" } });

    await waitFor(() => expect(onLoadIssues).toHaveBeenCalledWith("Mediox"));
    fireEvent.mouseDown(await screen.findByRole("button", { name: /MED.*Mediox.*Project/i }));
    fireEvent.click(screen.getByRole("button", { name: "View report" }));

    await waitFor(() =>
      expect(onLoadReport).toHaveBeenCalledWith(
        expect.objectContaining({
          issueKeys: [],
          projectKeys: ["MED"],
          groupIds: [],
        })
      )
    );
  });

  it("submits selected Jira groups as group filters", async () => {
    const onLoadReport = vi.fn().mockResolvedValue({ rows: [] });
    const onLoadUsers = vi.fn().mockResolvedValue([
      {
        accountId: "group:group-1",
        displayName: "Finance Leads",
        emailAddress: "",
        avatarUrl: "",
        active: true,
        scopeType: "group",
        groupId: "group-1",
      },
    ]);

    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadReport={onLoadReport}
        onLoadUsers={onLoadUsers}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Find user or group"), { target: { value: "Finance" } });

    await waitFor(() => expect(onLoadUsers).toHaveBeenCalledWith("Finance"));
    fireEvent.mouseDown(await screen.findByRole("button", { name: /Finance Leads.*Jira group/i }));
    fireEvent.click(screen.getByRole("button", { name: "View report" }));

    await waitFor(() =>
      expect(onLoadReport).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeAccountIds: [],
          groupIds: ["group-1"],
        })
      )
    );
  });

  it("clears the user or group search when nothing is selected", async () => {
    const onLoadUsers = vi.fn().mockResolvedValue([]);

    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadReport={vi.fn().mockResolvedValue({ rows: [] })}
        onLoadUsers={onLoadUsers}
      />
    );

    const input = screen.getByPlaceholderText("Find user or group") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Fin" } });

    await waitFor(() => expect(onLoadUsers).toHaveBeenCalledWith("Fin"));
    fireEvent.blur(input);

    await waitFor(() => expect(input.value).toBe(""));
  });

  it("offers Group and Epic in the grouping selects and excludes the selected primary from secondary", async () => {
    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadReport={vi.fn().mockResolvedValue({ rows: [] })}
        onLoadUsers={vi.fn().mockResolvedValue([])}
      />
    );

    const primarySelect = screen.getByLabelText("Primary group") as HTMLSelectElement;
    const secondarySelect = screen.getByLabelText("Secondary group") as HTMLSelectElement;

    expect(primarySelect.querySelector('option[value="epic"]')).toBeTruthy();
    expect(primarySelect.querySelector('option[value="group"]')).toBeTruthy();
    expect(secondarySelect.querySelector('option[value="epic"]')).toBeTruthy();
    expect(secondarySelect.querySelector('option[value="group"]')).toBeTruthy();

    fireEvent.change(primarySelect, { target: { value: "group" } });

    expect((screen.getByLabelText("Secondary group") as HTMLSelectElement).querySelector('option[value="group"]')).toBeNull();
  });

  it("keeps the epic children toggle always available", async () => {
    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadReport={vi.fn().mockResolvedValue({ rows: [] })}
        onLoadUsers={vi.fn().mockResolvedValue([])}
      />
    );

    const toggle = screen.getByRole("button", { name: "Epic - Include children" });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
  });
});
