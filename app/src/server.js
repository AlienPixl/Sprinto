import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "cookie";
import express from "express";
import { WebSocketServer } from "ws";
import sharp from "sharp";
import { authenticateAgainstActiveDirectory, listActiveDirectoryUsers, testActiveDirectoryConnection, validateActiveDirectorySettings } from "./ad.js";
import { readBootstrapConfig } from "./bootstrap-config.js";
import {
  createEntraLoginRequest,
  exchangeEntraAuthorizationCode,
  fetchEntraGroupIds,
  fetchEntraPhotoDataUrl,
  resolveEntraIdentityFromClaims,
  resolveEntraLogoutUrl,
  resolveEntraPostLoginRedirectUrl,
  sanitizeEntraReturnToPath,
  validateEntraSettings,
  verifyEntraIdToken,
} from "./entra.js";
import {
  hasEnabledAuthProvider,
  hasPasswordAuthProvider,
  isActiveDirectoryEnabled,
  isEntraAuthEnabled,
  isLocalAuthEnabled,
  resolveAuthenticatedUser,
} from "./login-flow.js";
import { resolveUpdateRepository } from "./update-repository.js";
import {
  applyJiraEstimate,
  assignJiraIssue,
  buildJiraWorklogReport,
  createIssueReportComment,
  createSimplePdfBuffer,
  getJiraBoard,
  listJiraAssignableUsers,
  listJiraBoards,
  listJiraIssues,
  listJiraSprints,
  listJiraWorklogUsers,
  searchJiraWorklogIssues,
  getJiraWorklogIssue,
  postJiraIssueReport,
  testJiraConnection,
} from "./jira.js";
import {
  addQueueIssue,
  capabilitiesFor,
  castVote,
  changePassword,
  closeRoom,
  createRoom,
  createSession,
  deleteDeck,
  deleteQueueIssue,
  deleteRole,
  deleteRoom,
  deactivateUser,
  anonymizeUser,
  anonymizeDeactivatedUsersForScheduledTask,
  closeRoomsForScheduledTask,
  closeInactiveSessionsForScheduledTask,
  convertUserToEntra,
  deactivateActiveDirectoryUserByExternalId,
  deactivateUserForEntraAccessLoss,
  compareReleaseVersions,
  cancelAllPendingEntraMigrations,
  findActiveEntraUsersByEmail,
  findPendingEntraMigrationCandidatesByEmail,
  findUserForLogin,
  findUserByEntraIdentity,
  findRecoveryUserForLogin,
  getAdminOverviewCompat,
  getDashboardCompat,
  getHistoryIssue,
  getSettings,
  getRoomSnapshot,
  getSettingsCompat,
  getUserById,
  getUserBySession,
  initDatabase,
  joinRoom,
  listDecksCompat,
  listUsersCompat,
  listRolesCompat,
  listSessionsCompat,
  leaveRoom,
  listAuditLogs,
  logAudit,
  noteUserEntraMigrationPrompt,
  prepareUserForEntraMigration,
  saveRoleCompat,
  saveUserCompat,
  revealIssue,
  reactivateUser,
  resolveRoleNamesForAdGroups,
  resolveRoleNamesForEntraClaims,
  revokeSession,
  revokeSessionById,
  saveDeck,
  cancelUserEntraMigration,
  syncEntraUser,
  syncActiveDirectoryUser,
  startQueuedIssue,
  touchPresence,
  updateIssueJiraDeliveryStatus,
  updateRoomHighlightMode,
  updateQueueIssue,
  updateCurrentUserProfile,
  upsertSettings,
  validatePassword,
  markScheduledTaskRun,
} from "./store.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetSearchRoots = [
  path.join(__dirname, "..", "..", "assets"),
  path.join(__dirname, "..", "assets"),
];
const sockets = new Set();
const repoRoot = path.join(__dirname, "..", "..");
const UPDATE_CHECK_TTL_MS = 1000 * 60 * 60 * 12;
let updateCheckPromise = null;

app.use(express.json({ limit: "10mb" }));

function readSessionToken(req) {
  const cookies = cookie.parse(req.headers.cookie || "");
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return bearerToken || cookies[process.env.SESSION_COOKIE_NAME || "sprinto_session"] || null;
}

app.use(async (req, _res, next) => {
  req.sessionToken = readSessionToken(req);
  req.user = await getUserBySession(req.sessionToken);
  next();
});

app.use(express.static(path.join(__dirname, "..", "dist")));

function json(res, payload, status = 200) {
  res.status(status).json(payload);
}

function toAuditDisplay(value) {
  return value === null || value === undefined || value === "" ? null : value;
}

function mergeJiraSettings(currentJira = {}, incomingJira = {}) {
  const shouldClearStoredApiToken = Boolean(incomingJira.clearStoredApiToken);
  const incomingApiToken = String(incomingJira.apiToken || "").trim();

  return {
    ...currentJira,
    ...incomingJira,
    apiToken: shouldClearStoredApiToken
      ? incomingApiToken
      : incomingApiToken || currentJira.apiToken || "",
    apiTokenConfigured: shouldClearStoredApiToken
      ? Boolean(incomingApiToken)
      : Boolean(incomingApiToken || currentJira.apiToken || currentJira.apiTokenConfigured),
  };
}

const ENTRA_COOKIE_NAMES = {
  state: "sprinto_entra_state",
  nonce: "sprinto_entra_nonce",
  codeVerifier: "sprinto_entra_code_verifier",
  returnTo: "sprinto_entra_return_to",
};

function isSecureCookieRequired(settings) {
  return String(settings?.publicBaseUrl || "").trim().toLowerCase().startsWith("https://");
}

function buildCookieOptions(settings, overrides = {}) {
  const maxAge = Number(overrides.maxAge || 0);
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureCookieRequired(settings),
    ...(maxAge > 0 ? { maxAge } : {}),
    ...overrides,
  };
}

function serializeCookie(name, value, settings, overrides = {}) {
  return cookie.serialize(name, value, buildCookieOptions(settings, overrides));
}

function clearCookie(name, settings) {
  return serializeCookie(name, "", settings, { maxAge: 0 });
}

function clearEntraAuthCookies(res, settings) {
  res.setHeader("Set-Cookie", [
    clearCookie(ENTRA_COOKIE_NAMES.state, settings),
    clearCookie(ENTRA_COOKIE_NAMES.nonce, settings),
    clearCookie(ENTRA_COOKIE_NAMES.codeVerifier, settings),
    clearCookie(ENTRA_COOKIE_NAMES.returnTo, settings),
  ]);
}

function appendSetCookieHeader(res, values) {
  const existing = res.getHeader("Set-Cookie");
  const existingValues = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader("Set-Cookie", [...existingValues, ...values]);
}

function composeImportedJiraIssueTitle(issue) {
  return issue?.key ? `${issue.key} - ${issue.title}` : String(issue?.title || "");
}

function summarizeRoomJiraIssues(snapshot, boardId, sprintId) {
  const queuedByExternalId = new Map();
  const existingOutsideQueueByExternalId = new Map();
  const duplicateQueuedIssueIds = [];
  const missingCandidates = [];

  const currentIssue = snapshot?.room?.currentIssue;
  if (currentIssue?.externalIssueId) {
    existingOutsideQueueByExternalId.set(currentIssue.externalIssueId, currentIssue);
  }

  for (const issue of snapshot?.room?.issueHistory || []) {
    if (issue?.externalIssueId && !existingOutsideQueueByExternalId.has(issue.externalIssueId)) {
      existingOutsideQueueByExternalId.set(issue.externalIssueId, issue);
    }
  }

  for (const issue of snapshot?.room?.issueQueue || []) {
    if (!issue?.externalIssueId) {
      continue;
    }

    if (queuedByExternalId.has(issue.externalIssueId)) {
      duplicateQueuedIssueIds.push(issue.id);
      continue;
    }

    queuedByExternalId.set(issue.externalIssueId, issue);

    if (issue.importedFromBoardId === String(boardId) && issue.importedFromSprintId === String(sprintId)) {
      missingCandidates.push(issue);
    }
  }

  return {
    queuedByExternalId,
    existingOutsideQueueByExternalId,
    duplicateQueuedIssueIds,
    missingCandidates,
  };
}

function normalizeJiraBoardType(type) {
  return String(type || "").trim().toLowerCase();
}

async function resolveJiraImportScope(settings, boardId, sprintId) {
  const jiraSettings = settings?.integrations?.jira || settings?.jira || {};
  const board = await getJiraBoard(settings, boardId);
  const boardType = normalizeJiraBoardType(board.type);
  const isKanbanBoard = boardType === "kanban";
  const normalizedSprintId = isKanbanBoard ? "" : String(sprintId || "").trim();

  if (isKanbanBoard && !jiraSettings.offerKanbanBoards) {
    throw new Error("Kanban boards are disabled in Jira integration settings.");
  }
  if (!isKanbanBoard && !normalizedSprintId) {
    throw new Error("Sprint is required for the selected Jira board.");
  }

  return {
    board,
    boardType,
    isKanbanBoard,
    sprintId: normalizedSprintId,
  };
}

function findRoomJiraIssue(snapshot, issueId) {
  return [
    snapshot?.room.currentIssue,
    ...(snapshot?.room.issueHistory || []),
    ...(snapshot?.room.issueQueue || []),
  ]
    .filter(Boolean)
    .find((issue) => issue.id === issueId && issue.externalIssueKey);
}

const UPDATE_REPOSITORY = resolveUpdateRepository({ repoRoot });

function isUpdateCheckFresh(lastCheckedAt) {
  if (!lastCheckedAt) return false;
  const parsed = new Date(lastCheckedAt).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed < UPDATE_CHECK_TTL_MS;
}

async function fetchLatestReleaseInfo() {
  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=20`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Sprinto-Update-Check",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release check failed with status ${response.status}.`);
  }

  const releases = await response.json();
  if (!Array.isArray(releases)) {
    throw new Error("GitHub release check returned an unexpected response.");
  }

  const release = releases.find((item) => {
    if (!item || item.draft) return false;
    if (item.prerelease) return false;
    return typeof item.tag_name === "string" && item.tag_name.trim().length > 0;
  });

  if (!release) {
    return {
      latestVersion: "",
      latestReleaseUrl: "",
      updateCheckError: "No matching release was found.",
    };
  }

  return {
    latestVersion: String(release.tag_name || "").trim(),
    latestReleaseUrl: String(release.html_url || "").trim(),
    updateCheckError: "",
  };
}

async function refreshUpdateStatus({ force = false } = {}) {
  const currentSettings = await getSettingsCompat();
  if (!currentSettings.updatesEnabled) {
    return currentSettings;
  }

  if (!force && isUpdateCheckFresh(currentSettings.updateLastCheckedAt)) {
    return currentSettings;
  }

  if (!force && updateCheckPromise) {
    await updateCheckPromise;
    return getSettingsCompat();
  }

  updateCheckPromise = (async () => {
    const checkedAt = new Date().toISOString();
    try {
      const release = await fetchLatestReleaseInfo();
      await upsertSettings({
        update_last_checked_at: checkedAt,
        update_latest_version: release.latestVersion,
        update_latest_release_url: release.latestReleaseUrl,
        update_check_error: release.updateCheckError,
      });
    } catch (error) {
      await upsertSettings({
        update_last_checked_at: checkedAt,
        update_check_error: error instanceof Error ? error.message : "Update check failed.",
      });
    }
  })();

  try {
    await updateCheckPromise;
  } finally {
    updateCheckPromise = null;
  }

  return getSettingsCompat();
}

function sanitizeScheduledTasksForAudit(tasks) {
  if (!tasks || typeof tasks !== "object") {
    return {};
  }
  const auto = tasks.autoAnonymizeDeactivatedUsers || {};
  const autoCloseRooms = tasks.autoCloseRooms || {};
  const autoCloseInactiveSessions = tasks.autoCloseInactiveSessions || {};
  return {
    autoAnonymizeDeactivatedUsers: {
      enabled: Boolean(auto.enabled),
      frequency: auto.frequency || "daily",
      intervalMinutes: Number(auto.intervalMinutes || 15),
      time: auto.time || "02:00",
      weekdays: Array.isArray(auto.weekdays) ? auto.weekdays : [],
      weeklyWeekday: auto.weeklyWeekday || "monday",
      weekOfMonth: Number(auto.weekOfMonth || 1),
      monthlyDay: Number(auto.monthlyDay || 1),
      yearlyMonth: Number(auto.yearlyMonth || 1),
      yearlyDay: Number(auto.yearlyDay || 1),
      anonymizeAfterValue: Number(auto.anonymizeAfterValue || auto.anonymizeAfterDays || 30),
      anonymizeAfterUnit: auto.anonymizeAfterUnit || "days",
      anonymizeAfterDays: Number(auto.anonymizeAfterDays || 30),
    },
    autoCloseRooms: {
      enabled: Boolean(autoCloseRooms.enabled),
      frequency: autoCloseRooms.frequency || "daily",
      intervalMinutes: Number(autoCloseRooms.intervalMinutes || 15),
      time: autoCloseRooms.time || "03:00",
      weekdays: Array.isArray(autoCloseRooms.weekdays) ? autoCloseRooms.weekdays : [],
      weeklyWeekday: autoCloseRooms.weeklyWeekday || "monday",
      weekOfMonth: Number(autoCloseRooms.weekOfMonth || 1),
      monthlyDay: Number(autoCloseRooms.monthlyDay || 1),
      yearlyMonth: Number(autoCloseRooms.yearlyMonth || 1),
      yearlyDay: Number(autoCloseRooms.yearlyDay || 1),
      closeAfterValue: Number(autoCloseRooms.closeAfterValue || autoCloseRooms.closeAfterDays || 30),
      closeAfterUnit: autoCloseRooms.closeAfterUnit || "days",
      closeAfterDays: Number(autoCloseRooms.closeAfterDays || 30),
      roomStatuses: Array.isArray(autoCloseRooms.roomStatuses) ? autoCloseRooms.roomStatuses : [],
    },
    autoCloseInactiveSessions: {
      enabled: Boolean(autoCloseInactiveSessions.enabled),
      frequency: autoCloseInactiveSessions.frequency || "daily",
      intervalMinutes: Number(autoCloseInactiveSessions.intervalMinutes || 15),
      time: autoCloseInactiveSessions.time || "04:00",
      weekdays: Array.isArray(autoCloseInactiveSessions.weekdays) ? autoCloseInactiveSessions.weekdays : [],
      weeklyWeekday: autoCloseInactiveSessions.weeklyWeekday || "monday",
      weekOfMonth: Number(autoCloseInactiveSessions.weekOfMonth || 1),
      monthlyDay: Number(autoCloseInactiveSessions.monthlyDay || 1),
      yearlyMonth: Number(autoCloseInactiveSessions.yearlyMonth || 1),
      yearlyDay: Number(autoCloseInactiveSessions.yearlyDay || 1),
      closeAfterValue: Number(autoCloseInactiveSessions.closeAfterValue || autoCloseInactiveSessions.closeAfterDays || 30),
      closeAfterUnit: autoCloseInactiveSessions.closeAfterUnit || "days",
      closeAfterDays: Number(autoCloseInactiveSessions.closeAfterDays || 30),
    },
    syncActiveDirectoryUsers: {
      enabled: Boolean(tasks.syncActiveDirectoryUsers?.enabled),
      frequency: tasks.syncActiveDirectoryUsers?.frequency || "daily",
      intervalMinutes: Number(tasks.syncActiveDirectoryUsers?.intervalMinutes || 15),
      time: tasks.syncActiveDirectoryUsers?.time || "01:00",
      weekdays: Array.isArray(tasks.syncActiveDirectoryUsers?.weekdays) ? tasks.syncActiveDirectoryUsers.weekdays : [],
      weeklyWeekday: tasks.syncActiveDirectoryUsers?.weeklyWeekday || "monday",
      weekOfMonth: Number(tasks.syncActiveDirectoryUsers?.weekOfMonth || 1),
      monthlyDay: Number(tasks.syncActiveDirectoryUsers?.monthlyDay || 1),
      yearlyMonth: Number(tasks.syncActiveDirectoryUsers?.yearlyMonth || 1),
      yearlyDay: Number(tasks.syncActiveDirectoryUsers?.yearlyDay || 1),
    },
    checkForUpdates: {
      enabled: Boolean(tasks.checkForUpdates?.enabled),
      frequency: tasks.checkForUpdates?.frequency || "daily",
      intervalMinutes: Number(tasks.checkForUpdates?.intervalMinutes || 15),
      time: tasks.checkForUpdates?.time || "05:00",
      weekdays: Array.isArray(tasks.checkForUpdates?.weekdays) ? tasks.checkForUpdates.weekdays : [],
      weeklyWeekday: tasks.checkForUpdates?.weeklyWeekday || "monday",
      weekOfMonth: Number(tasks.checkForUpdates?.weekOfMonth || 1),
      monthlyDay: Number(tasks.checkForUpdates?.monthlyDay || 1),
      yearlyMonth: Number(tasks.checkForUpdates?.yearlyMonth || 1),
      yearlyDay: Number(tasks.checkForUpdates?.yearlyDay || 1),
    },
  };
}

