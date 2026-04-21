import {
  hashPassword,
  newId,
  newToken,
  query,
  tx,
  verifyPassword,
} from "./db.js";
import { isSystemManagedAuthSource, readBootstrapConfig, shouldSeedDemoData, validateBootstrapConfig } from "./bootstrap-config.js";

const permissionGroups = {
  "Poker Voting": ["room.join", "room.vote", "room.history.view"],
  "Room Management": ["room.create", "room.reveal", "room.close", "room.delete", "room.queue.manage", "room.highlight"],
  "System Administration": ["admin.access", "settings.manage", "integrations.manage", "room.settings.manage", "users.manage", "roles.manage", "decks.manage", "sessions.manage", "audit.manage", "tasks.manage", "updates.manage"],
  "JIRA Integration": ["jira.worklog.view", "jira.issues.import", "jira.send"],
};

const demoNow = new Date("2026-03-26T12:00:00.000Z");
const rawCurrentAppVersion = String(process.env.APP_VERSION || process.env.npm_package_version || "dev").trim();
const CURRENT_APP_VERSION = rawCurrentAppVersion && rawCurrentAppVersion !== "dev" && !rawCurrentAppVersion.startsWith("v")
  ? `v${rawCurrentAppVersion}`
  : rawCurrentAppVersion;
const defaultDirectorySettings = {
  ad_server_url: "",
  ad_server_port: 389,
  ad_base_dn: "",
  ad_bind_username: "",
  ad_bind_password: "",
  ad_login_attribute: "sAMAccountName",
  ad_email_attribute: "mail",
  ad_display_name_attribute: "displayName",
  ad_external_id_attribute: "objectGUID",
  ad_avatar_attribute: "thumbnailPhoto",
};

const defaultEntraSettings = {
  entra_auth_enabled: false,
  entra_tenant_id: "",
  entra_client_id: "",
  entra_client_secret: "",
  entra_global_logout_enabled: false,
  entra_migration_prompt_login_count: 3,
  entra_migration_force_at_default: "",
};

const defaultJiraIntegrationSettings = {
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
};

const defaultScheduledTasks = {
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
  },
};

const builtInRoleDefinitions = [
  { name: "admin", description: "Full system administration access." },
  { name: "master", description: "Can manage rooms without voting or admin access." },
  { name: "user", description: "Can join rooms and cast votes." },
];

const builtInRoleGrants = {
  admin: Object.values(permissionGroups).flatMap((codes) => codes),
  master: ["room.join", "room.history.view", "room.create", "room.reveal", "room.close", "room.delete", "room.queue.manage", "jira.issues.import", "jira.send", "jira.worklog.view"],
  user: ["room.join", "room.vote"],
};

const defaultDeckDefinitions = [
  { name: "Fibonacci", values: ["1", "2", "3", "5", "8", "13", "21", "?"], isDefault: true },
  { name: "XL", values: ["XS", "S", "M", "L", "XL", "?"], isDefault: false },
];

const SCHEDULED_TASK_WEEKDAY_VALUES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const USER_THEME_VALUES = new Set(["sprinto", "timero"]);
const ROOM_HIGHLIGHT_MODE_VALUES = new Set(["none", "most-frequent", "highest"]);
const ROOM_STATUS_VALUES = ["open", "voting", "revealed", "closed"];
const SCHEDULED_TASK_AGE_UNIT_VALUES = ["minutes", "hours", "days", "weeks", "months", "years"];
const JIRA_ORIGINAL_ESTIMATE_MODE_VALUES = new Set(["multiplied-story-points"]);
const LEGACY_ACTIVE_DIRECTORY_ONLY_MODE = "Active Directory";
const LEGACY_ACTIVE_DIRECTORY_WITH_LOCAL_MODE = "Active Directory + Local";

const defaultSystemSettings = {
  default_timer_seconds: 180,
  local_auth_enabled: true,
  active_directory_enabled: false,
  entra_auth_enabled: false,
  entra_global_logout_enabled: false,
  entra_migration_prompt_login_count: 3,
  entra_migration_force_at_default: "",
  require_story_id: false,
  login_method: "username",
  https_enabled: false,
  tls_cert_path: "",
  tls_key_path: "",
  trust_proxy: false,
  public_base_url: "",
  updates_enabled: true,
  update_last_checked_at: null,
  update_latest_version: "",
  update_latest_release_url: "",
  update_check_error: "",
  minimum_password_length: 8,
  require_password_complexity: false,
  brand_logo_data_url: "",
  brand_favicon_data_url: "",
  jira_integration: normalizeJiraIntegrationSettings(defaultJiraIntegrationSettings),
  scheduled_tasks: normalizeScheduledTasks(defaultScheduledTasks),
};

const BOOTSTRAP_DEMO_SEEDED_KEY = "bootstrap_demo_seeded";

function parseReleaseVersionParts(input) {
  const normalized = String(input || "").trim().replace(/^v/i, "");
  if (!normalized) return null;

  const numericPart = normalized.split("-", 1)[0];
  const numericParts = numericPart.split(".").map((part) => Number(part));
  if (!numericParts.length || numericParts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  return { numericParts };
}

export function compareReleaseVersions(left, right) {
  const leftParts = parseReleaseVersionParts(left);
  const rightParts = parseReleaseVersionParts(right);

  if (!leftParts && !rightParts) return 0;
  if (!leftParts) return -1;
  if (!rightParts) return 1;

  const maxLength = Math.max(leftParts.numericParts.length, rightParts.numericParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts.numericParts[index] || 0;
    const rightValue = rightParts.numericParts[index] || 0;
    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1;
    }
  }

  return 0;
}

function getWeekdayName(date) {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()];
}

function normalizeUserTheme(theme) {
  const normalized = String(theme || "").trim().toLowerCase();
  return USER_THEME_VALUES.has(normalized) ? normalized : "sprinto";
}

