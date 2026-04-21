import { useEffect, useRef, useState } from "react";
import { AdminPanel } from "./components/AdminPanel";
import { Dashboard } from "./components/Dashboard";
import { LoginScreen } from "./components/LoginScreen";
import { RoomView } from "./components/RoomView";
import { UserSettings } from "./components/UserSettings";
import { WorklogView } from "./components/WorklogView";
import { normalizeTheme, readStoredThemePreference, THEME_STORAGE_KEY } from "./lib/theme";
import {
  assignJiraIssueAssignee,
  changePassword,
  closeRoom,
  connectRoom,
  createDeck,
  createRole,
  createRoomWithDeck,
  createUser,
  anonymizeUser,
  beginMicrosoftEntraLogin,
  checkForUpdates,
  cancelUserEntraMigration,
  deactivateUser,
  deleteDeck,
  deleteQueuedIssue,
  deleteRoom,
  deleteRole,
  getJiraWorklogIssue,
  getJiraWorklogIssues,
  getJiraWorklogReport,
  getJiraWorklogUsers,
  getAdminOverview,
  getRoom,
  getSettings,
  importJiraIssues,
  listJiraAssignableUsers,
  listJiraBoards,
  listJiraSprints,
  joinRoom,
  leaveRoom,
  leaveRoomKeepalive,
  listDecks,
  listRooms,
  login,
  logout,
  me,
  queueIssue,
  resetRoom,
  reveal,
  reactivateUser,
  revokeSession,
  runScheduledTask,
  setToken,
  startQueuedIssue,
  testJiraIntegration,
  testActiveDirectorySettings,
  updateAdminIntegrationSettings,
  updateMyProfile,
  updateAdminSettings,
  updateAdminUpdateSettings,
  updateAdminRoomSettings,
  updateDeck,
  updateRoomHighlightMode,
  updateQueuedIssue,
  updateRole,
  updateUser,
  updateUserRoles,
  vote,
  applyJiraIssueEstimate,
  postJiraIssueReport,
  previewJiraIssues,
  prepareUserEntraMigration,
} from "./lib/api";
import { type ActiveDirectoryTestResult, AdminOverview, Deck, JiraImportFilters, RoomEvent, RoomSnapshot, RoomSummary, SettingsOverview, ThemeId, User } from "./lib/types";

type View = "dashboard" | "room" | "admin" | "worklog";
type RouteState = { view: View; roomId: string | null };
const COPYRIGHT_START_YEAR = 2026;

