import {
  ActiveDirectoryTestResult,
  AdminOverview,
  Deck,
  JiraAssignableUser,
  JiraWorklogIssue,
  Issue,
  JiraDeliveryStatus,
  JiraApplyEstimateMode,
  JiraBoard,
  JiraImportFilters,
  JiraImportPreviewIssue,
  JiraImportSyncResult,
  JiraSprint,
  JiraWorklogReport,
  JiraWorklogRequest,
  Room,
  RoomEvent,
  RoomSnapshot,
  RoomSummary,
  SettingsOverview,
  ThemeId,
  User,
} from "./types";

const API_BASE = "";
const TOKEN_KEY = "sprinto.token";

export type AuthState = {
  type: "entra-migration-required";
  message: string;
};

function authHeaders() {
  const token = getToken();
  return token ? ({ Authorization: `Bearer ${token}` } as Record<string, string>) : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...((init?.headers as Record<string, string> | undefined) ?? {})
  };

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...init
  });

  if (!response.ok) {
    let errorMessage = `Request failed: ${response.status}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload?.error) {
        errorMessage = payload.error;
      }
    } catch {
      try {
        const text = await response.text();
        if (text) {
          errorMessage = text;
        }
      } catch {}
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
}

export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  window.localStorage.removeItem(TOKEN_KEY);
}

export async function login(
  username: string,
  password: string,
  method: "username" | "email" | "both" = "username",
): Promise<{ token: string; user: User; authNotice?: string }> {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ username, password, method }),
  });

  const payload = await response.json().catch(() => ({} as Record<string, unknown>)) as {
    token?: string;
    user?: User;
    error?: string;
    authNotice?: string;
    authState?: AuthState;
  };

  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed: ${response.status}`) as Error & { authState?: AuthState };
    if (payload?.authState) {
      error.authState = payload.authState;
    }
    throw error;
  }

  return {
    token: payload.token || "",
    user: payload.user as User,
    authNotice: payload.authNotice || "",
  };
}

export function beginMicrosoftEntraLogin(returnTo = "/") {
  const params = new URLSearchParams();
  if (returnTo) {
    params.set("returnTo", returnTo);
  }
  const suffix = params.toString();
  window.location.assign(`/api/auth/entra/start${suffix ? `?${suffix}` : ""}`);
}

export async function logout(): Promise<{ redirectUrl?: string }> {
  return request<{ status: string; redirectUrl?: string }>("/api/auth/logout", {
    method: "POST"
  });
}

export async function me(): Promise<User> {
  return request<User>("/api/auth/me");
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request<{ status: string }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export async function updateMyProfile(payload: { displayName?: string; avatarDataUrl?: string; theme?: ThemeId }): Promise<User> {
  return request<User>("/api/auth/profile", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function getSettings(): Promise<SettingsOverview> {
  return request<SettingsOverview>("/api/settings");
}

export async function getAdminOverview(): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/overview");
}

export async function updateAdminSettings(settings: AdminOverview["settings"]): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export async function updateAdminRoomSettings(settings: AdminOverview["settings"]): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/settings/rooms", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export async function updateAdminUpdateSettings(settings: AdminOverview["settings"]): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/settings/updates", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export async function updateAdminIntegrationSettings(payload: { jira: SettingsOverview["integrations"]["jira"] }): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/settings/integrations", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function testJiraIntegration(payload: { jira: SettingsOverview["integrations"]["jira"] }): Promise<{ ok: boolean; site: string; accountId: string; displayName: string }> {
  return request<{ ok: boolean; site: string; accountId: string; displayName: string }>("/api/admin/settings/integrations/jira/test", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function checkForUpdates(): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/settings/updates/check", {
    method: "POST"
  });
}

export async function runScheduledTask(taskKey: string): Promise<{ overview: AdminOverview; message: string }> {
  return request<{ overview: AdminOverview; message: string }>(`/api/admin/scheduled-tasks/${encodeURIComponent(taskKey)}/run`, {
    method: "POST"
  });
}

export async function testActiveDirectorySettings(
  settings: SettingsOverview,
  testIdentifier: string
): Promise<ActiveDirectoryTestResult> {
  return request<ActiveDirectoryTestResult>("/api/admin/settings/active-directory/test", {
    method: "POST",
    body: JSON.stringify({ settings, testIdentifier })
  });
}