function normalizeRoomHighlightMode(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  return ROOM_HIGHLIGHT_MODE_VALUES.has(normalized) ? normalized : "none";
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeJiraIntegrationSettings(settings = {}) {
  const normalizedBaseUrl = String(settings.baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedToken = String(settings.apiToken || "").trim();
  const originalEstimateMode = JIRA_ORIGINAL_ESTIMATE_MODE_VALUES.has(String(settings.originalEstimateMode || "").trim())
    ? String(settings.originalEstimateMode || "").trim()
    : defaultJiraIntegrationSettings.originalEstimateMode;

  return {
    enabled: Boolean(settings.enabled),
    baseUrl: normalizedBaseUrl,
    serviceAccountEmail: String(settings.serviceAccountEmail || "").trim(),
    apiToken: normalizedToken,
    apiTokenConfigured: Boolean(normalizedToken || settings.apiTokenConfigured),
    offerKanbanBoards: Boolean(settings.offerKanbanBoards),
    writeStoryPointsEnabled: Boolean(settings.writeStoryPointsEnabled),
    writeOriginalEstimateEnabled: Boolean(settings.writeOriginalEstimateEnabled),
    writeAssigneeEnabled: Boolean(settings.writeAssigneeEnabled),
    originalEstimateMode,
    originalEstimateMinutesPerStoryPoint: Math.max(1, Number(settings.originalEstimateMinutesPerStoryPoint) || 30),
    postCommentEnabled: settings.postCommentEnabled !== false,
    postPdfEnabled: settings.postPdfEnabled !== false,
  };
}

function jiraSettingsForCompat(settings = {}) {
  const normalized = normalizeJiraIntegrationSettings(settings);
  return {
    ...normalized,
    apiToken: "",
    apiTokenConfigured: normalized.apiTokenConfigured,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeScheduledTaskAgeUnit(unit, fallback = "days") {
  return SCHEDULED_TASK_AGE_UNIT_VALUES.includes(unit) ? unit : fallback;
}

function subtractAgeFromDate(referenceTime, ageValue, ageUnit) {
  const cutoff = new Date(referenceTime);
  const normalizedValue = Math.max(1, Number(ageValue) || 1);

  switch (normalizeScheduledTaskAgeUnit(ageUnit)) {
    case "minutes":
      cutoff.setMinutes(cutoff.getMinutes() - normalizedValue);
      break;
    case "hours":
      cutoff.setHours(cutoff.getHours() - normalizedValue);
      break;
    case "days":
      cutoff.setDate(cutoff.getDate() - normalizedValue);
      break;
    case "weeks":
      cutoff.setDate(cutoff.getDate() - normalizedValue * 7);
      break;
    case "months":
      cutoff.setMonth(cutoff.getMonth() - normalizedValue);
      break;
    case "years":
      cutoff.setFullYear(cutoff.getFullYear() - normalizedValue);
      break;
    default:
      cutoff.setDate(cutoff.getDate() - normalizedValue);
      break;
  }

  return cutoff;
}

function getWeekOfMonth(date) {
  return Math.min(4, Math.floor((date.getDate() - 1) / 7) + 1);
}

function getTaskTimeParts(task) {
  const [hours, minutes] = String(task?.time || "").split(":").map((part) => Number(part));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return { hours, minutes };
}

function buildScheduledDateTime(date, hours, minutes) {
  const scheduledAt = new Date(date);
  scheduledAt.setHours(hours, minutes, 0, 0);
  return scheduledAt;
}

function matchesScheduledTaskDay(task, date) {
  if (!task?.enabled) return false;

  switch (task.frequency) {
    case "minutes":
    case "hourly":
    case "daily":
      return true;
    case "selected_weekdays":
      return Array.isArray(task.weekdays) && task.weekdays.includes(getWeekdayName(date));
    case "weekly":
      return getWeekdayName(date) === String(task.weeklyWeekday || "monday") && getWeekOfMonth(date) === Number(task.weekOfMonth || 1);
    case "monthly":
      return date.getDate() === Number(task.monthlyDay || 1);
    case "yearly":
      return date.getMonth() + 1 === Number(task.yearlyMonth || 1) && date.getDate() === Number(task.yearlyDay || 1);
    default:
      return false;
  }
}

function computeNextRunAt(task, fromDate = new Date()) {
  if (!task?.enabled) {
    return null;
  }

  if (task.frequency === "minutes") {
    const intervalMinutes = clamp(Number(task.intervalMinutes) || 1, 1, 1440);
    const candidate = new Date(fromDate);
    const hasSubMinutePrecision = fromDate.getSeconds() !== 0 || fromDate.getMilliseconds() !== 0;
    candidate.setSeconds(0, 0);
    if (hasSubMinutePrecision) {
      candidate.setMinutes(candidate.getMinutes() + 1);
    }
    const minutesFromMidnight = candidate.getHours() * 60 + candidate.getMinutes();
    const remainder = minutesFromMidnight % intervalMinutes;
    if (remainder !== 0) {
      candidate.setMinutes(candidate.getMinutes() + (intervalMinutes - remainder));
    }
    return candidate.toISOString();
  }

  if (!task.time) {
    return null;
  }

  const timeParts = getTaskTimeParts(task);
  if (!timeParts) {
    return null;
  }

  if (task.frequency === "hourly") {
    const candidate = new Date(fromDate);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(timeParts.minutes, 0, 0);
    if (candidate < fromDate) {
      candidate.setHours(candidate.getHours() + 1);
    }
    return candidate.toISOString();
  }

  for (let offset = 0; offset <= 370; offset += 1) {
    const candidateDate = new Date(fromDate);
    candidateDate.setHours(0, 0, 0, 0);
    candidateDate.setDate(candidateDate.getDate() + offset);

    if (!matchesScheduledTaskDay(task, candidateDate)) {
      continue;
    }

    const scheduledAt = buildScheduledDateTime(candidateDate, timeParts.hours, timeParts.minutes);
    if (scheduledAt >= fromDate) {
      return scheduledAt.toISOString();
    }
  }

  return null;
}

function attachScheduledTaskMetadata(tasks) {
  const normalized = normalizeScheduledTasks(tasks);
  return {
    autoAnonymizeDeactivatedUsers: {
      ...normalized.autoAnonymizeDeactivatedUsers,
      nextRunAt: computeNextRunAt(normalized.autoAnonymizeDeactivatedUsers),
    },
    autoCloseRooms: {
      ...normalized.autoCloseRooms,
      nextRunAt: computeNextRunAt(normalized.autoCloseRooms),
    },
    autoCloseInactiveSessions: {
      ...normalized.autoCloseInactiveSessions,
      nextRunAt: computeNextRunAt(normalized.autoCloseInactiveSessions),
    },
    syncActiveDirectoryUsers: {
      ...normalized.syncActiveDirectoryUsers,
      nextRunAt: computeNextRunAt(normalized.syncActiveDirectoryUsers),
    },
    checkForUpdates: {
      ...normalized.checkForUpdates,
      nextRunAt: computeNextRunAt(normalized.checkForUpdates),
    },
  };
}

function normalizeScheduledTasks(raw = {}) {
  const autoAnonymizeTask = raw.autoAnonymizeDeactivatedUsers || {};
  const autoCloseRoomsTask = raw.autoCloseRooms || {};
  const autoCloseInactiveSessionsTask = raw.autoCloseInactiveSessions || {};
  const syncActiveDirectoryUsersTask = raw.syncActiveDirectoryUsers || {};
  const checkForUpdatesTask = raw.checkForUpdates || {};
  const normalizedAutoAnonymizeWeekdays = Array.isArray(autoAnonymizeTask.weekdays)
    ? [...new Set(autoAnonymizeTask.weekdays.filter((weekday) => SCHEDULED_TASK_WEEKDAY_VALUES.includes(weekday)))]
    : [];
  const normalizedAutoCloseRoomsWeekdays = Array.isArray(autoCloseRoomsTask.weekdays)
    ? [...new Set(autoCloseRoomsTask.weekdays.filter((weekday) => SCHEDULED_TASK_WEEKDAY_VALUES.includes(weekday)))]
    : [];
  const normalizedRoomStatuses = Array.isArray(autoCloseRoomsTask.roomStatuses)
    ? [...new Set(autoCloseRoomsTask.roomStatuses.filter((status) => ROOM_STATUS_VALUES.includes(status) && status !== "closed"))]
    : defaultScheduledTasks.autoCloseRooms.roomStatuses;
  return {
    autoAnonymizeDeactivatedUsers: {
      ...defaultScheduledTasks.autoAnonymizeDeactivatedUsers,
      ...autoAnonymizeTask,
      enabled: Boolean(autoAnonymizeTask.enabled),
      frequency: autoAnonymizeTask.frequency || defaultScheduledTasks.autoAnonymizeDeactivatedUsers.frequency,
      intervalMinutes: clamp(Number(autoAnonymizeTask.intervalMinutes) || defaultScheduledTasks.autoAnonymizeDeactivatedUsers.intervalMinutes, 1, 1440),
      time: typeof autoAnonymizeTask.time === "string" && autoAnonymizeTask.time ? autoAnonymizeTask.time : defaultScheduledTasks.autoAnonymizeDeactivatedUsers.time,
      weekdays: normalizedAutoAnonymizeWeekdays,
      weeklyWeekday: SCHEDULED_TASK_WEEKDAY_VALUES.includes(autoAnonymizeTask.weeklyWeekday)
        ? autoAnonymizeTask.weeklyWeekday
        : defaultScheduledTasks.autoAnonymizeDeactivatedUsers.weeklyWeekday,
      weekOfMonth: clamp(Number(autoAnonymizeTask.weekOfMonth) || defaultScheduledTasks.autoAnonymizeDeactivatedUsers.weekOfMonth, 1, 4),
      monthlyDay: clamp(Number(autoAnonymizeTask.monthlyDay) || defaultScheduledTasks.autoAnonymizeDeactivatedUsers.monthlyDay, 1, 31),
      yearlyMonth: clamp(Number(autoAnonymizeTask.yearlyMonth) || defaultScheduledTasks.autoAnonymizeDeactivatedUsers.yearlyMonth, 1, 12),
      yearlyDay: clamp(Number(autoAnonymizeTask.yearlyDay) || defaultScheduledTasks.autoAnonymizeDeactivatedUsers.yearlyDay, 1, 31),
      anonymizeAfterValue: clamp(
        Number(autoAnonymizeTask.anonymizeAfterValue || autoAnonymizeTask.anonymizeAfterDays) || defaultScheduledTasks.autoAnonymizeDeactivatedUsers.anonymizeAfterValue,
        1,
        100000,
      ),
      anonymizeAfterUnit: normalizeScheduledTaskAgeUnit(
        autoAnonymizeTask.anonymizeAfterUnit,
        defaultScheduledTasks.autoAnonymizeDeactivatedUsers.anonymizeAfterUnit,
      ),
      anonymizeAfterDays: clamp(Number(autoAnonymizeTask.anonymizeAfterDays) || defaultScheduledTasks.autoAnonymizeDeactivatedUsers.anonymizeAfterDays, 1, 3650),
      lastRunAt: typeof autoAnonymizeTask.lastRunAt === "string" && autoAnonymizeTask.lastRunAt ? autoAnonymizeTask.lastRunAt : null,
    },
    autoCloseRooms: {
      ...defaultScheduledTasks.autoCloseRooms,
      ...autoCloseRoomsTask,
      enabled: Boolean(autoCloseRoomsTask.enabled),
      frequency: autoCloseRoomsTask.frequency || defaultScheduledTasks.autoCloseRooms.frequency,
      intervalMinutes: clamp(Number(autoCloseRoomsTask.intervalMinutes) || defaultScheduledTasks.autoCloseRooms.intervalMinutes, 1, 1440),
      time: typeof autoCloseRoomsTask.time === "string" && autoCloseRoomsTask.time ? autoCloseRoomsTask.time : defaultScheduledTasks.autoCloseRooms.time,
      weekdays: normalizedAutoCloseRoomsWeekdays,
      weeklyWeekday: SCHEDULED_TASK_WEEKDAY_VALUES.includes(autoCloseRoomsTask.weeklyWeekday)
        ? autoCloseRoomsTask.weeklyWeekday
        : defaultScheduledTasks.autoCloseRooms.weeklyWeekday,
      weekOfMonth: clamp(Number(autoCloseRoomsTask.weekOfMonth) || defaultScheduledTasks.autoCloseRooms.weekOfMonth, 1, 4),
      monthlyDay: clamp(Number(autoCloseRoomsTask.monthlyDay) || defaultScheduledTasks.autoCloseRooms.monthlyDay, 1, 31),
      yearlyMonth: clamp(Number(autoCloseRoomsTask.yearlyMonth) || defaultScheduledTasks.autoCloseRooms.yearlyMonth, 1, 12),
      yearlyDay: clamp(Number(autoCloseRoomsTask.yearlyDay) || defaultScheduledTasks.autoCloseRooms.yearlyDay, 1, 31),
      closeAfterValue: clamp(
        Number(autoCloseRoomsTask.closeAfterValue || autoCloseRoomsTask.closeAfterDays) || defaultScheduledTasks.autoCloseRooms.closeAfterValue,
        1,
        100000,
      ),
      closeAfterUnit: normalizeScheduledTaskAgeUnit(
        autoCloseRoomsTask.closeAfterUnit,
        defaultScheduledTasks.autoCloseRooms.closeAfterUnit,
      ),
      closeAfterDays: clamp(Number(autoCloseRoomsTask.closeAfterDays) || defaultScheduledTasks.autoCloseRooms.closeAfterDays, 1, 3650),
      roomStatuses: normalizedRoomStatuses.length ? normalizedRoomStatuses : defaultScheduledTasks.autoCloseRooms.roomStatuses,
      lastRunAt: typeof autoCloseRoomsTask.lastRunAt === "string" && autoCloseRoomsTask.lastRunAt ? autoCloseRoomsTask.lastRunAt : null,
    },
    autoCloseInactiveSessions: {
      ...defaultScheduledTasks.autoCloseInactiveSessions,
      ...autoCloseInactiveSessionsTask,
      enabled: Boolean(autoCloseInactiveSessionsTask.enabled),
      frequency: autoCloseInactiveSessionsTask.frequency || defaultScheduledTasks.autoCloseInactiveSessions.frequency,
      intervalMinutes: clamp(Number(autoCloseInactiveSessionsTask.intervalMinutes) || defaultScheduledTasks.autoCloseInactiveSessions.intervalMinutes, 1, 1440),
      time: typeof autoCloseInactiveSessionsTask.time === "string" && autoCloseInactiveSessionsTask.time ? autoCloseInactiveSessionsTask.time : defaultScheduledTasks.autoCloseInactiveSessions.time,
      weekdays: Array.isArray(autoCloseInactiveSessionsTask.weekdays)
        ? [...new Set(autoCloseInactiveSessionsTask.weekdays.filter((weekday) => SCHEDULED_TASK_WEEKDAY_VALUES.includes(weekday)))]
        : [],
      weeklyWeekday: SCHEDULED_TASK_WEEKDAY_VALUES.includes(autoCloseInactiveSessionsTask.weeklyWeekday)
        ? autoCloseInactiveSessionsTask.weeklyWeekday
        : defaultScheduledTasks.autoCloseInactiveSessions.weeklyWeekday,
      weekOfMonth: clamp(Number(autoCloseInactiveSessionsTask.weekOfMonth) || defaultScheduledTasks.autoCloseInactiveSessions.weekOfMonth, 1, 4),
      monthlyDay: clamp(Number(autoCloseInactiveSessionsTask.monthlyDay) || defaultScheduledTasks.autoCloseInactiveSessions.monthlyDay, 1, 31),
      yearlyMonth: clamp(Number(autoCloseInactiveSessionsTask.yearlyMonth) || defaultScheduledTasks.autoCloseInactiveSessions.yearlyMonth, 1, 12),
      yearlyDay: clamp(Number(autoCloseInactiveSessionsTask.yearlyDay) || defaultScheduledTasks.autoCloseInactiveSessions.yearlyDay, 1, 31),
      closeAfterValue: clamp(
        Number(autoCloseInactiveSessionsTask.closeAfterValue || autoCloseInactiveSessionsTask.closeAfterDays) || defaultScheduledTasks.autoCloseInactiveSessions.closeAfterValue,
        1,
        100000,
      ),
      closeAfterUnit: normalizeScheduledTaskAgeUnit(
        autoCloseInactiveSessionsTask.closeAfterUnit,
        defaultScheduledTasks.autoCloseInactiveSessions.closeAfterUnit,
      ),
      closeAfterDays: clamp(Number(autoCloseInactiveSessionsTask.closeAfterDays) || defaultScheduledTasks.autoCloseInactiveSessions.closeAfterDays, 1, 3650),
      lastRunAt: typeof autoCloseInactiveSessionsTask.lastRunAt === "string" && autoCloseInactiveSessionsTask.lastRunAt ? autoCloseInactiveSessionsTask.lastRunAt : null,
    },
    syncActiveDirectoryUsers: {
      ...defaultScheduledTasks.syncActiveDirectoryUsers,
      ...syncActiveDirectoryUsersTask,
      enabled: Boolean(syncActiveDirectoryUsersTask.enabled),
      frequency: syncActiveDirectoryUsersTask.frequency || defaultScheduledTasks.syncActiveDirectoryUsers.frequency,
      intervalMinutes: clamp(Number(syncActiveDirectoryUsersTask.intervalMinutes) || defaultScheduledTasks.syncActiveDirectoryUsers.intervalMinutes, 1, 1440),
      time: typeof syncActiveDirectoryUsersTask.time === "string" && syncActiveDirectoryUsersTask.time ? syncActiveDirectoryUsersTask.time : defaultScheduledTasks.syncActiveDirectoryUsers.time,
      weekdays: Array.isArray(syncActiveDirectoryUsersTask.weekdays)
        ? [...new Set(syncActiveDirectoryUsersTask.weekdays.filter((weekday) => SCHEDULED_TASK_WEEKDAY_VALUES.includes(weekday)))]
        : [],
      weeklyWeekday: SCHEDULED_TASK_WEEKDAY_VALUES.includes(syncActiveDirectoryUsersTask.weeklyWeekday)
        ? syncActiveDirectoryUsersTask.weeklyWeekday
        : defaultScheduledTasks.syncActiveDirectoryUsers.weeklyWeekday,
      weekOfMonth: clamp(Number(syncActiveDirectoryUsersTask.weekOfMonth) || defaultScheduledTasks.syncActiveDirectoryUsers.weekOfMonth, 1, 4),
      monthlyDay: clamp(Number(syncActiveDirectoryUsersTask.monthlyDay) || defaultScheduledTasks.syncActiveDirectoryUsers.monthlyDay, 1, 31),
      yearlyMonth: clamp(Number(syncActiveDirectoryUsersTask.yearlyMonth) || defaultScheduledTasks.syncActiveDirectoryUsers.yearlyMonth, 1, 12),
      yearlyDay: clamp(Number(syncActiveDirectoryUsersTask.yearlyDay) || defaultScheduledTasks.syncActiveDirectoryUsers.yearlyDay, 1, 31),
      lastRunAt: typeof syncActiveDirectoryUsersTask.lastRunAt === "string" && syncActiveDirectoryUsersTask.lastRunAt ? syncActiveDirectoryUsersTask.lastRunAt : null,
    },
    checkForUpdates: {
      ...defaultScheduledTasks.checkForUpdates,
      ...checkForUpdatesTask,
      enabled: Boolean(checkForUpdatesTask.enabled),
      frequency: checkForUpdatesTask.frequency || defaultScheduledTasks.checkForUpdates.frequency,
      intervalMinutes: clamp(Number(checkForUpdatesTask.intervalMinutes) || defaultScheduledTasks.checkForUpdates.intervalMinutes, 1, 1440),
      time: typeof checkForUpdatesTask.time === "string" && checkForUpdatesTask.time ? checkForUpdatesTask.time : defaultScheduledTasks.checkForUpdates.time,
      weekdays: Array.isArray(checkForUpdatesTask.weekdays)
        ? [...new Set(checkForUpdatesTask.weekdays.filter((weekday) => SCHEDULED_TASK_WEEKDAY_VALUES.includes(weekday)))]
        : [],
      weeklyWeekday: SCHEDULED_TASK_WEEKDAY_VALUES.includes(checkForUpdatesTask.weeklyWeekday)
        ? checkForUpdatesTask.weeklyWeekday
        : defaultScheduledTasks.checkForUpdates.weeklyWeekday,
      weekOfMonth: clamp(Number(checkForUpdatesTask.weekOfMonth) || defaultScheduledTasks.checkForUpdates.weekOfMonth, 1, 4),
      monthlyDay: clamp(Number(checkForUpdatesTask.monthlyDay) || defaultScheduledTasks.checkForUpdates.monthlyDay, 1, 31),
      yearlyMonth: clamp(Number(checkForUpdatesTask.yearlyMonth) || defaultScheduledTasks.checkForUpdates.yearlyMonth, 1, 12),
      yearlyDay: clamp(Number(checkForUpdatesTask.yearlyDay) || defaultScheduledTasks.checkForUpdates.yearlyDay, 1, 31),
      lastRunAt: typeof checkForUpdatesTask.lastRunAt === "string" && checkForUpdatesTask.lastRunAt ? checkForUpdatesTask.lastRunAt : null,
    },
  };
}

export async function initDatabase() {
  await query(`
    create table if not exists roles (id text primary key, name text unique not null, description text not null, ad_group_name text);
    create table if not exists permissions (id text primary key, code text unique not null, category text not null);
    create table if not exists role_permissions (role_id text not null references roles(id) on delete cascade, permission_id text not null references permissions(id) on delete cascade, primary key(role_id, permission_id));
    create table if not exists users (id text primary key, username text unique not null, display_name text not null, email text, auth_source text not null default 'local', external_id text, entra_external_id text, entra_tenant_id text, entra_migration_state text not null default '', entra_migration_prepared_at timestamptz, entra_migration_prepared_by_user_id text references users(id) on delete set null, entra_migration_prompt_count integer not null default 0, entra_migration_force_at timestamptz, is_active boolean not null default true, deactivated_username text, deactivated_at timestamptz, anonymized_at timestamptz, password_hash text, avatar_data_url text not null default '', avatar_managed_by_directory boolean not null default false, avatar_managed_by_auth_source text not null default '', theme text not null default 'sprinto', created_at timestamptz not null default now());
    create table if not exists user_roles (user_id text not null references users(id) on delete cascade, role_id text not null references roles(id) on delete cascade, primary key(user_id, role_id));
    create table if not exists sessions (id text primary key, user_id text not null references users(id) on delete cascade, token text unique not null, created_at timestamptz not null default now(), last_seen timestamptz not null default now(), revoked_at timestamptz);
    create table if not exists settings (key text primary key, value_json jsonb not null);
    create table if not exists decks (id text primary key, name text unique not null, values_json jsonb not null, is_default boolean not null default false);
    create table if not exists rooms (id text primary key, name text not null, status text not null, deck_id text not null references decks(id), created_by text not null references users(id), created_at timestamptz not null default now(), status_changed_at timestamptz not null default now(), closed_at timestamptz, highlight_mode text not null default 'none');
    create table if not exists room_presence (room_id text not null references rooms(id) on delete cascade, user_id text not null references users(id) on delete cascade, joined_at timestamptz not null default now(), last_seen timestamptz not null default now(), left_at timestamptz, primary key(room_id, user_id));
    create table if not exists issues (id text primary key, room_id text not null references rooms(id) on delete cascade, title text not null, source text not null, state text not null, queue_position integer not null default 0, order_index integer not null default 0, started_at timestamptz, revealed_at timestamptz, closed_at timestamptz, duration_seconds integer not null default 0, summary_json jsonb, playback_json jsonb, external_source text, external_issue_id text, external_issue_key text, external_issue_url text, external_meta_json jsonb, imported_board_id text, imported_sprint_id text, jira_delivery_json jsonb);
    create table if not exists votes (id text primary key, issue_id text not null references issues(id) on delete cascade, user_id text not null references users(id) on delete cascade, value text not null, created_at timestamptz not null default now(), unique(issue_id, user_id));
    create table if not exists issue_events (id text primary key, issue_id text not null references issues(id) on delete cascade, event_type text not null, user_id text references users(id) on delete set null, label text not null, event_ms integer not null, payload_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
    create table if not exists audit_logs (id text primary key, actor_user_id text references users(id) on delete set null, action text not null, target text not null, meta_json jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  `);
  await query("alter table roles add column if not exists ad_group_name text");
  await query("alter table roles add column if not exists entra_app_role_value text");
  await query("alter table roles add column if not exists entra_group_id text");
  await query("alter table users add column if not exists avatar_data_url text not null default ''");
  await query("alter table users add column if not exists avatar_managed_by_directory boolean not null default false");
  await query("alter table users add column if not exists avatar_managed_by_auth_source text not null default ''");
  await query("alter table users add column if not exists theme text not null default 'sprinto'");
  await query("alter table rooms add column if not exists highlight_mode text not null default 'none'");
  await query("alter table rooms add column if not exists status_changed_at timestamptz");
  await query("alter table issues add column if not exists external_source text");
  await query("alter table issues add column if not exists external_issue_id text");
  await query("alter table issues add column if not exists external_issue_key text");
  await query("alter table issues add column if not exists external_issue_url text");
  await query("alter table issues add column if not exists external_meta_json jsonb");
  await query("alter table issues add column if not exists imported_board_id text");
  await query("alter table issues add column if not exists imported_sprint_id text");
  await query("alter table issues add column if not exists jira_delivery_json jsonb");
  await query("update rooms set status_changed_at = coalesce(created_at, now()) where status_changed_at is null");
  await query("alter table users add column if not exists external_id text");
  await query("alter table users add column if not exists entra_external_id text");
  await query("alter table users add column if not exists entra_tenant_id text");
  await query("alter table users add column if not exists entra_migration_state text not null default ''");
  await query("alter table users add column if not exists entra_migration_prepared_at timestamptz");
  await query("alter table users add column if not exists entra_migration_prepared_by_user_id text references users(id) on delete set null");
  await query("alter table users add column if not exists entra_migration_prompt_count integer not null default 0");
  await query("alter table users add column if not exists entra_migration_force_at timestamptz");
  await query("alter table users add column if not exists is_active boolean not null default true");
  await query("alter table users add column if not exists deactivated_username text");
  await query("alter table users add column if not exists deactivated_at timestamptz");
  await query("alter table users add column if not exists anonymized_at timestamptz");
  await query(`
    update users
    set avatar_managed_by_auth_source = 'ad'
    where auth_source = 'ad'
      and avatar_managed_by_directory = true
      and coalesce(avatar_managed_by_auth_source, '') = ''
  `);
  await query("create unique index if not exists users_external_id_ad_unique on users (external_id) where auth_source = 'ad' and external_id is not null");
  await query("create unique index if not exists users_entra_identity_unique on users (entra_tenant_id, entra_external_id) where entra_tenant_id is not null and entra_external_id is not null");
  const bootstrapConfig = readBootstrapConfig();

  await tx(async (client) => {
    await client.query("select pg_advisory_xact_lock($1)", [20260402]);

    const initialUserCount = await countNonSystemUsers(client);
    const bootstrapErrors = validateBootstrapConfig(bootstrapConfig, { initialUserCount });
    if (bootstrapErrors.length > 0) {
      throw new Error(bootstrapErrors[0]);
    }

    await ensurePermissionCatalog(client);
    const roleMap = await ensureBuiltInRoles(client);
    await ensureLegacyRolePermissionBackfills(client);
    const defaultDeckId = await ensureDefaultDecks(client);
    await ensureSettingsDefaults(
      {
        ...defaultSystemSettings,
        ...defaultDirectorySettings,
        ...defaultEntraSettings,
        default_deck_id: defaultDeckId,
      },
      client,
    );

    if (bootstrapConfig.recoveryAdminEnabled) {
      await ensureRecoveryAdmin(client, bootstrapConfig, roleMap);
    }

    if (shouldSeedDemoData(bootstrapConfig, { initialUserCount, demoSeeded: await isDemoSeeded(client) })) {
      await seedDemoData(client, roleMap, defaultDeckId);
      await client.query(
        "insert into settings (key, value_json) values ($1, 'true'::jsonb) on conflict (key) do update set value_json = 'true'::jsonb",
        [BOOTSTRAP_DEMO_SEEDED_KEY],
      );
    }
  });
}

async function ensurePermissionCatalog(client = { query }) {
  const permissions = Object.entries(permissionGroups).flatMap(([category, codes]) =>
    codes.map((code) => ({ category, code })),
  );

  for (const permission of permissions) {
    await client.query(
      `
        insert into permissions (id, code, category)
        values ($1, $2, $3)
        on conflict (code) do update
        set category = excluded.category
      `,
      [newId(), permission.code, permission.category]
    );
  }
}

async function countNonSystemUsers(client = { query }) {
  const result = await client.query("select count(*)::int as count from users where auth_source <> 'system'");
  return Number(result.rows[0]?.count || 0);
}

async function ensureBuiltInRoles(client = { query }) {
  const result = await client.query("select id, name from roles where name = any($1::text[])", [
    builtInRoleDefinitions.map((role) => role.name),
  ]);
  const roleMap = new Map(result.rows.map((row) => [row.name, row.id]));

  for (const role of builtInRoleDefinitions) {
    if (!roleMap.has(role.name)) {
      const roleId = newId();
      await client.query("insert into roles (id, name, description) values ($1, $2, $3)", [roleId, role.name, role.description]);
      roleMap.set(role.name, roleId);

      const permissionRows = await client.query(
        "select id, code from permissions where code = any($1::text[])",
        [builtInRoleGrants[role.name] || []],
      );
      for (const permission of permissionRows.rows) {
        await client.query("insert into role_permissions (role_id, permission_id) values ($1, $2) on conflict do nothing", [roleId, permission.id]);
      }
    }
  }

  return roleMap;
}

async function ensureLegacyRolePermissionBackfills(client = { query }) {
  await client.query(`
    insert into role_permissions (role_id, permission_id)
    select r.id, p.id
    from roles r
    join permissions p on p.code = 'room.settings.manage'
    where r.name = 'admin'
    on conflict do nothing
  `);
  await client.query(`
    insert into role_permissions (role_id, permission_id)
    select rp.role_id, p_target.id
    from role_permissions rp
    join permissions p_source on p_source.id = rp.permission_id
    join permissions p_target on p_target.code in ('integrations.manage', 'room.settings.manage', 'decks.manage', 'sessions.manage', 'audit.manage', 'updates.manage')
    where p_source.code = 'settings.manage'
    on conflict do nothing
  `);
}

async function ensureDefaultDecks(client = { query }) {
  const existingDecks = await client.query("select id, name from decks where name = any($1::text[])", [
    defaultDeckDefinitions.map((deck) => deck.name),
  ]);
  const deckMap = new Map(existingDecks.rows.map((row) => [row.name, row.id]));

  for (const deck of defaultDeckDefinitions) {
    if (!deckMap.has(deck.name)) {
      const deckId = newId();
      await client.query("insert into decks (id, name, values_json, is_default) values ($1, $2, $3::jsonb, $4)", [
        deckId,
        deck.name,
        JSON.stringify(deck.values),
        Boolean(deck.isDefault),
      ]);
      deckMap.set(deck.name, deckId);
    }
  }

  const fibonacciId = deckMap.get("Fibonacci");
  if (!fibonacciId) {
    throw new Error("The default Fibonacci deck could not be created during database initialization.");
  }
  return fibonacciId;
}

async function isDemoSeeded(client = { query }) {
  const result = await client.query("select value_json from settings where key = $1 limit 1", [BOOTSTRAP_DEMO_SEEDED_KEY]);
  return result.rows[0]?.value_json === true;
}

async function ensureRecoveryAdmin(client, config, roleMap) {
  const username = String(config.recoveryAdminUsername || "").trim();
  const password = String(config.recoveryAdminPassword || "");
  const displayName = String(config.recoveryAdminDisplayName || "").trim() || "System Recovery Admin";
  const email = `${username}@sprinto.system`;
  const adminRoleId = roleMap.get("admin") || null;
  const existingSystemUser = await client.query(
    "select id, username from users where auth_source = 'system' order by created_at asc limit 1",
  );
  const userId = existingSystemUser.rows[0]?.id || newId();
  const existingUserWithUsername = await client.query(
    "select id from users where lower(username) = lower($1) and id <> $2 limit 1",
    [username, userId],
  );
  if (existingUserWithUsername.rows[0]) {
    throw new Error(`The configured recovery admin username "${username}" is already in use.`);
  }

  if (existingSystemUser.rows[0]) {
    await client.query(
      `
        update users
        set
          username = $2,
          display_name = $3,
          email = $4,
          auth_source = 'system',
          external_id = null,
          is_active = true,
          deactivated_username = null,
          deactivated_at = null,
          anonymized_at = null,
          password_hash = $5,
          avatar_data_url = '',
          avatar_managed_by_directory = false
        where id = $1
      `,
      [userId, username, displayName, email, hashPassword(password)],
    );
    await client.query("delete from user_roles where user_id = $1", [userId]);
  } else {
    await client.query(
      `
        insert into users (id, username, display_name, email, auth_source, is_active, password_hash, avatar_data_url, avatar_managed_by_directory)
        values ($1, $2, $3, $4, 'system', true, $5, '', false)
      `,
      [userId, username, displayName, email, hashPassword(password)],
    );
  }

  if (adminRoleId) {
    await client.query("insert into user_roles (user_id, role_id) values ($1, $2) on conflict do nothing", [userId, adminRoleId]);
  }

  return userId;
}

async function seedDemoData(client, roleMap, defaultDeckId) {
  const users = [
    { id: newId(), username: "admin", displayName: "Admin", email: "admin@sprinto.local", password: "admin", roles: ["admin"] },
    { id: newId(), username: "master", displayName: "Master", email: "master@sprinto.local", password: "master", roles: ["master"] },
    { id: newId(), username: "user", displayName: "User", email: "user@sprinto.local", password: "user", roles: ["user"] },
  ];

  for (const user of users) {
    await client.query(
      "insert into users (id, username, display_name, email, auth_source, password_hash) values ($1, $2, $3, $4, 'local', $5)",
      [user.id, user.username, user.displayName, user.email, hashPassword(user.password)],
    );
    for (const roleName of user.roles) {
      const roleId = roleMap.get(roleName);
      if (roleId) {
        await client.query("insert into user_roles (user_id, role_id) values ($1, $2) on conflict do nothing", [user.id, roleId]);
      }
    }
  }

  const roomId = newId();
  const historyIssueOneId = newId();
  const historyIssueTwoId = newId();
  const liveIssueId = newId();
  const queuedIssueOneId = newId();
  const queuedIssueTwoId = newId();
  await client.query(
    "insert into rooms (id, name, status, deck_id, created_by, created_at, status_changed_at) values ($1, 'Sprint 24 Planning', 'voting', $2, $3, $4, $4)",
    [roomId, defaultDeckId, users[1].id, demoNow.toISOString()],
  );
  const joinedAt = new Date(demoNow.getTime() - 90_000).toISOString();
  for (const user of users) {
    await client.query("insert into room_presence (room_id, user_id, joined_at, last_seen) values ($1, $2, $3, $3)", [roomId, user.id, joinedAt]);
  }

  const liveStart = new Date(demoNow.getTime() - 75_000);
  const historyStartOne = new Date(demoNow.getTime() - 420_000);
  const historyStartTwo = new Date(demoNow.getTime() - 250_000);
  const historyEndOne = new Date(historyStartOne.getTime() + 95_000);
  const historyEndTwo = new Date(historyStartTwo.getTime() + 118_000);

  const historyPlaybackOne = {
    users: users.map((user) => ({ id: user.id, display_name: user.displayName })),
    events: [
      { type: "join", userId: users[0].id, label: "Admin join", atMs: 0, payload: {} },
      { type: "join", userId: users[1].id, label: "Master join", atMs: 3000, payload: {} },
      { type: "join", userId: users[2].id, label: "User join", atMs: 7000, payload: {} },
      { type: "vote", userId: users[0].id, label: "Admin vote", atMs: 22000, payload: { value: "5" } },
      { type: "vote", userId: users[2].id, label: "User vote", atMs: 36000, payload: { value: "8" } },
      { type: "reveal", userId: users[1].id, label: "Master reveal", atMs: 95000, payload: {} },
    ],
    durationSeconds: 95,
  };

  const historyPlaybackTwo = {
    users: users.map((user) => ({ id: user.id, display_name: user.displayName })),
    events: [
      { type: "join", userId: users[0].id, label: "Admin join", atMs: 0, payload: {} },
      { type: "join", userId: users[1].id, label: "Master join", atMs: 4000, payload: {} },
      { type: "join", userId: users[2].id, label: "User join", atMs: 9000, payload: {} },
      { type: "vote", userId: users[0].id, label: "Admin vote", atMs: 28000, payload: { value: "3" } },
      { type: "vote", userId: users[2].id, label: "User vote", atMs: 54000, payload: { value: "3" } },
      { type: "reveal", userId: users[1].id, label: "Master reveal", atMs: 118000, payload: {} },
    ],
    durationSeconds: 118,
  };

  await client.query(
    "insert into issues (id, room_id, title, source, state, order_index, started_at, revealed_at, closed_at, duration_seconds, summary_json, playback_json) values ($1, $2, 'AUTH-142 Harden login throttling', 'jira', 'done', 1, $3, $4, $4, 95, $5::jsonb, $6::jsonb)",
    [historyIssueOneId, roomId, historyStartOne.toISOString(), historyEndOne.toISOString(), JSON.stringify({ avg: "6.5", median: "6.5", votes: 2 }), JSON.stringify(historyPlaybackOne)],
  );
  await client.query(
    "insert into votes (id, issue_id, user_id, value, created_at) values ($1, $2, $3, '5', $4), ($5, $2, $6, '8', $7)",
    [newId(), historyIssueOneId, users[0].id, new Date(historyStartOne.getTime() + 22_000).toISOString(), newId(), users[2].id, new Date(historyStartOne.getTime() + 36_000).toISOString()],
  );

  await client.query(
    "insert into issues (id, room_id, title, source, state, order_index, started_at, revealed_at, closed_at, duration_seconds, summary_json, playback_json) values ($1, $2, 'PAY-318 Simplify refund edge cases', 'jira', 'done', 2, $3, $4, $4, 118, $5::jsonb, $6::jsonb)",
    [historyIssueTwoId, roomId, historyStartTwo.toISOString(), historyEndTwo.toISOString(), JSON.stringify({ avg: "3", median: "3", votes: 2 }), JSON.stringify(historyPlaybackTwo)],
  );
  await client.query(
    "insert into votes (id, issue_id, user_id, value, created_at) values ($1, $2, $3, '3', $4), ($5, $2, $6, '3', $7)",
    [newId(), historyIssueTwoId, users[0].id, new Date(historyStartTwo.getTime() + 28_000).toISOString(), newId(), users[2].id, new Date(historyStartTwo.getTime() + 54_000).toISOString()],
  );

  await client.query(
    "insert into issues (id, room_id, title, source, state, order_index, started_at) values ($1, $2, 'OPS-224 Improve alert deduplication', 'jira', 'active', 3, $3)",
    [liveIssueId, roomId, liveStart.toISOString()],
  );
  await client.query(
    "insert into issue_events (id, issue_id, event_type, user_id, label, event_ms, payload_json) values ($1, $2, 'join', $3, 'Admin join', 0, '{}'::jsonb), ($4, $2, 'join', $5, 'Master join', 4000, '{}'::jsonb), ($6, $2, 'join', $7, 'User join', 9000, '{}'::jsonb), ($8, $2, 'vote', $9, 'Admin vote', 20000, $10::jsonb), ($11, $2, 'vote', $12, 'User vote', 32000, $13::jsonb)",
    [newId(), liveIssueId, users[0].id, newId(), users[1].id, newId(), users[2].id, newId(), users[0].id, JSON.stringify({ value: "5" }), newId(), users[2].id, JSON.stringify({ value: "8" })],
  );
  await client.query(
    "insert into votes (id, issue_id, user_id, value, created_at) values ($1, $2, $3, '5', $4), ($5, $2, $6, '8', $7)",
    [newId(), liveIssueId, users[0].id, new Date(liveStart.getTime() + 20_000).toISOString(), newId(), users[2].id, new Date(liveStart.getTime() + 32_000).toISOString()],
  );

  await client.query(
    "insert into issues (id, room_id, title, source, state, queue_position, order_index) values ($1, $2, 'CORE-411 Review retry backoff', 'jira', 'queued', 1, 99), ($3, $2, 'UI-287 Polish estimate summary states', 'jira', 'queued', 2, 100)",
    [queuedIssueOneId, roomId, queuedIssueTwoId],
  );
}

const parseNameParts = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(p => p.length > 0);
  const firstName = parts.length > 0 ? parts[0] : "";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  return { firstName, lastName };
};
const canUserVote = (roles = []) => roles.includes("admin") || roles.includes("user");
const adminPermissionNames = ["manage_users", "manage_roles", "manage_settings", "manage_integrations", "manage_room_settings", "manage_decks", "manage_sessions", "manage_audit_logs", "manage_scheduled_tasks", "manage_updates"];

function mapPermissionCodesToNames(codes = []) {
  const normalizedCodes = Array.isArray(codes) ? codes : [];
  return [...new Set(normalizedCodes.map((code) => internalToExternalPermission[code]).filter(Boolean))];
}

function systemPermissionNames() {
  return permissionCatalog.map((permission) => permission.name);
}

function adminAccessFor(user) {
  const permissions = new Set(user?.permissions || []);
  return {
    canManageUsers: permissions.has("manage_users"),
    canManageRoles: permissions.has("manage_roles"),
    canManageSettings: permissions.has("manage_settings"),
    canManageIntegrations: permissions.has("manage_integrations"),
    canManageRoomSettings: permissions.has("manage_room_settings"),
    canManageDecks: permissions.has("manage_decks"),
    canManageSessions: permissions.has("manage_sessions"),
    canManageAuditLogs: permissions.has("manage_audit_logs"),
    canManageScheduledTasks: permissions.has("manage_scheduled_tasks"),
    canManageUpdates: permissions.has("manage_updates"),
  };
}

function normalizeAvatarManagedByAuthSource(row) {
  const managedBySource = String(row?.avatar_managed_by_auth_source || "").trim().toLowerCase();
  if (managedBySource === "ad" || managedBySource === "entra") {
    return managedBySource;
  }
  if (Boolean(row?.avatar_managed_by_directory) && row?.auth_source === "ad") {
    return "ad";
  }
  return "";
}

function normalizeEntraMigrationState(value) {
  return String(value || "").trim().toLowerCase() === "pending" ? "pending" : "";
}

const mapUser = (row) => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  email: row.email || "",
  authSource: row.auth_source,
  isSystemManaged: isSystemManagedAuthSource(row.auth_source),
  externalId: row.auth_source === "entra" ? (row.entra_external_id || row.external_id || "") : (row.external_id || ""),
  entraLinked: Boolean(row.entra_external_id && row.entra_tenant_id),
  entraMigrationState: normalizeEntraMigrationState(row.entra_migration_state),
  entraMigrationPreparedAt: row.entra_migration_prepared_at || null,
  entraMigrationPreparedByUserId: row.entra_migration_prepared_by_user_id || "",
  entraMigrationPromptCount: Number(row.entra_migration_prompt_count || 0),
  entraMigrationForceAt: row.entra_migration_force_at || null,
  isActive: row.is_active !== false,
  deactivatedUsername: row.deactivated_username || "",
  deactivatedAt: row.deactivated_at || null,
  anonymizedAt: row.anonymized_at || null,
  avatarDataUrl: row.avatar_data_url || "",
  avatarManagedByDirectory: Boolean(normalizeAvatarManagedByAuthSource(row)),
  avatarManagedByAuthSource: normalizeAvatarManagedByAuthSource(row),
  theme: normalizeUserTheme(row.theme),
  roles: isSystemManagedAuthSource(row.auth_source)
    ? Array.from(new Set([...(row.roles || []), "admin"]))
    : row.roles || [],
  permissions: isSystemManagedAuthSource(row.auth_source)
    ? systemPermissionNames()
    : mapPermissionCodesToNames(row.permission_codes || []),
});

export function capabilitiesFor(user) {
  const permissions = new Set(user?.permissions || []);
  const adminAccess = adminAccessFor(user);
  return {
    isAdmin: user?.roles?.includes("admin") || false,
    canVote: permissions.has("vote"),
    canCreateRoom: permissions.has("create_room"),
    canManageRoom: permissions.has("reveal_votes") || permissions.has("close_poker") || permissions.has("queue_issues"),
    canDeleteRoom: permissions.has("delete_room"),
    canImportJiraIssues: permissions.has("jira_import_issues"),
    canSendToJira: permissions.has("jira_send"),
    canViewWorklog: permissions.has("worklog_view"),
    canAccessAdmin: adminPermissionNames.some((permission) => user?.permissions?.includes(permission)),
    ...adminAccess,
  };
}

export async function findUserForLogin(identifier, password, method = "username") {
  return findUserForLoginByAuthSource(identifier, password, method, "local");
}

export async function findRecoveryUserForLogin(identifier, password, method = "username") {
  return findUserForLoginByAuthSource(identifier, password, "both", "system");
}

async function findUserForLoginByAuthSource(identifier, password, method, authSource) {
  const normalizedMethod = method === "email" || method === "both" ? method : "username";
  const whereClause =
    normalizedMethod === "email"
      ? "lower(coalesce(u.email, '')) = lower($1)"
      : normalizedMethod === "both"
        ? "(lower(u.username) = lower($1) or lower(coalesce(u.email, '')) = lower($1))"
        : "lower(u.username) = lower($1)";

  const result = await query(`
    select
      u.*,
      array_remove(array_agg(distinct r.name), null) as roles,
      array_remove(array_agg(distinct p.code), null) as permission_codes
    from users u
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    where ${whereClause} and u.is_active = true and u.auth_source = $2
    group by u.id
    limit 1
  `, [identifier, authSource]);
  const user = result.rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return mapUser(user);
}

export async function createSession(userId) {
  const token = newToken();
  await query("insert into sessions (id, user_id, token) values ($1, $2, $3)", [newId(), userId, token]);
  return token;
}

export async function revokeSession(token) {
  await query("update sessions set revoked_at = now() where token = $1", [token]);
}

export async function revokeSessionById(sessionId) {
  await query("update sessions set revoked_at = now() where id = $1", [sessionId]);
}

export async function getUserBySession(token) {
  if (!token) return null;
  const result = await query(`
    select
      u.*,
      s.id as session_id,
      array_remove(array_agg(distinct r.name), null) as roles,
      array_remove(array_agg(distinct p.code), null) as permission_codes
    from sessions s
    join users u on u.id = s.user_id
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    where s.token = $1 and s.revoked_at is null and u.is_active = true
    group by u.id, s.id
    limit 1
  `, [token]);
  const row = result.rows[0];
  if (!row) return null;
  await query("update sessions set last_seen = now() where id = $1", [row.session_id]);
  return { ...mapUser(row), sessionId: row.session_id };
}

export async function getBootstrap(user) {
  const [settings, decks] = await Promise.all([getSettings(), listDecks()]);
  return { user, capabilities: capabilitiesFor(user), settings, decks };
}

async function ensureSettingsDefaults(defaults, client = { query }) {
  for (const [key, value] of Object.entries(defaults)) {
    await client.query(
      "insert into settings (key, value_json) values ($1, $2::jsonb) on conflict (key) do nothing",
      [key, JSON.stringify(value)],
    );
  }
}

function authProviderSettingsFromLegacyMode(mode) {
  const normalizedMode = String(mode || "").trim();

  if (normalizedMode === LEGACY_ACTIVE_DIRECTORY_ONLY_MODE) {
    return {
      localAuthEnabled: false,
      activeDirectoryEnabled: true,
    };
  }

  if (normalizedMode === LEGACY_ACTIVE_DIRECTORY_WITH_LOCAL_MODE) {
    return {
      localAuthEnabled: true,
      activeDirectoryEnabled: true,
    };
  }

  return {
    localAuthEnabled: true,
    activeDirectoryEnabled: false,
  };
}

export function resolveAuthProviderSettings(source = {}) {
  const fallback = authProviderSettingsFromLegacyMode(source.ssoMode ?? source.sso_mode);
  const hasLocalAuthEnabled =
    typeof source.localAuthEnabled === "boolean" || typeof source.local_auth_enabled === "boolean";
  const hasActiveDirectoryEnabled =
    typeof source.activeDirectoryEnabled === "boolean" || typeof source.active_directory_enabled === "boolean";
  const hasEntraAuthEnabled =
    typeof source.entraAuthEnabled === "boolean" || typeof source.entra_auth_enabled === "boolean";

  return {
    localAuthEnabled: hasLocalAuthEnabled
      ? Boolean(source.localAuthEnabled ?? source.local_auth_enabled)
      : fallback.localAuthEnabled,
    activeDirectoryEnabled: hasActiveDirectoryEnabled
      ? Boolean(source.activeDirectoryEnabled ?? source.active_directory_enabled)
      : fallback.activeDirectoryEnabled,
    entraAuthEnabled: hasEntraAuthEnabled
      ? Boolean(source.entraAuthEnabled ?? source.entra_auth_enabled)
      : false,
  };
}

export async function getSettings() {
  const result = await query("select key, value_json from settings");
  const map = Object.fromEntries(result.rows.map((row) => [row.key, row.value_json]));
  const authProviderSettings = resolveAuthProviderSettings(map);
  const inferredAdConnectionSecurity =
    map.ad_connection_security ||
    (String(map.ad_server_url || "").trim().toLowerCase().startsWith("ldaps://") ? "ldaps" : "ldap");
  return {
    defaultTimerSeconds: map.default_timer_seconds,
    httpsEnabled: Boolean(map.https_enabled),
    tlsCertPath: map.tls_cert_path || "",
    tlsKeyPath: map.tls_key_path || "",
    trustProxy: Boolean(map.trust_proxy),
    publicBaseUrl: map.public_base_url || "",
    updatesEnabled: map.updates_enabled !== false,
    updateLastCheckedAt: map.update_last_checked_at || null,
    updateLatestVersion: map.update_latest_version || "",
    updateLatestReleaseUrl: map.update_latest_release_url || "",
    updateCheckError: map.update_check_error || "",
    localAuthEnabled: authProviderSettings.localAuthEnabled,
    activeDirectoryEnabled: authProviderSettings.activeDirectoryEnabled,
    entraAuthEnabled: authProviderSettings.entraAuthEnabled,
    entraMigrationEnabled: map.entra_migration_enabled !== false,
    entraGlobalLogoutEnabled: Boolean(map.entra_global_logout_enabled),
    entraMigrationPromptLoginCount: Math.max(1, Number(map.entra_migration_prompt_login_count || 3)),
    entraMigrationForceAtDefault: map.entra_migration_force_at_default || "",
    requireStoryId: map.require_story_id,
    loginMethod: map.login_method,
    minimumPasswordLength: map.minimum_password_length,
    requirePasswordComplexity: map.require_password_complexity,
    adServerUrl: map.ad_server_url || "",
    adServerPort: map.ad_server_port || 389,
    adConnectionSecurity: inferredAdConnectionSecurity,
    adBaseDn: map.ad_base_dn || "",
    adBindUsername: map.ad_bind_username || "",
    adBindPassword: map.ad_bind_password || "",
    adLoginAttribute: map.ad_login_attribute || "sAMAccountName",
    adEmailAttribute: map.ad_email_attribute || "mail",
    adDisplayNameAttribute: map.ad_display_name_attribute || "displayName",
    adExternalIdAttribute: map.ad_external_id_attribute || "objectGUID",
    adAvatarAttribute: map.ad_avatar_attribute || "thumbnailPhoto",
    adCaCertificate: map.ad_ca_certificate || "",
    adAllowUntrustedCertificate: Boolean(map.ad_allow_untrusted_certificate),
    entraTenantId: map.entra_tenant_id || "",
    entraClientId: map.entra_client_id || "",
    entraClientSecret: map.entra_client_secret || "",
    entraClientSecretConfigured: Boolean(map.entra_client_secret),
    defaultDeckId: map.default_deck_id,
    logoDataUrl: map.brand_logo_data_url || "",
    faviconDataUrl: map.brand_favicon_data_url || "",
    integrations: {
      jira: normalizeJiraIntegrationSettings(map.jira_integration || defaultJiraIntegrationSettings),
    },
    scheduledTasks: attachScheduledTaskMetadata(map.scheduled_tasks || defaultScheduledTasks),
  };
}

export async function listDecks() {
  const result = await query("select * from decks order by name");
  return result.rows.map((row) => ({ id: row.id, name: row.name, values: row.values_json, isDefault: row.is_default }));
}

export async function listUsers() {
  const result = await query(`
    select
      u.*,
      array_remove(array_agg(distinct r.name), null) as roles,
      array_remove(array_agg(distinct p.code), null) as permission_codes
    from users u
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    group by u.id
    order by u.is_active desc, u.display_name
  `);
  return result.rows.map(mapUser);
}

export async function listRoles() {
  const roles = await query("select * from roles order by name");
  const permissions = await query(`
    select rp.role_id, p.code, p.category
    from role_permissions rp
    join permissions p on p.id = rp.permission_id
    order by p.category, p.code
  `);
  const grouped = new Map();
  for (const row of permissions.rows) {
    if (!grouped.has(row.role_id)) grouped.set(row.role_id, []);
    grouped.get(row.role_id).push({ code: row.code, category: row.category });
  }
  return roles.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    adGroupName: row.ad_group_name || "",
    entraAppRoleValue: row.entra_app_role_value || "",
    entraGroupId: row.entra_group_id || "",
    permissions: grouped.get(row.id) || [],
  }));
}

