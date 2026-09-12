import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorklogCalendar } from "./WorklogCalendar";
import type { JiraWorklogRow } from "../lib/types";

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

function renderCalendar(rows: JiraWorklogRow[], dateFrom = "2026-03-02", dateTo = "2026-03-02") {
  return render(<WorklogCalendar dateFrom={dateFrom} dateTo={dateTo} rows={rows} timeZone={TZ} />);
}

describe("WorklogCalendar", () => {
  it("renders one row per day in the selected range", () => {
    renderCalendar([], "2026-03-02", "2026-03-04");

    expect(screen.getByText("Mon 2 Mar")).toBeTruthy();
    expect(screen.getByText("Tue 3 Mar")).toBeTruthy();
    expect(screen.getByText("Wed 4 Mar")).toBeTruthy();
  });

  it("says when a day has nothing logged", () => {
    renderCalendar([], "2026-03-02", "2026-03-02");

    expect(screen.getByText("Nothing logged")).toBeTruthy();
  });

  it("renders an entry as a link to the issue with its local time range", () => {
    renderCalendar([makeRow({ secondsSpent: 5400 })]);

    const entry = screen.getByTitle("DS-1 · 09:00–10:30 · 1h 30m · Demo issue");
    expect(entry.getAttribute("href")).toBe("https://jira.example/browse/DS-1");
  });

  it("positions an entry against the shared axis, not against the whole day", () => {
    renderCalendar([makeRow({ startedAt: "2026-03-02T09:00:00.000Z", secondsSpent: 2 * 3600 })]);

    const entry = screen.getByTitle(/^DS-1 · 10:00–12:00/);
    expect(entry.style.left).toBe("25%");
    expect(entry.style.width).toBe("50%");
  });

  it("labels the axis from an hour before the first entry to an hour after the last", () => {
    renderCalendar([makeRow({ startedAt: "2026-03-02T09:00:00.000Z", secondsSpent: 2 * 3600 })]);

    expect(screen.getByText("09:00")).toBeTruthy();
    expect(screen.getByText("13:00")).toBeTruthy();
    expect(screen.queryByText("00:00")).toBeNull();
  });

  it("widens the timeline when zoomed in and returns to fit on reset", () => {
    const { container } = renderCalendar([makeRow()]);
    const grid = () => container.querySelector(".worklog-calendar__grid") as HTMLElement;

    expect(grid().style.width).toBe("100%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(grid().style.width).toBe("150%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(grid().style.width).toBe("200%");

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(grid().style.width).toBe("100%");
  });

  it("cannot zoom out past the fitted timeline", () => {
    renderCalendar([makeRow()]);

    expect(screen.getByRole("button", { name: "Zoom out" }).hasAttribute("disabled")).toBe(true);
  });

  it("marks entries that overlap and counts them in the day summary", () => {
    renderCalendar([
      makeRow({ issueKey: "DS-1", startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
      makeRow({ issueKey: "DS-2", startedAt: "2026-03-02T08:30:00.000Z", secondsSpent: 3600 }),
    ]);

    expect(screen.getByTitle(/^DS-1 .*overlaps/).className).toContain("is-overlapping");
    expect(screen.getByText(/1 overlap/)).toBeTruthy();
  });

  it("marks the unlogged stretch between two entries but keeps it out of the day summary", () => {
    renderCalendar([
      makeRow({ startedAt: "2026-03-02T08:00:00.000Z", secondsSpent: 3600 }),
      makeRow({ startedAt: "2026-03-02T10:30:00.000Z", secondsSpent: 1800 }),
    ]);

    expect(screen.getByTitle("Unlogged · 10:00–11:30 · 1h 30m")).toBeTruthy();
    expect(screen.queryByText(/unlogged/i)).toBeNull();
  });

  it("reports the logged total for a day", () => {
    renderCalendar([makeRow({ secondsSpent: 5400 })]);

    expect(screen.getByText(/1h 30m logged/)).toBeTruthy();
  });

  it("shows every person in the report and gives each their own row", () => {
    const { container } = renderCalendar([
      makeRow({ accountId: "acc-1", author: "Alice", issueKey: "DS-1", secondsSpent: 7200 }),
      makeRow({ accountId: "acc-2", author: "Bob", issueKey: "DS-2", secondsSpent: 1800 }),
    ]);

    expect(screen.getByTitle(/^DS-1/)).toBeTruthy();
    expect(screen.getByTitle(/^DS-2/)).toBeTruthy();
    expect([...container.querySelectorAll(".worklog-calendar__day-label em")].map((node) => node.textContent)).toEqual([
      "Alice",
      "Bob",
    ]);
  });

  it("drops a person from the calendar when their checkbox is cleared", () => {
    renderCalendar([
      makeRow({ accountId: "acc-1", author: "Alice", issueKey: "DS-1", secondsSpent: 7200 }),
      makeRow({ accountId: "acc-2", author: "Bob", issueKey: "DS-2", secondsSpent: 1800 }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "People · 2 of 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Bob/ }));

    expect(screen.getByTitle(/^DS-1/)).toBeTruthy();
    expect(screen.queryByTitle(/^DS-2/)).toBeNull();
    expect(screen.getByRole("button", { name: "People · 1 of 2" })).toBeTruthy();
  });

  it("refuses to clear the last remaining person", () => {
    renderCalendar([
      makeRow({ accountId: "acc-1", author: "Alice", issueKey: "DS-1", secondsSpent: 7200 }),
      makeRow({ accountId: "acc-2", author: "Bob", issueKey: "DS-2", secondsSpent: 1800 }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "People · 2 of 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Bob/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Alice/ }));

    expect(screen.getByTitle(/^DS-1/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Alice/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("closes the person list when clicking outside it", () => {
    renderCalendar([
      makeRow({ accountId: "acc-1", author: "Alice", secondsSpent: 7200 }),
      makeRow({ accountId: "acc-2", author: "Bob", secondsSpent: 1800 }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "People · 2 of 2" }));
    expect(screen.getByRole("checkbox", { name: /Bob/ })).toBeTruthy();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("checkbox", { name: /Bob/ })).toBeNull();
  });

  it("hides the person list when the report has a single author", () => {
    renderCalendar([makeRow()]);

    expect(screen.queryByRole("button", { name: /People/ })).toBeNull();
  });

  it("zooms with a pinch or modified wheel over the timeline, and scrolls otherwise", () => {
    const { container } = renderCalendar([makeRow()]);
    const viewport = container.querySelector(".worklog-calendar__viewport") as HTMLElement;
    const grid = () => container.querySelector(".worklog-calendar__grid") as HTMLElement;

    fireEvent.wheel(viewport, { deltaY: -120 });
    expect(grid().style.width).toBe("100%");

    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -120 });
    expect(grid().style.width).toBe("150%");

    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: 120 });
    expect(grid().style.width).toBe("100%");
  });

  it("names the timezone the times are shown in", () => {
    renderCalendar([makeRow()]);

    expect(screen.getByText("Times in Europe/Prague")).toBeTruthy();
  });
  it("keeps the chosen zoom when switching between people", () => {
    const { container } = renderCalendar([
      makeRow({ accountId: "acc-1", author: "Alice", secondsSpent: 7200 }),
      makeRow({ accountId: "acc-2", author: "Bob", issueKey: "DS-2", secondsSpent: 1800 }),
    ]);
    const grid = () => container.querySelector(".worklog-calendar__grid") as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(grid().style.width).toBe("150%");

    fireEvent.click(screen.getByRole("button", { name: "People · 2 of 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Bob/ }));

    expect(grid().style.width).toBe("150%");
  });
});
