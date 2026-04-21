import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminPanel } from "./AdminPanel";
import type { AdminOverview, SettingsOverview, User } from "../lib/types";

const baseSettings: SettingsOverview = {
  requireStoryId: false,
  defaultDeck: "deck-1",
  defaultTimerSeconds: 180,
  httpsEnabled: false,
  tlsCertPath: "",
  tlsKeyPath: "",
  trustProxy: false,
  publicBaseUrl: "",
  updatesEnabled: true,
  updateLastCheckedAt: null,
  updateLatestVersion: "",
  updateLatestReleaseUrl: "",
  updateCheckError: "",
  currentVersion: "v1.0.0",
  updateAvailable: false,
  localAuthEnabled: true,
  activeDirectoryEnabled: false,
  entraAuthEnabled: false,
  entraMigrationEnabled: true,
  entraGlobalLogoutEnabled: false,
  entraMigrationPromptLoginCount: 3,
  entraMigrationForceAtDefault: "",
  loginMethod: "username",
  minPasswordLength: 8,
  requirePasswordComplexity: false,
  adServerUrl: "",
  adServerPort: 389,
  adConnectionSecurity: "ldap",
  adBaseDn: "",
  adBindUsername: "",
  adBindPassword: "",
  adLoginAttribute: "sAMAccountName",
  adEmailAttribute: "mail",
  adDisplayNameAttribute: "displayName",
  adExternalIdAttribute: "objectGUID",
  adAvatarAttribute: "thumbnailPhoto",
  adCaCertificate: "",
  adAllowUntrustedCertificate: false,
  entraTenantId: "",
  entraClientId: "",
  entraClientSecret: "",
  entraClientSecretConfigured: false,
  logoDataUrl: "",
  faviconDataUrl: "",
  integrations: {
    jira: {
      enabled: false,
      baseUrl: "",
      serviceAccountEmail: "",
      apiToken: "",
      apiTokenConfigured: false,
      offerKanbanBoards: false,
      writeStoryPointsEnabled: false,
      writeOriginalEstimateEnabled: false,
      writeAssigneeEnabled: false,
      originalEstimateMode: "multiplied-story-points",
      originalEstimateMinutesPerStoryPoint: 30,
      postCommentEnabled: true,
      postPdfEnabled: true,
    },
  },
  scheduledTasks: {
    autoAnonymizeDeactivatedUsers: {
      enabled: false,
      frequency: "daily",
      intervalMinutes: 15,
      time: "02:00",
      weekdays: [],
      weeklyWeekday: "monday",
      weekOfMonth: 1,
      monthlyDay: 1,
      yearlyMonth: 1,
      yearlyDay: 1,
      anonymizeAfterValue: 30,
      anonymizeAfterUnit: "days",
      anonymizeAfterDays: 30,
      lastRunAt: null,
      nextRunAt: null,
    },
    autoCloseRooms: {
      enabled: false,
      frequency: "daily",
      intervalMinutes: 15,
      time: "03:00",
      weekdays: [],
      weeklyWeekday: "monday",
      weekOfMonth: 1,
      monthlyDay: 1,
      yearlyMonth: 1,
      yearlyDay: 1,
      closeAfterValue: 30,
      closeAfterUnit: "days",
      closeAfterDays: 30,
      roomStatuses: ["open", "voting", "revealed"],
      lastRunAt: null,
      nextRunAt: null,
    },
    autoCloseInactiveSessions: {
      enabled: false,
      frequency: "daily",
      intervalMinutes: 15,
      time: "04:00",
      weekdays: [],
      weeklyWeekday: "monday",
      weekOfMonth: 1,
      monthlyDay: 1,
      yearlyMonth: 1,
      yearlyDay: 1,
      closeAfterValue: 30,
      closeAfterUnit: "days",
      closeAfterDays: 30,
      lastRunAt: null,
      nextRunAt: null,
    },
    syncActiveDirectoryUsers: {
      enabled: false,
      frequency: "daily",
      intervalMinutes: 15,
      time: "01:00",
      weekdays: [],
      weeklyWeekday: "monday",
      weekOfMonth: 1,
      monthlyDay: 1,
      yearlyMonth: 1,
      yearlyDay: 1,
      lastRunAt: null,
      nextRunAt: null,
    },
    checkForUpdates: {
      enabled: false,
      frequency: "daily",
      intervalMinutes: 15,
      time: "05:00",
      weekdays: [],
      weeklyWeekday: "monday",
      weekOfMonth: 1,
      monthlyDay: 1,
      yearlyMonth: 1,
      yearlyDay: 1,
      lastRunAt: null,
      nextRunAt: null,
    },
  },
};