export async function listSessions(search = "") {
  const result = await query(`
    select s.id, s.last_seen, u.display_name, u.username
    from sessions s
    join users u on u.id = s.user_id
    where s.revoked_at is null
      and ($1 = '' or lower(u.username) like $2 or lower(u.display_name) like $2)
    order by s.last_seen desc
  `, [search, `%${search.toLowerCase()}%`]);
  return result.rows.map((row) => ({ id: row.id, user: row.display_name, username: row.username, lastSeen: row.last_seen }));
}

export async function listAuditLogs({ action = "", target = "", search = "", page = 1, pageSize = 10 }) {
  const offset = (page - 1) * pageSize;
  const result = await query(`
    select count(*) over()::int as total_count, a.*
    from audit_logs a
    where ($1 = '' or a.action = $1)
      and ($2 = '' or a.target = $2)
      and ($3 = '' or lower(a.action) like $4 or lower(a.target) like $4)
    order by a.created_at desc
    limit $5 offset $6
  `, [action, target, search, `%${search.toLowerCase()}%`, pageSize, offset]);
  return {
    total: result.rows[0]?.total_count || 0,
    records: result.rows.map((row) => ({ id: row.id, time: row.created_at, action: row.action, target: row.target })),
  };
}

export async function logAudit(actorUserId, action, target, meta = {}) {
  await query("insert into audit_logs (id, actor_user_id, action, target, meta_json) values ($1, $2, $3, $4, $5::jsonb)", [newId(), actorUserId || null, action, target, JSON.stringify(meta)]);
}

