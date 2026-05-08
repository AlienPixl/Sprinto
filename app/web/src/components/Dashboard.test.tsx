import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import type { Deck, RoomCategory, RoomSummary } from "../lib/types";

const decks: Deck[] = [
  { id: "deck-1", name: "Fibonacci", values: ["1", "2", "3", "5", "8"], isDefault: true, createdAt: "2026-01-01T00:00:00.000Z" },
];

const rooms: RoomSummary[] = [];

const categories: RoomCategory[] = [
  { id: "cat-1", name: "Sprint Planning", createdAt: "2026-05-01T00:00:00.000Z" },
  { id: "cat-2", name: "Backlog Refinement", createdAt: "2026-05-01T00:00:00.000Z" },
];

function renderDashboard(overrides: Partial<Parameters<typeof Dashboard>[0]> = {}) {
  const onCreateRoom = vi.fn().mockResolvedValue(undefined);
  render(
    <Dashboard
      rooms={rooms}
      decks={decks}
      canCreateRoom={true}
      onOpenRoom={vi.fn()}
      onCreateRoom={onCreateRoom}
      {...overrides}
    />
  );
  return { onCreateRoom };
}

describe("Dashboard", () => {
  it("does not show category dropdown when roomCategoriesEnabled is false", () => {
    renderDashboard({ roomCategoriesEnabled: false, roomCategories: categories });
    expect(screen.queryByText("Category")).toBeNull();
  });

  it("shows category dropdown with unspecified option when roomCategoriesEnabled is true", () => {
    renderDashboard({ roomCategoriesEnabled: true, roomCategories: categories });
    expect(screen.getByText("Category")).toBeTruthy();
    expect(screen.getByRole("option", { name: "— unspecified —" })).toBeTruthy();
    expect(screen.getAllByRole("option", { name: "Sprint Planning" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: "Backlog Refinement" }).length).toBeGreaterThan(0);
  });

  it("shows required label when roomCategoryRequired is true", () => {
    renderDashboard({ roomCategoriesEnabled: true, roomCategoryRequired: true, roomCategories: categories });
    expect(screen.getByText("(required)")).toBeTruthy();
  });

  it("does not show required label when roomCategoryRequired is false", () => {
    renderDashboard({ roomCategoriesEnabled: true, roomCategoryRequired: false, roomCategories: categories });
    expect(screen.queryByText("(required)")).toBeNull();
  });

  it("calls onCreateRoom with empty categoryId when no category is selected and not required", async () => {
    const { onCreateRoom } = renderDashboard({ roomCategoriesEnabled: true, roomCategories: categories, roomCategoryRequired: false });
    const nameInput = screen.getByPlaceholderText("Sprint 24");
    fireEvent.change(nameInput, { target: { value: "My Room" } });

    await act(async () => {
      fireEvent.submit(nameInput.closest("form")!);
    });

    expect(onCreateRoom).toHaveBeenCalledWith("My Room", "Fibonacci", "");
  });

  it("calls onCreateRoom with selected categoryId", async () => {
    const { onCreateRoom } = renderDashboard({ roomCategoriesEnabled: true, roomCategories: categories });
    const nameInput = screen.getByPlaceholderText("Sprint 24");
    fireEvent.change(nameInput, { target: { value: "My Room" } });

    const select = screen.getByRole("combobox", { name: /category/i });
    fireEvent.change(select, { target: { value: "cat-1" } });

    await act(async () => {
      fireEvent.submit(nameInput.closest("form")!);
    });

    expect(onCreateRoom).toHaveBeenCalledWith("My Room", "Fibonacci", "cat-1");
  });

  it("does not call onCreateRoom when category is required but not selected", async () => {
    const { onCreateRoom } = renderDashboard({ roomCategoriesEnabled: true, roomCategoryRequired: true, roomCategories: categories });
    const nameInput = screen.getByPlaceholderText("Sprint 24");
    fireEvent.change(nameInput, { target: { value: "My Room" } });

    await act(async () => {
      fireEvent.submit(nameInput.closest("form")!);
    });

    expect(onCreateRoom).not.toHaveBeenCalled();
  });

  it("calls onCreateRoom without category when categories are disabled", async () => {
    const { onCreateRoom } = renderDashboard({ roomCategoriesEnabled: false, roomCategories: categories });
    const nameInput = screen.getByPlaceholderText("Sprint 24");
    fireEvent.change(nameInput, { target: { value: "My Room" } });

    await act(async () => {
      fireEvent.submit(nameInput.closest("form")!);
    });

    expect(onCreateRoom).toHaveBeenCalledWith("My Room", "Fibonacci", "");
  });
});