function faviconVersionKey(dataUrl: string) {
  let hash = 0;
  for (let i = 0; i < dataUrl.length; i += 1) {
    hash = (hash * 31 + dataUrl.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function syncFavicon(dataUrl: string) {
  const head = document.head;
  if (!head) {
    return;
  }

  const selectors = [
    "link[rel='icon']",
    "link[rel='shortcut icon']",
    "link[rel='apple-touch-icon']"
  ];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((node) => node.remove());
  }

  if (!dataUrl) {
    return;
  }

  const cacheBustedHref = `/branding/favicon?v=${faviconVersionKey(dataUrl)}`;
  const rels = ["icon", "shortcut icon", "apple-touch-icon"];

  for (const rel of rels) {
    const link = document.createElement("link");
    link.setAttribute("rel", rel);
    link.setAttribute("href", cacheBustedHref);
    head.appendChild(link);
  }
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState(() => readAuthErrorFromLocation());
  const [authNotice, setAuthNotice] = useState("");
  const [previewTheme, setPreviewTheme] = useState<ThemeId | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [settings, setSettings] = useState<SettingsOverview | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const routeRef = useRef<RouteState>(routeFromLocation());
  const canAccessAdmin = hasAdminAccess(user);
  const canManageUpdates = user?.permissions.includes("manage_updates") || false;
  const jiraIntegrationEnabled = settings?.integrations?.jira?.enabled ?? overview?.settings.integrations.jira.enabled ?? false;
  const canViewWorklog = (user?.permissions.includes("worklog_view") || false) && jiraIntegrationEnabled;
  const effectiveSettings = settings || overview?.settings || null;
  const brandLogo = settings?.logoDataUrl || "";
  const footerCurrentVersion = effectiveSettings?.currentVersion || "";
  const footerUpdateVersion = effectiveSettings?.updateLatestVersion || "";
  const footerUpdateUrl = effectiveSettings?.updateLatestReleaseUrl || "";
  const showFooterUpdateNotice = canManageUpdates && Boolean(effectiveSettings?.updateAvailable && footerUpdateVersion);
  const showFooterCurrentVersion = canManageUpdates && !showFooterUpdateNotice && Boolean(footerCurrentVersion);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (authError) {
      clearAuthErrorFromLocation();
    }
  }, [authError]);

  useEffect(() => {
    document.title = "Sprinto";
    syncFavicon(settings?.faviconDataUrl || "");
  }, [settings?.faviconDataUrl]);

  useEffect(() => {
    const nextTheme = normalizeTheme(previewTheme ?? user?.theme ?? readStoredThemePreference());
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme === "timero" ? "light" : "dark";
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }, [previewTheme, user?.theme]);

  useEffect(() => {
    function handlePopState() {
      void applyRoute(routeFromLocation(), false);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [user, activeRoomId]);

  useEffect(() => {
    if (user === null && !settings) {
      const loadSettings = async () => {
        try {
          const appSettings = await getSettings();
          setSettings(appSettings);
        } catch {
          setSettings(null);
        }
      };
      void loadSettings();
    }
  }, [user, settings]);

  useEffect(() => {
    if (!user || !canManageUpdates) {
      return;
    }

    async function refreshVisibleSettings() {
      try {
        const nextSettings = await getSettings();
        setSettings(nextSettings);
      } catch {
      }
    }

    const interval = window.setInterval(() => {
      void refreshVisibleSettings();
    }, 60000);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshVisibleSettings();
      }
    }

    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user, canManageUpdates]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (view !== "room" || !activeRoomId) {
      socketRef.current?.close();
      socketRef.current = null;
      if (view !== "room") {
        setSnapshot(null);
      }
      return;
    }

    void loadRoom(activeRoomId);
    const socket = connectRoom(activeRoomId, handleRoomEvent);
    socketRef.current = socket;

    return () => {
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [activeRoomId, view, user]);

  useEffect(() => {
    if (view !== "room" || !activeRoomId) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadRoom(activeRoomId);
      void refreshRooms();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [activeRoomId, view]);

  useEffect(() => {
    if (view !== "dashboard") {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshRooms();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [view]);

  useEffect(() => {
    if (view !== "room" || !activeRoomId || !user) {
      return;
    }

    const roomId = activeRoomId;
    const userId = user.id;

    function handlePageExit() {
      leaveRoomKeepalive(roomId, userId);
      socketRef.current?.close();
      socketRef.current = null;
    }

    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);
    return () => {
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
    };
  }, [activeRoomId, user, view]);

  async function bootstrap() {
    try {
      try {
        const appSettings = await getSettings();
        setSettings(appSettings);
      } catch {
        setSettings(null);
      }

      const current = await me();
      setUser(current);
      await refreshRooms();
      try {
        setDecks(await listDecks());
      } catch {
        setDecks([]);
      }
      if (hasAdminAccess(current)) {
        try {
          setOverview(await getAdminOverview());
        } catch {
          setOverview(null);
        }
      } else {
        setOverview(null);
      }
      await applyRoute(routeFromLocation(), false, current);
    } catch {
      setToken(null);
      setUser(null);
      setOverview(null);
      setDecks([]);
      routeRef.current = routeFromLocation();
    }
  }

  async function refreshRooms() {
    setRooms(await listRooms());
  }

  async function loadRoom(roomId: string) {
    setSnapshot(await getRoom(roomId));
  }

  async function openRoom(roomId: string, options?: { replace?: boolean; skipJoin?: boolean; currentUser?: User | null }) {
    const currentUser = options?.currentUser ?? user;
    if (!currentUser) {
      return;
    }

    if (activeRoomId && activeRoomId !== roomId) {
      await handleLeaveActiveRoom();
    }

    if (!options?.skipJoin || activeRoomId !== roomId || !snapshot) {
      const joined = await joinRoom(roomId, currentUser.id, currentUser.displayName);
      setSnapshot(joined);
    }
    setActiveRoomId(roomId);
    setView("room");
    updateRoute({ view: "room", roomId }, options?.replace);
  }

  function handleRoomEvent(event: RoomEvent) {
    if (event.type === "room.updated" && event.data && event.data.room.id === activeRoomId) {
      setSnapshot(event.data);
      void refreshRooms();
      return;
    }

    if (event.type === "room.deleted" && event.roomId === activeRoomId) {
      setSnapshot(null);
      setActiveRoomId(null);
      setView("dashboard");
      updateRoute({ view: "dashboard", roomId: null }, true);
      void refreshRooms();
    }
  }

  async function handleLogin(username: string, password: string, method: "username" | "email" | "both" = "username") {
    const response = await login(username, password, method);
    setAuthError("");
    setAuthNotice(response.authNotice || "");
    setToken(response.token);
    setUser(response.user);
    await refreshRooms();
    try {
      setDecks(await listDecks());
    } catch {
      setDecks([]);
    }
    if (hasAdminAccess(response.user)) {
      try {
        setOverview(await getAdminOverview());
      } catch {
        setOverview(null);
      }
    } else {
      setOverview(null);
    }
    await applyRoute(routeRef.current, true, response.user);
    setUserMenuOpen(false);
  }

  async function handleLogout() {
    try {
      await handleLeaveActiveRoom();
      const result = await logout();
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
    } finally {
      setToken(null);
      setUser(null);
      setAuthNotice("");
      setOverview(null);
      setDecks([]);
      setRooms([]);
      setSnapshot(null);
      setActiveRoomId(null);
      setView("dashboard");
      updateRoute({ view: "dashboard", roomId: null }, true);
      setUserMenuOpen(false);
      try {
        const appSettings = await getSettings();
        setSettings(appSettings);
      } catch {
        setSettings(null);
      }
    }
  }

  function handleMicrosoftEntraSignIn() {
    setAuthError("");
    beginMicrosoftEntraLogin(`${window.location.pathname}${window.location.search}`);
  }

  async function handleCreateRoom(name: string, deckName: string) {
    const room = await createRoomWithDeck(name, "", deckName);
    await refreshRooms();
    await openRoom(room.id);
  }

  async function handleLeaveActiveRoom() {
    if (!activeRoomId || !user) {
      return;
    }

    try {
      await leaveRoom(activeRoomId, user.id);
    } catch {
    } finally {
      socketRef.current?.close();
      socketRef.current = null;
      setSnapshot(null);
      setActiveRoomId(null);
      await refreshRooms();
    }
  }

  async function handleVote(userId: string, value: string) {
    if (!activeRoomId) {
      return;
    }
    const next = await vote(activeRoomId, userId || user?.id || "guest-user", value);
    setSnapshot(next);
    await refreshRooms();
  }

  async function handleReveal() {
    if (!activeRoomId) {
      return;
    }
    const next = await reveal(activeRoomId);
    setSnapshot(next);
    await refreshRooms();
  }

  async function handleReset(storyTitle: string) {
    if (!activeRoomId) {
      return;
    }
    const next = await resetRoom(activeRoomId, storyTitle);
    setSnapshot(next);
    await refreshRooms();
  }

  async function handleCloseRoom() {
    if (!activeRoomId) {
      return;
    }
    const next = await closeRoom(activeRoomId);
    setSnapshot(next);
    await refreshRooms();
  }

  async function handleUpdateRoomHighlightMode(highlightMode: "none" | "most-frequent" | "highest") {
    if (!activeRoomId) {
      return;
    }
    const next = await updateRoomHighlightMode(activeRoomId, highlightMode);
    setSnapshot(next);
  }

  async function handleQueueIssue(title: string, storyId = "") {
    if (!activeRoomId) {
      return;
    }
    const next = await queueIssue(activeRoomId, title, storyId);
    setSnapshot(next);
    await refreshRooms();
  }

  async function handleStartQueuedIssue(issueId: string) {
    if (!activeRoomId) {
      return;
    }
    const next = await startQueuedIssue(activeRoomId, issueId);
    setSnapshot(next);
    await refreshRooms();
  }

  async function handleUpdateQueuedIssue(issueId: string, title: string, storyId = "", source = "manual") {
    if (!activeRoomId) {
      return;
    }
    const next = await updateQueuedIssue(activeRoomId, issueId, title, storyId, source);
    setSnapshot(next);
    await refreshRooms();
  }

  async function handleDeleteQueuedIssue(issueId: string) {
    if (!activeRoomId) {
      return;
    }
    const next = await deleteQueuedIssue(activeRoomId, issueId);
    setSnapshot(next);
    await refreshRooms();
  }

  async function handleSaveSettings(settings: AdminOverview["settings"]) {
    const next = await updateAdminSettings(settings);
    setOverview(next);
    setSettings(next.settings);
  }

  async function handleSaveRoomSettings(settings: AdminOverview["settings"]) {
    const next = await updateAdminRoomSettings(settings);
    setOverview(next);
    setSettings(next.settings);
  }

  async function handleSaveUpdateSettings(settings: AdminOverview["settings"]) {
    const next = await updateAdminUpdateSettings(settings);
    setOverview(next);
    setSettings(next.settings);
  }

  async function handleSaveIntegrationSettings(payload: { jira: SettingsOverview["integrations"]["jira"] }) {
    const next = await updateAdminIntegrationSettings(payload);
    setOverview(next);
    setSettings(next.settings);
  }

  async function handleCheckForUpdates() {
    const next = await checkForUpdates();
    setOverview(next);
    setSettings(next.settings);
  }

  async function handleTestActiveDirectory(settings: SettingsOverview, testIdentifier: string): Promise<ActiveDirectoryTestResult> {
    return testActiveDirectorySettings(settings, testIdentifier);
  }

  async function handleTestJira(settings: SettingsOverview["integrations"]["jira"]) {
    return testJiraIntegration({ jira: settings });
  }

  async function handleRunScheduledTask(taskKey: string) {
    const result = await runScheduledTask(taskKey);
    setOverview(result.overview);
    setSettings(result.overview.settings);
    return result.message;
  }

  async function refreshAdminOverview() {
    if (!user || !hasAdminAccess(user)) {
      return null;
    }
    try {
      const nextOverview = await getAdminOverview();
      setOverview(nextOverview);
      setSettings(nextOverview.settings);
      return nextOverview;
    } catch {
      return null;
    }
  }

  async function refreshCurrentUser() {
    try {
      const current = await me();
      setUser(current);
      return current;
    } catch {
      return user;
    }
  }

  async function handleUpdateUserRoles(userId: string, roles: string[]) {
    const next = await updateUserRoles(userId, roles);
    setOverview(next);
    await refreshCurrentUser();
  }

  async function handleRevokeSession(token: string) {
    const next = await revokeSession(token);
    setOverview(next);
  }

  async function handleCreateDeck(name: string, values: string[]) {
    const next = await createDeck(name, values);
    setOverview(next);
    setDecks(next.decks);
  }

  async function handleUpdateDeck(deckId: string, name: string, values: string[]) {
    const next = await updateDeck(deckId, name, values);
    setOverview(next);
    setDecks(next.decks);
  }

  async function handleDeleteDeck(deckId: string) {
    const next = await deleteDeck(deckId);
    setOverview(next);
    setDecks(next.decks);
  }

  async function handleCreateUser(payload: {
    username: string;
    displayName: string;
    email: string;
    authSource: string;
    password: string;
    avatarDataUrl?: string;
    roles: string[];
  }) {
    const { overview: next, userId } = await createUser(payload);
    setOverview(next);
    return next.users.find((entry) => entry.id === userId) || null;
  }

  async function handleUpdateUser(userId: string, payload: {
    displayName: string;
    email: string;
    authSource: string;
    password?: string;
    avatarDataUrl?: string;
    roles: string[];
  }) {
    const next = await updateUser(userId, payload);
    setOverview(next);
    await refreshCurrentUser();
  }

  async function handleCreateRole(payload: {
    name: string;
    description: string;
    adGroupName: string;
    entraAppRoleValue: string;
    entraGroupId: string;
    permissions: string[];
  }) {
    const next = await createRole(payload);
    setOverview(next);
  }

  async function handleUpdateRole(roleId: string, payload: {
    name: string;
    description: string;
    adGroupName: string;
    entraAppRoleValue: string;
    entraGroupId: string;
    permissions: string[];
  }) {
    const next = await updateRole(roleId, payload);
    setOverview(next);
    await refreshCurrentUser();
  }

  async function handleDeactivateUser(userId: string) {
    const next = await deactivateUser(userId);
    setOverview(next);
  }

  async function handleReactivateUser(userId: string, payload: {
    username: string;
    displayName: string;
    email: string;
    password: string;
    avatarDataUrl?: string;
    roles: string[];
  }) {
    const next = await reactivateUser(userId, payload);
    setOverview(next);
  }

  async function handleAnonymizeUser(userId: string) {
    const next = await anonymizeUser(userId);
    setOverview(next);
  }

  async function handlePrepareUserEntraMigration(userId: string, payload: { forceAt?: string | null }) {
    const next = await prepareUserEntraMigration(userId, payload);
    setOverview(next);
  }

  async function handleCancelUserEntraMigration(userId: string) {
    const next = await cancelUserEntraMigration(userId);
    setOverview(next);
  }

  async function handleDeleteRole(roleId: string) {
    const next = await deleteRole(roleId);
    setOverview(next);
  }

  async function handleUpdateMyProfile(payload: { displayName: string; avatarDataUrl: string; theme: ThemeId }) {
    const nextUser = await updateMyProfile(payload);
    setPreviewTheme(null);
    setUser(nextUser);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextUser.theme);
    setOverview((current) =>
      current
        ? {
            ...current,
            users: current.users.map((entry) => (entry.id === nextUser.id ? { ...entry, ...nextUser } : entry)),
          }
        : current
    );
  }

  async function handleUpdateTheme(theme: ThemeId) {
    if (!user) {
      return;
    }

    const nextUser = await updateMyProfile({ theme });
    setPreviewTheme(null);
    setUser(nextUser);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextUser.theme);
    setOverview((current) =>
      current
        ? {
            ...current,
            users: current.users.map((entry) => (entry.id === nextUser.id ? { ...entry, ...nextUser } : entry)),
          }
        : current
    );
  }

  async function handleDeleteCurrentRoom() {
    if (!activeRoomId) {
      return;
    }
    await deleteRoom(activeRoomId);
    await handleLeaveActiveRoom();
    setView("dashboard");
    updateRoute({ view: "dashboard", roomId: null }, true);
  }

  async function handleImportJiraIssues(
    roomId: string,
    payload: { boardId: string; sprintId?: string; filters: JiraImportFilters; reimportCompletedIssues?: boolean }
  ) {
    const result = await importJiraIssues(roomId, payload);
    setSnapshot(result.snapshot);
    await refreshRooms();
    return result;
  }

  async function handlePreviewJiraIssues(boardId: string, sprintId: string | undefined, filters: JiraImportFilters) {
    return previewJiraIssues(boardId, sprintId, filters);
  }

  async function handleFetchJiraAssignableUsers(roomId: string, issueId: string, query = "") {
    return listJiraAssignableUsers(roomId, issueId, query);
  }

  async function handleApplyJiraIssueEstimate(
    roomId: string,
    issueId: string,
    mode: "story-points" | "original-estimate" | "both",
    payload: { storyPointsValue?: number; originalEstimate?: string }
  ) {
    const next = await applyJiraIssueEstimate(roomId, issueId, { mode, ...payload });
    setSnapshot(next.snapshot);
    return next;
  }

  async function handleAssignJiraIssueAssignee(
    roomId: string,
    issueId: string,
    payload: { accountId?: string; displayName?: string }
  ) {
    const next = await assignJiraIssueAssignee(roomId, issueId, payload);
    setSnapshot(next.snapshot);
    return next;
  }

  async function handlePostJiraIssueReport(
    roomId: string,
    issueId: string,
    payload: { finalValue: string; includeComment?: boolean; includePdf?: boolean }
  ) {
    const next = await postJiraIssueReport(roomId, issueId, payload);
    setSnapshot(next.snapshot);
    return next;
  }

  async function applyRoute(route: RouteState, replace = false, currentUser = user) {
    routeRef.current = route;

    if (!currentUser) {
      return;
    }

    if (route.view === "admin" && hasAdminAccess(currentUser)) {
      if (activeRoomId) {
        await handleLeaveActiveRoom();
      }
      try {
        const nextOverview = await getAdminOverview();
        setOverview(nextOverview);
        setSettings(nextOverview.settings);
      } catch {
      }
      setView("admin");
      updateRoute(route, replace);
      return;
    }

    if (route.view === "worklog" && currentUser.permissions.includes("worklog_view")) {
      if (activeRoomId) {
        await handleLeaveActiveRoom();
      }
      setView("worklog");
      updateRoute({ view: "worklog", roomId: null }, replace);
      return;
    }

    if (route.view === "room" && route.roomId) {
      await openRoom(route.roomId, {
        replace,
        skipJoin: activeRoomId === route.roomId && Boolean(snapshot),
        currentUser,
      });
      return;
    }

    if (activeRoomId) {
      await handleLeaveActiveRoom();
    }
    setView("dashboard");
    updateRoute({ view: "dashboard", roomId: null }, replace);
  }

  if (!user) {
    const passwordProvidersEnabled = Boolean(settings?.localAuthEnabled || settings?.activeDirectoryEnabled);
    const entraEnabled = Boolean(settings?.entraAuthEnabled);
    return (
      <LoginScreen
        onSubmit={handleLogin}
        onMicrosoftEntraSignIn={entraEnabled ? handleMicrosoftEntraSignIn : undefined}
        loginMethod={settings?.loginMethod as "username" | "email" | "both" | undefined}
        logoDataUrl={settings?.logoDataUrl}
        showPasswordForm
        defaultPasswordFormHidden={entraEnabled && !passwordProvidersEnabled}
        authError={authError}
      />
    );
  }

  const currentYear = new Date().getFullYear();
  const copyrightLabel =
    currentYear > COPYRIGHT_START_YEAR
      ? `${COPYRIGHT_START_YEAR} - ${currentYear}`
      : String(COPYRIGHT_START_YEAR);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="topbar__brand topbar__brand--button"
          onClick={() => void (async () => {
            await applyRoute({ view: "dashboard", roomId: null });
            setUserMenuOpen(false);
          })()}
          type="button"
        >
          {brandLogo ? (
            <img alt="Sprinto logo" className="brand-logo brand-logo--topbar" src={brandLogo} />
          ) : (
            <strong className="brand-text">SPRINTO</strong>
          )}
        </button>

        <nav className="topbar__nav">
          <button
            className={view === "dashboard" ? "is-active" : ""}
            onClick={() => void (async () => {
              await applyRoute({ view: "dashboard", roomId: null });
            })()}
            type="button"
          >
            Voting rooms
          </button>
          {canViewWorklog ? (
            <button
              className={view === "worklog" ? "is-active" : ""}
              onClick={() => void applyRoute({ view: "worklog", roomId: null })}
              type="button"
            >
              Jira Worklog
            </button>
          ) : null}
          <div className="user-menu" ref={userMenuRef}>
            <button
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              className="avatar-button"
              onClick={() => setUserMenuOpen((open) => !open)}
              type="button"
            >
              <span className="avatar-circle">
                {user.avatarDataUrl ? <img alt={user.displayName} src={user.avatarDataUrl} /> : initialsFor(user.displayName)}
              </span>
            </button>

            {userMenuOpen ? (
              <div className="user-dropdown card card--compact" role="menu">
                <div className="user-dropdown__profile">
                  <span className="avatar-circle avatar-circle--large">
                    {user.avatarDataUrl ? <img alt={user.displayName} src={user.avatarDataUrl} /> : initialsFor(user.displayName)}
                  </span>
                  <strong>{user.displayName}</strong>
                </div>
                <button
                  className="user-dropdown__action"
                  onClick={() => {
                    setUserSettingsOpen(true);
                    setUserMenuOpen(false);
                  }}
                  type="button"
                >
                  User settings
                </button>
                {canAccessAdmin ? (
                  <button
                    className={`user-dropdown__action ${view === "admin" ? "is-active" : ""}`}
                    onClick={() => void (async () => {
                      await applyRoute({ view: "admin", roomId: null });
                      setUserMenuOpen(false);
                    })()}
                    type="button"
                  >
                    Admin settings
                  </button>
                ) : null}
                <button className="user-dropdown__action" onClick={() => void handleLogout()} type="button">
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </nav>
      </header>

      {authNotice ? (
        <div className="app-auth-notice">
          <span>{authNotice}</span>
          <button className="ghost-button" onClick={() => setAuthNotice("")} type="button">Dismiss</button>
        </div>
      ) : null}

      <main className="app-main">
        {view === "admin" && canAccessAdmin ? (
          <AdminPanel
            onCreateRole={handleCreateRole}
            onCreateUser={handleCreateUser}
            onCreateDeck={handleCreateDeck}
            onDeactivateUser={handleDeactivateUser}
            onAnonymizeUser={handleAnonymizeUser}
            onPrepareUserEntraMigration={handlePrepareUserEntraMigration}
            onCancelUserEntraMigration={handleCancelUserEntraMigration}
            onDeleteDeck={handleDeleteDeck}
            onDeleteRole={handleDeleteRole}
            onReactivateUser={handleReactivateUser}
            onRevokeSession={handleRevokeSession}
            onSaveSettings={handleSaveSettings}
            onSaveUpdateSettings={handleSaveUpdateSettings}
            onCheckForUpdates={handleCheckForUpdates}
            onSaveRoomSettings={handleSaveRoomSettings}
            onSaveIntegrationSettings={handleSaveIntegrationSettings}
            onRunScheduledTask={handleRunScheduledTask}
            onTestActiveDirectory={handleTestActiveDirectory}
            onTestJira={handleTestJira}
            onUpdateRole={handleUpdateRole}
            onUpdateUser={handleUpdateUser}
            onUpdateDeck={handleUpdateDeck}
            onUpdateUserRoles={handleUpdateUserRoles}
            onRefreshOverview={refreshAdminOverview}
            overview={overview}
            user={user}
          />
        ) : null}

        {view === "dashboard" ? (
          <Dashboard
            canCreateRoom={user.permissions.includes("create_room")}
            decks={decks}
            rooms={rooms}
            onOpenRoom={(roomId) => {
              void openRoom(roomId);
            }}
            onCreateRoom={handleCreateRoom}
          />
        ) : null}

        {view === "worklog" && canViewWorklog ? (
          <WorklogView
            onLoadIssue={getJiraWorklogIssue}
            onLoadIssues={getJiraWorklogIssues}
            onLoadReport={getJiraWorklogReport}
            onLoadUsers={getJiraWorklogUsers}
          />
        ) : null}

        {view === "room" && activeRoomId && snapshot ? (
          <RoomView
            key={activeRoomId}
            canManageRound={
              user.permissions.includes("queue_issues") ||
              user.permissions.includes("reveal_votes") ||
              user.permissions.includes("close_poker")
            }
            canManageCardHighlight={user.permissions.includes("highlight_cards")}
            canViewHistory={user.permissions.includes("view_votes_of_others")}
            canDeleteRoom={user.permissions.includes("delete_room")}
            canImportJiraIssues={user.permissions.includes("jira_import_issues") && jiraIntegrationEnabled}
            canSendToJira={user.permissions.includes("jira_send") && jiraIntegrationEnabled}
            canVote={user.permissions.includes("vote")}
            currentUserId={user.id}
            jiraIntegration={settings?.integrations?.jira || overview?.settings.integrations.jira}
            onClose={handleCloseRoom}
            onDeleteQueuedIssue={handleDeleteQueuedIssue}
            onDeleteRoom={handleDeleteCurrentRoom}
            onApplyJiraIssueEstimate={(issueId, mode, payload) => handleApplyJiraIssueEstimate(activeRoomId, issueId, mode, payload)}
            onAssignJiraIssueAssignee={(issueId, payload) => handleAssignJiraIssueAssignee(activeRoomId, issueId, payload)}
            onFetchJiraAssignableUsers={(issueId, query) => handleFetchJiraAssignableUsers(activeRoomId, issueId, query)}
            onFetchJiraBoards={listJiraBoards}
            onFetchJiraSprints={listJiraSprints}
            onImportJiraIssues={(payload) => handleImportJiraIssues(activeRoomId, payload)}
            onPostJiraIssueReport={(issueId, payload) => handlePostJiraIssueReport(activeRoomId, issueId, payload)}
            onPreviewJiraIssues={handlePreviewJiraIssues}
            onQueueIssue={handleQueueIssue}
            requireStoryId={Boolean(settings?.requireStoryId)}
            onReveal={handleReveal}
            onStartQueuedIssue={handleStartQueuedIssue}
            onUpdateHighlightMode={handleUpdateRoomHighlightMode}
            onUpdateQueuedIssue={handleUpdateQueuedIssue}
            onVote={handleVote}
            snapshot={snapshot}
          />
        ) : null}

        {view === "room" && activeRoomId && !snapshot ? (
          <div className="page-shell">
            <section className="card card--compact">
              <h2>Loading room...</h2>
            </section>
          </div>
        ) : null}
      </main>

      <footer className="app-footer">
        <div className="app-footer__content">
          <div className="app-footer__meta">
            <span className="app-footer__brand">Sprinto by Martin Janeček</span>
            <a
              className="app-footer__link"
              href="https://github.com/AlienPixl"
              rel="noreferrer"
              target="_blank"
            >
              GitHub
            </a>
            <span className="app-footer__copyright">© {copyrightLabel}</span>
          </div>
          {showFooterUpdateNotice ? (
            <div className="app-footer__status">
              {footerUpdateUrl ? (
                <a
                  className="app-footer__update"
                  href={footerUpdateUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  New version {footerUpdateVersion} available
                </a>
              ) : (
                <span className="app-footer__update">New version {footerUpdateVersion} available</span>
              )}
            </div>
          ) : showFooterCurrentVersion ? (
            <div className="app-footer__status">
              <span className="app-footer__version">Current version {footerCurrentVersion}</span>
            </div>
          ) : null}
        </div>
      </footer>

      {userSettingsOpen && user ? (
        <UserSettings
          user={user}
          settings={settings}
          onChangePassword={changePassword}
          onUpdateProfile={handleUpdateMyProfile}
          onUpdateTheme={handleUpdateTheme}
          onPreviewTheme={setPreviewTheme}
          onClose={() => setUserSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

function routeFromLocation(): RouteState {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";

  if (path === "/admin") {
    return { view: "admin", roomId: null };
  }

  if (path === "/worklog") {
    return { view: "worklog", roomId: null };
  }

  const roomMatch = path.match(/^\/rooms\/([^/]+)$/);
  if (roomMatch) {
    return { view: "room", roomId: decodeURIComponent(roomMatch[1]) };
  }

  return { view: "dashboard", roomId: null };
}

function readAuthErrorFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("authError") || "").trim();
}

function clearAuthErrorFromLocation() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("authError")) {
    return;
  }
  url.searchParams.delete("authError");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function pathForRoute(route: RouteState) {
  if (route.view === "admin") {
    return "/admin";
  }
  if (route.view === "worklog") {
    return "/worklog";
  }
  if (route.view === "room" && route.roomId) {
    return `/rooms/${encodeURIComponent(route.roomId)}`;
  }
  return "/";
}

function updateRoute(route: RouteState, replace = false) {
  const nextPath = pathForRoute(route);
  if (window.location.pathname === nextPath) {
    return;
  }
  if (replace) {
    window.history.replaceState(null, "", nextPath);
    return;
  }
  window.history.pushState(null, "", nextPath);
}

function initialsFor(displayName: string) {
  return displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function hasAdminAccess(user: User | null) {
  if (!user) {
    return false;
  }
  return user.permissions.some((permission) =>
    permission === "manage_users" ||
    permission === "manage_roles" ||
    permission === "manage_settings" ||
    permission === "manage_integrations" ||
    permission === "manage_room_settings" ||
    permission === "manage_decks" ||
    permission === "manage_sessions" ||
    permission === "manage_audit_logs" ||
    permission === "manage_scheduled_tasks" ||
    permission === "manage_updates"
  );
}
