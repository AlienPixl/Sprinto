import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { JiraAssignableUser, JiraIssueLinkType, JiraWorklogGroupBy, JiraWorklogIssue, JiraWorklogReport, JiraWorklogRequest, JiraWorklogRow } from "../lib/types";

type WorklogViewProps = {
  onLoadIssue: (issueKey: string) => Promise<JiraWorklogIssue>;
  onLoadIssues: (query?: string) => Promise<JiraWorklogIssue[]>;
  onLoadLinkTypes?: () => Promise<JiraIssueLinkType[]>;
  onLoadReport: (payload: JiraWorklogRequest) => Promise<JiraWorklogReport>;
  onLoadUsers: (query?: string) => Promise<JiraAssignableUser[]>;
};

type WorklogChartType = "donut" | "treemap";
type WorklogSortDirection = "asc" | "desc";
type WorklogSortColumn = JiraWorklogGroupBy | "time";

type WorklogSortState = {
  column: WorklogSortColumn;
  direction: WorklogSortDirection;
};

type GroupedRow = {
  id: string;
  epic: string;
  epicMeta: string;
  epicUrl: string;
  issue: string;
  issueMeta: string;
  issueUrl: string;
  sourceIssue: string;
  sourceIssueMeta: string;
  sourceIssueUrl: string;
  sourceLabel: string;
  user: string;
  userMeta: string;
  secondsSpent: number;
};

type GroupedBlock = {
  id: string;
  primaryGroupBy: JiraWorklogGroupBy;
  primaryLabel: string;
  rows: GroupedRow[];
  totalSeconds: number;
};

type WorklogChartDatum = {
  label: string;
  secondsSpent: number;
  color: string;
  title: string;
  url: string;
};

type WorklogGrouping = {
  primary: JiraWorklogGroupBy;
  secondary: JiraWorklogGroupBy | "";
};

const DEFAULT_REQUEST: JiraWorklogRequest = {
  dateFrom: new Date().toISOString().slice(0, 10),
  dateTo: new Date().toISOString().slice(0, 10),
  issueKeys: [],
  projectKeys: [],
  includeEpicChildren: true,
  includeLinkedIssues: false,
  linkedIssueTypeIds: [],
  assigneeAccountIds: [],
  groupIds: [],
  viewMode: "issue-first",
  primaryGroupBy: "issue",
  secondaryGroupBy: "",
};

const CHART_COLORS = ["#f4a261", "#78c6a3", "#6ea8fe", "#f28482", "#e9c46a", "#cdb4db", "#84dcc6", "#f7b267"];
const GROUP_BY_LABELS: Record<JiraWorklogGroupBy, string> = {
  epic: "Epic",
  issue: "Issue",
  user: "User",
};

const TABLE_COLUMN_LABELS: Record<WorklogSortColumn, string> = {
  ...GROUP_BY_LABELS,
  time: "Time",
};

function getWorklogScopeType(issue: JiraWorklogIssue) {
  return issue.scopeType === "project" ? "project" : "issue";
}

function getWorklogScopeLookupKey(key: string, scopeType: JiraWorklogIssue["scopeType"] = "issue") {
  return `${scopeType === "project" ? "project" : "issue"}:${String(key || "").trim()}`;
}

function getWorklogPrincipalScopeType(principal: JiraAssignableUser) {
  return principal.scopeType === "group" ? "group" : "user";
}

function getWorklogPrincipalLookupKey(value: string, scopeType: JiraAssignableUser["scopeType"] = "user") {
  return `${scopeType === "group" ? "group" : "user"}:${String(value || "").trim()}`;
}

