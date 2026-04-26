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
    fireEvent.click(screen.getByRole("button", { name: /Show worklog table/i }));
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

  it("offers Epic in the grouping selects and removes Group grouping", async () => {
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
    expect(secondarySelect.querySelector('option[value="epic"]')).toBeTruthy();
    expect(primarySelect.querySelector('option[value="group"]')).toBeNull();
    expect(secondarySelect.querySelector('option[value="group"]')).toBeNull();

    fireEvent.change(primarySelect, { target: { value: "epic" } });

    expect((screen.getByLabelText("Secondary group") as HTMLSelectElement).querySelector('option[value="epic"]')).toBeNull();
  });

  it("keeps selected grouping columns first and renders Epic titles as links", async () => {
    const onLoadReport = vi.fn().mockResolvedValue({
      rows: [
        {
          epicKey: "EPIC-1",
          epicTitle: "Customer onboarding",
          epicUrl: "https://example.atlassian.net/browse/EPIC-1",
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

    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadReport={onLoadReport}
        onLoadUsers={vi.fn().mockResolvedValue([])}
      />
    );

    fireEvent.change(screen.getByLabelText("Secondary group"), { target: { value: "epic" } });
    fireEvent.click(screen.getByRole("button", { name: "View report" }));

    await waitFor(() => expect(onLoadReport).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Show worklog table/i }));
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.replace(/[↑↓↕]/g, "").trim());
    expect(headers).toEqual(["Issue", "Epic", "User", "Time"]);
    expect(screen.getByRole("link", { name: "EPIC-1" }).getAttribute("href")).toBe("https://example.atlassian.net/browse/EPIC-1");
    expect(screen.getByTitle("Customer onboarding")).toBeTruthy();
  });

  it("sorts the report from table headers", async () => {
    const onLoadReport = vi.fn().mockResolvedValue({
      rows: [
        {
          issueKey: "PROJ-1",
          issueTitle: "Larger item",
          issueUrl: "https://example.atlassian.net/browse/PROJ-1",
          accountId: "abc",
          author: "Alice",
          startedAt: "2026-04-01T10:00:00.000Z",
          secondsSpent: 3600,
        },
        {
          issueKey: "PROJ-2",
          issueTitle: "Smaller item",
          issueUrl: "https://example.atlassian.net/browse/PROJ-2",
          accountId: "def",
          author: "Bob",
          startedAt: "2026-04-01T11:00:00.000Z",
          secondsSpent: 1800,
        },
      ],
    });

    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadReport={onLoadReport}
        onLoadUsers={vi.fn().mockResolvedValue([])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "View report" }));
    await waitFor(() => expect(onLoadReport).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Show worklog table/i }));

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["PROJ-1", "PROJ-2"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Time ascending" }));

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["PROJ-2", "PROJ-1"]);
  });

  it("highlights matching table rows when a chart legend item is selected", async () => {
    const onLoadReport = vi.fn().mockResolvedValue({
      rows: [
        {
          issueKey: "PROJ-1",
          issueTitle: "First issue",
          issueUrl: "https://example.atlassian.net/browse/PROJ-1",
          accountId: "abc",
          author: "Alice",
          startedAt: "2026-04-01T10:00:00.000Z",
          secondsSpent: 3600,
        },
        {
          issueKey: "PROJ-2",
          issueTitle: "Second issue",
          issueUrl: "https://example.atlassian.net/browse/PROJ-2",
          accountId: "def",
          author: "Bob",
          startedAt: "2026-04-01T11:00:00.000Z",
          secondsSpent: 1800,
        },
      ],
    });

    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadReport={onLoadReport}
        onLoadUsers={vi.fn().mockResolvedValue([])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "View report" }));
    await waitFor(() => expect(onLoadReport).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Show worklog table/i }));
    fireEvent.click(screen.getAllByRole("button", { name: "Focus PROJ-1 in chart and table" }).find((element) => element.tagName === "BUTTON")!);

    expect(screen.getByRole("link", { name: "PROJ-1" }).closest("tr")?.className).toContain("is-chart-match");
    expect(screen.getByRole("link", { name: "PROJ-2" }).closest("tr")?.className).not.toContain("is-chart-match");
  });

  it("shows selected issue title and Jira link in the chart info card", async () => {
    const onLoadReport = vi.fn().mockResolvedValue({
      rows: [
        {
          issueKey: "PROJ-1",
          issueTitle: "A very useful Jira issue title",
          issueUrl: "https://example.atlassian.net/browse/PROJ-1",
          accountId: "abc",
          author: "Alice",
          startedAt: "2026-04-01T10:00:00.000Z",
          secondsSpent: 3600,
        },
      ],
    });

    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadReport={onLoadReport}
        onLoadUsers={vi.fn().mockResolvedValue([])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "View report" }));
    await waitFor(() => expect(onLoadReport).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole("button", { name: "Focus PROJ-1 in chart and table" }).find((element) => element.tagName === "BUTTON")!);

    expect(screen.getByText("A very useful Jira issue title")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open PROJ-1 in Jira" }).getAttribute("href")).toBe("https://example.atlassian.net/browse/PROJ-1");
  });

  it("configures linked issue types from the modal", async () => {
    const onLoadLinkTypes = vi.fn().mockResolvedValue([
      { id: "10001", name: "Relates", outward: "relates to", inward: "relates to" },
      { id: "10002", name: "Blocks", outward: "blocks", inward: "is blocked by" },
    ]);
    const onLoadReport = vi.fn().mockResolvedValue({ rows: [] });

    render(
      <WorklogView
        onLoadIssue={vi.fn().mockResolvedValue({ key: "PROJ-1", title: "Implement worklog", issueType: "Task" })}
        onLoadIssues={vi.fn().mockResolvedValue([])}
        onLoadLinkTypes={onLoadLinkTypes}
        onLoadReport={onLoadReport}
        onLoadUsers={vi.fn().mockResolvedValue([])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Linked issues off" }));
    expect(await screen.findByText("relates to")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Link type Relates: Issue relates to Issue, Relates" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Include linked issues" }));
    fireEvent.click(screen.getByRole("button", { name: "Link type Relates: Issue relates to Issue, Relates" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "View report" }));

    await waitFor(() =>
      expect(onLoadReport).toHaveBeenCalledWith(
        expect.objectContaining({
          includeLinkedIssues: true,
          linkedIssueTypeIds: ["10001"],
        })
      )
    );
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