const adminUser: User = {
  id: "admin-1",
  username: "admin",
  displayName: "Admin",
  email: "admin@sprinto.local",
  authSource: "local",
  isSystemManaged: false,
  externalId: "",
  entraLinked: false,
  entraMigrationState: "",
  entraMigrationPreparedAt: null,
  entraMigrationPreparedByUserId: "",
  entraMigrationPromptCount: 0,
  entraMigrationForceAt: null,
  isActive: true,
  deactivatedUsername: "",
  deactivatedAt: null,
  anonymizedAt: null,
  avatarDataUrl: "",
  avatarManagedByDirectory: false,
  avatarManagedByAuthSource: "",
  theme: "sprinto",
  roles: ["admin"],
  permissions: [
    "manage_users",
    "manage_roles",
    "manage_settings",
    "manage_integrations",
    "manage_room_settings",
    "manage_decks",
    "manage_sessions",
    "manage_audit_logs",
    "manage_scheduled_tasks",
    "manage_updates",
  ],
  lastLoginAt: "2026-04-13T10:00:00.000Z",
};

const recoveryUser: User = {
  ...adminUser,
  id: "system-1",
  username: "recovery",
  displayName: "System Recovery Admin",
  email: "recovery@sprinto.system",
  authSource: "system",
  isSystemManaged: true,
};

const migratableLocalUser: User = {
  ...adminUser,
  id: "local-2",
  username: "jana",
  displayName: "Jana",
  email: "jana@example.com",
  roles: ["user"],
};

const deactivatedEntraUser: User = {
  ...adminUser,
  id: "entra-2",
  username: "entra.user",
  displayName: "Entra User",
  email: "entra.user@example.com",
  authSource: "entra",
  isActive: false,
  deactivatedUsername: "entra.user",
  deactivatedAt: "2026-04-16T10:00:00.000Z",
  roles: ["user"],
};

const overview: AdminOverview = {
  users: [recoveryUser, migratableLocalUser, deactivatedEntraUser],
  roles: [
    {
      id: "role-admin",
      name: "admin",
      description: "Full system administration access.",
      adGroupName: "",
      entraAppRoleValue: "",
      entraGroupId: "",
      permissions: adminUser.permissions,
    },
  ],
  permissions: adminUser.permissions.map((name) => ({ name, description: name })),
  settings: baseSettings,
  decks: [{ id: "deck-1", name: "Fibonacci", values: ["1", "2", "3"], isDefault: true, createdAt: "2026-04-13T10:00:00.000Z" }],
  activeSessions: [],
  auditLogs: [],
};

