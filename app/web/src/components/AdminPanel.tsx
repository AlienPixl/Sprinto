import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ActiveDirectoryTestResult, AdminOverview, AuditLog, Deck, JiraIntegrationSettings, Role, ScheduledTaskSchedule, SettingsOverview, User } from "../lib/types";
import { validatePassword, validatePasswordMatch, type PasswordValidationResult } from "../lib/passwordValidator";

type DeckFormState = { name: string; values: string };
type AdminTab = "settings" | "integrations" | "updates" | "rooms" | "users" | "roles" | "scheduled-tasks" | "decks" | "audit-logs" | "active-sessions";

type UserEditorState = {
  id?: string;
  username: string;
  displayName: string;
  email: string;
  authSource: string;
  entraLinked: boolean;
  entraMigrationState: string;
  entraMigrationPreparedAt: string | null;
  entraMigrationPromptCount: number;
  entraMigrationForceAt: string | null;
  isActive: boolean;
  deactivatedUsername: string;
  anonymizedAt: string | null;
  password: string;
  passwordConfirm?: string;
  avatarDataUrl: string;
  avatarManagedByAuthSource: string;
  roles: string[];
};

type RoleEditorState = {
  id?: string;
  name: string;
  description: string;
  adGroupName: string;
  entraAppRoleValue: string;
  entraGroupId: string;
  permissions: string[];
};

type SettingsSectionKey = "authentication" | "network" | "branding";
type AuditFilterKey = "actor" | "action";
type InlineMessage = { type: "success" | "error"; text: string };

const SUPPORTED_LOGO_FORMATS = ".png,.svg,.webp,.jpg,.jpeg";
const SUPPORTED_FAVICON_FORMATS = ".png,.ico,.svg";

function renderFieldLabel(label: string, required = false) {
  return (
    <span>
      {label}
      {required ? <span className="settings-field-required"> (required)</span> : null}
    </span>
  );
}

type AdminPanelProps = {
  user: User;
  overview: AdminOverview | null;
  onSaveSettings: (settings: SettingsOverview) => Promise<void>;
  onSaveUpdateSettings: (settings: SettingsOverview) => Promise<void>;
  onSaveIntegrationSettings: (payload: { jira: JiraIntegrationSettings }) => Promise<void>;
  onCheckForUpdates: () => Promise<void>;
  onSaveRoomSettings: (settings: SettingsOverview) => Promise<void>;
  onRunScheduledTask: (taskKey: string) => Promise<string>;
  onTestActiveDirectory: (settings: SettingsOverview, testIdentifier: string) => Promise<ActiveDirectoryTestResult>;
  onTestJira: (settings: JiraIntegrationSettings) => Promise<{ ok: boolean; site: string; accountId: string; displayName: string }>;
  onRefreshOverview: () => Promise<AdminOverview | null>;
  onUpdateUserRoles: (userId: string, roles: string[]) => Promise<void>;
  onRevokeSession: (token: string) => Promise<void>;
  onCreateDeck: (name: string, values: string[]) => Promise<void>;
  onUpdateDeck: (deckId: string, name: string, values: string[]) => Promise<void>;
  onDeleteDeck: (deckId: string) => Promise<void>;
  onCreateUser: (payload: {
    username: string;
    displayName: string;
    email: string;
    authSource: string;
    password: string;
    avatarDataUrl?: string;
    roles: string[];
  }) => Promise<User | null>;
  onUpdateUser: (userId: string, payload: {
    displayName: string;
    email: string;
    authSource: string;
    password?: string;
    avatarDataUrl?: string;
    roles: string[];
  }) => Promise<void>;
  onDeactivateUser: (userId: string) => Promise<void>;
  onAnonymizeUser: (userId: string) => Promise<void>;
  onPrepareUserEntraMigration: (userId: string, payload: { forceAt?: string | null }) => Promise<void>;
  onCancelUserEntraMigration: (userId: string) => Promise<void>;
  onReactivateUser: (userId: string, payload: {
    username: string;
    displayName: string;
    email: string;
    password: string;
    avatarDataUrl?: string;
    roles: string[];
  }) => Promise<void>;
  onCreateRole: (payload: { name: string; description: string; adGroupName: string; entraAppRoleValue: string; entraGroupId: string; permissions: string[] }) => Promise<void>;
  onUpdateRole: (roleId: string, payload: { name: string; description: string; adGroupName: string; entraAppRoleValue: string; entraGroupId: string; permissions: string[] }) => Promise<void>;
  onDeleteRole: (roleId: string) => Promise<void>;
};

function parseDeckValues(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function translatePermission(permissionName: string) {
  const labels: Record<string, string> = {
    manage_users: "Manage Users",
    manage_roles: "Manage Roles & Permissions",
    manage_settings: "Manage System Settings",
    manage_integrations: "Manage Integrations",
    manage_room_settings: "Manage Room Settings",
    manage_decks: "Manage Decks",
    manage_sessions: "Manage Active Sessions",
    manage_audit_logs: "View Audit Logs",
    manage_scheduled_tasks: "Manage Scheduled Tasks",
    manage_updates: "Manage Updates",
    create_room: "Create Room",
    delete_room: "Delete Room",
    highlight_cards: "Highlight Cards",
    vote: "Vote",
    reveal_votes: "Reveal Votes",
    view_votes_of_others: "View Votes of Others",
    close_poker: "End Round",
    queue_issues: "Manage Issue Queue",
    jira_import_issues: "Import Jira Issues",
    jira_send: "Send to Jira",
    worklog_view: "Jira Worklog"
  };

  return labels[permissionName] ?? permissionName;
}

function getPermissionCategory(permissionName: string): string {
  const categories: Record<string, string> = {
    vote: "Poker Voting",
    view_votes_of_others: "Poker Voting",
    queue_issues: "Poker Voting",
    reveal_votes: "Poker Voting",
    close_poker: "Poker Voting",
    create_room: "Room Management",
    delete_room: "Room Management",
    highlight_cards: "Room Management",
    manage_users: "System Administration",
    manage_roles: "System Administration",
    manage_settings: "System Administration",
    manage_integrations: "System Administration",
    manage_room_settings: "System Administration",
    manage_decks: "System Administration",
    manage_sessions: "System Administration",
    manage_audit_logs: "System Administration",
    manage_scheduled_tasks: "System Administration",
    manage_updates: "System Administration",
    jira_import_issues: "JIRA Integration",
    jira_send: "JIRA Integration",
    worklog_view: "JIRA Integration"
  };
  return categories[permissionName] ?? "Other";
}

function formatAuditFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => formatAuditFieldValue(item)).join(", ") : "-";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function titleCaseAuditKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function getAuditChangeRows(entry: AuditLog) {
  const details = entry.details || {};
  const before = details.before && typeof details.before === "object" && !Array.isArray(details.before)
    ? details.before as Record<string, unknown>
    : null;
  const after = details.after && typeof details.after === "object" && !Array.isArray(details.after)
    ? details.after as Record<string, unknown>
    : null;

  if (!before && !after) {
    return [];
  }

  const keys = Array.from(new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]));
  return keys.map((key) => ({
    key,
    label: titleCaseAuditKey(key),
    before: before?.[key],
    after: after?.[key],
  }));
}

function getAuditDetailMetadata(entry: AuditLog) {
  const details = entry.details || {};
  return Object.entries(details).filter(([key]) => key !== "before" && key !== "after");
}

function formatAuditTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function getPermissionOrder(permissionName: string): number {
  const orderMap: Record<string, number> = {
    vote: 0,
    view_votes_of_others: 1,
    queue_issues: 2,
    reveal_votes: 3,
    close_poker: 4,
    create_room: 10,
    delete_room: 11,
    highlight_cards: 12,
    jira_import_issues: 13,
    jira_send: 14,
    worklog_view: 16,
    manage_settings: 20,
    manage_users: 21,
    manage_roles: 22,
    manage_room_settings: 23,
    manage_decks: 24,
    manage_integrations: 25,
    manage_scheduled_tasks: 26,
    manage_updates: 27,
    manage_audit_logs: 28,
    manage_sessions: 29
  };
  return orderMap[permissionName] ?? 999;
}

function getSortedPermissionLabels(permissions: string[]): string[] {
  const sorted = [...permissions].sort((a, b) => getPermissionOrder(a) - getPermissionOrder(b));
  return sorted.map((perm) => translatePermission(perm));
}

function groupPermissionsByCategory(permissions: string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  const categoryOrder = ["Poker Voting", "Room Management", "System Administration", "JIRA Integration"];

  categoryOrder.forEach((cat) => {
    grouped[cat] = [];
  });

  permissions.forEach((perm) => {
    const category = getPermissionCategory(perm);
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(perm);
  });

  categoryOrder.forEach((cat) => {
    grouped[cat].sort((a, b) => getPermissionOrder(a) - getPermissionOrder(b));
  });

  const ordered: Record<string, string[]> = {};
  categoryOrder.forEach((cat) => {
    if (grouped[cat] && grouped[cat].length > 0) {
      ordered[cat] = grouped[cat];
    }
  });

  return ordered;
}

const SCHEDULED_TASK_FREQUENCY_OPTIONS: Array<{ value: "minutes" | "hourly" | "daily" | "selected_weekdays" | "weekly" | "monthly" | "yearly"; label: string }> = [
  { value: "minutes", label: "Every N minutes" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "selected_weekdays", label: "Selected weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const SCHEDULED_TASK_WEEKDAY_OPTIONS = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
];

const SCHEDULED_TASK_WEEK_OF_MONTH_OPTIONS = [
  { value: 1, label: "1st week" },
  { value: 2, label: "2nd week" },
  { value: 3, label: "3rd week" },
  { value: 4, label: "4th week" },
];

const SCHEDULED_TASK_MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const SCHEDULED_TASK_AGE_UNIT_OPTIONS = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
];

const DEFAULT_AUTO_ANONYMIZE_TASK = {
  enabled: false,
  frequency: "daily" as const,
  intervalMinutes: 15,
  time: "02:00",
  weekdays: [] as string[],
  weeklyWeekday: "monday",
  weekOfMonth: 1 as 1 | 2 | 3 | 4,
  monthlyDay: 1,
  yearlyMonth: 1,
  yearlyDay: 1,
  anonymizeAfterValue: 30,
  anonymizeAfterUnit: "days" as const,
  anonymizeAfterDays: 30,
};

const DEFAULT_AUTO_CLOSE_ROOMS_TASK = {
  enabled: false,
  frequency: "daily" as const,
  intervalMinutes: 15,
  time: "03:00",
  weekdays: [] as string[],
  weeklyWeekday: "monday",
  weekOfMonth: 1 as 1 | 2 | 3 | 4,
  monthlyDay: 1,
  yearlyMonth: 1,
  yearlyDay: 1,
  closeAfterValue: 30,
  closeAfterUnit: "days" as const,
  closeAfterDays: 30,
  roomStatuses: ["open", "voting", "revealed"] as string[],
};

const DEFAULT_AUTO_CLOSE_INACTIVE_SESSIONS_TASK = {
  enabled: false,
  frequency: "daily" as const,
  intervalMinutes: 15,
  time: "04:00",
  weekdays: [] as string[],
  weeklyWeekday: "monday",
  weekOfMonth: 1 as 1 | 2 | 3 | 4,
  monthlyDay: 1,
  yearlyMonth: 1,
  yearlyDay: 1,
  closeAfterValue: 30,
  closeAfterUnit: "days" as const,
  closeAfterDays: 30,
};

const DEFAULT_SYNC_ACTIVE_DIRECTORY_USERS_TASK = {
  enabled: false,
  frequency: "daily" as const,
  intervalMinutes: 15,
  time: "01:00",
  weekdays: [] as string[],
  weeklyWeekday: "monday",
  weekOfMonth: 1 as 1 | 2 | 3 | 4,
  monthlyDay: 1,
  yearlyMonth: 1,
  yearlyDay: 1,
};

const DEFAULT_CHECK_FOR_UPDATES_TASK = {
  enabled: false,
  frequency: "daily" as const,
  intervalMinutes: 15,
  time: "05:00",
  weekdays: [] as string[],
  weeklyWeekday: "monday",
  weekOfMonth: 1 as 1 | 2 | 3 | 4,
  monthlyDay: 1,
  yearlyMonth: 1,
  yearlyDay: 1,
};

const ROOM_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "voting", label: "Voting" },
  { value: "revealed", label: "Revealed" },
];

function formatAuthSourceLabel(authSource: string) {
  if (authSource === "ad") {
    return "Microsoft Active Directory";
  }
  if (authSource === "entra") {
    return "Microsoft Entra";
  }
  if (authSource === "system") {
    return "System recovery";
  }
  return "Local";
}

function formatUserStatus(user: Pick<User, "isActive" | "anonymizedAt">) {
  if (user.anonymizedAt) {
    return "Anonymized";
  }
  return user.isActive ? "Active" : "Deactivated";
}

