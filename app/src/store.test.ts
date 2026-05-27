// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  capabilitiesFor,
  compareReleaseVersions,
  computeStats,
  resolveAuthProviderSettings,
  validatePassword,
} from "./store.js";

describe("capabilitiesFor", () => {
  it("grants no capabilities to a user with no permissions", () => {
    const caps = capabilitiesFor({ permissions: [], roles: [] });
    expect(caps.canVote).toBe(false);
    expect(caps.canCreateRoom).toBe(false);
    expect(caps.canAccessAdmin).toBe(false);
  });

  it("grants vote when user has the vote permission", () => {
    const caps = capabilitiesFor({ permissions: ["vote"], roles: [] });
    expect(caps.canVote).toBe(true);
  });

  it("grants canCreateRoom when user has create_room permission", () => {
    const caps = capabilitiesFor({ permissions: ["create_room"], roles: [] });
    expect(caps.canCreateRoom).toBe(true);
  });

  it("grants canAccessAdmin when any admin permission is present", () => {
    const caps = capabilitiesFor({ permissions: ["manage_users"], roles: [] });
    expect(caps.canAccessAdmin).toBe(true);
  });

  it("grants canManageRoom when user can reveal votes", () => {
    const caps = capabilitiesFor({ permissions: ["reveal_votes"], roles: [] });
    expect(caps.canManageRoom).toBe(true);
  });

  it("grants canManageRoom when user can close poker", () => {
    const caps = capabilitiesFor({ permissions: ["close_poker"], roles: [] });
    expect(caps.canManageRoom).toBe(true);
  });

  it("returns false for all capabilities when user is null", () => {
    const caps = capabilitiesFor(null);
    expect(caps.canVote).toBe(false);
    expect(caps.canCreateRoom).toBe(false);
    expect(caps.canAccessAdmin).toBe(false);
  });

  it("grants canViewWorklog for worklog_view permission", () => {
    const caps = capabilitiesFor({ permissions: ["worklog_view"], roles: [] });
    expect(caps.canViewWorklog).toBe(true);
  });

  it("grants canImportJiraIssues for jira_import_issues permission", () => {
    const caps = capabilitiesFor({ permissions: ["jira_import_issues"], roles: [] });
    expect(caps.canImportJiraIssues).toBe(true);
  });

  it("grants canSendToJira for jira_send permission", () => {
    const caps = capabilitiesFor({ permissions: ["jira_send"], roles: [] });
    expect(caps.canSendToJira).toBe(true);
  });
});

describe("computeStats", () => {
  it("returns dashes and correct vote count for empty input", () => {
    const stats = computeStats([]);
    expect(stats.avg).toBe("-");
    expect(stats.median).toBe("-");
    expect(stats.votes).toBe(0);
  });

  it("ignores non-numeric values and counts all votes", () => {
    const stats = computeStats(["?", "☕", "skip"]);
    expect(stats.avg).toBe("-");
    expect(stats.median).toBe("-");
    expect(stats.votes).toBe(3);
  });

  it("computes average and median for a single value", () => {
    const stats = computeStats(["5"]);
    expect(stats.avg).toBe("5");
    expect(stats.median).toBe("5");
    expect(stats.votes).toBe(1);
  });

  it("computes average and median for odd-length array", () => {
    const stats = computeStats(["1", "3", "5"]);
    expect(stats.avg).toBe("3");
    expect(stats.median).toBe("3");
  });

  it("computes average and median for even-length array", () => {
    const stats = computeStats(["2", "4"]);
    expect(stats.avg).toBe("3");
    expect(stats.median).toBe("3");
  });

  it("strips trailing .0 from average", () => {
    const stats = computeStats(["4", "6"]);
    expect(stats.avg).toBe("5");
  });

  it("counts all votes including non-numeric ones", () => {
    const stats = computeStats(["5", "?", "8"]);
    expect(stats.votes).toBe(3);
  });

  it("handles mixed numeric and non-numeric values", () => {
    const stats = computeStats(["3", "?", "5"]);
    expect(stats.avg).toBe("4");
    expect(stats.median).toBe("4");
    expect(stats.votes).toBe(3);
  });
});

