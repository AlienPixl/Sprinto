import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  applyJiraEstimate,
  assignJiraIssue,
  buildJiraWorklogReport,
  createIssueReportComment,
  createSimplePdfBuffer,
  listJiraAssignableUsers,
  listJiraBoards,
  listJiraIssues,
  listJiraSprintIssues,
  listJiraWorklogUsers,
  parseImageDataUrl,
  postJiraIssueReport,
  searchJiraWorklogIssues,
} from "./jira.js";

const settings = {
  integrations: {
    jira: {
      enabled: true,
      baseUrl: "https://example.atlassian.net",
      serviceAccountEmail: "bot@example.com",
      apiToken: "secret-token",
      offerKanbanBoards: false,
      writeStoryPointsEnabled: true,
      writeOriginalEstimateEnabled: true,
      writeAssigneeEnabled: true,
      originalEstimateMode: "multiplied-story-points",
      originalEstimateMinutesPerStoryPoint: 30,
      postCommentEnabled: true,
      postPdfEnabled: true,
    },
  },
};

describe("jira helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a readable Jira comment", () => {
    const comment = createIssueReportComment({
      issueKey: "PROJ-10",
      issueTitle: "Add integration",
      roomName: "Sprint 42",
      finalValue: "8",
      average: "8",
      median: "8",
      participants: ["Alice", "Bob"],
      votes: ["alice:8", "bob:8"],
    });

    expect(JSON.stringify(comment)).toContain("Sprinto voting report");
  });

  it("creates a PDF-like buffer", async () => {
    const pdf = await createSimplePdfBuffer({
      issueKey: "PROJ-10",
      issueTitle: "Add integration",
      roomName: "Sprint 42",
      finalValue: "8",
      average: "8",
      median: "8",
      mostFrequent: "8",
      highest: "8",
      totalVoters: 1,
      durationLabel: "1m 10s",
      startedAt: "2026-04-10T10:00:00.000Z",
      revealedAt: "2026-04-10T10:01:10.000Z",
      sentAt: "2026-04-10T10:02:00.000Z",
      voterRows: [
        {
          userId: "alice",
          name: "Alice",
          initials: "A",
          avatarDataUrl: "",
          value: "8",
          votedAt: "2026-04-10T10:00:30.000Z",
        },
      ],
      timelineEvents: [
        {
          type: "vote",
          occurredAt: "2026-04-10T10:00:30.000Z",
          participantName: "Alice",
          value: "8",
        },
        {
          type: "reveal",
          occurredAt: "2026-04-10T10:01:10.000Z",
        },
      ],
      participants: ["Alice"],
      votes: ["alice:8"],
    });

    expect(pdf.subarray(0, 8).toString("utf8")).toContain("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(100);
  });

  it("keeps the rich PDF renderer working without unicode fonts", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const trickyIssueTitle = `Fancy quotes \u201cdemo\u201d \u2013 board\u2026`;
    const trickyRoomName = `Prilis zlutoucky kun\u2019s room \u2013 demo`;
    const trickyVoterName = `Prilis zlutoucky kun \u2022 team`;
    const trickySecondVoterName = `O\u2019Hara \u2013 QA`;

    const pdf = await createSimplePdfBuffer({
      issueKey: "PROJ-10",
      issueTitle: trickyIssueTitle,
      roomName: trickyRoomName,
      finalValue: "8",
      average: "5.5",
      median: "5.5",
      mostFrequent: "8",
      highest: "8",
      totalVoters: 2,
      durationLabel: "32s",
      startedAt: "2026-04-10T10:00:00.000Z",
      revealedAt: "2026-04-10T10:00:32.000Z",
      sentAt: "2026-04-10T10:01:00.000Z",
      voterRows: [
        {
          userId: "u1",
          name: trickyVoterName,
          initials: "PZ",
          avatarDataUrl: "",
          value: "8",
          votedAt: "2026-04-10T10:00:15.000Z",
        },
        {
          userId: "u2",
          name: trickySecondVoterName,
          initials: "OH",
          avatarDataUrl: "",
          value: "3",
          votedAt: "2026-04-10T10:00:20.000Z",
        },
      ],
      timelineEvents: [
        {
          type: "vote",
          occurredAt: "2026-04-10T10:00:15.000Z",
          participantName: trickyVoterName,
          value: "8",
        },
        {
          type: "vote",
          occurredAt: "2026-04-10T10:00:20.000Z",
          participantName: trickySecondVoterName,
          value: "3",
        },
        {
          type: "reveal",
          occurredAt: "2026-04-10T10:00:32.000Z",
        },
      ],
      participants: [trickyVoterName, trickySecondVoterName],
      votes: ["u1:8", "u2:3"],
    });

    expect(pdf.subarray(0, 8).toString("utf8")).toContain("%PDF-");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps the rich PDF renderer working when a PNG data URL contains non-PNG image data", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mislabeledSvgLogo = `data:image/png;base64,${Buffer.from(
      "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"40\"><rect width=\"120\" height=\"40\" fill=\"#e37a3a\"/><text x=\"16\" y=\"26\" font-size=\"18\" fill=\"#fff\">SPRINTO</text></svg>",
      "utf8",
    ).toString("base64")}`;

    const pdf = await createSimplePdfBuffer({
      issueKey: "PROJ-10",
      issueTitle: "Logo fallback",
      roomName: "Sprint 42",
      logoDataUrl: mislabeledSvgLogo,
      finalValue: "8",
      average: "5.5",
      median: "5.5",
      mostFrequent: "8",
      highest: "8",
      totalVoters: 1,
      durationLabel: "7s",
      startedAt: "2026-04-10T10:00:00.000Z",
      revealedAt: "2026-04-10T10:00:07.000Z",
      sentAt: "2026-04-10T10:01:00.000Z",
      voterRows: [
        {
          userId: "alice",
          name: "Alice",
          initials: "A",
          avatarDataUrl: "",
          value: "8",
          votedAt: "2026-04-10T10:00:03.000Z",
        },
      ],
      timelineEvents: [
        {
          type: "vote",
          occurredAt: "2026-04-10T10:00:03.000Z",
          participantName: "Alice",
          value: "8",
        },
        {
          type: "reveal",
          occurredAt: "2026-04-10T10:00:07.000Z",
        },
      ],
      participants: ["Alice"],
      votes: ["alice:8"],
    });

    expect(pdf.subarray(0, 8).toString("utf8")).toContain("%PDF-");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("parses a valid base64 PNG data URL into image bytes", () => {
    const assetLogoBytes = fs.readFileSync("../assets/Logo_bitmap_noBG.png");
    const assetLogoDataUrl = `data:image/png;base64,${assetLogoBytes.toString("base64")}`;
    const parsed = parseImageDataUrl(assetLogoDataUrl);

    expect(parsed?.mime).toBe("image/png");
    expect(parsed?.bytes.equals(assetLogoBytes)).toBe(true);
  });

  it("uploads PDF and posts Jira comment with attachment link", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            id: "1001",
            filename: "SPRINTO REPORT PROJ-10 Demo.pdf",
            content: "https://example.atlassian.net/attachment/1001",
            self: "https://example.atlassian.net/rest/api/3/attachment/1001",
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "2001" }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await postJiraIssueReport(settings, "PROJ-10", {
      commentDocument: createIssueReportComment(
        {
          issueKey: "PROJ-10",
          issueTitle: "Demo",
          roomName: "Sprint 42",
          finalValue: "8",
        },
        {
          sentAt: "2026-04-10T10:02:00.000Z",
          filename: "SPRINTO REPORT PROJ-10 Demo.pdf",
          attachment: {
            filename: "SPRINTO REPORT PROJ-10 Demo.pdf",
            content: "https://example.atlassian.net/attachment/1001",
          },
        },
      ),
      pdfBuffer: Buffer.from("%PDF-1.4 demo"),
      filename: "SPRINTO REPORT PROJ-10 Demo.pdf",
    });

    expect(result.pdfUploaded).toBe(true);
    expect(result.commentPosted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/comment");
    expect(String(fetchMock.mock.calls[1][1]?.body || "")).toContain("SPRINTO REPORT PROJ-10 Demo.pdf");
    expect(String(fetchMock.mock.calls[1][1]?.body || "")).toContain("https://example.atlassian.net/attachment/1001");
  });

  it("filters sprint issues using AND semantics and sorts by priority", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "customfield_10016", name: "Story Points" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [
            {
              id: "1",
              key: "PROJ-1",
              fields: {
                summary: "First",
                priority: { id: "2", name: "High" },
                reporter: { displayName: "Alice" },
                timetracking: {},
                status: { name: "To Do" },
                issuetype: { name: "Story" },
                customfield_10016: null,
              },
            },
            {
              id: "2",
              key: "PROJ-2",
              fields: {
                summary: "Second",
                priority: { id: "4", name: "Low" },
                reporter: { displayName: "Bob" },
                timetracking: {},
                status: { name: "To Do" },
                issuetype: { name: "Story" },
                customfield_10016: null,
              },
            },
            {
              id: "3",
              key: "PROJ-10",
              fields: {
                summary: "Third",
                priority: { id: "1", name: "Highest" },
                reporter: { displayName: "Carol" },
                timetracking: { originalEstimateSeconds: 3600 },
                status: { name: "To Do" },
                issuetype: { name: "Story" },
                customfield_10016: 5,
              },
            },
          ],
          total: 3,
        }),
      }) as unknown as typeof fetch);

    const issues = await listJiraSprintIssues(settings, {
      boardId: "10",
      sprintId: "20",
      filters: {
        storyPointsEmpty: true,
        originalEstimateEmpty: false,
        importOrder: "priority",
      },
    });

    expect(issues).toHaveLength(2);
    expect(issues[0].key).toBe("PROJ-1");
    expect(issues[1].key).toBe("PROJ-2");
    expect(issues[0].reporter).toBe("Alice");
  });

  it("filters out kanban boards unless they are explicitly enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        values: [
          { id: "1", name: "Platform Scrum", type: "scrum" },
          { id: "2", name: "Support Flow", type: "kanban" },
        ],
        isLast: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const scrumOnlyBoards = await listJiraBoards(settings);
    const allBoards = await listJiraBoards({
      integrations: {
        jira: {
          ...settings.integrations.jira,
          offerKanbanBoards: true,
        },
      },
    });

    expect(scrumOnlyBoards).toHaveLength(1);
    expect(scrumOnlyBoards[0].type).toBe("scrum");
    expect(allBoards).toHaveLength(2);
    expect(allBoards[1].type).toBe("kanban");
  });

  it("loads board issues when sprint is not provided", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "customfield_10016", name: "Story Points" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [
            {
              id: "1",
              key: "PROJ-7",
              fields: {
                summary: "Kanban item",
                priority: { id: "2", name: "High" },
                reporter: { displayName: "Dana" },
                timetracking: {},
                status: { name: "In Progress" },
                issuetype: { name: "Task" },
                customfield_10016: null,
              },
            },
          ],
          total: 1,
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const issues = await listJiraIssues(settings, {
      boardId: "10",
      filters: {
        storyPointsEmpty: false,
        originalEstimateEmpty: false,
        importOrder: "issue-key",
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe("PROJ-7");
    expect(fetchMock.mock.calls[1][0]).toContain("/rest/agile/1.0/board/10/issue");
  });

  it("applies both Story Points and Original Estimate", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "customfield_10016", name: "Story Points" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await applyJiraEstimate(settings, "PROJ-1", {
      mode: "both",
      storyPointsValue: 5,
      minutesPerStoryPoint: 30,
    });

    expect(result.issueKey).toBe("PROJ-1");
    expect(result.updatedFields).toContain("customfield_10016");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lists assignable Jira users for an issue", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            accountId: "acc-1",
            displayName: "Alice Example",
            emailAddress: "alice@example.com",
            active: true,
            avatarUrls: {
              "24x24": "https://example.com/alice.png",
            },
          },
          {
            accountId: "acc-2",
            displayName: "Bob Example",
            emailAddress: "bob@example.com",
            active: true,
            avatarUrls: {},
          },
        ]),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const users = await listJiraAssignableUsers(settings, "PROJ-1", "ali");

    expect(users).toEqual([
      {
        accountId: "acc-1",
        displayName: "Alice Example",
        emailAddress: "alice@example.com",
        avatarUrl: "https://example.com/alice.png",
        active: true,
        scopeType: "user",
      },
      {
        accountId: "acc-2",
        displayName: "Bob Example",
        emailAddress: "bob@example.com",
        avatarUrl: "",
        active: true,
        scopeType: "user",
      },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain("/rest/api/3/user/assignable/search?");
    expect(fetchMock.mock.calls[0][0]).toContain("issueKey=PROJ-1");
    expect(fetchMock.mock.calls[0][0]).toContain("query=ali");
  });

  it("updates Jira assignee and supports unassigned", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const assigned = await assignJiraIssue(settings, "PROJ-1", "acc-1");
    const unassigned = await assignJiraIssue(settings, "PROJ-1", "");

    expect(assigned).toEqual({ issueKey: "PROJ-1", accountId: "acc-1" });
    expect(unassigned).toEqual({ issueKey: "PROJ-1", accountId: "" });
    expect(fetchMock.mock.calls[0][0]).toContain("/rest/api/3/issue/PROJ-1/assignee");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PUT",
    });
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ accountId: "acc-1" }));
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ accountId: null }));
  });

  it("lists Jira worklog groups together with users for search", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          {
            accountId: "acc-1",
            displayName: "Alice Example",
            emailAddress: "alice@example.com",
            active: true,
            avatarUrls: {
              "24x24": "https://example.com/alice.png",
            },
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          groups: [
            {
              groupId: "group-1",
              name: "Finance Leads",
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const users = await listJiraWorklogUsers(settings, "fin");

    expect(users).toEqual([
      {
        accountId: "group:group-1",
        displayName: "Finance Leads",
        emailAddress: "",
        avatarUrl: "",
        active: true,
        scopeType: "group",
        groupId: "group-1",
      },
      {
        accountId: "acc-1",
        displayName: "Alice Example",
        emailAddress: "alice@example.com",
        avatarUrl: "https://example.com/alice.png",
        active: true,
        scopeType: "user",
      },
    ]);
    expect(fetchMock.mock.calls[1][0]).toContain("/rest/api/3/groups/picker?");
    expect(fetchMock.mock.calls[1][0]).toContain("query=fin");
  });

  it("builds worklog rows in the requested date window", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [{
            key: "PROJ-1",
            fields: {
              summary: "First issue",
            },
          }],
          total: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 1,
          worklogs: [
            {
              started: "2026-04-01T10:00:00.000+0000",
              timeSpentSeconds: 7200,
              author: { accountId: "abc", displayName: "Alice" },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const rows = await buildJiraWorklogReport(settings, {
      dateFrom: "2026-04-01",
      dateTo: "2026-04-02",
      issueKeys: [],
      projectKeys: [],
      includeEpicChildren: false,
      assigneeAccountIds: [],
      groupIds: [],
      viewMode: "issue-first",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].author).toBe("Alice");
    expect(rows[0].secondsSpent).toBe(7200);
    expect(rows[0].issueUrl).toBe("https://example.atlassian.net/browse/PROJ-1");
    const firstSearchBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body || "{}"));
    expect(firstSearchBody.jql).toContain('worklogDate >= "2026-04-01"');
    expect(firstSearchBody.jql).toContain('worklogDate <= "2026-04-02"');
    expect(String(fetchMock.mock.calls[1][0] || "")).toContain("/rest/api/3/issue/PROJ-1/worklog?");
    expect(String(fetchMock.mock.calls[1][0] || "")).toContain("startedAfter=");
    expect(String(fetchMock.mock.calls[1][0] || "")).toContain("startedBefore=");
  });

  it("shows matching projects before issues in worklog search", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          values: [
            { key: "MED", name: "Mediox" },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sections: [
            {
              issues: [{ key: "MED-1" }],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [
            {
              key: "MED-1",
              fields: {
                summary: "Mediox backlog cleanup",
                issuetype: { name: "Scénář", untranslatedName: "Story" },
              },
            },
          ],
          total: 1,
        }),
      }) as unknown as typeof fetch);

    const results = await searchJiraWorklogIssues(settings, "Mediox");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      key: "MED",
      title: "Mediox",
      issueType: "Project",
      scopeType: "project",
    });
    expect(results[1]).toMatchObject({
      key: "MED-1",
      title: "Mediox backlog cleanup",
      issueType: "Story",
      scopeType: "issue",
    });
  });

  it("builds worklog rows for a selected Jira project", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [{
            key: "MED-1",
            fields: { summary: "Mediox work item" },
          }],
          total: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 1,
          worklogs: [
            {
              started: "2026-04-01T11:00:00.000+0000",
              timeSpentSeconds: 1800,
              author: { accountId: "xyz", displayName: "Bob" },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const rows = await buildJiraWorklogReport(settings, {
      dateFrom: "2026-04-01",
      dateTo: "2026-04-02",
      issueKeys: [],
      projectKeys: ["MED"],
      includeEpicChildren: false,
      assigneeAccountIds: [],
      groupIds: [],
      viewMode: "issue-first",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      issueKey: "MED-1",
      issueTitle: "Mediox work item",
      issueUrl: "https://example.atlassian.net/browse/MED-1",
      author: "Bob",
      secondsSpent: 1800,
    });
    const projectSearchBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body || "{}"));
    expect(projectSearchBody.jql).toContain('project = "MED"');
    expect(projectSearchBody.jql).toContain('worklogDate >= "2026-04-01"');
    expect(String(fetchMock.mock.calls[1][0] || "")).toContain("startedAfter=");
  });

  it("filters worklog rows by selected Jira group members", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issues: [{
            key: "MED-1",
            fields: { summary: "Mediox work item" },
          }],
          total: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isLast: true,
          values: [
            {
              accountId: "group-user-1",
              displayName: "Alice Example",
              emailAddress: "alice@example.com",
              active: true,
              accountType: "atlassian",
              avatarUrls: {},
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total: 2,
          worklogs: [
            {
              started: "2026-04-01T11:00:00.000+0000",
              timeSpentSeconds: 1800,
              author: { accountId: "group-user-1", displayName: "Alice Example" },
            },
            {
              started: "2026-04-01T12:00:00.000+0000",
              timeSpentSeconds: 1200,
              author: { accountId: "outsider", displayName: "Bob Example" },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const rows = await buildJiraWorklogReport(settings, {
      dateFrom: "2026-04-01",
      dateTo: "2026-04-02",
      issueKeys: [],
      projectKeys: ["MED"],
      includeEpicChildren: false,
      assigneeAccountIds: [],
      groupIds: ["group-1"],
      groupLabelsById: {
        "group-1": "Finance Leads",
      },
      viewMode: "issue-first",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      issueKey: "MED-1",
      groupNames: ["Finance Leads"],
      author: "Alice Example",
      secondsSpent: 1800,
    });
    const groupSearchBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body || "{}"));
    expect(groupSearchBody.jql).toContain('project = "MED"');
    expect(String(fetchMock.mock.calls[2][0] || "")).toContain("startedBefore=");
  });
});