export function computeStats(values) {
  const numeric = values.map((value) => Number(value)).filter((value) => !Number.isNaN(value)).sort((a, b) => a - b);
  if (!numeric.length) return { avg: "-", median: "-", votes: values.length };
  const avg = (numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(1).replace(/\.0$/, "");
  const middle = Math.floor(numeric.length / 2);
  const median = numeric.length % 2 ? String(numeric[middle]) : String((numeric[middle - 1] + numeric[middle]) / 2).replace(/\.0$/, "");
  return { avg, median, votes: values.length };
}

export async function getDashboard() {
  const result = await query(`
    select
      r.id,
      r.name,
      r.status,
      coalesce(i.title, 'No issue selected yet') as current_issue,
      (select count(*)::int from room_presence rp where rp.room_id = r.id and rp.left_at is null) as participants,
      (select count(*)::int from issues done_issue where done_issue.room_id = r.id and done_issue.state = 'done') as issues_completed
    from rooms r
    left join lateral (
      select title from issues where room_id = r.id and state in ('active', 'done') order by order_index desc limit 1
    ) i on true
    order by r.created_at desc, r.name asc
  `);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    currentIssue: row.current_issue,
    participants: row.participants,
    issuesCompleted: row.issues_completed,
  }));
}

export async function createRoom({ userId, name, deckId }) {
  return tx(async (client) => {
    const roomId = newId();
    await client.query("insert into rooms (id, name, status, deck_id, created_by, status_changed_at) values ($1, $2, 'open', $3, $4, now())", [roomId, name, deckId, userId]);
    await client.query("insert into room_presence (room_id, user_id, joined_at, last_seen) values ($1, $2, now(), now()) on conflict (room_id, user_id) do update set left_at = null, last_seen = now()", [roomId, userId]);
    return roomId;
  });
}

export async function joinRoom(roomId, userId) {
  const existing = await query("select left_at from room_presence where room_id = $1 and user_id = $2", [roomId, userId]);
  await query("insert into room_presence (room_id, user_id, joined_at, last_seen) values ($1, $2, now(), now()) on conflict (room_id, user_id) do update set left_at = null, last_seen = now()", [roomId, userId]);
  const active = await query("select * from issues where room_id = $1 and state = 'active' limit 1", [roomId]);
  if (active.rows[0] && (!existing.rows[0] || existing.rows[0].left_at)) {
    const user = await query("select display_name from users where id = $1", [userId]);
    const ms = Math.max(0, Math.floor(Date.now() - new Date(active.rows[0].started_at).getTime()));
    await query("insert into issue_events (id, issue_id, event_type, user_id, label, event_ms, payload_json) values ($1, $2, 'join', $3, $4, $5, '{}'::jsonb)", [newId(), active.rows[0].id, userId, `${user.rows[0].display_name} join`, ms]);
  }
}

export async function leaveRoom(roomId, userId) {
  await query("update room_presence set left_at = now(), last_seen = now() where room_id = $1 and user_id = $2", [roomId, userId]);
  const active = await query("select * from issues where room_id = $1 and state = 'active' limit 1", [roomId]);
  if (active.rows[0]) {
    const user = await query("select display_name from users where id = $1", [userId]);
    const ms = Math.max(0, Math.floor(Date.now() - new Date(active.rows[0].started_at).getTime()));
    await query("insert into issue_events (id, issue_id, event_type, user_id, label, event_ms, payload_json) values ($1, $2, 'leave', $3, $4, $5, '{}'::jsonb)", [newId(), active.rows[0].id, userId, `${user.rows[0].display_name} leave`, ms]);
  }
}

export async function touchPresence(roomId, userId) {
  await query("update room_presence set last_seen = now() where room_id = $1 and user_id = $2 and left_at is null", [roomId, userId]);
}

function normalizeQueueIssuePayload(titleOrPayload, source = "manual") {
  if (titleOrPayload && typeof titleOrPayload === "object" && !Array.isArray(titleOrPayload)) {
    const payload = titleOrPayload;
    return {
      title: String(payload.title || "").trim(),
      source: String(payload.source || "manual").trim() || "manual",
      externalSource: String(payload.externalSource || payload.source || "manual").trim() || "manual",
      externalIssueId: String(payload.externalIssueId || "").trim(),
      externalIssueKey: String(payload.externalIssueKey || "").trim(),
      externalIssueUrl: String(payload.externalIssueUrl || "").trim(),
      jiraFieldsSnapshot: payload.jiraFieldsSnapshot && typeof payload.jiraFieldsSnapshot === "object" ? payload.jiraFieldsSnapshot : {},
      importedFromBoardId: String(payload.importedFromBoardId || "").trim(),
      importedFromSprintId: String(payload.importedFromSprintId || "").trim(),
    };
  }

  return {
    title: String(titleOrPayload || "").trim(),
    source: String(source || "manual").trim() || "manual",
    externalSource: String(source || "manual").trim() || "manual",
    externalIssueId: "",
    externalIssueKey: "",
    externalIssueUrl: "",
    jiraFieldsSnapshot: {},
    importedFromBoardId: "",
    importedFromSprintId: "",
  };
}

export async function addQueueIssue(roomId, titleOrPayload, source = "manual") {
  const payload = normalizeQueueIssuePayload(titleOrPayload, source);
  const position = await query("select coalesce(max(queue_position), 0)::int as position from issues where room_id = $1 and state = 'queued'", [roomId]);
  const issueId = newId();
  await query(
    `
      insert into issues (
        id, room_id, title, source, state, queue_position, order_index,
        external_source, external_issue_id, external_issue_key, external_issue_url, external_meta_json, imported_board_id, imported_sprint_id
      )
      values ($1, $2, $3, $4, 'queued', $5, 1000, $6, $7, $8, $9, $10::jsonb, $11, $12)
    `,
    [
      issueId,
      roomId,
      payload.title,
      payload.source,
      position.rows[0].position + 1,
      payload.externalSource,
      payload.externalIssueId || null,
      payload.externalIssueKey || null,
      payload.externalIssueUrl || null,
      JSON.stringify(payload.jiraFieldsSnapshot || {}),
      payload.importedFromBoardId || null,
      payload.importedFromSprintId || null,
    ]
  );
  return issueId;
}