export async function updateUserRoles(userId: string, roles: string[]): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/users/${userId}/roles`, {
    method: "PUT",
    body: JSON.stringify({ roles })
  });
}

export async function revokeSession(token: string): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/sessions/${token}/revoke`, {
    method: "POST"
  });
}

export async function createDeck(name: string, values: string[]): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/decks", {
    method: "POST",
    body: JSON.stringify({ name, values })
  });
}

export async function updateDeck(deckId: string, name: string, values: string[]): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/decks/${deckId}`, {
    method: "PUT",
    body: JSON.stringify({ name, values })
  });
}

export async function deleteDeck(deckId: string): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/decks/${deckId}`, {
    method: "DELETE"
  });
}

export async function listRooms(): Promise<RoomSummary[]> {
  const payload = await request<{ rooms: RoomSummary[] }>("/api/rooms");
  return payload.rooms;
}

export async function createRoom(name: string, storyTitle: string): Promise<Room> {
  return request<Room>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name, storyTitle })
  });
}

export async function createRoomWithDeck(name: string, storyTitle: string, deckName: string): Promise<Room> {
  return request<Room>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name, storyTitle, deckName })
  });
}

export async function listDecks(): Promise<Deck[]> {
  const payload = await request<{ decks: Deck[] }>("/api/decks");
  return payload.decks;
}

export async function createUser(payload: {
  username: string;
  displayName: string;
  email: string;
  authSource: string;
  password: string;
  avatarDataUrl?: string;
  roles: string[];
}): Promise<{ overview: AdminOverview; userId: string }> {
  return request<{ overview: AdminOverview; userId: string }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateUser(userId: string, payload: {
  displayName: string;
  email: string;
  authSource: string;
  password?: string;
  avatarDataUrl?: string;
  roles: string[];
}): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deactivateUser(userId: string): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/users/${userId}/deactivate`, {
    method: "POST"
  });
}

export async function reactivateUser(userId: string, payload: {
  username: string;
  displayName: string;
  email: string;
  password: string;
  avatarDataUrl?: string;
  roles: string[];
}): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/users/${userId}/reactivate`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function prepareUserEntraMigration(userId: string, payload: { forceAt?: string | null }): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/users/${userId}/entra-migration/prepare`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelUserEntraMigration(userId: string): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/users/${userId}/entra-migration/cancel`, {
    method: "POST",
  });
}

export async function anonymizeUser(userId: string): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/users/${userId}/anonymize`, {
    method: "POST"
  });
}

export async function createRole(payload: {
  name: string;
  description: string;
  adGroupName: string;
  entraAppRoleValue: string;
  entraGroupId: string;
  permissions: string[];
}): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin/roles", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateRole(roleId: string, payload: {
  name: string;
  description: string;
  adGroupName: string;
  entraAppRoleValue: string;
  entraGroupId: string;
  permissions: string[];
}): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/roles/${roleId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteRole(roleId: string): Promise<AdminOverview> {
  return request<AdminOverview>(`/api/admin/roles/${roleId}`, {
    method: "DELETE"
  });
}

export async function deleteRoom(roomId: string): Promise<void> {
  await request<{ status: string }>(`/api/rooms/${roomId}`, {
    method: "DELETE"
  });
}

export async function getRoom(roomId: string): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}`);
}

export async function listJiraBoards(): Promise<JiraBoard[]> {
  const payload = await request<{ boards: JiraBoard[] }>("/api/jira/boards");
  return payload.boards;
}

export async function listJiraSprints(boardId: string): Promise<JiraSprint[]> {
  const payload = await request<{ sprints: JiraSprint[] }>(`/api/jira/boards/${encodeURIComponent(boardId)}/sprints`);
  return payload.sprints;
}