function sanitizeSettingsForAudit(settings) {
  if (!settings) {
    return {};
  }
  return {
    requireStoryId: Boolean(settings.requireStoryId),
    defaultDeck: settings.defaultDeck || "",
    defaultTimerSeconds: Number(settings.defaultTimerSeconds || 0),
    httpsEnabled: Boolean(settings.httpsEnabled),
    tlsCertPath: settings.tlsCertPath || "",
    tlsKeyPath: settings.tlsKeyPath || "",
    trustProxy: Boolean(settings.trustProxy),
    publicBaseUrl: settings.publicBaseUrl || "",
    updatesEnabled: Boolean(settings.updatesEnabled),
    updateLastCheckedAt: settings.updateLastCheckedAt || null,
    updateLatestVersion: settings.updateLatestVersion || "",
    updateLatestReleaseUrl: settings.updateLatestReleaseUrl || "",
    updateCheckError: settings.updateCheckError || "",
    currentVersion: settings.currentVersion || "",
    updateAvailable: Boolean(settings.updateAvailable),
    localAuthEnabled: Boolean(settings.localAuthEnabled),
    activeDirectoryEnabled: Boolean(settings.activeDirectoryEnabled),
    entraAuthEnabled: Boolean(settings.entraAuthEnabled),
    entraMigrationEnabled: settings.entraMigrationEnabled !== false,
    entraGlobalLogoutEnabled: Boolean(settings.entraGlobalLogoutEnabled),
    entraMigrationPromptLoginCount: Number(settings.entraMigrationPromptLoginCount || 0),
    entraMigrationForceAtDefault: settings.entraMigrationForceAtDefault || "",
    loginMethod: settings.loginMethod || "",
    minPasswordLength: Number(settings.minPasswordLength || 0),
    requirePasswordComplexity: Boolean(settings.requirePasswordComplexity),
    adServerUrl: settings.adServerUrl || "",
    adServerPort: Number(settings.adServerPort || 0),
    adConnectionSecurity: settings.adConnectionSecurity || "ldap",
    adBaseDn: settings.adBaseDn || "",
    adBindUsername: settings.adBindUsername || "",
    adBindPasswordConfigured: Boolean(settings.adBindPassword),
    adLoginAttribute: settings.adLoginAttribute || "",
    adEmailAttribute: settings.adEmailAttribute || "",
    adDisplayNameAttribute: settings.adDisplayNameAttribute || "",
    adExternalIdAttribute: settings.adExternalIdAttribute || "",
    adAvatarAttribute: settings.adAvatarAttribute || "",
    adCaCertificateStored: Boolean(settings.adCaCertificate),
    adAllowUntrustedCertificate: Boolean(settings.adAllowUntrustedCertificate),
    entraTenantId: settings.entraTenantId || "",
    entraClientId: settings.entraClientId || "",
    entraClientSecretConfigured: Boolean(settings.entraClientSecretConfigured),
    logoConfigured: Boolean(settings.logoDataUrl),
    faviconConfigured: Boolean(settings.faviconDataUrl),
    integrations: {
      jira: {
        enabled: Boolean(settings.integrations?.jira?.enabled),
        baseUrl: settings.integrations?.jira?.baseUrl || "",
        serviceAccountEmail: settings.integrations?.jira?.serviceAccountEmail || "",
        apiTokenConfigured: Boolean(settings.integrations?.jira?.apiTokenConfigured),
        offerKanbanBoards: Boolean(settings.integrations?.jira?.offerKanbanBoards),
        writeStoryPointsEnabled: Boolean(settings.integrations?.jira?.writeStoryPointsEnabled),
        writeOriginalEstimateEnabled: Boolean(settings.integrations?.jira?.writeOriginalEstimateEnabled),
        writeAssigneeEnabled: Boolean(settings.integrations?.jira?.writeAssigneeEnabled),
        originalEstimateMode: settings.integrations?.jira?.originalEstimateMode || "multiplied-story-points",
        originalEstimateMinutesPerStoryPoint: Number(settings.integrations?.jira?.originalEstimateMinutesPerStoryPoint || 30),
        postCommentEnabled: Boolean(settings.integrations?.jira?.postCommentEnabled),
        postPdfEnabled: Boolean(settings.integrations?.jira?.postPdfEnabled),
      },
    },
    scheduledTasks: sanitizeScheduledTasksForAudit(settings.scheduledTasks),
  };
}

function buildAuditChangeSet(before, after) {
  const safeBefore = before && typeof before === "object" ? before : {};
  const safeAfter = after && typeof after === "object" ? after : {};
  const keys = Array.from(new Set([...Object.keys(safeBefore), ...Object.keys(safeAfter)]));
  const changedKeys = keys.filter((key) => JSON.stringify(safeBefore[key]) !== JSON.stringify(safeAfter[key]));
  return {
    before: Object.fromEntries(changedKeys.map((key) => [key, safeBefore[key] ?? null])),
    after: Object.fromEntries(changedKeys.map((key) => [key, safeAfter[key] ?? null])),
  };
}

function toAuditDeckSnapshot(deck) {
  if (!deck) {
    return null;
  }
  return {
    id: deck.id,
    name: deck.name,
    values: Array.isArray(deck.values) ? deck.values : [],
    isDefault: Boolean(deck.isDefault),
  };
}

function toAuditRoleSnapshot(role) {
  if (!role) {
    return null;
  }
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    adGroupName: role.adGroupName,
    entraAppRoleValue: role.entraAppRoleValue || "",
    entraGroupId: role.entraGroupId || "",
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
  };
}

function toAuditUserSnapshot(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    authSource: user.authSource,
    isSystemManaged: Boolean(user.isSystemManaged),
    entraLinked: Boolean(user.entraLinked),
    entraMigrationState: user.entraMigrationState || "",
    entraMigrationPromptCount: Number(user.entraMigrationPromptCount || 0),
    entraMigrationForceAt: user.entraMigrationForceAt || null,
    isActive: Boolean(user.isActive),
    avatarConfigured: Boolean(user.avatarDataUrl),
    avatarManagedByDirectory: Boolean(user.avatarManagedByDirectory),
    avatarManagedByAuthSource: user.avatarManagedByAuthSource || "",
    roles: Array.isArray(user.roles) ? user.roles : [],
  };
}

function isSystemManagedUser(user) {
  return user?.authSource === "system" || Boolean(user?.isSystemManaged);
}

function managedUserMutationMessage(user, action) {
  if (isSystemManagedUser(user)) {
    if (action === "roles") {
      return "The recovery admin keeps its system-defined access and cannot receive role changes in Sprinto.";
    }
    if (action === "anonymize") {
      return "The recovery admin cannot be anonymized.";
    }
    if (action === "reactivate") {
      return "The recovery admin is managed from deployment configuration and cannot be reactivated manually.";
    }
    if (action === "deactivate") {
      return "The recovery admin cannot be deactivated.";
    }
    return "The recovery admin is managed from deployment configuration and cannot be edited in Sprinto.";
  }

  if (action === "roles") {
    return user?.authSource === "entra"
      ? "Microsoft Entra users receive roles from mapped Entra app roles or group IDs."
      : "Microsoft Active Directory users receive roles from mapped AD groups.";
  }
  if (action === "anonymize") {
    return "This account cannot be anonymized.";
  }
  if (action === "reactivate") {
    return user?.authSource === "entra"
      ? "Microsoft Entra users are managed automatically."
      : "Microsoft Active Directory users are managed automatically.";
  }
  return user?.authSource === "entra"
    ? "Microsoft Entra users are managed automatically."
    : "Microsoft Active Directory users are managed automatically.";
}

function normalizeOptionalIsoDateTime(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function buildEntraMigrationStatus(user, settings) {
  if (!user || user.entraMigrationState !== "pending" || settings?.entraMigrationEnabled === false) {
    return null;
  }

  const promptLimit = Math.max(1, Number(settings?.entraMigrationPromptLoginCount || 3));
  const forceAt = normalizeOptionalIsoDateTime(user.entraMigrationForceAt) || normalizeOptionalIsoDateTime(settings?.entraMigrationForceAtDefault);
  const isForcedByDate = Boolean(forceAt && Date.now() >= new Date(forceAt).getTime());
  const isForcedByPromptCount = Number(user.entraMigrationPromptCount || 0) >= promptLimit;

  return {
    promptLimit,
    forceAt: forceAt || null,
    isForced: isForcedByDate || isForcedByPromptCount,
  };
}

function parseDataUrlAsset(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) {
    return null;
  }

  const [, mimeType, base64Flag, payload] = match;
  const buffer = base64Flag
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");

  return { mimeType, buffer };
}

function sendBrandingAsset(res, dataUrl, fallbackPath, fallbackType) {
  const asset = parseDataUrlAsset(dataUrl);

  if (asset) {
    res.setHeader("Content-Type", asset.mimeType || fallbackType);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.send(asset.buffer);
    return;
  }

  if (fs.existsSync(fallbackPath)) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.type(fallbackType);
    res.sendFile(fallbackPath);
    return;
  }

  res.status(204).end();
}

function encodeFileAsDataUrl(filePath, mimeType) {
  if (!filePath || !mimeType || !fs.existsSync(filePath)) {
    return "";
  }

  try {
    return `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}`;
  } catch {
    return "";
  }
}

async function normalizeImageDataUrl(dataUrl) {
  const asset = parseDataUrlAsset(dataUrl);
  if (!asset?.buffer || !String(asset.mimeType || "").toLowerCase().startsWith("image/")) {
    return "";
  }

  try {
    const normalizedBuffer = await sharp(asset.buffer, { density: 300 }).png().toBuffer();
    return `data:image/png;base64,${normalizedBuffer.toString("base64")}`;
  } catch {
    return String(dataUrl || "").trim();
  }
}