export async function updateQueueIssue(roomId, issueId, titleOrPayload, source = "manual") {
  const payload = normalizeQueueIssuePayload(titleOrPayload, source);
  const result = await query(
    `
      update issues
      set
        title = $3,
        source = $4,
        external_source = $5,
        external_issue_id = $6,
        external_issue_key = $7,
        external_issue_url = $8,
        external_meta_json = $9::jsonb,
        imported_board_id = $10,
        imported_sprint_id = $11
      where id = $1 and room_id = $2 and state = 'queued'
      returning id
    `,
    [
      issueId,
      roomId,
      payload.title,
      payload.source,
      payload.externalSource,
      payload.externalIssueId || null,
      payload.externalIssueKey || null,
      payload.externalIssueUrl || null,
      JSON.stringify(payload.jiraFieldsSnapshot || {}),
      payload.importedFromBoardId || null,
      payload.importedFromSprintId || null,
    ]
  );
  if (!result.rows[0]) {
    throw new Error("Queue item not found");
  }
}

export async function deleteQueueIssue(roomId, issueId) {
  return tx(async (client) => {
    const issueResult = await client.query(
      "select queue_position from issues where id = $1 and room_id = $2 and state = 'queued' limit 1",
      [issueId, roomId]
    );
    const issue = issueResult.rows[0];
    if (!issue) {
      throw new Error("Queue item not found");
    }

    await client.query("delete from issues where id = $1 and room_id = $2 and state = 'queued'", [issueId, roomId]);
    await client.query(
      "update issues set queue_position = queue_position - 1 where room_id = $1 and state = 'queued' and queue_position > $2",
      [roomId, issue.queue_position]
    );
  });
}

export async function startQueuedIssue(roomId, issueId) {
  return tx(async (client) => {
    const active = await client.query("select id from issues where room_id = $1 and state = 'active' limit 1", [roomId]);
    if (active.rows[0]) throw new Error("Active issue already exists");
    const nextIssue = await client.query("select * from issues where id = $1 and room_id = $2 and state = 'queued' limit 1", [issueId, roomId]);
    if (!nextIssue.rows[0]) throw new Error("Queue item not found");
    const maxOrder = await client.query("select coalesce(max(order_index), 0)::int as order_index from issues where room_id = $1", [roomId]);
    const startedAt = new Date().toISOString();
    await client.query("update issues set state = 'active', queue_position = 0, order_index = $2, started_at = $3 where id = $1", [issueId, maxOrder.rows[0].order_index + 1, startedAt]);
    await client.query("update rooms set status = 'voting', status_changed_at = now(), closed_at = null where id = $1", [roomId]);
    const participants = await client.query(`
      select
        u.id,
        u.display_name,
        array_remove(array_agg(distinct r.name), null) as roles
      from room_presence rp
      join users u on u.id = rp.user_id
      left join user_roles ur on ur.user_id = u.id
      left join roles r on r.id = ur.role_id
      where rp.room_id = $1 and rp.left_at is null
      group by u.id, u.display_name
      order by u.display_name
    `, [roomId]);
    for (const participant of participants.rows) {
      await client.query("insert into issue_events (id, issue_id, event_type, user_id, label, event_ms, payload_json) values ($1, $2, 'join', $3, $4, 0, '{}'::jsonb)", [newId(), issueId, participant.id, `${participant.display_name} join`]);
    }
  });
}

export async function castVote(roomId, issueId, userId, value) {
  const issueResult = await query("select * from issues where room_id = $1 and id = $2 and state = 'active' limit 1", [roomId, issueId]);
  const issue = issueResult.rows[0];
  if (!issue) throw new Error("Issue not available for voting");
  await query("insert into votes (id, issue_id, user_id, value) values ($1, $2, $3, $4) on conflict (issue_id, user_id) do update set value = excluded.value, created_at = now()", [newId(), issueId, userId, value]);
  const user = await query("select display_name from users where id = $1", [userId]);
  const ms = Math.max(0, Math.floor(Date.now() - new Date(issue.started_at).getTime()));
  await query("insert into issue_events (id, issue_id, event_type, user_id, label, event_ms, payload_json) values ($1, $2, 'vote', $3, $4, $5, $6::jsonb)", [newId(), issueId, userId, `${user.rows[0].display_name} vote`, ms, JSON.stringify({ value })]);
}

export async function revealIssue(roomId, actorUserId) {
  return tx(async (client) => {
    const active = await client.query("select * from issues where room_id = $1 and state = 'active' limit 1", [roomId]);
    const issue = active.rows[0];
    if (!issue) throw new Error("No active issue");
    const revealedAt = new Date();
    const votes = await client.query("select user_id, value from votes where issue_id = $1", [issue.id]);
    const events = await client.query("select event_type, user_id, label, event_ms, payload_json from issue_events where issue_id = $1 order by event_ms, created_at", [issue.id]);
    const participants = await client.query(`
      select
        u.id,
        u.display_name,
        array_remove(array_agg(distinct r.name), null) as roles
      from room_presence rp
      join users u on u.id = rp.user_id
      left join user_roles ur on ur.user_id = u.id
      left join roles r on r.id = ur.role_id
      where rp.room_id = $1 and rp.left_at is null
      group by u.id, u.display_name
      order by u.display_name
    `, [roomId]);
    const durationSeconds = Math.max(1, Math.floor((revealedAt.getTime() - new Date(issue.started_at).getTime()) / 1000));
    const actor = await client.query("select display_name from users where id = $1", [actorUserId]);
    await client.query("insert into issue_events (id, issue_id, event_type, user_id, label, event_ms, payload_json) values ($1, $2, 'reveal', $3, $4, $5, '{}'::jsonb)", [newId(), issue.id, actorUserId, `${actor.rows[0].display_name} reveal`, durationSeconds * 1000]);
    const playback = {
      users: participants.rows.map((row) => ({
        id: row.id,
        display_name: row.display_name,
        can_vote: canUserVote(row.roles),
      })),
      events: [...events.rows.map((row) => ({ type: row.event_type, userId: row.user_id, label: row.label, atMs: row.event_ms, payload: row.payload_json })), { type: "reveal", userId: actorUserId, label: "Reveal", atMs: durationSeconds * 1000, payload: {} }],
      durationSeconds,
    };
    await client.query("update issues set state = 'done', revealed_at = $2, closed_at = $2, duration_seconds = $3, summary_json = $4::jsonb, playback_json = $5::jsonb where id = $1", [issue.id, revealedAt.toISOString(), durationSeconds, JSON.stringify(computeStats(votes.rows.map((row) => row.value))), JSON.stringify(playback)]);
    await client.query("update rooms set status = 'revealed', status_changed_at = now() where id = $1", [roomId]);
  });
}

export async function closeRoom(roomId) {
  await query("update rooms set status = 'closed', status_changed_at = now(), closed_at = now() where id = $1", [roomId]);
}

export async function updateRoomHighlightMode(roomId, highlightMode) {
  const normalizedHighlightMode = normalizeRoomHighlightMode(highlightMode);
  const result = await query(
    "update rooms set highlight_mode = $2 where id = $1 returning id",
    [roomId, normalizedHighlightMode]
  );
  if (!result.rows[0]) {
    throw new Error("Room not found");
  }
  return normalizedHighlightMode;
}

export async function deleteRoom(roomId) {
  await query("delete from rooms where id = $1", [roomId]);
}

export async function getRoom(roomId, currentUserId) {
  const roomResult = await query("select r.*, d.name as deck_name, d.values_json from rooms r join decks d on d.id = r.deck_id where r.id = $1 limit 1", [roomId]);
  const room = roomResult.rows[0];
  if (!room) return null;
  const [participantsResult, activeIssueResult, doneIssueResult, queueResult] = await Promise.all([
    query(`
      select
        u.id,
        u.display_name,
        array_remove(array_agg(distinct r.name), null) as roles
      from room_presence rp
      join users u on u.id = rp.user_id
      left join user_roles ur on ur.user_id = u.id
      left join roles r on r.id = ur.role_id
      where rp.room_id = $1 and rp.left_at is null
      group by u.id, u.display_name
      order by u.display_name
    `, [roomId]),
    query("select * from issues where room_id = $1 and state = 'active' limit 1", [roomId]),
    query("select * from issues where room_id = $1 and state = 'done' order by order_index desc limit 1", [roomId]),
    query("select * from issues where room_id = $1 and state = 'queued' order by queue_position asc", [roomId]),
  ]);
  const activeIssue = activeIssueResult.rows[0];
  const latestDone = doneIssueResult.rows[0];
  const scoringIssueId = activeIssue?.id || ((room.status === "revealed" || room.status === "closed") ? latestDone?.id : null);
  const votes = scoringIssueId ? await query("select user_id, value from votes where issue_id = $1", [scoringIssueId]) : { rows: [] };
  const votesByUser = new Map(votes.rows.map((row) => [row.user_id, row.value]));
  const summary = activeIssue ? computeStats(votes.rows.map((row) => row.value)) : latestDone?.summary_json || { avg: "-", median: "-", votes: 0 };
  const history = await query("select id, title, duration_seconds, summary_json from issues where room_id = $1 and state = 'done' order by order_index desc", [roomId]);
  return {
    id: room.id,
    name: room.name,
    status: room.status,
    deck: { id: room.deck_id, name: room.deck_name, values: room.values_json },
    currentIssue: activeIssue
      ? { id: activeIssue.id, title: activeIssue.title, source: activeIssue.source, startedAt: activeIssue.started_at }
      : room.status === "revealed" || room.status === "closed"
        ? { id: latestDone?.id, title: latestDone?.title || "-", source: latestDone?.source || "jira", startedAt: latestDone?.started_at || null }
        : null,
    participants: participantsResult.rows.map((row) => {
      const { firstName, lastName } = parseNameParts(row.display_name);
      return {
        id: row.id,
        firstName,
        lastName,
        voted: votesByUser.has(row.id),
        canVote: canUserVote(row.roles),
      };
    }),
    queue: queueResult.rows.map((row) => ({ id: row.id, title: row.title, source: row.source, position: row.queue_position })),
    history: history.rows.map((row) => ({ id: row.id, title: row.title, durationSeconds: row.duration_seconds, avg: row.summary_json?.avg || "-", median: row.summary_json?.median || "-", votes: row.summary_json?.votes || 0 })),
    summary,
    issuesPlayed: history.rows.length,
  };
}

export async function getHistoryIssue(roomId, issueId) {
  const result = await query("select * from issues where room_id = $1 and id = $2 and state = 'done' limit 1", [roomId, issueId]);
  const issue = result.rows[0];
  if (!issue) return null;
  return {
    id: issue.id,
    title: issue.title,
    durationSeconds: issue.duration_seconds,
    avg: issue.summary_json?.avg || "-",
    median: issue.summary_json?.median || "-",
    votes: issue.summary_json?.votes || 0,
    ...toCompatJiraIssue(issue),
    playback: issue.playback_json,
  };
}

export async function upsertSettings(input) {
  for (const [key, value] of Object.entries(input)) {
    await query("insert into settings (key, value_json) values ($1, $2::jsonb) on conflict (key) do update set value_json = excluded.value_json", [key, JSON.stringify(value)]);
  }
}

export async function saveDeck({ id, name, values }) {
  if (id) {
    await query("update decks set name = $2, values_json = $3::jsonb where id = $1", [id, name, JSON.stringify(values)]);
    return id;
  }
  const deckId = newId();
  await query("insert into decks (id, name, values_json, is_default) values ($1, $2, $3::jsonb, false)", [deckId, name, JSON.stringify(values)]);
  return deckId;
}

export async function deleteDeck(id) {
  await query("delete from decks where id = $1 and is_default = false", [id]);
}

function resolveSyncedAvatarFields({ currentAvatarDataUrl = "", currentAvatarManagedByAuthSource = "", incomingAvatarDataUrl = "", incomingSource = "" }) {
  const normalizedIncomingSource = String(incomingSource || "").trim().toLowerCase();
  const normalizedCurrentSource = String(currentAvatarManagedByAuthSource || "").trim().toLowerCase();
  const normalizedIncomingAvatar = String(incomingAvatarDataUrl || "").trim();

  if ((normalizedIncomingSource !== "ad" && normalizedIncomingSource !== "entra")) {
    return {
      avatarDataUrl: currentAvatarDataUrl || "",
      avatarManagedByAuthSource: normalizedCurrentSource === "ad" || normalizedCurrentSource === "entra" ? normalizedCurrentSource : "",
      avatarManagedByDirectory: normalizedCurrentSource === "ad" || normalizedCurrentSource === "entra",
    };
  }

  if (normalizedIncomingAvatar) {
    return {
      avatarDataUrl: normalizedIncomingAvatar,
      avatarManagedByAuthSource: normalizedIncomingSource,
      avatarManagedByDirectory: true,
    };
  }

  if (normalizedCurrentSource === normalizedIncomingSource) {
    return {
      avatarDataUrl: "",
      avatarManagedByAuthSource: "",
      avatarManagedByDirectory: false,
    };
  }

  return {
    avatarDataUrl: currentAvatarDataUrl || "",
    avatarManagedByAuthSource: normalizedCurrentSource === "ad" || normalizedCurrentSource === "entra" ? normalizedCurrentSource : "",
    avatarManagedByDirectory: normalizedCurrentSource === "ad" || normalizedCurrentSource === "entra",
  };
}

export async function saveRole({ id, name, description, adGroupName, entraAppRoleValue, entraGroupId, permissionCodes }) {
  return tx(async (client) => {
    const roleId = id || newId();
    const uniquePermissionCodes = [...new Set((permissionCodes || []).filter(Boolean))];
    if (id) {
      await client.query(
        "update roles set name = $2, description = $3, ad_group_name = $4, entra_app_role_value = $5, entra_group_id = $6 where id = $1",
        [id, name, description, adGroupName || null, entraAppRoleValue || null, entraGroupId || null],
      );
      await client.query("delete from role_permissions where role_id = $1", [id]);
    } else {
      await client.query(
        "insert into roles (id, name, description, ad_group_name, entra_app_role_value, entra_group_id) values ($1, $2, $3, $4, $5, $6)",
        [roleId, name, description, adGroupName || null, entraAppRoleValue || null, entraGroupId || null],
      );
    }
    for (const code of uniquePermissionCodes) {
      const permission = await client.query("select id from permissions where code = $1", [code]);
      if (permission.rows[0]) {
        await client.query("insert into role_permissions (role_id, permission_id) values ($1, $2) on conflict do nothing", [roleId, permission.rows[0].id]);
      }
    }
    return roleId;
  });
}

export async function deleteRole(id) {
  await query("delete from roles where id = $1 and name not in ('admin', 'master', 'user')", [id]);
}

export async function saveUser({ id, username, displayName, email, authSource, password, avatarDataUrl = "", roleNames }) {
  return tx(async (client) => {
    const userId = id || newId();
    if (!id) {
      const taken = await client.query("select 1 from users where lower(username) = lower($1) limit 1", [username]);
      if (taken.rows[0]) {
        throw new Error("Username is already in use");
      }
    }
    if (id) {
      const existingUserResult = await client.query(
        "select avatar_data_url, avatar_managed_by_directory, avatar_managed_by_auth_source from users where id = $1 limit 1",
        [id],
      );
      const existingUser = existingUserResult.rows[0] || {};
      const existingAvatarManagedByAuthSource = normalizeAvatarManagedByAuthSource(existingUser);
      const nextAvatarDataUrl = authSource === "local" && !existingAvatarManagedByAuthSource
        ? avatarDataUrl
        : existingUser.avatar_data_url || "";
      const nextAvatarManagedByDirectory = authSource === "local" && !existingAvatarManagedByAuthSource
        ? false
        : Boolean(existingAvatarManagedByAuthSource);
      const nextAvatarManagedByAuthSource = authSource === "local" && !existingAvatarManagedByAuthSource
        ? ""
        : existingAvatarManagedByAuthSource;
      await client.query(
        `
          update users
          set
            display_name = $2,
            email = $3,
            auth_source = $4,
            password_hash = coalesce($5, password_hash),
            avatar_data_url = $6,
            avatar_managed_by_directory = $7,
            avatar_managed_by_auth_source = $8
          where id = $1
        `,
        [id, displayName, email, authSource, password ? hashPassword(password) : null, nextAvatarDataUrl, nextAvatarManagedByDirectory, nextAvatarManagedByAuthSource]
      );
      await client.query("delete from user_roles where user_id = $1", [id]);
    } else {
      await client.query(
        `
          insert into users (
            id, username, display_name, email, auth_source, is_active, password_hash, avatar_data_url,
            avatar_managed_by_directory, avatar_managed_by_auth_source
          )
          values ($1, $2, $3, $4, $5, true, $6, $7, false, '')
        `,
        [userId, username, displayName, email, authSource, password ? hashPassword(password) : null, authSource === "local" ? avatarDataUrl : ""]
      );
    }
    for (const roleName of roleNames) {
      const role = await client.query("select id from roles where name = $1", [roleName]);
      if (role.rows[0]) await client.query("insert into user_roles (user_id, role_id) values ($1, $2)", [userId, role.rows[0].id]);
    }
    return userId;
  });
}

