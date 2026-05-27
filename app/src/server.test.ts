// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const mockRegularUser = {
  id: "user-1",
  username: "alice",
  displayName: "Alice",
  email: "alice@example.com",
  roles: ["user"],
  permissions: ["vote", "create_room"],
  authSource: "local",
  isActive: true,
  sessionId: "session-1",
  entraMigrationState: null,
};

const mockAdminUser = {
  id: "admin-1",
  username: "admin",
  displayName: "Admin",
  email: "admin@example.com",
  roles: ["admin"],
  permissions: [
    "vote",
    "create_room",
    "reveal_votes",
    "close_poker",
    "queue_issues",
    "delete_room",
    "rename_room",
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
  authSource: "local",
  isActive: true,
  sessionId: "session-admin",
  entraMigrationState: null,
};

const mockSettings = {
  updatesEnabled: false,
  scheduledTasks: {},
  localAuthEnabled: true,
  activeDirectoryEnabled: false,
  entraAuthEnabled: false,
  entraMigrationEnabled: false,
  registrationEnabled: false,
  passwordMinLength: 8,
  passwordComplexityEnabled: false,
  theme: "classic",
  publicBaseUrl: "",
  appName: "Sprinto",
  defaultIssueSort: "issue",
  defaultHighlightMode: "none",
};

vi.mock("./store.js", () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
  getUserBySession: vi.fn().mockResolvedValue(null),
  getSettingsCompat: vi.fn().mockResolvedValue(mockSettings),
  getSettings: vi.fn().mockResolvedValue(mockSettings),
  getDashboardCompat: vi.fn().mockResolvedValue([]),
  getAdminOverviewCompat: vi.fn().mockResolvedValue({ users: [], rooms: [] }),
  getRoomSnapshot: vi.fn().mockResolvedValue(null),
  listDecksCompat: vi.fn().mockResolvedValue([{ id: "deck-1", name: "Fibonacci", isDefault: true }]),
  listRoomCategoriesCompat: vi.fn().mockResolvedValue([]),
  listUsersCompat: vi.fn().mockResolvedValue({ users: [] }),
  listRolesCompat: vi.fn().mockResolvedValue({ roles: [] }),
  listSessionsCompat: vi.fn().mockResolvedValue({ sessions: [] }),
  listAuditLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
  createRoom: vi.fn().mockResolvedValue("room-new"),
  createSession: vi.fn().mockResolvedValue("new-session-token"),
  capabilitiesFor: vi.fn().mockImplementation((user) => {
    const perms = new Set(user?.permissions || []);
    const isAdmin = user?.roles?.includes("admin") || false;
    return {
      canVote: perms.has("vote"),
      canCreateRoom: perms.has("create_room"),
      canManageRoom: perms.has("reveal_votes") || perms.has("close_poker") || perms.has("queue_issues"),
      canDeleteRoom: perms.has("delete_room"),
      canRenameRoom: perms.has("rename_room"),
      canImportJiraIssues: perms.has("jira_import_issues"),
      canSendToJira: perms.has("jira_send"),
      canViewWorklog: perms.has("worklog_view"),
      canAccessAdmin: isAdmin || perms.has("manage_users") || perms.has("manage_settings"),
      canManageUsers: perms.has("manage_users"),
      canManageRoles: perms.has("manage_roles"),
      canManageSettings: perms.has("manage_settings"),
      canManageIntegrations: perms.has("manage_integrations"),
      canManageRoomSettings: perms.has("manage_room_settings"),
      canManageDecks: perms.has("manage_decks"),
      canManageSessions: perms.has("manage_sessions"),
      canManageAuditLogs: perms.has("manage_audit_logs"),
      canManageScheduledTasks: perms.has("manage_scheduled_tasks"),
      canManageUpdates: perms.has("manage_updates"),
    };
  }),
  findUserForLogin: vi.fn().mockResolvedValue(null),
  findRecoveryUserForLogin: vi.fn().mockResolvedValue(null),
  findActiveEntraUsersByEmail: vi.fn().mockResolvedValue([]),
  findPendingEntraMigrationCandidatesByEmail: vi.fn().mockResolvedValue([]),
  findUserByEntraIdentity: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn().mockResolvedValue(null),
  createRoomCategory: vi.fn().mockResolvedValue("cat-1"),
  updateRoomCategory: vi.fn().mockResolvedValue(undefined),
  deleteRoomCategory: vi.fn().mockResolvedValue(undefined),
  renameRoom: vi.fn().mockResolvedValue(undefined),
  deleteRoom: vi.fn().mockResolvedValue(undefined),
  closeRoom: vi.fn().mockResolvedValue(undefined),
  joinRoom: vi.fn().mockResolvedValue(undefined),
  leaveRoom: vi.fn().mockResolvedValue(undefined),
  addQueueIssue: vi.fn().mockResolvedValue("issue-1"),
  updateQueueIssue: vi.fn().mockResolvedValue(undefined),
  deleteQueueIssue: vi.fn().mockResolvedValue(undefined),
  startQueuedIssue: vi.fn().mockResolvedValue(undefined),
  castVote: vi.fn().mockResolvedValue(undefined),
  revealIssue: vi.fn().mockResolvedValue(undefined),
  cancelActiveIssue: vi.fn().mockResolvedValue(undefined),
  getHistoryIssue: vi.fn().mockResolvedValue(null),
  touchPresence: vi.fn().mockResolvedValue(undefined),
  logAudit: vi.fn().mockResolvedValue(undefined),
  revokeSession: vi.fn().mockResolvedValue(undefined),
  revokeSessionById: vi.fn().mockResolvedValue(undefined),
  changePassword: vi.fn().mockResolvedValue(undefined),
  updateCurrentUserProfile: vi.fn().mockResolvedValue(undefined),
  saveUserCompat: vi.fn().mockResolvedValue(undefined),
  saveRoleCompat: vi.fn().mockResolvedValue(undefined),
  deleteRole: vi.fn().mockResolvedValue(undefined),
  deactivateUser: vi.fn().mockResolvedValue(undefined),
  reactivateUser: vi.fn().mockResolvedValue(undefined),
  anonymizeUser: vi.fn().mockResolvedValue(undefined),
  saveDeck: vi.fn().mockResolvedValue(undefined),
  deleteDeck: vi.fn().mockResolvedValue(undefined),
  upsertSettings: vi.fn().mockResolvedValue(undefined),
  validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  updateRoomAutoOpenJiraUrl: vi.fn().mockResolvedValue(undefined),
  updateRoomHighlightMode: vi.fn().mockResolvedValue(undefined),
  updateRoomQueueSort: vi.fn().mockResolvedValue(undefined),
  updateIssueJiraDeliveryStatus: vi.fn().mockResolvedValue(undefined),
  convertUserToEntra: vi.fn().mockResolvedValue(undefined),
  syncEntraUser: vi.fn().mockResolvedValue(undefined),
  syncActiveDirectoryUser: vi.fn().mockResolvedValue(undefined),
  cancelUserEntraMigration: vi.fn().mockResolvedValue(undefined),
  cancelAllPendingEntraMigrations: vi.fn().mockResolvedValue(undefined),
  prepareUserForEntraMigration: vi.fn().mockResolvedValue(undefined),
  noteUserEntraMigrationPrompt: vi.fn().mockResolvedValue(undefined),
  deactivateActiveDirectoryUserByExternalId: vi.fn().mockResolvedValue(undefined),
  deactivateUserForEntraAccessLoss: vi.fn().mockResolvedValue(undefined),
  resolveRoleNamesForAdGroups: vi.fn().mockResolvedValue([]),
  resolveRoleNamesForEntraClaims: vi.fn().mockResolvedValue([]),
  compareReleaseVersions: vi.fn().mockReturnValue(0),
  anonymizeDeactivatedUsersForScheduledTask: vi.fn().mockResolvedValue(undefined),
  closeRoomsForScheduledTask: vi.fn().mockResolvedValue(undefined),
  closeInactiveSessionsForScheduledTask: vi.fn().mockResolvedValue(undefined),
  markScheduledTaskRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./bootstrap-config.js", () => ({
  readBootstrapConfig: vi.fn().mockReturnValue({ recoveryAdminEnabled: false }),
  shouldSeedDemoData: vi.fn().mockReturnValue(false),
  validateBootstrapConfig: vi.fn().mockReturnValue([]),
}));