function resolveBundledAsset(filename) {
  for (const root of assetSearchRoots) {
    const candidate = path.join(root, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function resolveReportLogoAssets(settings) {
  const bundledLogoDataUrl = encodeFileAsDataUrl(resolveBundledAsset("Logo_bitmap_noBG.png"), "image/png");
  const configuredLogo = String(settings?.logoDataUrl || "").trim();
  const normalizedConfiguredLogo = configuredLogo ? await normalizeImageDataUrl(configuredLogo) : "";
  return {
    logoDataUrl: normalizedConfiguredLogo || bundledLogoDataUrl,
    fallbackLogoDataUrl: bundledLogoDataUrl,
  };
}

async function resolveEntraRoleNamesFromIdentity(identity, accessToken) {
  let groupIds = [...(identity.groupIds || [])];
  if (identity.groupsOverage) {
    groupIds = groupIds.concat(await fetchEntraGroupIds(accessToken));
  }
  return resolveRoleNamesForEntraClaims({
    appRoleValues: identity.appRoleValues,
    groupIds,
  });
}

async function resolveEntraAuthenticatedUser(identity, options = {}) {
  const migrationEnabled = options.migrationEnabled !== false;
  const existingByIdentity = await findUserByEntraIdentity(identity.tenantId, identity.externalId);

  if (existingByIdentity) {
    if (!existingByIdentity.isActive || existingByIdentity.anonymizedAt) {
      throw new Error("This Microsoft Entra account is not active in Sprinto.");
    }

    if (existingByIdentity.authSource === "entra") {
      const roleNames = await resolveEntraRoleNamesFromIdentity(identity, identity.accessToken);
      if (roleNames.length === 0) {
        const deactivatedUser = await deactivateUserForEntraAccessLoss(existingByIdentity.id);
        throw Object.assign(new Error("You no longer have access to Sprinto. Contact your administrator."), {
          entraAccessRevoked: true,
          revokedUser: deactivatedUser || existingByIdentity,
          previousUser: existingByIdentity,
          revocationReason: "no_matching_entra_role",
        });
      }
      const syncedUser = await syncEntraUser({
        tenantId: identity.tenantId,
        externalId: identity.externalId,
        username: identity.username,
        displayName: identity.displayName,
        email: identity.email,
        avatarDataUrl: identity.avatarDataUrl,
        roleNames,
      });
      return syncedUser;
    }
    throw new Error("This Microsoft Entra identity is already linked to a non-Entra Sprinto account. Ask an administrator to review the account migration state.");
  }

  const pendingCandidates = migrationEnabled && identity.email ? await findPendingEntraMigrationCandidatesByEmail(identity.email) : [];
  if (pendingCandidates.length > 1) {
    throw new Error("Multiple pending Sprinto accounts match this Microsoft Entra email address. Ask an administrator to resolve the migration before signing in.");
  }

  if (pendingCandidates[0]) {
    const roleNames = await resolveEntraRoleNamesFromIdentity(identity, identity.accessToken);
    if (roleNames.length === 0) {
      const deactivatedUser = await deactivateUserForEntraAccessLoss(pendingCandidates[0].id);
      throw Object.assign(new Error("You no longer have access to Sprinto. Contact your administrator."), {
        entraAccessRevoked: true,
        revokedUser: deactivatedUser || pendingCandidates[0],
        previousUser: pendingCandidates[0],
        revocationReason: "no_matching_entra_role",
      });
    }

    return convertUserToEntra({
      userId: pendingCandidates[0].id,
      tenantId: identity.tenantId,
      externalId: identity.externalId,
      username: identity.username,
      displayName: identity.displayName,
      email: identity.email,
      avatarDataUrl: identity.avatarDataUrl,
      roleNames,
    });
  }

  const roleNames = await resolveEntraRoleNamesFromIdentity(identity, identity.accessToken);
  if (roleNames.length === 0) {
    throw new Error("You do not have access to Sprinto.");
  }

  return syncEntraUser({
    tenantId: identity.tenantId,
    externalId: identity.externalId,
    username: identity.username,
    displayName: identity.displayName,
    email: identity.email,
    avatarDataUrl: identity.avatarDataUrl,
    roleNames,
  });
}

function redirectToAuthError(res, settings, returnToPath, message) {
  const safeReturnToPath = sanitizeEntraReturnToPath(returnToPath);
  try {
    res.redirect(resolveEntraPostLoginRedirectUrl(settings, safeReturnToPath, message));
    return;
  } catch {
  }

  const redirectUrl = new URL(safeReturnToPath, "http://localhost");
  redirectUrl.searchParams.set("authError", message);
  res.redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
}

function requireUser(req, res, next) {
  if (!req.user) return json(res, { error: "Unauthorized" }, 401);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canAccessAdmin) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageUsers(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageUsers) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageRoles(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageRoles) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageSettings(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageSettings) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageIntegrations(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageIntegrations) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageRoomSettings(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageRoomSettings) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageDecks(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageDecks) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageSessions(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageSessions) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageAuditLogs(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageAuditLogs) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageScheduledTasks(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageScheduledTasks) return json(res, { error: "Forbidden" }, 403);
  next();
}

function requireManageUpdates(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canManageUpdates) return json(res, { error: "Forbidden" }, 403);
  next();
}

async function requireJiraImport(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canImportJiraIssues) return json(res, { error: "Forbidden" }, 403);
  const jiraSettings = (await getSettings()).integrations?.jira;
  if (!jiraSettings?.enabled) return json(res, { error: "Jira integration is disabled." }, 403);
  next();
}

async function requireJiraEstimateWrite(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canSendToJira) return json(res, { error: "Forbidden" }, 403);
  const jiraSettings = (await getSettings()).integrations?.jira;
  if (!jiraSettings?.enabled) return json(res, { error: "Jira integration is disabled." }, 403);
  next();
}

async function requireJiraReportPosting(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canSendToJira) return json(res, { error: "Forbidden" }, 403);
  const jiraSettings = (await getSettings()).integrations?.jira;
  if (!jiraSettings?.enabled) return json(res, { error: "Jira integration is disabled." }, 403);
  next();
}

async function requireWorklogView(req, res, next) {
  if (!req.user || !capabilitiesFor(req.user).canViewWorklog) return json(res, { error: "Forbidden" }, 403);
  const jiraSettings = (await getSettings()).integrations?.jira;
  if (!jiraSettings?.enabled) return json(res, { error: "Jira integration is disabled." }, 403);
  next();
}

async function publishDashboard() {
  broadcast({ type: "dashboard.updated", rooms: await getDashboardCompat() });
}

async function publishRoom(roomId) {
  const snapshot = await getRoomSnapshot(roomId, null);
  if (snapshot) {
    broadcast({ type: "room.updated", data: snapshot });
  }
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === 1) socket.send(payload);
  }
}

function getWeekdayName(date) {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()];
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
  if (!task?.enabled) {
    return false;
  }

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
    const intervalMinutes = Math.min(1440, Math.max(1, Number(task.intervalMinutes) || 1));
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
    return candidate;
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
    return candidate;
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
      return scheduledAt;
    }
  }

  return null;
}

async function executeScheduledTask(taskKey, executedAt, options = {}) {
  try {
    const settings = await getSettingsCompat();
    const task = settings?.scheduledTasks?.[taskKey];
    const manual = Boolean(options.manual);
    const triggeredByUserId = options.triggeredByUserId || null;
    if (!task || (!manual && !task.enabled)) {
      return;
    }

    if (taskKey === "autoAnonymizeDeactivatedUsers") {
      const affectedUsers = await anonymizeDeactivatedUsersForScheduledTask(executedAt, task.anonymizeAfterValue, task.anonymizeAfterUnit);
      if (!manual) {
        await markScheduledTaskRun(taskKey, executedAt.toISOString());
      }
      for (const user of affectedUsers) {
        await logAudit(null, "user.auto_anonymize", "user", {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          authSource: user.authSource,
          task: "auto-anonymize-deactivated-users",
          runMode: manual ? "manual" : "scheduled",
          triggeredByUserId,
          executedAt: executedAt.toISOString(),
        });
      }
      await logAudit(null, "scheduled-task.run", "scheduled-task", {
        task: "auto-anonymize-deactivated-users",
        runMode: manual ? "manual" : "scheduled",
        triggeredByUserId,
        anonymizeAfterValue: task.anonymizeAfterValue,
        anonymizeAfterUnit: task.anonymizeAfterUnit,
        anonymizedUserCount: affectedUsers.length,
        anonymizedUserIds: affectedUsers.map((user) => user.id),
        executedAt: executedAt.toISOString(),
      });
      return {
        taskKey,
        anonymizedUserCount: affectedUsers.length,
        anonymizedUserIds: affectedUsers.map((user) => user.id),
      };
    }

    if (taskKey === "autoCloseRooms") {
      const affectedRooms = await closeRoomsForScheduledTask(executedAt, task.closeAfterValue, task.closeAfterUnit, task.roomStatuses);
      if (!manual) {
        await markScheduledTaskRun(taskKey, executedAt.toISOString());
      }
      for (const room of affectedRooms) {
        await logAudit(null, "room.auto_close", "room", {
          id: room.id,
          roomId: room.id,
          name: room.name,
          previousStatus: room.status,
          createdAt: room.createdAt,
          task: "auto-close-rooms",
          runMode: manual ? "manual" : "scheduled",
          triggeredByUserId,
          executedAt: executedAt.toISOString(),
        });
        await publishRoom(room.id);
      }
      if (affectedRooms.length > 0) {
        await publishDashboard();
      }
      await logAudit(null, "scheduled-task.run", "scheduled-task", {
        task: "auto-close-rooms",
        runMode: manual ? "manual" : "scheduled",
        triggeredByUserId,
        closedRoomCount: affectedRooms.length,
        closedRoomIds: affectedRooms.map((room) => room.id),
        roomStatuses: task.roomStatuses,
        closeAfterValue: task.closeAfterValue,
        closeAfterUnit: task.closeAfterUnit,
        closeAfterDays: task.closeAfterDays,
        executedAt: executedAt.toISOString(),
      });
      return {
        taskKey,
        closedRoomCount: affectedRooms.length,
        closedRoomIds: affectedRooms.map((room) => room.id),
      };
    }

    if (taskKey === "autoCloseInactiveSessions") {
      const affectedSessions = await closeInactiveSessionsForScheduledTask(executedAt, task.closeAfterValue, task.closeAfterUnit);
      if (!manual) {
        await markScheduledTaskRun(taskKey, executedAt.toISOString());
      }
      for (const session of affectedSessions) {
        await logAudit(null, "session.auto_close", "session", {
          id: session.id,
          sessionId: session.id,
          userId: session.userId,
          username: session.username,
          displayName: session.displayName,
          lastSeenAt: session.lastSeenAt,
          task: "auto-close-inactive-sessions",
          runMode: manual ? "manual" : "scheduled",
          triggeredByUserId,
          executedAt: executedAt.toISOString(),
        });
      }
      await logAudit(null, "scheduled-task.run", "scheduled-task", {
        task: "auto-close-inactive-sessions",
        runMode: manual ? "manual" : "scheduled",
        triggeredByUserId,
        closedSessionCount: affectedSessions.length,
        closedSessionIds: affectedSessions.map((session) => session.id),
        closeAfterValue: task.closeAfterValue,
        closeAfterUnit: task.closeAfterUnit,
        closeAfterDays: task.closeAfterDays,
        executedAt: executedAt.toISOString(),
      });
      return {
        taskKey,
        closedSessionCount: affectedSessions.length,
        closedSessionIds: affectedSessions.map((session) => session.id),
      };
    }

    if (taskKey === "syncActiveDirectoryUsers") {
      if (!isActiveDirectoryEnabled(settings)) {
        if (!manual) {
          await markScheduledTaskRun(taskKey, executedAt.toISOString());
        }
        await logAudit(null, "scheduled-task.run", "scheduled-task", {
          task: "sync-active-directory-users",
          runMode: manual ? "manual" : "scheduled",
          triggeredByUserId,
          skipped: true,
          reason: "Microsoft Active Directory is disabled.",
          executedAt: executedAt.toISOString(),
        });
        return {
          taskKey,
          skipped: true,
          reason: "Microsoft Active Directory is disabled.",
        };
      }

      const adUsers = await listActiveDirectoryUsers(settings);
      const syncedUsers = [];
      const deactivatedExternalIds = new Set();
      const syncErrors = [];
      const seenExternalIds = new Set();

      for (const adUser of adUsers) {
        seenExternalIds.add(adUser.externalId);
        const matchedRoles = await resolveRoleNamesForAdGroups(adUser.groupIdentifiers);
        if (matchedRoles.length === 0) {
          const changed = await deactivateActiveDirectoryUserByExternalId(adUser.externalId);
          if (changed) {
            deactivatedExternalIds.add(adUser.externalId);
          }
          continue;
        }

        try {
          const syncedUser = await syncActiveDirectoryUser({
            externalId: adUser.externalId,
            username: adUser.username,
            displayName: adUser.displayName,
            email: adUser.email,
            avatarDataUrl: adUser.avatarDataUrl,
            roleNames: matchedRoles,
          });
          if (syncedUser) {
            syncedUsers.push({
              id: syncedUser.id,
              username: syncedUser.username,
              externalId: adUser.externalId,
              roleNames: matchedRoles,
            });
          }
        } catch (error) {
          syncErrors.push({
            externalId: adUser.externalId,
            username: adUser.username,
            message: error instanceof Error ? error.message : "Unknown synchronization error.",
          });
        }
      }

      const localUsers = await listUsersCompat();
      for (const localUser of localUsers.filter((user) => user.authSource === "ad" && user.externalId)) {
        if (!seenExternalIds.has(localUser.externalId)) {
          const changed = await deactivateActiveDirectoryUserByExternalId(localUser.externalId);
          if (changed) {
            deactivatedExternalIds.add(localUser.externalId);
          }
        }
      }

      if (!manual) {
        await markScheduledTaskRun(taskKey, executedAt.toISOString());
      }
      for (const syncedUser of syncedUsers) {
        await logAudit(null, "user.ad_sync", "user", {
          id: syncedUser.id,
          username: syncedUser.username,
          externalId: syncedUser.externalId,
          roleNames: syncedUser.roleNames,
          task: "sync-active-directory-users",
          runMode: manual ? "manual" : "scheduled",
          triggeredByUserId,
          executedAt: executedAt.toISOString(),
        });
      }
      for (const externalId of deactivatedExternalIds) {
        await logAudit(null, "user.ad_sync_deactivate", "user", {
          externalId,
          task: "sync-active-directory-users",
          runMode: manual ? "manual" : "scheduled",
          triggeredByUserId,
          executedAt: executedAt.toISOString(),
        });
      }
      for (const syncError of syncErrors) {
        await logAudit(null, "user.ad_sync_error", "user", {
          externalId: syncError.externalId,
          username: syncError.username,
          message: syncError.message,
          task: "sync-active-directory-users",
          runMode: manual ? "manual" : "scheduled",
          triggeredByUserId,
          executedAt: executedAt.toISOString(),
        });
      }
      await logAudit(null, "scheduled-task.run", "scheduled-task", {
        task: "sync-active-directory-users",
        runMode: manual ? "manual" : "scheduled",
        triggeredByUserId,
        directoryUserCount: adUsers.length,
        syncedUserCount: syncedUsers.length,
        deactivatedUserCount: deactivatedExternalIds.size,
        syncErrorCount: syncErrors.length,
        executedAt: executedAt.toISOString(),
      });
      return {
        taskKey,
        directoryUserCount: adUsers.length,
        syncedUserCount: syncedUsers.length,
        deactivatedUserCount: deactivatedExternalIds.size,
        syncErrorCount: syncErrors.length,
      };
    }

    if (taskKey === "checkForUpdates") {
      if (!manual && !settings.updatesEnabled) {
        await markScheduledTaskRun(taskKey, executedAt.toISOString());
        await logAudit(null, "scheduled-task.run", "scheduled-task", {
          task: "check-for-updates",
          runMode: "scheduled",
          triggeredByUserId,
          skipped: true,
          reason: "Update checks are disabled in update settings.",
          executedAt: executedAt.toISOString(),
        });
        return {
          taskKey,
          skipped: true,
          reason: "Update checks are disabled in update settings.",
        };
      }

      const beforeSettings = await getSettingsCompat();
      const refreshedSettings = await refreshUpdateStatus({ force: true });
      if (!manual) {
        await markScheduledTaskRun(taskKey, executedAt.toISOString());
      }
      await logAudit(null, "scheduled-task.run", "scheduled-task", {
        task: "check-for-updates",
        runMode: manual ? "manual" : "scheduled",
        triggeredByUserId,
        previousLatestVersion: beforeSettings.updateLatestVersion || "",
        latestVersion: refreshedSettings.updateLatestVersion || "",
        updateAvailable: Boolean(refreshedSettings.updateAvailable),
        releaseUrl: refreshedSettings.updateLatestReleaseUrl || "",
        checkError: refreshedSettings.updateCheckError || "",
        executedAt: executedAt.toISOString(),
      });
      return {
        taskKey,
        latestVersion: refreshedSettings.updateLatestVersion || "",
        updateAvailable: Boolean(refreshedSettings.updateAvailable),
        checkError: refreshedSettings.updateCheckError || "",
      };
    }
  } catch (error) {
    console.error("Scheduled task execution failed:", error);
    if (options?.manual) {
      throw error;
    }
  }
}