export async function updateCurrentUserProfile(userId, { displayName, avatarDataUrl, theme }) {
  const existing = await query("select auth_source, avatar_data_url, avatar_managed_by_directory, avatar_managed_by_auth_source from users where id = $1 limit 1", [userId]);
  const user = existing.rows[0];
  if (!user) {
    return null;
  }

  const avatarManagedByAuthSource = normalizeAvatarManagedByAuthSource(user);
  const safeAvatar = !avatarManagedByAuthSource
    ? avatarDataUrl || ""
    : user.avatar_data_url || "";
  await query("update users set display_name = $2, avatar_data_url = $3, theme = $4 where id = $1", [
    userId,
    displayName,
    safeAvatar,
    normalizeUserTheme(theme),
  ]);
  return getUserById(userId);
}

export async function getUserById(userId) {
  return getUserByIdWithExecutor({ query }, userId);
}

async function getUserByIdWithExecutor(executor, userId) {
  const result = await executor.query(`
    select
      u.*,
      array_remove(array_agg(distinct r.name), null) as roles,
      array_remove(array_agg(distinct p.code), null) as permission_codes
    from users u
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    where u.id = $1
    group by u.id
    limit 1
  `, [userId]);
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

export async function deactivateUser(id) {
  return tx(async (client) => {
    const existing = await client.query(
      "select id, username, auth_source, is_active, anonymized_at from users where id = $1 limit 1",
      [id]
    );
    const user = existing.rows[0];
    if (!user || isSystemManagedAuthSource(user.auth_source) || user.is_active === false || user.anonymized_at) {
      return false;
    }

    await client.query(
      `
        update users
        set
          deactivated_username = case
            when deactivated_username is null or deactivated_username = '' then username
            else deactivated_username
          end,
          avatar_data_url = '',
          avatar_managed_by_directory = false,
          avatar_managed_by_auth_source = '',
          is_active = false,
          deactivated_at = now(),
          password_hash = null
        where id = $1
      `,
      [id]
    );
    await client.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [id]);
    return true;
  });
}

export async function anonymizeUser(id) {
  return tx(async (client) => {
    const existing = await client.query(
      "select id, auth_source, is_active, anonymized_at from users where id = $1 limit 1",
      [id]
    );
    const user = existing.rows[0];
    if (!user || isSystemManagedAuthSource(user.auth_source) || user.is_active === true || user.anonymized_at) {
      return false;
    }

    const anonymizedUsername = `anonymized_${id}`;
    await client.query(
      `
        update users
        set
          username = $2,
          display_name = 'Inactive user',
          email = $3,
          external_id = null,
          entra_external_id = null,
          entra_tenant_id = null,
          avatar_data_url = '',
          avatar_managed_by_directory = false,
          avatar_managed_by_auth_source = '',
          deactivated_username = null,
          anonymized_at = now(),
          password_hash = null
        where id = $1
      `,
      [id, anonymizedUsername, `${anonymizedUsername}@sprinto.local`]
    );
    await client.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [id]);
    return true;
  });
}

export async function anonymizeDeactivatedUsersForScheduledTask(referenceTime = new Date(), anonymizeAfterValue = 30, anonymizeAfterUnit = "days") {
  return tx(async (client) => {
    const cutoff = subtractAgeFromDate(referenceTime, anonymizeAfterValue, anonymizeAfterUnit);
    const affectedUsers = await client.query(
      `
        select
          id,
          username,
          display_name as "displayName",
          email,
          auth_source as "authSource"
        from users
        where
          is_active = false
          and anonymized_at is null
          and deactivated_at is not null
          and deactivated_at <= $1
      `,
      [cutoff.toISOString()]
    );
    const result = await client.query(
      `
        update users
        set
          username = 'anonymized_' || id,
          display_name = 'Inactive user',
          email = 'anonymized_' || id || '@sprinto.local',
          external_id = null,
          entra_external_id = null,
          entra_tenant_id = null,
          avatar_data_url = '',
          avatar_managed_by_directory = false,
          avatar_managed_by_auth_source = '',
          deactivated_username = null,
          anonymized_at = now(),
          password_hash = null
        where
          is_active = false
          and anonymized_at is null
          and deactivated_at is not null
          and deactivated_at <= $1
        returning id
      `,
      [cutoff.toISOString()]
    );
    await client.query(
      "update sessions set revoked_at = now() where user_id = any($1::text[]) and revoked_at is null",
      [result.rows.map((row) => row.id)]
    );
    return affectedUsers.rows;
  });
}

export async function closeRoomsForScheduledTask(referenceTime = new Date(), closeAfterValue = 30, closeAfterUnit = "days", roomStatuses = []) {
  return tx(async (client) => {
    const normalizedStatuses = [...new Set((Array.isArray(roomStatuses) ? roomStatuses : [])
      .filter((status) => ROOM_STATUS_VALUES.includes(status) && status !== "closed"))];
    if (normalizedStatuses.length === 0) {
      return [];
    }

    const cutoff = subtractAgeFromDate(referenceTime, closeAfterValue, closeAfterUnit);
    const affectedRooms = await client.query(
      `
        select
          id,
          name,
          status,
          created_at as "createdAt",
          status_changed_at as "statusChangedAt"
        from rooms
        where
          status = any($1::text[])
          and coalesce(status_changed_at, created_at) <= $2
      `,
      [normalizedStatuses, cutoff.toISOString()]
    );
    await client.query(
      `
        update rooms
        set
          status = 'closed',
          status_changed_at = now(),
          closed_at = now()
        where
          status = any($1::text[])
          and coalesce(status_changed_at, created_at) <= $2
      `,
      [normalizedStatuses, cutoff.toISOString()]
    );
    return affectedRooms.rows;
  });
}

export async function closeInactiveSessionsForScheduledTask(referenceTime = new Date(), closeAfterValue = 30, closeAfterUnit = "days") {
  return tx(async (client) => {
    const cutoff = subtractAgeFromDate(referenceTime, closeAfterValue, closeAfterUnit);
    const affectedSessions = await client.query(
      `
        select
          s.id,
          s.user_id as "userId",
          s.last_seen as "lastSeenAt",
          u.username,
          u.display_name as "displayName"
        from sessions s
        join users u on u.id = s.user_id
        where
          s.revoked_at is null
          and s.last_seen <= $1
      `,
      [cutoff.toISOString()]
    );
    await client.query(
      `
        update sessions
        set revoked_at = now()
        where revoked_at is null
          and last_seen <= $1
      `,
      [cutoff.toISOString()]
    );
    return affectedSessions.rows;
  });
}

export async function markScheduledTaskRun(taskKey, executedAt) {
  const settings = await getSettings();
  const scheduledTasks = normalizeScheduledTasks(settings?.scheduledTasks || {});
  if (!scheduledTasks[taskKey]) {
    return;
  }
  scheduledTasks[taskKey] = {
    ...scheduledTasks[taskKey],
    lastRunAt: executedAt,
  };
  await upsertSettings({ scheduled_tasks: scheduledTasks });
}

export async function reactivateUser({ id, username, displayName, email, password, avatarDataUrl = "", roleNames }) {
  return tx(async (client) => {
    const existing = await client.query(
      "select id, auth_source, is_active, anonymized_at from users where id = $1 limit 1",
      [id]
    );
    const user = existing.rows[0];
    if (!user || user.auth_source !== "local" || user.is_active === true || user.anonymized_at) {
      return false;
    }

    const taken = await client.query(
      "select 1 from users where lower(username) = lower($1) and id <> $2 limit 1",
      [username, id]
    );
    if (taken.rows[0]) {
      throw new Error("Username is already in use");
    }

    await client.query(
      `
        update users
        set
          username = $2,
          deactivated_username = null,
          display_name = $3,
          email = $4,
          avatar_data_url = $5,
          avatar_managed_by_directory = false,
          avatar_managed_by_auth_source = '',
          is_active = true,
          deactivated_at = null,
          anonymized_at = null,
          password_hash = $6
        where id = $1
      `,
      [id, username, displayName, email || null, avatarDataUrl || "", hashPassword(password)]
    );
    await client.query("delete from user_roles where user_id = $1", [id]);
    for (const roleName of roleNames) {
      const role = await client.query("select id from roles where name = $1", [roleName]);
      if (role.rows[0]) {
        await client.query("insert into user_roles (user_id, role_id) values ($1, $2)", [id, role.rows[0].id]);
      }
    }
    return true;
  });
}

function normalizeIdentityMappingValues(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
}

async function ensureUniqueUsername(client, preferredUsername, excludedUserId = "") {
  const normalizedPreferredUsername = String(preferredUsername || "").trim() || "entra-user";
  const normalizedExcludedUserId = String(excludedUserId || "").trim();
  const deterministicSuffix = normalizedExcludedUserId
    ? normalizedExcludedUserId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8)
    : "";
  let attempt = 0;

  while (attempt < 50) {
    const candidate = attempt === 0
      ? normalizedPreferredUsername
      : deterministicSuffix
        ? `${normalizedPreferredUsername}-${deterministicSuffix}${attempt > 1 ? `-${attempt}` : ""}`
        : `${normalizedPreferredUsername}-${attempt}`;
    const taken = await client.query(
      "select id from users where lower(username) = lower($1) and id <> $2 limit 1",
      [candidate, normalizedExcludedUserId || ""],
    );
    if (!taken.rows[0]) {
      return candidate;
    }
    attempt += 1;
  }

  throw new Error("Unable to generate a unique username for this Microsoft Entra account.");
}

export async function findUserByEntraIdentity(tenantId, externalId) {
  const result = await query(`
    select
      u.*,
      array_remove(array_agg(distinct r.name), null) as roles,
      array_remove(array_agg(distinct p.code), null) as permission_codes
    from users u
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    where u.entra_tenant_id = $1 and u.entra_external_id = $2
    group by u.id
    limit 1
  `, [String(tenantId || "").trim(), String(externalId || "").trim()]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function findEntraLinkCandidatesByEmail(email) {
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail) {
    return [];
  }

  const result = await query(`
    select
      u.*,
      array_remove(array_agg(distinct r.name), null) as roles,
      array_remove(array_agg(distinct p.code), null) as permission_codes
    from users u
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    where
      lower(coalesce(u.email, '')) = lower($1)
      and u.is_active = true
      and u.anonymized_at is null
      and u.auth_source <> 'system'
    group by u.id
    order by u.created_at asc
  `, [normalizedEmail]);
  return result.rows.map(mapUser);
}

export async function findPendingEntraMigrationCandidatesByEmail(email) {
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail) {
    return [];
  }

  const result = await query(`
    select
      u.*,
      array_remove(array_agg(distinct r.name), null) as roles,
      array_remove(array_agg(distinct p.code), null) as permission_codes
    from users u
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    where
      lower(coalesce(u.email, '')) = lower($1)
      and u.is_active = true
      and u.anonymized_at is null
      and u.auth_source in ('local', 'ad')
      and u.entra_migration_state = 'pending'
    group by u.id
    order by u.created_at asc
  `, [normalizedEmail]);
  return result.rows.map(mapUser);
}

export async function findActiveEntraUsersByEmail(email) {
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail) {
    return [];
  }

  const result = await query(`
    select
      u.*,
      array_remove(array_agg(distinct r.name), null) as roles,
      array_remove(array_agg(distinct p.code), null) as permission_codes
    from users u
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    where
      lower(coalesce(u.email, '')) = lower($1)
      and u.is_active = true
      and u.anonymized_at is null
      and u.auth_source = 'entra'
    group by u.id
    order by u.created_at asc
  `, [normalizedEmail]);
  return result.rows.map(mapUser);
}

export async function resolveRoleNamesForAdGroups(groupIdentifiers = []) {
  const normalizedGroups = [...new Set(groupIdentifiers.map((group) => String(group || "").trim().toLowerCase()).filter(Boolean))];
  if (normalizedGroups.length === 0) {
    return [];
  }
  const roles = await listRoles();
  return roles
    .filter((role) => normalizedGroups.includes(String(role.adGroupName || "").trim().toLowerCase()))
    .map((role) => role.name);
}

export async function resolveRoleNamesForEntraClaims({ appRoleValues = [], groupIds = [] } = {}) {
  const normalizedAppRoles = normalizeIdentityMappingValues(appRoleValues);
  const normalizedGroupIds = normalizeIdentityMappingValues(groupIds);
  if (normalizedAppRoles.length === 0 && normalizedGroupIds.length === 0) {
    return [];
  }

  const roles = await listRoles();
  return roles
    .filter((role) => (
      normalizedAppRoles.includes(String(role.entraAppRoleValue || "").trim().toLowerCase())
      || normalizedGroupIds.includes(String(role.entraGroupId || "").trim().toLowerCase())
    ))
    .map((role) => role.name);
}

export async function linkEntraIdentityToExistingUser({ userId, tenantId, externalId, avatarDataUrl = "" }) {
  return tx(async (client) => {
    const result = await client.query(
      "select id, auth_source, avatar_data_url, avatar_managed_by_directory, avatar_managed_by_auth_source from users where id = $1 limit 1",
      [userId],
    );
    const existing = result.rows[0];
    if (!existing) {
      return null;
    }

    const nextAvatar = existing.auth_source === "ad"
      ? {
          avatarDataUrl: existing.avatar_data_url || "",
          avatarManagedByAuthSource: normalizeAvatarManagedByAuthSource(existing),
          avatarManagedByDirectory: Boolean(normalizeAvatarManagedByAuthSource(existing)),
        }
      : resolveSyncedAvatarFields({
          currentAvatarDataUrl: existing.avatar_data_url || "",
          currentAvatarManagedByAuthSource: normalizeAvatarManagedByAuthSource(existing),
          incomingAvatarDataUrl: avatarDataUrl,
          incomingSource: "entra",
        });

    await client.query(
      `
        update users
        set
          entra_tenant_id = $2,
          entra_external_id = $3,
          avatar_data_url = $4,
          avatar_managed_by_directory = $5,
          avatar_managed_by_auth_source = $6
        where id = $1
      `,
      [userId, String(tenantId || "").trim(), String(externalId || "").trim(), nextAvatar.avatarDataUrl, nextAvatar.avatarManagedByDirectory, nextAvatar.avatarManagedByAuthSource],
    );

    return getUserByIdWithExecutor(client, userId);
  });
}

