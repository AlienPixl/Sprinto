import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserSettings } from "./UserSettings";
import type { SettingsOverview, User } from "../lib/types";

const settings = {
  minPasswordLength: 8,
  requirePasswordComplexity: false,
} as SettingsOverview;

const baseUser = {
  id: "user-1",
  username: "martin",
  displayName: "Martin Janecek",
  email: "martin@example.com",
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
  permissions: ["manage_settings"],
} as User;

function renderUserSettings(user: User) {
  return render(
    <UserSettings
      user={user}
      settings={settings}
      onChangePassword={vi.fn().mockResolvedValue(undefined)}
      onUpdateProfile={vi.fn().mockResolvedValue(undefined)}
      onUpdateTheme={vi.fn().mockResolvedValue(undefined)}
      onPreviewTheme={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("UserSettings", () => {
  it("shows the Entra-managed avatar note for a local user linked to Microsoft Entra", () => {
    renderUserSettings({
      ...baseUser,
      entraLinked: true,
      avatarManagedByDirectory: true,
      avatarManagedByAuthSource: "entra",
    });

    expect(
      screen.getByText("Your avatar is centrally managed by Microsoft Entra. You can still manage your display name and password in Sprinto.")
    ).toBeTruthy();
    expect(screen.getByText("Current Password")).toBeTruthy();
  });

  it("explains the local avatar fallback when a primary Entra account has no Entra photo", () => {
    renderUserSettings({
      ...baseUser,
      authSource: "entra",
      avatarManagedByDirectory: false,
      avatarManagedByAuthSource: "",
    });

    expect(
      screen.getByText("Username and profile details are centrally managed by Microsoft Entra. Because no avatar is available in Microsoft Entra, you can manage your avatar in Sprinto.")
    ).toBeTruthy();
  });
});