let scheduledTaskTimer = null;
let scheduledTaskPlan = null;

function clearScheduledTaskTimer() {
  if (scheduledTaskTimer) {
    clearTimeout(scheduledTaskTimer);
    scheduledTaskTimer = null;
  }
  scheduledTaskPlan = null;
}

function collectScheduledTaskCandidates(tasks, fromDate) {
  return Object.entries(tasks)
    .map(([key, task]) => ({ key, nextRunAt: computeNextRunAt(task, fromDate) }))
    .filter((task) => task.nextRunAt instanceof Date && !Number.isNaN(task.nextRunAt.getTime()))
    .sort((left, right) => left.nextRunAt.getTime() - right.nextRunAt.getTime());
}

function collectTasksAtEarliestRun(candidates) {
  const earliest = candidates[0]?.nextRunAt;
  if (!(earliest instanceof Date)) {
    return [];
  }
  return candidates.filter((candidate) => candidate.nextRunAt.getTime() === earliest.getTime());
}

async function scheduleNextScheduledTaskRun() {
  clearScheduledTaskTimer();

  try {
    const settings = await getSettingsCompat();
    const tasks = settings?.scheduledTasks || {};
    const now = new Date();
    const candidates = collectScheduledTaskCandidates(tasks, now);
    const nextTasks = collectTasksAtEarliestRun(candidates);
    const nextTask = nextTasks[0];
    if (!nextTask || nextTasks.length === 0) {
      return;
    }

    scheduledTaskPlan = nextTasks;
    const delay = Math.max(0, nextTask.nextRunAt.getTime() - Date.now());
    scheduledTaskTimer = setTimeout(async () => {
      const plannedRunAt = nextTask.nextRunAt;
      try {
        for (const task of nextTasks) {
          await executeScheduledTask(task.key, plannedRunAt);
        }
      } finally {
        await scheduleNextScheduledTaskRunFrom(plannedRunAt);
      }
    }, delay);
  } catch (error) {
    console.error("Scheduled task scheduling failed:", error);
  }
}

async function scheduleNextScheduledTaskRunFrom(referenceDate) {
  clearScheduledTaskTimer();

  try {
    const settings = await getSettingsCompat();
    const tasks = settings?.scheduledTasks || {};
    const fromDate = new Date(referenceDate.getTime() + 1000);
    const candidates = collectScheduledTaskCandidates(tasks, fromDate);
    const nextTasks = collectTasksAtEarliestRun(candidates);
    const nextTask = nextTasks[0];
    if (!nextTask || nextTasks.length === 0) {
      return;
    }

    scheduledTaskPlan = nextTasks;
    const delay = Math.max(0, nextTask.nextRunAt.getTime() - Date.now());
    scheduledTaskTimer = setTimeout(async () => {
      const plannedRunAt = nextTask.nextRunAt;
      try {
        for (const task of nextTasks) {
          await executeScheduledTask(task.key, plannedRunAt);
        }
      } finally {
        await scheduleNextScheduledTaskRunFrom(plannedRunAt);
      }
    }, delay);
  } catch (error) {
    console.error("Scheduled task rescheduling failed:", error);
  }
}

app.get("/api/auth/entra/start", async (req, res) => {
  const settings = await getSettings();
  const returnToPath = sanitizeEntraReturnToPath(String(req.query.returnTo || "/"));

  if (!isEntraAuthEnabled(settings)) {
    return redirectToAuthError(res, settings, returnToPath, "Microsoft Entra sign-in is disabled.");
  }

  try {
    const request = createEntraLoginRequest(settings, returnToPath);
    res.setHeader("Set-Cookie", [
      serializeCookie(ENTRA_COOKIE_NAMES.state, request.state, settings, { maxAge: 600 }),
      serializeCookie(ENTRA_COOKIE_NAMES.nonce, request.nonce, settings, { maxAge: 600 }),
      serializeCookie(ENTRA_COOKIE_NAMES.codeVerifier, request.codeVerifier, settings, { maxAge: 600 }),
      serializeCookie(ENTRA_COOKIE_NAMES.returnTo, request.returnToPath, settings, { maxAge: 600 }),
    ]);
    res.redirect(request.authorizationUrl);
  } catch (error) {
    redirectToAuthError(res, settings, returnToPath, error instanceof Error ? error.message : "Microsoft Entra sign-in could not be started.");
  }
});

app.get("/api/auth/entra/callback", async (req, res) => {
  const settings = await getSettings();
  const cookies = cookie.parse(req.headers.cookie || "");
  const returnToPath = sanitizeEntraReturnToPath(cookies[ENTRA_COOKIE_NAMES.returnTo] || "/");

  clearEntraAuthCookies(res, settings);

  if (!isEntraAuthEnabled(settings)) {
    return redirectToAuthError(res, settings, returnToPath, "Microsoft Entra sign-in is disabled.");
  }

  if (req.query.error) {
    const providerMessage = String(req.query.error_description || req.query.error || "").trim();
    return redirectToAuthError(res, settings, returnToPath, providerMessage || "Microsoft Entra sign-in was cancelled.");
  }

  const state = String(req.query.state || "").trim();
  const code = String(req.query.code || "").trim();
  const expectedState = String(cookies[ENTRA_COOKIE_NAMES.state] || "").trim();
  const expectedNonce = String(cookies[ENTRA_COOKIE_NAMES.nonce] || "").trim();
  const codeVerifier = String(cookies[ENTRA_COOKIE_NAMES.codeVerifier] || "").trim();

  if (!code) {
    return redirectToAuthError(res, settings, returnToPath, "Microsoft Entra sign-in did not return an authorization code.");
  }
  if (!state || state !== expectedState) {
    return redirectToAuthError(res, settings, returnToPath, "Microsoft Entra sign-in state validation failed.");
  }
  if (!expectedNonce || !codeVerifier) {
    return redirectToAuthError(res, settings, returnToPath, "Microsoft Entra sign-in session expired. Start the sign-in flow again.");
  }

  let identity = null;

  try {
    validateEntraSettings(settings);
    const tokenResponse = await exchangeEntraAuthorizationCode(settings, code, codeVerifier);
    const claims = await verifyEntraIdToken(settings, tokenResponse.id_token, expectedNonce);
    identity = resolveEntraIdentityFromClaims(claims);
    const pendingCandidates =
      settings.entraMigrationEnabled !== false && identity.email
        ? await findPendingEntraMigrationCandidatesByEmail(identity.email)
        : [];
    let avatarDataUrl = "";

    try {
      avatarDataUrl = await fetchEntraPhotoDataUrl(tokenResponse.access_token);
    } catch (error) {
      console.error("Microsoft Entra avatar sync failed:", error);
    }

    const user = await resolveEntraAuthenticatedUser({
      ...identity,
      accessToken: tokenResponse.access_token,
      avatarDataUrl,
    }, {
      migrationEnabled: settings.entraMigrationEnabled !== false,
    });
    if (pendingCandidates.length === 1 && pendingCandidates[0].id === user.id) {
      await logAudit(user.id, "user.entra_migration_complete", "user", {
        id: user.id,
        fromAuthSource: pendingCandidates[0].authSource,
        toAuthSource: "entra",
        preparedByUserId: pendingCandidates[0].entraMigrationPreparedByUserId || "",
        promptCountAtLogin: Number(pendingCandidates[0].entraMigrationPromptCount || 0),
        forceAt: pendingCandidates[0].entraMigrationForceAt || null,
        entraTenantId: identity.tenantId,
        entraExternalId: identity.externalId,
      });
    }
    const token = await createSession(user.id);
    appendSetCookieHeader(res, [
      cookie.serialize(process.env.SESSION_COOKIE_NAME || "sprinto_session", token, { httpOnly: true, sameSite: "lax", path: "/" }),
    ]);
    await logAudit(user.id, "login", "session", { provider: "entra" });
    res.redirect(resolveEntraPostLoginRedirectUrl(settings, returnToPath));
  } catch (error) {
    if (error && typeof error === "object" && "entraAccessRevoked" in error && (error).entraAccessRevoked) {
      const revokedUser = error.revokedUser;
      const previousUser = error.previousUser;
      if (revokedUser?.id) {
        await logAudit(revokedUser.id, "user.entra_access_revoked", "user", {
          id: revokedUser.id,
          fromAuthSource: previousUser?.authSource || revokedUser.authSource,
          toAuthSource: revokedUser.authSource,
          entraTenantId: identity?.tenantId || "",
          entraExternalId: identity?.externalId || "",
          reason: error.revocationReason || "no_matching_entra_role",
          ...buildAuditChangeSet(
            toAuditUserSnapshot(previousUser || revokedUser),
            toAuditUserSnapshot(revokedUser),
          ),
        });
      }
      return redirectToAuthError(
        res,
        settings,
        returnToPath,
        error instanceof Error ? error.message : "You no longer have access to Sprinto. Contact your administrator.",
      );
    }
    redirectToAuthError(res, settings, returnToPath, error instanceof Error ? error.message : "Microsoft Entra sign-in failed.");
  }
});