function resolvePendingEntraForceAt(forceAt, fallbackForceAt) {
  const candidate = String(forceAt || "").trim() || String(fallbackForceAt || "").trim();
  if (!candidate) {
    return null;
  }
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function prepareUserForEntraMigration({ userId, preparedByUserId, forceAt = null, fallbackForceAt = null }) {
  return tx(async (client) => {
    const existing = await client.query(
      `
        select
          u.*,
          array_remove(array_agg(distinct r.name), null) as roles,
          array_remove(array_agg(distinct p.code), null) as permission_codes
        from users u
        left join user_roles ur on ur.user_id = u.id
        left join roles r on r.id = ur.role_id
        left join role_permissions rp on rp.role_id = r.id
        left join permissions p on p.id = rp.permission_id
        where u.id = $1
        group by u.id
        limit 1
      `,
      [userId],
    );
    const user = existing.rows[0] ? mapUser(existing.rows[0]) : null;
    if (!user) {
      return null;
    }
    if (!["local", "ad"].includes(user.authSource) || !user.isActive || user.anonymizedAt) {
      return null;
    }

    const resolvedForceAt = resolvePendingEntraForceAt(forceAt, fallbackForceAt);
    await client.query(
      `
        update users
        set
          entra_migration_state = 'pending',
          entra_migration_prepared_at = now(),
          entra_migration_prepared_by_user_id = $2,
          entra_migration_prompt_count = 0,
          entra_migration_force_at = $3
        where id = $1
      `,
      [userId, preparedByUserId || null, resolvedForceAt],
    );
    return getUserByIdWithExecutor(client, userId);
  });
}

export async function cancelUserEntraMigration(userId) {
  return tx(async (client) => {
    const existing = await client.query("select id, entra_migration_state from users where id = $1 limit 1", [userId]);
    if (!existing.rows[0] || normalizeEntraMigrationState(existing.rows[0].entra_migration_state) !== "pending") {
      return null;
    }
    await client.query(
      `
        update users
        set
          entra_migration_state = '',
          entra_migration_prepared_at = null,
          entra_migration_prepared_by_user_id = null,
          entra_migration_prompt_count = 0,
          entra_migration_force_at = null
        where id = $1
      `,
      [userId],
    );
    return getUserByIdWithExecutor(client, userId);
  });
}

export async function cancelAllPendingEntraMigrations() {
  return tx(async (client) => {
    const existing = await client.query(
      `
        select id
        from users
        where entra_migration_state = 'pending'
      `,
    );
    if (!existing.rows.length) {
      return [];
    }
    await client.query(
      `
        update users
        set
          entra_migration_state = '',
          entra_migration_prepared_at = null,
          entra_migration_prepared_by_user_id = null,
          entra_migration_prompt_count = 0,
          entra_migration_force_at = null
        where entra_migration_state = 'pending'
      `,
    );
    return existing.rows.map((row) => row.id);
  });
}

export async function noteUserEntraMigrationPrompt(userId) {
  return tx(async (client) => {
    await client.query(
      `
        update users
        set entra_migration_prompt_count = greatest(coalesce(entra_migration_prompt_count, 0), 0) + 1
        where id = $1 and entra_migration_state = 'pending'
      `,
      [userId],
    );
    return getUserByIdWithExecutor(client, userId);
  });
}

export async function deactivateUserForEntraAccessLoss(userId) {
  return tx(async (client) => {
    const existing = await client.query(
      `
        select id, username, auth_source, is_active, anonymized_at
        from users
        where id = $1
        limit 1
      `,
      [userId],
    );
    const user = existing.rows[0];
    if (!user || isSystemManagedAuthSource(user.auth_source) || user.is_active === false || user.anonymized_at) {
      return null;
    }

    await client.query(
      `
        update users
        set
          deactivated_username = case
            when deactivated_username is null or deactivated_username = '' then username
            else deactivated_username
          end,
          avatar_data_url = '',
          avatar_managed_by_directory = false,
          avatar_managed_by_auth_source = '',
          is_active = false,
          deactivated_at = now(),
          password_hash = null,
          entra_migration_state = '',
          entra_migration_prepared_at = null,
          entra_migration_prepared_by_user_id = null,
          entra_migration_prompt_count = 0,
          entra_migration_force_at = null
        where id = $1
      `,
      [userId],
    );
    await client.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
    return getUserByIdWithExecutor(client, userId);
  });
}

export async function convertUserToEntra({
  userId,
  tenantId,
  externalId,
  username,
  displayName,
  email,
  avatarDataUrl = "",
  roleNames = [],
}) {
  return tx(async (client) => {
    const existingResult = await client.query(
      `
        select
          id,
          auth_source,
          avatar_data_url,
          avatar_managed_by_directory,
          avatar_managed_by_auth_source
        from users
        where id = $1
        limit 1
      `,
      [userId],
    );
    if (!existingResult.rows[0]) {
      return null;
    }

    const normalizedTenantId = String(tenantId || "").trim();
    const normalizedExternalId = String(externalId || "").trim();
    const normalizedDisplayName = String(displayName || "").trim();
    const normalizedEmail = String(email || "").trim() || null;
    const normalizedUsername = await ensureUniqueUsername(client, username, userId);
    const nextAvatar = resolveSyncedAvatarFields({
      currentAvatarDataUrl: existingResult.rows[0]?.avatar_data_url || "",
      currentAvatarManagedByAuthSource: normalizeAvatarManagedByAuthSource(existingResult.rows[0] || {}),
      incomingAvatarDataUrl: avatarDataUrl,
      incomingSource: "entra",
    });

    await client.query(
      `
        update users
        set
          username = $2,
          display_name = $3,
          email = $4,
          auth_source = 'entra',
          external_id = null,
          entra_tenant_id = $5,
          entra_external_id = $6,
          avatar_data_url = $7,
          avatar_managed_by_directory = $8,
          avatar_managed_by_auth_source = $9,
          is_active = true,
          deactivated_username = null,
          deactivated_at = null,
          anonymized_at = null,
          password_hash = null,
          entra_migration_state = '',
          entra_migration_prepared_at = null,
          entra_migration_prepared_by_user_id = null,
          entra_migration_prompt_count = 0,
          entra_migration_force_at = null
        where id = $1
      `,
      [userId, normalizedUsername, normalizedDisplayName || normalizedUsername, normalizedEmail, normalizedTenantId, normalizedExternalId, nextAvatar.avatarDataUrl, nextAvatar.avatarManagedByDirectory, nextAvatar.avatarManagedByAuthSource],
    );
    await client.query("delete from user_roles where user_id = $1", [userId]);

    for (const roleName of roleNames) {
      const role = await client.query("select id from roles where name = $1", [roleName]);
      if (role.rows[0]) {
        await client.query("insert into user_roles (user_id, role_id) values ($1, $2)", [userId, role.rows[0].id]);
      }
    }

    await client.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
    return getUserByIdWithExecutor(client, userId);
  });
}

export async function syncEntraUser({ tenantId, externalId, username, displayName, email, avatarDataUrl = "", roleNames = [] }) {
  return tx(async (client) => {
    const normalizedTenantId = String(tenantId || "").trim();
    const normalizedExternalId = String(externalId || "").trim();
    const normalizedDisplayName = String(displayName || "").trim();
    const normalizedEmail = String(email || "").trim() || null;
    const existingResult = await client.query(
      `
        select
          id,
          auth_source,
          avatar_data_url,
          avatar_managed_by_directory,
          avatar_managed_by_auth_source
        from users
        where entra_tenant_id = $1 and entra_external_id = $2
        limit 1
      `,
      [normalizedTenantId, normalizedExternalId],
    );
    const userId = existingResult.rows[0]?.id || newId();
    const normalizedUsername = await ensureUniqueUsername(client, username, userId);
    const nextAvatar = resolveSyncedAvatarFields({
      currentAvatarDataUrl: existingResult.rows[0]?.avatar_data_url || "",
      currentAvatarManagedByAuthSource: normalizeAvatarManagedByAuthSource(existingResult.rows[0] || {}),
      incomingAvatarDataUrl: avatarDataUrl,
      incomingSource: "entra",
    });

    if (existingResult.rows[0]) {
      await client.query(
        `
          update users
          set
            username = $2,
            display_name = $3,
            email = $4,
            auth_source = 'entra',
            external_id = null,
            entra_tenant_id = $5,
            entra_external_id = $6,
            avatar_data_url = $7,
            avatar_managed_by_directory = $8,
            avatar_managed_by_auth_source = $9,
            is_active = true,
            deactivated_username = null,
            deactivated_at = null,
            anonymized_at = null,
            password_hash = null
          where id = $1
        `,
        [userId, normalizedUsername, normalizedDisplayName || normalizedUsername, normalizedEmail, normalizedTenantId, normalizedExternalId, nextAvatar.avatarDataUrl, nextAvatar.avatarManagedByDirectory, nextAvatar.avatarManagedByAuthSource],
      );
      await client.query("delete from user_roles where user_id = $1", [userId]);
    } else {
      await client.query(
        `
          insert into users (
            id, username, display_name, email, auth_source, external_id, entra_tenant_id, entra_external_id,
            is_active, password_hash, avatar_data_url, avatar_managed_by_directory, avatar_managed_by_auth_source
          )
          values ($1, $2, $3, $4, 'entra', null, $5, $6, true, null, $7, $8, $9)
        `,
        [userId, normalizedUsername, normalizedDisplayName || normalizedUsername, normalizedEmail, normalizedTenantId, normalizedExternalId, nextAvatar.avatarDataUrl, nextAvatar.avatarManagedByDirectory, nextAvatar.avatarManagedByAuthSource],
      );
    }

    for (const roleName of roleNames) {
      const role = await client.query("select id from roles where name = $1", [roleName]);
      if (role.rows[0]) {
        await client.query("insert into user_roles (user_id, role_id) values ($1, $2)", [userId, role.rows[0].id]);
      }
    }

    return getUserByIdWithExecutor(client, userId);
  });
}

export async function syncActiveDirectoryUser({ externalId, username, displayName, email, avatarDataUrl = "", roleNames }) {
  return tx(async (client) => {
    const normalizedUsername = String(username || "").trim();
    const normalizedDisplayName = String(displayName || "").trim() || normalizedUsername;
    const normalizedEmail = String(email || "").trim() || null;
    const normalizedAvatarDataUrl = String(avatarDataUrl || "").trim();
    const hasDirectoryAvatar = Boolean(normalizedAvatarDataUrl);

    const existingByExternalId = await client.query(
      "select id, auth_source, avatar_data_url, avatar_managed_by_directory, avatar_managed_by_auth_source from users where auth_source = 'ad' and external_id = $1 limit 1",
      [externalId],
    );
    const userId = existingByExternalId.rows[0]?.id || newId();
    const existingAvatarDataUrl = String(existingByExternalId.rows[0]?.avatar_data_url || "");
    const existingAvatarManagedByAuthSource = normalizeAvatarManagedByAuthSource(existingByExternalId.rows[0] || {});
    const resolvedAvatarDataUrl = hasDirectoryAvatar
      ? normalizedAvatarDataUrl
      : existingAvatarManagedByAuthSource === "ad"
        ? ""
        : existingAvatarDataUrl;

    const taken = await client.query(
      "select id from users where lower(username) = lower($1) and id <> $2 limit 1",
      [normalizedUsername, userId],
    );
    if (taken.rows[0]) {
      throw new Error("An existing Sprinto account already uses this username");
    }

    if (existingByExternalId.rows[0]) {
      await client.query(
        `
          update users
          set
            username = $2,
            display_name = $3,
            email = $4,
            avatar_data_url = $5,
            avatar_managed_by_directory = $6,
            avatar_managed_by_auth_source = $7,
            external_id = $8,
            auth_source = 'ad',
            is_active = true,
            deactivated_username = null,
            deactivated_at = null,
            anonymized_at = null
          where id = $1
        `,
        [userId, normalizedUsername, normalizedDisplayName, normalizedEmail, resolvedAvatarDataUrl, hasDirectoryAvatar, hasDirectoryAvatar ? "ad" : "", externalId],
      );
      await client.query("delete from user_roles where user_id = $1", [userId]);
    } else {
      await client.query(
        `
          insert into users (id, username, display_name, email, auth_source, external_id, is_active, password_hash, avatar_data_url, avatar_managed_by_directory, avatar_managed_by_auth_source)
          values ($1, $2, $3, $4, 'ad', $5, true, null, $6, $7, $8)
        `,
        [userId, normalizedUsername, normalizedDisplayName, normalizedEmail, externalId, resolvedAvatarDataUrl, hasDirectoryAvatar, hasDirectoryAvatar ? "ad" : ""],
      );
    }

    for (const roleName of roleNames) {
      const role = await client.query("select id from roles where name = $1", [roleName]);
      if (role.rows[0]) {
        await client.query("insert into user_roles (user_id, role_id) values ($1, $2)", [userId, role.rows[0].id]);
      }
    }

    return getUserByIdWithExecutor(client, userId);
  });
}

export async function deactivateActiveDirectoryUserByExternalId(externalId) {
  return tx(async (client) => {
    const existing = await client.query(
      "select id, username, is_active, anonymized_at from users where auth_source = 'ad' and external_id = $1 limit 1",
      [externalId],
    );
    const user = existing.rows[0];
    if (!user || user.is_active === false || user.anonymized_at) {
      return false;
    }

    await client.query(
      `
        update users
        set
          deactivated_username = case
            when deactivated_username is null or deactivated_username = '' then username
            else deactivated_username
          end,
          avatar_data_url = '',
          avatar_managed_by_directory = false,
          avatar_managed_by_auth_source = '',
          is_active = false,
          deactivated_at = now()
        where id = $1
      `,
      [user.id],
    );
    await client.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [user.id]);
    return true;
  });
}

export function validatePassword(password, settings) {
  const minimumPasswordLength = settings.minimumPasswordLength ?? settings.minPasswordLength ?? 8;
  if (!password) return "New password is required";
  if (password.length < minimumPasswordLength) return "New password does not meet requirements";
  if (settings.requirePasswordComplexity) {
    const checks = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];
    if (!checks.every((check) => check.test(password))) return "New password does not meet requirements";
  }
  return null;
}

export async function changePassword(userId, currentPassword, newPassword) {
  const userResult = await query("select * from users where id = $1 limit 1", [userId]);
  const user = userResult.rows[0];
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return { ok: false, message: "Failed to change password. Check your current password." };
  }
  const settings = await getSettings();
  const error = validatePassword(newPassword, settings);
  if (error) return { ok: false, message: error };
  await query("update users set password_hash = $2 where id = $1", [userId, hashPassword(newPassword)]);
  return { ok: true, message: "Password changed successfully" };
}

const permissionCatalog = [
  { name: "vote", description: "Cast estimation votes in active poker rounds." },
  { name: "view_votes_of_others", description: "View how other participants voted after reveal." },
  { name: "queue_issues", description: "Manage the room issue queue." },
  { name: "reveal_votes", description: "Reveal all votes for the current issue." },
  { name: "close_poker", description: "End the current estimation round." },
  { name: "create_room", description: "Create new rooms." },
  { name: "delete_room", description: "Delete existing rooms." },
  { name: "highlight_cards", description: "Configure highlighted cards after reveal." },
  { name: "jira_import_issues", description: "Import Jira issues into room queues." },
  { name: "jira_send", description: "Send estimates, comments, and PDF reports to Jira." },
  { name: "worklog_view", description: "View Jira worklog reports." },
  { name: "manage_users", description: "Create, edit, and deactivate users." },
  { name: "manage_roles", description: "Manage roles and permissions." },
  { name: "manage_settings", description: "Manage system settings." },
  { name: "manage_integrations", description: "Manage integration settings." },
  { name: "manage_room_settings", description: "Manage room defaults and room-related settings." },
  { name: "manage_decks", description: "Manage estimation decks." },
  { name: "manage_sessions", description: "View and revoke active sessions." },
  { name: "manage_audit_logs", description: "View audit logs." },
  { name: "manage_scheduled_tasks", description: "Manage scheduled tasks." },
  { name: "manage_updates", description: "View update information and configure update checks." },
];

const internalToExternalPermission = {
  "room.vote": "vote",
  "room.history.view": "view_votes_of_others",
  "room.queue.manage": "queue_issues",
  "room.reveal": "reveal_votes",
  "room.close": "close_poker",
  "room.create": "create_room",
  "room.delete": "delete_room",
  "room.highlight": "highlight_cards",
  "jira.issues.import": "jira_import_issues",
  "jira.estimates.write": "jira_send",
  "jira.reports.post": "jira_send",
  "jira.send": "jira_send",
  "jira.worklog.view": "worklog_view",
  "users.manage": "manage_users",
  "roles.manage": "manage_roles",
  "settings.manage": "manage_settings",
  "integrations.manage": "manage_integrations",
  "room.settings.manage": "manage_room_settings",
  "decks.manage": "manage_decks",
  "sessions.manage": "manage_sessions",
  "audit.manage": "manage_audit_logs",
  "tasks.manage": "manage_scheduled_tasks",
  "updates.manage": "manage_updates",
};

const externalToInternalPermission = Object.fromEntries(
  Object.entries(internalToExternalPermission).map(([internalCode, externalCode]) => [externalCode, internalCode]),
);

function externalPermissionName(permission) {
  const code = typeof permission === "string" ? permission : permission?.code;
  return internalToExternalPermission[code] || null;
}

function toCompatRole(role) {
  const permissions = [...new Set((role.permissions || []).map(externalPermissionName).filter(Boolean))];
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    adGroupName: role.adGroupName || "",
    entraAppRoleValue: role.entraAppRoleValue || "",
    entraGroupId: role.entraGroupId || "",
    permissions,
  };
}

function statsForCompat(values) {
  const numeric = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (numeric.length === 0) {
    return { average: null, median: null };
  }

  const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const middle = Math.floor(numeric.length / 2);
  const median =
    numeric.length % 2 === 0
      ? (numeric[middle - 1] + numeric[middle]) / 2
      : numeric[middle];

  return { average, median };
}

function emptyJiraDeliveryStatus() {
  return {
    estimate: {
      sentAt: null,
      sentByUserId: "",
      sentByDisplayName: "",
      mode: "",
      storyPointsValue: null,
      originalEstimate: "",
    },
    report: {
      sentAt: null,
      sentByUserId: "",
      sentByDisplayName: "",
      finalValue: "",
      commentPosted: false,
      pdfUploaded: false,
    },
    assignee: {
      sentAt: null,
      sentByUserId: "",
      sentByDisplayName: "",
      accountId: "",
      displayName: "",
    },
  };
}

