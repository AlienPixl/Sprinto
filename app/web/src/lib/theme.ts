import { ThemeId } from "./types";

export const THEME_STORAGE_KEY = "sprinto.theme";

export const THEME_OPTIONS: Array<{ value: ThemeId; label: string }> = [
  {
    value: "sprinto",
    label: "Sprinto Classic"
  },
  {
    value: "timero",
    label: "Sprinto Glow"
  }
];

export function normalizeTheme(value: unknown): ThemeId {
  return value === "timero" ? "timero" : "sprinto";
}

export function readStoredThemePreference(): ThemeId {
  if (typeof window === "undefined") {
    return "sprinto";
  }
  return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}
