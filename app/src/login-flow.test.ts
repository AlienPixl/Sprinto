import { describe, expect, it, vi } from "vitest";
import {
  hasEnabledAuthProvider,
  hasPasswordAuthProvider,
  isActiveDirectoryEnabled,
  isEntraAuthEnabled,
  isLocalAuthEnabled,
  resolveAuthenticatedUser,
} from "./login-flow.js";

describe("login flow", () => {
  it("allows the recovery admin to sign in before any external provider check", async () => {
    const authenticateRecoveryUser = vi.fn().mockResolvedValue({ id: "system-1", authSource: "system" });
    const authenticateDirectoryUser = vi.fn().mockRejectedValue(new Error("Directory unavailable"));
    const authenticateLocalUser = vi.fn().mockResolvedValue(null);

    const user = await resolveAuthenticatedUser({
      identifier: "recovery",
      password: "secret",
      method: "username",
      settings: { localAuthEnabled: false, activeDirectoryEnabled: true },
      authenticateRecoveryUser,
      authenticateDirectoryUser,
      authenticateLocalUser,
    });

    expect(user).toEqual({ id: "system-1", authSource: "system" });
    expect(authenticateDirectoryUser).not.toHaveBeenCalled();
    expect(authenticateLocalUser).not.toHaveBeenCalled();
  });

  it("falls back to local login when mixed mode is enabled and Active Directory fails", async () => {
    const authenticateRecoveryUser = vi.fn().mockResolvedValue(null);
    const authenticateDirectoryUser = vi.fn().mockRejectedValue(new Error("Directory unavailable"));
    const authenticateLocalUser = vi.fn().mockResolvedValue({ id: "local-1", authSource: "local" });

    const user = await resolveAuthenticatedUser({
      identifier: "alice",
      password: "secret",
      method: "username",
      settings: { localAuthEnabled: true, activeDirectoryEnabled: true },
      authenticateRecoveryUser,
      authenticateDirectoryUser,
      authenticateLocalUser,
    });

    expect(user).toEqual({ id: "local-1", authSource: "local" });
    expect(authenticateDirectoryUser).toHaveBeenCalledTimes(1);
    expect(authenticateLocalUser).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to local login when only Microsoft Active Directory is enabled", async () => {
    const authenticateRecoveryUser = vi.fn().mockResolvedValue(null);
    const authenticateDirectoryUser = vi.fn().mockRejectedValue(new Error("Directory unavailable"));
    const authenticateLocalUser = vi.fn().mockResolvedValue({ id: "local-1", authSource: "local" });

    await expect(
      resolveAuthenticatedUser({
        identifier: "alice",
        password: "secret",
        method: "username",
        settings: { localAuthEnabled: false, activeDirectoryEnabled: true },
        authenticateRecoveryUser,
        authenticateDirectoryUser,
        authenticateLocalUser,
      }),
    ).rejects.toThrow("Directory unavailable");

    expect(authenticateLocalUser).not.toHaveBeenCalled();
  });

  it("uses only local login when Microsoft Active Directory is disabled", async () => {
    const authenticateRecoveryUser = vi.fn().mockResolvedValue(null);
    const authenticateDirectoryUser = vi.fn().mockResolvedValue(null);
    const authenticateLocalUser = vi.fn().mockResolvedValue({ id: "local-1", authSource: "local" });

    const user = await resolveAuthenticatedUser({
      identifier: "alice",
      password: "secret",
      method: "username",
      settings: { localAuthEnabled: true, activeDirectoryEnabled: false },
      authenticateRecoveryUser,
      authenticateDirectoryUser,
      authenticateLocalUser,
    });

    expect(user).toEqual({ id: "local-1", authSource: "local" });
    expect(authenticateDirectoryUser).not.toHaveBeenCalled();
    expect(authenticateLocalUser).toHaveBeenCalledTimes(1);
  });
});

describe("auth provider settings compatibility", () => {
  it("maps legacy ssoMode values to the new provider toggles", () => {
    expect(isLocalAuthEnabled({ ssoMode: "Local" })).toBe(true);
    expect(isActiveDirectoryEnabled({ ssoMode: "Local" })).toBe(false);

    expect(isLocalAuthEnabled({ ssoMode: "Active Directory" })).toBe(false);
    expect(isActiveDirectoryEnabled({ ssoMode: "Active Directory" })).toBe(true);

    expect(isLocalAuthEnabled({ ssoMode: "Active Directory + Local" })).toBe(true);
    expect(isActiveDirectoryEnabled({ ssoMode: "Active Directory + Local" })).toBe(true);
  });

  it("rejects configurations where both providers are disabled", () => {
    expect(hasEnabledAuthProvider({ localAuthEnabled: false, activeDirectoryEnabled: false, entraAuthEnabled: false })).toBe(false);
    expect(hasEnabledAuthProvider({ localAuthEnabled: true, activeDirectoryEnabled: false })).toBe(true);
    expect(hasEnabledAuthProvider({ localAuthEnabled: false, activeDirectoryEnabled: true })).toBe(true);
    expect(hasEnabledAuthProvider({ localAuthEnabled: false, activeDirectoryEnabled: false, entraAuthEnabled: true })).toBe(true);
    expect(hasPasswordAuthProvider({ localAuthEnabled: false, activeDirectoryEnabled: false, entraAuthEnabled: true })).toBe(false);
    expect(isEntraAuthEnabled({ entraAuthEnabled: true })).toBe(true);
  });
});