function normalizeJiraDeliveryStatus(value = {}) {
  const base = emptyJiraDeliveryStatus();
  const estimate = value?.estimate && typeof value.estimate === "object" ? value.estimate : {};
  const report = value?.report && typeof value.report === "object" ? value.report : {};
  const assignee = value?.assignee && typeof value.assignee === "object" ? value.assignee : {};
  return {
    estimate: {
      sentAt: typeof estimate.sentAt === "string" && estimate.sentAt ? estimate.sentAt : null,
      sentByUserId: typeof estimate.sentByUserId === "string" ? estimate.sentByUserId : "",
      sentByDisplayName: typeof estimate.sentByDisplayName === "string" ? estimate.sentByDisplayName : "",
      mode: ["story-points", "original-estimate", "both"].includes(estimate.mode) ? estimate.mode : "",
      storyPointsValue: Number.isFinite(Number(estimate.storyPointsValue)) ? Number(estimate.storyPointsValue) : null,
      originalEstimate: typeof estimate.originalEstimate === "string" ? estimate.originalEstimate : "",
    },
    report: {
      sentAt: typeof report.sentAt === "string" && report.sentAt ? report.sentAt : null,
      sentByUserId: typeof report.sentByUserId === "string" ? report.sentByUserId : "",
      sentByDisplayName: typeof report.sentByDisplayName === "string" ? report.sentByDisplayName : "",
      finalValue: typeof report.finalValue === "string" ? report.finalValue : "",
      commentPosted: Boolean(report.commentPosted),
      pdfUploaded: Boolean(report.pdfUploaded),
    },
    assignee: {
      sentAt: typeof assignee.sentAt === "string" && assignee.sentAt ? assignee.sentAt : null,
      sentByUserId: typeof assignee.sentByUserId === "string" ? assignee.sentByUserId : "",
      sentByDisplayName: typeof assignee.sentByDisplayName === "string" ? assignee.sentByDisplayName : "",
      accountId: typeof assignee.accountId === "string" ? assignee.accountId : "",
      displayName: typeof assignee.displayName === "string" ? assignee.displayName : "",
    },
  };
}

function emptyIssue(startedAt = null) {
  return {
    id: "idle",
    title: "-",
    status: "idle",
    startedAt,
    endedAt: null,
    revealedAt: null,
    externalSource: "manual",
    externalIssueId: "",
    externalIssueKey: "",
    externalIssueUrl: "",
    jiraFieldsSnapshot: {},
    jiraDeliveryStatus: emptyJiraDeliveryStatus(),
    importedFromBoardId: "",
    importedFromSprintId: "",
    votes: {},
    events: [],
    stats: { average: null, median: null },
  };
}

function issueOccurredAt(issueRow, eventRow) {
  if (!issueRow.started_at) {
    return eventRow.created_at;
  }
  return new Date(new Date(issueRow.started_at).getTime() + (eventRow.event_ms || 0)).toISOString();
}

export async function updateIssueJiraDeliveryStatus(issueId, updater) {
  const currentResult = await query("select jira_delivery_json from issues where id = $1 limit 1", [issueId]);
  const currentValue = normalizeJiraDeliveryStatus(currentResult.rows[0]?.jira_delivery_json || {});
  const nextValue = normalizeJiraDeliveryStatus(updater(currentValue) || currentValue);
  await query("update issues set jira_delivery_json = $2::jsonb where id = $1", [issueId, JSON.stringify(nextValue)]);
  return nextValue;
}

export async function getSettingsCompat() {
  const [settings, decks] = await Promise.all([getSettings(), listDecks()]);
  const defaultDeck = decks.find((deck) => deck.id === settings.defaultDeckId)?.name || decks[0]?.name || "Fibonacci";
  const updateAvailable =
    Boolean(settings.updateLatestVersion) &&
    compareReleaseVersions(settings.updateLatestVersion, CURRENT_APP_VERSION) > 0;
  return {
    requireStoryId: settings.requireStoryId,
    defaultDeck,
    defaultTimerSeconds: settings.defaultTimerSeconds,
    httpsEnabled: settings.httpsEnabled,
    tlsCertPath: settings.tlsCertPath,
    tlsKeyPath: settings.tlsKeyPath,
    trustProxy: settings.trustProxy,
    publicBaseUrl: settings.publicBaseUrl,
    updatesEnabled: settings.updatesEnabled,
    updateLastCheckedAt: settings.updateLastCheckedAt,
    updateLatestVersion: settings.updateLatestVersion,
    updateLatestReleaseUrl: settings.updateLatestReleaseUrl,
    updateCheckError: settings.updateCheckError,
    currentVersion: CURRENT_APP_VERSION,
    updateAvailable,
    localAuthEnabled: settings.localAuthEnabled,
    activeDirectoryEnabled: settings.activeDirectoryEnabled,
    entraAuthEnabled: settings.entraAuthEnabled,
    entraMigrationEnabled: settings.entraMigrationEnabled,
    entraGlobalLogoutEnabled: settings.entraGlobalLogoutEnabled,
    entraMigrationPromptLoginCount: settings.entraMigrationPromptLoginCount,
    entraMigrationForceAtDefault: settings.entraMigrationForceAtDefault || "",
    loginMethod: settings.loginMethod,
    minPasswordLength: settings.minimumPasswordLength,
    requirePasswordComplexity: settings.requirePasswordComplexity,
    adServerUrl: settings.adServerUrl,
    adServerPort: settings.adServerPort,
    adConnectionSecurity: settings.adConnectionSecurity,
    adBaseDn: settings.adBaseDn,
    adBindUsername: settings.adBindUsername,
    adBindPassword: settings.adBindPassword,
    adLoginAttribute: settings.adLoginAttribute,
    adEmailAttribute: settings.adEmailAttribute,
    adDisplayNameAttribute: settings.adDisplayNameAttribute,
    adExternalIdAttribute: settings.adExternalIdAttribute,
    adAvatarAttribute: settings.adAvatarAttribute,
    adCaCertificate: settings.adCaCertificate,
    adAllowUntrustedCertificate: settings.adAllowUntrustedCertificate,
    entraTenantId: settings.entraTenantId,
    entraClientId: settings.entraClientId,
    entraClientSecret: "",
    entraClientSecretConfigured: Boolean(settings.entraClientSecretConfigured),
    logoDataUrl: settings.logoDataUrl || "/branding/logo",
    faviconDataUrl: settings.faviconDataUrl || "/branding/favicon",
    integrations: {
      jira: jiraSettingsForCompat(settings.integrations?.jira || defaultJiraIntegrationSettings),
    },
    scheduledTasks: settings.scheduledTasks,
  };
}

export async function listDecksCompat() {
  const result = await query("select id, name, values_json, is_default, now() as created_at from decks order by name");
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    values: row.values_json,
    isDefault: row.is_default,
    createdAt: row.created_at,
  }));
}

export async function listUsersCompat() {
  const result = await query(`
    select
      u.*,
      max(s.last_seen) as last_login_at,
      array_remove(array_agg(distinct r.name), null) as roles,
      array_remove(array_agg(distinct p.code), null) as permission_codes
    from users u
    left join sessions s on s.user_id = u.id and s.revoked_at is null
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id
    left join permissions p on p.id = rp.permission_id
    group by u.id
    order by u.display_name
  `);
  return result.rows.map((row) => ({
    ...mapUser(row),
    lastLoginAt: row.last_login_at || row.created_at,
  }));
}

export async function listRolesCompat() {
  const roles = await listRoles();
  return roles.map(toCompatRole);
}

export async function listPermissionsCompat() {
  return permissionCatalog;
}

export async function listSessionsCompat(search = "") {
  const sessions = await listSessions(search);
  return sessions.map((session) => ({
    token: session.id,
    userId: "",
    username: session.username,
    displayName: session.user,
    createdAt: session.lastSeen,
    lastSeenAt: session.lastSeen,
  }));
}

export async function listAuditLogsCompat() {
  const result = await query(`
    select
      row_number() over (order by a.created_at desc)::int as numeric_id,
      a.*,
      coalesce(u.username, '') as actor_username
    from audit_logs a
    left join users u on u.id = a.actor_user_id
    order by a.created_at desc
    limit 200
  `);
  return result.rows.map((row) => ({
    id: row.numeric_id,
    actorUserId: row.actor_username || row.actor_user_id || "",
    action: row.action,
    targetType: row.target,
    targetId: String(row.meta_json?.id || row.meta_json?.roomId || row.meta_json?.issueId || ""),
    details: row.meta_json || {},
    createdAt: row.created_at,
  }));
}

export async function getAdminOverviewCompat(user) {
  const access = adminAccessFor(user);
  const [users, roles, settings, decks, activeSessions, auditLogs] = await Promise.all([
    access.canManageUsers ? listUsersCompat() : Promise.resolve([]),
    access.canManageRoles ? listRolesCompat() : Promise.resolve([]),
    access.canManageSettings || access.canManageIntegrations || access.canManageRoomSettings || access.canManageUpdates ? getSettingsCompat() : Promise.resolve({
      requireStoryId: false,
      defaultDeck: "",
      defaultTimerSeconds: 0,
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
      currentVersion: CURRENT_APP_VERSION,
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
        jira: jiraSettingsForCompat(defaultJiraIntegrationSettings),
      },
      scheduledTasks: attachScheduledTaskMetadata(defaultScheduledTasks),
    }),
    access.canManageDecks || access.canManageRoomSettings ? listDecksCompat() : Promise.resolve([]),
    access.canManageSessions ? listSessionsCompat() : Promise.resolve([]),
    access.canManageAuditLogs ? listAuditLogsCompat() : Promise.resolve([]),
  ]);
  return {
    users,
    roles,
    permissions: permissionCatalog,
    settings,
    decks,
    activeSessions,
    auditLogs,
  };
}

export async function getDashboardCompat() {
  const rooms = await getDashboard();
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    activeIssueTitle: room.currentIssue || "-",
    status: room.status,
    participantCount: room.participants,
    revealed: room.status === "revealed" || room.status === "closed",
    completedCount: room.issuesCompleted,
    createdAt: demoNow.toISOString(),
  }));
}

function toCompatJiraIssue(issueRow) {
  const meta = issueRow.external_meta_json && typeof issueRow.external_meta_json === "object"
    ? issueRow.external_meta_json
    : {};

  return {
    externalSource: issueRow.external_source || (issueRow.source === "jira" ? "jira" : "manual"),
    externalIssueId: issueRow.external_issue_id || "",
    externalIssueKey: issueRow.external_issue_key || "",
    externalIssueUrl: issueRow.external_issue_url || "",
    jiraFieldsSnapshot: meta,
    jiraDeliveryStatus: normalizeJiraDeliveryStatus(issueRow.jira_delivery_json),
    importedFromBoardId: issueRow.imported_board_id || "",
    importedFromSprintId: issueRow.imported_sprint_id || "",
  };
}

export async function getRoomSnapshot(roomId, currentUserId) {
  const roomResult = await query(`
    select r.*, d.values_json
    from rooms r
    join decks d on d.id = r.deck_id
    where r.id = $1
    limit 1
  `, [roomId]);
  const room = roomResult.rows[0];
  if (!room) {
    return null;
  }

  const [participantRows, issueRows] = await Promise.all([
    query(`
      select
        u.id,
        u.display_name,
        array_remove(array_agg(distinct r.name), null) as roles
      from room_presence rp
      join users u on u.id = rp.user_id
      left join user_roles ur on ur.user_id = u.id
      left join roles r on r.id = ur.role_id
      where rp.room_id = $1 and rp.left_at is null
      group by u.id, u.display_name
      order by u.display_name
    `, [roomId]),
    query(`
      select *
      from issues
      where room_id = $1
      order by
        case state
          when 'active' then 0
          when 'done' then 1
          when 'queued' then 2
          else 3
        end,
        order_index desc,
        queue_position asc
    `, [roomId]),
  ]);

  const issues = issueRows.rows;
  const issueIds = issues.map((issue) => issue.id);
  const [voteRows, eventRows] = issueIds.length
    ? await Promise.all([
        query(`
          select issue_id, user_id, value, created_at
          from votes
          where issue_id = any($1::text[])
          order by created_at
        `, [issueIds]),
        query(`
          select
            ie.issue_id,
            ie.event_type,
            ie.user_id,
            ie.label,
            ie.event_ms,
            ie.payload_json,
            ie.created_at,
            u.display_name,
            array_remove(array_agg(distinct r.name), null) as roles
          from issue_events ie
          left join users u on u.id = ie.user_id
          left join user_roles ur on ur.user_id = u.id
          left join roles r on r.id = ur.role_id
          where ie.issue_id = any($1::text[])
          group by
            ie.issue_id,
            ie.event_type,
            ie.user_id,
            ie.label,
            ie.event_ms,
            ie.payload_json,
            ie.created_at,
            u.display_name
          order by ie.event_ms asc, ie.created_at asc
        `, [issueIds]),
      ])
    : [{ rows: [] }, { rows: [] }];

  const votesByIssue = new Map();
  for (const vote of voteRows.rows) {
    if (!votesByIssue.has(vote.issue_id)) {
      votesByIssue.set(vote.issue_id, []);
    }
    votesByIssue.get(vote.issue_id).push(vote);
  }

  const eventsByIssue = new Map();
  for (const event of eventRows.rows) {
    if (!eventsByIssue.has(event.issue_id)) {
      eventsByIssue.set(event.issue_id, []);
    }
    eventsByIssue.get(event.issue_id).push(event);
  }

  function buildIssue(issueRow) {
    const issueVotes = votesByIssue.get(issueRow.id) || [];
    const issueEvents = eventsByIssue.get(issueRow.id) || [];
    const playbackEvents = issueRow.playback_json?.events || [];
    const playbackUsersById = new Map(
      (issueRow.playback_json?.users || []).map((user) => [user.id, user])
    );
    return {
      id: issueRow.id,
      title: issueRow.title,
      status: issueRow.state,
      startedAt: issueRow.started_at || room.created_at,
      endedAt: issueRow.closed_at,
      revealedAt: issueRow.revealed_at,
      ...toCompatJiraIssue(issueRow),
      votes: Object.fromEntries(
        issueVotes.map((vote) => [
          vote.user_id,
          {
            userId: vote.user_id,
            value: vote.value,
            votedAt: vote.created_at,
          },
        ]),
      ),
      events:
        issueEvents.length > 0
          ? issueEvents.map((event) => ({
              type: event.event_type,
              occurredAt: issueOccurredAt(issueRow, event),
              participantId: event.user_id || undefined,
              participantName: event.display_name || undefined,
              participantCanVote: event.user_id ? canUserVote(event.roles) : undefined,
              value: event.payload_json?.value,
            }))
          : playbackEvents.map((event) => ({
              type: event.type,
              occurredAt: new Date(new Date(issueRow.started_at || room.created_at).getTime() + (event.atMs || 0)).toISOString(),
              participantId: event.userId || undefined,
              participantName: playbackUsersById.get(event.userId)?.display_name || undefined,
              participantCanVote: playbackUsersById.get(event.userId)?.can_vote,
              value: event.payload?.value,
            })),
      stats: statsForCompat(issueVotes.map((vote) => vote.value)),
    };
  }

  const activeIssueRow = issues.find((issue) => issue.state === "active") || null;
  const doneIssueRows = issues.filter((issue) => issue.state === "done").sort((left, right) => right.order_index - left.order_index);
  const latestDoneRow = doneIssueRows[0] || null;
  const revealed = room.status === "revealed" || room.status === "closed";
  const currentIssueRow = activeIssueRow || (revealed ? latestDoneRow : null);
  const currentIssue = currentIssueRow ? buildIssue(currentIssueRow) : emptyIssue(room.created_at);
  const historyRows = revealed && currentIssueRow
    ? doneIssueRows.filter((issue) => issue.id !== currentIssueRow.id)
    : doneIssueRows;
  const historyIssues = historyRows.map(buildIssue);
  const currentVotes = currentIssueRow ? currentIssue.votes : {};

  return {
    room: {
      id: room.id,
      name: room.name,
      deck: room.values_json,
      highlightMode: normalizeRoomHighlightMode(room.highlight_mode),
      status: room.status,
      createdAt: room.created_at,
      participants: participantRows.rows.map((participant) => {
        const { firstName, lastName } = parseNameParts(participant.display_name);
        return {
          id: participant.id,
          firstName,
          lastName,
          voted: Boolean(currentVotes[participant.id]),
          canVote: canUserVote(participant.roles),
        };
      }),
      currentIssue,
      issueHistory: historyIssues,
      issueQueue: issues
        .filter((issue) => issue.state === "queued")
        .sort((left, right) => left.queue_position - right.queue_position)
        .map((issue) => ({
          id: issue.id,
          title: issue.title,
          source: issue.source,
          ...toCompatJiraIssue(issue),
        })),
      revealed,
      completedCount: doneIssueRows.length,
    },
    stats: currentIssue.stats,
  };
}

export async function saveRoleCompat({ id, name, description, adGroupName, entraAppRoleValue, entraGroupId, permissions }) {
  const normalizedPermissions = [...new Set((permissions || []).map((permission) => externalToInternalPermission[permission]).filter(Boolean))];
  return saveRole({
    id,
    name,
    description,
    adGroupName,
    entraAppRoleValue,
    entraGroupId,
    permissionCodes: normalizedPermissions,
  });
}

export async function saveUserCompat({ id, username, displayName, email, authSource, password, avatarDataUrl, roles }) {
  return saveUser({
    id,
    username,
    displayName,
    email,
    authSource,
    password,
    avatarDataUrl,
    roleNames: roles,
  });
}
