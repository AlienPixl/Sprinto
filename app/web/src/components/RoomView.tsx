import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Issue, IssueEvent, IssueQueueItem, JiraAssignableUser, JiraBoard, JiraImportFilters, JiraImportPreviewIssue, JiraImportSyncResult, JiraIntegrationSettings, JiraSprint, Participant, RoomSnapshot, Vote } from "../lib/types";

type HighlightMode = "none" | "most-frequent" | "highest";
type JiraSuggestionStrategy = "highest" | "most-frequent" | "median" | "average";
const JIRA_AUTO_OPEN_STORAGE_KEY = "sprinto.jira.auto_open_after_reveal";

type AnimatedParticipant = {
  participant: Participant;
  state: "entering" | "stable" | "leaving";
};

type HistoryFrame = {
  previewAtMs: number;
  revealed: boolean;
  visibleVotes: Record<string, Vote>;
  visibleParticipants: Participant[];
  stats: {
    average: number | null;
    median: number | null;
  };
};

type TimelineMarkerSide = "above" | "below";
type TimelineMarkerLayout = {
  lane: number;
  labelWidthPx: number;
  positionPercent: number;
  side: TimelineMarkerSide;
  time: string;
  title: string;
};
type TimelineAnchorLayout = TimelineMarkerLayout & {
  key: "start" | "reveal";
};
type TimelineEventLayout = TimelineMarkerLayout & {
  event: IssueEvent;
};
type TimelineLayout = {
  events: TimelineEventLayout[];
  reveal: TimelineAnchorLayout;
  start: TimelineAnchorLayout;
  trackMinHeightPx: number;
};
type TimelineInterval = {
  end: number;
  start: number;
};

type QueueFilterValue = "waiting" | "completed" | "all";
type QueueSortValue = "issue" | "reporter" | "priority";
type QueueDisplayItem = {
  id: string;
  title: string;
  source: string;
  externalIssueUrl: string;
  externalIssueKey: string;
  jiraFieldsSnapshot: Record<string, unknown>;
  listState: "waiting" | "completed";
  waitingIssueId?: string;
};

type RoomViewProps = {
  snapshot: RoomSnapshot;
  currentUserId: string;
  canVote: boolean;
  onVote: (userId: string, value: string) => Promise<void>;
  onReveal: () => Promise<void>;
  onClose: () => Promise<void>;
  onDeleteRoom: () => Promise<void>;
  onQueueIssue: (title: string, storyId?: string) => Promise<void>;
  onUpdateQueuedIssue: (issueId: string, title: string, storyId?: string, source?: string) => Promise<void>;
  onDeleteQueuedIssue: (issueId: string) => Promise<void>;
  onStartQueuedIssue: (issueId: string) => Promise<void>;
  onUpdateHighlightMode: (highlightMode: HighlightMode) => Promise<void>;
  onFetchJiraBoards: () => Promise<JiraBoard[]>;
  onFetchJiraSprints: (boardId: string) => Promise<JiraSprint[]>;
  onPreviewJiraIssues: (boardId: string, sprintId: string | undefined, filters: JiraImportFilters) => Promise<JiraImportPreviewIssue[]>;
  onImportJiraIssues: (payload: {
    boardId: string;
    sprintId?: string;
    filters: JiraImportFilters;
    reimportCompletedIssues?: boolean;
  }) => Promise<JiraImportSyncResult>;
  onApplyJiraIssueEstimate: (
    issueId: string,
    mode: "story-points" | "original-estimate" | "both",
    payload: { storyPointsValue?: number; originalEstimate?: string }
  ) => Promise<{ updatedFields: string[] }>;
  onFetchJiraAssignableUsers: (issueId: string, query?: string) => Promise<JiraAssignableUser[]>;
  onAssignJiraIssueAssignee: (
    issueId: string,
    payload: { accountId?: string; displayName?: string }
  ) => Promise<{ accountId: string }>;
  onPostJiraIssueReport: (
    issueId: string,
    payload: { finalValue: string; includeComment?: boolean; includePdf?: boolean }
  ) => Promise<{ commentPosted: boolean; pdfUploaded: boolean }>;
  canManageRound: boolean;
  canManageCardHighlight: boolean;
  canViewHistory: boolean;
  canDeleteRoom: boolean;
  canImportJiraIssues: boolean;
  canSendToJira: boolean;
  jiraIntegration?: JiraIntegrationSettings;
  requireStoryId: boolean;
};

const TIMELINE_MIN = -12;
const TIMELINE_MAX = 112;
const TIMELINE_START = 12;
const TIMELINE_END = 88;
const TIMELINE_START_PRESENCE_GRACE_MS = 250;
const HIGHLIGHT_OPTIONS: Array<{ value: HighlightMode; label: string }> = [
  { value: "none", label: "No highlight" },
  { value: "most-frequent", label: "Highlight most frequent card" },
  { value: "highest", label: "Highlight highest value card" },
];