app.post("/api/auth/login", async (req, res) => {
  const identifier = String(req.body?.username || req.body?.identifier || "").trim();
  const password = String(req.body?.password || "");
  const method = String(req.body?.method || "username");
  const settings = await getSettingsCompat();
  const bootstrapConfig = readBootstrapConfig();

  try {
    const user = await resolveAuthenticatedUser({
      identifier,
      password,
      method,
      settings,
      authenticateRecoveryUser: bootstrapConfig.recoveryAdminEnabled ? findRecoveryUserForLogin : async () => null,
      authenticateDirectoryUser: async (directoryIdentifier, directoryPassword, directoryMethod) => {
        const adProfile = await authenticateAgainstActiveDirectory(directoryIdentifier, directoryPassword, directoryMethod, settings);
        if (adProfile && adProfile.externalId && adProfile.username) {
          const matchingEntraUsers = adProfile.email ? await findActiveEntraUsersByEmail(adProfile.email) : [];
          if (matchingEntraUsers.length === 1) {
            throw new Error("This account has already been migrated to Microsoft Entra. Use Sign in with Microsoft.");
          }
          if (matchingEntraUsers.length > 1) {
            throw new Error("Multiple Microsoft Entra accounts match this directory user. Ask an administrator to review the migration state.");
          }

          const matchedRoles = await resolveRoleNamesForAdGroups(adProfile.groupIdentifiers);
          if (matchedRoles.length === 0) {
            await deactivateActiveDirectoryUserByExternalId(adProfile.externalId);
            throw new Error("You do not have access to Sprinto.");
          }

          return syncActiveDirectoryUser({
            externalId: adProfile.externalId,
            username: adProfile.username,
            displayName: adProfile.displayName,
            email: adProfile.email,
            avatarDataUrl: adProfile.avatarDataUrl,
            roleNames: matchedRoles,
          });
        }
        return null;
      },
      authenticateLocalUser: findUserForLogin,
    });

    if (!user) return json(res, { error: "Login failed. Check your credentials and login method." }, 401);

    const migrationStatus = buildEntraMigrationStatus(user, settings);
    if (migrationStatus) {
      if (migrationStatus.isForced) {
        await logAudit(user.id, "user.entra_migration_blocked_login", "user", {
          id: user.id,
          fromAuthSource: user.authSource,
          toAuthSource: "entra",
          promptCountAtLogin: Number(user.entraMigrationPromptCount || 0),
          promptLimit: migrationStatus.promptLimit,
          forceAt: migrationStatus.forceAt,
        });
        return json(res, {
          error: "This account is now required to sign in with Microsoft Entra.",
          authState: {
            type: "entra-migration-required",
            message: "This account is now required to sign in with Microsoft Entra.",
          },
        }, 403);
      }

      const promptedUser = await noteUserEntraMigrationPrompt(user.id);
      const nextPromptCount = Number(promptedUser?.entraMigrationPromptCount || (Number(user.entraMigrationPromptCount || 0) + 1));
      const token = await createSession(user.id);
      res.setHeader("Set-Cookie", cookie.serialize(process.env.SESSION_COOKIE_NAME || "sprinto_session", token, { httpOnly: true, sameSite: "lax", path: "/" }));
      await logAudit(user.id, "login", "session", { provider: user.authSource });
      await logAudit(user.id, "user.entra_migration_prompt", "user", {
        id: user.id,
        fromAuthSource: user.authSource,
        toAuthSource: "entra",
        promptCountAtLogin: nextPromptCount,
        promptLimit: migrationStatus.promptLimit,
        forceAt: migrationStatus.forceAt,
      });
      return json(res, {
        token,
        user: promptedUser || user,
        authNotice: "This account is prepared for Microsoft Entra migration. Please start using Sign in with Microsoft before enforcement begins.",
      });
    }

    const token = await createSession(user.id);
    res.setHeader("Set-Cookie", cookie.serialize(process.env.SESSION_COOKIE_NAME || "sprinto_session", token, { httpOnly: true, sameSite: "lax", path: "/" }));
    await logAudit(user.id, "login", "session", {});
    return json(res, { token, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed.";
    if (message === "This account has already been migrated to Microsoft Entra. Use Sign in with Microsoft.") {
      return json(res, {
        error: message,
        authState: {
          type: "entra-migration-required",
          message,
        },
      }, 403);
    }
    const status = message.startsWith("Active Directory is not fully configured")
      ? 400
      : message === "You do not have access to Sprinto."
        ? 403
        : 401;
    return json(res, { error: message }, status);
  }
});

app.post("/api/auth/logout", requireUser, async (req, res) => {
  const settings = await getSettings();
  await revokeSession(req.sessionToken);
  res.setHeader("Set-Cookie", cookie.serialize(process.env.SESSION_COOKIE_NAME || "sprinto_session", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 }));
  let redirectUrl = "";
  if (req.user.authSource === "entra" && settings.entraGlobalLogoutEnabled) {
    try {
      redirectUrl = resolveEntraLogoutUrl(settings, "/");
    } catch {
      redirectUrl = "";
    }
  }
  await logAudit(req.user.id, "session.logout", "session", {
    mode: redirectUrl ? "entra_global_logout" : "local_only",
    provider: req.user.authSource,
  });
  await publishDashboard();
  json(res, { status: "ok", redirectUrl });
});

app.get("/api/auth/me", requireUser, async (req, res) => {
  const { sessionId, ...user } = req.user;
  json(res, user);
});

app.post("/api/auth/change-password", requireUser, async (req, res) => {
  if (isSystemManagedUser(req.user)) {
    return json(res, { error: "The recovery admin password is managed from deployment configuration." }, 403);
  }
  if (req.user.authSource !== "local") {
    return json(res, { error: "Password changes are only available for local accounts." }, 403);
  }
  const result = await changePassword(req.user.id, req.body?.currentPassword || "", req.body?.newPassword || "");
  if (!result.ok) {
    return json(res, { error: result.message }, 400);
  }
  await logAudit(req.user.id, "password.change", "user", {});
  json(res, { status: "ok" });
});

app.put("/api/auth/profile", requireUser, async (req, res) => {
  if (isSystemManagedUser(req.user)) {
    return json(res, { error: "The recovery admin profile is managed from deployment configuration." }, 403);
  }
  const isDirectoryManaged = req.user.authSource === "ad" || req.user.authSource === "entra";
  const hasDisplayName = Object.prototype.hasOwnProperty.call(req.body || {}, "displayName");
  const hasAvatarDataUrl = Object.prototype.hasOwnProperty.call(req.body || {}, "avatarDataUrl");
  const hasTheme = Object.prototype.hasOwnProperty.call(req.body || {}, "theme");
  const requestedDisplayName = String(req.body?.displayName || "").trim();
  const avatarDataUrl = hasAvatarDataUrl ? String(req.body?.avatarDataUrl || "") : req.user.avatarDataUrl || "";
  const theme = hasTheme ? String(req.body?.theme || "") : req.user.theme || "sprinto";
  const displayName = isDirectoryManaged || !hasDisplayName ? req.user.displayName : requestedDisplayName;

  if (!hasDisplayName && !hasAvatarDataUrl && !hasTheme) {
    return json(res, { error: "No profile changes were provided." }, 400);
  }

  if (!isDirectoryManaged && hasDisplayName && !requestedDisplayName) {
    return json(res, { error: "Display name is required" }, 400);
  }

  const user = await updateCurrentUserProfile(req.user.id, {
    displayName,
    avatarDataUrl,
    theme,
  });

  await logAudit(req.user.id, "profile.update", "user", { id: req.user.id });
  json(res, user);
});

app.get("/api/settings", async (_req, res) => {
  json(res, await getSettingsCompat());
});

app.get("/branding/logo", async (_req, res) => {
  const settings = await getSettings();
  sendBrandingAsset(res, settings?.logoDataUrl || "", resolveBundledAsset("Logo_bitmap_noBG.png"), "image/png");
});

app.get("/branding/favicon", async (_req, res) => {
  const settings = await getSettings();
  sendBrandingAsset(res, settings?.faviconDataUrl || "", resolveBundledAsset("Favicon_bitmap_noBG.png"), "image/png");
});

app.get("/api/decks", requireUser, async (_req, res) => {
  json(res, { decks: await listDecksCompat() });
});

app.get("/api/rooms", requireUser, async (_req, res) => {
  json(res, { rooms: await getDashboardCompat() });
});

app.post("/api/rooms", requireUser, async (req, res) => {
  if (!capabilitiesFor(req.user).canCreateRoom) return json(res, { error: "Forbidden" }, 403);
  const name = String(req.body?.name || "").trim();
  if (!name) return json(res, { error: "Room name is required" }, 400);
  const decks = await listDecksCompat();
  const selectedDeck = decks.find((deck) => deck.name === req.body?.deckName) || decks.find((deck) => deck.isDefault) || decks[0];
  const roomId = await createRoom({ userId: req.user.id, name, deckId: selectedDeck?.id });
  await logAudit(req.user.id, "room.create", "room", { roomId, name });
  await publishDashboard();
  await publishRoom(roomId);
  json(res, { id: roomId });
});

app.get("/api/rooms/:roomId", requireUser, async (req, res) => {
  const snapshot = await getRoomSnapshot(req.params.roomId, req.user.id);
  if (!snapshot) return json(res, { error: "Not found" }, 404);
  json(res, snapshot);
});

app.post("/api/rooms/:roomId/join", requireUser, async (req, res) => {
  await joinRoom(req.params.roomId, req.user.id);
  await logAudit(req.user.id, "room.join", "room", { roomId: req.params.roomId });
  await publishRoom(req.params.roomId);
  await publishDashboard();
  json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
});

app.post("/api/rooms/:roomId/leave", requireUser, async (req, res) => {
  await leaveRoom(req.params.roomId, req.user.id);
  await logAudit(req.user.id, "room.leave", "room", { roomId: req.params.roomId });
  await publishRoom(req.params.roomId);
  await publishDashboard();
  json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
});

app.post("/api/rooms/:roomId/queue", requireUser, async (req, res) => {
  if (!capabilitiesFor(req.user).canManageRoom) return json(res, { error: "Forbidden" }, 403);
  const settings = await getSettings();
  const storyId = String(req.body?.storyId || "").trim();
  const title = String(req.body?.title || "").trim();
  if (!title) return json(res, { error: "Title is required" }, 400);
  if (settings?.requireStoryId && !storyId) return json(res, { error: "Story ID is required" }, 400);
  const composedTitle = storyId ? `${storyId} - ${title}` : title;
  const issueId = await addQueueIssue(req.params.roomId, composedTitle, req.body?.source || "manual");
  await logAudit(req.user.id, "room.queue.add", "room", { roomId: req.params.roomId, issueId });
  await publishRoom(req.params.roomId);
  json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
});

app.put("/api/rooms/:roomId/queue/:issueId", requireUser, async (req, res) => {
  if (!capabilitiesFor(req.user).canManageRoom) return json(res, { error: "Forbidden" }, 403);
  try {
    const settings = await getSettings();
    const storyId = String(req.body?.storyId || "").trim();
    const title = String(req.body?.title || "").trim();
    if (!title) return json(res, { error: "Title is required" }, 400);
    if (settings?.requireStoryId && !storyId) return json(res, { error: "Story ID is required" }, 400);
    const composedTitle = storyId ? `${storyId} - ${title}` : title;
    await updateQueueIssue(req.params.roomId, req.params.issueId, composedTitle, req.body?.source || "manual");
    await logAudit(req.user.id, "room.queue.update", "room", { roomId: req.params.roomId, issueId: req.params.issueId });
    await publishRoom(req.params.roomId);
    json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
  } catch (error) {
    json(res, { error: error.message }, 400);
  }
});

app.delete("/api/rooms/:roomId/queue/:issueId", requireUser, async (req, res) => {
  if (!capabilitiesFor(req.user).canManageRoom) return json(res, { error: "Forbidden" }, 403);
  try {
    await deleteQueueIssue(req.params.roomId, req.params.issueId);
    await logAudit(req.user.id, "room.queue.delete", "room", { roomId: req.params.roomId, issueId: req.params.issueId });
    await publishRoom(req.params.roomId);
    json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
  } catch (error) {
    json(res, { error: error.message }, 400);
  }
});

app.post("/api/rooms/:roomId/start", requireUser, async (req, res) => {
  if (!capabilitiesFor(req.user).canManageRoom) return json(res, { error: "Forbidden" }, 403);
  try {
    await startQueuedIssue(req.params.roomId, req.body?.issueId);
    await logAudit(req.user.id, "room.issue.start", "room", { roomId: req.params.roomId, issueId: req.body?.issueId });
    await publishRoom(req.params.roomId);
    await publishDashboard();
    json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
  } catch (error) {
    json(res, { error: error.message }, 400);
  }
});

app.post("/api/rooms/:roomId/vote", requireUser, async (req, res) => {
  if (!capabilitiesFor(req.user).canVote) return json(res, { error: "Forbidden" }, 403);
  try {
    const current = await getRoomSnapshot(req.params.roomId, req.user.id);
    await castVote(req.params.roomId, current?.room.currentIssue.id, req.user.id, req.body?.value);
    await logAudit(req.user.id, "room.vote", "room", { roomId: req.params.roomId, value: req.body?.value });
    await publishRoom(req.params.roomId);
    json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
  } catch (error) {
    json(res, { error: error.message }, 400);
  }
});

app.post("/api/rooms/:roomId/reveal", requireUser, async (req, res) => {
  if (!capabilitiesFor(req.user).canManageRoom) return json(res, { error: "Forbidden" }, 403);
  try {
    await revealIssue(req.params.roomId, req.user.id);
    await logAudit(req.user.id, "room.reveal", "room", { roomId: req.params.roomId });
    await publishRoom(req.params.roomId);
    await publishDashboard();
    json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
  } catch (error) {
    json(res, { error: error.message }, 400);
  }
});

app.post("/api/rooms/:roomId/close", requireUser, async (req, res) => {
  if (!capabilitiesFor(req.user).canManageRoom) return json(res, { error: "Forbidden" }, 403);
  await closeRoom(req.params.roomId);
  await logAudit(req.user.id, "room.close", "room", { roomId: req.params.roomId });
  await publishRoom(req.params.roomId);
  await publishDashboard();
  json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
});

app.post("/api/rooms/:roomId/highlight", requireUser, async (req, res) => {
  if (!req.user.permissions?.includes("highlight_cards")) return json(res, { error: "Forbidden" }, 403);
  try {
    const highlightMode = await updateRoomHighlightMode(req.params.roomId, req.body?.highlightMode);
    await logAudit(req.user.id, "room.highlight", "room", { roomId: req.params.roomId, highlightMode });
    await publishRoom(req.params.roomId);
    json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
  } catch (error) {
    json(res, { error: error.message }, 400);
  }
});

app.delete("/api/rooms/:roomId", requireUser, async (req, res) => {
  if (!capabilitiesFor(req.user).canDeleteRoom) return json(res, { error: "Forbidden" }, 403);
  await deleteRoom(req.params.roomId);
  await logAudit(req.user.id, "room.delete", "room", { roomId: req.params.roomId });
  await publishDashboard();
  broadcast({ type: "room.deleted", roomId: req.params.roomId });
  json(res, { ok: true });
});

app.get("/api/rooms/:roomId/history/:issueId", requireUser, async (req, res) => {
  const issue = await getHistoryIssue(req.params.roomId, req.params.issueId);
  if (!issue) return json(res, { error: "Not found" }, 404);
  json(res, { issue });
});

app.post("/api/rooms/:roomId/reset", requireUser, async (req, res) => {
  json(res, await getRoomSnapshot(req.params.roomId, req.user.id));
});

app.get("/api/jira/boards", requireUser, requireJiraImport, async (_req, res) => {
  try {
    const settings = await getSettings();
    json(res, { boards: await listJiraBoards(settings) });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to load Jira boards." }, 400);
  }
});

app.get("/api/jira/boards/:boardId/sprints", requireUser, requireJiraImport, async (req, res) => {
  try {
    const settings = await getSettings();
    json(res, { sprints: await listJiraSprints(settings, req.params.boardId) });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to load Jira sprints." }, 400);
  }
});

app.post("/api/jira/boards/:boardId/sprints/:sprintId/issues/preview", requireUser, requireJiraImport, async (req, res) => {
  try {
    const settings = await getSettings();
    const issues = await listJiraIssues(settings, {
      boardId: req.params.boardId,
      sprintId: req.params.sprintId,
      filters: req.body || {},
    });
    json(res, { issues });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to preview Jira issues." }, 400);
  }
});

app.post("/api/jira/boards/:boardId/issues/preview", requireUser, requireJiraImport, async (req, res) => {
  try {
    const settings = await getSettings();
    const importScope = await resolveJiraImportScope(settings, req.params.boardId, "");
    const issues = await listJiraIssues(settings, {
      boardId: req.params.boardId,
      sprintId: importScope.sprintId,
      filters: req.body || {},
    });
    json(res, { issues });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to preview Jira issues." }, 400);
  }
});

app.post("/api/rooms/:roomId/jira/import", requireUser, requireJiraImport, async (req, res) => {
  try {
    const settings = await getSettings();
    const { boardId, sprintId, filters } = req.body || {};
    const reimportCompletedIssues = req.body?.reimportCompletedIssues === true;
    if (!boardId) {
      return json(res, { error: "Board is required." }, 400);
    }
    const snapshot = await getRoomSnapshot(req.params.roomId, req.user.id);
    if (!snapshot) {
      return json(res, { error: "Room not found." }, 404);
    }

    const importScope = await resolveJiraImportScope(settings, boardId, sprintId);
    const normalizedSprintId = importScope.sprintId;
    const importedIssues = await listJiraIssues(settings, { boardId, sprintId: normalizedSprintId, filters });
    const {
      queuedByExternalId,
      existingOutsideQueueByExternalId,
      duplicateQueuedIssueIds,
      missingCandidates,
    } = summarizeRoomJiraIssues(snapshot, boardId, normalizedSprintId);

    for (const duplicateIssueId of duplicateQueuedIssueIds) {
      await deleteQueueIssue(req.params.roomId, duplicateIssueId);
    }

    const createdIssueIds = [];
    let updatedCount = 0;
    let reimportedCompletedCount = 0;
    let skippedCount = 0;
    const importedExternalIds = new Set();

    for (const issue of importedIssues) {
      importedExternalIds.add(issue.id);
      const payload = {
        title: composeImportedJiraIssueTitle(issue),
        source: "jira",
        externalSource: "jira",
        externalIssueId: issue.id,
        externalIssueKey: issue.key,
        externalIssueUrl: issue.issueUrl,
        jiraFieldsSnapshot: issue.jiraFieldsSnapshot,
        importedFromBoardId: String(boardId),
        importedFromSprintId: normalizedSprintId,
      };

      const queuedIssue = queuedByExternalId.get(issue.id);
      if (queuedIssue) {
        await updateQueueIssue(req.params.roomId, queuedIssue.id, payload);
        updatedCount += 1;
        continue;
      }

      if (existingOutsideQueueByExternalId.has(issue.id)) {
        if (reimportCompletedIssues) {
          const issueId = await addQueueIssue(req.params.roomId, payload);
          createdIssueIds.push(issueId);
          reimportedCompletedCount += 1;
          continue;
        }
        skippedCount += 1;
        continue;
      }

      const issueId = await addQueueIssue(req.params.roomId, payload);
      createdIssueIds.push(issueId);
    }

    const removedIssues = missingCandidates.filter((issue) => !importedExternalIds.has(issue.externalIssueId));
    for (const removedIssue of removedIssues) {
      await deleteQueueIssue(req.params.roomId, removedIssue.id);
    }
    const syncedCount = createdIssueIds.length + updatedCount;

    await logAudit(req.user.id, "jira.import", "room", {
      roomId: req.params.roomId,
      boardId: String(boardId),
      sprintId: normalizedSprintId,
      importedCount: syncedCount,
      addedCount: createdIssueIds.length,
      updatedCount,
      reimportedCompletedCount,
      skippedCount,
      deduplicatedCount: duplicateQueuedIssueIds.length,
      removedCount: removedIssues.length,
      removedIssueKeys: removedIssues.map((issue) => issue.externalIssueKey).filter(Boolean),
      reimportCompletedIssues,
      filters: filters || {},
    });
    await publishRoom(req.params.roomId);
    json(res, {
      importedCount: syncedCount,
      addedCount: createdIssueIds.length,
      updatedCount,
      reimportedCompletedCount,
      skippedCount,
      deduplicatedCount: duplicateQueuedIssueIds.length,
      removedCount: removedIssues.length,
      removedIssueKeys: removedIssues.map((issue) => issue.externalIssueKey).filter(Boolean),
      snapshot: await getRoomSnapshot(req.params.roomId, req.user.id),
    });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to import Jira issues." }, 400);
  }
});

app.get("/api/rooms/:roomId/jira/issues/:issueId/assignees", requireUser, requireJiraEstimateWrite, async (req, res) => {
  try {
    const settings = await getSettings();
    const jiraSettings = settings.integrations?.jira;
    if (!jiraSettings?.writeAssigneeEnabled) {
      return json(res, { error: "Jira assignee writeback is disabled." }, 403);
    }

    const snapshot = await getRoomSnapshot(req.params.roomId, req.user.id);
    const matchingIssue = findRoomJiraIssue(snapshot, req.params.issueId);
    if (!matchingIssue?.externalIssueKey) {
      return json(res, { error: "Linked Jira issue not found." }, 404);
    }

    const rawQuery = Array.isArray(req.query?.query) ? req.query.query[0] : req.query?.query;
    const users = await listJiraAssignableUsers(settings, matchingIssue.externalIssueKey, rawQuery || "");
    json(res, { users });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to load Jira assignees." }, 400);
  }
});

app.post("/api/rooms/:roomId/jira/issues/:issueId/apply-estimate", requireUser, requireJiraEstimateWrite, async (req, res) => {
  try {
    const snapshot = await getRoomSnapshot(req.params.roomId, req.user.id);
    const matchingIssue = findRoomJiraIssue(snapshot, req.params.issueId);
    if (!matchingIssue?.externalIssueKey) {
      return json(res, { error: "Linked Jira issue not found." }, 404);
    }
    const settings = await getSettings();
    const jiraSettings = settings.integrations?.jira;
    const result = await applyJiraEstimate(settings, matchingIssue.externalIssueKey, {
      mode: req.body?.mode || "story-points",
      storyPointsValue: req.body?.storyPointsValue,
      originalEstimate: req.body?.originalEstimate,
      minutesPerStoryPoint: jiraSettings?.originalEstimateMinutesPerStoryPoint || 30,
    });
    await updateIssueJiraDeliveryStatus(req.params.issueId, (current) => ({
      ...current,
      estimate: {
        sentAt: new Date().toISOString(),
        sentByUserId: req.user.id,
        sentByDisplayName: req.user.displayName || req.user.username || "",
        mode: req.body?.mode || "story-points",
        storyPointsValue: Number.isFinite(Number(req.body?.storyPointsValue)) ? Number(req.body?.storyPointsValue) : current.estimate.storyPointsValue,
        originalEstimate: typeof req.body?.originalEstimate === "string" ? req.body.originalEstimate : current.estimate.originalEstimate,
      },
    }));
    await logAudit(req.user.id, "jira.estimate.apply", "room", {
      roomId: req.params.roomId,
      issueId: req.params.issueId,
      jiraIssueKey: matchingIssue.externalIssueKey,
      mode: req.body?.mode || "story-points",
      storyPointsValue: req.body?.storyPointsValue,
      originalEstimate: req.body?.originalEstimate,
    });
    json(res, { ...result, snapshot: await getRoomSnapshot(req.params.roomId, req.user.id) });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to apply Jira estimate." }, 400);
  }
});

app.post("/api/rooms/:roomId/jira/issues/:issueId/assignee", requireUser, requireJiraEstimateWrite, async (req, res) => {
  try {
    const snapshot = await getRoomSnapshot(req.params.roomId, req.user.id);
    const matchingIssue = findRoomJiraIssue(snapshot, req.params.issueId);
    if (!matchingIssue?.externalIssueKey) {
      return json(res, { error: "Linked Jira issue not found." }, 404);
    }

    const settings = await getSettings();
    const jiraSettings = settings.integrations?.jira;
    if (!jiraSettings?.writeAssigneeEnabled) {
      return json(res, { error: "Jira assignee writeback is disabled." }, 403);
    }

    const accountId = typeof req.body?.accountId === "string" ? req.body.accountId : "";
    const displayName = typeof req.body?.displayName === "string" ? req.body.displayName : "";
    const result = await assignJiraIssue(settings, matchingIssue.externalIssueKey, accountId);
    await updateIssueJiraDeliveryStatus(req.params.issueId, (current) => ({
      ...current,
      assignee: {
        sentAt: new Date().toISOString(),
        sentByUserId: req.user.id,
        sentByDisplayName: req.user.displayName || req.user.username || "",
        accountId: result.accountId,
        displayName: result.accountId ? displayName : "",
      },
    }));
    await logAudit(req.user.id, "jira.assignee.apply", "room", {
      roomId: req.params.roomId,
      issueId: req.params.issueId,
      jiraIssueKey: matchingIssue.externalIssueKey,
      assigneeAccountId: result.accountId || null,
      assigneeDisplayName: result.accountId ? displayName || null : null,
    });
    json(res, { ...result, snapshot: await getRoomSnapshot(req.params.roomId, req.user.id) });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to update Jira assignee." }, 400);
  }
});

app.post("/api/rooms/:roomId/jira/issues/:issueId/report", requireUser, requireJiraReportPosting, async (req, res) => {
  try {
    const snapshot = await getRoomSnapshot(req.params.roomId, req.user.id);
    const roomIssue = [snapshot?.room.currentIssue, ...(snapshot?.room.issueHistory || [])]
      .filter(Boolean)
      .find((issue) => issue.id === req.params.issueId);
    if (!roomIssue?.externalIssueKey) {
      return json(res, { error: "Linked Jira issue not found." }, 404);
    }
    const settings = await getSettings();
    const report = {
      ...(await buildSprintoIssueReport({
        settings,
        roomName: snapshot?.room.name || "",
        roomIssue,
        finalValue: req.body?.finalValue,
      })),
    };
    const includeComment = Boolean(req.body?.includeComment);
    const includePdf = Boolean(req.body?.includePdf);
    if (!includeComment && !includePdf) {
      return json(res, { error: "Select at least one Jira report action." }, 400);
    }
    if (includePdf && !includeComment) {
      return json(res, { error: "PDF report can only be attached when Jira comment posting is enabled." }, 400);
    }
    const sentAt = new Date().toISOString();
    const filename = buildSprintoReportFilename(roomIssue.externalIssueKey, roomIssue.title);
    const initialCommentDocument = includeComment && !includePdf
      ? createIssueReportComment(report, {
          sentAt,
          filename,
        })
      : null;
    report.sentAt = sentAt;
    const pdfBuffer = includePdf ? await createSimplePdfBuffer(report) : null;
    const result = await postJiraIssueReport(settings, roomIssue.externalIssueKey, {
      commentDocument: initialCommentDocument,
      pdfBuffer,
      filename,
    });
    if (includeComment && includePdf) {
      await postJiraIssueReport(settings, roomIssue.externalIssueKey, {
        commentDocument: createIssueReportComment(report, {
          sentAt,
          filename,
          attachment: result.attachment,
        }),
      });
    }
    await updateIssueJiraDeliveryStatus(req.params.issueId, (current) => ({
      ...current,
      report: {
        sentAt,
        sentByUserId: req.user.id,
        sentByDisplayName: req.user.displayName || req.user.username || "",
        finalValue: report.finalValue,
        commentPosted: includeComment,
        pdfUploaded: includePdf,
      },
    }));
    await logAudit(req.user.id, "jira.report.post", "room", {
      roomId: req.params.roomId,
      issueId: req.params.issueId,
      jiraIssueKey: roomIssue.externalIssueKey,
      commentPosted: result.commentPosted,
      pdfUploaded: result.pdfUploaded,
      finalValue: report.finalValue,
    });
    json(res, { ...result, snapshot: await getRoomSnapshot(req.params.roomId, req.user.id) });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to post Jira report." }, 400);
  }
});

function buildSprintoReportFilename(issueKey, issueTitle) {
  const normalizedIssueKey = String(issueKey || "").trim();
  const safeTitle = String(issueTitle || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const titleWithoutIssueKey = safeTitle
    ? safeTitle.replace(new RegExp(`^${normalizedIssueKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-:–]?\\s*`, "i"), "").trim()
    : "";
  const baseName = `SPRINTO REPORT ${normalizedIssueKey}${titleWithoutIssueKey ? ` ${titleWithoutIssueKey}` : ""}`.trim();
  return `${baseName}.pdf`;
}

async function buildSprintoIssueReport({ settings, roomName, roomIssue, finalValue }) {
  const logoAssets = await resolveReportLogoAssets(settings);
  const issueKey = String(roomIssue?.externalIssueKey || "").trim();
  const issueTitle = stripIssueKeyFromTitle(issueKey, roomIssue?.title);
  const votes = Object.values(roomIssue?.votes || {})
    .sort((left, right) => new Date(left?.votedAt || 0).getTime() - new Date(right?.votedAt || 0).getTime());
  const uniqueVoterIds = [...new Set(votes.map((vote) => String(vote.userId || "")).filter(Boolean))];
  const usersById = new Map(
    (await Promise.all(uniqueVoterIds.map(async (userId) => [userId, await getUserById(userId)])))
      .filter((entry) => entry[0] && entry[1])
  );
  const timelineEvents = normalizeReportTimeline(roomIssue?.events, roomIssue?.startedAt, roomIssue?.revealedAt);
  const numericVotes = votes
    .map((vote) => Number(vote?.value))
    .filter((value) => Number.isFinite(value));

  return {
    logoDataUrl: logoAssets.logoDataUrl,
    fallbackLogoDataUrl: logoAssets.fallbackLogoDataUrl,
    roomName: String(roomName || ""),
    issueKey,
    issueTitle,
    startedAt: roomIssue?.startedAt || null,
    revealedAt: roomIssue?.revealedAt || null,
    sentAt: null,
    finalValue: normalizeDisplayNumber(finalValue ?? roomIssue?.stats?.median ?? roomIssue?.stats?.average ?? "-"),
    average: normalizeDisplayNumber(roomIssue?.stats?.average),
    median: normalizeDisplayNumber(roomIssue?.stats?.median),
    mostFrequent: normalizeDisplayNumber(resolveMostFrequentValue(numericVotes)),
    highest: normalizeDisplayNumber(resolveHighestValue(numericVotes)),
    totalVoters: votes.length,
    durationLabel: formatIssueDuration(roomIssue?.startedAt, roomIssue?.revealedAt),
    participants: votes
      .map((vote) => displayNameForUser(usersById.get(vote.userId)))
      .filter(Boolean),
    votes: votes.map((vote) => `${vote.userId}:${vote.value}`),
    voterRows: votes.map((vote) => {
      const user = usersById.get(vote.userId);
      const name = displayNameForUser(user) || vote.userId || "Unknown voter";
      return {
        userId: vote.userId,
        name,
        initials: initialsForName(name),
        avatarDataUrl: String(user?.avatarDataUrl || ""),
        value: String(vote?.value ?? "-"),
        votedAt: vote?.votedAt || null,
      };
    }),
    timelineEvents,
  };
}

function stripIssueKeyFromTitle(issueKey, issueTitle) {
  const normalizedIssueKey = String(issueKey || "").trim();
  const safeTitle = String(issueTitle || "").trim();
  if (!normalizedIssueKey || !safeTitle) {
    return safeTitle;
  }
  return safeTitle.replace(new RegExp(`^${normalizedIssueKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-:–]?\\s*`, "i"), "").trim();
}

function displayNameForUser(user) {
  return String(user?.displayName || user?.username || "").trim();
}

function initialsForName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
}

function normalizeDisplayNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return Number.isInteger(numeric) ? String(numeric) : String(Number(numeric.toFixed(2)));
}