describe("validatePassword", () => {
  it("returns an error message when password is empty", () => {
    expect(validatePassword("", {})).toBe("New password is required");
  });

  it("returns an error when password is shorter than default minimum (8 chars)", () => {
    expect(validatePassword("short", {})).toBe("New password does not meet requirements");
  });

  it("returns null for a password that meets the default minimum", () => {
    expect(validatePassword("longenough", {})).toBeNull();
  });

  it("uses minimumPasswordLength setting", () => {
    expect(validatePassword("hii", { minimumPasswordLength: 3 })).toBeNull();
    expect(validatePassword("hi", { minimumPasswordLength: 3 })).toBe("New password does not meet requirements");
  });

  it("uses minPasswordLength as an alias", () => {
    expect(validatePassword("xy", { minPasswordLength: 3 })).toBe("New password does not meet requirements");
    expect(validatePassword("xyz", { minPasswordLength: 3 })).toBeNull();
  });

  it("returns an error when requirePasswordComplexity is true and uppercase is missing", () => {
    expect(validatePassword("password1!", { requirePasswordComplexity: true })).toBe("New password does not meet requirements");
  });

  it("returns an error when requirePasswordComplexity is true and lowercase is missing", () => {
    expect(validatePassword("PASSWORD1!", { requirePasswordComplexity: true })).toBe("New password does not meet requirements");
  });

  it("returns an error when requirePasswordComplexity is true and number is missing", () => {
    expect(validatePassword("Password!", { requirePasswordComplexity: true })).toBe("New password does not meet requirements");
  });

  it("returns an error when requirePasswordComplexity is true and special char is missing", () => {
    expect(validatePassword("Password1", { requirePasswordComplexity: true })).toBe("New password does not meet requirements");
  });

  it("returns null when all complexity requirements are met", () => {
    expect(validatePassword("Password1!", { requirePasswordComplexity: true })).toBeNull();
  });

  it("ignores complexity when requirePasswordComplexity is false", () => {
    expect(validatePassword("simplepw1", { requirePasswordComplexity: false })).toBeNull();
  });
});

describe("compareReleaseVersions", () => {
  it("returns 0 when both versions are invalid", () => {
    expect(compareReleaseVersions("invalid", "also-invalid")).toBe(0);
  });

  it("returns -1 when left version is invalid", () => {
    expect(compareReleaseVersions(null, "v1.0.0")).toBe(-1);
  });

  it("returns 1 when right version is invalid", () => {
    expect(compareReleaseVersions("v1.0.0", null)).toBe(1);
  });

  it("returns 0 for equal versions", () => {
    expect(compareReleaseVersions("v1.2.3", "v1.2.3")).toBe(0);
  });

  it("returns 1 when left is greater (patch)", () => {
    expect(compareReleaseVersions("v1.2.4", "v1.2.3")).toBe(1);
  });

  it("returns -1 when left is smaller (minor)", () => {
    expect(compareReleaseVersions("v1.1.0", "v1.2.0")).toBe(-1);
  });

  it("returns 1 when left has higher major version", () => {
    expect(compareReleaseVersions("v2.0.0", "v1.9.9")).toBe(1);
  });
});

describe("resolveAuthProviderSettings", () => {
  it("defaults to local auth enabled when no settings provided", () => {
    const settings = resolveAuthProviderSettings({});
    expect(settings.localAuthEnabled).toBe(true);
    expect(settings.activeDirectoryEnabled).toBe(false);
    expect(settings.entraAuthEnabled).toBe(false);
  });

  it("respects explicit localAuthEnabled: false", () => {
    const settings = resolveAuthProviderSettings({ localAuthEnabled: false });
    expect(settings.localAuthEnabled).toBe(false);
  });

  it("respects snake_case local_auth_enabled: true", () => {
    const settings = resolveAuthProviderSettings({ local_auth_enabled: true });
    expect(settings.localAuthEnabled).toBe(true);
  });

  it("respects activeDirectoryEnabled: true", () => {
    const settings = resolveAuthProviderSettings({ activeDirectoryEnabled: true });
    expect(settings.activeDirectoryEnabled).toBe(true);
  });

  it("maps legacy ssoMode 'Active Directory' to AD enabled, local disabled", () => {
    const settings = resolveAuthProviderSettings({ ssoMode: "Active Directory" });
    expect(settings.localAuthEnabled).toBe(false);
    expect(settings.activeDirectoryEnabled).toBe(true);
  });

  it("maps legacy ssoMode 'Active Directory + Local' to both enabled", () => {
    const settings = resolveAuthProviderSettings({ ssoMode: "Active Directory + Local" });
    expect(settings.localAuthEnabled).toBe(true);
    expect(settings.activeDirectoryEnabled).toBe(true);
  });

  it("respects entraAuthEnabled: true", () => {
    const settings = resolveAuthProviderSettings({ entraAuthEnabled: true });
    expect(settings.entraAuthEnabled).toBe(true);
  });

  it("explicit settings override legacy ssoMode", () => {
    const settings = resolveAuthProviderSettings({ ssoMode: "Active Directory", localAuthEnabled: true });
    expect(settings.localAuthEnabled).toBe(true);
  });
});
