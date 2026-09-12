import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LazyPicker } from "./LazyPicker";

function renderPicker(overrides: Partial<Parameters<typeof LazyPicker>[0]> = {}) {
  const props = {
    value: "",
    options: [{ id: "1", name: "Alpha board" }, { id: "2", name: "Beta board" }],
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    loading: false,
    placeholder: "Select board",
    emptyText: "No boards available",
    ...overrides,
  };
  return { props, ...render(<LazyPicker {...props} />) };
}

describe("LazyPicker", () => {
  it("does not request options until the dropdown is opened", () => {
    const { props } = renderPicker({ options: [] });

    expect(props.onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Select board" }));

    expect(props.onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("shows the loading state inside the open dropdown and hides the options", () => {
    renderPicker({ loading: true, loadingText: "Loading boards…" });

    fireEvent.click(screen.getByRole("button", { name: "Select board" }));

    expect(screen.getByRole("status").textContent).toContain("Loading boards…");
    expect(screen.queryByRole("option", { name: /Alpha board/ })).toBeNull();
  });

  it("lists the options once loading finishes", () => {
    const { props } = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Select board" }));
    fireEvent.click(screen.getByRole("option", { name: /Beta board/ }));

    expect(props.onSelect).toHaveBeenCalledWith("2");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("offers a retry when loading failed", () => {
    const onRetry = vi.fn();
    renderPicker({ options: [], error: "Jira is unreachable", onRetry });

    fireEvent.click(screen.getByRole("button", { name: "Select board" }));
    expect(screen.getByText("Jira is unreachable")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("filters the loaded options without touching Jira again", () => {
    const { props } = renderPicker({ searchPlaceholder: "Search boards…" });

    fireEvent.click(screen.getByRole("button", { name: "Select board" }));
    fireEvent.change(screen.getByPlaceholderText("Search boards…"), { target: { value: "beta" } });

    expect(screen.queryByRole("option", { name: /Alpha board/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Beta board/ })).toBeTruthy();
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it("stays closed while disabled", () => {
    const { props } = renderPicker({ disabled: true, disabledText: "Select a board first" });

    fireEvent.click(screen.getByRole("button", { name: "Select a board first" }));

    expect(props.onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("LazyPicker retry offer", () => {
  function openWithError(overrides: Record<string, unknown>) {
    renderPicker({ options: [], error: "Something went wrong.", onRetry: vi.fn(), ...overrides });
    fireEvent.click(screen.getByRole("button", { name: /Select board/ }));
  }

  it("offers a retry for a failure that might pass", () => {
    openWithError({ canRetry: true });

    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("hides the retry when trying again could never help", () => {
    openWithError({
      canRetry: false,
      error: "Jira rejected the service account. Ask an administrator to check the account email and API token in the Jira integration settings.",
    });

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    // The advice must still be readable.
    expect(screen.getByText(/Ask an administrator/)).toBeTruthy();
  });

  it("keeps offering a retry when nothing says otherwise", () => {
    openWithError({});

    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
