import { describe, expect, it } from "vitest";

describe("RoomView import check", () => {
  it("can import RoomView without hanging", async () => {
    const mod = await import("./RoomView");
    expect(mod.RoomView).toBeTruthy();
  });
});