export function RoomView({
  snapshot,
  currentUserId,
  canVote,
  onVote,
  onReveal,
  onClose,
  onDeleteRoom,
  onQueueIssue,
  onUpdateQueuedIssue,
  onDeleteQueuedIssue,
  onStartQueuedIssue,
  onUpdateHighlightMode,
  onFetchJiraBoards,
  onFetchJiraSprints,
  onPreviewJiraIssues,
  onImportJiraIssues,
  onApplyJiraIssueEstimate,
  onFetchJiraAssignableUsers,
  onAssignJiraIssueAssignee,
  onPostJiraIssueReport,
  canManageRound,
  canManageCardHighlight,
  canViewHistory,
  canDeleteRoom,
  canImportJiraIssues,
  canSendToJira,
  jiraIntegration,
  requireStoryId
}: RoomViewProps) {
  const QUEUE_PAGE_SIZE = 5;
  const HISTORY_PAGE_SIZE = 6;
  const [queuedStoryId, setQueuedStoryId] = useState("");
  const [queuedIssueTitle, setQueuedIssueTitle] = useState("");
  const [editingQueueIssueId, setEditingQueueIssueId] = useState<string | null>(null);
  const [editingQueueStoryId, setEditingQueueStoryId] = useState("");
  const [editingQueueTitle, setEditingQueueTitle] = useState("");
  const [queueDeleteTarget, setQueueDeleteTarget] = useState<IssueQueueItem | null>(null);
  const [queueDeleteBusy, setQueueDeleteBusy] = useState(false);
  const [closePokerConfirmOpen, setClosePokerConfirmOpen] = useState(false);
  const [roomDeleteOpen, setRoomDeleteOpen] = useState(false);
  const [roomDeleteBusy, setRoomDeleteBusy] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [historyPlayback, setHistoryPlayback] = useState(100);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false);
  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraReimportOpen, setJiraReimportOpen] = useState(false);
  const [jiraReimportCompletedChoice, setJiraReimportCompletedChoice] = useState<"include" | "skip" | null>(null);
  const [jiraPreviewOpen, setJiraPreviewOpen] = useState(false);
  const [jiraBoards, setJiraBoards] = useState<JiraBoard[]>([]);
  const [jiraSprints, setJiraSprints] = useState<JiraSprint[]>([]);
  const [jiraPreviewIssues, setJiraPreviewIssues] = useState<JiraImportPreviewIssue[]>([]);
  const [jiraBoardId, setJiraBoardId] = useState("");
  const [jiraSprintId, setJiraSprintId] = useState("");
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraMessage, setJiraMessage] = useState("");
  const [jiraMessageTone, setJiraMessageTone] = useState<"info" | "success" | "warning" | "error">("info");
  const [jiraFilters, setJiraFilters] = useState<JiraImportFilters>({
    storyPointsEmpty: true,
    originalEstimateEmpty: false,
    importOrder: "issue-key",
  });
  const [queuePage, setQueuePage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [queueFilter, setQueueFilter] = useState<QueueFilterValue>("waiting");
  const [queueSort, setQueueSort] = useState<QueueSortValue>("issue");
  const [jiraActionOpen, setJiraActionOpen] = useState(false);
  const [jiraActionBusy, setJiraActionBusy] = useState(false);
  const [jiraActionSuggestion, setJiraActionSuggestion] = useState<JiraSuggestionStrategy>("highest");
  const [jiraActionStoryPoints, setJiraActionStoryPoints] = useState("");
  const [jiraActionOriginalEstimate, setJiraActionOriginalEstimate] = useState("");
  const [jiraActionAssigneeAccountId, setJiraActionAssigneeAccountId] = useState("");
  const [jiraActionAssigneeDisplayName, setJiraActionAssigneeDisplayName] = useState("");
  const [jiraActionAssigneeOptions, setJiraActionAssigneeOptions] = useState<JiraAssignableUser[]>([]);
  const [jiraActionAssigneeSearch, setJiraActionAssigneeSearch] = useState("");
  const [jiraActionAssigneeOpen, setJiraActionAssigneeOpen] = useState(false);
  const [jiraActionAssigneeLoading, setJiraActionAssigneeLoading] = useState(false);
  const [jiraActionIncludeStoryPoints, setJiraActionIncludeStoryPoints] = useState(false);
  const [jiraActionIncludeOriginalEstimate, setJiraActionIncludeOriginalEstimate] = useState(false);
  const [jiraActionIncludeComment, setJiraActionIncludeComment] = useState(false);
  const [jiraActionIncludePdf, setJiraActionIncludePdf] = useState(false);
  const [jiraActionAutoOpenAfterReveal, setJiraActionAutoOpenAfterReveal] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    const stored = window.localStorage.getItem(JIRA_AUTO_OPEN_STORAGE_KEY);
    return stored == null ? true : stored !== "false";
  });
  const [jiraActionOriginalEstimateEdited, setJiraActionOriginalEstimateEdited] = useState(false);
  const [jiraActionError, setJiraActionError] = useState("");
  const [jiraActionResendConfirm, setJiraActionResendConfirm] = useState(false);
  const [pendingRevealJiraIssueId, setPendingRevealJiraIssueId] = useState<string | null>(null);
  const [animatedParticipants, setAnimatedParticipants] = useState<AnimatedParticipant[]>([]);
  const [, setNow] = useState(() => Date.now());
  const leaveTimersRef = useRef<number[]>([]);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const draggingTimelineRef = useRef(false);
  const highlightMenuRef = useRef<HTMLDivElement | null>(null);
  const controlsPanelRef = useRef<HTMLDivElement | null>(null);
  const jiraAssigneePickerRef = useRef<HTMLDivElement | null>(null);
  const jiraAssigneeSearchInputRef = useRef<HTMLInputElement | null>(null);
  const jiraAssigneeOptionsCacheRef = useRef<Record<string, JiraAssignableUser[]>>({});
  const jiraFetchAssignableUsersRef = useRef(onFetchJiraAssignableUsers);
  const [queuePanelHeight, setQueuePanelHeight] = useState<number | null>(null);

  useEffect(() => {
    jiraFetchAssignableUsersRef.current = onFetchJiraAssignableUsers;
  }, [onFetchJiraAssignableUsers]);

  useEffect(() => {
    leaveTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    leaveTimersRef.current = [];
    jiraAssigneeOptionsCacheRef.current = {};
    setSelectedIssueId(null);
    setHistoryPlayback(100);
    setHistoryOpen(false);
    setShareOpen(false);
    setShareCopied(false);
    setHighlightMenuOpen(false);
    setJiraOpen(false);
    setJiraPreviewOpen(false);
    setQueuedStoryId("");
    setEditingQueueIssueId(null);
    setEditingQueueStoryId("");
    setEditingQueueTitle("");
    setQueueDeleteTarget(null);
    setQueueDeleteBusy(false);
    setRoomDeleteOpen(false);
    setRoomDeleteBusy(false);
    setClosePokerConfirmOpen(false);
    setJiraReimportOpen(false);
    setJiraReimportCompletedChoice(null);
    setJiraActionOpen(false);
    setJiraActionBusy(false);
    setJiraActionSuggestion("highest");
    setJiraActionStoryPoints("");
    setJiraActionOriginalEstimate("");
    setJiraActionAssigneeAccountId("");
    setJiraActionAssigneeDisplayName("");
    setJiraActionAssigneeOptions([]);
    setJiraActionAssigneeSearch("");
    setJiraActionAssigneeOpen(false);
    setJiraActionAssigneeLoading(false);
    setJiraActionIncludeStoryPoints(false);
    setJiraActionIncludeOriginalEstimate(false);
    setJiraActionIncludeComment(false);
    setJiraActionIncludePdf(false);
    setJiraActionOriginalEstimateEdited(false);
    setJiraActionError("");
    setJiraActionResendConfirm(false);
    setPendingRevealJiraIssueId(null);
    setQueuePage(0);
    setAnimatedParticipants(
      snapshot.room.participants
        .filter((participant) => participant.canVote)
        .map((participant) => ({ participant, state: "stable" as const }))
    );
  }, [snapshot.room.id]);

  useEffect(() => {
    setSelectedIssueId(null);
    setHistoryPlayback(100);
    setQueuePage(0);
  }, [snapshot.room.currentIssue.id]);

  useEffect(() => {
    setHistoryPlayback(100);
  }, [selectedIssueId]);

  useEffect(() => {
    if (!jiraMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setJiraMessage("");
    }, 10000);

    return () => window.clearTimeout(timeoutId);
  }, [jiraMessage]);

  const issuesForHistory = useMemo(() => historyIssues(snapshot), [snapshot]);
  const selectedHistoryIssue = useMemo(
    () => (selectedIssueId ? issuesForHistory.find((issue) => issue.id === selectedIssueId) ?? null : null),
    [issuesForHistory, selectedIssueId]
  );
  const historyFrame = useMemo(
    () => buildHistoryFrame(selectedHistoryIssue, historyPlayback),
    [historyPlayback, selectedHistoryIssue]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!canViewHistory && historyOpen) {
      setHistoryOpen(false);
      setSelectedIssueId(null);
    }
  }, [canViewHistory, historyOpen]);

  useEffect(() => {
    const shouldLockBodyScroll =
      jiraReimportOpen ||
      jiraPreviewOpen ||
      shareOpen ||
      closePokerConfirmOpen ||
      Boolean(queueDeleteTarget) ||
      roomDeleteOpen;

    if (!shouldLockBodyScroll) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [jiraReimportOpen, jiraPreviewOpen, shareOpen, closePokerConfirmOpen, queueDeleteTarget, roomDeleteOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (jiraActionAssigneeOpen) {
          setJiraActionAssigneeOpen(false);
          return;
        }
        if (jiraPreviewOpen) {
          setJiraPreviewOpen(false);
          return;
        }
        if (jiraReimportOpen) {
          setJiraReimportOpen(false);
          return;
        }
        setHistoryOpen(false);
        setShareOpen(false);
        setJiraOpen(false);
        setJiraActionOpen(false);
        setHighlightMenuOpen(false);
        setClosePokerConfirmOpen(false);
        if (!queueDeleteBusy) {
          setQueueDeleteTarget(null);
        }
        if (!roomDeleteBusy) {
          setRoomDeleteOpen(false);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [jiraActionAssigneeOpen, jiraPreviewOpen, jiraReimportOpen, queueDeleteBusy, roomDeleteBusy]);

  useEffect(() => {
    return () => {
      leaveTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      leaveTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (highlightMenuOpen && highlightMenuRef.current && !highlightMenuRef.current.contains(event.target as Node)) {
        setHighlightMenuOpen(false);
      }
      if (jiraActionAssigneeOpen && jiraAssigneePickerRef.current && !jiraAssigneePickerRef.current.contains(event.target as Node)) {
        setJiraActionAssigneeOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [highlightMenuOpen, jiraActionAssigneeOpen]);

  const displayIssue: Issue = selectedHistoryIssue ?? snapshot.room.currentIssue;
  const displayVotes = historyFrame?.visibleVotes ?? displayIssue.votes;
  const displayRevealed = historyFrame?.revealed ?? (selectedHistoryIssue ? true : snapshot.room.revealed);
  const displayStats = historyFrame?.stats ?? (selectedHistoryIssue ? displayIssue.stats : snapshot.stats);
  const isHistoryPreview = selectedHistoryIssue !== null;
  const timerText = formatIssueDuration(displayIssue, historyFrame?.previewAtMs);
  const hasNumericVoteStats = useMemo(() => hasAnyNumericVotes(Object.values(displayVotes)), [displayVotes]);
  const roundSummary = formatRoundSummary(displayRevealed, displayStats, Object.keys(displayVotes).length, hasNumericVoteStats);
  const issueQueue = snapshot.room.issueQueue ?? [];
  const queueDisplayItems = useMemo(
    () => buildQueueDisplayItems(snapshot, queueFilter, queueSort),
    [queueFilter, queueSort, snapshot]
  );
  const queuePageCount = Math.max(1, Math.ceil(queueDisplayItems.length / QUEUE_PAGE_SIZE));
  const pagedQueue = queueDisplayItems.slice(queuePage * QUEUE_PAGE_SIZE, (queuePage + 1) * QUEUE_PAGE_SIZE);
  const queuePlaceholderCount = Math.max(0, QUEUE_PAGE_SIZE - pagedQueue.length);
  const historyPageCount = Math.max(1, Math.ceil(issuesForHistory.length / HISTORY_PAGE_SIZE));
  const pagedHistory = issuesForHistory.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE);
  const historyPlaceholderCount = Math.max(0, HISTORY_PAGE_SIZE - pagedHistory.length);
  const selectedVote = snapshot.room.currentIssue.votes[currentUserId]?.value ?? null;
  const canReveal = snapshot.room.status === "voting" && !snapshot.room.revealed;
  const canStartNextIssue = snapshot.room.status !== "voting" && issueQueue.length > 0;
  const canStartQueuedIssue = snapshot.room.status !== "voting" && issueQueue.length > 0;
  const statusLabel = formatStatusLabel(snapshot.room.status);
  const roomUrl = `${window.location.origin}/rooms/${encodeURIComponent(snapshot.room.id)}`;
  const shareSubject = `Sprinto: ${snapshot.room.name}`;
  const shareBody = [
    "Hello,",
    "",
    `please join the Sprinto voting session for the table "${snapshot.room.name}".`,
    "",
    `Link: ${roomUrl}`,
  ].join("\n");
  const shareMailto = `mailto:?subject=${encodeURIComponent(shareSubject)}&body=${encodeURIComponent(shareBody)}`;
  const participantSource = (historyFrame?.visibleParticipants ?? snapshot.room.participants).filter(
    (participant) => participant.canVote
  );
  const highlightMode = snapshot.room.highlightMode;
  const jiraActionIssue = snapshot.room.currentIssue;
  const jiraMinutesPerStoryPoint = Math.max(1, Number(jiraIntegration?.originalEstimateMinutesPerStoryPoint) || 30);
  const jiraStoryPointsEnabled = canSendToJira && Boolean(jiraIntegration?.writeStoryPointsEnabled);
  const jiraOriginalEstimateEnabled = canSendToJira && Boolean(jiraIntegration?.writeOriginalEstimateEnabled);
  const jiraAssigneeEnabled = canSendToJira && Boolean(jiraIntegration?.writeAssigneeEnabled);
  const jiraCommentEnabled = canSendToJira && Boolean(jiraIntegration?.postCommentEnabled);
  const jiraPdfEnabled = canSendToJira && Boolean(jiraIntegration?.postPdfEnabled);
  const canShowJiraActionButton =
    (jiraStoryPointsEnabled || jiraOriginalEstimateEnabled || jiraAssigneeEnabled || jiraCommentEnabled || jiraPdfEnabled);
  const isCurrentIssueFromJira =
    jiraActionIssue.externalSource === "jira" &&
    Boolean(jiraActionIssue.externalIssueKey);
  const canOpenJiraAction =
    canShowJiraActionButton &&
    !isHistoryPreview &&
    isCurrentIssueFromJira &&
    snapshot.room.status === "revealed" &&
    !jiraActionBusy;
  const displayedParticipants =
    animatedParticipants.length > 0
      ? animatedParticipants
      : participantSource.map((participant) => ({ participant, state: "stable" as const }));
  const timelineEvents = useMemo(() => buildTimelineEvents(displayIssue), [displayIssue]);
  const timelineLayout = useMemo(() => buildTimelineLayout(displayIssue, timelineEvents), [displayIssue, timelineEvents]);
  const highlightedValues = useMemo(
    () => getHighlightedValues(displayVotes, snapshot.room.deck, displayRevealed, highlightMode),
    [displayRevealed, displayVotes, highlightMode, snapshot.room.deck]
  );
  const selectedHighlightLabel =
    HIGHLIGHT_OPTIONS.find((option) => option.value === highlightMode)?.label ?? "No highlight";
  const jiraExistingEstimateDelivery = jiraActionIssue.jiraDeliveryStatus?.estimate;
  const jiraExistingReportDelivery = jiraActionIssue.jiraDeliveryStatus?.report;
  const jiraExistingAssigneeDelivery = jiraActionIssue.jiraDeliveryStatus?.assignee;
  const jiraActionSelectedAssignee = useMemo(
    () => jiraActionAssigneeOptions.find((user) => user.accountId === jiraActionAssigneeAccountId) ?? null,
    [jiraActionAssigneeAccountId, jiraActionAssigneeOptions]
  );
  const jiraActionSelectedAssigneeLabel = jiraActionAssigneeDisplayName
    || jiraActionSelectedAssignee?.displayName
    || (jiraActionAssigneeAccountId ? jiraActionAssigneeAccountId : "")
    || "Unassigned";
  const jiraActionFilteredAssigneeOptions = useMemo(
    () => filterJiraAssignableUsers(jiraActionAssigneeOptions, jiraActionAssigneeSearch),
    [jiraActionAssigneeOptions, jiraActionAssigneeSearch]
  );
  const selectedJiraBoard = useMemo(
    () => jiraBoards.find((board) => board.id === jiraBoardId) ?? null,
    [jiraBoardId, jiraBoards]
  );
  const jiraSprintRequired = Boolean(jiraBoardId) && selectedJiraBoard?.type !== "kanban";
  const jiraImportScopeSummary = useMemo(
    () => summarizeJiraImportScope(snapshot, jiraBoardId, jiraSprintRequired ? jiraSprintId : ""),
    [jiraBoardId, jiraSprintId, jiraSprintRequired, snapshot]
  );
  const isQueueOverlayOpen = jiraActionOpen || jiraOpen || historyOpen || highlightMenuOpen;

  function resetJiraActionForm(strategy: JiraSuggestionStrategy = "highest") {
    const suggestedStoryPoints = suggestJiraStoryPoints(jiraActionIssue, snapshot.room.deck, strategy);
    const suggestedStoryPointsLabel = formatJiraNumber(suggestedStoryPoints);
    const cachedAssignees = jiraAssigneeOptionsCacheRef.current[jiraActionIssue.id] || [];
    setJiraActionSuggestion(strategy);
    setJiraActionStoryPoints(suggestedStoryPointsLabel);
    setJiraActionOriginalEstimate(formatEstimateFromStoryPoints(suggestedStoryPoints, jiraMinutesPerStoryPoint));
    setJiraActionAssigneeAccountId("");
    setJiraActionAssigneeDisplayName("");
    setJiraActionAssigneeOptions(cachedAssignees);
    setJiraActionAssigneeSearch("");
    setJiraActionAssigneeOpen(false);
    setJiraActionAssigneeLoading(false);
    setJiraActionIncludeStoryPoints(jiraStoryPointsEnabled);
    setJiraActionIncludeOriginalEstimate(jiraOriginalEstimateEnabled);
    setJiraActionIncludeComment(jiraCommentEnabled);
    setJiraActionIncludePdf(jiraPdfEnabled && jiraCommentEnabled);
    setJiraActionOriginalEstimateEdited(false);
    setJiraActionError("");
    setJiraActionResendConfirm(false);
  }

  function closeQueueOverlayPanels() {
    setJiraActionOpen(false);
    setJiraActionAssigneeOpen(false);
    setJiraOpen(false);
    setJiraPreviewOpen(false);
    setJiraReimportOpen(false);
    setHistoryOpen(false);
    setHighlightMenuOpen(false);
  }

  function openJiraActionModal() {
    if (!canOpenJiraAction) {
      return;
    }
    if (jiraActionOpen) {
      closeJiraActionModal();
      return;
    }
    closeQueueOverlayPanels();
    resetJiraActionForm("highest");
    setJiraActionOpen(true);
  }

  function closeJiraActionModal() {
    if (jiraActionBusy) {
      return;
    }
    setJiraActionOpen(false);
    setJiraActionAssigneeOpen(false);
    setJiraActionError("");
    setJiraActionResendConfirm(false);
  }

  function openHistoryPanel() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    closeQueueOverlayPanels();
    setHistoryOpen(true);
  }

  function openHighlightPanel() {
    if (highlightMenuOpen) {
      setHighlightMenuOpen(false);
      return;
    }
    closeQueueOverlayPanels();
    setHighlightMenuOpen(true);
  }

  async function handleRevealAndOpenJira() {
    const shouldAutoOpen =
      jiraActionAutoOpenAfterReveal &&
      snapshot.room.currentIssue.externalSource === "jira" &&
      Boolean(snapshot.room.currentIssue.externalIssueKey) &&
      (jiraStoryPointsEnabled || jiraOriginalEstimateEnabled || jiraAssigneeEnabled || jiraCommentEnabled || jiraPdfEnabled);
    if (shouldAutoOpen) {
      setPendingRevealJiraIssueId(snapshot.room.currentIssue.id);
    }
    try {
      await onReveal();
    } catch (error) {
      setPendingRevealJiraIssueId(null);
      throw error;
    }
  }

  useEffect(() => {
    setQueuePage((page) => Math.min(page, Math.max(0, queuePageCount - 1)));
  }, [queuePageCount]);

  useEffect(() => {
    setHistoryPage((page) => Math.min(page, Math.max(0, historyPageCount - 1)));
  }, [historyPageCount]);

  useEffect(() => {
    setQueuePage(0);
  }, [queueFilter, queueSort]);

  useEffect(() => {
    setHistoryPage(0);
  }, [historyOpen]);

  useEffect(() => {
    if (!canOpenJiraAction && jiraActionOpen) {
      setJiraActionOpen(false);
      setJiraActionAssigneeOpen(false);
      setJiraActionResendConfirm(false);
    }
  }, [canOpenJiraAction, jiraActionOpen]);

  useEffect(() => {
    if (!pendingRevealJiraIssueId) {
      return;
    }
    if (canOpenJiraAction && jiraActionIssue.id === pendingRevealJiraIssueId) {
      resetJiraActionForm("highest");
      setJiraActionOpen(true);
      setPendingRevealJiraIssueId(null);
      return;
    }
    if (snapshot.room.status !== "voting") {
      setPendingRevealJiraIssueId(null);
    }
  }, [canOpenJiraAction, jiraActionIssue.id, pendingRevealJiraIssueId, snapshot.room.status]);

  useEffect(() => {
    if (!jiraActionOpen || !jiraAssigneeEnabled) {
      setJiraActionAssigneeOpen(false);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(jiraAssigneeOptionsCacheRef.current, jiraActionIssue.id)) {
      setJiraActionAssigneeOptions(jiraAssigneeOptionsCacheRef.current[jiraActionIssue.id] || []);
      setJiraActionAssigneeLoading(false);
      return;
    }

    let isActive = true;
    setJiraActionAssigneeOptions([]);
    setJiraActionAssigneeLoading(true);
    void jiraFetchAssignableUsersRef.current(jiraActionIssue.id)
      .then((users) => {
        if (!isActive) {
          return;
        }
        jiraAssigneeOptionsCacheRef.current[jiraActionIssue.id] = users;
        setJiraActionAssigneeOptions(users);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }
        jiraAssigneeOptionsCacheRef.current[jiraActionIssue.id] = [];
        setJiraActionAssigneeOptions([]);
        setJiraActionError(error instanceof Error ? error.message : "Failed to load Jira assignees.");
      })
      .finally(() => {
        if (isActive) {
          setJiraActionAssigneeLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [jiraActionIssue.id, jiraActionOpen, jiraAssigneeEnabled]);

  useEffect(() => {
    if (!jiraActionAssigneeOpen) {
      setJiraActionAssigneeSearch("");
      return;
    }

    const focusTimer = window.setTimeout(() => {
      jiraAssigneeSearchInputRef.current?.focus();
      jiraAssigneeSearchInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [jiraActionAssigneeOpen]);

  useEffect(() => {
    if (!jiraActionOpen || jiraActionOriginalEstimateEdited) {
      return;
    }
    const numericStoryPoints = Number(jiraActionStoryPoints);
    setJiraActionOriginalEstimate(formatEstimateFromStoryPoints(
      Number.isFinite(numericStoryPoints) ? numericStoryPoints : null,
      jiraMinutesPerStoryPoint
    ));
  }, [jiraActionOpen, jiraActionOriginalEstimateEdited, jiraActionStoryPoints, jiraMinutesPerStoryPoint]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(JIRA_AUTO_OPEN_STORAGE_KEY, jiraActionAutoOpenAfterReveal ? "true" : "false");
  }, [jiraActionAutoOpenAfterReveal]);

  useEffect(() => {
    const element = controlsPanelRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      setQueuePanelHeight(Number.isFinite(nextHeight) && nextHeight > 0 ? nextHeight : null);
    };

    updateHeight();
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [canManageRound, canImportJiraIssues, canSendToJira, canDeleteRoom, canViewHistory, canManageCardHighlight, snapshot.room.status]);

  useEffect(() => {
    setAnimatedParticipants((current) => {
      if (current.length === 0 && participantSource.length > 0) {
        return participantSource.map((participant) => ({ participant, state: "stable" as const }));
      }

      const nextIds = new Set(participantSource.map((participant) => participant.id));
      const currentIds = new Set(current.map((entry) => entry.participant.id));

      const persisted = current.map((entry) => {
        const updated = participantSource.find((participant) => participant.id === entry.participant.id);
        if (updated) {
          return { participant: updated, state: "stable" as const };
        }
        return entry.state === "leaving" ? entry : { participant: entry.participant, state: "leaving" as const };
      });

      const entering = participantSource
        .filter((participant) => !currentIds.has(participant.id))
        .map((participant) => ({ participant, state: "entering" as const }));

      const merged = [...persisted, ...entering];

      if (entering.length > 0) {
        const enterTimer = window.setTimeout(() => {
          setAnimatedParticipants((entries) =>
            entries.map((entry) => (entry.state === "entering" ? { ...entry, state: "stable" } : entry))
          );
        }, 320);
        leaveTimersRef.current.push(enterTimer);
      }

      if (merged.some((entry) => entry.state === "leaving")) {
        const leaveTimer = window.setTimeout(() => {
          setAnimatedParticipants((entries) =>
            entries.filter((entry) => !(entry.state === "leaving" && !nextIds.has(entry.participant.id)))
          );
        }, 320);
        leaveTimersRef.current.push(leaveTimer);
      }

      return merged;
    });
  }, [participantSource]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!draggingTimelineRef.current || !timelineTrackRef.current || !isHistoryPreview) {
        return;
      }
      setHistoryPlayback(playbackFromPointer(event.clientX, timelineTrackRef.current));
    }

    function handlePointerUp() {
      draggingTimelineRef.current = false;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isHistoryPreview]);

  async function handleQueueIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!queuedIssueTitle.trim()) {
      return;
    }
    if (requireStoryId && !queuedStoryId.trim()) {
      return;
    }
    await onQueueIssue(queuedIssueTitle, queuedStoryId.trim());
    setQueuedStoryId("");
    setQueuedIssueTitle("");
  }

  function startEditingQueueIssue(issue: IssueQueueItem) {
    const parsed = splitQueueIssueTitle(issue.title);
    setEditingQueueIssueId(issue.id);
    setEditingQueueStoryId(parsed.storyId);
    setEditingQueueTitle(parsed.title);
  }

  function cancelEditingQueueIssue() {
    setEditingQueueIssueId(null);
    setEditingQueueStoryId("");
    setEditingQueueTitle("");
  }

  async function submitEditingQueueIssue(issue: IssueQueueItem) {
    if (!editingQueueTitle.trim()) {
      return;
    }
    if (requireStoryId && !editingQueueStoryId.trim()) {
      return;
    }
    await onUpdateQueuedIssue(issue.id, editingQueueTitle.trim(), editingQueueStoryId.trim(), issue.source);
    cancelEditingQueueIssue();
  }

  async function confirmDeleteQueueIssue() {
    if (!queueDeleteTarget) {
      return;
    }
    const targetId = queueDeleteTarget.id;
    setQueueDeleteBusy(true);
    await onDeleteQueuedIssue(targetId);
    setQueueDeleteBusy(false);
    setQueueDeleteTarget(null);
    if (editingQueueIssueId === targetId) {
      cancelEditingQueueIssue();
    }
  }

  function openDeleteQueueIssue(issue: IssueQueueItem) {
    setQueueDeleteTarget(issue);
  }

  function closeDeleteQueueIssue() {
    if (queueDeleteBusy) {
      return;
    }
    const targetId = queueDeleteTarget?.id ?? null;
    setQueueDeleteTarget(null);
    if (editingQueueIssueId && editingQueueIssueId === targetId) {
      cancelEditingQueueIssue();
    }
  }

  async function handleCopyRoomUrl() {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setShareCopied(false);
    }
  }

  async function openJiraModal() {
    if (jiraOpen) {
      closeJiraModal();
      return;
    }
    closeQueueOverlayPanels();
    setJiraOpen(true);
    setJiraReimportOpen(false);
    setJiraReimportCompletedChoice(null);
    setJiraPreviewOpen(false);
    setJiraLoading(true);
    setJiraMessage("");
    setJiraMessageTone("info");
    try {
      const boards = await onFetchJiraBoards();
      setJiraBoards(boards);
      const nextBoardId = jiraBoardId || boards[0]?.id || "";
      setJiraBoardId(nextBoardId);
      if (nextBoardId) {
        const nextBoard = boards.find((board) => board.id === nextBoardId) ?? null;
        if (nextBoard?.type === "kanban") {
          setJiraSprints([]);
          setJiraSprintId("");
        } else {
          const sprints = await onFetchJiraSprints(nextBoardId);
          setJiraSprints(sprints);
          setJiraSprintId((current) => current || sprints[0]?.id || "");
        }
      }
    } catch (error) {
      setJiraMessage(error instanceof Error ? error.message : "Failed to load Jira options.");
      setJiraMessageTone("error");
    } finally {
      setJiraLoading(false);
    }
  }

  async function handleJiraBoardChange(boardId: string) {
    setJiraBoardId(boardId);
    setJiraSprintId("");
    setJiraReimportOpen(false);
    setJiraReimportCompletedChoice(null);
    setJiraPreviewIssues([]);
    setJiraPreviewOpen(false);
    if (!boardId) {
      setJiraSprints([]);
      return;
    }
    const nextBoard = jiraBoards.find((board) => board.id === boardId) ?? null;
    if (nextBoard?.type === "kanban") {
      setJiraSprints([]);
      return;
    }
    setJiraLoading(true);
    try {
      const sprints = await onFetchJiraSprints(boardId);
      setJiraSprints(sprints);
      setJiraSprintId(sprints[0]?.id || "");
    } catch (error) {
      setJiraMessage(error instanceof Error ? error.message : "Failed to load Jira sprints.");
      setJiraMessageTone("error");
    } finally {
      setJiraLoading(false);
    }
  }

  async function handlePreviewJiraImport() {
    if (!jiraBoardId || (jiraSprintRequired && !jiraSprintId)) {
      return;
    }
    setJiraLoading(true);
    setJiraMessage("");
    setJiraMessageTone("info");
    try {
      const preview = await onPreviewJiraIssues(jiraBoardId, jiraSprintRequired ? jiraSprintId : undefined, jiraFilters);
      setJiraPreviewIssues(preview);
      setJiraPreviewOpen(true);
      setJiraMessage(
        preview.length > 0
          ? `${preview.length} Jira issues ready to import.`
          : "No Jira issues matched the current import rules."
      );
      setJiraMessageTone(preview.length > 0 ? "info" : "warning");
    } catch (error) {
      setJiraMessage(error instanceof Error ? error.message : "Failed to preview Jira issues.");
      setJiraMessageTone("error");
    } finally {
      setJiraLoading(false);
    }
  }

  async function handleImportFromJira() {
    if (jiraImportScopeSummary.hasExistingImport) {
      setJiraReimportCompletedChoice(null);
      setJiraReimportOpen(true);
      return;
    }

    await runJiraImport(false);
  }

  async function runJiraImport(reimportCompletedIssues: boolean) {
    if (!jiraBoardId || (jiraSprintRequired && !jiraSprintId)) {
      return;
    }
    setJiraLoading(true);
    setJiraMessage("");
    setJiraMessageTone("info");
    try {
      const result = await onImportJiraIssues({
        boardId: jiraBoardId,
        sprintId: jiraSprintRequired ? jiraSprintId : undefined,
        filters: jiraFilters,
        reimportCompletedIssues,
      });
      setJiraPreviewIssues([]);
      setJiraPreviewOpen(false);
      setJiraReimportOpen(false);
      setJiraMessage(formatJiraImportSummary(result));
      setJiraMessageTone("success");
      closeJiraModal();
    } catch (error) {
      setJiraMessage(error instanceof Error ? error.message : "Failed to import Jira issues.");
      setJiraMessageTone("error");
    } finally {
      setJiraLoading(false);
    }
  }

  function closeJiraModal() {
    setJiraOpen(false);
    setJiraReimportOpen(false);
    setJiraPreviewOpen(false);
  }

  function closeJiraPreview() {
    setJiraPreviewOpen(false);
  }

  function closeJiraReimport() {
    if (jiraLoading) {
      return;
    }
    setJiraReimportOpen(false);
  }

  async function confirmJiraReimport() {
    if (jiraImportScopeSummary.completedCount > 0 && !jiraReimportCompletedChoice) {
      return;
    }
    await runJiraImport(jiraReimportCompletedChoice === "include");
  }

  function openDeleteRoomConfirm() {
    setRoomDeleteOpen(true);
  }

  function closeDeleteRoomConfirm() {
    if (roomDeleteBusy) {
      return;
    }
    setRoomDeleteOpen(false);
  }

  async function confirmDeleteRoom() {
    setRoomDeleteBusy(true);
    try {
      await onDeleteRoom();
    } finally {
      setRoomDeleteBusy(false);
    }
  }

  async function confirmClosePoker() {
    setClosePokerConfirmOpen(false);
    await onClose();
  }

  function openJiraAssigneePicker() {
    if (!jiraAssigneeEnabled || jiraActionBusy) {
      return;
    }
    setJiraActionAssigneeOpen((current) => !current);
    setJiraActionError("");
    setJiraActionResendConfirm(false);
  }

  function handleJiraAssigneeChange(accountId: string) {
    const selectedUser = jiraActionAssigneeOptions.find((user) => user.accountId === accountId) ?? null;
    setJiraActionAssigneeAccountId(selectedUser?.accountId || "");
    setJiraActionAssigneeDisplayName(selectedUser?.displayName || "");
    setJiraActionAssigneeOpen(false);
    setJiraActionAssigneeSearch("");
    setJiraActionError("");
    setJiraActionResendConfirm(false);
  }

  async function handleSubmitJiraActions() {
    if (!canOpenJiraAction) {
      return;
    }

    const wantsEstimate = jiraActionIncludeStoryPoints || jiraActionIncludeOriginalEstimate;
    const wantsAssignee = jiraAssigneeEnabled && Boolean(jiraActionAssigneeAccountId.trim());
    const wantsReport = jiraActionIncludeComment || jiraActionIncludePdf;

    if (!wantsEstimate && !wantsAssignee && !wantsReport) {
      setJiraActionError("Select at least one Jira action to send.");
      return;
    }

    const numericStoryPoints = Number(jiraActionStoryPoints);
    if (jiraActionIncludeStoryPoints && !Number.isFinite(numericStoryPoints)) {
      setJiraActionError("Story Points must be a numeric value.");
      return;
    }

    if (jiraActionIncludeOriginalEstimate && !jiraActionOriginalEstimate.trim()) {
      setJiraActionError("Original Estimate cannot be empty.");
      return;
    }

    if (wantsReport && !jiraActionStoryPoints.trim()) {
      setJiraActionError("Story Points value is required for the Jira report.");
      return;
    }

    const estimateAlreadySent = wantsEstimate && Boolean(jiraExistingEstimateDelivery?.sentAt);
    const assigneeAlreadySent = wantsAssignee && Boolean(jiraExistingAssigneeDelivery?.sentAt);
    const reportAlreadySent = wantsReport && Boolean(jiraExistingReportDelivery?.sentAt);
    if ((estimateAlreadySent || assigneeAlreadySent || reportAlreadySent) && !jiraActionResendConfirm) {
      setJiraActionResendConfirm(true);
      setJiraActionError("This Jira issue was already updated before. Click Send again to confirm another delivery.");
      return;
    }

    setJiraActionBusy(true);
    setJiraActionError("");
    try {
      if (wantsEstimate) {
        const mode =
          jiraActionIncludeStoryPoints && jiraActionIncludeOriginalEstimate
            ? "both"
            : jiraActionIncludeStoryPoints
              ? "story-points"
              : "original-estimate";
        await onApplyJiraIssueEstimate(jiraActionIssue.id, mode, {
          storyPointsValue: Number.isFinite(numericStoryPoints) ? numericStoryPoints : undefined,
          originalEstimate: jiraActionIncludeOriginalEstimate ? jiraActionOriginalEstimate.trim() : undefined,
        });
      }

      if (wantsAssignee) {
        await onAssignJiraIssueAssignee(jiraActionIssue.id, {
          accountId: jiraActionAssigneeAccountId,
          displayName: jiraActionAssigneeDisplayName,
        });
      }

      if (wantsReport) {
        await onPostJiraIssueReport(jiraActionIssue.id, {
          finalValue: jiraActionStoryPoints.trim(),
          includeComment: jiraActionIncludeComment,
          includePdf: jiraActionIncludePdf,
        });
      }

      setJiraMessage(formatJiraDeliverySuccessMessage(wantsEstimate, wantsAssignee, wantsReport));
      setJiraMessageTone("success");
      setJiraActionOpen(false);
      setJiraActionResendConfirm(false);
    } catch (error) {
      setJiraActionError(error instanceof Error ? error.message : "Failed to send Jira data.");
    } finally {
      setJiraActionBusy(false);
    }
  }

  return (
    <div className="page-shell room-screen">
      <section className="table-hero table-hero--room">
        <div>
          <h1 className="room-screen__title">{snapshot.room.name}</h1>
          <div className="issue-strip issue-strip--desktop">
            <div className="round-inline round-inline--room">
              <span>Room</span>
              <strong title={snapshot.room.name}>{snapshot.room.name}</strong>
            </div>
            <div className="issue-banner">
              <span className="issue-banner__label">{isHistoryPreview ? "History issue" : "Current issue"}</span>
              <strong title={displayIssue.title}>{displayIssue.title}</strong>
            </div>
            <div className="round-inline round-inline--round">
              <span>Round</span>
              <strong>{roundSummary}</strong>
            </div>
            <div className="round-inline round-inline--timer">
              <span>Timer</span>
              <strong>{timerText}</strong>
            </div>
            <div className="round-inline round-inline--status">
              <span>Status</span>
              <strong>{statusLabel}</strong>
            </div>
            <div className="round-inline round-inline--issues">
              <span>Issues played</span>
              <strong>{snapshot.room.completedCount}</strong>
            </div>
            <button className="round-inline round-inline--action round-inline--share" onClick={() => setShareOpen(true)} type="button">
              <span aria-hidden="true" className="share-trigger-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="2.5" />
                  <circle cx="6" cy="12" r="2.5" />
                  <circle cx="18" cy="19" r="2.5" />
                  <path d="M8.2 11l7.1-4.1" />
                  <path d="M8.2 13l7.1 4.1" />
                </svg>
              </span>
            </button>
          </div>
          <div className="issue-strip-mobile">
            <div className="issue-strip-mobile__summary">
              <div className="issue-strip-mobile__row">
                <span>{isHistoryPreview ? "History issue" : "Current issue"}:</span>
                <strong title={displayIssue.title}>{displayIssue.title}</strong>
              </div>
              <div className="issue-strip-mobile__inline">
                <div className="issue-strip-mobile__metric">
                  <span>Round:</span>
                  <strong>{roundSummary}</strong>
                </div>
                <div className="issue-strip-mobile__metric">
                  <span>Timer:</span>
                  <strong>{timerText}</strong>
                </div>
                <div className="issue-strip-mobile__metric">
                  <span>Status:</span>
                  <strong>{statusLabel}</strong>
                </div>
                <div className="issue-strip-mobile__metric">
                  <span>Issues played:</span>
                  <strong>{snapshot.room.completedCount}</strong>
                </div>
              </div>
            </div>
            <button className="issue-strip-mobile__share" onClick={() => setShareOpen(true)} type="button">
              <span aria-hidden="true" className="share-trigger-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="2.5" />
                  <circle cx="6" cy="12" r="2.5" />
                  <circle cx="18" cy="19" r="2.5" />
                  <path d="M8.2 11l7.1-4.1" />
                  <path d="M8.2 13l7.1 4.1" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      </section>

      <section className="room-board">
        <div className="poker-stage card card--compact">
          <div className="table-felt">
            <div className="player-card-grid">
              {displayedParticipants.map(({ participant, state }) => {
                const vote = displayVotes[participant.id];
                const faceValue = vote?.value ?? "";
                const isCurrentUser = participant.id === currentUserId;
                const hasVoted = Boolean(vote) || (!isHistoryPreview && participant.voted);
                const isHighlighted = Boolean(vote && highlightedValues.has(vote.value));

                return (
                  <article
                    className={`player-seat ${isCurrentUser ? "player-seat--me" : ""} ${
                      state === "entering" ? "player-seat--entering" : ""
                    } ${state === "leaving" ? "player-seat--leaving" : ""} ${isHighlighted ? "player-seat--highlighted" : ""}`}
                    key={participant.id}
                  >
                    <div className={`flip-card ${displayRevealed ? "is-revealed" : ""} ${isHighlighted ? "is-highlighted" : ""}`}>
                      <div className="flip-card__inner">
                        <div className="flip-card__front">
                          <strong className="card-symbol">{hasVoted ? "\u2713" : "?"}</strong>
                        </div>
                        <div className="flip-card__back">
                          <strong className="card-value">{faceValue || "-"}</strong>
                        </div>
                      </div>
                    </div>
                    <span className="seat-name">
                      <span className="seat-name__first">{participant.firstName}</span>
                      <span className="seat-name__last">{participant.lastName}</span>
                    </span>
                  </article>
                );
              })}
            </div>
          </div>

          {!isHistoryPreview && snapshot.room.status !== "closed" && canVote ? (
            <div className="deck-panel">
              <div className="deck-grid deck-grid--cards">
                {snapshot.room.deck.map((card) => (
                  <button
                    className={`vote-card ${selectedVote === card ? "is-selected" : ""}`}
                    key={card}
                    onClick={() => void onVote(currentUserId, card)}
                    disabled={snapshot.room.status !== "voting"}
                    type="button"
                  >
                    <span>{card}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {(canManageRound || canDeleteRoom || canManageCardHighlight) && !isHistoryPreview ? (
            <div className={`room-admin-layout ${canManageRound ? "" : "room-admin-layout--controls-only"}`.trim()}>
              <div className="card card--compact controls-panel" ref={controlsPanelRef}>
                <div className="controls-inline controls-inline--stacked">
                  {canManageRound ? (
                    <>
                      <button disabled={!canReveal} onClick={() => void handleRevealAndOpenJira()} type="button">
                        Reveal cards
                      </button>
                      <button disabled={!canStartNextIssue} onClick={() => void onStartQueuedIssue(issueQueue[0]?.id ?? "")} type="button">
                        Next issue
                      </button>
                      {canManageCardHighlight ? (
                        <button className="ghost-button ghost-button--strong" onClick={openHighlightPanel} type="button">
                          {selectedHighlightLabel}
                        </button>
                      ) : null}
                      {canViewHistory ? (
                      <button className="ghost-button ghost-button--strong" onClick={openHistoryPanel} type="button">
                          History
                      </button>
                      ) : null}
                      {canImportJiraIssues ? (
                        <button className="ghost-button ghost-button--strong" onClick={() => void openJiraModal()} type="button">
                          Import from Jira
                        </button>
                      ) : null}
                      {canShowJiraActionButton ? (
                        <button className="ghost-button ghost-button--strong" disabled={!canOpenJiraAction} onClick={openJiraActionModal} type="button">
                          Send to Jira
                        </button>
                      ) : null}
                      <button disabled={snapshot.room.status !== "revealed"} onClick={() => setClosePokerConfirmOpen(true)} type="button">
                        Close poker
                      </button>
                    </>
                  ) : null}
                  {canDeleteRoom ? (
                    <button className="deck-delete-btn" onClick={openDeleteRoomConfirm} type="button">
                      Delete room
                    </button>
                  ) : null}
                </div>
              </div>

              {canManageRound ? (
              <div
                className="card card--compact queue-panel"
                style={
                  queuePanelHeight && !isQueueOverlayOpen
                    ? ({ "--queue-panel-sync-height": `${queuePanelHeight}px` } as CSSProperties)
                    : undefined
                }
              >
                {!isQueueOverlayOpen ? (
                  <div className="queue-panel__default-content">
                    <form className="stack-form" onSubmit={handleQueueIssue}>
                      <div className="queue-form-fields">
                        <input
                          aria-label="Story ID"
                          className="queue-form-fields__story-id"
                          placeholder="ID"
                          value={queuedStoryId}
                          onChange={(e) => setQueuedStoryId(e.target.value)}
                        />
                        <input
                          aria-label="Add issue manually"
                          className="queue-form-fields__title"
                          placeholder="Add an issue manually"
                          value={queuedIssueTitle}
                          onChange={(e) => setQueuedIssueTitle(e.target.value)}
                        />
                        <button className="button-small" type="submit">
                          Add to queue
                        </button>
                        <div className="queue-toolbar" aria-label="Queue filters and sorting">
                          <label className="queue-toolbar__control">
                            <span aria-hidden="true" className="queue-toolbar__icon">
                              <FilterIcon />
                            </span>
                            <select aria-label="Filter queue issues" value={queueFilter} onChange={(event) => setQueueFilter(event.target.value as QueueFilterValue)}>
                              <option value="waiting">Waiting</option>
                              <option value="completed">Completed</option>
                              <option value="all">All</option>
                            </select>
                          </label>
                          <label className="queue-toolbar__control">
                            <span aria-hidden="true" className="queue-toolbar__icon">
                              <SortIcon />
                            </span>
                            <select aria-label="Sort queue issues" value={queueSort} onChange={(event) => setQueueSort(event.target.value as QueueSortValue)}>
                              <option value="issue">Issue</option>
                              <option value="reporter">Reporter</option>
                              <option value="priority">Priority</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    </form>
                    <div className="queue-divider" />
                  </div>
                ) : null}
                {jiraActionOpen ? (
                  <div className="queue-jira-panel">
                    <div className="queue-jira-panel__header">
                      <div>
                        <h3>Send to Jira</h3>
                        <p>
                          Review the final values for <strong>{jiraActionIssue.externalIssueKey}</strong> before Sprinto sends them to Jira.
                        </p>
                      </div>
                    </div>

                    {jiraExistingEstimateDelivery?.sentAt || jiraExistingAssigneeDelivery?.sentAt || jiraExistingReportDelivery?.sentAt ? (
                      <div className="jira-action-modal__history">
                        {jiraExistingEstimateDelivery?.sentAt ? (
                          <p>
                            Story points / estimate were already sent on {formatJiraSentAt(jiraExistingEstimateDelivery.sentAt)}
                            {jiraExistingEstimateDelivery.sentByDisplayName ? ` by ${jiraExistingEstimateDelivery.sentByDisplayName}` : ""}.
                          </p>
                        ) : null}
                        {jiraExistingAssigneeDelivery?.sentAt ? (
                          <p>
                            Assignee was last updated on {formatJiraSentAt(jiraExistingAssigneeDelivery.sentAt)}
                            {jiraExistingAssigneeDelivery.sentByDisplayName ? ` by ${jiraExistingAssigneeDelivery.sentByDisplayName}` : ""}
                            {jiraExistingAssigneeDelivery.displayName ? ` to ${jiraExistingAssigneeDelivery.displayName}` : " to Unassigned"}.
                          </p>
                        ) : null}
                        {jiraExistingReportDelivery?.sentAt ? (
                          <p>
                            Jira report was already sent on {formatJiraSentAt(jiraExistingReportDelivery.sentAt)}
                            {jiraExistingReportDelivery.sentByDisplayName ? ` by ${jiraExistingReportDelivery.sentByDisplayName}` : ""}.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="jira-action-modal__grid">
                      <label>
                        <span>Suggestion</span>
                        <select
                          value={jiraActionSuggestion}
                          onChange={(event) => resetJiraActionForm(event.target.value as JiraSuggestionStrategy)}
                        >
                          <option value="highest">Highest voted value</option>
                          <option value="most-frequent">Most frequent value</option>
                          <option value="median">Median</option>
                          <option value="average">Average</option>
                        </select>
                      </label>

                      {(jiraStoryPointsEnabled || jiraOriginalEstimateEnabled) ? (
                        <>
                          <label>
                            <span>Story Points</span>
                            <input
                              value={jiraActionStoryPoints}
                              onChange={(event) => {
                                setJiraActionStoryPoints(event.target.value);
                                setJiraActionResendConfirm(false);
                                setJiraActionError("");
                              }}
                            />
                          </label>

                          {jiraOriginalEstimateEnabled ? (
                            <label>
                              <span>Original Estimate</span>
                              <input
                                value={jiraActionOriginalEstimate}
                                onChange={(event) => {
                                  setJiraActionOriginalEstimate(event.target.value);
                                  setJiraActionOriginalEstimateEdited(true);
                                  setJiraActionResendConfirm(false);
                                  setJiraActionError("");
                                }}
                              />
                            </label>
                          ) : null}
                        </>
                      ) : null}

                      {jiraAssigneeEnabled ? (
                        <div className="jira-action-modal__assignee-field">
                          <span>Assignee</span>
                          <div className="jira-action-modal__assignee-picker" ref={jiraAssigneePickerRef}>
                            <button
                              aria-controls="jira-assignee-listbox"
                              aria-expanded={jiraActionAssigneeOpen}
                              aria-haspopup="listbox"
                              className={`jira-action-modal__assignee-trigger ${jiraActionAssigneeOpen ? "is-open" : ""}`}
                              disabled={jiraActionBusy || jiraActionAssigneeLoading}
                              onClick={openJiraAssigneePicker}
                              type="button"
                            >
                              <span className="jira-action-modal__assignee-trigger-main">
                                {jiraActionSelectedAssignee ? (
                                  <span className="avatar-circle jira-action-modal__assignee-avatar" aria-hidden="true">
                                    {jiraActionSelectedAssignee.avatarUrl ? (
                                      <img alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} src={jiraActionSelectedAssignee.avatarUrl} />
                                    ) : null}
                                    {getAvatarInitials(jiraActionSelectedAssignee.displayName)}
                                  </span>
                                ) : (
                                  <span className="avatar-circle jira-action-modal__assignee-avatar jira-action-modal__assignee-avatar--unassigned" aria-hidden="true">
                                    U
                                  </span>
                                )}
                                <span className={`jira-action-modal__assignee-value ${jiraActionAssigneeAccountId ? "is-selected" : ""}`}>
                                  {jiraActionSelectedAssigneeLabel}
                                </span>
                              </span>
                              <span aria-hidden="true" className="jira-action-modal__assignee-caret">
                                {jiraActionAssigneeOpen ? "▴" : "▾"}
                              </span>
                            </button>

                            {jiraActionAssigneeOpen ? (
                              <div className="jira-action-modal__assignee-menu">
                                <input
                                  aria-label="Search Jira assignee"
                                  className="jira-action-modal__assignee-search"
                                  onChange={(event) => setJiraActionAssigneeSearch(event.target.value)}
                                  placeholder="Search Jira users"
                                  ref={jiraAssigneeSearchInputRef}
                                  value={jiraActionAssigneeSearch}
                                />
                                <div className="jira-action-modal__assignee-options" id="jira-assignee-listbox" role="listbox">
                                  <button
                                    aria-selected={!jiraActionAssigneeAccountId}
                                    className={`jira-action-modal__assignee-option ${!jiraActionAssigneeAccountId ? "is-selected" : ""}`}
                                    onClick={() => handleJiraAssigneeChange("")}
                                    role="option"
                                    type="button"
                                  >
                                    <span className="avatar-circle jira-action-modal__assignee-avatar jira-action-modal__assignee-avatar--unassigned" aria-hidden="true">
                                      U
                                    </span>
                                    <span className="jira-action-modal__assignee-option-copy">
                                      <strong>Unassigned</strong>
                                      <span>Leave the Jira issue without assignee</span>
                                    </span>
                                  </button>

                                  {jiraActionFilteredAssigneeOptions.map((user) => (
                                    <button
                                      aria-selected={jiraActionAssigneeAccountId === user.accountId}
                                      className={`jira-action-modal__assignee-option ${jiraActionAssigneeAccountId === user.accountId ? "is-selected" : ""}`}
                                      key={user.accountId}
                                      onClick={() => handleJiraAssigneeChange(user.accountId)}
                                      role="option"
                                      type="button"
                                    >
                                      <span className="avatar-circle jira-action-modal__assignee-avatar" aria-hidden="true">
                                        {user.avatarUrl ? (
                                          <img alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} src={user.avatarUrl} />
                                        ) : null}
                                        {getAvatarInitials(user.displayName)}
                                      </span>
                                      <span className="jira-action-modal__assignee-option-copy">
                                        <strong>{user.displayName}</strong>
                                        <span>{user.emailAddress || user.accountId}</span>
                                      </span>
                                    </button>
                                  ))}

                                  {!jiraActionAssigneeLoading && jiraActionFilteredAssigneeOptions.length === 0 ? (
                                    <div className="jira-action-modal__assignee-empty">
                                      No Jira users matched this search.
                                    </div>
                                  ) : null}
                                </div>
                                {jiraActionAssigneeLoading ? (
                                  <div className="jira-action-modal__assignee-status">Loading Jira users...</div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                    </div>

                    <div className="jira-action-modal__options">
                      <div className="settings-toggle jira-action-modal__toggle">
                        <button
                          aria-label="Toggle automatic Jira panel open after reveal"
                          className={`toggle-switch ${jiraActionAutoOpenAfterReveal ? "is-active" : ""}`}
                          onClick={() => setJiraActionAutoOpenAfterReveal((current) => !current)}
                          type="button"
                        >
                          <span className="toggle-switch__knob" />
                        </button>
                        <span>Open this panel automatically after reveal</span>
                      </div>
                      {jiraStoryPointsEnabled ? (
                        <div className="settings-toggle jira-action-modal__toggle">
                          <button
                            aria-label="Toggle Story Points update"
                            className={`toggle-switch ${jiraActionIncludeStoryPoints ? "is-active" : ""}`}
                            onClick={() => {
                              setJiraActionIncludeStoryPoints((current) => !current);
                              setJiraActionResendConfirm(false);
                              setJiraActionError("");
                            }}
                            type="button"
                          >
                            <span className="toggle-switch__knob" />
                          </button>
                          <span>Update Story Points</span>
                        </div>
                      ) : null}
                      {jiraOriginalEstimateEnabled ? (
                        <div className="settings-toggle jira-action-modal__toggle">
                          <button
                            aria-label="Toggle Original Estimate update"
                            className={`toggle-switch ${jiraActionIncludeOriginalEstimate ? "is-active" : ""}`}
                            onClick={() => {
                              setJiraActionIncludeOriginalEstimate((current) => !current);
                              setJiraActionResendConfirm(false);
                              setJiraActionError("");
                            }}
                            type="button"
                          >
                            <span className="toggle-switch__knob" />
                          </button>
                          <span>Update Original Estimate</span>
                        </div>
                      ) : null}
                      {jiraCommentEnabled ? (
                        <div className="settings-toggle jira-action-modal__toggle">
                          <button
                            aria-label="Toggle Jira comment post"
                            className={`toggle-switch ${jiraActionIncludeComment ? "is-active" : ""}`}
                            onClick={() => {
                              setJiraActionIncludeComment((current) => {
                                const next = !current;
                                if (!next) {
                                  setJiraActionIncludePdf(false);
                                }
                                return next;
                              });
                              setJiraActionResendConfirm(false);
                              setJiraActionError("");
                            }}
                            type="button"
                          >
                            <span className="toggle-switch__knob" />
                          </button>
                          <span>Post Jira comment</span>
                        </div>
                      ) : null}
                      {jiraPdfEnabled ? (
                        <div className="settings-toggle jira-action-modal__toggle">
                          <button
                            aria-label="Toggle PDF report attachment"
                            disabled={!jiraActionIncludeComment}
                            className={`toggle-switch ${jiraActionIncludePdf ? "is-active" : ""}`}
                            onClick={() => {
                              if (!jiraActionIncludeComment) {
                                return;
                              }
                              setJiraActionIncludePdf((current) => !current);
                              setJiraActionResendConfirm(false);
                              setJiraActionError("");
                            }}
                            type="button"
                          >
                            <span className="toggle-switch__knob" />
                          </button>
                          <span>Attach PDF report</span>
                        </div>
                      ) : null}
                    </div>

                    {jiraActionError ? (
                      <p className={`jira-action-modal__message ${jiraActionResendConfirm ? "is-warning" : "is-error"}`}>
                        {jiraActionError}
                      </p>
                    ) : null}

                    <div className="queue-jira-panel__actions">
                      <button className="button-center" disabled={jiraActionBusy} onClick={closeJiraActionModal} type="button">
                        Cancel
                      </button>
                      <button className="button-center" disabled={jiraActionBusy} onClick={() => void handleSubmitJiraActions()} type="button">
                        {jiraActionBusy ? "Sending..." : jiraActionResendConfirm ? "Send again" : "Send to Jira"}
                      </button>
                    </div>
                  </div>
                ) : jiraOpen ? (
                  <div className="queue-jira-panel">
                    <div className="queue-jira-panel__header">
                      <div>
                        <h3>Import from Jira</h3>
                        <p>Choose a board and filters before importing issues into the queue. Scrum boards also require a sprint.</p>
                      </div>
                    </div>

                    <div className="jira-import-form">
                      <div className="jira-import-grid">
                        <label>
                          <span>Board</span>
                          <select value={jiraBoardId} onChange={(event) => void handleJiraBoardChange(event.target.value)}>
                            <option value="">Select board</option>
                            {jiraBoards.map((board) => (
                              <option key={board.id} value={board.id}>{formatJiraBoardLabel(board)}</option>
                            ))}
                          </select>
                        </label>
                        {selectedJiraBoard?.type !== "kanban" ? (
                          <label>
                            <span>Sprint</span>
                            <select value={jiraSprintId} onChange={(event) => setJiraSprintId(event.target.value)}>
                              <option value="">Select sprint</option>
                              {jiraSprints.map((sprint) => (
                                <option key={sprint.id} value={sprint.id}>{sprint.name} ({sprint.state})</option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label className="jira-import-placeholder">
                            <span>Sprint</span>
                            <p className="settings-help settings-help--modal-spaced">Kanban board selected. Sprint is not used for this import.</p>
                          </label>
                        )}
                      </div>

                      <div className="jira-import-section jira-import-section--compact">
                        <p className="jira-import-section__title">Import rules</p>
                        <div className="jira-settings-toggle-grid">
                          <div className="settings-toggle">
                            <button
                              className={`toggle-switch ${jiraFilters.storyPointsEmpty ? "is-active" : ""}`}
                              onClick={() => setJiraFilters((current) => ({ ...current, storyPointsEmpty: !current.storyPointsEmpty }))}
                              type="button"
                            >
                              <span className="toggle-switch__knob" />
                            </button>
                            <span>Story Points is empty</span>
                          </div>
                          <div className="settings-toggle">
                            <button
                              className={`toggle-switch ${jiraFilters.originalEstimateEmpty ? "is-active" : ""}`}
                              onClick={() => setJiraFilters((current) => ({ ...current, originalEstimateEmpty: !current.originalEstimateEmpty }))}
                              type="button"
                            >
                              <span className="toggle-switch__knob" />
                            </button>
                            <span>Original Estimate is empty</span>
                          </div>
                        </div>
                        <label className="jira-import-order-field">
                          <span>Import order</span>
                          <select
                            value={jiraFilters.importOrder}
                            onChange={(event) =>
                              setJiraFilters((current) => ({
                                ...current,
                                importOrder: event.target.value === "priority" ? "priority" : "issue-key",
                              }))
                            }
                          >
                            <option value="issue-key">Issue key</option>
                            <option value="priority">Priority</option>
                          </select>
                        </label>
                      </div>

                      <div className="queue-jira-panel__actions">
                        <button
                          className="button-center"
                          disabled={jiraLoading}
                          onClick={() => {
                            setJiraPreviewOpen(false);
                            setJiraReimportOpen(false);
                            setJiraOpen(false);
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="button-center"
                          disabled={jiraLoading || !jiraBoardId || (jiraSprintRequired && !jiraSprintId)}
                          onClick={() => void handlePreviewJiraImport()}
                          type="button"
                        >
                          {jiraLoading ? "Loading..." : "Preview"}
                        </button>
                        <button
                          className="button-center"
                          disabled={jiraLoading || !jiraBoardId || (jiraSprintRequired && !jiraSprintId)}
                          onClick={() => void handleImportFromJira()}
                          type="button"
                        >
                          Import issues
                        </button>
                      </div>
                    </div>
                  </div>
                ) : highlightMenuOpen ? (
                  <div className="queue-jira-panel">
                    <div className="queue-jira-panel__header">
                      <div>
                        <h3>Highlight cards</h3>
                        <p>Choose how Sprinto should highlight revealed cards.</p>
                      </div>
                    </div>
                    <div className="queue-option-list">
                      {HIGHLIGHT_OPTIONS.map((option) => (
                        <button
                          className={`queue-option-item ${highlightMode === option.value ? "is-selected" : ""}`}
                          key={option.value}
                          onClick={() => {
                            void onUpdateHighlightMode(option.value);
                            setHighlightMenuOpen(false);
                          }}
                          type="button"
                        >
                          <span>{option.label}</span>
                          <strong aria-hidden="true">{highlightMode === option.value ? "✓" : ""}</strong>
                        </button>
                      ))}
                    </div>
                    <div className="queue-jira-panel__actions">
                      <button className="button-center" onClick={() => setHighlightMenuOpen(false)} type="button">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : historyOpen ? (
                  <div className="queue-jira-panel">
                    <div className="queue-jira-panel__header">
                      <div>
                        <h3>History</h3>
                        <p>Select an issue to open its full history.</p>
                      </div>
                    </div>
                    <div className="queue-option-list">
                      {pagedHistory.map((issue) => (
                        <button
                          className={`queue-option-item ${selectedIssueId === issue.id ? "is-selected" : ""}`}
                          key={issue.id}
                          onClick={() => {
                            setSelectedIssueId(issue.id);
                            setHistoryOpen(false);
                          }}
                          type="button"
                        >
                          <strong>{issue.title}</strong>
                          <span>
                            {formatHistorySummary(
                              issue.stats,
                              Object.keys(issue.votes).length,
                              hasAnyNumericVotes(Object.values(issue.votes)),
                              formatIssueDuration(issue)
                            )}
                          </span>
                        </button>
                      ))}
                      {Array.from({ length: historyPlaceholderCount }).map((_, index) => (
                        <div aria-hidden="true" className="queue-option-item queue-option-item--placeholder" key={`history-placeholder-${historyPage}-${index}`} />
                      ))}
                    </div>
                    <div className={`queue-pagination ${historyPageCount <= 1 ? "queue-pagination--single" : ""}`}>
                      <div className="queue-pagination__spacer" aria-hidden="true" />
                      <div className="queue-pagination__meta">
                        {historyPageCount > 1 ? (
                          <>
                            <button disabled={historyPage === 0} onClick={() => setHistoryPage((page) => Math.max(0, page - 1))} type="button">
                              Previous
                            </button>
                            <button
                              disabled={historyPage >= historyPageCount - 1}
                              onClick={() => setHistoryPage((page) => Math.min(historyPageCount - 1, page + 1))}
                              type="button"
                            >
                              Next
                            </button>
                          </>
                        ) : null}
                        <span className="pill queue-pagination__pill">
                          {issuesForHistory.length} | {historyPage + 1}/{historyPageCount}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="queue-list">
                      {pagedQueue.length === 0 ? (
                        <p className="queue-list__empty">
                          {queueFilter === "completed"
                            ? "No completed issues match the current view."
                            : queueFilter === "all"
                              ? "No issues match the current view."
                              : "No issues are currently waiting in the queue."}
                        </p>
                      ) : null}
                      {pagedQueue.map((issue) => {
                        const isWaitingIssue = issue.listState === "waiting" && Boolean(issue.waitingIssueId);
                        const waitingIssueId = issue.waitingIssueId || issue.id;
                        const isEditing = isWaitingIssue && editingQueueIssueId === waitingIssueId;

                        if (isEditing) {
                          return (
                            <div className="queue-item queue-item--editing" key={issue.id}>
                              <div className="queue-item__edit-fields">
                                <input
                                  aria-label="Edit story ID"
                                  className="queue-form-fields__story-id"
                                  placeholder="ID"
                                  value={editingQueueStoryId}
                                  onChange={(event) => setEditingQueueStoryId(event.target.value)}
                                />
                                <input
                                  aria-label="Edit issue title"
                                  placeholder="Issue title"
                                  value={editingQueueTitle}
                                  onChange={(event) => setEditingQueueTitle(event.target.value)}
                                />
                              </div>
                              <div className="queue-item__actions">
                                <button
                                  aria-label="Save queue item"
                                  className="queue-item__icon queue-item__icon--confirm"
                                  onClick={() => {
                                    const queueIssue = issueQueue.find((entry) => entry.id === waitingIssueId);
                                    if (queueIssue) {
                                      void submitEditingQueueIssue(queueIssue);
                                    }
                                  }}
                                  type="button"
                                >
                                  <CheckIcon />
                                </button>
                                <button
                                  aria-label="Cancel editing"
                                  className="queue-item__icon"
                                  onClick={cancelEditingQueueIssue}
                                  type="button"
                                >
                                  <CloseIcon />
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div className={`queue-item ${isWaitingIssue && !canStartQueuedIssue ? "queue-item--locked" : ""}`} key={issue.id}>
                            {isWaitingIssue ? (
                              <button
                                className={`queue-item__select ${!canStartQueuedIssue ? "is-disabled" : ""}`}
                                disabled={!canStartQueuedIssue}
                                onClick={() => void onStartQueuedIssue(waitingIssueId)}
                                type="button"
                              >
                                <div className="queue-item__line" title={formatQueuePrimaryLine(issue)}>
                                  <strong>{formatQueuePrimaryLine(issue)}</strong>
                                  <div className="queue-item__meta">
                                    <span>{formatQueueListState(issue.listState)}</span>
                                    {issue.source === "jira" ? <span>{formatQueuePriorityValue(issue)}</span> : null}
                                    {issue.source === "jira" ? <span>{formatQueueReporterValue(issue)}</span> : null}
                                  </div>
                                </div>
                              </button>
                            ) : (
                              <div className="queue-item__select queue-item__select--static">
                                <div className="queue-item__line" title={formatQueuePrimaryLine(issue)}>
                                  <strong>{formatQueuePrimaryLine(issue)}</strong>
                                  <div className="queue-item__meta">
                                    <span>{formatQueueListState(issue.listState)}</span>
                                    {issue.source === "jira" ? <span>{formatQueuePriorityValue(issue)}</span> : null}
                                    {issue.source === "jira" ? <span>{formatQueueReporterValue(issue)}</span> : null}
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className="queue-item__actions">
                              <span className="queue-item__source-tag">{formatQueueSource(issue.source)}</span>
                              {issue.externalIssueUrl ? (
                                <a
                                  aria-label="Open external issue"
                                  className="queue-item__icon"
                                  href={issue.externalIssueUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  <LinkIcon />
                                </a>
                              ) : null}
                              {isWaitingIssue ? (
                                <button
                                  aria-label="Edit queue item"
                                  className="queue-item__icon"
                                  onClick={() => {
                                    const queueIssue = issueQueue.find((entry) => entry.id === waitingIssueId);
                                    if (queueIssue) {
                                      startEditingQueueIssue(queueIssue);
                                    }
                                  }}
                                  type="button"
                                >
                                  <EditIcon />
                                </button>
                              ) : null}
                              {isWaitingIssue ? (
                                <button
                                  aria-label="Delete queue item"
                                  className="queue-item__icon queue-item__icon--danger"
                                  onClick={() => {
                                    const queueIssue = issueQueue.find((entry) => entry.id === waitingIssueId);
                                    if (queueIssue) {
                                      openDeleteQueueIssue(queueIssue);
                                    }
                                  }}
                                  type="button"
                                >
                                  <CloseIcon />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                      {Array.from({ length: queuePlaceholderCount }).map((_, index) => (
                        <div aria-hidden="true" className="queue-item queue-item--placeholder" key={`queue-placeholder-${queuePage}-${index}`} />
                      ))}
                    </div>
                    {queueDisplayItems.length > QUEUE_PAGE_SIZE ? (
                  <div className="queue-pagination">
                    {jiraMessage ? (
                      <span className={`queue-pagination__notice queue-pagination__notice--${jiraMessageTone}`}>
                        {jiraMessage}
                      </span>
                    ) : null}
                    <div className="queue-pagination__meta">
                      <button disabled={queuePage === 0} onClick={() => setQueuePage((page) => Math.max(0, page - 1))} type="button">
                        Previous
                      </button>
                      <button
                        disabled={queuePage >= queuePageCount - 1}
                        onClick={() => setQueuePage((page) => Math.min(queuePageCount - 1, page + 1))}
                        type="button"
                      >
                        Next
                      </button>
                      <span className="pill queue-pagination__pill">
                        {queueDisplayItems.length} | {queuePage + 1}/{queuePageCount}
                      </span>
                    </div>
                  </div>
                    ) : (
                      <div className="queue-pagination queue-pagination--single">
                        {jiraMessage ? (
                          <span className={`queue-pagination__notice queue-pagination__notice--${jiraMessageTone}`}>
                            {jiraMessage}
                          </span>
                        ) : null}
                        <div className="queue-pagination__meta">
                          <span className="pill queue-pagination__pill">
                            {queueDisplayItems.length} | {queuePage + 1}/{queuePageCount}
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              ) : null}
            </div>
          ) : canViewHistory ? (
            <div className="post-vote-bar">
              <button
                className="ghost-button ghost-button--strong"
                onClick={() => {
                  if (isHistoryPreview) {
                    setSelectedIssueId(null);
                    setHistoryOpen(false);
                  } else {
                    setHistoryOpen(true);
                  }
                }}
                type="button"
              >
                {isHistoryPreview ? "Back to current" : "History"}
              </button>
            </div>
          ) : null}

          {isHistoryPreview ? (
            <div className="timeline-panel card card--compact">
              <div
                className="timeline-track"
                onPointerDown={(event) => {
                  if (!timelineTrackRef.current) {
                    return;
                  }
                  draggingTimelineRef.current = true;
                  setHistoryPlayback(playbackFromPointer(event.clientX, timelineTrackRef.current));
                }}
                ref={timelineTrackRef}
                style={timelineTrackStyle(timelineLayout)}
              >
                <div
                  className={`timeline-anchor timeline-anchor--start timeline-anchor--${timelineLayout.start.side}`}
                  style={timelineMarkerStyle(timelineLayout.start)}
                  title={timelineTooltip(timelineLayout.start.title, timelineLayout.start.time)}
                >
                  <span aria-hidden="true" className="timeline-anchor__connector" />
                  <span className="timeline-anchor__label">
                    <strong>{timelineLayout.start.title}</strong>
                    <span>{timelineLayout.start.time}</span>
                  </span>
                </div>
                {timelineLayout.events.map((layout) => (
                  <div
                    className={`timeline-point timeline-point--${layout.event.type} timeline-point--${layout.side}`}
                    key={`${layout.event.type}-${layout.event.occurredAt}-${layout.event.participantId ?? layout.event.value ?? "room"}`}
                    style={timelineMarkerStyle(layout)}
                    title={timelineTooltip(layout.title, layout.time)}
                  >
                    <span aria-hidden="true" className="timeline-point__connector" />
                    <span className="timeline-point__label">
                      <strong>{layout.title}</strong>
                      <span>{layout.time}</span>
                    </span>
                  </div>
                ))}
                <div
                  className={`timeline-anchor timeline-anchor--reveal timeline-anchor--${timelineLayout.reveal.side}`}
                  style={timelineMarkerStyle(timelineLayout.reveal)}
                  title={timelineTooltip(timelineLayout.reveal.title, timelineLayout.reveal.time)}
                >
                  <span aria-hidden="true" className="timeline-anchor__connector" />
                  <span className="timeline-anchor__label">
                    <strong>{timelineLayout.reveal.title}</strong>
                    <span>{timelineLayout.reveal.time}</span>
                  </span>
                </div>
                <div
                  className="timeline-thumb"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    draggingTimelineRef.current = true;
                  }}
                  style={{ left: `${playbackToTrackPercent(historyPlayback)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {jiraPreviewOpen ? (
        <div className="modal-overlay modal-overlay--stacked" onClick={closeJiraPreview} role="presentation">
          <div className="card jira-preview-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="history-panel__header">
              <div>
                <h2>Jira preview</h2>
                <p className="share-modal__hint">
                  {jiraPreviewIssues.length > 0
                    ? `${jiraPreviewIssues.length} issues match the current import rules.`
                    : "No issues matched the current import rules."}
                </p>
              </div>
              <button className="ghost-button" onClick={closeJiraPreview} type="button">Close</button>
            </div>
            {jiraPreviewIssues.length > 0 ? (
              <div className="jira-preview-table-wrap jira-preview-table-wrap--compact">
                <table className="jira-preview-table jira-preview-table--compact">
                  <thead>
                    <tr>
                      <th>Issue</th>
                      <th>Type</th>
                      <th>Reporter</th>
                      <th>Priority</th>
                      <th>Story Points</th>
                      <th>Original Estimate</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jiraPreviewIssues.map((issue) => (
                      <tr key={issue.id}>
                        <td>
                          <div className="jira-preview-table__issue">
                            <strong>{issue.key}</strong>
                            <span>{issue.title}</span>
                          </div>
                        </td>
                        <td>{issue.issueType || "-"}</td>
                        <td>{issue.reporter || "-"}</td>
                        <td>{issue.priority?.name || "-"}</td>
                        <td>{issue.storyPoints ?? "-"}</td>
                        <td>{formatSecondsAsEstimate(issue.originalEstimateSeconds)}</td>
                        <td>{issue.status || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="settings-help settings-help--modal-spaced">Try changing the Jira scope or import rules and preview again.</p>
            )}
          </div>
        </div>
      ) : null}

      {jiraReimportOpen ? (
        <div className="modal-overlay modal-overlay--stacked" onClick={closeJiraReimport} role="presentation">
          <div className="card admin-modal admin-modal--confirm jira-reimport-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="jira-reimport-header">
              <h2>Re-import Jira issues</h2>
              <p className="share-modal__hint">Sprinto will sync the room queue to the current Jira selection.</p>
            </div>
            <div className="jira-reimport-info-grid">
              <div className="jira-reimport-note">
                {jiraImportScopeSummary.queuedCount} queued Jira issue{jiraImportScopeSummary.queuedCount === 1 ? "" : "s"} from this Jira scope will be refreshed.
              </div>
              <div className="jira-reimport-note">
                Queue items that are no longer in the selected Jira scope or no longer match the current filters will be removed.
              </div>
            </div>
            <div className="jira-reimport-summary">
              {jiraImportScopeSummary.completedCount > 0 ? (
                <div className="jira-reimport-choice-group">
                  <p className="jira-reimport-choice-group__summary">
                    {jiraImportScopeSummary.completedCount} already voted Jira issue{jiraImportScopeSummary.completedCount === 1 ? " was" : "s were"} found in the current issue/history for this Jira scope. Choose whether Sprinto should add {jiraImportScopeSummary.completedCount === 1 ? "it" : "them"} back into the queue.
                  </p>
                  <label className={`jira-reimport-choice ${jiraReimportCompletedChoice === "skip" ? "is-selected" : ""}`}>
                    <input
                      checked={jiraReimportCompletedChoice === "skip"}
                      name="jira-reimport-completed"
                      onChange={() => setJiraReimportCompletedChoice("skip")}
                      type="radio"
                    />
                    <div>
                      <strong>Do not re-import them</strong>
                      <span>Keep already voted issues only in history/current issue and sync the remaining queue.</span>
                    </div>
                  </label>
                  <label className={`jira-reimport-choice ${jiraReimportCompletedChoice === "include" ? "is-selected" : ""}`}>
                    <input
                      checked={jiraReimportCompletedChoice === "include"}
                      name="jira-reimport-completed"
                      onChange={() => setJiraReimportCompletedChoice("include")}
                      type="radio"
                    />
                    <div>
                      <strong>Re-import them to the queue</strong>
                      <span>Add already voted issues back into the queue if they are still present in Jira.</span>
                    </div>
                  </label>
                </div>
              ) : null}
            </div>
            <div className="admin-modal-actions jira-reimport-actions">
              <button className="button-center" disabled={jiraLoading} onClick={closeJiraReimport} type="button">
                Cancel
              </button>
              <button
                className="button-center"
                disabled={jiraLoading || (jiraImportScopeSummary.completedCount > 0 && !jiraReimportCompletedChoice)}
                onClick={() => void confirmJiraReimport()}
                type="button"
              >
                {jiraLoading ? "Syncing..." : "Sync queue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {shareOpen ? (
        <div className="modal-overlay" onClick={() => setShareOpen(false)} role="presentation">
          <div className="history-modal card share-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="history-panel__header">
              <div>
                <h2>Share room</h2>
                <p className="share-modal__hint">Send this room link to everyone who should join the voting table.</p>
              </div>
              <button className="ghost-button" onClick={() => setShareOpen(false)} type="button">Close</button>
            </div>
            <label className="share-modal__label" htmlFor="share-room-url">Room URL</label>
            <input id="share-room-url" readOnly value={roomUrl} />
            <div className="share-actions">
              <button className="share-action-pill" onClick={() => void handleCopyRoomUrl()} type="button">
                <strong aria-hidden="true">{shareCopied ? "✓" : "⧉"}</strong>
                <span>{shareCopied ? "Copied" : "Copy"}</span>
              </button>
              <a className="share-action-pill share-action-pill--link" href={shareMailto}>
                <strong aria-hidden="true">✉</strong>
                <span>Email</span>
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {queueDeleteTarget ? (
        <div className="modal-overlay modal-overlay--confirm" onClick={closeDeleteQueueIssue} role="presentation">
          <div className="card admin-modal admin-modal--confirm" onClick={(event) => event.stopPropagation()}>
            <h2>Confirm Deletion</h2>
            <p>
              Are you sure you want to delete the queue item "{queueDeleteTarget.title}"? This action cannot be undone.
            </p>
            <div className="admin-modal-actions">
              <button className="button-center" disabled={queueDeleteBusy} onClick={closeDeleteQueueIssue} type="button">
                Cancel
              </button>
              <button
                className="button-center delete-button"
                disabled={queueDeleteBusy}
                onClick={() => void confirmDeleteQueueIssue()}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {closePokerConfirmOpen ? (
        <div className="modal-overlay modal-overlay--confirm" onClick={() => setClosePokerConfirmOpen(false)} role="presentation">
          <div className="card admin-modal admin-modal--confirm" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <h2>Close Poker</h2>
            <p>
              Are you sure you want to close poker for the current issue? This will finish the current voting round.
            </p>
            <div className="admin-modal-actions">
              <button className="button-center" onClick={() => setClosePokerConfirmOpen(false)} type="button">
                Cancel
              </button>
              <button className="button-center" onClick={() => void confirmClosePoker()} type="button">
                Close poker
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {roomDeleteOpen ? (
        <div className="modal-overlay modal-overlay--confirm" onClick={closeDeleteRoomConfirm} role="presentation">
          <div className="card admin-modal admin-modal--confirm" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <h2>Delete Room</h2>
            <p>
              Are you sure you want to delete the room "{snapshot.room.name}"? This action cannot be undone.
            </p>
            <div className="admin-modal-actions">
              <button className="button-center" disabled={roomDeleteBusy} onClick={closeDeleteRoomConfirm} type="button">
                Cancel
              </button>
              <button
                className="button-center delete-button"
                disabled={roomDeleteBusy}
                onClick={() => void confirmDeleteRoom()}
                type="button"
              >
                {roomDeleteBusy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildHistoryFrame(issue: Issue | null, playbackPercent: number): HistoryFrame | null {
  if (!issue || !issue.startedAt) {
    return null;
  }

  const start = new Date(issue.startedAt).getTime();
  const end = issue.endedAt ? new Date(issue.endedAt).getTime() : issue.revealedAt ? new Date(issue.revealedAt).getTime() : start;
  const previewAtMs = start + (playbackPercent / 100) * Math.max(1, end - start);
  const visibleVotes = Object.fromEntries(
    Object.entries(issue.votes).filter(([, vote]) => new Date(vote.votedAt).getTime() <= previewAtMs)
  );
  const participants = new Map<string, Participant>();

  [...issue.events]
    .sort((left, right) => +new Date(left.occurredAt) - +new Date(right.occurredAt))
    .filter((event) => +new Date(event.occurredAt) <= previewAtMs)
    .forEach((event) => {
      if (event.type === "join" && event.participantId) {
        const nameParts = parseNameParts(event.participantName ?? event.participantId);
        participants.set(event.participantId, {
          id: event.participantId,
          firstName: nameParts.firstName,
          lastName: nameParts.lastName,
          voted: Boolean(visibleVotes[event.participantId]),
          canVote: event.participantCanVote ?? true,
        });
      }
      if (event.type === "leave" && event.participantId) {
        participants.delete(event.participantId);
      }
    });

  Object.keys(visibleVotes).forEach((participantId) => {
    const current = participants.get(participantId);
    if (current) {
      participants.set(participantId, { ...current, voted: true });
    }
  });

  const revealAtMs = issue.revealedAt ? new Date(issue.revealedAt).getTime() : end;

  return {
    previewAtMs,
    revealed: previewAtMs >= revealAtMs,
    visibleVotes,
    visibleParticipants: Array.from(participants.values()),
    stats: statsFromVotes(Object.values(visibleVotes))
  };
}

function formatSecondsAsEstimate(seconds: number | null) {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) {
    return "-";
  }

  const totalMinutes = Math.round(Number(seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
}

function formatJiraImportSummary(result: JiraImportSyncResult) {
  const parts = [
    `${result.addedCount} added`,
    `${result.updatedCount} updated`,
  ];

  if (result.reimportedCompletedCount > 0) {
    parts.push(`${result.reimportedCompletedCount} already voted issue${result.reimportedCompletedCount === 1 ? "" : "s"} re-added`);
  }
  if (result.skippedCount > 0) {
    parts.push(`${result.skippedCount} already existed outside the queue`);
  }
  if (result.deduplicatedCount > 0) {
    parts.push(`${result.deduplicatedCount} duplicate queue item${result.deduplicatedCount === 1 ? "" : "s"} removed`);
  }
  if (result.removedCount > 0) {
    const listedKeys = result.removedIssueKeys.slice(0, 3).filter(Boolean).join(", ");
    const moreCount = Math.max(0, result.removedIssueKeys.length - 3);
    const suffix = listedKeys
      ? ` (${listedKeys}${moreCount > 0 ? `, +${moreCount} more` : ""})`
      : "";
    parts.push(`${result.removedCount} removed because they are no longer in the selected Jira scope/filter${suffix}`);
  }

  return `Jira import: ${parts.join(", ")}`;
}

function formatJiraBoardLabel(board: JiraBoard) {
  const type = String(board.type || "").trim().toLowerCase();
  if (type === "kanban") {
    return `${board.name} (Kanban)`;
  }
  if (type === "scrum") {
    return `${board.name} (Scrum)`;
  }
  return board.name;
}

function summarizeJiraImportScope(snapshot: RoomSnapshot, boardId: string, sprintId: string) {
  const normalizedBoardId = String(boardId || "").trim();
  const normalizedSprintId = String(sprintId || "").trim();
  if (!normalizedBoardId) {
    return {
      hasExistingImport: false,
      queuedCount: 0,
      completedCount: 0,
    };
  }

  const isSameScope = (issue?: Issue | IssueQueueItem | null) =>
    Boolean(
      issue?.externalIssueId &&
      issue.importedFromBoardId === normalizedBoardId &&
      issue.importedFromSprintId === normalizedSprintId
    );

  const queuedIds = new Set(
    snapshot.room.issueQueue
      .filter((issue) => isSameScope(issue))
      .map((issue) => issue.externalIssueId)
      .filter(Boolean)
  );

  const completedIds = new Set<string>();
  const currentIssue = snapshot.room.currentIssue;
  if (isSameScope(currentIssue) && currentIssue.title !== "-") {
    completedIds.add(currentIssue.externalIssueId);
  }
  for (const issue of snapshot.room.issueHistory) {
    if (isSameScope(issue)) {
      completedIds.add(issue.externalIssueId);
    }
  }

  return {
    hasExistingImport: queuedIds.size > 0 || completedIds.size > 0,
    queuedCount: queuedIds.size,
    completedCount: completedIds.size,
  };
}

function buildTimelineEvents(issue: Issue) {
  return [...(issue.events ?? [])]
    .filter((event) => event.type !== "reveal")
    .filter((event) => shouldShowTimelineEvent(issue, event))
    .sort((left, right) => +new Date(left.occurredAt) - +new Date(right.occurredAt));
}

function shouldShowTimelineEvent(issue: Issue, event: IssueEvent) {
  if (event.type !== "join" && event.type !== "leave") {
    return true;
  }
  const issueStart = new Date(issue.startedAt).getTime();
  const occurredAt = new Date(event.occurredAt).getTime();
  if (Number.isNaN(issueStart) || Number.isNaN(occurredAt)) {
    return true;
  }
  return occurredAt - issueStart > TIMELINE_START_PRESENCE_GRACE_MS;
}

function buildTimelineLayout(issue: Issue, events: IssueEvent[]): TimelineLayout {
  const occupiedBySide: Record<TimelineMarkerSide, TimelineInterval[][]> = {
    above: [],
    below: [],
  };
  const start = createTimelineAnchorLayout("start", "Start", formatTimelineTime(issue.startedAt, issue.startedAt), TIMELINE_START, occupiedBySide);
  const reveal = createTimelineAnchorLayout(
    "reveal",
    "Reveal",
    formatTimelineTime(issue.revealedAt || issue.endedAt || issue.startedAt, issue.startedAt),
    TIMELINE_END,
    occupiedBySide
  );
  const startInterval = intervalFromTimelineLabel(start.positionPercent, labelWidthPxToPercent(start.labelWidthPx));
  const revealInterval = intervalFromTimelineLabel(reveal.positionPercent, labelWidthPxToPercent(reveal.labelWidthPx));
  const eventsLayout = events.map((event, index) => {
    const title = timelineTitle(event);
    const time = formatTimelineTime(event.occurredAt, issue.startedAt);
    const positionPercent = eventOffsetPercent(event, issue);
    const labelMetrics = estimateTimelineLabelMetrics(title, time);
    const interval = intervalFromTimelineLabel(positionPercent, labelMetrics.widthPercent);
    const defaultSide: TimelineMarkerSide = index % 2 === 0 ? "below" : "above";
    const overlapsAnchor = intervalOverlaps(interval, startInterval, 1.25) || intervalOverlaps(interval, revealInterval, 1.25);
    const side: TimelineMarkerSide = overlapsAnchor && defaultSide === "above" ? "below" : defaultSide;
    const lane = allocateTimelineLane(occupiedBySide[side], interval, 1.25);
    return {
      event,
      lane,
      labelWidthPx: labelMetrics.widthPx,
      positionPercent,
      side,
      time,
      title,
    };
  });
  const maxAboveLane = Math.max(start.lane, reveal.lane, ...eventsLayout.filter((event) => event.side === "above").map((event) => event.lane));
  const maxBelowLane = Math.max(0, ...eventsLayout.filter((event) => event.side === "below").map((event) => event.lane));
  const labelHeight = 38;
  const connectorOffset = 44;
  const laneStep = 36;
  const topClearance = connectorOffset + labelHeight + maxAboveLane * laneStep;
  const bottomClearance = connectorOffset + labelHeight + maxBelowLane * laneStep;

  return {
    events: eventsLayout,
    reveal,
    start,
    trackMinHeightPx: Math.max(170, topClearance + bottomClearance + 24),
  };
}

function createTimelineAnchorLayout(
  key: "start" | "reveal",
  title: string,
  time: string,
  positionPercent: number,
  occupiedBySide: Record<TimelineMarkerSide, TimelineInterval[][]>
): TimelineAnchorLayout {
  const labelMetrics = estimateTimelineLabelMetrics(title, time);
  const interval = intervalFromTimelineLabel(positionPercent, labelMetrics.widthPercent);
  const side: TimelineMarkerSide = "above";
  const lane = allocateTimelineLane(occupiedBySide[side], interval, 1.25);
  return {
    key,
    lane,
    labelWidthPx: labelMetrics.widthPx,
    positionPercent,
    side,
    time,
    title,
  };
}

function allocateTimelineLane(lanes: TimelineInterval[][], nextInterval: TimelineInterval, gapPercent: number) {
  let lane = 0;
  while (lane < lanes.length) {
    const hasCollision = lanes[lane].some((interval) => (
      nextInterval.start < interval.end + gapPercent && nextInterval.end > interval.start - gapPercent
    ));
    if (!hasCollision) {
      break;
    }
    lane += 1;
  }
  if (!lanes[lane]) {
    lanes[lane] = [];
  }
  lanes[lane].push(nextInterval);
  return lane;
}

function intervalFromTimelineLabel(positionPercent: number, widthPercent: number): TimelineInterval {
  const start = clampNumber(positionPercent - widthPercent / 2, 1.5, 98.5 - widthPercent);
  return {
    end: start + widthPercent,
    start,
  };
}

function intervalOverlaps(left: TimelineInterval, right: TimelineInterval, gapPercent: number) {
  return left.start < right.end + gapPercent && left.end > right.start - gapPercent;
}

function estimateTimelineLabelMetrics(title: string, time: string) {
  const longestLine = Math.max(title.length, time.length, 6);
  return {
    widthPercent: clampNumber(longestLine * 0.92, 10.5, 18),
    widthPx: clampNumber(longestLine * 7 + 28, 92, 144),
  };
}

function labelWidthPxToPercent(widthPx: number) {
  return clampNumber((widthPx / 144) * 18, 10.5, 18);
}

function eventOffsetPercent(event: IssueEvent, issue: Issue) {
  const start = new Date(issue.startedAt).getTime();
  const end = issue.endedAt ? new Date(issue.endedAt).getTime() : issue.revealedAt ? new Date(issue.revealedAt).getTime() : Date.now();
  const current = new Date(event.occurredAt).getTime();
  const span = Math.max(1, end - start);
  return TIMELINE_START + Math.max(0, Math.min(TIMELINE_END - TIMELINE_START, ((current - start) / span) * (TIMELINE_END - TIMELINE_START)));
}

function timelineMarkerStyle(layout: TimelineMarkerLayout): CSSProperties {
  return {
    "--timeline-lane": layout.lane,
    "--timeline-label-width": `${layout.labelWidthPx}px`,
    left: `${layout.positionPercent}%`,
  } as CSSProperties;
}

function timelineTrackStyle(layout: TimelineLayout): CSSProperties {
  return {
    minHeight: layout.trackMinHeightPx,
  };
}

function timelineTitle(event: IssueEvent) {
  if (event.type === "vote") {
    return event.value ? `${shortName(event.participantName ?? event.participantId)} (${event.value})` : `${shortName(event.participantName ?? event.participantId)} vote`;
  }
  if (event.type === "join") {
    return `${shortName(event.participantName ?? event.participantId)} joined`;
  }
  if (event.type === "leave") {
    return `${shortName(event.participantName ?? event.participantId)} left`;
  }
  return "Event";
}

function timelineTooltip(title: string, time: string) {
  return `${title} | ${time}`;
}

function formatTimelineTime(value?: string, startedAt?: string) {
  if (!value) {
    return "--:--:--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  const start = new Date(startedAt || "").getTime();
  if (Number.isFinite(start) && date.getTime() >= start) {
    return formatTimelineOffset(date.getTime() - start);
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatIssueDuration(issue: Issue, previewAtMs?: number) {
  if (!issue.startedAt || issue.title === "-" || issue.status === "idle") {
    return "--:--";
  }
  const end =
    previewAtMs ??
    (issue.endedAt
      ? new Date(issue.endedAt).getTime()
      : issue.revealedAt
        ? new Date(issue.revealedAt).getTime()
        : Date.now());
  const start = new Date(issue.startedAt).getTime();
  const diffSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(diffSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (diffSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function statsFromVotes(votes: Vote[]) {
  const values = votes
    .map((vote) => Number(vote.value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (values.length === 0) {
    return { average: null, median: null };
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];

  return { average, median };
}

function hasAnyNumericVotes(votes: Vote[]) {
  return votes.some((vote) => Number.isFinite(Number(vote.value)));
}

function formatRoundSummary(
  revealed: boolean,
  stats: { average: number | null; median: number | null },
  voteCount: number,
  hasNumericVoteStats: boolean
) {
  if (!hasNumericVoteStats) {
    return `Votes ${voteCount}`;
  }

  if (!revealed) {
    return `Avg n/a | Median n/a | Votes ${voteCount}`;
  }

  return `Avg ${stats.average ?? "n/a"} | Median ${stats.median ?? "n/a"} | Votes ${voteCount}`;
}

function formatHistorySummary(
  stats: { average: number | null; median: number | null },
  voteCount: number,
  hasNumericVoteStats: boolean,
  durationLabel: string
) {
  if (!hasNumericVoteStats) {
    return `Votes ${voteCount} | ${durationLabel}`;
  }

  return `Avg ${stats.average ?? "n/a"} | Median ${stats.median ?? "n/a"} | Votes ${voteCount} | ${durationLabel}`;
}

function shortName(value?: string) {
  const parts = value?.split(" ").filter(Boolean) ?? [];
  if (parts.length === 0) {
    return "User";
  }
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTimelineOffset(diffMs: number) {
  const totalSeconds = Math.max(0, Math.round(diffMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return totalSeconds === 0 ? "0:00" : `+${minutes}:${String(seconds).padStart(2, "0")}`;
}

function parseNameParts(value?: string): { firstName: string; lastName: string } {
  const parts = (value ?? "").split(" ").filter(Boolean);
  const firstName = parts[0] ?? "";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  return { firstName, lastName };
}

function playbackToTrackPercent(playback: number) {
  const clamped = Math.max(TIMELINE_MIN, Math.min(TIMELINE_MAX, playback));
  return ((clamped - TIMELINE_MIN) / (TIMELINE_MAX - TIMELINE_MIN)) * 100;
}

function playbackFromPointer(clientX: number, track: HTMLDivElement) {
  const rect = track.getBoundingClientRect();
  const relative = (clientX - rect.left) / Math.max(1, rect.width);
  const clamped = Math.max(0, Math.min(1, relative));
  return TIMELINE_MIN + clamped * (TIMELINE_MAX - TIMELINE_MIN);
}

function formatStatusLabel(status: string) {
  if (!status) {
    return "-";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function splitQueueIssueTitle(title: string) {
  const separatorMatch = title.match(/^([A-Za-z][A-Za-z0-9_-]*-\d+)\s*-\s+(.+)$/);
  if (separatorMatch) {
    return { storyId: separatorMatch[1], title: separatorMatch[2] };
  }

  const prefixedMatch = title.match(/^([A-Za-z][A-Za-z0-9_-]*-\d+)\s+(.+)$/);
  if (prefixedMatch) {
    return { storyId: prefixedMatch[1], title: prefixedMatch[2] };
  }

  return { storyId: "", title };
}

function formatQueueSource(source: string) {
  if (source === "jira") {
    return "JIRA";
  }
  return "Manual";
}

function formatQueueListState(state: QueueDisplayItem["listState"]) {
  return state === "completed" ? "Completed" : "Waiting";
}

function formatQueuePrimaryLine(item: Pick<QueueDisplayItem, "title" | "externalIssueKey">) {
  const parsed = splitQueueIssueTitle(item.title);
  const issueKey = String(item.externalIssueKey || parsed.storyId || "").trim();
  const normalizedTitle = issueKey && parsed.storyId === issueKey ? parsed.title : item.title;
  return issueKey ? `${issueKey} - ${normalizedTitle}` : normalizedTitle;
}

function getQueuePriorityName(item: Pick<QueueDisplayItem, "jiraFieldsSnapshot">) {
  const priority = item.jiraFieldsSnapshot?.priority;
  if (!priority || typeof priority !== "object" || Array.isArray(priority)) {
    return "";
  }
  return String((priority as { name?: string }).name || "").trim();
}

function getQueueReporterName(item: Pick<QueueDisplayItem, "jiraFieldsSnapshot">) {
  const reporter = item.jiraFieldsSnapshot?.reporter;
  if (!reporter || typeof reporter !== "object" || Array.isArray(reporter)) {
    return "";
  }
  const candidate = reporter as { displayName?: string; emailAddress?: string };
  return String(candidate.displayName || candidate.emailAddress || "").trim();
}

function formatQueuePriorityValue(item: Pick<QueueDisplayItem, "jiraFieldsSnapshot">) {
  const priority = getQueuePriorityName(item);
  return priority || "-";
}

function formatQueueReporterValue(item: Pick<QueueDisplayItem, "jiraFieldsSnapshot">) {
  const reporter = getQueueReporterName(item);
  return reporter || "-";
}

function queuePriorityWeight(item: Pick<QueueDisplayItem, "jiraFieldsSnapshot">) {
  const priority = item.jiraFieldsSnapshot?.priority;
  const name = getQueuePriorityName(item).toLowerCase();
  const idNumber = priority && typeof priority === "object" && !Array.isArray(priority)
    ? Number((priority as { id?: string | number }).id)
    : Number.NaN;
  const namedWeights: Record<string, number> = {
    highest: 0,
    high: 1,
    medium: 2,
    low: 3,
    lowest: 4,
  };

  if (Object.prototype.hasOwnProperty.call(namedWeights, name)) {
    return namedWeights[name];
  }
  if (Number.isFinite(idNumber)) {
    return idNumber;
  }
  return 999;
}

function buildQueueDisplayItems(snapshot: RoomSnapshot, filterValue: QueueFilterValue, sortValue: QueueSortValue) {
  const waitingItems: QueueDisplayItem[] = snapshot.room.issueQueue.map((issue) => ({
    id: issue.id,
    title: issue.title,
    source: issue.source,
    externalIssueUrl: issue.externalIssueUrl,
    externalIssueKey: issue.externalIssueKey,
    jiraFieldsSnapshot: issue.jiraFieldsSnapshot,
    listState: "waiting",
    waitingIssueId: issue.id,
  }));
  const completedItems: QueueDisplayItem[] = historyIssues(snapshot).map((issue) => ({
    id: issue.id,
    title: issue.title,
    source: issue.externalSource === "jira" ? "jira" : issue.externalSource || "manual",
    externalIssueUrl: issue.externalIssueUrl,
    externalIssueKey: issue.externalIssueKey,
    jiraFieldsSnapshot: issue.jiraFieldsSnapshot,
    listState: "completed",
  }));

  const selectedItems =
    filterValue === "waiting"
      ? waitingItems
      : filterValue === "completed"
        ? completedItems
        : [...waitingItems, ...completedItems];

  return [...selectedItems].sort((left, right) => {
    if (sortValue === "priority") {
      const weightDifference = queuePriorityWeight(left) - queuePriorityWeight(right);
      if (weightDifference !== 0) {
        return weightDifference;
      }
    } else if (sortValue === "reporter") {
      const leftReporter = getQueueReporterName(left);
      const rightReporter = getQueueReporterName(right);
      if (leftReporter && !rightReporter) {
        return -1;
      }
      if (!leftReporter && rightReporter) {
        return 1;
      }
      const reporterDifference = leftReporter.localeCompare(rightReporter);
      if (reporterDifference !== 0) {
        return reporterDifference;
      }
    }

    return left.title.localeCompare(right.title);
  });
}

function formatJiraNumber(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) {
    return "";
  }
  return String(Number(value)).replace(/\.0$/, "");
}

function formatEstimateFromStoryPoints(storyPoints: number | null, minutesPerStoryPoint: number) {
  if (!Number.isFinite(Number(storyPoints))) {
    return "";
  }
  const totalMinutes = Math.max(1, Math.round(Number(storyPoints) * minutesPerStoryPoint));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
}

function suggestJiraStoryPoints(issue: Issue, deck: string[], strategy: JiraSuggestionStrategy) {
  const numericVotes = Object.values(issue.votes || {})
    .map((vote) => Number(vote.value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (numericVotes.length === 0) {
    return issue.stats.median ?? issue.stats.average ?? null;
  }

  if (strategy === "average") {
    return issue.stats.average ?? numericVotes[numericVotes.length - 1];
  }

  if (strategy === "median") {
    return issue.stats.median ?? numericVotes[Math.floor(numericVotes.length / 2)];
  }

  if (strategy === "most-frequent") {
    const counts = new Map<number, number>();
    numericVotes.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
    const highestCount = Math.max(...counts.values());
    const winners = [...counts.entries()].filter(([, count]) => count === highestCount).map(([value]) => value);
    if (winners.length === 1 && highestCount > 1) {
      return winners[0];
    }
  }

  const deckRanks = new Map(deck.map((value, index) => [Number(value), index]));
  return [...numericVotes].sort((left, right) => {
    const leftRank = deckRanks.get(left) ?? left;
    const rightRank = deckRanks.get(right) ?? right;
    return rightRank - leftRank;
  })[0];
}

function formatJiraSentAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatJiraDeliverySuccessMessage(sentEstimate: boolean, sentAssignee: boolean, sentReport: boolean) {
  const sentCount = [sentEstimate, sentAssignee, sentReport].filter(Boolean).length;

  if (sentCount > 1) {
    return "Selected Jira actions were sent.";
  }
  if (sentEstimate) {
    return "Jira estimate was sent.";
  }
  if (sentAssignee) {
    return "Jira assignee was updated.";
  }
  return "Jira report was sent.";
}

function filterJiraAssignableUsers(users: JiraAssignableUser[], search: string) {
  const normalizedSearch = String(search || "").trim().toLowerCase();
  if (!normalizedSearch) {
    return users;
  }

  return users.filter((user) => {
    const haystack = [
      user.displayName,
      user.emailAddress,
      user.accountId,
    ].map((value) => String(value || "").toLowerCase());
    return haystack.some((value) => value.includes(normalizedSearch));
  });
}

function getAvatarInitials(displayName: string) {
  const parts = String(displayName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "?";
  }

  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

function getHighlightedValues(
  votesByParticipant: Record<string, Vote>,
  deck: string[],
  revealed: boolean,
  mode: HighlightMode
) {
  if (!revealed || mode === "none") {
    return new Set<string>();
  }

  const values = Object.values(votesByParticipant)
    .map((vote) => vote.value)
    .filter((value) => value && value !== "-");

  if (values.length === 0) {
    return new Set<string>();
  }

  if (mode === "most-frequent") {
    const counts = new Map<string, number>();
    values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
    const highestCount = Math.max(...counts.values());
    if (highestCount < 2) {
      return new Set<string>();
    }
    const winners = [...counts.entries()].filter(([, count]) => count === highestCount);
    if (winners.length !== 1) {
      return new Set<string>();
    }
    return new Set([winners[0][0]]);
  }

  const deckRanks = new Map(deck.map((value, index) => [value, index]));
  let highestRank = -Infinity;
  const selected = new Set<string>();

  values.forEach((value) => {
    const rank = rankHighlightedValue(value, deckRanks);
    if (rank > highestRank) {
      highestRank = rank;
      selected.clear();
      selected.add(value);
      return;
    }
    if (rank === highestRank) {
      selected.add(value);
    }
  });

  return selected;
}

function rankHighlightedValue(value: string, deckRanks: Map<string, number>) {
  if (value === "?") {
    return Number.NEGATIVE_INFINITY;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  return deckRanks.get(value) ?? -1;
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 4.2 4.2L19 6.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 1 0-7.07-7.07L10.9 5" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 1 0 7.07 7.07L13.1 19" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m8 6-3 3-3-3" />
      <path d="M5 9V4" />
      <path d="m16 18 3-3 3 3" />
      <path d="M19 15v5" />
      <path d="M11 6h3" />
      <path d="M11 12h6" />
      <path d="M11 18h9" />
    </svg>
  );
}

function historyIssues(snapshot: RoomSnapshot) {
  if (snapshot.room.status !== "revealed" && snapshot.room.status !== "closed") {
    return snapshot.room.issueHistory;
  }

  const currentIssue = snapshot.room.currentIssue;
  const alreadyInHistory = snapshot.room.issueHistory.some((issue) => issue.id === currentIssue.id);
  if (currentIssue.title === "-" || alreadyInHistory) {
    return snapshot.room.issueHistory;
  }

  return [currentIssue, ...snapshot.room.issueHistory];
}
