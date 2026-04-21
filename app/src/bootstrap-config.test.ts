import { describe, expect, it } from "vitest";
import { readBootstrapConfig, shouldSeedDemoData, validateBootstrapConfig } from "./bootstrap-config.js";

describe("bootstrap config", () => {
  it("reads compose flags and recovery credentials from the environment", () => {
    const config = readBootstrapConfig({
      SPRINTO_SEED_DEMO_DATA: "true",
      SPRINTO_RECOVERY_ADMIN_ENABLED: "yes",
      SPRINTO_RECOVERY_ADMIN_USERNAME: "recovery",
      SPRINTO_RECOVERY_ADMIN_PASSWORD: "top-secret",
      SPRINTO_RECOVERY_ADMIN_DISPLAY_NAME: "Break Glass",
    });

    expect(config).toEqual({
      seedDemoData: true,
      recoveryAdminEnabled: true,
      recoveryAdminUsername: "recovery",
      recoveryAdminPassword: "top-secret",
      recoveryAdminDisplayName: "Break Glass",
    });
  });

  it("rejects an empty installation without demo seed data or a recovery admin", () => {
    const errors = validateBootstrapConfig(
      {
        seedDemoData: false,
        recoveryAdminEnabled: false,
        recoveryAdminUsername: "",
        recoveryAdminPassword: "",
        recoveryAdminDisplayName: "System Recovery Admin",
      },
      { initialUserCount: 0 },
    );

    expect(errors).toContain("Sprinto cannot start an empty installation without either demo seed data or a configured recovery admin.");
  });

  it("requires recovery credentials when recovery admin is enabled", () => {
    const errors = validateBootstrapConfig(
      {
        seedDemoData: false,
        recoveryAdminEnabled: true,
        recoveryAdminUsername: "recovery",
        recoveryAdminPassword: "",
        recoveryAdminDisplayName: "System Recovery Admin",
      },
      { initialUserCount: 0 },
    );

    expect(errors).toContain("Recovery admin is enabled but SPRINTO_RECOVERY_ADMIN_PASSWORD is missing.");
  });

  it("rejects recovery usernames that collide with demo users", () => {
    const errors = validateBootstrapConfig(
      {
        seedDemoData: true,
        recoveryAdminEnabled: true,
        recoveryAdminUsername: "admin",
        recoveryAdminPassword: "secret",
        recoveryAdminDisplayName: "System Recovery Admin",
      },
      { initialUserCount: 0 },
    );

    expect(errors).toContain("The recovery admin username cannot reuse a built-in demo username when demo seed data is enabled.");
  });

  it("seeds demo data only once on an empty installation", () => {
    const config = {
      seedDemoData: true,
      recoveryAdminEnabled: true,
      recoveryAdminUsername: "recovery",
      recoveryAdminPassword: "secret",
      recoveryAdminDisplayName: "System Recovery Admin",
    };

    expect(shouldSeedDemoData(config, { initialUserCount: 0, demoSeeded: false })).toBe(true);
    expect(shouldSeedDemoData(config, { initialUserCount: 0, demoSeeded: true })).toBe(false);
    expect(shouldSeedDemoData(config, { initialUserCount: 3, demoSeeded: false })).toBe(false);
  });
});