function renderAdminPanel() {
  return render(
    <AdminPanel
      user={adminUser}
      overview={overview}
      onSaveSettings={vi.fn().mockResolvedValue(undefined)}
      onSaveUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onSaveIntegrationSettings={vi.fn().mockResolvedValue(undefined)}
      onCheckForUpdates={vi.fn().mockResolvedValue(undefined)}
      onSaveRoomSettings={vi.fn().mockResolvedValue(undefined)}
      onRunScheduledTask={vi.fn().mockResolvedValue("ok")}
      onTestActiveDirectory={vi.fn().mockResolvedValue({ ok: true, checks: [], user: null })}
      onTestJira={vi.fn().mockResolvedValue({ ok: true, site: "", accountId: "", displayName: "" })}
      onRefreshOverview={vi.fn().mockResolvedValue(overview)}
      onUpdateUserRoles={vi.fn().mockResolvedValue(undefined)}
      onRevokeSession={vi.fn().mockResolvedValue(undefined)}
      onCreateDeck={vi.fn().mockResolvedValue(undefined)}
      onUpdateDeck={vi.fn().mockResolvedValue(undefined)}
      onDeleteDeck={vi.fn().mockResolvedValue(undefined)}
      onCreateUser={vi.fn().mockResolvedValue(null)}
      onUpdateUser={vi.fn().mockResolvedValue(undefined)}
      onDeactivateUser={vi.fn().mockResolvedValue(undefined)}
      onAnonymizeUser={vi.fn().mockResolvedValue(undefined)}
      onPrepareUserEntraMigration={vi.fn().mockResolvedValue(undefined)}
      onCancelUserEntraMigration={vi.fn().mockResolvedValue(undefined)}
      onReactivateUser={vi.fn().mockResolvedValue(undefined)}
      onCreateRole={vi.fn().mockResolvedValue(undefined)}
      onUpdateRole={vi.fn().mockResolvedValue(undefined)}
      onDeleteRole={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe("AdminPanel", () => {
  it("shows provider toggles instead of the old login mode selector", async () => {
    renderAdminPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: /Authentication & Passwords/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Local/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Microsoft Active Directory/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Microsoft Entra/ }));

    expect(screen.queryByText("Login mode")).toBeNull();
    expect(screen.getByText("Enable local accounts")).toBeTruthy();
    expect(screen.getByText("Enable Microsoft Active Directory")).toBeTruthy();
    expect(screen.getByText("Enable Microsoft Entra")).toBeTruthy();
  });

  it("blocks saving authentication settings when both providers are disabled", async () => {
    renderAdminPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: /Authentication & Passwords/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Local/ }));
    fireEvent.click(screen.getByTitle("Toggle local accounts"));
    fireEvent.click(screen.getByRole("button", { name: /^Password Policy/ }));

    expect(screen.getByDisplayValue("8").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save settings" }).getAttribute("disabled")).not.toBeNull();
  });

  it("keeps the Microsoft Active Directory role mapping field visible but disabled when AD is off", async () => {
    renderAdminPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Roles" }));
    });
    fireEvent.click(screen.getByTitle("Edit role"));

    expect(
      screen.getByPlaceholderText("CN=SPRINTO_ADMIN,OU=Groups,DC=company,DC=local").getAttribute("disabled")
    ).not.toBeNull();
  });

  it("keeps the Microsoft Entra role mapping fields visible but disabled when Entra is off", async () => {
    renderAdminPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Roles" }));
    });
    fireEvent.click(screen.getByTitle("Edit role"));

    expect(screen.getByPlaceholderText("Sprinto.Admin").getAttribute("disabled")).not.toBeNull();
    expect(screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000").getAttribute("disabled")).not.toBeNull();
  });

  it("shows the recovery admin as a locked system-managed account", async () => {
    renderAdminPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Users" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Users" }).getAttribute("aria-current")).toBe("page"));
    fireEvent.click(screen.getAllByTitle("Edit user")[0]);

    expect(screen.getByDisplayValue("System recovery")).toBeTruthy();
    expect(screen.getByText(/managed from deployment configuration/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save user" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deactivate user" })).toBeNull();
  });

  it("shows Entra logout and migration policy fields in Entra settings", async () => {
    renderAdminPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: /Authentication & Passwords/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Microsoft Entra/ }));
    fireEvent.click(screen.getByRole("button", { name: /Migration policy/ }));

    expect(screen.getByText("Enable Entra migration")).toBeTruthy();
    expect(screen.getByText("Prompted logins before enforcement")).toBeTruthy();
    expect(screen.getByText("Default enforce-at date/time")).toBeTruthy();
    expect(screen.getByText("Sign out from Microsoft session too")).toBeTruthy();
  });

  it("shows prepare migration action for eligible local users when Entra is enabled", async () => {
    const enabledOverview: AdminOverview = {
      ...overview,
      settings: {
        ...overview.settings,
        entraAuthEnabled: true,
        entraMigrationEnabled: true,
      },
    };

    render(
      <AdminPanel
        user={adminUser}
        overview={enabledOverview}
        onSaveSettings={vi.fn().mockResolvedValue(undefined)}
        onSaveUpdateSettings={vi.fn().mockResolvedValue(undefined)}
        onSaveIntegrationSettings={vi.fn().mockResolvedValue(undefined)}
        onCheckForUpdates={vi.fn().mockResolvedValue(undefined)}
        onSaveRoomSettings={vi.fn().mockResolvedValue(undefined)}
        onRunScheduledTask={vi.fn().mockResolvedValue("ok")}
        onTestActiveDirectory={vi.fn().mockResolvedValue({ ok: true, checks: [], user: null })}
        onTestJira={vi.fn().mockResolvedValue({ ok: true, site: "", accountId: "", displayName: "" })}
        onRefreshOverview={vi.fn().mockResolvedValue(enabledOverview)}
        onUpdateUserRoles={vi.fn().mockResolvedValue(undefined)}
        onRevokeSession={vi.fn().mockResolvedValue(undefined)}
        onCreateDeck={vi.fn().mockResolvedValue(undefined)}
        onUpdateDeck={vi.fn().mockResolvedValue(undefined)}
        onDeleteDeck={vi.fn().mockResolvedValue(undefined)}
        onCreateUser={vi.fn().mockResolvedValue(null)}
        onUpdateUser={vi.fn().mockResolvedValue(undefined)}
        onDeactivateUser={vi.fn().mockResolvedValue(undefined)}
        onAnonymizeUser={vi.fn().mockResolvedValue(undefined)}
        onPrepareUserEntraMigration={vi.fn().mockResolvedValue(undefined)}
        onCancelUserEntraMigration={vi.fn().mockResolvedValue(undefined)}
        onReactivateUser={vi.fn().mockResolvedValue(undefined)}
        onCreateRole={vi.fn().mockResolvedValue(undefined)}
        onUpdateRole={vi.fn().mockResolvedValue(undefined)}
        onDeleteRole={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Users" }));
    });
    fireEvent.click(screen.getAllByTitle("Edit user")[1]);

    expect(screen.getByRole("button", { name: "Migrate to Entra" })).toBeTruthy();
  });

  it("hides prepare migration action when Entra migration is disabled", async () => {
    const disabledMigrationOverview: AdminOverview = {
      ...overview,
      settings: {
        ...overview.settings,
        entraAuthEnabled: true,
        entraMigrationEnabled: false,
      },
    };

    render(
      <AdminPanel
        user={adminUser}
        overview={disabledMigrationOverview}
        onSaveSettings={vi.fn().mockResolvedValue(undefined)}
        onSaveUpdateSettings={vi.fn().mockResolvedValue(undefined)}
        onSaveIntegrationSettings={vi.fn().mockResolvedValue(undefined)}
        onCheckForUpdates={vi.fn().mockResolvedValue(undefined)}
        onSaveRoomSettings={vi.fn().mockResolvedValue(undefined)}
        onRunScheduledTask={vi.fn().mockResolvedValue("ok")}
        onTestActiveDirectory={vi.fn().mockResolvedValue({ ok: true, checks: [], user: null })}
        onTestJira={vi.fn().mockResolvedValue({ ok: true, site: "", accountId: "", displayName: "" })}
        onRefreshOverview={vi.fn().mockResolvedValue(disabledMigrationOverview)}
        onUpdateUserRoles={vi.fn().mockResolvedValue(undefined)}
        onRevokeSession={vi.fn().mockResolvedValue(undefined)}
        onCreateDeck={vi.fn().mockResolvedValue(undefined)}
        onUpdateDeck={vi.fn().mockResolvedValue(undefined)}
        onDeleteDeck={vi.fn().mockResolvedValue(undefined)}
        onCreateUser={vi.fn().mockResolvedValue(null)}
        onUpdateUser={vi.fn().mockResolvedValue(undefined)}
        onDeactivateUser={vi.fn().mockResolvedValue(undefined)}
        onAnonymizeUser={vi.fn().mockResolvedValue(undefined)}
        onPrepareUserEntraMigration={vi.fn().mockResolvedValue(undefined)}
        onCancelUserEntraMigration={vi.fn().mockResolvedValue(undefined)}
        onReactivateUser={vi.fn().mockResolvedValue(undefined)}
        onCreateRole={vi.fn().mockResolvedValue(undefined)}
        onUpdateRole={vi.fn().mockResolvedValue(undefined)}
        onDeleteRole={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Users" }));
    });
    fireEvent.click(screen.getAllByTitle("Edit user")[1]);

    expect(screen.queryByRole("button", { name: "Migrate to Entra" })).toBeNull();
  });

  it("shows anonymize action for deactivated Entra users", async () => {
    renderAdminPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Users" }));
    });
    fireEvent.click(screen.getByRole("button", { name: /Deactivated users/i }));
    const userName = screen.getByText("Entra User");
    const userRow = userName.closest(".admin-row");
    expect(userRow).toBeTruthy();
    fireEvent.click(within(userRow as HTMLElement).getByTitle("Edit user"));

    expect(screen.getByRole("button", { name: "Anonymize user" })).toBeTruthy();
  });
});
