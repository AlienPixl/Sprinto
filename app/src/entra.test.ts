import { describe, expect, it } from "vitest";
import {
  createEntraLoginRequest,
  isEntraGroupOverage,
  resolveEntraIdentityFromClaims,
  resolveEntraLogoutUrl,
  resolveEntraPostLoginRedirectUrl,
  resolveEntraRedirectUri,
  sanitizeEntraReturnToPath,
  validateEntraSettings,
} from "./entra.js";

const baseSettings = {
  publicBaseUrl: "https://sprinto.example.com",
  entraTenantId: "tenant-id",
  entraClientId: "client-id",
  entraClientSecret: "client-secret",
  entraClientSecretConfigured: true,
};

describe("Microsoft Entra helpers", () => {
  it("validates the required Microsoft Entra settings", () => {
    expect(validateEntraSettings(baseSettings)).toMatchObject({
      tenantId: "tenant-id",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://sprinto.example.com/api/auth/entra/callback",
    });

    expect(() => validateEntraSettings({ ...baseSettings, publicBaseUrl: "" })).toThrow("Microsoft Entra requires Public base URL.");
    expect(() => validateEntraSettings({ ...baseSettings, entraTenantId: "" })).toThrow("Tenant ID is missing");
    expect(() => validateEntraSettings({ ...baseSettings, entraClientId: "" })).toThrow("Client ID is missing");
    expect(() => validateEntraSettings({ ...baseSettings, entraClientSecret: "", entraClientSecretConfigured: false })).toThrow("Client secret is missing");
  });

  it("builds a login request with PKCE and a sanitized return path", () => {
    const request = createEntraLoginRequest(baseSettings, "https://sprinto.example.com/admin?authError=old");
    const authorizationUrl = new URL(request.authorizationUrl);

    expect(authorizationUrl.origin).toBe("https://login.microsoftonline.com");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("client-id");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("https://sprinto.example.com/api/auth/entra/callback");
    expect(authorizationUrl.searchParams.get("scope")).toContain("GroupMember.Read.All");
    expect(request.state).not.toHaveLength(0);
    expect(request.nonce).not.toHaveLength(0);
    expect(request.codeVerifier).not.toHaveLength(0);
    expect(request.returnToPath).toBe("/admin?authError=old");
  });

  it("normalizes callback redirects and removes stale auth errors on success", () => {
    expect(resolveEntraRedirectUri(baseSettings)).toBe("https://sprinto.example.com/api/auth/entra/callback");
    expect(resolveEntraPostLoginRedirectUrl(baseSettings, "/rooms/abc?authError=old")).toBe("https://sprinto.example.com/rooms/abc");
    expect(resolveEntraPostLoginRedirectUrl(baseSettings, "/rooms/abc", "Microsoft Entra failed")).toContain("authError=Microsoft+Entra+failed");
    expect(sanitizeEntraReturnToPath("/api/auth/entra/callback")).toBe("/");
    expect(sanitizeEntraReturnToPath("relative-only")).toBe("/");
  });

  it("builds a Microsoft logout URL that returns back to Sprinto", () => {
    const logoutUrl = new URL(resolveEntraLogoutUrl(baseSettings, "/"));
    expect(logoutUrl.origin).toBe("https://login.microsoftonline.com");
    expect(logoutUrl.pathname).toContain("/oauth2/v2.0/logout");
    expect(logoutUrl.searchParams.get("post_logout_redirect_uri")).toBe("https://sprinto.example.com/");
  });

  it("extracts identity and role hints from Entra claims", () => {
    expect(isEntraGroupOverage({ _claim_names: { groups: "src1" } })).toBe(true);

    const identity = resolveEntraIdentityFromClaims({
      oid: "entra-object-id",
      tid: "tenant-id",
      email: "user@example.com",
      preferred_username: "user@example.com",
      name: "User Example",
      roles: ["Sprinto.Admin", "Sprinto.Admin"],
      groups: ["GROUP-1", "group-1", "group-2"],
    });

    expect(identity).toEqual({
      externalId: "entra-object-id",
      tenantId: "tenant-id",
      username: "user@example.com",
      displayName: "User Example",
      email: "user@example.com",
      appRoleValues: ["sprinto.admin"],
      groupIds: ["group-1", "group-2"],
      groupsOverage: false,
    });
  });
});
