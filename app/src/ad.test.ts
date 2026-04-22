import { describe, expect, it } from "vitest";
import { validateActiveDirectorySettings } from "./ad.js";

const baseSettings = {
  adServerUrl: "ldap://ad.company.local",
  adBaseDn: "DC=company,DC=local",
  adBindUsername: "sprinto@company.local",
  adBindPassword: "secret",
  adLoginAttribute: "sAMAccountName",
  adEmailAttribute: "mail",
  adDisplayNameAttribute: "displayName",
  adExternalIdAttribute: "objectGUID",
};

describe("Active Directory helpers", () => {
  it("validates the required Active Directory save settings without forcing attribute overrides", () => {
    expect(() => validateActiveDirectorySettings(baseSettings, { requireAttributes: false })).not.toThrow();
    expect(() => validateActiveDirectorySettings({ ...baseSettings, adServerUrl: "" }, { requireAttributes: false })).toThrow(
      "Active Directory is not fully configured. Missing Server / URL.",
    );
    expect(() => validateActiveDirectorySettings({ ...baseSettings, adBindPassword: "" }, { requireAttributes: false })).toThrow(
      "Active Directory is not fully configured. Missing Bind password.",
    );
    expect(() => validateActiveDirectorySettings({ ...baseSettings, adLoginAttribute: "" }, { requireAttributes: false })).not.toThrow();
  });

  it("still requires attribute mappings for runtime directory operations", () => {
    expect(() => validateActiveDirectorySettings(baseSettings)).not.toThrow();
    expect(() => validateActiveDirectorySettings({ ...baseSettings, adLoginAttribute: "" })).toThrow(
      "Active Directory is not fully configured. Missing Login attribute.",
    );
  });
});