export function WorklogView({ onLoadIssue: _onLoadIssue, onLoadIssues, onLoadLinkTypes = async () => [], onLoadReport, onLoadUsers }: WorklogViewProps) {
  const [request, setRequest] = useState<JiraWorklogRequest>(DEFAULT_REQUEST);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<JiraWorklogReport>({ rows: [] });
  const [chartType, setChartType] = useState<WorklogChartType>("donut");
  const [activeChartLabel, setActiveChartLabel] = useState("");
  const [tableExpanded, setTableExpanded] = useState(false);
  const [sortState, setSortState] = useState<WorklogSortState>({ column: "issue", direction: "asc" });
  const [issueSearch, setIssueSearch] = useState("");
  const [issuePickerOpen, setIssuePickerOpen] = useState(false);
  const [issueOptions, setIssueOptions] = useState<JiraWorklogIssue[]>([]);
  const [issueLookup, setIssueLookup] = useState<Record<string, JiraWorklogIssue>>({});
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userOptions, setUserOptions] = useState<JiraAssignableUser[]>([]);
  const [userLookup, setUserLookup] = useState<Record<string, JiraAssignableUser>>({});
  const [usersLoading, setUsersLoading] = useState(false);
  const [linkedSettingsOpen, setLinkedSettingsOpen] = useState(false);
  const [linkTypes, setLinkTypes] = useState<JiraIssueLinkType[]>([]);
  const [linkTypesLoading, setLinkTypesLoading] = useState(false);
  const [linkTypesLoaded, setLinkTypesLoaded] = useState(false);
  const [linkTypesError, setLinkTypesError] = useState("");
  const issuePickerRef = useRef<HTMLDivElement | null>(null);
  const userPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const normalizedSearch = issueSearch.trim();

    if (!normalizedSearch) {
      setIssueOptions([]);
      setIssuesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIssuesLoading(true);
    const timer = window.setTimeout(() => {
      void onLoadIssues(normalizedSearch)
        .then((nextIssues) => {
          if (!cancelled) {
            setIssueOptions(nextIssues);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setIssueOptions([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIssuesLoading(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [issueSearch, onLoadIssues]);

  useEffect(() => {
    let cancelled = false;
    setUsersLoading(true);

    const timer = window.setTimeout(() => {
      void onLoadUsers(userSearch)
        .then((nextUsers) => {
          if (cancelled) {
            return;
          }
          setUserOptions(nextUsers);
          setUserLookup((current) => ({
            ...current,
            ...Object.fromEntries(nextUsers.map((user) => {
              const scopeType = getWorklogPrincipalScopeType(user);
              const selectionKey = scopeType === "group" ? String(user.groupId || "").trim() : String(user.accountId || "").trim();
              return [getWorklogPrincipalLookupKey(selectionKey, scopeType), user];
            })),
          }));
        })
        .catch(() => {
          if (!cancelled) {
            setUserOptions([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setUsersLoading(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onLoadUsers, userSearch]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!issuePickerRef.current?.contains(event.target as Node)) {
        setIssuePickerOpen(false);
      }
      if (!userPickerRef.current?.contains(event.target as Node)) {
        setUserPickerOpen(false);
        clearUserSelection();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!linkedSettingsOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLinkedSettingsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [linkedSettingsOpen]);

  const selectedIssues = useMemo(
    () => [
      ...request.projectKeys.map((projectKey) => issueLookup[getWorklogScopeLookupKey(projectKey, "project")]).filter(Boolean),
      ...request.issueKeys.map((issueKey) => issueLookup[getWorklogScopeLookupKey(issueKey, "issue")]).filter(Boolean),
    ],
    [issueLookup, request.issueKeys, request.projectKeys]
  );

  const selectedUsers = useMemo(
    () => [
      ...request.groupIds.map((groupId) => userLookup[getWorklogPrincipalLookupKey(groupId, "group")]).filter(Boolean),
      ...request.assigneeAccountIds.map((accountId) => userLookup[getWorklogPrincipalLookupKey(accountId, "user")]).filter(Boolean),
    ],
    [request.assigneeAccountIds, request.groupIds, userLookup]
  );

  const visibleRows = report.rows;
  const hasEpicData = visibleRows.some((row) => row.epicKey);
  const hasLinkedData = visibleRows.some((row) => row.linkSourceIssueKey);
  const grouping = useMemo(() => normalizeGrouping(request), [request]);
  const tableColumns = useMemo(() => getTableColumns(grouping, hasEpicData), [grouping, hasEpicData]);

  const groupedBlocks = useMemo(() => buildGroupedBlocks(visibleRows, grouping, tableColumns, sortState), [grouping, sortState, tableColumns, visibleRows]);

  const summary = useMemo(() => {
    const issueCount = new Set(visibleRows.map((row) => row.issueKey)).size;
    const userCount = new Set(visibleRows.map((row) => row.accountId)).size;
    return {
      issueCount,
      userCount,
      blockCount: groupedBlocks.length,
      totalEntries: visibleRows.length,
    };
  }, [groupedBlocks.length, visibleRows]);

  const chartData = useMemo(() => buildChartData(visibleRows, grouping.primary), [grouping.primary, visibleRows]);

  useEffect(() => {
    if (activeChartLabel && !chartData.some((item) => item.label === activeChartLabel)) {
      setActiveChartLabel("");
    }
  }, [activeChartLabel, chartData]);

  const selectedIssueScopeKeys = useMemo(
    () =>
      new Set([
        ...request.projectKeys.map((projectKey) => getWorklogScopeLookupKey(projectKey, "project")),
        ...request.issueKeys.map((issueKey) => getWorklogScopeLookupKey(issueKey, "issue")),
      ]),
    [request.issueKeys, request.projectKeys]
  );
  const availableIssueOptions = issueOptions.filter((issue) => !selectedIssueScopeKeys.has(getWorklogScopeLookupKey(issue.key, issue.scopeType)));
  const selectedPrincipalScopeKeys = useMemo(
    () =>
      new Set([
        ...request.groupIds.map((groupId) => getWorklogPrincipalLookupKey(groupId, "group")),
        ...request.assigneeAccountIds.map((accountId) => getWorklogPrincipalLookupKey(accountId, "user")),
      ]),
    [request.assigneeAccountIds, request.groupIds]
  );
  const availableUserOptions = userOptions.filter((user) => {
    const principalKey = getWorklogPrincipalScopeType(user) === "group"
      ? getWorklogPrincipalLookupKey(user.groupId || "", "group")
      : getWorklogPrincipalLookupKey(user.accountId, "user");
    return !selectedPrincipalScopeKeys.has(principalKey);
  });
  const showIssuePicker = issuePickerOpen && (issuesLoading || availableIssueOptions.length > 0 || issueSearch.trim().length > 0);
  const showUserPicker = userPickerOpen && (usersLoading || availableUserOptions.length > 0 || userSearch.trim().length > 0);
  const availablePrimaryGroups = getAvailableGroupByOptions();
  const availableSecondaryGroups = getAvailableSecondaryGroupByOptions(grouping.primary);
  const summaryText = `${summary.issueCount} issues · ${summary.userCount} users · ${summary.totalEntries} entries · ${summary.blockCount} groups`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const nextReport = await onLoadReport({
        ...request,
        viewMode: viewModeFromGroupBy(grouping.primary),
        primaryGroupBy: grouping.primary,
        secondaryGroupBy: grouping.secondary,
      });
      setReport(nextReport);
      setTableExpanded(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load worklog report.");
    } finally {
      setLoading(false);
    }
  }

  function clearIssueSelection() {
    setIssueSearch("");
    setIssueOptions([]);
    setIssuesLoading(false);
  }

  function clearUserSelection() {
    setUserSearch("");
    setUserOptions([]);
    setUsersLoading(false);
  }

  function handleSelectIssue(issue: JiraWorklogIssue) {
    const scopeType = getWorklogScopeType(issue);
    const lookupKey = getWorklogScopeLookupKey(issue.key, scopeType);

    setIssueLookup((current) => ({ ...current, [lookupKey]: issue }));
    setRequest((current) => ({
      ...current,
      issueKeys:
        scopeType === "issue" && !current.issueKeys.includes(issue.key)
          ? [...current.issueKeys, issue.key]
          : current.issueKeys,
      projectKeys:
        scopeType === "project" && !current.projectKeys.includes(issue.key)
          ? [...current.projectKeys, issue.key]
          : current.projectKeys,
    }));
    setIssueSearch("");
    setIssuePickerOpen(false);
  }

  function handleRemoveIssue(issue: JiraWorklogIssue) {
    const scopeType = getWorklogScopeType(issue);
    setRequest((current) => {
      const nextIssueKeys = scopeType === "issue" ? current.issueKeys.filter((value) => value !== issue.key) : current.issueKeys;
      const nextProjectKeys = scopeType === "project" ? current.projectKeys.filter((value) => value !== issue.key) : current.projectKeys;
      const remainingIssues = nextIssueKeys.map((key) => issueLookup[getWorklogScopeLookupKey(key, "issue")]).filter(Boolean);
      const hasEpicRemaining = remainingIssues.some((issue) => String(issue.issueType || "").trim().toLowerCase() === "epic");
      return {
        ...current,
        issueKeys: nextIssueKeys,
        projectKeys: nextProjectKeys,
        includeEpicChildren: hasEpicRemaining ? current.includeEpicChildren : false,
      };
    });
  }

  function handleSelectUser(user: JiraAssignableUser) {
    const scopeType = getWorklogPrincipalScopeType(user);
    const selectionKey = scopeType === "group" ? String(user.groupId || "").trim() : String(user.accountId || "").trim();
    if (!selectionKey) {
      return;
    }
    const lookupKey = getWorklogPrincipalLookupKey(selectionKey, scopeType);

    setUserLookup((current) => ({ ...current, [lookupKey]: user }));
    setRequest((current) => ({
      ...current,
      assigneeAccountIds:
        scopeType === "user" && !current.assigneeAccountIds.includes(selectionKey)
          ? [...current.assigneeAccountIds, selectionKey]
          : current.assigneeAccountIds,
      groupIds:
        scopeType === "group" && !current.groupIds.includes(selectionKey)
          ? [...current.groupIds, selectionKey]
          : current.groupIds,
    }));
    setUserSearch("");
    setUserPickerOpen(false);
  }

  function handleRemoveUser(user: JiraAssignableUser) {
    const scopeType = getWorklogPrincipalScopeType(user);
    const selectionKey = scopeType === "group" ? String(user.groupId || "").trim() : String(user.accountId || "").trim();
    if (!selectionKey) {
      return;
    }
    setRequest((current) => ({
      ...current,
      assigneeAccountIds: scopeType === "user"
        ? current.assigneeAccountIds.filter((value) => value !== selectionKey)
        : current.assigneeAccountIds,
      groupIds: scopeType === "group"
        ? current.groupIds.filter((value) => value !== selectionKey)
        : current.groupIds,
    }));
  }

  function openLinkedSettings() {
    setLinkedSettingsOpen(true);
    if (linkTypesLoaded || linkTypesLoading) {
      return;
    }
    setLinkTypesLoading(true);
    setLinkTypesError("");
    void onLoadLinkTypes()
      .then((nextLinkTypes) => {
        setLinkTypes(nextLinkTypes);
        setLinkTypesLoaded(true);
      })
      .catch((nextError) => {
        setLinkTypes([]);
        setLinkTypesError(nextError instanceof Error ? nextError.message : "Failed to load Jira issue link types.");
      })
      .finally(() => setLinkTypesLoading(false));
  }

  function toggleLinkedIssueType(linkTypeId: string) {
    setRequest((current) => {
      const selectedIds = new Set(current.linkedIssueTypeIds);
      if (selectedIds.has(linkTypeId)) {
        selectedIds.delete(linkTypeId);
      } else {
        selectedIds.add(linkTypeId);
      }
      return {
        ...current,
        linkedIssueTypeIds: [...selectedIds],
      };
    });
  }

  function handleExportCsv() {
    if (groupedBlocks.length === 0) {
      return;
    }

    const header = [...tableColumns.map((column) => GROUP_BY_LABELS[column]), ...(hasLinkedData ? ["Source"] : []), "Time"];

    const csvRows = groupedBlocks.flatMap((block, blockIndex) => {
      const rows = block.rows.map((row, rowIndex) => [
        ...tableColumns.map((column, columnIndex) =>
          csvValue(shouldRenderColumnValue(block.rows, rowIndex, columnIndex, tableColumns) ? getRowLabel(row, column) : "")
        ),
        ...(hasLinkedData ? [csvValue(formatSourceLabel(row))] : []),
        csvValue(formatDuration(row.secondsSpent)),
      ].join(","));

      const subtotal = tableColumns.map((_, columnIndex) => {
        if (columnIndex === Math.max(tableColumns.length - 1, 0)) {
          return csvValue("Celkem");
        }
        return csvValue("");
      });
      if (hasLinkedData) {
        subtotal.push(csvValue(""));
      }
      rows.push([...subtotal, csvValue(formatDuration(block.totalSeconds))].join(","));

      if (blockIndex < groupedBlocks.length - 1) {
        rows.push(header.map(() => csvValue("")).join(","));
      }

      return rows;
    });

    csvRows.push(
      [
        ...tableColumns.map((_, columnIndex) => csvValue(columnIndex === Math.max(tableColumns.length - 1, 0) ? "Celkem celkem" : "")),
        ...(hasLinkedData ? [csvValue("")] : []),
        csvValue(formatDuration(visibleRows.reduce((sum, row) => sum + row.secondsSpent, 0))),
      ].join(",")
    );

    const lines = [header.join(","), ...csvRows].join("\n");
    const blob = new Blob([lines], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jira-worklog-${request.dateFrom}-${request.dateTo}.csv`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="page-shell">
      <section className="card worklog-report">
        <form className="worklog-toolbar" onSubmit={handleSubmit}>
          <div className="worklog-toolbar__row worklog-toolbar__row--primary">
            <label className="worklog-toolbar__field">
              <span>From</span>
              <input
                className="settings-time-input"
                type="date"
                value={request.dateFrom}
                onChange={(event) => setRequest({ ...request, dateFrom: event.target.value })}
              />
            </label>

            <label className="worklog-toolbar__field">
              <span>To</span>
              <input
                className="settings-time-input"
                type="date"
                value={request.dateTo}
                onChange={(event) => setRequest({ ...request, dateTo: event.target.value })}
              />
            </label>

            <label className="worklog-toolbar__field">
              <span>Issue</span>
              <div className="worklog-issue-picker" ref={issuePickerRef}>
                <input
                  placeholder="PROJ-123 nebo Mediox"
                  type="text"
                  value={issueSearch}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setIssueSearch(nextValue);
                    setIssuesLoading(Boolean(nextValue.trim()));
                    setIssuePickerOpen(true);
                  }}
                  onBlur={() => window.setTimeout(() => clearIssueSelection(), 120)}
                  onFocus={() => setIssuePickerOpen(true)}
                />
                {showIssuePicker ? (
                  <div className="worklog-issue-picker__menu">
                    {issuesLoading ? <div className="worklog-user-picker__empty">Loading…</div> : null}
                    {!issuesLoading && issueSearch.trim().length > 0 && availableIssueOptions.length === 0 ? <div className="worklog-user-picker__empty">No issues found</div> : null}
                    {!issuesLoading && availableIssueOptions.length > 0 ? (
                      <>
                        <div className="worklog-issue-picker__header" aria-hidden="true">
                          <span>ID</span>
                          <span>Name</span>
                          <span>Type</span>
                        </div>
                        {availableIssueOptions.map((issue) => (
                          <button
                            className="worklog-issue-option"
                            key={getWorklogScopeLookupKey(issue.key, issue.scopeType)}
                            onMouseDown={() => handleSelectIssue(issue)}
                            type="button"
                          >
                            <strong>{issue.key}</strong>
                            <span>{issue.title}</span>
                            <span>{issue.issueType || (getWorklogScopeType(issue) === "project" ? "Project" : "-")}</span>
                          </button>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </label>

            <div className="worklog-toolbar__field worklog-toolbar__field--users" ref={userPickerRef}>
              <span>User or group</span>
              <div className="worklog-user-picker">
                <input
                  placeholder="Find user or group"
                  type="text"
                  value={userSearch}
                  onChange={(event) => {
                    setUserSearch(event.target.value);
                    setUserPickerOpen(true);
                  }}
                  onBlur={() => window.setTimeout(() => clearUserSelection(), 120)}
                  onFocus={() => setUserPickerOpen(true)}
                />
                {showUserPicker ? (
                  <div className="worklog-user-picker__menu">
                    {usersLoading ? <div className="worklog-user-picker__empty">Loading…</div> : null}
                    {!usersLoading && availableUserOptions.length === 0 ? (
                      <div className="worklog-user-picker__empty">No people or groups found</div>
                    ) : null}
                    {availableUserOptions.map((user) => (
                      <button
                        className="worklog-user-option"
                        key={getWorklogPrincipalLookupKey(getWorklogPrincipalScopeType(user) === "group" ? user.groupId || "" : user.accountId, getWorklogPrincipalScopeType(user))}
                        onMouseDown={() => handleSelectUser(user)}
                        type="button"
                      >
                        <span className="avatar-circle worklog-user-option__avatar" aria-hidden="true">
                          {user.avatarUrl ? <img alt="" src={user.avatarUrl} /> : getInitials(user.displayName)}
                        </span>
                        <span className="worklog-user-option__content">
                          <strong>{user.displayName}</strong>
                          <span>{getWorklogPrincipalScopeType(user) === "group" ? "Jira group" : (user.emailAddress || "Jira user")}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <label className="worklog-toolbar__field">
              <span>Primary group</span>
              <select
                value={grouping.primary}
                onChange={(event) => {
                  const nextPrimary = event.target.value as JiraWorklogGroupBy;
                  setRequest((current) => ({
                    ...current,
                    viewMode: viewModeFromGroupBy(nextPrimary),
                    primaryGroupBy: nextPrimary,
                    secondaryGroupBy: current.secondaryGroupBy === nextPrimary ? "" : current.secondaryGroupBy || "",
                  }));
                }}
              >
                {availablePrimaryGroups.map((groupBy) => (
                  <option key={groupBy} value={groupBy}>
                    {GROUP_BY_LABELS[groupBy]}
                  </option>
                ))}
              </select>
            </label>

            <label className="worklog-toolbar__field">
              <span>Secondary group</span>
              <select
                value={grouping.secondary}
                onChange={(event) =>
                  setRequest((current) => ({
                    ...current,
                    secondaryGroupBy: event.target.value as JiraWorklogGroupBy | "",
                  }))
                }
              >
                <option value="">None</option>
                {availableSecondaryGroups.map((groupBy) => (
                  <option key={groupBy} value={groupBy}>
                    {GROUP_BY_LABELS[groupBy]}
                  </option>
                ))}
              </select>
            </label>

            <label className="worklog-toolbar__field">
              <span>Chart</span>
              <select value={chartType} onChange={(event) => setChartType(event.target.value as WorklogChartType)}>
                <option value="donut">Donut</option>
                <option value="treemap">Treemap</option>
              </select>
            </label>

            <div className="worklog-toolbar__field">
              <span>Links</span>
              <button
                aria-label={`Linked issues ${request.includeLinkedIssues ? `${request.linkedIssueTypeIds.length} selected` : "off"}`}
                className={`ghost-button worklog-link-settings-button ${request.includeLinkedIssues ? "is-active" : ""}`}
                onClick={openLinkedSettings}
                type="button"
              >
                <strong>Linked issues</strong>
                <span>{request.includeLinkedIssues ? `${request.linkedIssueTypeIds.length} selected` : "Off"}</span>
              </button>
            </div>
          </div>

          <div className="worklog-toolbar__row worklog-toolbar__row--secondary">
            <div className="worklog-toolbar__selection">
              {selectedIssues.length > 0 || selectedUsers.length > 0 ? (
                <div className="worklog-selected-list">
                  {selectedIssues.map((issue) => (
                    <div className="worklog-selected-chip" key={getWorklogScopeLookupKey(issue.key, issue.scopeType)}>
                      <div>
                        <strong>{issue.key}</strong>
                        <span>{issue.title}{issue.issueType ? ` · ${issue.issueType}` : ""}</span>
                      </div>
                      <button aria-label={`Remove ${issue.key}`} onClick={() => handleRemoveIssue(issue)} type="button">
                        ×
                      </button>
                    </div>
                  ))}
                  {selectedUsers.map((user) => (
                    <div
                      className="worklog-selected-chip"
                      key={getWorklogPrincipalLookupKey(getWorklogPrincipalScopeType(user) === "group" ? user.groupId || "" : user.accountId, getWorklogPrincipalScopeType(user))}
                    >
                      <span className="avatar-circle worklog-selected-chip__avatar" aria-hidden="true">
                        {user.avatarUrl ? <img alt="" src={user.avatarUrl} /> : getInitials(user.displayName)}
                      </span>
                      <div>
                        <strong>{user.displayName}</strong>
                        <span>{getWorklogPrincipalScopeType(user) === "group" ? "Jira group" : (user.emailAddress || "Jira user")}</span>
                      </div>
                      <button aria-label={`Remove ${user.displayName}`} onClick={() => handleRemoveUser(user)} type="button">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="worklog-toolbar__actions">
              <div className="worklog-toolbar__toggles">
                <label className="settings-toggle">
                  <button
                    aria-label="Epic - Include children"
                    aria-pressed={request.includeEpicChildren}
                    className={`toggle-switch ${request.includeEpicChildren ? "is-active" : ""}`}
                    onClick={() => setRequest({ ...request, includeEpicChildren: !request.includeEpicChildren })}
                    type="button"
                  >
                    <span className="toggle-switch__knob" />
                  </button>
                  <span>Epic - Include children</span>
                </label>
              </div>

              <div className="worklog-toolbar__buttons">
                <button className="ghost-button worklog-export-button" disabled={groupedBlocks.length === 0} onClick={handleExportCsv} type="button">
                  Export
                </button>
                <button className="ghost-button worklog-export-button" disabled={loading} type="submit">
                  {loading ? "Loading..." : "View report"}
                </button>
              </div>
            </div>
          </div>

          {error ? <p className="settings-help">{error}</p> : null}
        </form>

        <div className="worklog-results">
          <div className="worklog-visuals">
            <div className="worklog-chart-card">
              <div className="worklog-results__stats">
                <span>{summaryText}</span>
              </div>
              <WorklogChart
                chartType={chartType}
                data={chartData}
                groupBy={grouping.primary}
                selectedLabel={activeChartLabel}
                onSelectionChange={setActiveChartLabel}
              />
            </div>
          </div>

          <button
            aria-expanded={tableExpanded}
            aria-label={`${tableExpanded ? "Hide" : "Show"} worklog table, ${summary.totalEntries} entries`}
            className="worklog-table-toggle"
            disabled={groupedBlocks.length === 0}
            onClick={() => setTableExpanded((current) => !current)}
            type="button"
          >
            <span>{tableExpanded ? "Hide worklog table" : "Show worklog table"}</span>
            <strong>{summary.totalEntries} entries</strong>
          </button>

          {tableExpanded ? (
            <WorklogGroupedTable
              activePrimaryLabel={activeChartLabel}
              blocks={groupedBlocks}
              columns={tableColumns}
              onSortChange={setSortState}
              showSourceColumn={hasLinkedData}
              sortState={sortState}
            />
          ) : null}
        </div>
      </section>

      {linkedSettingsOpen ? (
        <LinkedIssuesModal
          includeLinkedIssues={request.includeLinkedIssues}
          linkTypes={linkTypes}
          linkTypesError={linkTypesError}
          linkTypesLoading={linkTypesLoading}
          onClose={() => setLinkedSettingsOpen(false)}
          onIncludeChange={(includeLinkedIssues) => setRequest((current) => ({ ...current, includeLinkedIssues }))}
          onToggleLinkType={toggleLinkedIssueType}
          selectedLinkTypeIds={request.linkedIssueTypeIds}
        />
      ) : null}
    </div>
  );
}

function LinkedIssuesModal({
  includeLinkedIssues,
  linkTypes,
  linkTypesError,
  linkTypesLoading,
  onClose,
  onIncludeChange,
  onToggleLinkType,
  selectedLinkTypeIds,
}: {
  includeLinkedIssues: boolean;
  linkTypes: JiraIssueLinkType[];
  linkTypesError: string;
  linkTypesLoading: boolean;
  onClose: () => void;
  onIncludeChange: (includeLinkedIssues: boolean) => void;
  onToggleLinkType: (linkTypeId: string) => void;
  selectedLinkTypeIds: string[];
}) {
  const [search, setSearch] = useState("");
  const selectedIds = new Set(selectedLinkTypeIds);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleLinkTypes = normalizedSearch
    ? linkTypes.filter((linkType) =>
      [linkType.name, linkType.inward, linkType.outward]
        .some((value) => String(value || "").toLowerCase().includes(normalizedSearch))
    )
    : linkTypes;

  return (
    <div className="worklog-modal-backdrop" role="presentation">
      <section aria-modal="true" className="worklog-modal" role="dialog">
        <div className="worklog-modal__header">
          <div>
            <h2>Linked issues</h2>
            <span>{selectedIds.size} link types selected</span>
          </div>
          <button className="ghost-button worklog-modal__close" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="worklog-modal__controls">
          <label className="settings-toggle worklog-modal__toggle">
            <button
              aria-label="Include linked issues"
              aria-pressed={includeLinkedIssues}
              className={`toggle-switch ${includeLinkedIssues ? "is-active" : ""}`}
              onClick={() => {
                if (includeLinkedIssues) {
                  setSearch("");
                }
                onIncludeChange(!includeLinkedIssues);
              }}
              type="button"
            >
              <span className="toggle-switch__knob" />
            </button>
            <span>Include linked issues</span>
          </label>

          <label className="worklog-link-type-search">
            <span>Search link types</span>
            <input
              disabled={!includeLinkedIssues}
              placeholder="Find link type"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className={`worklog-link-type-list ${includeLinkedIssues ? "" : "is-disabled"}`} aria-disabled={!includeLinkedIssues}>
          {linkTypesLoading ? <div className="worklog-user-picker__empty">Loading link types...</div> : null}
          {linkTypesError ? <div className="worklog-user-picker__empty">{linkTypesError}</div> : null}
          {!linkTypesLoading && !linkTypesError && linkTypes.length === 0 ? <div className="worklog-user-picker__empty">No link types found</div> : null}
          {!linkTypesLoading && !linkTypesError && linkTypes.length > 0 && visibleLinkTypes.length === 0 ? <div className="worklog-user-picker__empty">No matching link types</div> : null}
          {visibleLinkTypes.map((linkType) => {
            const selected = selectedIds.has(linkType.id);
            const outwardLabel = linkType.outward || linkType.name;
            const inwardLabel = linkType.inward && linkType.inward !== linkType.outward ? linkType.inward : linkType.name;
            return (
              <button
                aria-label={`Link type ${linkType.name || linkType.id}: Issue ${outwardLabel} Issue${inwardLabel ? `, ${inwardLabel}` : ""}`}
                aria-pressed={selected}
                className={`worklog-link-type-row ${selected ? "is-selected" : ""}`}
                disabled={!includeLinkedIssues}
                key={linkType.id}
                onClick={() => onToggleLinkType(linkType.id)}
                type="button"
              >
                <span className="worklog-link-type-row__issue">Issue</span>
                <span className="worklog-link-type-row__line">
                  <span />
                  <strong>{outwardLabel}</strong>
                  <span />
                </span>
                <span className="worklog-link-type-row__issue">Issue</span>
                <span className="worklog-link-type-row__meta">{inwardLabel}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function WorklogGroupedTable({
  activePrimaryLabel,
  blocks,
  columns,
  onSortChange,
  showSourceColumn,
  sortState,
}: {
  activePrimaryLabel: string;
  blocks: GroupedBlock[];
  columns: JiraWorklogGroupBy[];
  onSortChange: (sortState: WorklogSortState) => void;
  showSourceColumn: boolean;
  sortState: WorklogSortState;
}) {
  const totalSeconds = blocks.reduce((sum, block) => sum + block.totalSeconds, 0);

  if (blocks.length === 0) {
    return <div className="worklog-table__empty">No rows</div>;
  }

  return (
    <div className="worklog-sheet">
      <table className="worklog-sheet__table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>
                <SortHeaderButton column={column} onSortChange={onSortChange} sortState={sortState} />
              </th>
            ))}
            {showSourceColumn ? <th>Source</th> : null}
            <th>
              <SortHeaderButton column="time" onSortChange={onSortChange} sortState={sortState} />
            </th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <WorklogGroupedTableBlock
              activePrimaryLabel={activePrimaryLabel}
              block={block}
              columns={columns}
              key={block.id}
              showSourceColumn={showSourceColumn}
            />
          ))}
          <tr className="worklog-sheet__grand-total">
            {columns.map((column, columnIndex) => (
              <td key={column}>{columnIndex === Math.max(columns.length - 1, 0) ? "Celkem" : ""}</td>
            ))}
            {showSourceColumn ? <td /> : null}
            <td>{formatDuration(totalSeconds)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function WorklogGroupedTableBlock({
  activePrimaryLabel,
  block,
  columns,
  showSourceColumn,
}: {
  activePrimaryLabel: string;
  block: GroupedBlock;
  columns: JiraWorklogGroupBy[];
  showSourceColumn: boolean;
}) {
  const isChartMatch = Boolean(activePrimaryLabel) && block.primaryLabel === activePrimaryLabel;

  return (
    <>
      {block.rows.map((row, rowIndex) => (
        <tr className={isChartMatch ? "worklog-sheet__row is-chart-match" : "worklog-sheet__row"} key={row.id}>
          {columns.map((column, columnIndex) => (
            <td key={`${row.id}-${column}`} title={getRowMeta(row, column)}>
              {shouldRenderColumnValue(block.rows, rowIndex, columnIndex, columns) ? renderRowValue(row, column) : ""}
            </td>
          ))}
          {showSourceColumn ? <td>{renderSourceValue(row)}</td> : null}
          <td className="worklog-sheet__time">{formatDuration(row.secondsSpent)}</td>
        </tr>
      ))}
      <tr className={`worklog-sheet__subtotal ${isChartMatch ? "is-chart-match" : ""}`}>
        {columns.map((column, columnIndex) => (
          <td key={`${block.id}-${column}-subtotal`}>{columnIndex === Math.max(columns.length - 1, 0) ? "Celkem" : ""}</td>
        ))}
        {showSourceColumn ? <td /> : null}
        <td className="worklog-sheet__time">{formatDuration(block.totalSeconds)}</td>
      </tr>
    </>
  );
}

function SortHeaderButton({
  column,
  onSortChange,
  sortState,
}: {
  column: WorklogSortColumn;
  onSortChange: (sortState: WorklogSortState) => void;
  sortState: WorklogSortState;
}) {
  const isActive = sortState.column === column;
  const nextDirection: WorklogSortDirection = isActive && sortState.direction === "asc" ? "desc" : "asc";
  const sortLabel = `${TABLE_COLUMN_LABELS[column]} ${nextDirection === "asc" ? "ascending" : "descending"}`;

  return (
    <button
      aria-label={`Sort by ${sortLabel}`}
      aria-sort={isActive ? (sortState.direction === "asc" ? "ascending" : "descending") : undefined}
      className={`worklog-sort-button ${isActive ? "is-active" : ""}`}
      onClick={() => onSortChange({ column, direction: nextDirection })}
      type="button"
    >
      <span>{TABLE_COLUMN_LABELS[column]}</span>
      <span aria-hidden="true" className="worklog-sort-button__icon">
        {isActive ? (sortState.direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

function buildGroupedBlocks(rows: JiraWorklogRow[], grouping: WorklogGrouping, columns: JiraWorklogGroupBy[], sortState: WorklogSortState): GroupedBlock[] {
  const aggregatedRows = aggregateRows(rows);
  const groups = new Map<string, GroupedBlock>();

  for (const row of aggregatedRows) {
    const groupKey = getRowLabel(row, grouping.primary);
    const existing = groups.get(groupKey);

    if (existing) {
      existing.rows.push(row);
      existing.totalSeconds += row.secondsSpent;
      continue;
    }

    groups.set(groupKey, {
      id: groupKey,
      primaryGroupBy: grouping.primary,
      primaryLabel: groupKey,
      rows: [row],
      totalSeconds: row.secondsSpent,
    });
  }

  return [...groups.values()]
    .map((block) => ({
      ...block,
      rows: [...block.rows].sort((left, right) => compareRows(left, right, columns, sortState)),
    }))
    .sort((left, right) => compareBlocks(left, right, sortState, grouping.primary));
}

function buildChartData(rows: JiraWorklogRow[], groupBy: JiraWorklogGroupBy) {
  const groups = new Map<string, { secondsSpent: number; title: string; url: string }>();

  for (const row of rows) {
    const label = getWorklogRowGroupValue(row, groupBy);
    const existing = groups.get(label);
    const nextTitle = getWorklogChartGroupTitle(row, groupBy);
    const nextUrl = getWorklogChartGroupUrl(row, groupBy);

    if (existing) {
      existing.secondsSpent += row.secondsSpent;
      if (!existing.title && nextTitle) {
        existing.title = nextTitle;
      }
      if (!existing.url && nextUrl) {
        existing.url = nextUrl;
      }
      continue;
    }

    groups.set(label, {
      secondsSpent: row.secondsSpent,
      title: nextTitle,
      url: nextUrl,
    });
  }

  return [...groups.entries()]
    .map(([label, group], index) => ({
      label,
      secondsSpent: group.secondsSpent,
      color: CHART_COLORS[index % CHART_COLORS.length],
      title: group.title,
      url: group.url,
    }))
    .sort((left, right) => right.secondsSpent - left.secondsSpent);
}

function getWorklogChartGroupTitle(row: JiraWorklogRow, groupBy: JiraWorklogGroupBy) {
  if (groupBy === "epic") {
    return row.epicTitle || "";
  }
  if (groupBy === "issue") {
    return row.issueTitle || "";
  }
  return "";
}

function getWorklogChartGroupUrl(row: JiraWorklogRow, groupBy: JiraWorklogGroupBy) {
  if (groupBy === "epic") {
    return row.epicUrl || "";
  }
  if (groupBy === "issue") {
    return row.issueUrl || "";
  }
  return "";
}

function normalizeGrouping(request: JiraWorklogRequest): WorklogGrouping {
  const primary = request.primaryGroupBy || groupByFromViewMode(request.viewMode);
  const secondaryCandidate = request.secondaryGroupBy || "";
  const secondary = secondaryCandidate && secondaryCandidate !== primary ? secondaryCandidate : "";
  return {
    primary,
    secondary,
  };
}

function getAvailableGroupByOptions(): JiraWorklogGroupBy[] {
  return ["epic", "issue", "user"];
}

function getAvailableSecondaryGroupByOptions(primary: JiraWorklogGroupBy): JiraWorklogGroupBy[] {
  return getAvailableGroupByOptions().filter((option) => option !== primary);
}

function groupByFromViewMode(viewMode: JiraWorklogRequest["viewMode"]): JiraWorklogGroupBy {
  if (viewMode === "user-first") {
    return "user";
  }
  if (viewMode === "epic-first") {
    return "epic";
  }
  return "issue";
}

function viewModeFromGroupBy(groupBy: JiraWorklogGroupBy): JiraWorklogRequest["viewMode"] {
  if (groupBy === "user") {
    return "user-first";
  }
  if (groupBy === "epic") {
    return "epic-first";
  }
  return "issue-first";
}

function getTableColumns(grouping: WorklogGrouping, hasEpicData: boolean): JiraWorklogGroupBy[] {
  const availableDimensions: JiraWorklogGroupBy[] = [
    ...(hasEpicData || grouping.primary === "epic" || grouping.secondary === "epic" ? (["epic"] as JiraWorklogGroupBy[]) : []),
    "issue",
    "user",
  ];
  return [...new Set([grouping.primary, ...(grouping.secondary ? [grouping.secondary] : []), ...availableDimensions])];
}

function aggregateRows(rows: JiraWorklogRow[]): GroupedRow[] {
  const aggregated = new Map<string, GroupedRow>();

  for (const row of rows) {
    const epic = row.epicKey || "Without epic";
    const key = [epic, row.issueKey, row.author].join("|");
    const existing = aggregated.get(key);

    if (existing) {
      existing.secondsSpent += row.secondsSpent;
      continue;
    }

    aggregated.set(key, {
      id: key,
      epic,
      epicMeta: row.epicTitle || row.epicKey || "",
      epicUrl: row.epicUrl || "",
      issue: row.issueKey,
      issueMeta: row.issueTitle,
      issueUrl: row.issueUrl,
      sourceIssue: row.linkSourceIssueKey || "",
      sourceIssueMeta: row.linkSourceIssueTitle || "",
      sourceIssueUrl: row.linkSourceIssueUrl || "",
      sourceLabel: row.linkLabel || row.linkTypeName || "",
      user: row.author,
      userMeta: row.accountId,
      secondsSpent: row.secondsSpent,
    });
  }

  return [...aggregated.values()];
}

function compareRows(left: GroupedRow, right: GroupedRow, columns: JiraWorklogGroupBy[], sortState: WorklogSortState) {
  const primary = compareRowsByColumn(left, right, sortState.column);
  if (primary !== 0) {
    return sortState.direction === "asc" ? primary : -primary;
  }

  for (const column of columns) {
    const value = getRowLabel(left, column).localeCompare(getRowLabel(right, column));
    if (value !== 0) {
      return value;
    }
  }
  return right.secondsSpent - left.secondsSpent;
}

function compareRowsByColumn(left: GroupedRow, right: GroupedRow, column: WorklogSortColumn) {
  if (column === "time") {
    return left.secondsSpent - right.secondsSpent;
  }
  return getRowLabel(left, column).localeCompare(getRowLabel(right, column));
}

function compareBlocks(left: GroupedBlock, right: GroupedBlock, sortState: WorklogSortState, primaryGroupBy: JiraWorklogGroupBy) {
  if (sortState.column === "time") {
    const value = left.totalSeconds - right.totalSeconds;
    return sortState.direction === "asc" ? value : -value;
  }
  if (sortState.column === primaryGroupBy) {
    const value = left.primaryLabel.localeCompare(right.primaryLabel);
    return sortState.direction === "asc" ? value : -value;
  }
  return left.primaryLabel.localeCompare(right.primaryLabel);
}

function getRowLabel(row: GroupedRow, column: JiraWorklogGroupBy) {
  if (column === "epic") {
    return row.epic;
  }
  if (column === "user") {
    return row.user;
  }
  return row.issue;
}

function getRowMeta(row: GroupedRow, column: JiraWorklogGroupBy) {
  if (column === "epic") {
    return row.epicMeta;
  }
  if (column === "user") {
    return row.userMeta;
  }
  return row.issueMeta;
}

function renderRowValue(row: GroupedRow, column: JiraWorklogGroupBy) {
  const label = getRowLabel(row, column);
  if (column === "epic" && row.epicUrl) {
    return (
      <a className="worklog-sheet__link" href={row.epicUrl} rel="noreferrer" target="_blank">
        {label}
      </a>
    );
  }
  if (column === "issue" && row.issueUrl) {
    return (
      <a className="worklog-sheet__link" href={row.issueUrl} rel="noreferrer" target="_blank">
        {label}
      </a>
    );
  }
  return label;
}

function renderSourceValue(row: GroupedRow) {
  if (!row.sourceIssue) {
    return <span className="worklog-source-pill">Direct</span>;
  }

  return (
    <span className="worklog-source-link" title={formatSourceLabel(row)}>
      <a className="worklog-sheet__link" href={row.sourceIssueUrl} rel="noreferrer" target="_blank">
        {row.sourceIssue}
      </a>
      <span aria-hidden="true">→</span>
      <span>{row.issue}</span>
      <strong>{row.sourceLabel || "linked"}</strong>
    </span>
  );
}

function formatSourceLabel(row: GroupedRow) {
  if (!row.sourceIssue) {
    return "Direct";
  }
  return `${row.sourceIssue} -> ${row.issue}${row.sourceLabel ? ` · ${row.sourceLabel}` : ""}`;
}

function getWorklogRowGroupValue(row: JiraWorklogRow, groupBy: JiraWorklogGroupBy) {
  if (groupBy === "epic") {
    return row.epicKey || "Without epic";
  }
  if (groupBy === "user") {
    return row.author;
  }
  return row.issueKey;
}

function shouldRenderColumnValue(rows: GroupedRow[], rowIndex: number, columnIndex: number, columns: JiraWorklogGroupBy[]) {
  if (rowIndex === 0) {
    return true;
  }

  const current = rows[rowIndex];
  const previous = rows[rowIndex - 1];

  for (let index = 0; index <= columnIndex; index += 1) {
    const column = columns[index];
    if (getRowLabel(current, column) !== getRowLabel(previous, column)) {
      return true;
    }
  }

  return false;
}

function WorklogChart({
  chartType,
  data,
  groupBy,
  onSelectionChange,
  selectedLabel,
}: {
  chartType: WorklogChartType;
  data: WorklogChartDatum[];
  groupBy: JiraWorklogGroupBy;
  onSelectionChange: (updater: string) => void;
  selectedLabel: string;
}) {
  if (data.length === 0) {
    return <div className="worklog-chart-empty">No chart data</div>;
  }

  const totalSeconds = data.reduce((sum, item) => sum + item.secondsSpent, 0);
  const activeItem = data.find((item) => item.label === selectedLabel) || null;

  return (
    <div className={`worklog-chart worklog-chart--${chartType}`}>
      <div className="worklog-chart__visual">
        <div className={`worklog-chart__info ${activeItem ? "is-active" : ""}`}>
          <strong>{activeItem ? activeItem.label : `${GROUP_BY_LABELS[groupBy]} split`}</strong>
          {activeItem?.title ? (
            <div className="worklog-chart__detail">
              <span className="worklog-chart__detail-text" title={activeItem.title}>{activeItem.title}</span>
              {activeItem.url ? (
                <a
                  aria-label={`Open ${activeItem.label} in Jira`}
                  className="worklog-chart__detail-link"
                  href={activeItem.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLinkIcon />
                </a>
              ) : null}
            </div>
          ) : null}
          <span>{activeItem ? `${formatDuration(activeItem.secondsSpent)} • ${formatShare(activeItem.secondsSpent, totalSeconds)}` : `${formatDuration(totalSeconds)} total`}</span>
        </div>
        {chartType === "treemap" ? (
          <WorklogTreemap activeLabel={selectedLabel} data={data} onSelect={onSelectionChange} totalSeconds={totalSeconds} />
        ) : (
          <WorklogPieChart
            activeItem={activeItem}
            activeLabel={selectedLabel}
            data={data}
            onSelect={onSelectionChange}
            totalSeconds={totalSeconds}
          />
        )}
      </div>
      <div className="worklog-chart-legend">
        {data.map((item) => (
          <button
            aria-pressed={selectedLabel === item.label}
            aria-label={`Focus ${item.label} in chart and table`}
            className={`worklog-chart-legend__item ${selectedLabel === item.label ? "is-active" : ""} ${selectedLabel && selectedLabel !== item.label ? "is-muted" : ""}`}
            key={item.label}
            onClick={() => onSelectionChange(selectedLabel === item.label ? "" : item.label)}
            type="button"
          >
            <span className="worklog-chart-legend__swatch" style={{ backgroundColor: item.color }} />
            <div className="worklog-chart-legend__content">
              <strong>{item.label}</strong>
              <span>{formatDuration(item.secondsSpent)} • {formatShare(item.secondsSpent, totalSeconds)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 5h5v5" />
      <path d="M10 14 19 5" />
      <path d="M19 14v4a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

function WorklogPieChart({
  activeItem,
  activeLabel,
  data,
  onSelect,
  totalSeconds,
}: {
  activeItem: WorklogChartDatum | null;
  activeLabel: string;
  data: WorklogChartDatum[];
  onSelect: (label: string) => void;
  totalSeconds: number;
}) {
  const total = data.reduce((sum, item) => sum + item.secondsSpent, 0);
  let currentAngle = -90;

  const segments = data.length === 1
    ? [
      <circle
        aria-label={`Focus ${data[0].label} in chart and table`}
        className={activeLabel === data[0].label ? "is-active" : activeLabel ? "is-muted" : ""}
        cx="100"
        cy="100"
        fill="none"
        key={data[0].label}
        onClick={() => onSelect(activeLabel === data[0].label ? "" : data[0].label)}
        r="84"
        role="button"
        stroke={data[0].color}
        strokeWidth="28"
        tabIndex={0}
      />,
    ]
    : data.map((item) => {
      const sweep = (item.secondsSpent / total) * 360;
      const path = describeArc(100, 100, 84, currentAngle, currentAngle + sweep);
      const segment = (
        <path
          aria-label={`Focus ${item.label} in chart and table`}
          className={activeLabel === item.label ? "is-active" : activeLabel ? "is-muted" : ""}
          d={path}
          fill="none"
          key={item.label}
          onClick={() => onSelect(activeLabel === item.label ? "" : item.label)}
          role="button"
          stroke={item.color}
          strokeWidth={28}
          tabIndex={0}
        />
      );
      currentAngle += sweep;
      return segment;
    });

  return (
    <svg aria-label="Worklog chart" className="worklog-pie-chart" viewBox="0 0 200 200">
      {segments}
      <circle className="worklog-pie-chart__center" cx="100" cy="100" r={56} />
      <text className="worklog-pie-chart__total" textAnchor="middle" x="100" y="96">
        {activeItem ? formatDuration(activeItem.secondsSpent) : formatDuration(total)}
      </text>
      <text className="worklog-pie-chart__caption" textAnchor="middle" x="100" y="116">
        {activeItem ? `${activeItem.label} • ${formatShare(activeItem.secondsSpent, totalSeconds)}` : totalSeconds ? "Share of time" : ""}
      </text>
    </svg>
  );
}

function WorklogTreemap({
  activeLabel,
  data,
  onSelect,
  totalSeconds,
}: {
  activeLabel: string;
  data: WorklogChartDatum[];
  onSelect: (label: string) => void;
  totalSeconds: number;
}) {
  const tiles = getTreemapTiles(data, totalSeconds);

  return (
    <div className="worklog-treemap" role="img" aria-label="Worklog share treemap">
      {tiles.map((tile) => (
        <button
          className={`worklog-treemap__tile ${activeLabel === tile.item.label ? "is-active" : activeLabel && activeLabel !== tile.item.label ? "is-muted" : ""}`}
          key={tile.item.label}
          onClick={() => onSelect(activeLabel === tile.item.label ? "" : tile.item.label)}
          style={{
            backgroundColor: tile.item.color,
            height: `${tile.height}%`,
            left: `${tile.x}%`,
            top: `${tile.y}%`,
            width: `${tile.width}%`,
          }}
          title={`${tile.item.label} · ${formatDuration(tile.item.secondsSpent)} · ${formatShare(tile.item.secondsSpent, totalSeconds)}`}
          type="button"
        >
          <span>{tile.item.label}</span>
          <strong>{formatShare(tile.item.secondsSpent, totalSeconds)}</strong>
        </button>
      ))}
    </div>
  );
}

type WorklogTreemapItem = WorklogChartDatum;
type WorklogTreemapTile = {
  item: WorklogTreemapItem;
  x: number;
  y: number;
  width: number;
  height: number;
};

function getTreemapTiles(data: WorklogTreemapItem[], totalSeconds: number): WorklogTreemapTile[] {
  const items = data.filter((item) => item.secondsSpent > 0);
  const total = totalSeconds || items.reduce((sum, item) => sum + item.secondsSpent, 0);

  if (items.length === 0 || total <= 0) {
    return [];
  }

  return layoutTreemapItems(items, total, { x: 0, y: 0, width: 100, height: 100 });
}

function layoutTreemapItems(
  items: WorklogTreemapItem[],
  totalSeconds: number,
  rect: { x: number; y: number; width: number; height: number }
): WorklogTreemapTile[] {
  if (items.length === 0) {
    return [];
  }

  if (items.length === 1) {
    return [{ item: items[0], ...rect }];
  }

  const [first, ...rest] = items;
  const firstShare = first.secondsSpent / totalSeconds;
  const restTotal = totalSeconds - first.secondsSpent;

  if (rect.width >= rect.height) {
    const firstWidth = rect.width * firstShare;
    return [
      { item: first, x: rect.x, y: rect.y, width: firstWidth, height: rect.height },
      ...layoutTreemapItems(rest, restTotal, {
        x: rect.x + firstWidth,
        y: rect.y,
        width: rect.width - firstWidth,
        height: rect.height,
      }),
    ];
  }

  const firstHeight = rect.height * firstShare;
  return [
    { item: first, x: rect.x, y: rect.y, width: rect.width, height: firstHeight },
    ...layoutTreemapItems(rest, restTotal, {
      x: rect.x,
      y: rect.y + firstHeight,
      width: rect.width,
      height: rect.height - firstHeight,
    }),
  ];
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function formatShare(value: number, total: number) {
  if (!total) {
    return "0%";
  }
  return `${((value / total) * 100).toFixed(1)}%`;
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return ["M", start.x, start.y, "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(" ");
}

function csvValue(value: string) {
  return `"${String(value || "").replaceAll("\"", "\"\"")}"`;
}

function getInitials(displayName: string) {
  return String(displayName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
}
