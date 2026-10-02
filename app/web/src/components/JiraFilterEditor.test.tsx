import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import JiraFilterEditor, { describeFilters } from "./JiraFilterEditor";
import type { JiraImportFilters, JiraStatus } from "../lib/types";

const statuses: JiraStatus[] = [
  { id: "10", name: "To Do" },
  { id: "99", name: "Done" },
];

function Harness({ initial, allowEmptyRoot }: { initial: JiraImportFilters; allowEmptyRoot?: boolean }) {
  const [filters, setFilters] = useState<JiraImportFilters>(initial);
  return (
    <>
      <JiraFilterEditor
        filters={filters}
        onChange={setFilters}
        statuses={statuses}
        labels={["auto", "dor"]}
        allowEmptyRoot={allowEmptyRoot}
      />
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

  it("lets the last root condition be removed when allowEmptyRoot is set", () => {
    render(<Harness initial={singleCondition} allowEmptyRoot />);

    fireEvent.click(screen.getByLabelText("Remove condition"));

    const filters = currentFilters();
    expect(filters.conditions).toEqual([]);
    expect(filters.connectors).toEqual([]);
    expect(screen.getByText("No rules — every issue in the import scope will be imported.")).toBeTruthy();
  });

  it("keeps the remove button on every remaining root condition while emptying out, with allowEmptyRoot", () => {
    render(
      <Harness
        initial={{
          conditions: [
            { field: "storyPoints", operator: "IS EMPTY", value: null },
            { field: "labels", operator: "IN", value: ["dor"] },
          ],
          connectors: ["AND"],
        }}
        allowEmptyRoot
      />
    );

    let removeButtons = screen.getAllByLabelText("Remove condition");
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);

    expect(currentFilters().conditions).toEqual([{ field: "labels", operator: "IN", value: ["dor"] }]);
    removeButtons = screen.getAllByLabelText("Remove condition");
    expect(removeButtons).toHaveLength(1);

    fireEvent.click(removeButtons[0]);
    expect(currentFilters().conditions).toEqual([]);
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

describe("JiraFilterEditor status grouping", () => {
  // One shared status plus two team-managed copies, all named "Done".
  const scopedStatuses: JiraStatus[] = [
    { id: "1", name: "To Do", projects: [{ key: "OPS", name: "Operations" }, { key: "WEB", name: "Web" }] },
    { id: "10001", name: "Done", projects: [{ key: "OPS", name: "Operations" }, { key: "WEB", name: "Web" }] },
    { id: "13413", name: "Done", projects: [{ key: "MKT", name: "Marketing" }] },
    { id: "13417", name: "Done", projects: [{ key: "SUP", name: "Support" }] },
  ];

  function renderPicker(statusList: JiraStatus[]) {
    render(
      <JiraFilterEditor
        filters={{ conditions: [{ field: "status", operator: "IN", value: [] }], connectors: [] }}
        onChange={() => {}}
        statuses={statusList}
        labels={[]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Select statuses|statuses/ }));
  }

  it("puts a project-owned status under its project heading", () => {
    renderPicker(scopedStatuses);

    expect(screen.getByRole("heading", { name: "Marketing" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Support" })).toBeTruthy();
  });

  it("collects statuses shared by several projects into one heading", () => {
    renderPicker(scopedStatuses);

    expect(screen.getByRole("heading", { name: "Shared across projects" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Web" })).toBeNull();
  });

  it("marks a duplicated status name with the project that owns it", () => {
    renderPicker(scopedStatuses);

    expect(screen.getByRole("button", { name: "Done Marketing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done Support" })).toBeTruthy();
    // "To Do" is unique, so it needs no extra wording.
    expect(screen.getByRole("button", { name: "To Do" })).toBeTruthy();
  });

  it("keeps the flat list when no status carries project information", () => {
    renderPicker([{ id: "10", name: "To Do" }, { id: "99", name: "Done" }]);

    expect(screen.queryByRole("heading", { name: "Shared across projects" })).toBeNull();
    expect(screen.getByRole("button", { name: "To Do" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("names the owning project in the rule summary of a duplicated status", () => {
    const summary = describeFilters(
      { conditions: [{ field: "status", operator: "IN", value: ["13413", "1"] }], connectors: [] },
      scopedStatuses
    );

    expect(summary).toContain("Done (Marketing)");
    // Unique names stay clean.
    expect(summary).toContain("To Do");
    expect(summary).not.toContain("To Do (");
  });
});

describe("JiraFilterEditor evaluation summary", () => {
  const cond = (value: string) => ({ field: "status" as const, operator: "IN" as const, value: [value] });

  it("spells out the real grouping when AND and OR are mixed", () => {
    // Conditions are evaluated strictly left to right, with no operator precedence,
    // so "A OR B AND C" means "(A OR B) AND C" and must not read otherwise.
    const summary = describeFilters(
      { conditions: [cond("10"), cond("99"), cond("10")], connectors: ["OR", "AND"] },
      statuses
    );

    expect(summary.startsWith("(")).toBe(true);
    expect(summary).toContain(") AND ");
  });

  it("leaves an unmixed chain alone", () => {
    const summary = describeFilters(
      { conditions: [cond("10"), cond("99"), cond("10")], connectors: ["AND", "AND"] },
      statuses
    );

    expect(summary).not.toContain("(Status");
    expect(summary.split(" AND ")).toHaveLength(3);
  });

  it("nests the parentheses left to right across a longer mixed chain", () => {
    const summary = describeFilters(
      { conditions: [cond("10"), cond("99"), cond("10"), cond("99")], connectors: ["AND", "OR", "AND"] },
      statuses
    );

    expect(summary.startsWith("((")).toBe(true);
  });
});

describe("JiraFilterEditor reordering", () => {
  const twoConditions: JiraImportFilters = {
    conditions: [
      { field: "storyPoints", operator: "IS EMPTY", value: null },
      { field: "labels", operator: "IN", value: ["dor"] },
    ],
    connectors: ["AND"],
  };

  it("moves a condition towards the front", () => {
    render(<Harness initial={twoConditions} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);

    const filters = currentFilters();
    expect(filters.conditions[0]).toEqual({ field: "labels", operator: "IN", value: ["dor"] });
    expect(filters.conditions[1]).toEqual({ field: "storyPoints", operator: "IS EMPTY", value: null });
  });

  it("moves a condition towards the back", () => {
    render(<Harness initial={twoConditions} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);

    const filters = currentFilters();
    expect(filters.conditions[0]).toEqual({ field: "labels", operator: "IN", value: ["dor"] });
  });

  it("leaves the AND/OR pattern in place when a condition moves", () => {
    render(
      <Harness
        initial={{
          conditions: [
            { field: "storyPoints", operator: "IS EMPTY", value: null },
            { field: "labels", operator: "IN", value: ["dor"] },
            { field: "status", operator: "IN", value: ["99"] },
          ],
          connectors: ["OR", "AND"],
        }}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);

    // The row moves through the expression; the shape of the expression stays.
    expect(currentFilters().connectors).toEqual(["OR", "AND"]);
  });

  it("offers no way to move the first condition up or the last one down", () => {
    render(<Harness initial={twoConditions} />);

    const up = screen.getAllByRole("button", { name: "Move up" }) as HTMLButtonElement[];
    const down = screen.getAllByRole("button", { name: "Move down" }) as HTMLButtonElement[];

    expect(up[0].disabled).toBe(true);
    expect(down[down.length - 1].disabled).toBe(true);
  });

  it("does not offer reordering for a lone condition", () => {
    render(<Harness initial={singleCondition} />);

    expect(screen.queryByRole("button", { name: "Move up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move down" })).toBeNull();
  });
});