export async function importJiraIssues(
  roomId: string,
  payload: { boardId: string; sprintId?: string; filters: JiraImportFilters; reimportCompletedIssues?: boolean }
): Promise<JiraImportSyncResult> {
  return request<JiraImportSyncResult>(`/api/rooms/${encodeURIComponent(roomId)}/jira/import`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function previewJiraIssues(boardId: string, sprintId: string | undefined, filters: JiraImportFilters): Promise<JiraImportPreviewIssue[]> {
  const normalizedSprintId = String(sprintId || "").trim();
  const path = normalizedSprintId
    ? `/api/jira/boards/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(normalizedSprintId)}/issues/preview`
    : `/api/jira/boards/${encodeURIComponent(boardId)}/issues/preview`;
  const payload = await request<{ issues: JiraImportPreviewIssue[] }>(path, {
    method: "POST",
    body: JSON.stringify(filters)
  });
  return payload.issues;
}

export async function applyJiraIssueEstimate(
  roomId: string,
  issueId: string,
  payload: { mode: JiraApplyEstimateMode; storyPointsValue?: number; originalEstimate?: string }
): Promise<{ issueKey: string; updatedFields: string[]; snapshot: RoomSnapshot }> {
  return request<{ issueKey: string; updatedFields: string[]; snapshot: RoomSnapshot }>(`/api/rooms/${encodeURIComponent(roomId)}/jira/issues/${encodeURIComponent(issueId)}/apply-estimate`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function listJiraAssignableUsers(
  roomId: string,
  issueId: string,
  query = ""
): Promise<JiraAssignableUser[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("query", query.trim());
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await request<{ users: JiraAssignableUser[] }>(`/api/rooms/${encodeURIComponent(roomId)}/jira/issues/${encodeURIComponent(issueId)}/assignees${suffix}`);
  return payload.users;
}

export async function assignJiraIssueAssignee(
  roomId: string,
  issueId: string,
  payload: { accountId?: string; displayName?: string }
): Promise<{ issueKey: string; accountId: string; snapshot: RoomSnapshot }> {
  return request<{ issueKey: string; accountId: string; snapshot: RoomSnapshot }>(`/api/rooms/${encodeURIComponent(roomId)}/jira/issues/${encodeURIComponent(issueId)}/assignee`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function postJiraIssueReport(
  roomId: string,
  issueId: string,
  payload: { finalValue: string; includeComment?: boolean; includePdf?: boolean }
): Promise<{ issueKey: string; commentPosted: boolean; pdfUploaded: boolean; snapshot: RoomSnapshot }> {
  return request<{ issueKey: string; commentPosted: boolean; pdfUploaded: boolean; snapshot: RoomSnapshot }>(`/api/rooms/${encodeURIComponent(roomId)}/jira/issues/${encodeURIComponent(issueId)}/report`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getJiraWorklogReport(payload: JiraWorklogRequest): Promise<JiraWorklogReport> {
  return request<JiraWorklogReport>("/api/jira/worklog/report", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getJiraWorklogUsers(query = ""): Promise<JiraAssignableUser[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("query", query.trim());
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await request<{ users: JiraAssignableUser[] }>(`/api/jira/worklog/users${suffix}`);
  return payload.users;
}

export async function getJiraWorklogIssues(query = ""): Promise<JiraWorklogIssue[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("query", query.trim());
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const payload = await request<{ issues: JiraWorklogIssue[] }>(`/api/jira/worklog/issues${suffix}`);
  return payload.issues;
}

export async function getJiraWorklogIssue(issueKey: string): Promise<JiraWorklogIssue> {
  const payload = await request<{ issue: JiraWorklogIssue }>(`/api/jira/worklog/issues/${encodeURIComponent(issueKey)}`);
  return payload.issue;
}

export async function getHistoryIssue(roomId: string, issueId: string): Promise<Issue> {
  const payload = await request<{
    issue: {
      id: string;
      title: string;
      durationSeconds: number;
      avg: string | number | null;
      median: string | number | null;
      votes: number;
      externalSource?: string;
      externalIssueId?: string;
      externalIssueKey?: string;
      externalIssueUrl?: string;
      jiraFieldsSnapshot?: Record<string, unknown>;
      jiraDeliveryStatus?: JiraDeliveryStatus;
      importedFromBoardId?: string;
      importedFromSprintId?: string;
      playback?: {
        users?: Array<{ id: string; display_name: string; can_vote?: boolean }>;
        events?: Array<{
          type: string;
          userId?: string;
          label?: string;
          atMs?: number;
          payload?: { value?: string };
        }>;
        durationSeconds?: number;
      };
    };
  }>(`/api/rooms/${roomId}/history/${issueId}`);

  const issue = payload.issue;
  const playback = issue.playback || {};
  const startedAt = new Date(0).toISOString();
  const durationSeconds = playback.durationSeconds ?? issue.durationSeconds ?? 0;
  const endedAt = new Date(durationSeconds * 1000).toISOString();
  const revealEvent = [...(playback.events || [])]
    .filter((event) => event.type === "reveal")
    .sort((left, right) => (left.atMs || 0) - (right.atMs || 0))
    .at(-1);
  const revealedAt = new Date(revealEvent?.atMs ?? durationSeconds * 1000).toISOString();
  const participantDetails = new Map((playback.users || []).map((user) => [user.id, user]));
  const visibleVoteEvents = (playback.events || []).filter((event) => event.type === "vote" && event.userId && event.payload?.value);

  return {
    id: issue.id,
    title: issue.title,
    status: "done",
    startedAt,
    endedAt,
    revealedAt,
    externalSource: issue.externalSource || "manual",
    externalIssueId: issue.externalIssueId || "",
    externalIssueKey: issue.externalIssueKey || "",
    externalIssueUrl: issue.externalIssueUrl || "",
    jiraFieldsSnapshot: issue.jiraFieldsSnapshot || {},
    jiraDeliveryStatus: issue.jiraDeliveryStatus || {
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
    },
    importedFromBoardId: issue.importedFromBoardId || "",
    importedFromSprintId: issue.importedFromSprintId || "",
    votes: Object.fromEntries(
      visibleVoteEvents.map((event) => [
        event.userId as string,
        {
          userId: event.userId as string,
          value: event.payload?.value || "",
          votedAt: new Date(event.atMs || 0).toISOString()
        }
      ])
    ),
    events: (playback.events || []).map((event) => ({
      type: event.type,
      occurredAt: new Date(event.atMs || 0).toISOString(),
      participantId: event.userId,
      participantName: event.userId ? participantDetails.get(event.userId)?.display_name : undefined,
      participantCanVote: event.userId ? participantDetails.get(event.userId)?.can_vote : undefined,
      value: event.payload?.value
    })),
    stats: {
      average: issue.avg == null || issue.avg === "-" ? null : Number(issue.avg),
      median: issue.median == null || issue.median === "-" ? null : Number(issue.median)
    }
  };
}

export async function joinRoom(roomId: string, userId: string, name: string): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify({ userId, name })
  });
}

export async function leaveRoom(roomId: string, userId: string): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/leave`, {
    method: "POST",
    body: JSON.stringify({ userId })
  });
}

export function leaveRoomKeepalive(roomId: string, userId: string) {
  const token = getToken();
  void fetch(`${API_BASE}/api/rooms/${roomId}/leave`, {
    method: "POST",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ userId })
  });
}

export async function vote(roomId: string, userId: string, value: string): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/vote`, {
    method: "POST",
    body: JSON.stringify({ userId, value })
  });
}

export async function reveal(roomId: string): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/reveal`, {
    method: "POST"
  });
}

export async function resetRoom(roomId: string, storyTitle: string): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/reset`, {
    method: "POST",
    body: JSON.stringify({ storyTitle })
  });
}

export async function closeRoom(roomId: string): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/close`, {
    method: "POST"
  });
}

export async function updateRoomHighlightMode(roomId: string, highlightMode: "none" | "most-frequent" | "highest"): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/highlight`, {
    method: "POST",
    body: JSON.stringify({ highlightMode })
  });
}

export async function queueIssue(roomId: string, title: string, storyId = "", source = "manual"): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/queue`, {
    method: "POST",
    body: JSON.stringify({ title, storyId, source })
  });
}

export async function updateQueuedIssue(roomId: string, issueId: string, title: string, storyId = "", source = "manual"): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/queue/${issueId}`, {
    method: "PUT",
    body: JSON.stringify({ title, storyId, source })
  });
}

export async function deleteQueuedIssue(roomId: string, issueId: string): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/queue/${issueId}`, {
    method: "DELETE"
  });
}

export async function startQueuedIssue(roomId: string, issueId: string): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(`/api/rooms/${roomId}/start`, {
    method: "POST",
    body: JSON.stringify({ issueId })
  });
}

export function connectRoom(roomId: string, onEvent: (event: RoomEvent) => void): WebSocket {
  const isVite = import.meta.env.DEV;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = isVite ? "localhost:8080" : window.location.host;
  const token = getToken();
  const socket = new WebSocket(`${protocol}//${host}/api/rooms/${roomId}/ws?token=${token ?? ""}`);

  socket.onmessage = (message) => {
    onEvent(JSON.parse(message.data) as RoomEvent);
  };

  return socket;
}
