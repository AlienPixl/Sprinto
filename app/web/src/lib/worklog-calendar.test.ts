import { describe, expect, it } from "vitest";
import { buildWorklogCalendar } from "./worklog-calendar";
import type { JiraWorklogRow } from "./types";

const TZ = "Europe/Prague";

function makeRow(overrides: Partial<JiraWorklogRow> = {}): JiraWorklogRow {
  return {
    epicKey: "",
    issueKey: "DS-1",
    issueTitle: "Demo issue",
    issueUrl: "https://jira.example/browse/DS-1",
    accountId: "acc-1",
    author: "Alice",
    startedAt: "2026-03-02T08:00:00.000Z",
    secondsSpent: 3600,
    ...overrides,
  };
}

function group(calendar: ReturnType<typeof buildWorklogCalendar>, dayIndex = 0, groupIndex = 0) {
  return calendar.days[dayIndex].groups[groupIndex];
}

describe("buildWorklogCalendar", () => {
  it("creates one day per date in the range, including days without entries", () => {
    const calendar = buildWorklogCalendar([], { dateFrom: "2026-03-02", dateTo: "2026-03-04", timeZone: TZ });

    expect(calendar.days.map((day) => day.date)).toEqual(["2026-03-02", "2026-03-03", "2026-03-04"]);
    expect(calendar.days.every((day) => day.groups.length === 0)).toBe(true);
  });

  it("places an entry at its local start time with its duration", () => {
    const calendar = buildWorklogCalendar(
      [makeRow({ startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 5400 })],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    const [entry] = group(calendar).entries;
    expect(entry.startMinutes).toBe(9 * 60);
    expect(entry.endMinutes).toBe(10 * 60 + 30);
    expect(entry.secondsSpent).toBe(5400);
  });

  it("reports the logged total for each day", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
        makeRow({ startedAt: "2026-03-02T10:00:00.000Z", secondsSpent: 1800 }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(group(calendar).totalSeconds).toBe(5400);
  });
  it("reports no gap and no overlap when one entry ends exactly where the next starts", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
        makeRow({ startedAt: "2026-03-02T09:00:00.000Z", secondsSpent: 3600 }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(group(calendar).gaps).toEqual([]);
    expect(group(calendar).laneCount).toBe(1);
    expect(group(calendar).entries.every((entry) => entry.overlapping)).toBe(false);
  });

  it("reports the gap between two entries with its duration", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
        makeRow({ startedAt: "2026-03-02T10:30:00.000Z", secondsSpent: 1800 }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(group(calendar).gaps).toEqual([{ startMinutes: 10 * 60, endMinutes: 11 * 60 + 30, seconds: 5400 }]);
    expect(group(calendar).gapSeconds).toBe(5400);
  });

  it("ignores the empty time before the first and after the last entry of the day", () => {
    const calendar = buildWorklogCalendar(
      [makeRow({ startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 })],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(group(calendar).gaps).toEqual([]);
  });

  it("flags overlapping entries and stacks them in separate lanes", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ issueKey: "DS-1", startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
        makeRow({ issueKey: "DS-2", startedAt: "2026-03-02T08:30:00.000Z", secondsSpent: 3600 }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    const alice = group(calendar);
    expect(alice.entries.map((entry) => entry.lane)).toEqual([0, 1]);
    expect(alice.entries.every((entry) => entry.overlapping)).toBe(true);
    expect(alice.laneCount).toBe(2);
    expect(alice.overlapCount).toBe(1);
    expect(alice.overlapSeconds).toBe(1800);
  });

  it("keeps a non-overlapping later entry in the first lane", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
        makeRow({ startedAt: "2026-03-02T08:30:00.000Z", secondsSpent: 3600 }),
        makeRow({ startedAt: "2026-03-02T12:00:00.000Z", secondsSpent: 3600 }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(group(calendar).entries.map((entry) => entry.lane)).toEqual([0, 1, 0]);
  });
  it("carries the issue and author of each entry", () => {
    const calendar = buildWorklogCalendar(
      [makeRow({ issueKey: "DS-7", issueTitle: "Fix login", issueUrl: "https://jira.example/browse/DS-7", author: "Bob" })],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(group(calendar).entries[0]).toMatchObject({
      issueKey: "DS-7",
      issueTitle: "Fix login",
      issueUrl: "https://jira.example/browse/DS-7",
      author: "Bob",
    });
  });

  it("splits an entry that runs past midnight across both days", () => {
    const calendar = buildWorklogCalendar(
      [makeRow({ startedAt: "2026-03-02T22:00:00.000Z", secondsSpent: 4 * 3600 })],
      { dateFrom: "2026-03-02", dateTo: "2026-03-03", timeZone: TZ }
    );

    expect(group(calendar, 0).entries[0]).toMatchObject({ startMinutes: 23 * 60, endMinutes: 24 * 60, continuesIntoNextDay: true });
    expect(group(calendar, 0).totalSeconds).toBe(3600);
    expect(group(calendar, 1).entries[0]).toMatchObject({ startMinutes: 0, endMinutes: 3 * 60, continuesFromPreviousDay: true });
    expect(group(calendar, 1).totalSeconds).toBe(3 * 3600);
  });

  it("keeps the real day length when the clocks change", () => {
    const calendar = buildWorklogCalendar([], { dateFrom: "2026-03-29", dateTo: "2026-10-25", timeZone: TZ });

    expect(calendar.days[0].dayMinutes).toBe(23 * 60);
    expect(calendar.days[calendar.days.length - 1].dayMinutes).toBe(25 * 60);
  });

  it("lists the authors in the report ordered by logged time", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ accountId: "acc-1", author: "Alice", secondsSpent: 1800 }),
        makeRow({ accountId: "acc-2", author: "Bob", secondsSpent: 7200 }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(calendar.authors).toEqual([
      { accountId: "acc-2", name: "Bob", totalSeconds: 7200 },
      { accountId: "acc-1", name: "Alice", totalSeconds: 1800 },
    ]);
  });

  it("keeps only the selected authors", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ accountId: "acc-1", author: "Alice" }),
        makeRow({ accountId: "acc-2", author: "Bob" }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ, accountIds: ["acc-2"] }
    );

    expect(calendar.days[0].groups.map((entry) => entry.name)).toEqual(["Bob"]);
    expect(calendar.authors).toHaveLength(2);
  });

  it("gives every selected person their own group, ordered by logged time", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ accountId: "acc-1", author: "Alice", secondsSpent: 1800 }),
        makeRow({ accountId: "acc-2", author: "Bob", secondsSpent: 7200 }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(calendar.days[0].groups.map((entry) => entry.name)).toEqual(["Bob", "Alice"]);
    expect(group(calendar, 0, 0).totalSeconds).toBe(7200);
    expect(group(calendar, 0, 1).totalSeconds).toBe(1800);
  });

  it("never counts two people working at the same time as an overlap", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ accountId: "acc-1", author: "Alice", startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
        makeRow({ accountId: "acc-2", author: "Bob", startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(calendar.days[0].groups.every((entry) => entry.overlapCount === 0)).toBe(true);
  });

  it("leaves out people with nothing logged on a day", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ accountId: "acc-1", author: "Alice", startedAt: "2026-03-02T08:00:00.000Z" }),
        makeRow({ accountId: "acc-2", author: "Bob", startedAt: "2026-03-03T08:00:00.000Z" }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-03", timeZone: TZ }
    );

    expect(calendar.days[0].groups.map((entry) => entry.name)).toEqual(["Alice"]);
    expect(calendar.days[1].groups.map((entry) => entry.name)).toEqual(["Bob"]);
  });
  it("limits the axis to an hour before the first entry and an hour after the last", () => {
    const calendar = buildWorklogCalendar(
      [makeRow({ startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 2 * 3600 })],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(calendar.window).toEqual({ startMinutes: 8 * 60, endMinutes: 12 * 60 });
  });

  it("spans the axis across every day in the range", () => {
    const calendar = buildWorklogCalendar(
      [
        makeRow({ startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
        makeRow({ startedAt: "2026-03-03T15:00:00.000Z", secondsSpent: 3600 }),
      ],
      { dateFrom: "2026-03-02", dateTo: "2026-03-03", timeZone: TZ }
    );

    expect(calendar.window).toEqual({ startMinutes: 8 * 60, endMinutes: 18 * 60 });
  });

  it("clamps the axis to the day when work runs to its edges", () => {
    const calendar = buildWorklogCalendar(
      [makeRow({ startedAt: "2026-03-01T23:10:00.000Z", secondsSpent: 24 * 3600 - 20 * 60 })],
      { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ }
    );

    expect(calendar.window).toEqual({ startMinutes: 0, endMinutes: 24 * 60 });
  });

  it("falls back to a working-day axis when nothing is logged", () => {
    const calendar = buildWorklogCalendar([], { dateFrom: "2026-03-02", dateTo: "2026-03-02", timeZone: TZ });

    expect(calendar.window).toEqual({ startMinutes: 8 * 60, endMinutes: 18 * 60 });
  });
});