vi.mock("./update-repository.js", () => ({
  resolveUpdateRepository: vi.fn().mockReturnValue("test/sprinto"),
  parseGitHubRepositoryFromRemote: vi.fn().mockReturnValue(""),
}));

vi.mock("./ad.js", () => ({
  authenticateAgainstActiveDirectory: vi.fn().mockResolvedValue(null),
  listActiveDirectoryUsers: vi.fn().mockResolvedValue([]),
  testActiveDirectoryConnection: vi.fn().mockResolvedValue({ success: true }),
  validateActiveDirectorySettings: vi.fn().mockReturnValue([]),
}));

vi.mock("./entra.js", () => ({
  createEntraLoginRequest: vi.fn().mockReturnValue({ state: "s", nonce: "n", codeVerifier: "cv", returnToPath: "/", authorizationUrl: "https://login.microsoftonline.com/test" }),
  exchangeEntraAuthorizationCode: vi.fn().mockResolvedValue(null),
  fetchEntraGroupIds: vi.fn().mockResolvedValue([]),
  fetchEntraPhotoDataUrl: vi.fn().mockResolvedValue(null),
  resolveEntraIdentityFromClaims: vi.fn().mockReturnValue(null),
  resolveEntraLogoutUrl: vi.fn().mockReturnValue(""),
  resolveEntraPostLoginRedirectUrl: vi.fn().mockReturnValue("/"),
  sanitizeEntraReturnToPath: vi.fn().mockImplementation((p) => p || "/"),
  validateEntraSettings: vi.fn().mockReturnValue([]),
  verifyEntraIdToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("./login-flow.js", () => ({
  hasEnabledAuthProvider: vi.fn().mockReturnValue(true),
  hasPasswordAuthProvider: vi.fn().mockReturnValue(true),
  isActiveDirectoryEnabled: vi.fn().mockReturnValue(false),
  isEntraAuthEnabled: vi.fn().mockReturnValue(false),
  isLocalAuthEnabled: vi.fn().mockReturnValue(true),
  resolveAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("./jira.js", () => ({
  applyJiraEstimate: vi.fn().mockResolvedValue(undefined),
  assignJiraIssue: vi.fn().mockResolvedValue(undefined),
  buildJiraWorklogReport: vi.fn().mockResolvedValue({ rows: [] }),
  createIssueReportComment: vi.fn().mockReturnValue({}),
  createSimplePdfBuffer: vi.fn().mockResolvedValue(Buffer.from("")),
  getJiraBoard: vi.fn().mockResolvedValue(null),
  listJiraAssignableUsers: vi.fn().mockResolvedValue([]),
  getJiraStatuses: vi.fn().mockResolvedValue([]),
  listJiraBoards: vi.fn().mockResolvedValue([]),
  listJiraIssueLinkTypes: vi.fn().mockResolvedValue([]),
  listJiraIssues: vi.fn().mockResolvedValue([]),
  listJiraSprints: vi.fn().mockResolvedValue([]),
  listJiraWorklogUsers: vi.fn().mockResolvedValue([]),
  searchJiraWorklogIssues: vi.fn().mockResolvedValue([]),
  getJiraWorklogIssue: vi.fn().mockResolvedValue(null),
  postJiraIssueReport: vi.fn().mockResolvedValue(undefined),
  testJiraConnection: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("sharp", () => ({
  default: vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("")),
  }),
}));

// Import app after all mocks are set up
const { app } = await import("./server.js");
const {
  getUserBySession, createRoom, getDashboardCompat, logAudit, createSession,
  getSettings, getRoomSnapshot,
  updateRoomQueueSort, renameRoom, deleteRoom, closeRoom, joinRoom,
  addQueueIssue, deleteQueueIssue, castVote, revealIssue, cancelActiveIssue,
  upsertSettings,
} = await import("./store.js");
const { resolveAuthenticatedUser } = await import("./login-flow.js");

describe("server routes", () => {
  beforeEach(() => {
    vi.mocked(getUserBySession).mockResolvedValue(null);
    vi.mocked(getDashboardCompat).mockResolvedValue([]);
    vi.mocked(createRoom).mockResolvedValue("room-new");
    vi.mocked(createSession).mockResolvedValue("new-session-token");
    vi.mocked(resolveAuthenticatedUser).mockResolvedValue(null);
    vi.mocked(getSettings).mockResolvedValue(mockSettings as any);
    vi.mocked(getRoomSnapshot).mockResolvedValue(null);
  });

  describe("auth middleware", () => {
    it("returns 401 on protected route without a session", async () => {
      const res = await request(app).get("/api/rooms");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("returns 401 for /api/auth/me without session", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("passes through with a valid session token in Bearer header", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .get("/api/rooms")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(200);
    });

    it("passes through with a valid session cookie", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .get("/api/rooms")
        .set("Cookie", "sprinto_session=valid-token");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/settings", () => {
    it("returns settings without auth", async () => {
      const res = await request(app).get("/api/settings");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ localAuthEnabled: true });
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns 401 when credentials are invalid", async () => {
      vi.mocked(resolveAuthenticatedUser).mockResolvedValue(null);
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "alice", password: "wrong" });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Login failed/);
    });

    it("returns 200 with token on successful login", async () => {
      vi.mocked(resolveAuthenticatedUser).mockResolvedValue(mockRegularUser);
      vi.mocked(createSession).mockResolvedValue("generated-token");
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "alice", password: "correct" });
      expect(res.status).toBe(200);
      expect(res.body.token).toBe("generated-token");
      expect(res.body.user).toMatchObject({ id: "user-1" });
    });

    it("sets a session cookie on successful login", async () => {
      vi.mocked(resolveAuthenticatedUser).mockResolvedValue(mockRegularUser);
      vi.mocked(createSession).mockResolvedValue("cookie-token");
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "alice", password: "correct" });
      const setCookie = res.headers["set-cookie"] as string[] | string;
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      expect(cookies.some((c) => c.includes("sprinto_session=cookie-token"))).toBe(true);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns current user when authenticated", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: "user-1", username: "alice" });
    });
  });

  describe("GET /api/rooms", () => {
    it("returns room list for authenticated user", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      vi.mocked(getDashboardCompat).mockResolvedValue([
        { id: "r1", name: "Sprint 1" },
      ] as any);
      const res = await request(app)
        .get("/api/rooms")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(200);
      expect(res.body.rooms).toHaveLength(1);
      expect(res.body.rooms[0].name).toBe("Sprint 1");
    });
  });

  describe("POST /api/rooms", () => {
    it("returns 400 when room name is missing", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms")
        .set("Authorization", "Bearer valid-token")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Room name is required/);
    });

    it("creates a room and returns its id", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      vi.mocked(createRoom).mockResolvedValue("room-xyz");
      const res = await request(app)
        .post("/api/rooms")
        .set("Authorization", "Bearer valid-token")
        .send({ name: "New Sprint", deckName: "Fibonacci" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("room-xyz");
    });

    it("returns 403 when user lacks create_room permission", async () => {
      vi.mocked(getUserBySession).mockResolvedValue({
        ...mockRegularUser,
        permissions: ["vote"],
      });
      const res = await request(app)
        .post("/api/rooms")
        .set("Authorization", "Bearer valid-token")
        .send({ name: "Forbidden Room" });
      expect(res.status).toBe(403);
    });

    it("passes defaultIssueSort from settings to createRoom", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      vi.mocked(getSettings).mockResolvedValue({ ...mockSettings, defaultIssueSort: "priority" } as any);
      vi.mocked(createRoom).mockResolvedValue("room-sort-test");
      await request(app)
        .post("/api/rooms")
        .set("Authorization", "Bearer valid-token")
        .send({ name: "Priority Sprint" });
      expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ queueSort: "priority" }));
    });

    it("falls back to 'issue' sort when defaultIssueSort is not configured", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      vi.mocked(getSettings).mockResolvedValue({ ...mockSettings, defaultIssueSort: undefined } as any);
      vi.mocked(createRoom).mockResolvedValue("room-sort-default");
      await request(app)
        .post("/api/rooms")
        .set("Authorization", "Bearer valid-token")
        .send({ name: "Default Sprint" });
      expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ queueSort: "issue" }));
    });
  });

  describe("GET /api/admin/overview", () => {
    it("returns 403 for a non-admin user", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .get("/api/admin/overview")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(403);
    });

    it("returns overview data for admin user", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      vi.mocked(await import("./store.js") as any).getAdminOverviewCompat.mockResolvedValue({ users: [{ id: "u1" }], rooms: [] });
      const res = await request(app)
        .get("/api/admin/overview")
        .set("Authorization", "Bearer admin-token");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/rooms/:roomId", () => {
    it("returns 404 when room does not exist", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      vi.mocked(await import("./store.js") as any).getRoomSnapshot.mockResolvedValue(null);
      const res = await request(app)
        .get("/api/rooms/nonexistent")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(404);
    });

    it("returns room snapshot when found", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      vi.mocked(await import("./store.js") as any).getRoomSnapshot.mockResolvedValue({ room: { id: "r1", name: "Sprint 1" } });
      const res = await request(app)
        .get("/api/rooms/r1")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(200);
      expect(res.body.room.name).toBe("Sprint 1");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("clears the session cookie on logout", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(200);
      const setCookie = res.headers["set-cookie"] as string[] | string;
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      expect(cookies.some((c) => c.includes("sprinto_session=;") || c.includes("sprinto_session="))).toBe(true);
    });
  });

  describe("POST /api/rooms/:roomId/queue-sort", () => {
    it("updates queue sort for a room manager", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      const res = await request(app)
        .post("/api/rooms/room-1/queue-sort")
        .set("Authorization", "Bearer admin-token")
        .send({ queueSort: "priority" });
      expect(res.status).toBe(200);
      expect(updateRoomQueueSort).toHaveBeenCalledWith("room-1", "priority");
    });

    it("returns 403 when user cannot manage the room", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms/room-1/queue-sort")
        .set("Authorization", "Bearer valid-token")
        .send({ queueSort: "priority" });
      expect(res.status).toBe(403);
    });

    it("returns 401 without authentication", async () => {
      const res = await request(app)
        .post("/api/rooms/room-1/queue-sort")
        .send({ queueSort: "priority" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/rooms/:roomId/rename", () => {
    it("renames the room for a user with canRenameRoom", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      vi.mocked(renameRoom).mockResolvedValue("Renamed Sprint" as any);
      const res = await request(app)
        .post("/api/rooms/room-1/rename")
        .set("Authorization", "Bearer admin-token")
        .send({ name: "Renamed Sprint" });
      expect(res.status).toBe(200);
      expect(renameRoom).toHaveBeenCalledWith("room-1", "Renamed Sprint", undefined);
    });

    it("returns 403 when user lacks rename permission", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms/room-1/rename")
        .set("Authorization", "Bearer valid-token")
        .send({ name: "Fail" });
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/rooms/:roomId", () => {
    it("deletes the room for a user with canDeleteRoom", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      const res = await request(app)
        .delete("/api/rooms/room-1")
        .set("Authorization", "Bearer admin-token");
      expect(res.status).toBe(200);
      expect(deleteRoom).toHaveBeenCalledWith("room-1");
    });

    it("returns 403 when user lacks delete permission", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .delete("/api/rooms/room-1")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/rooms/:roomId/close", () => {
    it("closes the room for a room manager", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      const res = await request(app)
        .post("/api/rooms/room-1/close")
        .set("Authorization", "Bearer admin-token");
      expect(res.status).toBe(200);
      expect(closeRoom).toHaveBeenCalledWith("room-1");
    });

    it("returns 403 when user cannot manage the room", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms/room-1/close")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/rooms/:roomId/join", () => {
    it("allows any authenticated user to join a room", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms/room-1/join")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(200);
      expect(joinRoom).toHaveBeenCalledWith("room-1", mockRegularUser.id);
    });

    it("returns 401 without authentication", async () => {
      const res = await request(app).post("/api/rooms/room-1/join");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/rooms/:roomId/queue", () => {
    it("adds an issue to the queue for a room manager", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      vi.mocked(addQueueIssue).mockResolvedValue("issue-new" as any);
      const res = await request(app)
        .post("/api/rooms/room-1/queue")
        .set("Authorization", "Bearer admin-token")
        .send({ title: "PROJ-1 New issue" });
      expect(res.status).toBe(200);
      expect(addQueueIssue).toHaveBeenCalledWith("room-1", "PROJ-1 New issue", "manual");
    });

    it("returns 400 when title is empty", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      const res = await request(app)
        .post("/api/rooms/room-1/queue")
        .set("Authorization", "Bearer admin-token")
        .send({ title: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Title is required/);
    });

    it("returns 403 when user cannot manage the room", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms/room-1/queue")
        .set("Authorization", "Bearer valid-token")
        .send({ title: "PROJ-1 New issue" });
      expect(res.status).toBe(403);
    });

    it("composes storyId and title when storyId is provided", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      vi.mocked(addQueueIssue).mockResolvedValue("issue-composed" as any);
      await request(app)
        .post("/api/rooms/room-1/queue")
        .set("Authorization", "Bearer admin-token")
        .send({ storyId: "PROJ-1", title: "New feature" });
      expect(addQueueIssue).toHaveBeenCalledWith("room-1", "PROJ-1 - New feature", "manual");
    });
  });

  describe("DELETE /api/rooms/:roomId/queue/:issueId", () => {
    it("removes an issue from the queue for a room manager", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      const res = await request(app)
        .delete("/api/rooms/room-1/queue/issue-1")
        .set("Authorization", "Bearer admin-token");
      expect(res.status).toBe(200);
      expect(deleteQueueIssue).toHaveBeenCalledWith("room-1", "issue-1");
    });

    it("returns 403 when user cannot manage the room", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .delete("/api/rooms/room-1/queue/issue-1")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/rooms/:roomId/vote", () => {
    it("casts a vote for a user with vote permission", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms/room-1/vote")
        .set("Authorization", "Bearer valid-token")
        .send({ value: "5" });
      expect(res.status).toBe(200);
      expect(castVote).toHaveBeenCalled();
    });

    it("returns 403 when user cannot vote", async () => {
      vi.mocked(getUserBySession).mockResolvedValue({ ...mockRegularUser, permissions: ["create_room"] });
      const res = await request(app)
        .post("/api/rooms/room-1/vote")
        .set("Authorization", "Bearer valid-token")
        .send({ value: "5" });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/rooms/:roomId/reveal", () => {
    it("reveals votes for a room manager", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      const res = await request(app)
        .post("/api/rooms/room-1/reveal")
        .set("Authorization", "Bearer admin-token");
      expect(res.status).toBe(200);
      expect(revealIssue).toHaveBeenCalledWith("room-1", mockAdminUser.id);
    });

    it("returns 403 when user cannot manage the room", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms/room-1/reveal")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/rooms/:roomId/cancel-issue", () => {
    it("cancels the active issue for a room manager", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      const res = await request(app)
        .post("/api/rooms/room-1/cancel-issue")
        .set("Authorization", "Bearer admin-token");
      expect(res.status).toBe(200);
      expect(cancelActiveIssue).toHaveBeenCalledWith("room-1");
    });

    it("returns 403 when user cannot manage the room", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms/room-1/cancel-issue")
        .set("Authorization", "Bearer valid-token");
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/admin/settings/rooms", () => {
    it("saves room settings for admin with room settings permission", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      const res = await request(app)
        .put("/api/admin/settings/rooms")
        .set("Authorization", "Bearer admin-token")
        .send({ defaultIssueSort: "priority" });
      expect(res.status).toBe(200);
      expect(upsertSettings).toHaveBeenCalled();
    });

    it("returns 403 when user lacks manage_room_settings permission", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .put("/api/admin/settings/rooms")
        .set("Authorization", "Bearer valid-token")
        .send({ defaultIssueSort: "priority" });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/rooms/:roomId/start", () => {
    it("starts a queued issue for a room manager", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockAdminUser);
      const res = await request(app)
        .post("/api/rooms/room-1/start")
        .set("Authorization", "Bearer admin-token")
        .send({ issueId: "issue-1" });
      expect(res.status).toBe(200);
    });

    it("returns 403 when user cannot manage the room", async () => {
      vi.mocked(getUserBySession).mockResolvedValue(mockRegularUser);
      const res = await request(app)
        .post("/api/rooms/room-1/start")
        .set("Authorization", "Bearer valid-token")
        .send({ issueId: "issue-1" });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/settings", () => {
    it("includes defaultIssueSort in public settings", async () => {
      const res = await request(app).get("/api/settings");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("defaultIssueSort");
    });
  });
});
