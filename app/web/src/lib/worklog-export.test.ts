import { describe, expect, it } from "vitest";
import { buildWorklogCsv } from "./worklog-export";
import type { WorklogExportPayload } from "./worklog-export";

function makePayload(overrides: Partial<WorklogExportPayload> = {}): WorklogExportPayload {
  return {
    blocks: [],
    columns: [
      { key: "epic", label: "Epic" },
      { key: "issue", label: "Issue" },
      { key: "user", label: "User" },
    ],
    fileBaseName: "report",
    filters: [],
    primaryGroupLabel: "Epic",
    showSourceColumn: false,
    summary: { blockCount: 0, issueCount: 0, totalEntries: 0, totalSeconds: 0, userCount: 0 },
    ...overrides,
  };
}

function parseRows(csv: string) {
  return csv.split("\n").map((row) =>
    row.split(/,(?=")/).map((cell) => cell.replace(/^"|"$/g, "").replaceAll('""', '"'))
  );
}

describe("buildWorklogCsv", () => {
  it("includes a header row with column labels", () => {
    const csv = buildWorklogCsv(makePayload());
    const headerLine = csv.split("\n").find((line) => line.includes("Epic") && line.includes("Issue") && line.includes("User"));
    expect(headerLine).toBeDefined();
  });

  it("includes a grand total row", () => {
    const csv = buildWorklogCsv(makePayload({ summary: { blockCount: 0, issueCount: 0, totalEntries: 0, totalSeconds: 3600, userCount: 0 } }));
    expect(csv).toContain("Grand total");
    expect(csv).toContain("1h");
  });

  it("includes the report preface title", () => {
    const csv = buildWorklogCsv(makePayload());
    expect(csv).toContain("Sprinto Jira Worklog report");
  });

  it("includes filter labels in the preface", () => {
    const csv = buildWorklogCsv(makePayload({ filters: [{ label: "Period", value: "2025-01" }] }));
    expect(csv).toContain("Period");
    expect(csv).toContain("2025-01");
  });

  it("shows '-' for empty filter values", () => {
    const csv = buildWorklogCsv(makePayload({ filters: [{ label: "Project", value: "" }] }));
    expect(csv).toContain("Project: -");
  });

  it("renders block rows with data values", () => {
    const payload = makePayload({
      blocks: [
        {
          label: "EPIC-1",
          totalSeconds: 7200,
          rows: [
            {
              values: { epic: "EPIC-1", issue: "PROJ-10", user: "Alice" },
              urls: {},
              source: "PROJ-10",
              sourceUrl: "",
              secondsSpent: 3600,
            },
            {
              values: { epic: "EPIC-1", issue: "PROJ-11", user: "Bob" },
              urls: {},
              source: "PROJ-11",
              sourceUrl: "",
              secondsSpent: 3600,
            },
          ],
        },
      ],
      summary: { blockCount: 1, issueCount: 2, totalEntries: 2, totalSeconds: 7200, userCount: 2 },
    });
    const csv = buildWorklogCsv(payload);
    expect(csv).toContain("PROJ-10");
    expect(csv).toContain("Alice");
    expect(csv).toContain("PROJ-11");
    expect(csv).toContain("Bob");
  });

  it("suppresses repeated grouping values in subsequent rows", () => {
    const payload = makePayload({
      blocks: [
        {
          label: "EPIC-1",
          totalSeconds: 7200,
          rows: [
            {
              values: { epic: "EPIC-1", issue: "PROJ-10", user: "Alice" },
              urls: {},
              source: "PROJ-10",
              sourceUrl: "",
              secondsSpent: 3600,
            },
            {
              values: { epic: "EPIC-1", issue: "PROJ-10", user: "Bob" },
              urls: {},
              source: "PROJ-10",
              sourceUrl: "",
              secondsSpent: 3600,
            },
          ],
        },
      ],
      summary: { blockCount: 1, issueCount: 1, totalEntries: 2, totalSeconds: 7200, userCount: 2 },
    });
    const csv = buildWorklogCsv(payload);
    const rows = parseRows(csv);
    const dataRows = rows.filter((row) => row[2] === "Alice" || row[2] === "Bob");
    const epicValues = dataRows.map((row) => row[0]);
    expect(epicValues[0]).toBe("EPIC-1");
    expect(epicValues[1]).toBe("");
  });

  it("adds a subtotal row after each block", () => {
    const payload = makePayload({
      blocks: [
        {
          label: "EPIC-1",
          totalSeconds: 3600,
          rows: [
            { values: { epic: "EPIC-1", issue: "PROJ-10", user: "Alice" }, urls: {}, source: "", sourceUrl: "", secondsSpent: 3600 },
          ],
        },
      ],
      summary: { blockCount: 1, issueCount: 1, totalEntries: 1, totalSeconds: 3600, userCount: 1 },
    });
    const csv = buildWorklogCsv(payload);
    expect(csv).toContain("Subtotal");
  });

  it("includes a Source column when showSourceColumn is true", () => {
    const payload = makePayload({
      showSourceColumn: true,
      blocks: [
        {
          label: "EPIC-1",
          totalSeconds: 1800,
          rows: [
            { values: { epic: "EPIC-1", issue: "PROJ-10", user: "Alice" }, urls: {}, source: "my-source", sourceUrl: "", secondsSpent: 1800 },
          ],
        },
      ],
      summary: { blockCount: 1, issueCount: 1, totalEntries: 1, totalSeconds: 1800, userCount: 1 },
    });
    const csv = buildWorklogCsv(payload);
    expect(csv).toContain("Source");
    expect(csv).toContain("my-source");
  });

  it("escapes double quotes in cell values", () => {
    const payload = makePayload({
      blocks: [
        {
          label: 'Name with "quotes"',
          totalSeconds: 0,
          rows: [
            { values: { epic: 'He said "hello"', issue: "PROJ-1", user: "Alice" }, urls: {}, source: "", sourceUrl: "", secondsSpent: 0 },
          ],
        },
      ],
      summary: { blockCount: 1, issueCount: 1, totalEntries: 1, totalSeconds: 0, userCount: 1 },
    });
    const csv = buildWorklogCsv(payload);
    expect(csv).toContain('He said ""hello""');
  });

  describe("duration formatting", () => {
    it("formats seconds-only as minutes", () => {
      const payload = makePayload({
        summary: { blockCount: 0, issueCount: 0, totalEntries: 0, totalSeconds: 60, userCount: 0 },
      });
      const csv = buildWorklogCsv(payload);
      expect(csv).toContain("1m");
    });

    it("formats whole hours without minutes", () => {
      const payload = makePayload({
        summary: { blockCount: 0, issueCount: 0, totalEntries: 0, totalSeconds: 7200, userCount: 0 },
      });
      const csv = buildWorklogCsv(payload);
      expect(csv).toContain("2h");
    });

    it("formats hours and minutes together", () => {
      const payload = makePayload({
        summary: { blockCount: 0, issueCount: 0, totalEntries: 0, totalSeconds: 5400, userCount: 0 },
      });
      const csv = buildWorklogCsv(payload);
      expect(csv).toContain("1h 30m");
    });

    it("formats zero seconds as 0m", () => {
      const payload = makePayload({
        summary: { blockCount: 0, issueCount: 0, totalEntries: 0, totalSeconds: 0, userCount: 0 },
      });
      const csv = buildWorklogCsv(payload);
      expect(csv).toContain("0m");
    });
  });
});
