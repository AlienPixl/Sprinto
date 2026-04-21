export type RoomSummary = {
  id: string;
  name: string;
  activeIssueTitle: string;
  status: string;
  participantCount: number;
  revealed: boolean;
  completedCount: number;
  createdAt: string;
};

export type Participant = {
  id: string;
  firstName: string;
  lastName: string;
  voted: boolean;
  canVote: boolean;
};

export type Vote = {
  userId: string;
  value: string;
  votedAt: string;
};

export type IssueEvent = {
  type: string;
  occurredAt: string;
  participantId?: string;
  participantName?: string;
  participantCanVote?: boolean;
  value?: string;
};

export type Issue = {
  id: string;
  title: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  revealedAt?: string;
  externalSource: "jira" | "manual" | string;
  externalIssueId: string;
  externalIssueKey: string;
  externalIssueUrl: string;
  jiraFieldsSnapshot: Record<string, unknown>;
  jiraDeliveryStatus: JiraDeliveryStatus;
  importedFromBoardId: string;
  importedFromSprintId: string;
  votes: Record<string, Vote>;
  events: IssueEvent[];
  stats: Stats;
};

export type IssueQueueItem = {
  id: string;
  title: string;
  source: string;
  externalSource: "jira" | "manual" | string;
  externalIssueId: string;
  externalIssueKey: string;
  externalIssueUrl: string;
  jiraFieldsSnapshot: Record<string, unknown>;
  jiraDeliveryStatus: JiraDeliveryStatus;
  importedFromBoardId: string;
  importedFromSprintId: string;
};

export type Room = {
  id: string;
  name: string;
  deck: string[];
  highlightMode: "none" | "most-frequent" | "highest";
  status: string;
  createdAt: string;
  participants: Participant[];
  currentIssue: Issue;
  issueHistory: Issue[];
  issueQueue: IssueQueueItem[];
  revealed: boolean;
  completedCount: number;
};

export type Stats = {
  average: number | null;
  median: number | null;
};

export type RoomSnapshot = {
  room: Room;
  stats: Stats;
};

export type RoomEvent = {
  type: string;
  data: RoomSnapshot;
};

export type ThemeId = "sprinto" | "timero";

export type User = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  authSource: "local" | "ad" | "entra" | "system" | string;
  isSystemManaged: boolean;
  externalId: string;
  entraLinked: boolean;
  entraMigrationState: "" | "pending" | string;
  entraMigrationPreparedAt: string | null;
  entraMigrationPreparedByUserId: string;
  entraMigrationPromptCount: number;
  entraMigrationForceAt: string | null;
  isActive: boolean;
  deactivatedUsername: string;
  deactivatedAt: string | null;
  anonymizedAt: string | null;
  avatarDataUrl: string;
  avatarManagedByDirectory: boolean;
  avatarManagedByAuthSource: "ad" | "entra" | "" | string;
  theme: ThemeId;
  roles: string[];
  permissions: string[];
  lastLoginAt: string;
};

export type Role = {
  id: string;
  name: string;
  description: string;
  adGroupName: string;
  entraAppRoleValue: string;
  entraGroupId: string;
  permissions: string[];
};

export type Permission = {
  name: string;
  description: string;
};

export type JiraIntegrationSettings = {
  enabled: boolean;
  baseUrl: string;
  serviceAccountEmail: string;
  apiToken: string;
  apiTokenConfigured: boolean;
  clearStoredApiToken?: boolean;
  offerKanbanBoards: boolean;
  writeStoryPointsEnabled: boolean;
  writeOriginalEstimateEnabled: boolean;
  writeAssigneeEnabled: boolean;
  originalEstimateMode: "multiplied-story-points";
  originalEstimateMinutesPerStoryPoint: number;
  postCommentEnabled: boolean;
  postPdfEnabled: boolean;
};

export type IntegrationsOverview = {
  jira: JiraIntegrationSettings;
};

export type JiraBoard = {
  id: string;
  name: string;
  type: string;
};

export type JiraSprint = {
  id: string;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
};

export type JiraImportFilters = {
  storyPointsEmpty: boolean;
  originalEstimateEmpty: boolean;
  importOrder: "issue-key" | "priority";
};

export type JiraImportPreviewIssue = {
  id: string;
  key: string;
  title: string;
  issueUrl: string;
  reporter: string;
  priority: { id: string; name: string } | null;
  storyPoints: number | null;
  originalEstimateSeconds: number | null;
  status: string;
  issueType: string;
  jiraFieldsSnapshot: Record<string, unknown>;
};

export type JiraImportSyncResult = {
  importedCount: number;
  addedCount: number;
  updatedCount: number;
  reimportedCompletedCount: number;
  skippedCount: number;
  deduplicatedCount: number;
  removedCount: number;
  removedIssueKeys: string[];
  snapshot: RoomSnapshot;
};

export type JiraApplyEstimateMode = "story-points" | "original-estimate" | "both";

export type JiraAssignableUser = {
  accountId: string;
  displayName: string;
  emailAddress: string;
  avatarUrl: string;
  active: boolean;
};

export type JiraWorklogIssue = {
  key: string;
  title: string;
  issueType: string;
};

export type JiraDeliveryRecord = {
  sentAt: string | null;
  sentByUserId: string;
  sentByDisplayName: string;
};

export type JiraEstimateDeliveryRecord = JiraDeliveryRecord & {
  mode: JiraApplyEstimateMode | "";
  storyPointsValue: number | null;
  originalEstimate: string;
};

export type JiraReportDeliveryRecord = JiraDeliveryRecord & {
  finalValue: string;
  commentPosted: boolean;
  pdfUploaded: boolean;
};

