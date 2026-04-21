import { FormEvent, useEffect, useRef, useState } from "react";
import { SettingsOverview, ThemeId, User } from "../lib/types";
import { validatePassword, validatePasswordMatch, type PasswordValidationResult } from "../lib/passwordValidator";
import { THEME_OPTIONS } from "../lib/theme";

type UserSettingsProps = {
  user: User;
  settings: SettingsOverview | null;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onUpdateProfile: (payload: { displayName: string; avatarDataUrl: string; theme: ThemeId }) => Promise<void>;
  onUpdateTheme: (theme: ThemeId) => Promise<void>;
  onPreviewTheme: (theme: ThemeId) => void;
  onClose: () => void;
};

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to process avatar image"));
    image.src = dataUrl;
  });
}

async function prepareAvatarDataUrl(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (file.type === "image/svg+xml") {
    return rawDataUrl;
  }

  const image = await loadImageElement(rawDataUrl);
  const maxSize = 256;
  const scale = Math.min(1, maxSize / Math.max(image.width || maxSize, image.height || maxSize));
  const width = Math.max(1, Math.round((image.width || maxSize) * scale));
  const height = Math.max(1, Math.round((image.height || maxSize) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return rawDataUrl;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png", 0.92);
}

function getAvatarInitials(displayName: string): string {
  return displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserSettings({ user, settings, onChangePassword, onUpdateProfile, onUpdateTheme, onPreviewTheme, onClose }: UserSettingsProps) {
  const isSystemManaged = user.authSource === "system" || user.isSystemManaged;
  const avatarManagedByAuthSource = user.avatarManagedByAuthSource === "ad" || user.avatarManagedByAuthSource === "entra"
    ? user.avatarManagedByAuthSource
    : "";
  const isDirectoryManaged = !isSystemManaged && (user.authSource === "ad" || user.authSource === "entra");
  const canEditDisplayName = !isDirectoryManaged && !isSystemManaged;
  const canEditAvatar = !isSystemManaged && !avatarManagedByAuthSource;
  const canChangePassword = user.authSource === "local" && !isSystemManaged;
  const canChangeTheme = !isSystemManaged;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarDataUrl, setAvatarDataUrl] = useState(user.avatarDataUrl || "");
  const [theme, setTheme] = useState<ThemeId>(user.theme);
  const [themeSubmitting, setThemeSubmitting] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordValidation, setPasswordValidation] = useState<PasswordValidationResult>({
    isValid: false,
    errors: [],
    feedback: {
      hasMinLength: false,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
      hasSpecialChar: false
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [profileMessage, setProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const avatarMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDisplayName(user.displayName);
    setAvatarDataUrl(user.avatarDataUrl || "");
    setTheme(user.theme);
  }, [user.avatarDataUrl, user.displayName, user.theme]);

  useEffect(() => {
    if (!profileSaved) {
      return;
    }
    const timer = window.setTimeout(() => setProfileSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [profileSaved]);

  useEffect(() => {
    if (newPassword) {
      const validation = validatePassword(
        newPassword,
        settings?.minPasswordLength ?? 8,
        settings?.requirePasswordComplexity ?? false
      );
      setPasswordValidation(validation);
    }
  }, [newPassword, settings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!avatarMenuRef.current?.contains(event.target as Node)) {
        setAvatarMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (!currentPassword) {
      setMessage({ type: "error", text: "Current password is required" });
      return;
    }
    if (!newPassword) {
      setMessage({ type: "error", text: "New password is required" });
      return;
    }
    if (!passwordValidation.isValid) {
      setMessage({ type: "error", text: "New password does not meet requirements" });
      return;
    }
    if (!validatePasswordMatch(newPassword, confirmPassword)) {
      setMessage({ type: "error", text: "Passwords do not match" });
      return;
    }

    setSubmitting(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setMessage({ type: "success", text: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setMessage({ type: "error", text: "Failed to change password. Check your current password." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileMessage(null);

    if (!canEditDisplayName && !canEditAvatar) {
      return;
    }

    if (canEditDisplayName && !displayName.trim()) {
      setProfileMessage({ type: "error", text: "Display name is required" });
      return;
    }

    setProfileSubmitting(true);
    try {
      await onUpdateProfile({
        displayName: canEditDisplayName ? displayName.trim() : user.displayName,
        avatarDataUrl,
        theme,
      });
      setProfileSaved(true);
    } catch (error) {
      setProfileMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to update profile" });
    } finally {
      setProfileSubmitting(false);
    }
  }

  async function handleAvatarChange(file: File | null) {
    if (!file) {
      return;
    }
    try {
      setAvatarDataUrl(await prepareAvatarDataUrl(file));
      setProfileMessage(null);
      setAvatarMenuOpen(false);
    } catch {
      setProfileMessage({ type: "error", text: "Failed to read avatar file" });
    }
  }

  async function handleThemeChange(nextTheme: ThemeId) {
    const previousTheme = user.theme;
    setTheme(nextTheme);
    onPreviewTheme(nextTheme);
    setProfileMessage(null);
    setThemeSubmitting(true);
    try {
      await onUpdateTheme(nextTheme);
    } catch {
      setTheme(previousTheme);
      onPreviewTheme(previousTheme);
      setProfileMessage({ type: "error", text: "Failed to update theme" });
    } finally {
      setThemeSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="card admin-modal account-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="admin-section__header">
          <h2>Account Settings</h2>
          <button className="ghost-button" onClick={onClose} type="button">Close</button>
        </div>

        <div className="account-settings-layout">
          <form className="account-settings-section" onSubmit={(event) => void handleProfileSubmit(event)}>
            <div className="account-settings-profile account-settings-profile--stacked">
              <div className="account-settings-avatar-menu" ref={avatarMenuRef}>
                <button
                  className="account-settings-avatar-trigger"
                  disabled={!canEditAvatar}
                  onClick={() => setAvatarMenuOpen((open) => !open)}
                  type="button"
                >
                  <span className="avatar-circle avatar-circle--large avatar-circle--profile">
                    {avatarDataUrl ? <img alt={displayName || user.username} src={avatarDataUrl} /> : getAvatarInitials(user.displayName)}
                  </span>
                  <span className="account-settings-avatar-overlay" aria-hidden="true">
                    <EditIcon />
                  </span>
                </button>
                {canEditAvatar && avatarMenuOpen ? (
                  <div className="account-settings-avatar-popover">
                    <button
                      className="user-dropdown__action"
                      onClick={() => avatarInputRef.current?.click()}
                      type="button"
                    >
                      Upload avatar
                    </button>
                    {avatarDataUrl ? (
                      <button
                        className="user-dropdown__action"
                        onClick={() => {
                          setAvatarDataUrl("");
                          setAvatarMenuOpen(false);
                        }}
                        type="button"
                      >
                        Remove avatar
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <input
                  accept=".png,.jpg,.jpeg,.webp,.svg"
                  aria-label="Upload avatar"
                  className="account-settings-avatar-input"
                  onChange={(event) => {
                    void handleAvatarChange(event.target.files?.[0] || null);
                    event.currentTarget.value = "";
                  }}
                  ref={avatarInputRef}
                  type="file"
                />
              </div>
              <div className="account-settings-profile__identity">
                <strong>{displayName || user.displayName}</strong>
              </div>
            </div>

            <label>
              <span>Display Name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={profileSubmitting || !canEditDisplayName}
              />
            </label>
            <label>
              <span>Theme</span>
              <select
                className="account-settings-theme-select"
                disabled={profileSubmitting || themeSubmitting || !canChangeTheme}
                onChange={(event) => void handleThemeChange(event.target.value as ThemeId)}
                value={theme}
              >
                {THEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {isDirectoryManaged ? (
              <>
                <label>
                  <span>Username</span>
                  <input disabled readOnly value={user.username} />
                </label>
                <p className="account-settings-help account-settings-help--centered">
                  {isSystemManaged
                    ? "This recovery account is managed from deployment configuration and cannot be edited in Sprinto."
                    : user.authSource === "entra"
                      ? avatarManagedByAuthSource === "entra"
                        ? "Username, profile details, and avatar are centrally managed by Microsoft Entra."
                        : "Username and profile details are centrally managed by Microsoft Entra. Because no avatar is available in Microsoft Entra, you can manage your avatar in Sprinto."
                      : avatarManagedByAuthSource === "ad"
                        ? "Username, profile details, and avatar are centrally managed by Microsoft Active Directory."
                        : "Username and profile details are centrally managed by Microsoft Active Directory. Because no avatar is available in the directory, you can manage your avatar in Sprinto."}
                </p>
              </>
            ) : null}
            {!isDirectoryManaged && !isSystemManaged && avatarManagedByAuthSource === "entra" ? (
              <p className="account-settings-help account-settings-help--centered">
                Your avatar is centrally managed by Microsoft Entra. You can still manage your display name and password in Sprinto.
              </p>
            ) : null}
            {profileMessage ? (
              <div className={`account-settings-message account-settings-message--${profileMessage.type}`}>
                {profileMessage.text}
              </div>
            ) : null}

            {(canEditDisplayName || canEditAvatar) ? (
              <div className="account-settings-actions account-settings-actions--centered">
                <button className={`button-center ${profileSaved ? "saved" : ""}`} disabled={profileSubmitting} type="submit">
                  {profileSaved ? "✓ Saved" : profileSubmitting ? "Saving..." : "Save Profile"}
                </button>
              </div>
            ) : null}
          </form>

          {canChangePassword ? (
            <form className="account-settings-section" onSubmit={(event) => void handleChangePassword(event)}>
              <div className="account-settings-fieldset">
                <div className="account-settings-legend">Change Password</div>

                <label>
                  <span>Current Password</span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder="Enter your current password"
                    disabled={submitting}
                  />
                </label>

                <label>
                  <span>New Password</span>
                  <div className="password-input-group">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="Enter new password"
                      disabled={submitting}
                    />
                    {newPassword && (
                      <span className={`password-feedback ${passwordValidation.isValid ? "valid" : "invalid"}`}>
                        {passwordValidation.isValid ? "✓" : "✗"}
                      </span>
                    )}
                  </div>
                  {newPassword && passwordValidation.errors.length > 0 && (
                    <div className="password-errors">
                      {passwordValidation.errors.map((error, idx) => (
                        <p key={idx} className="error-text">{error}</p>
                      ))}
                    </div>
                  )}
                </label>

                {newPassword ? (
                  <label>
                    <span>Confirm New Password</span>
                    <div className="password-input-group">
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Repeat new password"
                        disabled={submitting}
                      />
                      {confirmPassword ? (
                        <span className={`password-feedback ${validatePasswordMatch(newPassword, confirmPassword) ? "valid" : "invalid"}`}>
                          {validatePasswordMatch(newPassword, confirmPassword) ? "✓" : "✗"}
                        </span>
                      ) : null}
                    </div>
                  </label>
                ) : null}

                {message ? (
                  <div className={`account-settings-message account-settings-message--${message.type}`}>
                    {message.text}
                  </div>
                ) : null}

                <div className="account-settings-actions account-settings-actions--centered">
                  <button
                    className="button-center"
                    disabled={submitting || !currentPassword || !newPassword || !confirmPassword}
                    type="submit"
                  >
                    {submitting ? "Changing..." : "Change Password"}
                  </button>
                </div>
              </div>
            </form>
          ) : isDirectoryManaged || isSystemManaged ? (
            <div className="account-settings-section account-settings-section--note">
              <div className="account-settings-fieldset">
                <div className="account-settings-legend">Change Password</div>
                <p className="account-settings-help">
                  {isSystemManaged
                    ? "The recovery admin password is managed from deployment configuration."
                    : user.authSource === "entra"
                      ? "Password changes are centrally managed by Microsoft Entra."
                      : "Password changes are centrally managed by Microsoft Active Directory."}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