function getAvatarInitials(displayName: string): string {
  return displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatTaskRunTimestamp(value?: string | null) {
  if (!value) {
    return "Not scheduled";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not scheduled";
  }

  return parsed.toLocaleString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatScheduledTaskSummary(task: ScheduledTaskSchedule) {
  if (!task.enabled) {
    return "Disabled";
  }

  switch (task.frequency) {
    case "minutes":
      return `Every ${task.intervalMinutes} minute${task.intervalMinutes === 1 ? "" : "s"}`;
    case "hourly":
      return `Every hour at minute ${task.time.slice(3, 5)}`;
    case "daily":
      return `Every day at ${task.time}`;
    case "selected_weekdays": {
      const selected = SCHEDULED_TASK_WEEKDAY_OPTIONS
        .filter((option) => task.weekdays.includes(option.value))
        .map((option) => option.label);
      return selected.length ? `${selected.join(", ")} at ${task.time}` : "No weekdays selected";
    }
    case "weekly": {
      const weekLabel = SCHEDULED_TASK_WEEK_OF_MONTH_OPTIONS.find((option) => option.value === task.weekOfMonth)?.label || "1st week";
      const weekdayLabel = SCHEDULED_TASK_WEEKDAY_OPTIONS.find((option) => option.value === task.weeklyWeekday)?.label || "Mon";
      return `${weekLabel} ${weekdayLabel} of each month at ${task.time}`;
    }
    case "monthly":
      return `Day ${task.monthlyDay} of each month at ${task.time}`;
    case "yearly": {
      const monthLabel = SCHEDULED_TASK_MONTH_OPTIONS.find((option) => option.value === task.yearlyMonth)?.label || "January";
      return `${monthLabel} ${task.yearlyDay} at ${task.time}`;
    }
    default:
      return "Not scheduled";
  }
}

function formatAgeThreshold(value: number, unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years") {
  const normalizedValue = Math.max(1, Number(value) || 1);
  const label = SCHEDULED_TASK_AGE_UNIT_OPTIONS.find((option) => option.value === unit)?.label.toLowerCase() || "days";
  const singular = label.endsWith("s") ? label.slice(0, -1) : label;
  return `${normalizedValue} ${normalizedValue === 1 ? singular : label}`;
}

const AD_TEST_STEP_ORDER = [
  { key: "server-port", label: "Server and port" },
  { key: "service-bind", label: "Service account login" },
  { key: "login-attribute", label: "Login attribute" },
  { key: "email-attribute", label: "Email attribute" },
  { key: "external-id-attribute", label: "External ID attribute" },
  { key: "display-name-attribute", label: "Display name attribute" },
  { key: "role-mapping", label: "Role" },
];

const JIRA_TEST_STEP_ORDER = [
  { key: "resolve-url", label: "Find Jira URL" },
  { key: "service-login", label: "Sign in service account" },
  { key: "account-name", label: "Read account name" },
];

export function AdminPanel({
  user,
  overview,
  onSaveSettings,
  onSaveUpdateSettings,
  onSaveIntegrationSettings,
  onCheckForUpdates,
  onSaveRoomSettings,
  onRunScheduledTask,
  onTestActiveDirectory,
  onTestJira,
  onRefreshOverview,
  onUpdateUserRoles,
  onRevokeSession,
  onCreateDeck,
  onUpdateDeck,
  onDeleteDeck,
  onCreateUser,
  onUpdateUser,
  onDeactivateUser,
  onAnonymizeUser,
  onPrepareUserEntraMigration,
  onCancelUserEntraMigration,
  onReactivateUser,
  onCreateRole,
  onUpdateRole,
  onDeleteRole
}: AdminPanelProps) {
  const [settings, setSettings] = useState<SettingsOverview | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string[]>>({});
  const [newDeck, setNewDeck] = useState<DeckFormState>({ name: "", values: "" });
  const [editingDeck, setEditingDeck] = useState<(DeckFormState & { id: string }) | null>(null);
  const [deckBusy, setDeckBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("settings");
  const [jiraTestBusy, setJiraTestBusy] = useState(false);
  const [jiraTestModalOpen, setJiraTestModalOpen] = useState(false);
  const [jiraTestResult, setJiraTestResult] = useState<{ ok: boolean; site: string; accountId: string; displayName: string } | null>(null);
  const [jiraTestError, setJiraTestError] = useState("");

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userModalSaving, setUserModalSaving] = useState(false);
  const [userAvatarMenuOpen, setUserAvatarMenuOpen] = useState(false);
  const [userEditor, setUserEditor] = useState<UserEditorState>({
    username: "",
    displayName: "",
    email: "",
    authSource: "local",
    entraLinked: false,
    entraMigrationState: "",
    entraMigrationPreparedAt: null,
    entraMigrationPromptCount: 0,
    entraMigrationForceAt: null,
    isActive: true,
    deactivatedUsername: "",
    anonymizedAt: null,
    password: "",
    passwordConfirm: "",
    avatarDataUrl: "",
    avatarManagedByAuthSource: "",
    roles: []
  });
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

  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleModalSaving, setRoleModalSaving] = useState(false);
  const [roleMessage, setRoleMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [roleEditor, setRoleEditor] = useState<RoleEditorState>({
    name: "",
    description: "",
    adGroupName: "",
    entraAppRoleValue: "",
    entraGroupId: "",
    permissions: []
  });

  const [deckModalOpen, setDeckModalOpen] = useState(false);
  const [deckModalSaving, setDeckModalSaving] = useState(false);

  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<InlineMessage | null>(null);
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [updateCheckDone, setUpdateCheckDone] = useState(false);
  const [runningTaskKey, setRunningTaskKey] = useState<string | null>(null);
  const [taskRunMessage, setTaskRunMessage] = useState<{ taskKey: string; type: "success" | "error"; text: string } | null>(null);
  const [deckSaved, setDeckSaved] = useState(false);
  const [roleSaved, setRoleSaved] = useState(false);
  const [userSaved, setUserSaved] = useState(false);
  const [userModalMessage, setUserModalMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [settingsSectionsOpen, setSettingsSectionsOpen] = useState<Record<SettingsSectionKey, boolean>>({
    authentication: false,
    network: false,
    branding: false,
  });
  const [localSettingsOpen, setLocalSettingsOpen] = useState(false);
  const [passwordPolicyOpen, setPasswordPolicyOpen] = useState(false);
  const [adSettingsOpen, setAdSettingsOpen] = useState(false);
  const [entraSettingsOpen, setEntraSettingsOpen] = useState(false);
  const [entraMigrationSettingsOpen, setEntraMigrationSettingsOpen] = useState(false);
  const [jiraSettingsOpen, setJiraSettingsOpen] = useState(false);
  const [scheduledTasksOpen, setScheduledTasksOpen] = useState<Record<string, boolean>>({
    autoAnonymizeDeactivatedUsers: false,
    autoCloseRooms: false,
    autoCloseInactiveSessions: false,
    syncActiveDirectoryUsers: false,
    checkForUpdates: false,
  });
  const [adCertificateModalOpen, setAdCertificateModalOpen] = useState(false);
  const [adCertificateDraft, setAdCertificateDraft] = useState("");
  const [adTestModalOpen, setAdTestModalOpen] = useState(false);
  const [adTestIdentifier, setAdTestIdentifier] = useState("");
  const [adTestBusy, setAdTestBusy] = useState(false);
  const [adTestResult, setAdTestResult] = useState<ActiveDirectoryTestResult | null>(null);
  const [adTestError, setAdTestError] = useState("");

  const [openAuditFilter, setOpenAuditFilter] = useState<AuditFilterKey | null>(null);
  const [auditActorSearch, setAuditActorSearch] = useState("");
  const [auditActionSearch, setAuditActionSearch] = useState("");
  const [auditActorFilter, setAuditActorFilter] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditPage, setAuditPage] = useState(0);
  const [selectedAuditEntry, setSelectedAuditEntry] = useState<AuditLog | null>(null);

  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionPage, setSessionPage] = useState(0);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmType, setDeleteConfirmType] = useState<"user-deactivate" | "user-anonymize" | "role" | "deck" | "scheduled-task-run" | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmDeleting, setDeleteConfirmDeleting] = useState(false);
  const [deckDeleteName, setDeckDeleteName] = useState<string>("");
  const [scheduledTaskRunLabel, setScheduledTaskRunLabel] = useState("");
  const [inactiveUsersOpen, setInactiveUsersOpen] = useState(false);
  const [anonymizedUsersOpen, setAnonymizedUsersOpen] = useState(false);
  const userAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const brandingLogoInputRef = useRef<HTMLInputElement | null>(null);
  const brandingFaviconInputRef = useRef<HTMLInputElement | null>(null);
  const userAvatarMenuRef = useRef<HTMLDivElement | null>(null);
  const auditFilterMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (overview) {
      setSettings(overview.settings);
      setAdCertificateDraft(overview.settings.adCaCertificate || "");
      setRoleDrafts(
        Object.fromEntries(overview.users.map((current) => [current.id, current.roles]))
      );
      if (editingDeck && !overview.decks.find((d) => d.id === editingDeck.id)) {
        setEditingDeck(null);
      }
    }
  }, [overview, editingDeck]);

  useEffect(() => {
    if (settingsSaved) {
      const timer = setTimeout(() => setSettingsSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [settingsSaved]);

  useEffect(() => {
    if (updateCheckDone) {
      const timer = setTimeout(() => setUpdateCheckDone(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [updateCheckDone]);

  useEffect(() => {
    if (deckSaved) {
      const timer = setTimeout(() => setDeckSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [deckSaved]);

  useEffect(() => {
    if (roleSaved) {
      const timer = setTimeout(() => setRoleSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [roleSaved]);

  useEffect(() => {
    if (userSaved) {
      const timer = setTimeout(() => setUserSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [userSaved]);

  useEffect(() => {
    if (taskRunMessage) {
      const timer = setTimeout(() => setTaskRunMessage(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [taskRunMessage]);

  useEffect(() => {
    setAdTestResult(null);
    setAdTestError("");
  }, [
    settings?.activeDirectoryEnabled,
    settings?.loginMethod,
    settings?.adServerUrl,
    settings?.adServerPort,
    settings?.adConnectionSecurity,
    settings?.adBaseDn,
    settings?.adBindUsername,
    settings?.adBindPassword,
    settings?.adLoginAttribute,
    settings?.adEmailAttribute,
    settings?.adDisplayNameAttribute,
    settings?.adExternalIdAttribute,
    settings?.adAvatarAttribute,
    settings?.adCaCertificate,
    settings?.adAllowUntrustedCertificate,
  ]);

  useEffect(() => {
    setJiraTestResult(null);
    setJiraTestError("");
  }, [
    settings?.integrations?.jira?.enabled,
    settings?.integrations?.jira?.baseUrl,
    settings?.integrations?.jira?.serviceAccountEmail,
    settings?.integrations?.jira?.apiToken,
  ]);

  useEffect(() => {
    if (!adCertificateModalOpen) {
      setAdCertificateDraft(settings?.adCaCertificate || "");
    }
  }, [adCertificateModalOpen, settings?.adCaCertificate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (adTestModalOpen && !adTestBusy) {
          setAdTestModalOpen(false);
        } else if (jiraTestModalOpen && !jiraTestBusy) {
          setJiraTestModalOpen(false);
        } else if (adCertificateModalOpen) {
          setAdCertificateModalOpen(false);
        } else if (userModalOpen) {
          setUserModalOpen(false);
        } else if (roleModalOpen) {
          setRoleModalOpen(false);
        } else if (deckModalOpen) {
          setDeckModalOpen(false);
        } else if (deleteConfirmOpen) {
          setDeleteConfirmOpen(false);
        } else if (selectedAuditEntry) {
          setSelectedAuditEntry(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [adCertificateModalOpen, adTestBusy, adTestModalOpen, jiraTestBusy, jiraTestModalOpen, userModalOpen, roleModalOpen, deckModalOpen, deleteConfirmOpen, selectedAuditEntry]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!userAvatarMenuRef.current?.contains(event.target as Node)) {
        setUserAvatarMenuOpen(false);
      }
      if (!auditFilterMenuRef.current?.contains(event.target as Node)) {
        setOpenAuditFilter(null);
      }
    }

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!overview) {
    return (
      <div className="page-shell">
        <section className="card">
          <h1>Admin</h1>
          <p>Loading admin overview...</p>
        </section>
      </div>
    );
  }

  const adminOverview = overview;
  const availableRoles = adminOverview.roles.map((role) => role.name);
  const availablePermissions = adminOverview.permissions;
  const canManageUsers = user.permissions.includes("manage_users");
  const canManageRoles = user.permissions.includes("manage_roles");
  const canManageSettings = user.permissions.includes("manage_settings");
  const canManageIntegrations = user.permissions.includes("manage_integrations");
  const canManageRoomSettings = user.permissions.includes("manage_room_settings");
  const canManageDecks = user.permissions.includes("manage_decks");
  const canManageSessions = user.permissions.includes("manage_sessions");
  const canManageAuditLogs = user.permissions.includes("manage_audit_logs");
  const canManageScheduledTasks = user.permissions.includes("manage_scheduled_tasks");
  const canManageUpdates = user.permissions.includes("manage_updates");
  const jiraIntegrationEnabled = settings?.integrations?.jira?.enabled ?? overview?.settings.integrations.jira.enabled ?? false;
  const isLocalAuthEnabled = Boolean(settings?.localAuthEnabled);
  const isActiveDirectoryEnabled = Boolean(settings?.activeDirectoryEnabled);
  const isEntraEnabled = Boolean(settings?.entraAuthEnabled);
  const isDirectHttpsEnabled = Boolean(settings?.httpsEnabled);
  const isEntraMigrationEnabled = settings?.entraMigrationEnabled !== false;
  const hasPublicBaseUrl = Boolean(String(settings?.publicBaseUrl || "").trim());
  const hasEnabledAuthProvider = isLocalAuthEnabled || isActiveDirectoryEnabled || isEntraEnabled;
  const isEntraClientSecretRequired = Boolean(isEntraEnabled && settings && !settings.entraClientSecretConfigured);
  const isSecureDirectoryConnection = settings?.adConnectionSecurity === "ldaps" || settings?.adConnectionSecurity === "starttls";
  const autoAnonymizeTask = settings?.scheduledTasks?.autoAnonymizeDeactivatedUsers || DEFAULT_AUTO_ANONYMIZE_TASK;
  const autoCloseRoomsTask = settings?.scheduledTasks?.autoCloseRooms || DEFAULT_AUTO_CLOSE_ROOMS_TASK;
  const autoCloseInactiveSessionsTask = settings?.scheduledTasks?.autoCloseInactiveSessions || DEFAULT_AUTO_CLOSE_INACTIVE_SESSIONS_TASK;
  const syncActiveDirectoryUsersTask = settings?.scheduledTasks?.syncActiveDirectoryUsers || DEFAULT_SYNC_ACTIVE_DIRECTORY_USERS_TASK;
  const checkForUpdatesTask = settings?.scheduledTasks?.checkForUpdates || DEFAULT_CHECK_FOR_UPDATES_TASK;
  const isDirectoryManagedUser = userEditor.authSource === "ad" || userEditor.authSource === "entra";
  const isSystemRecoveryUser = userEditor.authSource === "system";
  const isAnonymizedUser = Boolean(userEditor.anonymizedAt);
  const isAvatarManagedExternally = userEditor.avatarManagedByAuthSource === "ad" || userEditor.avatarManagedByAuthSource === "entra";
  const isReadonlyUserEditor = isDirectoryManagedUser || isSystemRecoveryUser || isAnonymizedUser;
  const canManuallyAnonymizeUser = Boolean(
    userEditor.id
    && !userEditor.isActive
    && !userEditor.anonymizedAt
    && !isSystemRecoveryUser,
  );
  const canShowMigrationAction = Boolean(
    userEditor.id
    && isEntraEnabled
    && isEntraMigrationEnabled
    && ["local", "ad"].includes(userEditor.authSource)
    && userEditor.isActive
    && !userEditor.anonymizedAt,
  );
  const canPrepareEntraMigration = Boolean(
    userEditor.id
    && isEntraEnabled
    && isEntraMigrationEnabled
    && ["local", "ad"].includes(userEditor.authSource)
    && userEditor.isActive
    && !userEditor.anonymizedAt
    && userEditor.email.trim()
    && userEditor.entraMigrationState !== "pending",
  );
  const canCancelEntraMigration = Boolean(userEditor.id && userEditor.entraMigrationState === "pending");
  const activeUsers = adminOverview.users.filter((current) => current.isActive);
  const inactiveUsers = adminOverview.users.filter((current) => !current.isActive && !current.anonymizedAt);
  const anonymizedUsers = adminOverview.users.filter((current) => Boolean(current.anonymizedAt));
  const hasAdTestUser = adTestIdentifier.trim().length > 0;
  const adTestSteps = AD_TEST_STEP_ORDER.map((step) => {
    const matchingCheck = adTestResult?.checks.find((check) => check.key === step.key);

    if (matchingCheck) {
      return {
        ...step,
        status: matchingCheck.ok ? "success" : "error",
        detail: matchingCheck.message,
      };
    }

    if (adTestBusy) {
      return {
        ...step,
        status: "loading",
        detail: "",
      };
    }

    if (adTestResult) {
      return {
        ...step,
        status: "error",
        detail: "This step could not be completed.",
      };
    }

    if (adTestError) {
      return {
        ...step,
        status: "error",
        detail: step.key === "server-port" ? adTestError : "This step could not be completed.",
      };
    }

    return {
      ...step,
      status: "idle",
      detail: "",
    };
  });

  const jiraTestSteps = JIRA_TEST_STEP_ORDER.map((step) => {
    if (jiraTestBusy) {
      return { ...step, status: "loading", detail: "" };
    }

    if (jiraTestResult) {
      if (step.key === "resolve-url") {
        return { ...step, status: "success", detail: jiraTestResult.site };
      }
      if (step.key === "service-login") {
        return { ...step, status: "success", detail: "Authentication succeeded." };
      }
      if (step.key === "account-name") {
        return { ...step, status: "success", detail: jiraTestResult.displayName || jiraTestResult.accountId };
      }
    }

    if (jiraTestError) {
      return {
        ...step,
        status: "error",
        detail: step.key === "resolve-url" ? jiraTestError : "This step could not be completed.",
      };
    }

    return { ...step, status: "idle", detail: "" };
  });

  const tabs: Array<{ key: AdminTab; label: string }> = [
    ...(canManageSettings ? [{ key: "settings" as const, label: "Settings" }] : []),
    ...(canManageUsers ? [{ key: "users" as const, label: "Users" }] : []),
    ...(canManageRoles ? [{ key: "roles" as const, label: "Roles" }] : []),
    ...(canManageRoomSettings ? [{ key: "rooms" as const, label: "Rooms" }] : []),
    ...(canManageDecks ? [{ key: "decks" as const, label: "Decks" }] : []),
    ...(canManageIntegrations ? [{ key: "integrations" as const, label: "Integrations" }] : []),
    ...(canManageScheduledTasks ? [{ key: "scheduled-tasks" as const, label: "Scheduled Tasks" }] : []),
    ...(canManageUpdates ? [{ key: "updates" as const, label: "Updates" }] : []),
    ...(canManageAuditLogs ? [{ key: "audit-logs" as const, label: "Audit logs" }] : []),
    ...(canManageSessions ? [{ key: "active-sessions" as const, label: "Active sessions" }] : [])
  ];

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeTab) && tabs[0]) {
      setActiveTab(tabs[0].key);
    }
  }, [activeTab, tabs]);

  const filteredAuditLogs = useMemo(() => {
    return adminOverview.auditLogs.filter((entry) => {
      const actor = entry.actorUserId || "System";

      if (auditActorFilter && actor !== auditActorFilter) {
        return false;
      }
      if (auditActionFilter && entry.action !== auditActionFilter) {
        return false;
      }
      return true;
    });
  }, [adminOverview.auditLogs, auditActionFilter, auditActorFilter]);
  const auditActorOptions = useMemo(
    () => Array.from(new Set(adminOverview.auditLogs.map((entry) => entry.actorUserId || "System"))).sort((a, b) => a.localeCompare(b)),
    [adminOverview.auditLogs]
  );
  const auditActionOptions = useMemo(
    () => Array.from(new Set(adminOverview.auditLogs.map((entry) => entry.action))).sort((a, b) => a.localeCompare(b)),
    [adminOverview.auditLogs]
  );
  const visibleAuditActorOptions = useMemo(
    () => auditActorOptions.filter((actor) => actor.toLowerCase().includes(auditActorSearch.toLowerCase())),
    [auditActorOptions, auditActorSearch]
  );
  const visibleAuditActionOptions = useMemo(
    () => auditActionOptions.filter((action) => action.toLowerCase().includes(auditActionSearch.toLowerCase())),
    [auditActionOptions, auditActionSearch]
  );

  const auditPageSize = 12;
  const auditPageCount = Math.max(1, Math.ceil(filteredAuditLogs.length / auditPageSize));
  const pagedAudit = filteredAuditLogs.slice(auditPage * auditPageSize, (auditPage + 1) * auditPageSize);

  const filteredSessions = useMemo(() => {
    return adminOverview.activeSessions.filter((session) => {
      if (!sessionSearch) {
        return true;
      }
      const text = `${session.username} ${session.displayName}`.toLowerCase();
      return text.includes(sessionSearch.toLowerCase());
    });
  }, [adminOverview.activeSessions, sessionSearch]);

  const sessionPageSize = 12;
  const sessionPageCount = Math.max(1, Math.ceil(filteredSessions.length / sessionPageSize));
  const pagedSessions = filteredSessions.slice(sessionPage * sessionPageSize, (sessionPage + 1) * sessionPageSize);
  const editableUsername = !userEditor.id || (!userEditor.isActive && userEditor.authSource === "local" && !userEditor.anonymizedAt);
  const normalizedUsername = userEditor.username.trim().toLowerCase();
  const usernameAvailability = useMemo(() => {
    if (!editableUsername) {
      return { isEditable: false, isAvailable: true, message: "" };
    }
    if (!normalizedUsername) {
      return { isEditable: true, isAvailable: false, message: "Username is required" };
    }
    const taken = adminOverview.users.some(
      (current) => current.id !== userEditor.id && current.username.trim().toLowerCase() === normalizedUsername
    );
    return {
      isEditable: true,
      isAvailable: !taken,
      message: taken ? "Username is already in use" : "Username is available",
    };
  }, [adminOverview.users, editableUsername, normalizedUsername, userEditor.id]);

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      return;
    }
    setSettingsSaved(false);
    setSettingsMessage(null);
    if (!hasEnabledAuthProvider) {
      setSettingsMessage({ type: "error", text: "At least one sign-in provider must remain enabled." });
      return;
    }
    try {
      await onSaveSettings(settings);
      setSettingsSaved(true);
    } catch (error) {
      setSettingsMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save settings." });
    }
  }

  async function handleRoomSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      return;
    }
    setSettingsSaved(false);
    await onSaveRoomSettings(settings);
    setSettingsSaved(true);
  }

  async function handleUpdateSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      return;
    }
    setSettingsSaved(false);
    await onSaveUpdateSettings(settings);
    setSettingsSaved(true);
  }

  async function handleIntegrationSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      return;
    }
    setSettingsSaved(false);
    await onSaveIntegrationSettings({ jira: settings.integrations.jira });
    setSettingsSaved(true);
  }

  async function handleJiraTest() {
    if (!settings) {
      return;
    }
    setJiraTestModalOpen(true);
    setJiraTestBusy(true);
    setJiraTestError("");
    setJiraTestResult(null);
    try {
      const result = await onTestJira(settings.integrations.jira);
      setJiraTestResult(result);
    } catch (error) {
      setJiraTestError(error instanceof Error ? error.message : "Unable to connect to Jira.");
    } finally {
      setJiraTestBusy(false);
    }
  }

  async function handleManualUpdateCheck() {
    setUpdateCheckBusy(true);
    try {
      await onCheckForUpdates();
      setUpdateCheckDone(true);
    } catch {
      setUpdateCheckDone(false);
    } finally {
      setUpdateCheckBusy(false);
    }
  }

  async function handleTestActiveDirectoryConnection() {
    if (!settings || !isActiveDirectoryEnabled || adTestBusy) {
      return;
    }

    setAdTestModalOpen(true);
    setAdTestBusy(true);
    setAdTestError("");
    setAdTestResult(null);
    try {
      const result = await onTestActiveDirectory(settings, adTestIdentifier.trim());
      setAdTestResult(result);
    } catch (error) {
      setAdTestResult(null);
      setAdTestError(error instanceof Error ? error.message : "Unable to test the Active Directory connection.");
    } finally {
      setAdTestBusy(false);
    }
  }

  function updateAutoAnonymizeTask(
    patch: Partial<SettingsOverview["scheduledTasks"]["autoAnonymizeDeactivatedUsers"]>
  ) {
    if (!settings) {
      return;
    }

    setSettings({
      ...settings,
      scheduledTasks: {
        ...settings.scheduledTasks,
        autoAnonymizeDeactivatedUsers: {
          ...DEFAULT_AUTO_ANONYMIZE_TASK,
          ...(settings.scheduledTasks?.autoAnonymizeDeactivatedUsers || {}),
          ...patch,
        },
      },
    });
  }

  async function handleRunScheduledTask(taskKey: string, taskLabel: string) {
    if (runningTaskKey) {
      return;
    }
    setDeleteConfirmId(taskKey);
    setScheduledTaskRunLabel(taskLabel);
    setDeleteConfirmType("scheduled-task-run");
    setDeleteConfirmOpen(true);
  }

  async function handleTabChange(nextTab: AdminTab) {
    await onRefreshOverview();
    setActiveTab(nextTab);
  }

  async function handleToggleScheduledTask(taskKey: keyof typeof scheduledTasksOpen) {
    const shouldOpen = !scheduledTasksOpen[taskKey];
    if (shouldOpen) {
      await onRefreshOverview();
    }
    setScheduledTasksOpen((current) => ({
      ...current,
      [taskKey]: !current[taskKey],
    }));
  }

  function updateAutoCloseRoomsTask(
    patch: Partial<SettingsOverview["scheduledTasks"]["autoCloseRooms"]>
  ) {
    if (!settings) {
      return;
    }

    setSettings({
      ...settings,
      scheduledTasks: {
        ...settings.scheduledTasks,
        autoCloseRooms: {
          ...DEFAULT_AUTO_CLOSE_ROOMS_TASK,
          ...(settings.scheduledTasks?.autoCloseRooms || {}),
          ...patch,
        },
      },
    });
  }

  function updateSyncActiveDirectoryUsersTask(
    patch: Partial<SettingsOverview["scheduledTasks"]["syncActiveDirectoryUsers"]>
  ) {
    if (!settings) {
      return;
    }

    setSettings({
      ...settings,
      scheduledTasks: {
        ...settings.scheduledTasks,
        syncActiveDirectoryUsers: {
          ...DEFAULT_SYNC_ACTIVE_DIRECTORY_USERS_TASK,
          ...(settings.scheduledTasks?.syncActiveDirectoryUsers || {}),
          ...patch,
        },
      },
    });
  }

  function updateCheckForUpdatesTask(
    patch: Partial<SettingsOverview["scheduledTasks"]["checkForUpdates"]>
  ) {
    if (!settings) {
      return;
    }

    setSettings({
      ...settings,
      scheduledTasks: {
        ...settings.scheduledTasks,
        checkForUpdates: {
          ...DEFAULT_CHECK_FOR_UPDATES_TASK,
          ...(settings.scheduledTasks?.checkForUpdates || {}),
          ...patch,
        },
      },
    });
  }

  function updateAutoCloseInactiveSessionsTask(
    patch: Partial<SettingsOverview["scheduledTasks"]["autoCloseInactiveSessions"]>
  ) {
    if (!settings) {
      return;
    }

    setSettings({
      ...settings,
      scheduledTasks: {
        ...settings.scheduledTasks,
        autoCloseInactiveSessions: {
          ...DEFAULT_AUTO_CLOSE_INACTIVE_SESSIONS_TASK,
          ...(settings.scheduledTasks?.autoCloseInactiveSessions || {}),
          ...patch,
        },
      },
    });
  }

  async function handleBrandAssetChange(
    event: ChangeEvent<HTMLInputElement>,
    field: "logoDataUrl" | "faviconDataUrl"
  ) {
    if (!settings) {
      return;
    }
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setSettings({ ...settings, [field]: dataUrl });
    event.target.value = "";
  }

  function toggleSettingsSection(section: SettingsSectionKey) {
    setSettingsSectionsOpen((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  function openSettingsSection(section: SettingsSectionKey) {
    setSettingsSectionsOpen((current) => ({
      ...current,
      [section]: true,
    }));
  }

  async function handleCreateDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = parseDeckValues(newDeck.values);
    if (!newDeck.name.trim() || values.length === 0) return;
    setDeckBusy(true);
    try {
      await onCreateDeck(newDeck.name.trim(), values);
      setNewDeck({ name: "", values: "" });
    } finally {
      setDeckBusy(false);
    }
  }

  async function handleUpdateDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDeck) return;
    const values = parseDeckValues(editingDeck.values);
    if (!editingDeck.name.trim() || values.length === 0) return;
    setDeckModalSaving(true);
    try {
      await onUpdateDeck(editingDeck.id, editingDeck.name.trim(), values);
      setDeckSaved(true);
    } finally {
      setDeckModalSaving(false);
    }
  }

  async function handleDeleteDeck(deck: Deck) {
    setDeleteConfirmType("deck");
    setDeleteConfirmId(deck.id);
    setDeckDeleteName(deck.name);
    setDeleteConfirmOpen(true);
  }

  function openEditDeckModal(deck: Deck) {
    setEditingDeck({ id: deck.id, name: deck.name, values: deck.values.join(", ") });
    setDeckSaved(false);
    setDeckModalOpen(true);
  }

  function handlePasswordChange(newPassword: string) {
    setUserEditor({ ...userEditor, password: newPassword });
    if (settings) {
      const validation = validatePassword(newPassword, settings.minPasswordLength, settings.requirePasswordComplexity);
      setPasswordValidation(validation);
    }
  }

  function openCreateUserModal() {
    if (!isLocalAuthEnabled) {
      return;
    }
    setUserEditor({
      username: "",
      displayName: "",
      email: "",
      authSource: "local",
      entraLinked: false,
      entraMigrationState: "",
      entraMigrationPreparedAt: null,
      entraMigrationPromptCount: 0,
      entraMigrationForceAt: null,
      isActive: true,
      deactivatedUsername: "",
      anonymizedAt: null,
      password: "",
      passwordConfirm: "",
      avatarDataUrl: "",
      avatarManagedByAuthSource: "",
      roles: ["user"]
    });
    setPasswordValidation({
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
    setUserSaved(false);
    setUserModalMessage(null);
    setUserAvatarMenuOpen(false);
    setUserModalOpen(true);
  }

  function openEditUserModal(targetUser: User) {
    setUserEditor({
      id: targetUser.id,
      username: targetUser.anonymizedAt ? targetUser.username : (targetUser.deactivatedUsername || targetUser.username),
      displayName: targetUser.displayName,
      email: targetUser.email,
      authSource: targetUser.authSource || "local",
      entraLinked: Boolean(targetUser.entraLinked),
      entraMigrationState: targetUser.entraMigrationState || "",
      entraMigrationPreparedAt: targetUser.entraMigrationPreparedAt || null,
      entraMigrationPromptCount: Number(targetUser.entraMigrationPromptCount || 0),
      entraMigrationForceAt: targetUser.entraMigrationForceAt || null,
      isActive: targetUser.isActive !== false,
      deactivatedUsername: targetUser.deactivatedUsername || "",
      anonymizedAt: targetUser.anonymizedAt || null,
      password: "",
      passwordConfirm: "",
      avatarDataUrl: targetUser.avatarDataUrl || "",
      avatarManagedByAuthSource: targetUser.avatarManagedByAuthSource || "",
      roles: [...targetUser.roles]
    });
    setUserSaved(false);
    setUserModalMessage(null);
    setUserAvatarMenuOpen(false);
    setUserModalOpen(true);
  }

  async function saveUserEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserModalMessage(null);
    
    if (userEditor.authSource === "local") {
      if (editableUsername && !usernameAvailability.isAvailable) {
        setUserModalMessage({ type: "error", text: usernameAvailability.message });
        return;
      }
      if (!userEditor.id && !userEditor.password) {
        setUserModalMessage({ type: "error", text: "Password is required for new local users." });
        return;
      }
      if (userEditor.id && !userEditor.isActive && !userEditor.password) {
        setUserModalMessage({ type: "error", text: "A new password is required to reactivate this user." });
        return;
      }
      if (userEditor.password && !validatePasswordMatch(userEditor.password, userEditor.passwordConfirm || "")) {
        setUserModalMessage({ type: "error", text: "Passwords do not match." });
        return;
      }
      if (userEditor.password && !passwordValidation.isValid) {
        setUserModalMessage({ type: "error", text: "Password does not meet requirements." });
        return;
      }
    }

    setUserModalSaving(true);
    try {
      if (userEditor.id) {
        if (!userEditor.isActive && userEditor.authSource === "local") {
          await onReactivateUser(userEditor.id, {
            username: userEditor.username,
            displayName: userEditor.displayName,
            email: userEditor.email,
            password: userEditor.password,
            avatarDataUrl: userEditor.avatarDataUrl,
            roles: userEditor.roles
          });
          setUserEditor((current) => ({
            ...current,
            isActive: true,
            deactivatedUsername: "",
            anonymizedAt: null,
            password: "",
            passwordConfirm: "",
            avatarManagedByAuthSource: "",
          }));
        } else {
          await onUpdateUser(userEditor.id, {
            displayName: userEditor.displayName,
            email: userEditor.email,
            authSource: userEditor.authSource,
            password: userEditor.password.trim() || undefined,
            avatarDataUrl: userEditor.authSource === "local" ? userEditor.avatarDataUrl : "",
            roles: userEditor.roles
          });
        }
      } else {
        const createdUser = await onCreateUser({
          username: userEditor.username,
          displayName: userEditor.displayName,
          email: userEditor.email,
          authSource: userEditor.authSource,
          password: userEditor.password,
          avatarDataUrl: userEditor.authSource === "local" ? userEditor.avatarDataUrl : "",
          roles: userEditor.roles
        });
        if (createdUser) {
          setUserEditor({
            id: createdUser.id,
            username: createdUser.username,
            displayName: createdUser.displayName,
            email: createdUser.email,
            authSource: createdUser.authSource || "local",
            entraLinked: Boolean(createdUser.entraLinked),
            isActive: createdUser.isActive !== false,
            deactivatedUsername: createdUser.deactivatedUsername || "",
            anonymizedAt: createdUser.anonymizedAt || null,
            password: "",
            passwordConfirm: "",
            avatarDataUrl: createdUser.avatarDataUrl || "",
            avatarManagedByAuthSource: createdUser.avatarManagedByAuthSource || "",
            roles: [...createdUser.roles]
          });
        }
      }
      setUserSaved(true);
    } finally {
      setUserModalSaving(false);
    }
  }

  function openCreateRoleModal() {
    setRoleEditor({ name: "", description: "", adGroupName: "", entraAppRoleValue: "", entraGroupId: "", permissions: [] });
    setRoleSaved(false);
    setRoleMessage(null);
    setRoleModalOpen(true);
  }

  function openEditRoleModal(role: Role) {
    setRoleEditor({
      id: role.id,
      name: role.name,
      description: role.description,
      adGroupName: role.adGroupName || "",
      entraAppRoleValue: role.entraAppRoleValue || "",
      entraGroupId: role.entraGroupId || "",
      permissions: [...role.permissions]
    });
    setRoleSaved(false);
    setRoleMessage(null);
    setRoleModalOpen(true);
  }

  async function saveRoleEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRoleMessage(null);
    setRoleModalSaving(true);
    try {
      if (roleEditor.id) {
        await onUpdateRole(roleEditor.id, {
          name: roleEditor.name,
          description: roleEditor.description,
          adGroupName: roleEditor.adGroupName,
          entraAppRoleValue: roleEditor.entraAppRoleValue,
          entraGroupId: roleEditor.entraGroupId,
          permissions: roleEditor.permissions
        });
      } else {
        await onCreateRole({
          name: roleEditor.name,
          description: roleEditor.description,
          adGroupName: roleEditor.adGroupName,
          entraAppRoleValue: roleEditor.entraAppRoleValue,
          entraGroupId: roleEditor.entraGroupId,
          permissions: roleEditor.permissions
        });
      }
      setRoleSaved(true);
    } catch (error) {
      setRoleMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save role" });
    } finally {
      setRoleModalSaving(false);
    }
  }

  function renderUserRow(current: User) {
    return (
      <div className="admin-row admin-row--users" key={current.id}>
        <span className="admin-user-name" data-label="Name">
          <span className="avatar-circle admin-user-name__avatar">
            {current.avatarDataUrl ? <img alt={current.displayName} src={current.avatarDataUrl} /> : getAvatarInitials(current.displayName)}
          </span>
          <span>{current.displayName}</span>
        </span>
        <span data-label="Username">{current.anonymizedAt ? current.username : (current.deactivatedUsername || current.username)}</span>
        <span data-label="Status">{formatUserStatus(current)}</span>
        <span data-label="Auth source">
          {formatAuthSourceLabel(current.authSource || "local")}
          {current.entraMigrationState === "pending" ? " • Pending Entra migration" : ""}
        </span>
        <span data-label="Roles">{current.roles.join(", ")}</span>
        <button className="icon-button" data-label="Action" onClick={() => openEditUserModal(current)} type="button" title="Edit user">
          &#9998;
        </button>
      </div>
    );
  }

  function renderTabContent() {
    switch (activeTab) {
      case "settings":
        return (
          <section className="admin-section">
            <h2>Settings</h2>
            {settings ? (
              <form className="settings-list" onSubmit={(event) => void handleSettingsSubmit(event)}>
                <div className="settings-category">
                  <button
                    className={`settings-category__toggle ${settingsSectionsOpen.authentication ? "is-open" : ""}`}
                    onClick={() => toggleSettingsSection("authentication")}
                    type="button"
                  >
                    <span>Authentication & Passwords</span>
                    <span className="settings-category__chevron">{settingsSectionsOpen.authentication ? "▾" : "▸"}</span>
                  </button>
                  {settingsSectionsOpen.authentication ? (
                    <div className="settings-category__content">
                      <div className="settings-auth-row">
                        <label>
                          {renderFieldLabel("Login method")}
                          <select
                            value={settings.loginMethod}
                            onChange={(event) => setSettings({ ...settings, loginMethod: event.target.value as "username" | "email" | "both" })}
                          >
                            <option value="username">Username</option>
                            <option value="email">Email</option>
                            <option value="both">Email / Username</option>
                          </select>
                        </label>
                        <p className="settings-help settings-help--muted settings-auth-row__note">
                          Applies to Local and Microsoft Active Directory sign-in. Microsoft Entra uses its own redirect flow.
                        </p>
                      </div>
                      <div className={`settings-subcategory ${localSettingsOpen ? "is-open" : ""}`}>
                        <button
                          className="settings-subcategory__toggle"
                          onClick={() => setLocalSettingsOpen((current) => !current)}
                          type="button"
                        >
                          <span>Local</span>
                          <span className="settings-subcategory__meta">
                            {!localSettingsOpen ? (
                              <span className={`settings-subcategory__status ${isLocalAuthEnabled ? "is-enabled" : "is-disabled"}`}>
                                {isLocalAuthEnabled ? "Enabled" : "Disabled"}
                              </span>
                            ) : null}
                            <span className="settings-subcategory__chevron">{localSettingsOpen ? "◂" : "▸"}</span>
                          </span>
                        </button>
                        {localSettingsOpen ? (
                          <div className="settings-subcategory__content">
                            <div className="settings-toggle settings-subcategory__toggle-row">
                              <button
                                aria-pressed={settings.localAuthEnabled}
                                className={`toggle-switch ${settings.localAuthEnabled ? "is-active" : ""}`}
                                onClick={() => setSettings({ ...settings, localAuthEnabled: !settings.localAuthEnabled })}
                                type="button"
                                title="Toggle local accounts"
                              >
                                <span className="toggle-switch__knob" />
                              </button>
                              <span>Enable local accounts</span>
                            </div>
                            {!isLocalAuthEnabled ? (
                              <p className="settings-help settings-help--muted">
                                Local usernames and passwords cannot be used to sign in, and new local users cannot be created while this is off.
                              </p>
                            ) : null}

                            <div className={`settings-subcategory ${passwordPolicyOpen ? "is-open" : ""} ${!isLocalAuthEnabled ? "is-disabled" : ""}`}>
                              <button
                                className="settings-subcategory__toggle"
                                onClick={() => setPasswordPolicyOpen((current) => !current)}
                                type="button"
                              >
                                <span>Password Policy</span>
                                <span className="settings-subcategory__chevron">{passwordPolicyOpen ? "◂" : "▸"}</span>
                              </button>
                              {passwordPolicyOpen ? (
                                <div className="settings-subcategory__content">
                                  <label>
                                    <span>Minimum password length</span>
                                    <input
                                      disabled={!isLocalAuthEnabled}
                                      min={6}
                                      max={32}
                                      type="number"
                                      value={settings.minPasswordLength}
                                      onChange={(event) =>
                                        setSettings({ ...settings, minPasswordLength: Number(event.target.value) || 8 })
                                      }
                                    />
                                  </label>
                                  <div className="settings-toggle">
                                    <button
                                      className={`toggle-switch ${settings.requirePasswordComplexity ? "is-active" : ""} ${!isLocalAuthEnabled ? "is-disabled" : ""}`}
                                      disabled={!isLocalAuthEnabled}
                                      onClick={() => setSettings({ ...settings, requirePasswordComplexity: !settings.requirePasswordComplexity })}
                                      type="button"
                                      title="Toggle requirement"
                                    >
                                      <span className="toggle-switch__knob" />
                                    </button>
                                    <span>Require password complexity</span>
                                  </div>
                                  {!isLocalAuthEnabled ? (
                                    <p className="settings-help settings-help--muted">
                                      Password policy stays visible here, but it only applies when local accounts are enabled.
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className={`settings-subcategory ${adSettingsOpen ? "is-open" : ""} ${!isActiveDirectoryEnabled ? "is-disabled" : ""}`}>
                        <button
                          className="settings-subcategory__toggle"
                          onClick={() => setAdSettingsOpen((current) => !current)}
                          type="button"
                        >
                          <span>Microsoft Active Directory</span>
                          <span className="settings-subcategory__meta">
                            {!adSettingsOpen ? (
                              <span className={`settings-subcategory__status ${isActiveDirectoryEnabled ? "is-enabled" : "is-disabled"}`}>
                                {isActiveDirectoryEnabled ? "Enabled" : "Disabled"}
                              </span>
                            ) : null}
                            <span className="settings-subcategory__chevron">{adSettingsOpen ? "◂" : "▸"}</span>
                          </span>
                        </button>
                        {adSettingsOpen ? (
                          <div className="settings-subcategory__content">
                            <div className="settings-toggle settings-subcategory__toggle-row">
                              <button
                                aria-pressed={settings.activeDirectoryEnabled}
                                className={`toggle-switch ${settings.activeDirectoryEnabled ? "is-active" : ""}`}
                                onClick={() =>
                                  setSettings({
                                    ...settings,
                                    activeDirectoryEnabled: !settings.activeDirectoryEnabled,
                                  })
                                }
                                type="button"
                                title="Toggle Microsoft Active Directory"
                              >
                                <span className="toggle-switch__knob" />
                              </button>
                              <span>Enable Microsoft Active Directory</span>
                            </div>
                            <label>
                              {renderFieldLabel("Server / URL", isActiveDirectoryEnabled)}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="ldap://ad.company.local"
                                type="text"
                                value={settings.adServerUrl}
                                onChange={(event) => setSettings({ ...settings, adServerUrl: event.target.value })}
                              />
                            </label>
                            <label>
                              {renderFieldLabel("Port")}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                min={1}
                                max={65535}
                                type="number"
                                value={settings.adServerPort}
                                onChange={(event) => setSettings({ ...settings, adServerPort: Number(event.target.value) || 389 })}
                              />
                            </label>
                            <label>
                              {renderFieldLabel("Connection security")}
                              <select
                                disabled={!isActiveDirectoryEnabled}
                                value={settings.adConnectionSecurity}
                                onChange={(event) =>
                                  setSettings({
                                    ...settings,
                                    adConnectionSecurity: event.target.value as "ldap" | "ldaps" | "starttls",
                                    adServerPort:
                                      event.target.value === "ldaps"
                                        ? 636
                                        : settings.adServerPort === 636
                                          ? 389
                                          : settings.adServerPort || 389,
                                  })
                                }
                              >
                                <option value="ldap">LDAP</option>
                                <option value="starttls">LDAP + StartTLS</option>
                                <option value="ldaps">LDAPS</option>
                              </select>
                            </label>
                            <label>
                              {renderFieldLabel("Base DN", isActiveDirectoryEnabled)}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="DC=company,DC=local"
                                type="text"
                                value={settings.adBaseDn}
                                onChange={(event) => setSettings({ ...settings, adBaseDn: event.target.value })}
                              />
                            </label>
                            <label>
                              {renderFieldLabel("Bind username (UPN)", isActiveDirectoryEnabled)}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="sprinto@company.local"
                                type="text"
                                value={settings.adBindUsername}
                                onChange={(event) => setSettings({ ...settings, adBindUsername: event.target.value })}
                              />
                            </label>
                            <label>
                              {renderFieldLabel("Bind password", isActiveDirectoryEnabled)}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="Service account password"
                                type="password"
                                value={settings.adBindPassword}
                                onChange={(event) => setSettings({ ...settings, adBindPassword: event.target.value })}
                              />
                            </label>
                            <label>
                              {renderFieldLabel("Login attribute")}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="sAMAccountName"
                                type="text"
                                value={settings.adLoginAttribute}
                                onChange={(event) => setSettings({ ...settings, adLoginAttribute: event.target.value })}
                              />
                            </label>
                            <label>
                              {renderFieldLabel("Email attribute")}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="mail"
                                type="text"
                                value={settings.adEmailAttribute}
                                onChange={(event) => setSettings({ ...settings, adEmailAttribute: event.target.value })}
                              />
                            </label>
                            <label>
                              {renderFieldLabel("Display name attribute")}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="displayName"
                                type="text"
                                value={settings.adDisplayNameAttribute}
                                onChange={(event) => setSettings({ ...settings, adDisplayNameAttribute: event.target.value })}
                              />
                            </label>
                            <label>
                              {renderFieldLabel("External ID attribute")}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="objectGUID"
                                type="text"
                                value={settings.adExternalIdAttribute}
                                onChange={(event) => setSettings({ ...settings, adExternalIdAttribute: event.target.value })}
                              />
                            </label>
                            <label>
                              {renderFieldLabel("Avatar attribute")}
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="thumbnailPhoto"
                                type="text"
                                value={settings.adAvatarAttribute}
                                onChange={(event) => setSettings({ ...settings, adAvatarAttribute: event.target.value })}
                              />
                            </label>
                            <div className="settings-subcategory__divider" />
                            {isSecureDirectoryConnection ? (
                              <>
                                <div className="settings-subcategory__cell settings-subcategory__cell--left">
                                  <div className="settings-subcategory__field-spacer">
                                    <span aria-hidden="true">Certificate actions</span>
                                    <button
                                      className="secondary-action"
                                      disabled={!isActiveDirectoryEnabled}
                                      onClick={() => setAdCertificateModalOpen(true)}
                                      type="button"
                                    >
                                      {settings.adCaCertificate ? "Edit CA certificate" : "Add CA certificate"}
                                    </button>
                                  </div>
                                </div>
                                <div className="settings-subcategory__cell settings-subcategory__cell--right settings-subcategory__action-row">
                                  <div className="settings-subcategory__field-spacer">
                                    <span aria-hidden="true">Allow untrusted certificate</span>
                                    <div className="settings-toggle settings-subcategory__inline-toggle">
                                      <button
                                        aria-pressed={settings.adAllowUntrustedCertificate}
                                        className={`toggle-switch ${settings.adAllowUntrustedCertificate ? "is-active" : ""}`}
                                        disabled={!isActiveDirectoryEnabled}
                                        onClick={() =>
                                          setSettings({
                                            ...settings,
                                            adAllowUntrustedCertificate: !settings.adAllowUntrustedCertificate,
                                          })
                                        }
                                        type="button"
                                      >
                                        <span className="toggle-switch__knob" />
                                      </button>
                                      <span>Allow untrusted certificate</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="settings-subcategory__divider" />
                              </>
                            ) : null}
                            <label>
                              <span>Test user login / email</span>
                              <input
                                disabled={!isActiveDirectoryEnabled}
                                placeholder="a.user or a.user@company.local"
                                type="text"
                                value={adTestIdentifier}
                                onChange={(event) => setAdTestIdentifier(event.target.value)}
                              />
                            </label>
                            <div className="settings-subcategory__cell settings-subcategory__cell--right settings-subcategory__cell--button settings-subcategory__action-row">
                              <div className="settings-subcategory__field-spacer">
                                <span aria-hidden="true">Test connection</span>
                                <button
                                  className={`secondary-action ${adTestBusy ? "is-pending" : ""}`}
                                  disabled={!isActiveDirectoryEnabled || adTestBusy}
                                  onClick={handleTestActiveDirectoryConnection}
                                  type="button"
                                >
                                  {adTestBusy ? "Testing..." : "Test connection"}
                                </button>
                              </div>
                            </div>
                            {!hasEnabledAuthProvider ? (
                              <p className="settings-help settings-help--muted">
                                At least one sign-in provider must remain enabled before these settings can be saved.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className={`settings-subcategory ${entraSettingsOpen ? "is-open" : ""} ${!isEntraEnabled ? "is-disabled" : ""}`}>
                        <button
                          className="settings-subcategory__toggle"
                          onClick={() => setEntraSettingsOpen((current) => !current)}
                          type="button"
                        >
                          <span>Microsoft Entra</span>
                          <span className="settings-subcategory__meta">
                            {!entraSettingsOpen ? (
                              <span className={`settings-subcategory__status ${isEntraEnabled ? "is-enabled" : "is-disabled"}`}>
                                {isEntraEnabled ? "Enabled" : "Disabled"}
                              </span>
                            ) : null}
                            <span className="settings-subcategory__chevron">{entraSettingsOpen ? "◂" : "▸"}</span>
                          </span>
                        </button>
                        {entraSettingsOpen ? (
                          <div className="settings-subcategory__content">
                            <div className="settings-toggle settings-subcategory__toggle-row">
                              <button
                                aria-pressed={settings.entraAuthEnabled}
                                className={`toggle-switch ${settings.entraAuthEnabled ? "is-active" : ""}`}
                                onClick={() =>
                                  setSettings({
                                    ...settings,
                                    entraAuthEnabled: !settings.entraAuthEnabled,
                                  })
                                }
                                type="button"
                                title="Toggle Microsoft Entra"
                              >
                                <span className="toggle-switch__knob" />
                              </button>
                              <span>Enable Microsoft Entra</span>
                            </div>
                            <div className="settings-auth-provider-grid">
                              <label className="settings-auth-provider-grid__client-id">
                                {renderFieldLabel("Client ID", isEntraEnabled)}
                                <input
                                  disabled={!isEntraEnabled}
                                  placeholder="Application (client) ID"
                                  type="text"
                                  value={settings.entraClientId}
                                  onChange={(event) => setSettings({ ...settings, entraClientId: event.target.value })}
                                />
                              </label>
                              <label className="settings-auth-provider-grid__client-secret">
                                {renderFieldLabel("Client secret", isEntraClientSecretRequired)}
                                <input
                                  disabled={!isEntraEnabled}
                                  placeholder={settings.entraClientSecretConfigured ? "Configured, enter to replace" : "Client secret"}
                                  type="password"
                                  value={settings.entraClientSecret}
                                  onChange={(event) => setSettings({ ...settings, entraClientSecret: event.target.value })}
                                />
                              </label>
                              <label className="settings-auth-provider-grid__tenant-id">
                                {renderFieldLabel("Tenant ID", isEntraEnabled)}
                                <input
                                  disabled={!isEntraEnabled}
                                  placeholder="contoso.onmicrosoft.com or tenant GUID"
                                  type="text"
                                  value={settings.entraTenantId}
                                  onChange={(event) => setSettings({ ...settings, entraTenantId: event.target.value })}
                                />
                              </label>
                              <label className="settings-auth-provider-grid__callback-url">
                                {renderFieldLabel("Callback URL")}
                                <input
                                  disabled
                                  readOnly
                                  type="text"
                                  value={settings.publicBaseUrl ? `${settings.publicBaseUrl.replace(/\/+$/, "")}/api/auth/entra/callback` : "Set Public base URL in HTTPS & Proxy first"}
                                />
                              </label>
                              <div className={`settings-subcategory settings-auth-provider-grid__migration ${entraMigrationSettingsOpen ? "is-open" : ""}`}>
                                <button
                                  className="settings-subcategory__toggle"
                                  onClick={() => setEntraMigrationSettingsOpen((current) => !current)}
                                  type="button"
                                >
                                  <span>Migration policy</span>
                                  <span className="settings-subcategory__chevron">{entraMigrationSettingsOpen ? "◂" : "▸"}</span>
                                </button>
                                {entraMigrationSettingsOpen ? (
                                  <div className="settings-subcategory__content settings-subcategory__content--compact">
                                    <div className="settings-toggle settings-subcategory__toggle-row">
                                      <button
                                        aria-pressed={settings.entraMigrationEnabled !== false}
                                        className={`toggle-switch ${settings.entraMigrationEnabled !== false ? "is-active" : ""}`}
                                        onClick={() =>
                                          setSettings({
                                            ...settings,
                                            entraMigrationEnabled: settings.entraMigrationEnabled === false,
                                          })
                                        }
                                        type="button"
                                        title="Toggle Entra migration"
                                      >
                                        <span className="toggle-switch__knob" />
                                      </button>
                                      <span>Enable Entra migration</span>
                                    </div>
                                    <label>
                                      <span className="settings-auth-provider-grid__migration-label">Prompted logins before enforcement</span>
                                      <input
                                        disabled={settings.entraMigrationEnabled === false}
                                        min={1}
                                        type="number"
                                        value={settings.entraMigrationPromptLoginCount}
                                        onChange={(event) =>
                                          setSettings({
                                            ...settings,
                                            entraMigrationPromptLoginCount: Math.max(1, Number(event.target.value || 1)),
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>Default enforce-at date/time</span>
                                      <input
                                        disabled={settings.entraMigrationEnabled === false}
                                        type="datetime-local"
                                        value={settings.entraMigrationForceAtDefault ? settings.entraMigrationForceAtDefault.slice(0, 16) : ""}
                                        onChange={(event) =>
                                          setSettings({
                                            ...settings,
                                            entraMigrationForceAtDefault: event.target.value ? new Date(event.target.value).toISOString() : "",
                                          })
                                        }
                                      />
                                    </label>
                                  </div>
                                ) : null}
                              </div>
                              <div className="settings-toggle settings-subcategory__inline-toggle settings-auth-provider-grid__logout">
                                <button
                                  aria-pressed={settings.entraGlobalLogoutEnabled}
                                  className={`toggle-switch ${settings.entraGlobalLogoutEnabled ? "is-active" : ""}`}
                                  onClick={() =>
                                    setSettings({
                                      ...settings,
                                      entraGlobalLogoutEnabled: !settings.entraGlobalLogoutEnabled,
                                    })
                                  }
                                  type="button"
                                  title="Toggle Microsoft logout"
                                >
                                  <span className="toggle-switch__knob" />
                                </button>
                                <span>Sign out from Microsoft session too</span>
                              </div>
                            </div>
                            <div className={`settings-provider-note ${!hasPublicBaseUrl ? "is-warning" : ""}`}>
                              <p className="settings-help settings-help--muted">
                                <span className="settings-provider-note__line">
                                  Public base URL is managed in HTTPS & Proxy and is required for Microsoft Entra.
                                </span>
                                <span className="settings-provider-note__line">The callback URL above is derived from it.</span>
                              </p>
                              <button
                                className="secondary-action"
                                onClick={() => openSettingsSection("network")}
                                type="button"
                              >
                                Open HTTPS & Proxy
                              </button>
                            </div>
                            {!hasEnabledAuthProvider ? (
                              <p className="settings-help settings-help--muted">
                                At least one sign-in provider must remain enabled before these settings can be saved.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="settings-category">
                  <button
                    className={`settings-category__toggle ${settingsSectionsOpen.network ? "is-open" : ""}`}
                    onClick={() => toggleSettingsSection("network")}
                    type="button"
                  >
                    <span>HTTPS & Proxy</span>
                    <span className="settings-category__chevron">{settingsSectionsOpen.network ? "▾" : "▸"}</span>
                  </button>
                  {settingsSectionsOpen.network ? (
                    <div className="settings-category__content">
                      <div className="settings-toggle">
                        <button
                          className={`toggle-switch ${settings.httpsEnabled ? "is-active" : ""}`}
                          onClick={() => setSettings({ ...settings, httpsEnabled: !settings.httpsEnabled })}
                          type="button"
                          title="Toggle HTTPS mode"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Enable HTTPS directly in the application</span>
                      </div>
                      <div className="settings-toggle">
                        <button
                          className={`toggle-switch ${settings.trustProxy ? "is-active" : ""}`}
                          onClick={() => setSettings({ ...settings, trustProxy: !settings.trustProxy })}
                          type="button"
                          title="Toggle proxy trust"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Trust reverse proxy headers</span>
                      </div>
                      <label>
                        {renderFieldLabel("Public base URL", isEntraEnabled)}
                        <input
                          placeholder="https://sprinto.company.com"
                          type="text"
                          value={settings.publicBaseUrl}
                          onChange={(event) => setSettings({ ...settings, publicBaseUrl: event.target.value })}
                        />
                      </label>
                      <label>
                        {renderFieldLabel("TLS certificate path", isDirectHttpsEnabled)}
                        <input
                          disabled={!settings.httpsEnabled}
                          placeholder="/run/secrets/sprinto.crt"
                          type="text"
                          value={settings.tlsCertPath}
                          onChange={(event) => setSettings({ ...settings, tlsCertPath: event.target.value })}
                        />
                      </label>
                      <label>
                        {renderFieldLabel("TLS key path", isDirectHttpsEnabled)}
                        <input
                          disabled={!settings.httpsEnabled}
                          placeholder="/run/secrets/sprinto.key"
                          type="text"
                          value={settings.tlsKeyPath}
                          onChange={(event) => setSettings({ ...settings, tlsKeyPath: event.target.value })}
                        />
                      </label>
                      <p className="settings-help settings-help--muted">
                        Leave direct HTTPS disabled when Sprinto runs behind Nginx, Traefik, Caddy, or another reverse proxy.
                      </p>
                      <p className="settings-help settings-help--muted">
                        If direct HTTPS is enabled, both TLS file paths must be provided. Reverse proxy trust can be enabled independently.
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="settings-category">
                  <button
                    className={`settings-category__toggle ${settingsSectionsOpen.branding ? "is-open" : ""}`}
                    onClick={() => toggleSettingsSection("branding")}
                    type="button"
                  >
                    <span>Branding</span>
                    <span className="settings-category__chevron">{settingsSectionsOpen.branding ? "▾" : "▸"}</span>
                  </button>
                  {settingsSectionsOpen.branding ? (
                    <div className="settings-category__content">
                      <div className="branding-grid">
                        <div className="branding-panel">
                          <strong className="branding-panel__title">Logo</strong>
                          <input
                            accept={SUPPORTED_LOGO_FORMATS}
                            className="branding-input"
                            onChange={(event) => void handleBrandAssetChange(event, "logoDataUrl")}
                            ref={brandingLogoInputRef}
                            type="file"
                          />
                          <div className="brand-preview branding-panel__preview">
                            {settings.logoDataUrl ? (
                              <img alt="Current logo preview" className="brand-logo brand-logo--settings" src={settings.logoDataUrl} />
                            ) : (
                              <strong className="brand-text">SPRINTO</strong>
                            )}
                          </div>
                          <div className="branding-actions">
                            <button
                              className="ghost-button"
                              onClick={() => brandingLogoInputRef.current?.click()}
                              type="button"
                            >
                              Upload logo
                            </button>
                            {settings.logoDataUrl ? (
                              <button
                                className="ghost-button"
                                onClick={() => setSettings({ ...settings, logoDataUrl: "" })}
                                type="button"
                              >
                                Remove logo
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className="branding-panel">
                          <strong className="branding-panel__title">Favicon</strong>
                          <input
                            accept={SUPPORTED_FAVICON_FORMATS}
                            className="branding-input"
                            onChange={(event) => void handleBrandAssetChange(event, "faviconDataUrl")}
                            ref={brandingFaviconInputRef}
                            type="file"
                          />
                          <div className="brand-preview branding-panel__preview">
                            {settings.faviconDataUrl ? (
                              <img alt="Current favicon preview" className="favicon-preview" src={settings.faviconDataUrl} />
                            ) : (
                              <span className="pill">No favicon set</span>
                            )}
                          </div>
                          <div className="branding-actions">
                            <button
                              className="ghost-button"
                              onClick={() => brandingFaviconInputRef.current?.click()}
                              type="button"
                            >
                              Upload favicon
                            </button>
                            {settings.faviconDataUrl ? (
                              <button
                                className="ghost-button"
                                onClick={() => setSettings({ ...settings, faviconDataUrl: "" })}
                                type="button"
                              >
                                Remove favicon
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="branding-notes">
                        <p className="settings-help">
                          Supported logo files: PNG, SVG, WEBP, JPG, JPEG. PNG is recommended because it supports transparent background.
                        </p>
                        <p className="settings-help">
                          Supported favicon files: PNG, ICO, SVG. PNG is recommended for transparent background and good browser support.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {settingsMessage ? (
                  <div className={`account-settings-message account-settings-message--${settingsMessage.type}`}>
                    {settingsMessage.text}
                  </div>
                ) : null}
                <button className={`button-center ${settingsSaved ? "saved" : ""}`} disabled={!hasEnabledAuthProvider} type="submit">
                  {settingsSaved ? "✓ Saved" : "Save settings"}
                </button>
              </form>
            ) : null}
          </section>
        );
      case "integrations":
        return (
          <section className="admin-section">
            <h2>Integrations</h2>
            {settings ? (
              <form className="settings-list" onSubmit={(event) => void handleIntegrationSettingsSubmit(event)}>
                <div className="settings-category">
                  <button
                    className={`settings-category__toggle ${jiraSettingsOpen ? "is-open" : ""}`}
                    onClick={() => setJiraSettingsOpen((current) => !current)}
                    type="button"
                  >
                    <span>Jira Cloud</span>
                    <span className="settings-category__chevron">{jiraSettingsOpen ? "▾" : "▸"}</span>
                  </button>
                  {jiraSettingsOpen ? (
                    <div className="settings-category__content">
                      <div className="settings-toggle">
                        <button
                          className={`toggle-switch ${settings.integrations.jira.enabled ? "is-active" : ""}`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                jira: { ...settings.integrations.jira, enabled: !settings.integrations.jira.enabled },
                              },
                            })
                          }
                          type="button"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Enable Jira Cloud integration</span>
                      </div>
                    <div className="jira-settings-grid">
                      <label className="jira-settings-grid__field">
                        <span>Jira URL</span>
                        <input
                          placeholder="https://company.atlassian.net"
                          type="text"
                          value={settings.integrations.jira.baseUrl}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                jira: { ...settings.integrations.jira, baseUrl: event.target.value },
                              },
                            })
                          }
                        />
                      </label>
                      <label className="jira-settings-grid__field">
                        <span>Service account email</span>
                        <input
                          placeholder="sprinto-bot@company.com"
                          type="text"
                          value={settings.integrations.jira.serviceAccountEmail}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                jira: { ...settings.integrations.jira, serviceAccountEmail: event.target.value },
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="jira-settings-token-row">
                      <label className="jira-settings-token-row__field">
                        <span>API token</span>
                        <div className="jira-token-input">
                          <input
                            placeholder={settings.integrations.jira.apiTokenConfigured ? "Configured, enter to replace" : "Atlassian API token"}
                            type="password"
                            value={settings.integrations.jira.apiToken}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                integrations: {
                                  ...settings.integrations,
                                  jira: {
                                    ...settings.integrations.jira,
                                    apiToken: event.target.value,
                                    clearStoredApiToken: false,
                                  },
                                },
                              })
                            }
                          />
                          {settings.integrations.jira.apiTokenConfigured ? (
                            <button
                              className="icon-button jira-token-input__clear"
                              onClick={() =>
                                setSettings({
                                  ...settings,
                                  integrations: {
                                    ...settings.integrations,
                                    jira: {
                                      ...settings.integrations.jira,
                                      apiToken: "",
                                      apiTokenConfigured: false,
                                      clearStoredApiToken: true,
                                    },
                                  },
                                })
                              }
                              title="Clear stored API token"
                              type="button"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      </label>
                      <div className="jira-settings-token-row__action">
                        <span aria-hidden="true">Service account email</span>
                        <button
                          className={`secondary-action ${jiraTestBusy ? "is-pending" : ""}`}
                          disabled={jiraTestBusy}
                          onClick={() => void handleJiraTest()}
                          type="button"
                        >
                          {jiraTestBusy ? "Testing..." : "Test connection"}
                        </button>
                      </div>
                    </div>
                    <div className="settings-subcategory__divider" />
                    <div className="jira-settings-toggle-grid">
                      <div className="settings-toggle">
                        <button
                          className={`toggle-switch ${settings.integrations.jira.writeStoryPointsEnabled ? "is-active" : ""}`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                jira: {
                                  ...settings.integrations.jira,
                                  writeStoryPointsEnabled: !settings.integrations.jira.writeStoryPointsEnabled,
                                },
                              },
                            })
                          }
                          type="button"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Enable Story Points writeback</span>
                      </div>
                      <div className="settings-toggle">
                        <button
                          className={`toggle-switch ${settings.integrations.jira.writeOriginalEstimateEnabled ? "is-active" : ""}`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                jira: {
                                  ...settings.integrations.jira,
                                  writeOriginalEstimateEnabled: !settings.integrations.jira.writeOriginalEstimateEnabled,
                                },
                              },
                            })
                          }
                          type="button"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Enable Original Estimate writeback</span>
                      </div>
                      <div className="settings-toggle">
                        <button
                          className={`toggle-switch ${settings.integrations.jira.writeAssigneeEnabled ? "is-active" : ""}`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                jira: {
                                  ...settings.integrations.jira,
                                  writeAssigneeEnabled: !settings.integrations.jira.writeAssigneeEnabled,
                                },
                              },
                            })
                          }
                          type="button"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Enable assignee writeback</span>
                      </div>
                      <div className="settings-toggle">
                        <button
                          className={`toggle-switch ${settings.integrations.jira.postCommentEnabled ? "is-active" : ""}`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                jira: {
                                  ...settings.integrations.jira,
                                  postCommentEnabled: !settings.integrations.jira.postCommentEnabled,
                                },
                              },
                            })
                          }
                          type="button"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Enable Jira comments</span>
                      </div>
                      <div className="settings-toggle">
                        <button
                          className={`toggle-switch ${settings.integrations.jira.postPdfEnabled ? "is-active" : ""}`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                jira: {
                                  ...settings.integrations.jira,
                                  postPdfEnabled: !settings.integrations.jira.postPdfEnabled,
                                },
                              },
                            })
                          }
                          type="button"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Enable PDF attachments</span>
                      </div>
                      <div className="settings-toggle">
                        <button
                          className={`toggle-switch ${settings.integrations.jira.offerKanbanBoards ? "is-active" : ""}`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              integrations: {
                                ...settings.integrations,
                                jira: {
                                  ...settings.integrations.jira,
                                  offerKanbanBoards: !settings.integrations.jira.offerKanbanBoards,
                                },
                              },
                            })
                          }
                          type="button"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Offer kanban boards in room import</span>
                      </div>
                    </div>
                    <label className="jira-settings-minutes-field">
                      <span>Minutes per Story Point</span>
                      <input
                        min={1}
                        type="number"
                        value={settings.integrations.jira.originalEstimateMinutesPerStoryPoint}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              jira: {
                                ...settings.integrations.jira,
                                originalEstimateMinutesPerStoryPoint: Number(event.target.value) || 30,
                              },
                            },
                          })
                        }
                      />
                    </label>
                    </div>
                  ) : null}
                </div>
                <button className={`button-center ${settingsSaved ? "saved" : ""}`} type="submit">
                  {settingsSaved ? "✓ Saved" : "Save integrations"}
                </button>
              </form>
            ) : null}
          </section>
        );
      case "updates":
        return (
          <section className="admin-section">
            <h2>Updates</h2>
            {settings ? (
              <form className="settings-list" onSubmit={(event) => void handleUpdateSettingsSubmit(event)}>
                <div className="settings-category">
                  <div className="settings-category__content">
                    <div className="settings-toggle">
                      <button
                        className={`toggle-switch ${settings.updatesEnabled ? "is-active" : ""}`}
                        onClick={() => setSettings({ ...settings, updatesEnabled: !settings.updatesEnabled })}
                        type="button"
                        title="Toggle update checks"
                      >
                        <span className="toggle-switch__knob" />
                      </button>
                      <span>Check GitHub for new Sprinto versions</span>
                    </div>

                    <label>
                      <span>Current version</span>
                      <input readOnly value={settings.currentVersion || "Unknown"} />
                    </label>

                    <label>
                      <span>Latest available version</span>
                      <input readOnly value={settings.updateLatestVersion || "No version checked yet"} />
                    </label>

                    <label>
                      <span>Last checked</span>
                      <input readOnly value={settings.updateLastCheckedAt ? new Date(settings.updateLastCheckedAt).toLocaleString() : "Not checked yet"} />
                    </label>

                    {settings.updateLatestReleaseUrl ? (
                      <p className="settings-help">
                        <a className="app-footer__link" href={settings.updateLatestReleaseUrl} rel="noreferrer" target="_blank">
                          Open release notes
                        </a>
                      </p>
                    ) : null}

                    {settings.updateAvailable ? (
                      <p className="settings-help">
                        A newer Sprinto version is available: <strong>{settings.updateLatestVersion}</strong>
                      </p>
                    ) : null}

                    {settings.updateCheckError ? (
                      <p className="settings-help settings-help--muted">
                        Last check error: {settings.updateCheckError}
                      </p>
                    ) : null}

                    <div className="admin-modal-actions admin-modal-actions--stacked">
                      <button className={`button-center ${settingsSaved ? "saved" : ""}`} type="submit">
                        {settingsSaved ? "✓ Saved" : "Save update settings"}
                      </button>
                      <button
                        className={`button-center button-center--small ${updateCheckDone ? "saved" : ""}`}
                        disabled={!settings.updatesEnabled || updateCheckBusy}
                        onClick={() => void handleManualUpdateCheck()}
                        type="button"
                      >
                        {updateCheckBusy ? "Checking..." : updateCheckDone ? "✓ Checked" : "Check now"}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            ) : null}
          </section>
        );
      case "rooms":
        return (
          <section className="admin-section">
            <h2>Rooms</h2>
            {settings ? (
              <form className="settings-list" onSubmit={(event) => void handleRoomSettingsSubmit(event)}>
                <div className="settings-category">
                  <div className="settings-category__content">
                    <label>
                      <span>Default timer (seconds)</span>
                      <input
                        min={1}
                        type="number"
                        value={settings.defaultTimerSeconds}
                        onChange={(event) =>
                          setSettings({ ...settings, defaultTimerSeconds: Number(event.target.value) || 1 })
                        }
                      />
                    </label>
                    <label>
                      <span>Default deck</span>
                      <select
                        value={settings.defaultDeck}
                        onChange={(event) => setSettings({ ...settings, defaultDeck: event.target.value })}
                      >
                        {adminOverview.decks.map((deck) => (
                          <option key={deck.id} value={deck.name}>{deck.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="settings-toggle">
                      <button
                        className={`toggle-switch ${settings.requireStoryId ? "is-active" : ""}`}
                        onClick={() => setSettings({ ...settings, requireStoryId: !settings.requireStoryId })}
                        type="button"
                        title="Toggle requirement"
                      >
                        <span className="toggle-switch__knob" />
                      </button>
                      <span>Require story ID</span>
                    </div>
                  </div>
                </div>
                <button className={`button-center ${settingsSaved ? "saved" : ""}`} type="submit">
                  {settingsSaved ? "✓ Saved" : "Save room settings"}
                </button>
              </form>
            ) : null}
          </section>
        );
      case "users":
        return (
          <section className="admin-section">
            <div className="admin-section__header">
              <h2>Users</h2>
              <button className="button-center" disabled={!isLocalAuthEnabled} onClick={openCreateUserModal} type="button">
                + Add new user
              </button>
            </div>
            <div className="admin-table">
              <div className="admin-row admin-row--head admin-row--users">
                <span>Name</span>
                <span>Username</span>
                <span>Status</span>
                <span>Auth source</span>
                <span>Roles</span>
                <span>Action</span>
              </div>
              {activeUsers.map(renderUserRow)}
            </div>
            {inactiveUsers.length ? (
              <div className="admin-collapsible">
                <button
                  aria-expanded={inactiveUsersOpen}
                  className={`admin-collapsible__trigger ${inactiveUsersOpen ? "is-open" : ""}`}
                  onClick={() => setInactiveUsersOpen((open) => !open)}
                  type="button"
                >
                  <span>Deactivated users</span>
                  <span>{inactiveUsers.length}</span>
                </button>
                {inactiveUsersOpen ? (
                  <div className="admin-table">
                    <div className="admin-row admin-row--head admin-row--users">
                      <span>Name</span>
                      <span>Username</span>
                      <span>Status</span>
                      <span>Auth source</span>
                      <span>Roles</span>
                      <span>Action</span>
                    </div>
                    {inactiveUsers.map(renderUserRow)}
                  </div>
                ) : null}
              </div>
            ) : null}
            {anonymizedUsers.length ? (
              <div className="admin-collapsible">
                <button
                  aria-expanded={anonymizedUsersOpen}
                  className={`admin-collapsible__trigger ${anonymizedUsersOpen ? "is-open" : ""}`}
                  onClick={() => setAnonymizedUsersOpen((open) => !open)}
                  type="button"
                >
                  <span>Anonymized users</span>
                  <span>{anonymizedUsers.length}</span>
                </button>
                {anonymizedUsersOpen ? (
                  <div className="admin-table">
                    <div className="admin-row admin-row--head admin-row--users">
                      <span>Name</span>
                      <span>Username</span>
                      <span>Status</span>
                      <span>Auth source</span>
                      <span>Roles</span>
                      <span>Action</span>
                    </div>
                    {anonymizedUsers.map(renderUserRow)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      case "roles":
        return (
          <section className="admin-section">
            <div className="admin-section__header">
              <h2>Roles</h2>
              <button className="button-center" onClick={openCreateRoleModal} type="button">+ New role</button>
            </div>
            <div className="admin-table">
              <div className="admin-row admin-row--head admin-row--roles">
                <span>Role</span>
                <span>Description</span>
                <span>Permissions</span>
                <span>Action</span>
              </div>
              {adminOverview.roles.map((role) => (
                <div className="admin-row admin-row--roles" key={role.id}>
                  <span data-label="Role">{role.name}</span>
                  <span data-label="Description">{role.description}</span>
                  <span data-label="Permissions">{getSortedPermissionLabels(role.permissions).join(", ")}</span>
                  <button className="icon-button" data-label="Action" onClick={() => openEditRoleModal(role)} type="button" title="Edit role">
                    &#9998;
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      case "scheduled-tasks":
        return (
          <section className="admin-section">
            <div className="admin-section__header">
              <h2>Scheduled Tasks</h2>
            </div>
            {settings ? (
              <form className="settings-list" onSubmit={(event) => void handleSettingsSubmit(event)}>
                <div className="settings-category">
                    <button
                      aria-expanded={scheduledTasksOpen.autoAnonymizeDeactivatedUsers}
                      className="settings-category__toggle settings-category__toggle--task"
                      onClick={() => void handleToggleScheduledTask("autoAnonymizeDeactivatedUsers")}
                      type="button"
                    >
                      <span>Auto-anonymize deactivated users</span>
                      <span className="settings-category__chevron">
                        {scheduledTasksOpen.autoAnonymizeDeactivatedUsers ? "▾" : "▸"}
                      </span>
                    </button>
                    {scheduledTasksOpen.autoAnonymizeDeactivatedUsers ? (
                      <div className="settings-category__content">
                        <div className="settings-task__toolbar">
                          <div className="settings-toggle">
                            <button
                              className={`toggle-switch ${autoAnonymizeTask.enabled ? "is-active" : ""}`}
                              onClick={() =>
                                updateAutoAnonymizeTask({
                                  enabled: !autoAnonymizeTask.enabled,
                                })
                              }
                              type="button"
                              title="Toggle scheduled task"
                            >
                              <span className="toggle-switch__knob" />
                            </button>
                            <span>Enabled</span>
                          </div>
                          <button
                            className="ghost-button button-small"
                            disabled={runningTaskKey !== null}
                            onClick={() => void handleRunScheduledTask("autoAnonymizeDeactivatedUsers", "Auto-anonymize deactivated users")}
                            type="button"
                          >
                            {runningTaskKey === "autoAnonymizeDeactivatedUsers" ? "Running..." : "Run manually"}
                          </button>
                        </div>
                        {taskRunMessage?.taskKey === "autoAnonymizeDeactivatedUsers" ? (
                          <div className={`account-settings-message account-settings-message--${taskRunMessage.type}`}>
                            {taskRunMessage.text}
                          </div>
                        ) : null}
                        <p className="settings-help settings-help--muted">
                          Automatically anonymize users after they have been deactivated for longer than {formatAgeThreshold(autoAnonymizeTask.anonymizeAfterValue, autoAnonymizeTask.anonymizeAfterUnit)}.
                        </p>
                        <p className="settings-help settings-help--muted">
                          Schedule: {formatScheduledTaskSummary(autoAnonymizeTask)}
                        </p>
                        <div className="settings-task__meta">
                          <div>
                            <span className="settings-task__meta-label">Last run</span>
                            <span>{formatTaskRunTimestamp(autoAnonymizeTask.lastRunAt || null)}</span>
                          </div>
                          <div>
                            <span className="settings-task__meta-label">Next run</span>
                            <span>{formatTaskRunTimestamp(autoAnonymizeTask.nextRunAt || null)}</span>
                          </div>
                        </div>
                        <div className="settings-grid">
                          <label>
                            <span>Frequency</span>
                            <select
                              value={autoAnonymizeTask.frequency}
                              onChange={(event) =>
                                updateAutoAnonymizeTask({
                                  frequency: event.target.value as "minutes" | "hourly" | "daily" | "selected_weekdays" | "weekly" | "monthly" | "yearly",
                                })
                              }
                            >
                              {SCHEDULED_TASK_FREQUENCY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {autoAnonymizeTask.frequency !== "minutes" ? (
                            <label className="settings-grid__field settings-grid__field--time">
                              <span>{autoAnonymizeTask.frequency === "hourly" ? "Minute of hour" : "Time"}</span>
                              <input
                                className="settings-time-input"
                                type="time"
                                value={autoAnonymizeTask.time}
                                onChange={(event) => updateAutoAnonymizeTask({ time: event.target.value })}
                              />
                            </label>
                          ) : null}
                          {autoAnonymizeTask.frequency === "minutes" ? (
                            <label>
                              <span>Every (minutes)</span>
                              <input
                                max={1440}
                                min={1}
                                type="number"
                                value={autoAnonymizeTask.intervalMinutes}
                                onChange={(event) =>
                                  updateAutoAnonymizeTask({
                                    intervalMinutes: Math.min(1440, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          <label>
                            <span>Anonymize after</span>
                            <input
                              min={1}
                              type="number"
                              value={autoAnonymizeTask.anonymizeAfterValue}
                              onChange={(event) =>
                                updateAutoAnonymizeTask({
                                  anonymizeAfterValue: Number(event.target.value) || 1,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span>Unit</span>
                            <select
                              value={autoAnonymizeTask.anonymizeAfterUnit}
                              onChange={(event) =>
                                updateAutoAnonymizeTask({
                                  anonymizeAfterUnit: event.target.value as "minutes" | "hours" | "days" | "weeks" | "months" | "years",
                                })
                              }
                            >
                              {SCHEDULED_TASK_AGE_UNIT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {autoAnonymizeTask.frequency === "weekly" ? (
                            <>
                              <label>
                                <span>Week of month</span>
                                <select
                                  value={autoAnonymizeTask.weekOfMonth}
                                  onChange={(event) =>
                                    updateAutoAnonymizeTask({
                                      weekOfMonth: Number(event.target.value) as 1 | 2 | 3 | 4,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEK_OF_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Weekday</span>
                                <select
                                  value={autoAnonymizeTask.weeklyWeekday}
                                  onChange={(event) =>
                                    updateAutoAnonymizeTask({
                                      weeklyWeekday: event.target.value,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </>
                          ) : null}
                          {autoAnonymizeTask.frequency === "monthly" ? (
                            <label>
                              <span>Day of month</span>
                              <input
                                max={31}
                                min={1}
                                type="number"
                                value={autoAnonymizeTask.monthlyDay}
                                onChange={(event) =>
                                  updateAutoAnonymizeTask({
                                    monthlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          {autoAnonymizeTask.frequency === "yearly" ? (
                            <>
                              <label>
                                <span>Month</span>
                                <select
                                  value={autoAnonymizeTask.yearlyMonth}
                                  onChange={(event) =>
                                    updateAutoAnonymizeTask({
                                      yearlyMonth: Number(event.target.value),
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Day</span>
                                <input
                                  max={31}
                                  min={1}
                                  type="number"
                                  value={autoAnonymizeTask.yearlyDay}
                                  onChange={(event) =>
                                    updateAutoAnonymizeTask({
                                      yearlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                    })
                                  }
                                />
                              </label>
                            </>
                          ) : null}
                        </div>
                        {autoAnonymizeTask.frequency === "selected_weekdays" ? (
                          <div className="settings-task__weekdays">
                            <span className="settings-task__label">Weekdays</span>
                            <div className="filter-group">
                              {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => {
                                const isSelected = autoAnonymizeTask.weekdays.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    className={`filter-chip ${isSelected ? "is-active" : ""}`}
                                    onClick={() =>
                                      updateAutoAnonymizeTask({
                                        weekdays: isSelected
                                          ? autoAnonymizeTask.weekdays.filter((weekday) => weekday !== option.value)
                                          : [...autoAnonymizeTask.weekdays, option.value],
                                      })
                                    }
                                    type="button"
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="settings-category">
                    <button
                      aria-expanded={scheduledTasksOpen.autoCloseInactiveSessions}
                      className="settings-category__toggle settings-category__toggle--task"
                      onClick={() => void handleToggleScheduledTask("autoCloseInactiveSessions")}
                      type="button"
                    >
                      <span>Auto-close inactive sessions</span>
                      <span className="settings-category__chevron">
                        {scheduledTasksOpen.autoCloseInactiveSessions ? "▾" : "▸"}
                      </span>
                    </button>
                    {scheduledTasksOpen.autoCloseInactiveSessions ? (
                      <div className="settings-category__content">
                        <div className="settings-task__toolbar">
                          <div className="settings-toggle">
                            <button
                              className={`toggle-switch ${autoCloseInactiveSessionsTask.enabled ? "is-active" : ""}`}
                              onClick={() =>
                                updateAutoCloseInactiveSessionsTask({
                                  enabled: !autoCloseInactiveSessionsTask.enabled,
                                })
                              }
                              type="button"
                              title="Toggle scheduled task"
                            >
                              <span className="toggle-switch__knob" />
                            </button>
                            <span>Enabled</span>
                          </div>
                          <button
                            className="ghost-button button-small"
                            disabled={runningTaskKey !== null}
                            onClick={() => void handleRunScheduledTask("autoCloseInactiveSessions", "Auto-close inactive sessions")}
                            type="button"
                          >
                            {runningTaskKey === "autoCloseInactiveSessions" ? "Running..." : "Run manually"}
                          </button>
                        </div>
                        {taskRunMessage?.taskKey === "autoCloseInactiveSessions" ? (
                          <div className={`account-settings-message account-settings-message--${taskRunMessage.type}`}>
                            {taskRunMessage.text}
                          </div>
                        ) : null}
                        <p className="settings-help settings-help--muted">
                          Automatically close active sessions when they have been inactive for longer than {formatAgeThreshold(autoCloseInactiveSessionsTask.closeAfterValue, autoCloseInactiveSessionsTask.closeAfterUnit)}.
                        </p>
                        <p className="settings-help settings-help--muted">
                          Schedule: {formatScheduledTaskSummary(autoCloseInactiveSessionsTask)}
                        </p>
                        <div className="settings-task__meta">
                          <div>
                            <span className="settings-task__meta-label">Last run</span>
                            <span>{formatTaskRunTimestamp(autoCloseInactiveSessionsTask.lastRunAt || null)}</span>
                          </div>
                          <div>
                            <span className="settings-task__meta-label">Next run</span>
                            <span>{formatTaskRunTimestamp(autoCloseInactiveSessionsTask.nextRunAt || null)}</span>
                          </div>
                        </div>
                        <div className="settings-grid">
                          <label>
                            <span>Frequency</span>
                            <select
                              value={autoCloseInactiveSessionsTask.frequency}
                              onChange={(event) =>
                                updateAutoCloseInactiveSessionsTask({
                                  frequency: event.target.value as "minutes" | "hourly" | "daily" | "selected_weekdays" | "weekly" | "monthly" | "yearly",
                                })
                              }
                            >
                              {SCHEDULED_TASK_FREQUENCY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {autoCloseInactiveSessionsTask.frequency !== "minutes" ? (
                            <label className="settings-grid__field settings-grid__field--time">
                              <span>{autoCloseInactiveSessionsTask.frequency === "hourly" ? "Minute of hour" : "Time"}</span>
                              <input
                                className="settings-time-input"
                                type="time"
                                value={autoCloseInactiveSessionsTask.time}
                                onChange={(event) => updateAutoCloseInactiveSessionsTask({ time: event.target.value })}
                              />
                            </label>
                          ) : null}
                          {autoCloseInactiveSessionsTask.frequency === "minutes" ? (
                            <label>
                              <span>Every (minutes)</span>
                              <input
                                max={1440}
                                min={1}
                                type="number"
                                value={autoCloseInactiveSessionsTask.intervalMinutes}
                                onChange={(event) =>
                                  updateAutoCloseInactiveSessionsTask({
                                    intervalMinutes: Math.min(1440, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          <label>
                            <span>Close after</span>
                            <input
                              min={1}
                              type="number"
                              value={autoCloseInactiveSessionsTask.closeAfterValue}
                              onChange={(event) =>
                                updateAutoCloseInactiveSessionsTask({
                                  closeAfterValue: Number(event.target.value) || 1,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span>Unit</span>
                            <select
                              value={autoCloseInactiveSessionsTask.closeAfterUnit}
                              onChange={(event) =>
                                updateAutoCloseInactiveSessionsTask({
                                  closeAfterUnit: event.target.value as "minutes" | "hours" | "days" | "weeks" | "months" | "years",
                                })
                              }
                            >
                              {SCHEDULED_TASK_AGE_UNIT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {autoCloseInactiveSessionsTask.frequency === "weekly" ? (
                            <>
                              <label>
                                <span>Week of month</span>
                                <select
                                  value={autoCloseInactiveSessionsTask.weekOfMonth}
                                  onChange={(event) =>
                                    updateAutoCloseInactiveSessionsTask({
                                      weekOfMonth: Number(event.target.value) as 1 | 2 | 3 | 4,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEK_OF_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Weekday</span>
                                <select
                                  value={autoCloseInactiveSessionsTask.weeklyWeekday}
                                  onChange={(event) =>
                                    updateAutoCloseInactiveSessionsTask({
                                      weeklyWeekday: event.target.value,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </>
                          ) : null}
                          {autoCloseInactiveSessionsTask.frequency === "monthly" ? (
                            <label>
                              <span>Day of month</span>
                              <input
                                max={31}
                                min={1}
                                type="number"
                                value={autoCloseInactiveSessionsTask.monthlyDay}
                                onChange={(event) =>
                                  updateAutoCloseInactiveSessionsTask({
                                    monthlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          {autoCloseInactiveSessionsTask.frequency === "yearly" ? (
                            <>
                              <label>
                                <span>Month</span>
                                <select
                                  value={autoCloseInactiveSessionsTask.yearlyMonth}
                                  onChange={(event) =>
                                    updateAutoCloseInactiveSessionsTask({
                                      yearlyMonth: Number(event.target.value),
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Day</span>
                                <input
                                  max={31}
                                  min={1}
                                  type="number"
                                  value={autoCloseInactiveSessionsTask.yearlyDay}
                                  onChange={(event) =>
                                    updateAutoCloseInactiveSessionsTask({
                                      yearlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                    })
                                  }
                                />
                              </label>
                            </>
                          ) : null}
                        </div>
                        {autoCloseInactiveSessionsTask.frequency === "selected_weekdays" ? (
                          <div className="settings-task__weekdays">
                            <span className="settings-task__label">Weekdays</span>
                            <div className="filter-group">
                              {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => {
                                const isSelected = autoCloseInactiveSessionsTask.weekdays.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    className={`filter-chip ${isSelected ? "is-active" : ""}`}
                                    onClick={() =>
                                      updateAutoCloseInactiveSessionsTask({
                                        weekdays: isSelected
                                          ? autoCloseInactiveSessionsTask.weekdays.filter((weekday) => weekday !== option.value)
                                          : [...autoCloseInactiveSessionsTask.weekdays, option.value],
                                      })
                                    }
                                    type="button"
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="settings-category settings-category--scheduled-ad-sync">
                    <button
                      aria-expanded={scheduledTasksOpen.syncActiveDirectoryUsers}
                      className="settings-category__toggle settings-category__toggle--task"
                      onClick={() => void handleToggleScheduledTask("syncActiveDirectoryUsers")}
                      type="button"
                    >
                      <span>Sync Active Directory users</span>
                      <span className="settings-category__chevron">
                        {scheduledTasksOpen.syncActiveDirectoryUsers ? "▾" : "▸"}
                      </span>
                    </button>
                    {scheduledTasksOpen.syncActiveDirectoryUsers ? (
                      <div className="settings-category__content">
                        <div className="settings-task__toolbar">
                          <div className="settings-toggle">
                            <button
                              className={`toggle-switch ${syncActiveDirectoryUsersTask.enabled ? "is-active" : ""}`}
                              onClick={() =>
                                updateSyncActiveDirectoryUsersTask({
                                  enabled: !syncActiveDirectoryUsersTask.enabled,
                                })
                              }
                              type="button"
                              title="Toggle scheduled task"
                            >
                              <span className="toggle-switch__knob" />
                            </button>
                            <span>Enabled</span>
                          </div>
                          <button
                            className="ghost-button button-small"
                            disabled={runningTaskKey !== null}
                            onClick={() => void handleRunScheduledTask("syncActiveDirectoryUsers", "Sync Active Directory users")}
                            type="button"
                          >
                            {runningTaskKey === "syncActiveDirectoryUsers" ? "Running..." : "Run manually"}
                          </button>
                        </div>
                        {taskRunMessage?.taskKey === "syncActiveDirectoryUsers" ? (
                          <div className={`account-settings-message account-settings-message--${taskRunMessage.type}`}>
                            {taskRunMessage.text}
                          </div>
                        ) : null}
                        <p className="settings-help settings-help--muted">
                          Synchronize Sprinto Active Directory accounts with users currently available in the configured directory and mapped groups.
                        </p>
                        <p className="settings-help settings-help--muted">
                          Schedule: {formatScheduledTaskSummary(syncActiveDirectoryUsersTask)}
                        </p>
                        <div className="settings-task__meta">
                          <div>
                            <span className="settings-task__meta-label">Last run</span>
                            <span>{formatTaskRunTimestamp(syncActiveDirectoryUsersTask.lastRunAt || null)}</span>
                          </div>
                          <div>
                            <span className="settings-task__meta-label">Next run</span>
                            <span>{formatTaskRunTimestamp(syncActiveDirectoryUsersTask.nextRunAt || null)}</span>
                          </div>
                        </div>
                        <div className="settings-grid">
                          <label>
                            <span>Frequency</span>
                            <select
                              value={syncActiveDirectoryUsersTask.frequency}
                              onChange={(event) =>
                                updateSyncActiveDirectoryUsersTask({
                                  frequency: event.target.value as "minutes" | "hourly" | "daily" | "selected_weekdays" | "weekly" | "monthly" | "yearly",
                                })
                              }
                            >
                              {SCHEDULED_TASK_FREQUENCY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {syncActiveDirectoryUsersTask.frequency !== "minutes" ? (
                            <label className="settings-grid__field settings-grid__field--time">
                              <span>{syncActiveDirectoryUsersTask.frequency === "hourly" ? "Minute of hour" : "Time"}</span>
                              <input
                                className="settings-time-input"
                                type="time"
                                value={syncActiveDirectoryUsersTask.time}
                                onChange={(event) => updateSyncActiveDirectoryUsersTask({ time: event.target.value })}
                              />
                            </label>
                          ) : null}
                          {syncActiveDirectoryUsersTask.frequency === "minutes" ? (
                            <label>
                              <span>Every (minutes)</span>
                              <input
                                max={1440}
                                min={1}
                                type="number"
                                value={syncActiveDirectoryUsersTask.intervalMinutes}
                                onChange={(event) =>
                                  updateSyncActiveDirectoryUsersTask({
                                    intervalMinutes: Math.min(1440, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          {syncActiveDirectoryUsersTask.frequency === "weekly" ? (
                            <>
                              <label>
                                <span>Week of month</span>
                                <select
                                  value={syncActiveDirectoryUsersTask.weekOfMonth}
                                  onChange={(event) =>
                                    updateSyncActiveDirectoryUsersTask({
                                      weekOfMonth: Number(event.target.value) as 1 | 2 | 3 | 4,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEK_OF_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Weekday</span>
                                <select
                                  value={syncActiveDirectoryUsersTask.weeklyWeekday}
                                  onChange={(event) =>
                                    updateSyncActiveDirectoryUsersTask({
                                      weeklyWeekday: event.target.value,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </>
                          ) : null}
                          {syncActiveDirectoryUsersTask.frequency === "monthly" ? (
                            <label>
                              <span>Day of month</span>
                              <input
                                max={31}
                                min={1}
                                type="number"
                                value={syncActiveDirectoryUsersTask.monthlyDay}
                                onChange={(event) =>
                                  updateSyncActiveDirectoryUsersTask({
                                    monthlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          {syncActiveDirectoryUsersTask.frequency === "yearly" ? (
                            <>
                              <label>
                                <span>Month</span>
                                <select
                                  value={syncActiveDirectoryUsersTask.yearlyMonth}
                                  onChange={(event) =>
                                    updateSyncActiveDirectoryUsersTask({
                                      yearlyMonth: Number(event.target.value),
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Day</span>
                                <input
                                  max={31}
                                  min={1}
                                  type="number"
                                  value={syncActiveDirectoryUsersTask.yearlyDay}
                                  onChange={(event) =>
                                    updateSyncActiveDirectoryUsersTask({
                                      yearlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                    })
                                  }
                                />
                              </label>
                            </>
                          ) : null}
                        </div>
                        {syncActiveDirectoryUsersTask.frequency === "selected_weekdays" ? (
                          <div className="settings-task__weekdays">
                            <span className="settings-task__label">Weekdays</span>
                            <div className="filter-group">
                              {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => {
                                const isSelected = syncActiveDirectoryUsersTask.weekdays.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    className={`filter-chip ${isSelected ? "is-active" : ""}`}
                                    onClick={() =>
                                      updateSyncActiveDirectoryUsersTask({
                                        weekdays: isSelected
                                          ? syncActiveDirectoryUsersTask.weekdays.filter((weekday) => weekday !== option.value)
                                          : [...syncActiveDirectoryUsersTask.weekdays, option.value],
                                      })
                                    }
                                    type="button"
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="settings-category">
                    <button
                      aria-expanded={scheduledTasksOpen.autoCloseRooms}
                      className="settings-category__toggle settings-category__toggle--task"
                      onClick={() => void handleToggleScheduledTask("autoCloseRooms")}
                      type="button"
                    >
                      <span>Auto-close rooms</span>
                      <span className="settings-category__chevron">
                        {scheduledTasksOpen.autoCloseRooms ? "▾" : "▸"}
                      </span>
                    </button>
                    {scheduledTasksOpen.autoCloseRooms ? (
                      <div className="settings-category__content">
                        <div className="settings-task__toolbar">
                          <div className="settings-toggle">
                            <button
                              className={`toggle-switch ${autoCloseRoomsTask.enabled ? "is-active" : ""}`}
                              onClick={() =>
                                updateAutoCloseRoomsTask({
                                  enabled: !autoCloseRoomsTask.enabled,
                                })
                              }
                              type="button"
                              title="Toggle scheduled task"
                            >
                              <span className="toggle-switch__knob" />
                            </button>
                            <span>Enabled</span>
                          </div>
                          <button
                            className="ghost-button button-small"
                            disabled={runningTaskKey !== null}
                            onClick={() => void handleRunScheduledTask("autoCloseRooms", "Auto-close rooms")}
                            type="button"
                          >
                            {runningTaskKey === "autoCloseRooms" ? "Running..." : "Run manually"}
                          </button>
                        </div>
                        {taskRunMessage?.taskKey === "autoCloseRooms" ? (
                          <div className={`account-settings-message account-settings-message--${taskRunMessage.type}`}>
                            {taskRunMessage.text}
                          </div>
                        ) : null}
                        <p className="settings-help settings-help--muted">
                          Automatically close rooms when they stay in the selected status longer than {formatAgeThreshold(autoCloseRoomsTask.closeAfterValue, autoCloseRoomsTask.closeAfterUnit)}.
                        </p>
                        <p className="settings-help settings-help--muted">
                          Schedule: {formatScheduledTaskSummary(autoCloseRoomsTask)}
                        </p>
                        <div className="settings-task__meta">
                          <div>
                            <span className="settings-task__meta-label">Last run</span>
                            <span>{formatTaskRunTimestamp(autoCloseRoomsTask.lastRunAt || null)}</span>
                          </div>
                          <div>
                            <span className="settings-task__meta-label">Next run</span>
                            <span>{formatTaskRunTimestamp(autoCloseRoomsTask.nextRunAt || null)}</span>
                          </div>
                        </div>
                        <div className="settings-grid">
                          <label>
                            <span>Frequency</span>
                            <select
                              value={autoCloseRoomsTask.frequency}
                              onChange={(event) =>
                                updateAutoCloseRoomsTask({
                                  frequency: event.target.value as "minutes" | "hourly" | "daily" | "selected_weekdays" | "weekly" | "monthly" | "yearly",
                                })
                              }
                            >
                              {SCHEDULED_TASK_FREQUENCY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {autoCloseRoomsTask.frequency !== "minutes" ? (
                            <label className="settings-grid__field settings-grid__field--time">
                              <span>{autoCloseRoomsTask.frequency === "hourly" ? "Minute of hour" : "Time"}</span>
                              <input
                                className="settings-time-input"
                                type="time"
                                value={autoCloseRoomsTask.time}
                                onChange={(event) => updateAutoCloseRoomsTask({ time: event.target.value })}
                              />
                            </label>
                          ) : null}
                          {autoCloseRoomsTask.frequency === "minutes" ? (
                            <label>
                              <span>Every (minutes)</span>
                              <input
                                max={1440}
                                min={1}
                                type="number"
                                value={autoCloseRoomsTask.intervalMinutes}
                                onChange={(event) =>
                                  updateAutoCloseRoomsTask({
                                    intervalMinutes: Math.min(1440, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          <label>
                            <span>Close after</span>
                            <input
                              min={1}
                              type="number"
                              value={autoCloseRoomsTask.closeAfterValue}
                              onChange={(event) =>
                                updateAutoCloseRoomsTask({
                                  closeAfterValue: Number(event.target.value) || 1,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span>Unit</span>
                            <select
                              value={autoCloseRoomsTask.closeAfterUnit}
                              onChange={(event) =>
                                updateAutoCloseRoomsTask({
                                  closeAfterUnit: event.target.value as "minutes" | "hours" | "days" | "weeks" | "months" | "years",
                                })
                              }
                            >
                              {SCHEDULED_TASK_AGE_UNIT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {autoCloseRoomsTask.frequency === "weekly" ? (
                            <>
                              <label>
                                <span>Week of month</span>
                                <select
                                  value={autoCloseRoomsTask.weekOfMonth}
                                  onChange={(event) =>
                                    updateAutoCloseRoomsTask({
                                      weekOfMonth: Number(event.target.value) as 1 | 2 | 3 | 4,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEK_OF_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Weekday</span>
                                <select
                                  value={autoCloseRoomsTask.weeklyWeekday}
                                  onChange={(event) =>
                                    updateAutoCloseRoomsTask({
                                      weeklyWeekday: event.target.value,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </>
                          ) : null}
                          {autoCloseRoomsTask.frequency === "monthly" ? (
                            <label>
                              <span>Day of month</span>
                              <input
                                max={31}
                                min={1}
                                type="number"
                                value={autoCloseRoomsTask.monthlyDay}
                                onChange={(event) =>
                                  updateAutoCloseRoomsTask({
                                    monthlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          {autoCloseRoomsTask.frequency === "yearly" ? (
                            <>
                              <label>
                                <span>Month</span>
                                <select
                                  value={autoCloseRoomsTask.yearlyMonth}
                                  onChange={(event) =>
                                    updateAutoCloseRoomsTask({
                                      yearlyMonth: Number(event.target.value),
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Day</span>
                                <input
                                  max={31}
                                  min={1}
                                  type="number"
                                  value={autoCloseRoomsTask.yearlyDay}
                                  onChange={(event) =>
                                    updateAutoCloseRoomsTask({
                                      yearlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                    })
                                  }
                                />
                              </label>
                            </>
                          ) : null}
                        </div>
                        {autoCloseRoomsTask.frequency === "selected_weekdays" ? (
                          <div className="settings-task__weekdays">
                            <span className="settings-task__label">Weekdays</span>
                            <div className="filter-group">
                              {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => {
                                const isSelected = autoCloseRoomsTask.weekdays.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    className={`filter-chip ${isSelected ? "is-active" : ""}`}
                                    onClick={() =>
                                      updateAutoCloseRoomsTask({
                                        weekdays: isSelected
                                          ? autoCloseRoomsTask.weekdays.filter((weekday) => weekday !== option.value)
                                          : [...autoCloseRoomsTask.weekdays, option.value],
                                      })
                                    }
                                    type="button"
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        <div className="settings-task__weekdays">
                          <span className="settings-task__label">Room statuses to close</span>
                          <div className="filter-group">
                            {ROOM_STATUS_OPTIONS.map((option) => {
                              const isSelected = autoCloseRoomsTask.roomStatuses.includes(option.value);
                              return (
                                <button
                                  key={option.value}
                                  className={`filter-chip ${isSelected ? "is-active" : ""}`}
                                  onClick={() =>
                                    updateAutoCloseRoomsTask({
                                      roomStatuses: isSelected
                                        ? autoCloseRoomsTask.roomStatuses.filter((status) => status !== option.value)
                                        : [...autoCloseRoomsTask.roomStatuses, option.value],
                                    })
                                  }
                                  type="button"
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="settings-category settings-category--scheduled-updates">
                    <button
                      aria-expanded={scheduledTasksOpen.checkForUpdates}
                      className="settings-category__toggle settings-category__toggle--task"
                      onClick={() => void handleToggleScheduledTask("checkForUpdates")}
                      type="button"
                    >
                      <span>Check for updates</span>
                      <span className="settings-category__chevron">
                        {scheduledTasksOpen.checkForUpdates ? "▾" : "▸"}
                      </span>
                    </button>
                    {scheduledTasksOpen.checkForUpdates ? (
                      <div className="settings-category__content">
                        <div className="settings-task__toolbar">
                          <div className="settings-toggle">
                            <button
                              className={`toggle-switch ${checkForUpdatesTask.enabled ? "is-active" : ""}`}
                              onClick={() =>
                                updateCheckForUpdatesTask({
                                  enabled: !checkForUpdatesTask.enabled,
                                })
                              }
                              type="button"
                              title="Toggle scheduled task"
                            >
                              <span className="toggle-switch__knob" />
                            </button>
                            <span>Enabled</span>
                          </div>
                          <button
                            className="ghost-button button-small"
                            disabled={runningTaskKey !== null}
                            onClick={() => void handleRunScheduledTask("checkForUpdates", "Check for updates")}
                            type="button"
                          >
                            {runningTaskKey === "checkForUpdates" ? "Running..." : "Run manually"}
                          </button>
                        </div>
                        {taskRunMessage?.taskKey === "checkForUpdates" ? (
                          <div className={`account-settings-message account-settings-message--${taskRunMessage.type}`}>
                            {taskRunMessage.text}
                          </div>
                        ) : null}
                        <p className="settings-help settings-help--muted">
                          Check GitHub for a newer Sprinto release on a regular schedule. This works together with the manual check in the Updates section.
                        </p>
                        <p className="settings-help settings-help--muted">
                          Schedule: {formatScheduledTaskSummary(checkForUpdatesTask)}
                        </p>
                        <div className="settings-task__meta">
                          <div>
                            <span className="settings-task__meta-label">Last run</span>
                            <span>{formatTaskRunTimestamp(checkForUpdatesTask.lastRunAt || null)}</span>
                          </div>
                          <div>
                            <span className="settings-task__meta-label">Next run</span>
                            <span>{formatTaskRunTimestamp(checkForUpdatesTask.nextRunAt || null)}</span>
                          </div>
                        </div>
                        <div className="settings-grid">
                          <label>
                            <span>Frequency</span>
                            <select
                              value={checkForUpdatesTask.frequency}
                              onChange={(event) =>
                                updateCheckForUpdatesTask({
                                  frequency: event.target.value as "minutes" | "hourly" | "daily" | "selected_weekdays" | "weekly" | "monthly" | "yearly",
                                })
                              }
                            >
                              {SCHEDULED_TASK_FREQUENCY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {checkForUpdatesTask.frequency !== "minutes" ? (
                            <label className="settings-grid__field settings-grid__field--time">
                              <span>{checkForUpdatesTask.frequency === "hourly" ? "Minute of hour" : "Time"}</span>
                              <input
                                className="settings-time-input"
                                type="time"
                                value={checkForUpdatesTask.time}
                                onChange={(event) => updateCheckForUpdatesTask({ time: event.target.value })}
                              />
                            </label>
                          ) : null}
                          {checkForUpdatesTask.frequency === "minutes" ? (
                            <label>
                              <span>Every (minutes)</span>
                              <input
                                max={1440}
                                min={1}
                                type="number"
                                value={checkForUpdatesTask.intervalMinutes}
                                onChange={(event) =>
                                  updateCheckForUpdatesTask({
                                    intervalMinutes: Math.min(1440, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          {checkForUpdatesTask.frequency === "weekly" ? (
                            <>
                              <label>
                                <span>Week of month</span>
                                <select
                                  value={checkForUpdatesTask.weekOfMonth}
                                  onChange={(event) =>
                                    updateCheckForUpdatesTask({
                                      weekOfMonth: Number(event.target.value) as 1 | 2 | 3 | 4,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEK_OF_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Weekday</span>
                                <select
                                  value={checkForUpdatesTask.weeklyWeekday}
                                  onChange={(event) =>
                                    updateCheckForUpdatesTask({
                                      weeklyWeekday: event.target.value,
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </>
                          ) : null}
                          {checkForUpdatesTask.frequency === "monthly" ? (
                            <label>
                              <span>Day of month</span>
                              <input
                                max={31}
                                min={1}
                                type="number"
                                value={checkForUpdatesTask.monthlyDay}
                                onChange={(event) =>
                                  updateCheckForUpdatesTask({
                                    monthlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          {checkForUpdatesTask.frequency === "yearly" ? (
                            <>
                              <label>
                                <span>Month</span>
                                <select
                                  value={checkForUpdatesTask.yearlyMonth}
                                  onChange={(event) =>
                                    updateCheckForUpdatesTask({
                                      yearlyMonth: Number(event.target.value),
                                    })
                                  }
                                >
                                  {SCHEDULED_TASK_MONTH_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>Day</span>
                                <input
                                  max={31}
                                  min={1}
                                  type="number"
                                  value={checkForUpdatesTask.yearlyDay}
                                  onChange={(event) =>
                                    updateCheckForUpdatesTask({
                                      yearlyDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                                    })
                                  }
                                />
                              </label>
                            </>
                          ) : null}
                        </div>
                        {checkForUpdatesTask.frequency === "selected_weekdays" ? (
                          <div className="settings-task__weekdays">
                            <span className="settings-task__label">Weekdays</span>
                            <div className="filter-group">
                              {SCHEDULED_TASK_WEEKDAY_OPTIONS.map((option) => {
                                const isSelected = checkForUpdatesTask.weekdays.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    className={`filter-chip ${isSelected ? "is-active" : ""}`}
                                    onClick={() =>
                                      updateCheckForUpdatesTask({
                                        weekdays: isSelected
                                          ? checkForUpdatesTask.weekdays.filter((weekday) => weekday !== option.value)
                                          : [...checkForUpdatesTask.weekdays, option.value],
                                      })
                                    }
                                    type="button"
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                <button className={`button-center ${settingsSaved ? "saved" : ""}`} type="submit">
                  {settingsSaved ? "✓ Saved" : "Save settings"}
                </button>
              </form>
            ) : null}
          </section>
        );
      case "decks":
        return (
          <section className="admin-section">
            <h2>Decks</h2>
            <div className="decks-container">
              <div className="decks-controls">
                <div className="card card--compact deck-create-wrapper">
                  <form className="deck-create-form" onSubmit={(event) => void handleCreateDeck(event)}>
                    <p className="deck-create-label">New deck</p>
                    <input
                      placeholder="Name (e.g. Power of 2)"
                      value={newDeck.name}
                      onChange={(event) => setNewDeck({ ...newDeck, name: event.target.value })}
                    />
                    <input
                      placeholder="Values: 1, 2, 4, 8, ?"
                      value={newDeck.values}
                      onChange={(event) => setNewDeck({ ...newDeck, values: event.target.value })}
                    />
                    <button className="button-center" disabled={deckBusy || !newDeck.name.trim() || !newDeck.values.trim()} type="submit">Add deck</button>
                  </form>
                </div>

              </div>

              <div className="deck-list">
              {adminOverview.decks.map((deck) => (
                <div className="deck-item" key={deck.id}>
                  <div className="deck-item__info">
                    <strong>{deck.name}</strong>
                    <div className="deck-values-preview">
                      {deck.values.map((v) => (
                        <span className="deck-value-chip" key={v}>{v}</span>
                      ))}
                    </div>
                  </div>
                  <button className="icon-button" onClick={() => openEditDeckModal(deck)} type="button" title="Edit deck">
                    &#9998;
                  </button>
                </div>
              ))}
            </div>
            </div>
          </section>
        );
      case "audit-logs": {
        return (
          <section className="admin-section">
            <h2>Audit logs</h2>
            <div className="admin-table">
              <div className="admin-row admin-row--head admin-row--audit admin-row--audit-head" ref={auditFilterMenuRef}>
                <span>Time</span>
                <div className="audit-head-cell">
                  <button
                    className={`audit-head-button ${openAuditFilter === "actor" ? "is-open" : ""}`}
                    onClick={() => setOpenAuditFilter((current) => current === "actor" ? null : "actor")}
                    type="button"
                  >
                    <span>Actor</span>
                    <span aria-hidden="true" className="audit-head-button__arrow">▾</span>
                  </button>
                  {openAuditFilter === "actor" ? (
                    <div className="audit-filter-menu">
                      <input
                        className="audit-filter-menu__search"
                        onChange={(event) => setAuditActorSearch(event.target.value)}
                        placeholder="Search actor"
                        value={auditActorSearch}
                      />
                      <div className="audit-filter-menu__options">
                        <button
                          className={`audit-filter-menu__option ${auditActorFilter === "" ? "is-selected" : ""}`}
                          onClick={() => {
                            setAuditActorFilter("");
                            setAuditPage(0);
                            setOpenAuditFilter(null);
                          }}
                          type="button"
                        >
                          All actors
                        </button>
                        {visibleAuditActorOptions.map((actor) => (
                          <button
                            className={`audit-filter-menu__option ${auditActorFilter === actor ? "is-selected" : ""}`}
                            key={actor}
                            onClick={() => {
                              setAuditActorFilter(actor);
                              setAuditPage(0);
                              setOpenAuditFilter(null);
                            }}
                            type="button"
                          >
                            {actor}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="audit-head-cell">
                  <button
                    className={`audit-head-button ${openAuditFilter === "action" ? "is-open" : ""}`}
                    onClick={() => setOpenAuditFilter((current) => current === "action" ? null : "action")}
                    type="button"
                  >
                    <span>Action</span>
                    <span aria-hidden="true" className="audit-head-button__arrow">▾</span>
                  </button>
                  {openAuditFilter === "action" ? (
                    <div className="audit-filter-menu">
                      <input
                        className="audit-filter-menu__search"
                        onChange={(event) => setAuditActionSearch(event.target.value)}
                        placeholder="Search action"
                        value={auditActionSearch}
                      />
                      <div className="audit-filter-menu__options">
                        <button
                          className={`audit-filter-menu__option ${auditActionFilter === "" ? "is-selected" : ""}`}
                          onClick={() => {
                            setAuditActionFilter("");
                            setAuditPage(0);
                            setOpenAuditFilter(null);
                          }}
                          type="button"
                        >
                          All actions
                        </button>
                        {visibleAuditActionOptions.map((action) => (
                          <button
                            className={`audit-filter-menu__option ${auditActionFilter === action ? "is-selected" : ""}`}
                            key={action}
                            onClick={() => {
                              setAuditActionFilter(action);
                              setAuditPage(0);
                              setOpenAuditFilter(null);
                            }}
                            type="button"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {pagedAudit.map((entry) => (
                <button
                  className="admin-row admin-row--audit admin-row--audit-entry"
                  key={entry.id}
                  onClick={() => setSelectedAuditEntry(entry)}
                  type="button"
                >
                  <span>{formatAuditTimestamp(entry.createdAt)}</span>
                  <span>{entry.actorUserId || "System"}</span>
                  <span>{entry.action}</span>
                </button>
              ))}
            </div>
            <div className="admin-pagination">
              <span>{filteredAuditLogs.length} records</span>
              <div>
                <button disabled={auditPage === 0} onClick={() => setAuditPage((p) => Math.max(0, p - 1))} type="button">Previous</button>
                <span>{auditPage + 1}/{auditPageCount}</span>
                <button disabled={auditPage >= auditPageCount - 1} onClick={() => setAuditPage((p) => Math.min(auditPageCount - 1, p + 1))} type="button">Next</button>
              </div>
            </div>
          </section>
        );
      }
      case "active-sessions":
        return (
          <section className="admin-section">
            <h2>Active sessions</h2>
            <div className="admin-filters">
              <input
                placeholder="Search by username/display name"
                value={sessionSearch}
                onChange={(event) => { setSessionSearch(event.target.value); setSessionPage(0); }}
              />
            </div>
            <div className="admin-table">
              <div className="admin-row admin-row--head admin-row--sessions">
                <span>User</span>
                <span>Last seen</span>
                <span>Action</span>
              </div>
              {pagedSessions.map((session) => (
                <div className="admin-row admin-row--sessions" key={session.token}>
                  <span>
                    {session.displayName}
                    <br />
                    <small>{session.username}</small>
                  </span>
                  <span>{new Date(session.lastSeenAt).toLocaleString()}</span>
                  <button className="button-center delete-button" onClick={() => void onRevokeSession(session.token)} type="button">
                    Revoke
                  </button>
                </div>
              ))}
            </div>
            <div className="admin-pagination">
              <span>{filteredSessions.length} sessions</span>
              <div>
                <button disabled={sessionPage === 0} onClick={() => setSessionPage((p) => Math.max(0, p - 1))} type="button">Previous</button>
                <span>{sessionPage + 1}/{sessionPageCount}</span>
                <button disabled={sessionPage >= sessionPageCount - 1} onClick={() => setSessionPage((p) => Math.min(sessionPageCount - 1, p + 1))} type="button">Next</button>
              </div>
            </div>
          </section>
        );
      default:
        return null;
    }
  }

  return (
    <div className="page-shell">
      <section className="admin-layout">
        <aside className="card card--compact admin-sidebar">
          <nav aria-label="Admin sections" className="admin-tabs">
            {tabs.map((tab) => (
              <button
                aria-current={activeTab === tab.key ? "page" : undefined}
                className={`admin-tab ${activeTab === tab.key ? "is-active" : ""}`}
                key={tab.key}
                onClick={() => void handleTabChange(tab.key)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="card admin-content">
          {renderTabContent()}
        </div>
      </section>

      {userModalOpen ? (
        <div className="modal-overlay" role="presentation">
          <form className="history-modal card admin-modal admin-modal--user" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void saveUserEditor(event)}>
            <div className="admin-section__header">
              <h2>{userEditor.id ? "Edit user" : "Create user"}</h2>
              <button className="ghost-button" onClick={() => setUserModalOpen(false)} type="button">Close</button>
            </div>

            <div className="admin-user-avatar-header" ref={userAvatarMenuRef}>
                <button
                  className="account-settings-avatar-trigger"
                  disabled={isReadonlyUserEditor || isAvatarManagedExternally}
                  onClick={() => setUserAvatarMenuOpen((open) => !open)}
                  type="button"
                >
                <span className="avatar-circle avatar-circle--large admin-user-avatar-preview">
                  {userEditor.avatarDataUrl ? <img alt={userEditor.displayName || userEditor.username} src={userEditor.avatarDataUrl} /> : getAvatarInitials(userEditor.displayName || userEditor.username || "?")}
                </span>
                <span className="account-settings-avatar-overlay" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </span>
              </button>
              {userEditor.authSource === "local" && !isReadonlyUserEditor && !isAvatarManagedExternally && userAvatarMenuOpen ? (
                <div className="account-settings-avatar-popover">
                  <button
                    className="user-dropdown__action"
                    onClick={() => userAvatarInputRef.current?.click()}
                    type="button"
                  >
                    Upload avatar
                  </button>
                  {userEditor.avatarDataUrl ? (
                    <button
                      className="user-dropdown__action"
                      onClick={() => {
                        setUserEditor({ ...userEditor, avatarDataUrl: "" });
                        setUserAvatarMenuOpen(false);
                      }}
                      type="button"
                    >
                      Remove avatar
                    </button>
                  ) : null}
                </div>
              ) : null}
              <input
                accept=".png,.svg,.webp,.jpg,.jpeg"
                className="account-settings-avatar-input"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const dataUrl = await readFileAsDataUrl(file);
                  setUserEditor({ ...userEditor, avatarDataUrl: dataUrl });
                  setUserAvatarMenuOpen(false);
                  event.currentTarget.value = "";
                }}
                ref={userAvatarInputRef}
                type="file"
              />
            </div>

            <label>
              <span>Username</span>
              <input
                disabled={!editableUsername || isReadonlyUserEditor}
                value={userEditor.username}
                onChange={(event) => setUserEditor({ ...userEditor, username: event.target.value })}
              />
              {editableUsername && !isReadonlyUserEditor ? (
                <div className={`password-errors password-errors--compact ${usernameAvailability.isAvailable ? "password-errors--success" : ""}`}>
                  <p className={`error-text ${usernameAvailability.isAvailable ? "error-text--success" : ""}`}>
                    {usernameAvailability.message}
                  </p>
                </div>
              ) : null}
            </label>
            <label>
              <span>Display name</span>
              <input disabled={isReadonlyUserEditor} value={userEditor.displayName} onChange={(event) => setUserEditor({ ...userEditor, displayName: event.target.value })} />
            </label>
            <label>
              <span>Email</span>
              <input disabled={isReadonlyUserEditor} value={userEditor.email} onChange={(event) => setUserEditor({ ...userEditor, email: event.target.value })} />
            </label>
            {userEditor.id ? (
              <label>
                <span>Auth source</span>
                <input readOnly value={formatAuthSourceLabel(userEditor.authSource)} />
              </label>
            ) : null}
            {isReadonlyUserEditor ? (
              <p className="account-settings-help">
                {isAnonymizedUser
                  ? "This account has been anonymized and can no longer be edited or reactivated."
                  : isSystemRecoveryUser
                  ? "This recovery account is managed from deployment configuration. Profile data, roles, avatar, and password cannot be edited in Sprinto."
                  : userEditor.authSource === "entra"
                    ? "This account is centrally managed by Microsoft Entra. Profile data, roles, avatar, and password are synchronized from Microsoft and cannot be edited in Sprinto."
                    : "This account is centrally managed by Microsoft Active Directory. Profile data, roles, avatar, and password are synchronized from the directory and cannot be edited in Sprinto."}
              </p>
            ) : null}
            {!isReadonlyUserEditor && userEditor.authSource === "local" && userEditor.avatarManagedByAuthSource === "entra" ? (
              <p className="account-settings-help">
                This local account is linked to Microsoft Entra for sign-in and its avatar is synchronized from Entra.
              </p>
            ) : null}
            {userEditor.authSource === "local" && !isReadonlyUserEditor && (
              <>
                <label>
                  <span>{userEditor.id ? (!userEditor.isActive ? "New password" : "New password (optional)") : "Password"}</span>
                  <div className="password-input-group">
                    <input
                      type="password"
                      value={userEditor.password}
                      onChange={(event) => handlePasswordChange(event.target.value)}
                      placeholder="Enter password"
                    />
                    {userEditor.password && (
                      <span className={`password-feedback ${passwordValidation.isValid ? "valid" : "invalid"}`}>
                        {passwordValidation.isValid ? "✓" : "✗"}
                      </span>
                    )}
                  </div>
                  {userEditor.password && passwordValidation.errors.length > 0 && (
                    <div className="password-errors">
                      {passwordValidation.errors.map((error, idx) => (
                        <p key={idx} className="error-text">{error}</p>
                      ))}
                    </div>
                  )}
                </label>

                {userEditor.password && (
                  <label>
                    <span>Confirm password</span>
                    <div className="password-input-group">
                      <input
                        type="password"
                        value={userEditor.passwordConfirm || ""}
                        onChange={(event) => setUserEditor({ ...userEditor, passwordConfirm: event.target.value })}
                        placeholder="Repeat password"
                      />
                      {(userEditor.passwordConfirm || userEditor.password) && (
                        <span className={`password-feedback ${validatePasswordMatch(userEditor.password, userEditor.passwordConfirm || "") ? "valid" : "invalid"}`}>
                          {validatePasswordMatch(userEditor.password, userEditor.passwordConfirm || "") ? "✓" : "✗"}
                        </span>
                      )}
                    </div>
                  </label>
                )}
              </>
            )}

            <div className="admin-user-roles-card">
              <span className="admin-user-roles-card__label">Roles</span>
              <div className="role-chip-list role-chip-list--card">
                {availableRoles.map((roleName) => {
                  const selected = userEditor.roles.includes(roleName);
                  return isReadonlyUserEditor ? (
                    selected ? <span className="filter-chip is-active" key={roleName}>{roleName}</span> : null
                  ) : (
                    <button
                      className={`filter-chip ${selected ? "is-active" : ""}`}
                      key={roleName}
                      onClick={() =>
                        setUserEditor((draft) => ({
                          ...draft,
                          roles: selected ? draft.roles.filter((r) => r !== roleName) : [...draft.roles, roleName]
                        }))
                      }
                      type="button"
                    >
                      {roleName}
                    </button>
                  );
                })}
              </div>
            </div>

            {((userEditor.id && ["local", "ad"].includes(userEditor.authSource) && isEntraEnabled) || userModalMessage) ? (
              <div className="admin-user-inline-message">
                {userModalMessage ? (
                  <p className={`account-settings-message ${userModalMessage.type === "error" ? "error-text" : "error-text error-text--success"}`}>
                    {userModalMessage.text}
                  </p>
                ) : null}
                {!userModalMessage && canShowMigrationAction && !userEditor.email.trim() ? (
                  <p className="account-settings-message error-text">
                    Add an e-mail address before migrating this account to Microsoft Entra.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div
              className={`admin-modal-actions admin-modal-actions--footer ${
                !userEditor.isActive && userEditor.authSource === "local"
                  ? "admin-modal-actions--reactivation"
                  : "admin-modal-actions--user-footer"
              }`}
            >
              {canShowMigrationAction ? (
                canCancelEntraMigration ? (
                  <button
                    className="button-center button-center--small admin-user-action admin-user-action--left"
                    disabled={userModalSaving}
                    onClick={async () => {
                      if (!userEditor.id) return;
                      setUserModalSaving(true);
                      setUserModalMessage(null);
                      try {
                        await onCancelUserEntraMigration(userEditor.id);
                        const refreshed = await onRefreshOverview();
                        const refreshedUser = refreshed?.users.find((entry) => entry.id === userEditor.id);
                        if (refreshedUser) {
                          openEditUserModal(refreshedUser);
                        }
                        setUserModalMessage({ type: "success", text: "Microsoft Entra migration was canceled for this account." });
                      } catch (error) {
                        setUserModalMessage({
                          type: "error",
                          text: error instanceof Error ? error.message : "Canceling Microsoft Entra migration failed.",
                        });
                      } finally {
                        setUserModalSaving(false);
                      }
                    }}
                    type="button"
                  >
                    Cancel Entra migration
                  </button>
                ) : (
                  <button
                    className="button-center button-center--small admin-user-action admin-user-action--left"
                    disabled={userModalSaving || !userEditor.email.trim()}
                    onClick={async () => {
                      if (!userEditor.id) return;
                      setUserModalSaving(true);
                      setUserModalMessage(null);
                      try {
                        await onPrepareUserEntraMigration(userEditor.id, {});
                        const refreshed = await onRefreshOverview();
                        const refreshedUser = refreshed?.users.find((entry) => entry.id === userEditor.id);
                        if (refreshedUser) {
                          openEditUserModal(refreshedUser);
                        }
                        setUserModalMessage({ type: "success", text: "Microsoft Entra migration was prepared for this account." });
                      } catch (error) {
                        setUserModalMessage({
                          type: "error",
                          text: error instanceof Error ? error.message : "Preparing Microsoft Entra migration failed.",
                        });
                      } finally {
                        setUserModalSaving(false);
                      }
                    }}
                    type="button"
                  >
                    Migrate to Entra
                  </button>
                )
              ) : null}
              {!isReadonlyUserEditor ? (
                <button className={`button-center admin-user-action admin-user-action--center ${userSaved ? "saved" : ""}`} disabled={userModalSaving} type="submit">
                  {userSaved ? "✓ Saved" : !userEditor.isActive && userEditor.authSource === "local" ? "Reactivate user" : "Save user"}
                </button>
              ) : null}
              {userEditor.id && !isReadonlyUserEditor && userEditor.isActive ? (
                <button
                  className="button-center button-center--small delete-button admin-user-action admin-user-action--right"
                  disabled={userModalSaving || userEditor.username === "admin"}
                  onClick={() => {
                    setDeleteConfirmType("user-deactivate");
                    setDeleteConfirmId(userEditor.id || null);
                    setDeleteConfirmOpen(true);
                  }}
                  type="button"
                >
                  Deactivate user
                </button>
              ) : null}
              {canManuallyAnonymizeUser ? (
                <button
                  className="button-center button-center--small delete-button admin-user-action admin-user-action--right"
                  disabled={userModalSaving}
                  onClick={() => {
                    setDeleteConfirmType("user-anonymize");
                    setDeleteConfirmId(userEditor.id || null);
                    setDeleteConfirmOpen(true);
                  }}
                  type="button"
                >
                  Anonymize user
                </button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      {roleModalOpen ? (
        <div className="modal-overlay" role="presentation">
          <form className="history-modal card admin-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void saveRoleEditor(event)}>
            <div className="admin-section__header">
              <h2>{roleEditor.id ? "Edit role" : "Create role"}</h2>
              <button className="ghost-button" onClick={() => setRoleModalOpen(false)} type="button">Close</button>
            </div>

            <div className="admin-role-form-row">
              <label>
                <span>Name</span>
                <input value={roleEditor.name} onChange={(event) => setRoleEditor({ ...roleEditor, name: event.target.value })} />
              </label>
              <label>
                <span>Description</span>
                <input value={roleEditor.description} onChange={(event) => setRoleEditor({ ...roleEditor, description: event.target.value })} />
              </label>
            </div>
            {settings ? (
              <>
                <div className="admin-role-mapping-divider" />
                <div className="admin-role-form-row">
                  <label>
                    <span>Microsoft Entra app role value</span>
                    <input
                      disabled={!isEntraEnabled}
                      placeholder="Sprinto.Admin"
                      value={roleEditor.entraAppRoleValue}
                      onChange={(event) => setRoleEditor({ ...roleEditor, entraAppRoleValue: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Microsoft Entra group ID</span>
                    <input
                      disabled={!isEntraEnabled}
                      placeholder="00000000-0000-0000-0000-000000000000"
                      value={roleEditor.entraGroupId}
                      onChange={(event) => setRoleEditor({ ...roleEditor, entraGroupId: event.target.value })}
                    />
                  </label>
                </div>
                <div className="admin-role-mapping-divider" />
                <label>
                  <span>Microsoft Active Directory group</span>
                  <input
                    disabled={!isActiveDirectoryEnabled}
                    placeholder="CN=SPRINTO_ADMIN,OU=Groups,DC=company,DC=local"
                    value={roleEditor.adGroupName}
                    onChange={(event) => setRoleEditor({ ...roleEditor, adGroupName: event.target.value })}
                  />
                </label>
                <div className="admin-role-mapping-divider" />
              </>
            ) : null}

            <div className="permission-categories">
              {Object.entries(groupPermissionsByCategory(availablePermissions.map((p) => p.name))).map(
                ([category, permissionNames]) => (
                  <div key={category} className="permission-category">
                    <h4 className="permission-category-title">
                      {category}
                      {category === "JIRA Integration" && !jiraIntegrationEnabled ? (
                        <span className="permission-category-title__hint"> (integration is disabled)</span>
                      ) : null}
                    </h4>
                    <div className="permission-grid">
                      {permissionNames.map((permissionName) => {
                        const selected = roleEditor.permissions.includes(permissionName);
                        return (
                          <label className="permission-row" key={permissionName}>
                            <input
                              checked={selected}
                              type="checkbox"
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setRoleEditor((draft) => ({
                                  ...draft,
                                  permissions: checked
                                    ? [...draft.permissions, permissionName]
                                    : draft.permissions.filter((name) => name !== permissionName)
                                }));
                              }}
                              className="permission-checkbox"
                            />
                            <span className="permission-label">{translatePermission(permissionName)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </div>

            <div className="admin-modal-actions">
              {roleMessage ? (
                <div className={`account-settings-message account-settings-message--${roleMessage.type}`}>
                  {roleMessage.text}
                </div>
              ) : null}
              <button className={`button-center ${roleSaved ? "saved" : ""}`} disabled={roleModalSaving} type="submit">
                {roleSaved ? "✓ Saved" : "Save role"}
              </button>
              {roleEditor.id && (
                <button
                  className="button-center delete-button"
                  disabled={roleModalSaving}
                  onClick={() => {
                    setDeleteConfirmType("role");
                    setDeleteConfirmId(roleEditor.id || null);
                    setDeleteConfirmOpen(true);
                  }}
                  type="button"
                >
                  Delete role
                </button>
              )}
            </div>
          </form>
        </div>
      ) : null}

      {jiraTestModalOpen ? (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!jiraTestBusy) {
              setJiraTestModalOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="card admin-modal ad-test-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-section__header">
              <h2>Jira Cloud Test</h2>
            </div>

            <div className="ad-test-modal__steps">
              {jiraTestSteps.map((step) => (
                <div className={`ad-test-step ad-test-step--${step.status}`} key={step.key}>
                  <span className="ad-test-step__icon" aria-hidden="true">
                    {step.status === "loading" ? <span className="ad-test-spinner" /> : null}
                    {step.status === "success" ? "✓" : null}
                    {step.status === "error" ? "✕" : null}
                  </span>
                  <div className="ad-test-step__body">
                    <strong>{step.label}</strong>
                    {step.detail ? <span>{step.detail}</span> : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="admin-modal-actions admin-modal-actions--center">
              <button
                className="button-center"
                disabled={jiraTestBusy}
                onClick={() => setJiraTestModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {adTestModalOpen ? (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!adTestBusy) {
              setAdTestModalOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="card admin-modal ad-test-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-section__header">
              <h2>Active Directory Test</h2>
            </div>

            <div className="ad-test-modal__steps">
              {adTestSteps.map((step) => (
                <div className={`ad-test-step ad-test-step--${step.status}`} key={step.key}>
                  <span className="ad-test-step__icon" aria-hidden="true">
                    {step.status === "loading" ? <span className="ad-test-spinner" /> : null}
                    {step.status === "success" ? "✓" : null}
                    {step.status === "error" ? "✕" : null}
                  </span>
                  <div className="ad-test-step__body">
                    <strong>{step.label}</strong>
                    {step.detail ? (
                      <span>
                        {step.status === "success" && ["login-attribute", "email-attribute", "external-id-attribute", "display-name-attribute", "role-mapping"].includes(step.key)
                          ? `- ${step.detail}`
                          : step.detail}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="admin-modal-actions admin-modal-actions--center">
              <button
                className="button-center"
                disabled={adTestBusy}
                onClick={() => setAdTestModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {adCertificateModalOpen ? (
        <div
          className="modal-overlay"
          onClick={() => setAdCertificateModalOpen(false)}
          role="presentation"
        >
          <div className="card admin-modal admin-modal--narrow" onClick={(event) => event.stopPropagation()}>
            <div className="admin-section__header">
              <h2>CA Certificate</h2>
            </div>

            <label className="settings-subcategory__textarea">
              <span>Certificate (PEM)</span>
              <textarea
                placeholder={`-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----`}
                rows={10}
                value={adCertificateDraft}
                onChange={(event) => setAdCertificateDraft(event.target.value)}
              />
            </label>

            <p className="settings-help settings-help--muted settings-help--modal-spaced">
              Paste the internal CA certificate used to trust LDAPS or StartTLS connections.
            </p>

            <div className="admin-modal-actions">
              <button
                className="button-center delete-button"
                onClick={() => {
                  setAdCertificateDraft("");
                  setSettings({ ...settings, adCaCertificate: "" });
                  setAdCertificateModalOpen(false);
                }}
                type="button"
              >
                Remove certificate
              </button>
              <button
                className="button-center"
                onClick={() => {
                  setSettings({ ...settings, adCaCertificate: adCertificateDraft });
                  setAdCertificateModalOpen(false);
                }}
                type="button"
              >
                Save certificate
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen ? (
        <div className={`modal-overlay ${deleteConfirmOpen ? "modal-overlay--confirm" : ""}`} onClick={() => setDeleteConfirmOpen(false)} role="presentation">
          <div className="card admin-modal admin-modal--confirm" onClick={(event) => event.stopPropagation()}>
            <h2>
              {deleteConfirmType === "user-deactivate"
                ? "Confirm Deactivation"
                : deleteConfirmType === "user-anonymize"
                ? "Confirm Anonymization"
                : deleteConfirmType === "scheduled-task-run"
                ? "Confirm Manual Run"
                : "Confirm Deletion"}
            </h2>

            <p>
              {deleteConfirmType === "user-deactivate"
                ? "Are you sure you want to deactivate this user? They will no longer be able to sign in, but their history will be preserved."
                : deleteConfirmType === "user-anonymize"
                ? "Are you sure you want to anonymize this user? Personal identifiers will be replaced, but their history will be preserved."
                : deleteConfirmType === "scheduled-task-run"
                ? `Do you really want to run "${scheduledTaskRunLabel}" manually now? This will not affect its configured schedule.`
                : deleteConfirmType === "role"
                ? "Are you sure you want to delete this role? This action cannot be undone."
                : `Are you sure you want to delete the deck "${deckDeleteName}"? This action cannot be undone.`}
            </p>

            <div className="admin-modal-actions">
              <button
                className="button-center delete-button"
                disabled={deleteConfirmDeleting}
                onClick={async () => {
                  if (!deleteConfirmId) return;
                  setDeleteConfirmDeleting(true);
                  try {
                    if (deleteConfirmType === "user-deactivate") {
                      await onDeactivateUser(deleteConfirmId);
                    } else if (deleteConfirmType === "user-anonymize") {
                      await onAnonymizeUser(deleteConfirmId);
                    } else if (deleteConfirmType === "scheduled-task-run") {
                      setRunningTaskKey(deleteConfirmId);
                      const message = await onRunScheduledTask(deleteConfirmId);
                      setTaskRunMessage({
                        taskKey: deleteConfirmId,
                        type: "success",
                        text: message,
                      });
                    } else if (deleteConfirmType === "role") {
                      await onDeleteRole(deleteConfirmId);
                    } else if (deleteConfirmType === "deck") {
                      setDeckBusy(true);
                      try {
                        await onDeleteDeck(deleteConfirmId);
                      } finally {
                        setDeckBusy(false);
                      }
                    }
                    setDeleteConfirmOpen(false);
                    setUserModalOpen(false);
                    setRoleModalOpen(false);
                    setScheduledTaskRunLabel("");
                  } catch (error) {
                    if (deleteConfirmType === "scheduled-task-run" && deleteConfirmId) {
                      setTaskRunMessage({
                        taskKey: deleteConfirmId,
                        type: "error",
                        text: error instanceof Error ? error.message : "Scheduled task failed.",
                      });
                      setDeleteConfirmOpen(false);
                      setScheduledTaskRunLabel("");
                    }
                  } finally {
                    setRunningTaskKey(null);
                    setDeleteConfirmDeleting(false);
                  }
                }}
                type="button"
              >
                {deleteConfirmDeleting
                  ? deleteConfirmType === "user-deactivate"
                    ? "Deactivating..."
                    : deleteConfirmType === "user-anonymize"
                    ? "Anonymizing..."
                    : deleteConfirmType === "scheduled-task-run"
                    ? "Running..."
                    : "Deleting..."
                  : deleteConfirmType === "user-deactivate"
                  ? "Deactivate"
                  : deleteConfirmType === "user-anonymize"
                  ? "Anonymize"
                  : deleteConfirmType === "scheduled-task-run"
                  ? "Run manually"
                  : "Delete"}
              </button>
              <button
                className="button-center"
                disabled={deleteConfirmDeleting}
                onClick={() => setDeleteConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deckModalOpen && editingDeck ? (
        <div className="modal-overlay" role="presentation">
          <form className="history-modal card admin-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void handleUpdateDeck(event)}>
            <div className="admin-section__header">
              <h2>Edit deck</h2>
              <button className="ghost-button" onClick={() => setDeckModalOpen(false)} type="button">Close</button>
            </div>

            <label>
              <span>Deck name</span>
              <input
                value={editingDeck.name}
                onChange={(event) => setEditingDeck({ ...editingDeck, name: event.target.value })}
              />
            </label>
            <label>
              <span>Values (comma separated)</span>
              <input
                value={editingDeck.values}
                onChange={(event) => setEditingDeck({ ...editingDeck, values: event.target.value })}
              />
            </label>

            <div className="admin-modal-actions">
              <button className={`button-center ${deckSaved ? "saved" : ""}`} disabled={deckModalSaving} type="submit">
                {deckSaved ? "✓ Saved" : "Save deck"}
              </button>
              <button
                className="button-center delete-button"
                disabled={deckModalSaving}
                onClick={() => {
                  setDeleteConfirmType("deck");
                  setDeleteConfirmId(editingDeck.id || null);
                  setDeckDeleteName(editingDeck.name);
                  setDeleteConfirmOpen(true);
                }}
                type="button"
              >
                Delete deck
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {selectedAuditEntry ? (
        <div className="modal-overlay" onClick={() => setSelectedAuditEntry(null)} role="presentation">
          <div className="card admin-modal admin-modal--narrow" onClick={(event) => event.stopPropagation()}>
            <div className="admin-section__header">
              <h2>Audit log detail</h2>
              <button className="ghost-button" onClick={() => setSelectedAuditEntry(null)} type="button">Close</button>
            </div>

            <div className="audit-detail">
              <div className="audit-detail__grid">
                <div><strong>Time</strong><span>{new Date(selectedAuditEntry.createdAt).toLocaleString()}</span></div>
                <div><strong>Actor</strong><span>{selectedAuditEntry.actorUserId || "System"}</span></div>
                <div><strong>Action</strong><span>{selectedAuditEntry.action}</span></div>
                <div><strong>Target</strong><span>{selectedAuditEntry.targetType}: {selectedAuditEntry.targetId || "-"}</span></div>
              </div>

              {getAuditChangeRows(selectedAuditEntry).length > 0 ? (
                <div className="audit-detail__section">
                  <strong>Changed values</strong>
                  <div className="audit-detail__changes">
                    <div className="audit-detail__changes-head">
                      <span>Field</span>
                      <span>Previous value</span>
                      <span>New value</span>
                    </div>
                    {getAuditChangeRows(selectedAuditEntry).map((row) => (
                      <div className="audit-detail__changes-row" key={row.key}>
                        <span>{row.label}</span>
                        <strong>{formatAuditFieldValue(row.before)}</strong>
                        <strong>{formatAuditFieldValue(row.after)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedAuditEntry.details?.passwordChanged ? (
                <div className="audit-detail__section">
                  <strong>Password</strong>
                  <div className="audit-detail__meta">
                    <div className="audit-detail__meta-row">
                      <span>Status</span>
                      <strong>Password changed</strong>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="audit-detail__section">
                <strong>Metadata</strong>
                <div className="audit-detail__meta">
                  {getAuditDetailMetadata(selectedAuditEntry).length === 0 ? (
                    <span className="audit-detail__empty">No additional metadata</span>
                  ) : (
                    getAuditDetailMetadata(selectedAuditEntry).map(([key, value]) => (
                      <div className="audit-detail__meta-row" key={key}>
                        <span>{titleCaseAuditKey(key)}</span>
                        <strong>{formatAuditFieldValue(value)}</strong>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
