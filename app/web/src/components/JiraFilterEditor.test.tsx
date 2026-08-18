import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import JiraFilterEditor, { describeFilters } from "./JiraFilterEditor";
import type { JiraImportFilters, JiraStatus } from "../lib/types";

const statuses: JiraStatus[] = [
  { id: "10", name: "To Do" },
  { id: "99", name: "Done" },
];

function Harness({ initial }: { initial: JiraImportFilters }) {
  const [filters, setFilters] = useState<JiraImportFilters>(initial);
  return (
    <>
      <JiraFilterEditor filters={filters} onChange={setFilters} statuses={statuses} labels={["auto", "dor"]} />
      <pre data-testid="state">{JSON.stringify(filters)}</pre>
    </>
  );
}

function currentFilters(): JiraImportFilters {
  return JSON.parse(screen.getByTestId("state").textContent || "{}");
}

const singleCondition: JiraImportFilters = {
  conditions: [{ field: "storyPoints", operator: "IS EMPTY", value: null }],
  connectors: [],
};

describe("JiraFilterEditor", () => {
  it("adds a group as a sibling node rather than a flat condition", () => {
    render(<Harness initial={singleCondition} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add group ( )" }));

    const filters = currentFilters();
    expect(filters.conditions).toHaveLength(2);
    expect(filters.connectors).toEqual(["AND"]);
    expect(filters.conditions[1]).toEqual({
      type: "group",
      conditions: [{ field: "storyPoints", operator: "IS EMPTY", value: null }],
      connectors: [],
    });
  });

  it("edits a condition inside a group without touching the root", () => {
    render(
      <Harness
        initial={{
          conditions: [
            { field: "status", operator: "NOT IN", value: ["99"] },
            { type: "group", conditions: [{ field: "labels", operator: "IN", value: ["dor"] }], connectors: [] },
          ],
          connectors: ["AND"],
        }}
      />
    );

    // Two field selects: the root condition and the one nested in the group.
    const fieldSelects = screen.getAllByDisplayValue(/Status|Labels/);
    fireEvent.change(fieldSelects[1], { target: { value: "storyPoints" } });

    const filters = currentFilters();
    expect(filters.conditions[0]).toEqual({ field: "status", operator: "NOT IN", value: ["99"] });
    expect(filters.conditions[1]).toEqual({
      type: "group",
      conditions: [{ field: "storyPoints", operator: "IS EMPTY", value: null }],
      connectors: [],
    });
  });

  it("drops the group when its last condition is removed", () => {
    render(
      <Harness
        initial={{
          conditions: [
            { field: "status", operator: "NOT IN", value: ["99"] },
            { type: "group", conditions: [{ field: "labels", operator: "IN", value: ["dor"] }], connectors: [] },
          ],
          connectors: ["AND"],
        }}
      />
    );

    const removeButtons = screen.getAllByLabelText("Remove condition");
    fireEvent.click(removeButtons[removeButtons.length - 1]);

    const filters = currentFilters();
    expect(filters.conditions).toEqual([{ field: "status", operator: "NOT IN", value: ["99"] }]);
    expect(filters.connectors).toEqual([]);
  });

  it("keeps the last root condition undeletable", () => {
    render(<Harness initial={singleCondition} />);
    expect(screen.queryByLabelText("Remove condition")).toBeNull();
  });

  it("shows the evaluated expression with its parentheses", () => {
    render(
      <Harness
        initial={{
          conditions: [
            { field: "status", operator: "NOT IN", value: ["99"] },
            {
              type: "group",
              conditions: [
                { field: "labels", operator: "IN", value: ["dor"] },
                { field: "labels", operator: "IN", value: ["auto"] },
              ],
              connectors: ["OR"],
            },
          ],
          connectors: ["AND"],
        }}
      />
    );

    expect(screen.getByText("Status NOT IN (Done) AND (Labels IN (dor) OR Labels IN (auto))")).toBeTruthy();
  });
});

describe("describeFilters", () => {
  it("omits parentheses around a group holding a single condition", () => {
    const text = describeFilters(
      {
        conditions: [
          { field: "storyPoints", operator: "IS EMPTY", value: null },
          { type: "group", conditions: [{ field: "labels", operator: "IN", value: ["dor"] }], connectors: [] },
        ],
        connectors: ["OR"],
      },
      statuses
    );
    expect(text).toBe("Story Points IS EMPTY OR Labels IN (dor)");
  });

  it("nests parentheses for a group inside a group", () => {
    const text = describeFilters(
      {
        conditions: [
          { field: "labels", operator: "IN", value: ["auto"] },
          {
            type: "group",
            conditions: [
              { field: "labels", operator: "IN", value: ["dor"] },
              {
                type: "group",
                conditions: [
                  { field: "storyPoints", operator: "IS EMPTY", value: null },
                  { field: "originalEstimate", operator: "IS EMPTY", value: null },
                ],
                connectors: ["OR"],
              },
            ],
            connectors: ["AND"],
          },
        ],
        connectors: ["OR"],
      },
      statuses
    );
    expect(text).toBe(
      "Labels IN (auto) OR (Labels IN (dor) AND (Story Points IS EMPTY OR Original Estimate IS EMPTY))"
    );
  });
});

describe("JiraFilterEditor lazy metadata", () => {
  function LazyHarness({ onRequestStatuses, statusesLoading = false }: { onRequestStatuses: () => void; statusesLoading?: boolean }) {
    const [filters, setFilters] = useState<JiraImportFilters>({
      conditions: [{ field: "status", operator: "IN", value: [] }],
      connectors: [],
    });
    return (
      <JiraFilterEditor
        filters={filters}
        onChange={setFilters}
        statuses={statusesLoading ? [] : statuses}
        statusesLoading={statusesLoading}
        onRequestStatuses={onRequestStatuses}
        labels={["auto", "dor"]}
      />
    );
  }

  it("asks for statuses only when the picker is opened", () => {
    const onRequestStatuses = vi.fn();
    render(<LazyHarness onRequestStatuses={onRequestStatuses} />);

    expect(onRequestStatuses).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /pick statuses/ }));

    expect(onRequestStatuses).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "To Do" })).toBeTruthy();
  });

  it("shows the spinner inside the dropdown while statuses load", () => {
    render(<LazyHarness onRequestStatuses={vi.fn()} statusesLoading />);

    fireEvent.click(screen.getByRole("button", { name: /pick statuses/ }));

    expect(screen.getByRole("status").textContent).toContain("Loading statuses…");
    expect(screen.queryByPlaceholderText("Search statuses…")).toBeNull();
  });
});