function resolveMostFrequentValue(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return right[0] - left[0];
    })[0]?.[0] ?? null;
}

function resolveHighestValue(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  return values.reduce((highest, current) => (current > highest ? current : highest), values[0]);
}

function formatIssueDuration(startedAt, revealedAt) {
  const start = new Date(startedAt || "").getTime();
  const end = new Date(revealedAt || "").getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "-";
  }
  const totalSeconds = Math.max(1, Math.round((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function normalizeReportTimeline(events, startedAt, revealedAt) {
  const normalized = Array.isArray(events)
    ? events
      .filter((event) => event?.occurredAt)
      .map((event) => ({
        type: String(event.type || "event"),
        occurredAt: event.occurredAt,
        participantName: String(event.participantName || "").trim(),
        value: event.value === undefined || event.value === null ? "" : String(event.value),
      }))
    : [];

  if (!normalized.some((event) => event.type === "reveal") && revealedAt) {
    normalized.push({
      type: "reveal",
      occurredAt: revealedAt,
      participantName: "",
      value: "",
    });
  }

  return normalized
    .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime())
    .filter((event) => {
      if (event.type === "vote" || event.type === "reveal") return true;
      return startedAt && revealedAt;
    });
}

app.post("/api/jira/worklog/report", requireUser, requireWorklogView, async (req, res) => {
  try {
    const filters = req.body || {};
    if (!filters.dateFrom || !filters.dateTo) {
      return json(res, { error: "dateFrom and dateTo are required." }, 400);
    }
    const rows = await buildJiraWorklogReport(await getSettings(), filters);
    const issueKeys = Array.isArray(filters.issueKeys)
      ? filters.issueKeys.map((value) => String(value || "").trim()).filter(Boolean)
      : (filters.epicKey ? [String(filters.epicKey || "").trim()] : []);
    await logAudit(req.user.id, "jira.worklog.report", "jira", {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      issueKeys,
      rowCount: rows.length,
      viewMode: filters.viewMode || "issue-first",
    });
    json(res, { rows });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to build Jira worklog report." }, 400);
  }
});

app.get("/api/jira/worklog/users", requireUser, requireWorklogView, async (req, res) => {
  try {
    const users = await listJiraWorklogUsers(await getSettings(), String(req.query?.query || ""));
    json(res, { users });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to load Jira users." }, 400);
  }
});

app.get("/api/jira/worklog/issues", requireUser, requireWorklogView, async (req, res) => {
  try {
    const issues = await searchJiraWorklogIssues(await getSettings(), String(req.query?.query || ""));
    json(res, { issues });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to load Jira issues." }, 400);
  }
});

app.get("/api/jira/worklog/issues/:issueKey", requireUser, requireWorklogView, async (req, res) => {
  try {
    const issue = await getJiraWorklogIssue(await getSettings(), String(req.params.issueKey || ""));
    if (!issue) {
      return json(res, { error: "Issue key is required." }, 400);
    }
    json(res, { issue });
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to load Jira issue." }, 400);
  }
});

app.post("/api/presence/ping", requireUser, async (req, res) => {
  if (req.body?.roomId) await touchPresence(req.body.roomId, req.user.id);
  json(res, { ok: true });
});

app.get("/api/admin/overview", requireUser, requireAdmin, async (_req, res) => {
  if (capabilitiesFor(_req.user).canManageUpdates) {
    await refreshUpdateStatus();
  }
  json(res, await getAdminOverviewCompat(_req.user));
});

app.put("/api/admin/settings", requireUser, requireManageSettings, async (req, res) => {
  const previousSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  const settings = req.body || {};
  const currentSettings = await getSettings();
  const httpsEnabled = Boolean(settings.httpsEnabled);
  const tlsCertPath = String(settings.tlsCertPath || "").trim();
  const tlsKeyPath = String(settings.tlsKeyPath || "").trim();

  if (httpsEnabled && (!tlsCertPath || !tlsKeyPath)) {
    return json(res, { error: "When HTTPS is enabled, both TLS certificate path and TLS key path are required." }, 400);
  }

  const localAuthEnabled = isLocalAuthEnabled(settings);
  const activeDirectoryEnabled = isActiveDirectoryEnabled(settings);
  const entraAuthEnabled = isEntraAuthEnabled(settings);
  const entraMigrationEnabled = settings.entraMigrationEnabled !== false;
  const entraGlobalLogoutEnabled = Boolean(settings.entraGlobalLogoutEnabled);
  const entraMigrationPromptLoginCount = Math.max(1, Number(settings.entraMigrationPromptLoginCount || 3));
  const entraMigrationForceAtDefault = normalizeOptionalIsoDateTime(settings.entraMigrationForceAtDefault);
  const mergedEntraClientSecret = String(settings.entraClientSecret || "").trim() || currentSettings.entraClientSecret || "";

  if (!hasEnabledAuthProvider(settings)) {
    return json(res, { error: "At least one sign-in provider must remain enabled." }, 400);
  }

  if (entraAuthEnabled) {
    try {
      validateEntraSettings({
        publicBaseUrl: String(settings.publicBaseUrl || "").trim(),
        entraTenantId: String(settings.entraTenantId || "").trim(),
        entraClientId: String(settings.entraClientId || "").trim(),
        entraClientSecret: mergedEntraClientSecret,
        entraClientSecretConfigured: Boolean(mergedEntraClientSecret),
      });
    } catch (error) {
      return json(res, { error: error instanceof Error ? error.message : "Microsoft Entra is not fully configured." }, 400);
    }
  }

  if (activeDirectoryEnabled) {
    try {
      validateActiveDirectorySettings({
        adServerUrl: String(settings.adServerUrl || "").trim(),
        adBaseDn: String(settings.adBaseDn || "").trim(),
        adBindUsername: String(settings.adBindUsername || "").trim(),
        adBindPassword: String(settings.adBindPassword || "").trim(),
      }, { requireAttributes: false });
    } catch (error) {
      return json(res, { error: error instanceof Error ? error.message : "Active Directory is not fully configured." }, 400);
    }
  }

  const decks = await listDecksCompat();
  const defaultDeck = decks.find((deck) => deck.name === settings.defaultDeck);
  await upsertSettings({
    default_timer_seconds: settings.defaultTimerSeconds,
    https_enabled: httpsEnabled,
    tls_cert_path: tlsCertPath,
    tls_key_path: tlsKeyPath,
    trust_proxy: Boolean(settings.trustProxy),
    public_base_url: String(settings.publicBaseUrl || "").trim(),
    local_auth_enabled: localAuthEnabled,
    active_directory_enabled: activeDirectoryEnabled,
    entra_auth_enabled: entraAuthEnabled,
    entra_migration_enabled: entraMigrationEnabled,
    entra_global_logout_enabled: entraGlobalLogoutEnabled,
    entra_migration_prompt_login_count: entraMigrationPromptLoginCount,
    entra_migration_force_at_default: entraMigrationForceAtDefault,
    require_story_id: settings.requireStoryId,
    login_method: settings.loginMethod,
    minimum_password_length: settings.minPasswordLength,
    require_password_complexity: settings.requirePasswordComplexity,
    ad_server_url: settings.adServerUrl || "",
    ad_server_port: Number(settings.adServerPort) || (settings.adConnectionSecurity === "ldaps" ? 636 : 389),
    ad_connection_security: settings.adConnectionSecurity || "ldap",
    ad_base_dn: settings.adBaseDn || "",
    ad_bind_username: settings.adBindUsername || "",
    ad_bind_password: settings.adBindPassword || "",
    ad_login_attribute: settings.adLoginAttribute || "sAMAccountName",
    ad_email_attribute: settings.adEmailAttribute || "mail",
    ad_display_name_attribute: settings.adDisplayNameAttribute || "displayName",
    ad_external_id_attribute: settings.adExternalIdAttribute || "objectGUID",
    ad_avatar_attribute: settings.adAvatarAttribute || "thumbnailPhoto",
    ad_ca_certificate: settings.adCaCertificate || "",
    ad_allow_untrusted_certificate: Boolean(settings.adAllowUntrustedCertificate),
    entra_tenant_id: String(settings.entraTenantId || "").trim(),
    entra_client_id: String(settings.entraClientId || "").trim(),
    entra_client_secret: mergedEntraClientSecret,
    default_deck_id: defaultDeck?.id || decks.find((deck) => deck.isDefault)?.id || decks[0]?.id,
    brand_logo_data_url: settings.logoDataUrl || "",
    brand_favicon_data_url: settings.faviconDataUrl || "",
    scheduled_tasks: settings.scheduledTasks || {},
  });
  const canceledPendingMigrationUserIds = !entraMigrationEnabled ? await cancelAllPendingEntraMigrations() : [];
  await scheduleNextScheduledTaskRun();
  const nextSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  await logAudit(req.user.id, "settings.update", "settings", {
    ...buildAuditChangeSet(previousSettings, nextSettings),
    canceledPendingMigrationUserIds,
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.put("/api/admin/settings/rooms", requireUser, requireManageRoomSettings, async (req, res) => {
  const previousSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  const settings = req.body || {};
  const decks = await listDecksCompat();
  const defaultDeck = decks.find((deck) => deck.name === settings.defaultDeck);

  await upsertSettings({
    default_timer_seconds: Number(settings.defaultTimerSeconds) || 1,
    require_story_id: Boolean(settings.requireStoryId),
    default_deck_id: defaultDeck?.id || decks.find((deck) => deck.isDefault)?.id || decks[0]?.id,
  });

  const nextSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  await logAudit(req.user.id, "room_settings.update", "settings", buildAuditChangeSet(previousSettings, nextSettings));
  json(res, await getAdminOverviewCompat(req.user));
});

app.put("/api/admin/settings/updates", requireUser, requireManageUpdates, async (req, res) => {
  const previousSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  const settings = req.body || {};
  const updatesEnabled = Boolean(settings.updatesEnabled);
  await upsertSettings({
    updates_enabled: updatesEnabled,
  });
  if (updatesEnabled) {
    await refreshUpdateStatus({ force: true });
  }
  const nextSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  await logAudit(req.user.id, "settings.updates.update", "settings", buildAuditChangeSet(previousSettings, nextSettings));
  json(res, await getAdminOverviewCompat(req.user));
});

app.post("/api/admin/settings/updates/check", requireUser, requireManageUpdates, async (req, res) => {
  const previousSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  await refreshUpdateStatus({ force: true });
  const nextSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  await logAudit(req.user.id, "settings.updates.check", "settings", buildAuditChangeSet(previousSettings, nextSettings));
  json(res, await getAdminOverviewCompat(req.user));
});

app.put("/api/admin/settings/integrations", requireUser, requireManageIntegrations, async (req, res) => {
  const previousSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  const currentSettings = await getSettings();
  const currentJira = currentSettings.integrations?.jira || {};
  const incomingJira = req.body?.jira || req.body?.integrations?.jira || {};
  const nextJira = mergeJiraSettings(currentJira, incomingJira);
  await upsertSettings({
    jira_integration: nextJira,
  });
  const nextSettings = sanitizeSettingsForAudit(await getSettingsCompat());
  await logAudit(req.user.id, "settings.integrations.update", "settings", buildAuditChangeSet(previousSettings, nextSettings));
  json(res, await getAdminOverviewCompat(req.user));
});

app.post("/api/admin/settings/integrations/jira/test", requireUser, requireManageIntegrations, async (req, res) => {
  try {
    const currentSettings = await getSettings();
    const currentJira = currentSettings.integrations?.jira || {};
    const incomingJira = req.body?.jira || req.body?.integrations?.jira || {};
    const testResult = await testJiraConnection({
      integrations: {
        jira: mergeJiraSettings(currentJira, incomingJira),
      },
    });
    await logAudit(req.user.id, "settings.integrations.jira.test", "settings", {
      ok: Boolean(testResult.ok),
      site: testResult.site,
      displayName: testResult.displayName,
    });
    json(res, testResult);
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Jira connection test failed." }, 400);
  }
});

app.post("/api/admin/scheduled-tasks/:taskKey/run", requireUser, requireManageScheduledTasks, async (req, res) => {
  const allowedTaskKeys = new Set(["autoAnonymizeDeactivatedUsers", "autoCloseRooms", "autoCloseInactiveSessions", "syncActiveDirectoryUsers", "checkForUpdates"]);
  const taskKey = String(req.params.taskKey || "");
  if (!allowedTaskKeys.has(taskKey)) {
    return json(res, { error: "Unknown scheduled task." }, 404);
  }

  const settings = await getSettingsCompat();
  const task = settings?.scheduledTasks?.[taskKey];
  if (!task) {
    return json(res, { error: "Scheduled task is not configured." }, 404);
  }

  const result = await executeScheduledTask(taskKey, new Date(), { manual: true, triggeredByUserId: req.user.id });
  let message = "Scheduled task finished successfully.";
  if (taskKey === "autoAnonymizeDeactivatedUsers") {
    message = result?.anonymizedUserCount === 1
      ? "Manual run finished: 1 user was anonymized."
      : `Manual run finished: ${Number(result?.anonymizedUserCount || 0)} users were anonymized.`;
  } else if (taskKey === "autoCloseRooms") {
    message = result?.closedRoomCount === 1
      ? "Manual run finished: 1 room was closed."
      : `Manual run finished: ${Number(result?.closedRoomCount || 0)} rooms were closed.`;
  } else if (taskKey === "autoCloseInactiveSessions") {
    message = result?.closedSessionCount === 1
      ? "Manual run finished: 1 inactive session was closed."
      : `Manual run finished: ${Number(result?.closedSessionCount || 0)} inactive sessions were closed.`;
  } else if (taskKey === "syncActiveDirectoryUsers") {
    if (result?.skipped) {
      message = `Manual run skipped: ${result.reason}`;
    } else {
      message = `Manual run finished: loaded ${Number(result?.directoryUserCount || 0)} AD users, synced ${Number(result?.syncedUserCount || 0)}, deactivated ${Number(result?.deactivatedUserCount || 0)}, errors ${Number(result?.syncErrorCount || 0)}.`;
    }
  } else if (taskKey === "checkForUpdates") {
    if (result?.checkError) {
      message = `Manual run finished with warning: ${result.checkError}`;
    } else if (result?.updateAvailable) {
      message = `Manual run finished: new version ${result.latestVersion} is available.`;
    } else {
      message = `Manual run finished: no newer version is available${result?.latestVersion ? ` (latest ${result.latestVersion})` : ""}.`;
    }
  }
  json(res, {
    overview: await getAdminOverviewCompat(req.user),
    message,
  });
});

app.post("/api/admin/settings/active-directory/test", requireUser, requireManageSettings, async (req, res) => {
  const payload = req.body || {};
  const settings = payload.settings || {};
  const testIdentifier = String(payload.testIdentifier || "").trim();

  try {
    const result = await testActiveDirectoryConnection(testIdentifier, settings.loginMethod || "username", settings);
    const matchedRoleNames = result.user
      ? await resolveRoleNamesForAdGroups(result.user.groupIdentifiers || [])
      : [];
    const checks = [...result.checks];

    checks.push({
      key: "role-mapping",
      label: "Role",
      ok: matchedRoleNames.length > 0,
      message: result.user
        ? matchedRoleNames.length > 0
          ? matchedRoleNames.join(", ")
          : "No Sprinto role matches this user's AD groups."
        : "Role mapping could not be evaluated because the test user was not resolved.",
    });

    json(res, {
      ok: checks.every((check) => check.ok),
      checks,
      user: result.user
        ? {
            distinguishedName: result.user.distinguishedName,
            username: result.user.username,
            email: result.user.email,
            displayName: result.user.displayName,
            externalId: result.user.externalId,
            groupCount: result.user.groupIdentifiers.length,
            matchedRoleNames,
          }
        : null,
    });
  } catch (error) {
    json(res, {
      ok: false,
      checks: [
        {
          key: "active-directory-test",
          label: "Active Directory test",
          ok: false,
          message: error instanceof Error ? error.message : "Unable to test the Active Directory connection.",
        },
      ],
      user: null,
    }, 400);
  }
});

app.post("/api/admin/decks", requireUser, requireManageDecks, async (req, res) => {
  const beforeDeck = null;
  const id = await saveDeck(req.body || {});
  const afterDeck = (await listDecksCompat()).find((deck) => deck.id === id) || null;
  await logAudit(req.user.id, req.body?.id ? "deck.update" : "deck.create", "deck", {
    id,
    ...buildAuditChangeSet(toAuditDeckSnapshot(beforeDeck), toAuditDeckSnapshot(afterDeck)),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.put("/api/admin/decks/:deckId", requireUser, requireManageDecks, async (req, res) => {
  const beforeDeck = (await listDecksCompat()).find((deck) => deck.id === req.params.deckId) || null;
  const id = await saveDeck({ id: req.params.deckId, ...req.body });
  const afterDeck = (await listDecksCompat()).find((deck) => deck.id === id) || null;
  await logAudit(req.user.id, "deck.update", "deck", {
    id,
    ...buildAuditChangeSet(toAuditDeckSnapshot(beforeDeck), toAuditDeckSnapshot(afterDeck)),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.delete("/api/admin/decks/:deckId", requireUser, requireManageDecks, async (req, res) => {
  const beforeDeck = (await listDecksCompat()).find((deck) => deck.id === req.params.deckId) || null;
  await deleteDeck(req.params.deckId);
  await logAudit(req.user.id, "deck.delete", "deck", {
    id: req.params.deckId,
    ...buildAuditChangeSet(toAuditDeckSnapshot(beforeDeck), null),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.post("/api/admin/roles", requireUser, requireManageRoles, async (req, res) => {
  try {
    const id = await saveRoleCompat(req.body || {});
    const createdRole = (await listRolesCompat()).find((role) => role.id === id) || null;
    await logAudit(req.user.id, "role.create", "role", {
      id,
      ...buildAuditChangeSet(null, toAuditRoleSnapshot(createdRole)),
    });
    json(res, await getAdminOverviewCompat(req.user));
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to save role" }, 400);
  }
});

app.put("/api/admin/roles/:roleId", requireUser, requireManageRoles, async (req, res) => {
  try {
    const previousRole = (await listRolesCompat()).find((role) => role.id === req.params.roleId) || null;
    const id = await saveRoleCompat({ ...req.body, id: req.params.roleId });
    const nextRole = (await listRolesCompat()).find((role) => role.id === id) || null;
    await logAudit(req.user.id, "role.update", "role", {
      id,
      ...buildAuditChangeSet(toAuditRoleSnapshot(previousRole), toAuditRoleSnapshot(nextRole)),
    });
    json(res, await getAdminOverviewCompat(req.user));
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Failed to save role" }, 400);
  }
});

app.delete("/api/admin/roles/:roleId", requireUser, requireManageRoles, async (req, res) => {
  const previousRole = (await listRolesCompat()).find((role) => role.id === req.params.roleId) || null;
  await deleteRole(req.params.roleId);
  await logAudit(req.user.id, "role.delete", "role", {
    id: req.params.roleId,
    ...buildAuditChangeSet(toAuditRoleSnapshot(previousRole), null),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.post("/api/admin/users", requireUser, requireManageUsers, async (req, res) => {
  const settings = await getSettingsCompat();
  const body = req.body || {};
  const authSource = body.authSource || "local";
  if (authSource !== "local") {
    return json(res, { error: "Only local users can be created manually in Sprinto." }, 400);
  }
  if (!isLocalAuthEnabled(settings)) {
    return json(res, { error: "Local accounts are disabled in authentication settings." }, 403);
  }
  if (!body.id && authSource === "local" && !body.password) return json(res, { error: "New password is required" }, 400);
  if (body.password) {
    const error = validatePassword(body.password, settings);
    if (error) return json(res, { error }, 400);
  }
  let id;
  try {
    id = await saveUserCompat(body);
  } catch (error) {
    return json(res, { error: error instanceof Error ? error.message : "Unable to save user" }, 400);
  }
  const createdUser = await getUserById(id);
  await logAudit(req.user.id, "user.create", "user", {
    id,
    ...buildAuditChangeSet(null, toAuditUserSnapshot(createdUser)),
    passwordChanged: true,
  });
  json(res, { overview: await getAdminOverviewCompat(req.user), userId: id });
});

app.put("/api/admin/users/:userId", requireUser, requireManageUsers, async (req, res) => {
  const settings = await getSettingsCompat();
  const body = req.body || {};
  const existingUser = await getUserById(req.params.userId);
  if (!existingUser) return json(res, { error: "Not found" }, 404);
  if (existingUser.authSource !== "local") {
    return json(res, { error: managedUserMutationMessage(existingUser, "update") }, 403);
  }
  if (body.password) {
    const error = validatePassword(body.password, settings);
    if (error) return json(res, { error }, 400);
  }
  const id = await saveUserCompat({ ...body, id: req.params.userId, username: body.username || "" });
  const nextUser = await getUserById(id);
  await logAudit(req.user.id, "user.update", "user", {
    id,
    ...buildAuditChangeSet(toAuditUserSnapshot(existingUser), toAuditUserSnapshot(nextUser)),
    passwordChanged: Boolean(body.password),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.put("/api/admin/users/:userId/roles", requireUser, requireManageUsers, async (req, res) => {
  const current = req.body || {};
  const existingUser = await getUserById(req.params.userId);
  if (!existingUser) return json(res, { error: "Not found" }, 404);
  if (existingUser.authSource !== "local") {
    return json(res, { error: managedUserMutationMessage(existingUser, "roles") }, 403);
  }
  await saveUserCompat({
    id: existingUser.id,
    username: existingUser.username,
    displayName: existingUser.displayName,
    email: existingUser.email,
    authSource: existingUser.authSource,
    password: "",
    avatarDataUrl: existingUser.avatarDataUrl,
    roles: current.roles || existingUser.roles,
  });
  const nextRoles = current.roles || existingUser.roles;
  await logAudit(req.user.id, "user.roles.update", "user", {
    id: req.params.userId,
    before: { roles: existingUser.roles || [] },
    after: { roles: nextRoles },
    addedRoles: nextRoles.filter((role) => !(existingUser.roles || []).includes(role)),
    removedRoles: (existingUser.roles || []).filter((role) => !nextRoles.includes(role)),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.post("/api/admin/users/:userId/entra-migration/prepare", requireUser, requireManageUsers, async (req, res) => {
  const settings = await getSettings();
  if (!isEntraAuthEnabled(settings)) {
    return json(res, { error: "Microsoft Entra must be enabled before user migration can be prepared." }, 400);
  }
  if (settings.entraMigrationEnabled === false) {
    return json(res, { error: "Microsoft Entra migration must be enabled before user migration can be prepared." }, 400);
  }

  const existingUser = await getUserById(req.params.userId);
  if (!existingUser) return json(res, { error: "Not found" }, 404);
  if (!["local", "ad"].includes(existingUser.authSource)) {
    return json(res, { error: "Only local or Microsoft Active Directory users can be prepared for Entra migration." }, 400);
  }
  if (!existingUser.email) {
    return json(res, { error: "The user must have an email address before Entra migration can be prepared." }, 400);
  }

  const nextUser = await prepareUserForEntraMigration({
    userId: req.params.userId,
    preparedByUserId: req.user.id,
    forceAt: req.body?.forceAt || null,
    fallbackForceAt: settings.entraMigrationForceAtDefault || null,
  });
  if (!nextUser) {
    return json(res, { error: "Unable to prepare Entra migration for this user." }, 400);
  }
  await logAudit(req.user.id, "user.entra_migration_prepare", "user", {
    id: nextUser.id,
    fromAuthSource: existingUser.authSource,
    toAuthSource: "entra",
    preparedByUserId: req.user.id,
    forceAt: nextUser.entraMigrationForceAt,
    ...buildAuditChangeSet(toAuditUserSnapshot(existingUser), toAuditUserSnapshot(nextUser)),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.post("/api/admin/users/:userId/entra-migration/cancel", requireUser, requireManageUsers, async (req, res) => {
  const existingUser = await getUserById(req.params.userId);
  if (!existingUser) return json(res, { error: "Not found" }, 404);
  if (existingUser.entraMigrationState !== "pending") {
    return json(res, { error: "This user does not have a pending Entra migration." }, 400);
  }
  const nextUser = await cancelUserEntraMigration(req.params.userId);
  if (!nextUser) {
    return json(res, { error: "Unable to cancel Entra migration for this user." }, 400);
  }
  await logAudit(req.user.id, "user.entra_migration_cancel", "user", {
    id: nextUser.id,
    fromAuthSource: existingUser.authSource,
    toAuthSource: existingUser.authSource,
    preparedByUserId: existingUser.entraMigrationPreparedByUserId || "",
    ...buildAuditChangeSet(toAuditUserSnapshot(existingUser), toAuditUserSnapshot(nextUser)),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.post("/api/admin/users/:userId/deactivate", requireUser, requireManageUsers, async (req, res) => {
  if (req.user.id === req.params.userId) {
    return json(res, { error: "You cannot deactivate your own account." }, 400);
  }
  const existingUser = await getUserById(req.params.userId);
  if (!existingUser) return json(res, { error: "Not found" }, 404);
  if (isSystemManagedUser(existingUser)) {
    return json(res, { error: managedUserMutationMessage(existingUser, "deactivate") }, 403);
  }
  const changed = await deactivateUser(req.params.userId);
  if (!changed) {
    return json(res, { error: "Unable to deactivate user." }, 400);
  }
  await logAudit(req.user.id, "user.deactivate", "user", {
    id: existingUser.id,
    ...buildAuditChangeSet(
      {
        username: existingUser.username,
        displayName: existingUser.displayName,
        email: existingUser.email,
        authSource: existingUser.authSource,
        isActive: true,
        avatarConfigured: Boolean(existingUser.avatarDataUrl),
      },
      {
        username: existingUser.username,
        displayName: existingUser.displayName,
        email: existingUser.email,
        authSource: existingUser.authSource,
        isActive: false,
        avatarConfigured: false,
      }
    ),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.post("/api/admin/users/:userId/anonymize", requireUser, requireManageUsers, async (req, res) => {
  if (req.user.id === req.params.userId) {
    return json(res, { error: "You cannot anonymize your own account." }, 400);
  }
  const existingUser = await getUserById(req.params.userId);
  if (!existingUser) return json(res, { error: "Not found" }, 404);
  if (isSystemManagedUser(existingUser)) {
    return json(res, { error: managedUserMutationMessage(existingUser, "anonymize") }, 403);
  }
  if (existingUser.isActive) {
    return json(res, { error: "Only deactivated users can be anonymized." }, 400);
  }
  if (existingUser.anonymizedAt) {
    return json(res, { error: "This user has already been anonymized." }, 400);
  }
  const changed = await anonymizeUser(req.params.userId);
  if (!changed) {
    return json(res, { error: "Unable to anonymize user." }, 400);
  }
  const anonymizedUsername = `anonymized_${req.params.userId}`;
  await logAudit(req.user.id, "user.anonymize", "user", {
    id: existingUser.id,
    ...buildAuditChangeSet(
      {
        username: existingUser.username,
        displayName: existingUser.displayName,
        email: existingUser.email,
        authSource: existingUser.authSource,
        avatarConfigured: Boolean(existingUser.avatarDataUrl),
      },
      {
        username: anonymizedUsername,
        displayName: "Inactive user",
        email: `${anonymizedUsername}@sprinto.local`,
        authSource: existingUser.authSource,
        avatarConfigured: false,
      }
    ),
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.post("/api/admin/users/:userId/reactivate", requireUser, requireManageUsers, async (req, res) => {
  const settings = await getSettingsCompat();
  const body = req.body || {};
  const username = String(body.username || "").trim();
  const displayName = String(body.displayName || "").trim();
  const password = String(body.password || "");
  const existingUser = await getUserById(req.params.userId);

  if (!existingUser) return json(res, { error: "Not found" }, 404);
  if (existingUser.authSource !== "local") {
    return json(res, { error: managedUserMutationMessage(existingUser, "reactivate") }, 403);
  }

  if (!username) return json(res, { error: "Username is required" }, 400);
  if (!displayName) return json(res, { error: "Display name is required" }, 400);

  const error = validatePassword(password, settings);
  if (error) return json(res, { error }, 400);

  let changed = false;
  try {
    changed = await reactivateUser({
      id: req.params.userId,
      username,
      displayName,
      email: String(body.email || "").trim(),
      password,
      avatarDataUrl: String(body.avatarDataUrl || ""),
      roleNames: body.roles || [],
    });
  } catch (error) {
    return json(res, { error: error instanceof Error ? error.message : "Unable to reactivate user." }, 400);
  }
  if (!changed) {
    return json(res, { error: "Unable to reactivate user." }, 400);
  }
  await logAudit(req.user.id, "user.reactivate", "user", {
    id: existingUser.id,
    ...buildAuditChangeSet(
      {
        username: existingUser.username,
        displayName: existingUser.displayName,
        email: existingUser.email,
        authSource: existingUser.authSource,
        isActive: false,
        avatarConfigured: Boolean(existingUser.avatarDataUrl),
        roles: existingUser.roles || [],
      },
      {
        username,
        displayName,
        email: String(body.email || "").trim(),
        authSource: existingUser.authSource,
        isActive: true,
        avatarConfigured: Boolean(String(body.avatarDataUrl || "")),
        roles: body.roles || [],
      }
    ),
    passwordChanged: true,
  });
  json(res, await getAdminOverviewCompat(req.user));
});

app.get("/api/admin/audit", requireUser, requireManageAuditLogs, async (req, res) => {
  json(res, await listAuditLogs({
    action: String(req.query.action || ""),
    target: String(req.query.target || ""),
    search: String(req.query.search || ""),
    page: Number(req.query.page || 1),
  }));
});

app.get("/api/admin/sessions", requireUser, requireManageSessions, async (req, res) => {
  json(res, { sessions: await listSessionsCompat(String(req.query.search || "")) });
});

app.post("/api/admin/sessions/:sessionId/revoke", requireUser, requireManageSessions, async (req, res) => {
  await revokeSessionById(req.params.sessionId);
  await logAudit(req.user.id, "session.revoke", "session", { id: req.params.sessionId });
  json(res, await getAdminOverviewCompat(req.user));
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

wss.on("connection", async (socket, req) => {
  const cookies = cookie.parse(req.headers.cookie || "");
  const tokenFromCookie = cookies[process.env.SESSION_COOKIE_NAME || "sprinto_session"] || "";
  const tokenFromQuery = new URL(req.url || "/", "http://localhost").searchParams.get("token") || "";
  const user = await getUserBySession(tokenFromCookie || tokenFromQuery);
  socket.user = user;
  sockets.add(socket);
  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(String(raw));
      if (message.type === "room.watch" && user && message.roomId) await touchPresence(message.roomId, user.id);
      if (message.type === "room.leave" && user && message.roomId) {
        await leaveRoom(message.roomId, user.id);
        await publishRoom(message.roomId);
        await publishDashboard();
      }
    } catch {}
  });
  socket.on("close", () => sockets.delete(socket));
});

await initDatabase();
try {
  await refreshUpdateStatus({ force: true });
} catch (error) {
  console.error("Initial update status refresh failed:", error);
}
await scheduleNextScheduledTaskRun();

const port = Number(process.env.PORT || 3000);
server.listen(port);