export type JiraAssigneeDeliveryRecord = JiraDeliveryRecord & {
  accountId: string;
  displayName: string;
};

export type JiraDeliveryStatus = {
  estimate: JiraEstimateDeliveryRecord;
  report: JiraReportDeliveryRecord;
  assignee: JiraAssigneeDeliveryRecord;
};

export type JiraWorklogRow = {
  epicKey: string;
  issueKey: string;
  issueTitle: string;
  accountId: string;
  author: string;
  startedAt: string;
  secondsSpent: number;
};

export type JiraWorklogGroupBy = "epic" | "issue" | "user";

export type JiraWorklogRequest = {
  dateFrom: string;
  dateTo: string;
  issueKeys: string[];
  includeEpicChildren: boolean;
  assigneeAccountIds: string[];
  viewMode: "issue-first" | "user-first" | "epic-first";
  primaryGroupBy?: JiraWorklogGroupBy;
  secondaryGroupBy?: JiraWorklogGroupBy | "";
};

export type JiraWorklogReport = {
  rows: JiraWorklogRow[];
};

export type SettingsOverview = {
  requireStoryId: boolean;
  defaultDeck: string;
  defaultTimerSeconds: number;
  httpsEnabled: boolean;
  tlsCertPath: string;
  tlsKeyPath: string;
  trustProxy: boolean;
  publicBaseUrl: string;
  updatesEnabled: boolean;
  updateLastCheckedAt: string | null;
  updateLatestVersion: string;
  updateLatestReleaseUrl: string;
  updateCheckError: string;
  currentVersion: string;
  updateAvailable: boolean;
  localAuthEnabled: boolean;
  activeDirectoryEnabled: boolean;
  entraAuthEnabled: boolean;
  entraMigrationEnabled: boolean;
  entraGlobalLogoutEnabled: boolean;
  entraMigrationPromptLoginCount: number;
  entraMigrationForceAtDefault: string;
  loginMethod: "username" | "email" | "both";
  minPasswordLength: number;
  requirePasswordComplexity: boolean;
  adServerUrl: string;
  adServerPort: number;
  adConnectionSecurity: "ldap" | "ldaps" | "starttls";
  adBaseDn: string;
  adBindUsername: string;
  adBindPassword: string;
  adLoginAttribute: string;
  adEmailAttribute: string;
  adDisplayNameAttribute: string;
  adExternalIdAttribute: string;
  adAvatarAttribute: string;
  adCaCertificate: string;
  adAllowUntrustedCertificate: boolean;
  entraTenantId: string;
  entraClientId: string;
  entraClientSecret: string;
  entraClientSecretConfigured: boolean;
  logoDataUrl: string;
  faviconDataUrl: string;
  integrations: IntegrationsOverview;
  scheduledTasks: ScheduledTasksOverview;
};

export type ScheduledTaskFrequency = "minutes" | "hourly" | "daily" | "selected_weekdays" | "weekly" | "monthly" | "yearly";

export type ScheduledTaskSchedule = {
  enabled: boolean;
  frequency: ScheduledTaskFrequency;
  intervalMinutes: number;
  time: string;
  weekdays: string[];
  weeklyWeekday: string;
  weekOfMonth: 1 | 2 | 3 | 4;
  monthlyDay: number;
  yearlyMonth: number;
  yearlyDay: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
};

export type ScheduledTaskAgeUnit = "minutes" | "hours" | "days" | "weeks" | "months" | "years";

export type AutoAnonymizeUsersTask = ScheduledTaskSchedule & {
  anonymizeAfterValue: number;
  anonymizeAfterUnit: ScheduledTaskAgeUnit;
  anonymizeAfterDays: number;
};

export type AutoCloseRoomsTask = ScheduledTaskSchedule & {
  closeAfterValue: number;
  closeAfterUnit: ScheduledTaskAgeUnit;
  closeAfterDays: number;
  roomStatuses: string[];
};

export type AutoCloseInactiveSessionsTask = ScheduledTaskSchedule & {
  closeAfterValue: number;
  closeAfterUnit: ScheduledTaskAgeUnit;
  closeAfterDays: number;
};

export type SyncActiveDirectoryUsersTask = ScheduledTaskSchedule;
export type CheckForUpdatesTask = ScheduledTaskSchedule;

export type ScheduledTasksOverview = {
  autoAnonymizeDeactivatedUsers: AutoAnonymizeUsersTask;
  autoCloseRooms: AutoCloseRoomsTask;
  autoCloseInactiveSessions: AutoCloseInactiveSessionsTask;
  syncActiveDirectoryUsers: SyncActiveDirectoryUsersTask;
  checkForUpdates: CheckForUpdatesTask;
};

export type ActiveDirectoryTestCheck = {
  key: string;
  label: string;
  ok: boolean;
  message: string;
};

export type ActiveDirectoryTestResult = {
  ok: boolean;
  checks: ActiveDirectoryTestCheck[];
  user: null | {
    distinguishedName: string;
    username: string;
    email: string;
    displayName: string;
    externalId: string;
    groupCount: number;
    matchedRoleNames: string[];
  };
};

export type Deck = {
  id: string;
  name: string;
  values: string[];
  isDefault: boolean;
  createdAt: string;
};

export type AdminOverview = {
  users: User[];
  roles: Role[];
  permissions: Permission[];
  settings: SettingsOverview;
  decks: Deck[];
  activeSessions: ActiveSession[];
  auditLogs: AuditLog[];
};

export type ActiveSession = {
  token: string;
  userId: string;
  username: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
};

export type AuditLog = {
  id: number;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: string;
};
