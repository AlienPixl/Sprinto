import { beforeEach, describe, expect, it } from "vitest";
import { normalizeTheme, readStoredThemePreference, THEME_STORAGE_KEY } from "./theme";

describe("normalizeTheme", () => {
  it("returns 'glow' for the 'glow' value", () => {
    expect(normalizeTheme("glow")).toBe("glow");
  });

  it("returns 'glow' for legacy 'timero' value", () => {
    expect(normalizeTheme("timero")).toBe("glow");
  });

  it("returns 'sprinto' for the 'sprinto' value", () => {
    expect(normalizeTheme("sprinto")).toBe("sprinto");
  });

  it("returns 'sprinto' for an unknown string", () => {
    expect(normalizeTheme("classic")).toBe("sprinto");
  });

  it("returns 'sprinto' for null", () => {
    expect(normalizeTheme(null)).toBe("sprinto");
  });

  it("returns 'sprinto' for undefined", () => {
    expect(normalizeTheme(undefined)).toBe("sprinto");
  });

  it("returns 'sprinto' for an empty string", () => {
    expect(normalizeTheme("")).toBe("sprinto");
  });
});

describe("readStoredThemePreference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns 'sprinto' when nothing is stored", () => {
    expect(readStoredThemePreference()).toBe("sprinto");
  });

  it("returns 'glow' when 'glow' is stored", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "glow");
    expect(readStoredThemePreference()).toBe("glow");
  });

  it("returns 'sprinto' when an unknown value is stored", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "unknown");
    expect(readStoredThemePreference()).toBe("sprinto");
  });

  it("returns 'glow' for legacy 'timero' stored value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "timero");
    expect(readStoredThemePreference()).toBe("glow");
  });
});
