import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { JiraAssignableUser, JiraWorklogGroupBy, JiraWorklogIssue, JiraWorklogReport, JiraWorklogRequest, JiraWorklogRow } from "../lib/types";

type WorklogViewProps = {
  onLoadIssue: (issueKey: string) => Promise<JiraWorklogIssue>;
  onLoadIssues: (query?: string) => Promise<JiraWorklogIssue[]>;
  onLoadReport: (payload: JiraWorklogRequest) => Promise<JiraWorklogReport>;
  onLoadUsers: (query?: string) => Promise<JiraAssignableUser[]>;
};

type WorklogChartType = "donut" | "pie" | "bar";

type GroupedRow = {
  id: string;
  epic: string;
  epicMeta: string;
  issue: string;
  issueMeta: string;
  issueUrl: string;
  group: string;
  groupMeta: string;
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
  group: "Group",
  user: "User",
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

export function WorklogView({ onLoadIssue: _onLoadIssue, onLoadIssues, onLoadReport, onLoadUsers }: WorklogViewProps) {
  const [request, setRequest] = useState<JiraWorklogRequest>(DEFAULT_REQUEST);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<JiraWorklogReport>({ rows: [] });
  const [chartType, setChartType] = useState<WorklogChartType>("donut");
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
  const hasGroupData = visibleRows.some((row) => Array.isArray(row.groupNames) && row.groupNames.length > 0);
  const grouping = useMemo(() => normalizeGrouping(request), [request]);
  const tableColumns = useMemo(() => getTableColumns(grouping, hasEpicData, hasGroupData), [grouping, hasEpicData, hasGroupData]);

  const groupedBlocks = useMemo(() => buildGroupedBlocks(visibleRows, grouping, tableColumns), [grouping, tableColumns, visibleRows]);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const groupLabelsById = Object.fromEntries(
        request.groupIds
          .map((groupId) => {
            const group = userLookup[getWorklogPrincipalLookupKey(groupId, "group")];
            const displayName = String(group?.displayName || "").trim();
            return displayName ? [groupId, displayName] : null;
          })
          .filter((entry): entry is [string, string] => Boolean(entry))
      );
      const nextReport = await onLoadReport({
        ...request,
        groupLabelsById,
        viewMode: viewModeFromGroupBy(grouping.primary),
        primaryGroupBy: grouping.primary,
        secondaryGroupBy: grouping.secondary,
      });
      setReport(nextReport);
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

  function handleExportCsv() {
    if (groupedBlocks.length === 0) {
      return;
    }

    const header = [...tableColumns.map((column) => GROUP_BY_LABELS[column]), "Time"];

    const csvRows = groupedBlocks.flatMap((block, blockIndex) => {
      const rows = block.rows.map((row, rowIndex) => [
        ...tableColumns.map((column, columnIndex) =>
          csvValue(shouldRenderColumnValue(block.rows, rowIndex, columnIndex, tableColumns) ? getRowLabel(row, column) : "")
        ),
        csvValue(formatDuration(row.secondsSpent)),
      ].join(","));

      const subtotal = tableColumns.map((_, columnIndex) => {
        if (columnIndex === Math.max(tableColumns.length - 1, 0)) {
          return csvValue("Celkem");
        }
        return csvValue("");
      });
      rows.push([...subtotal, csvValue(formatDuration(block.totalSeconds))].join(","));

      if (blockIndex < groupedBlocks.length - 1) {
        rows.push(header.map(() => csvValue("")).join(","));
      }

      return rows;
    });

    csvRows.push(
      [
        ...tableColumns.map((_, columnIndex) => csvValue(columnIndex === Math.max(tableColumns.length - 1, 0) ? "Celkem celkem" : "")),
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
                <option value="pie">Pie</option>
                <option value="bar">Bar</option>
              </select>
            </label>
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
          <div className="worklog-results__toolbar">
            <div className="worklog-results__stats">
              <span>{summary.issueCount} issues · {summary.userCount} users · {summary.totalEntries} entries · {summary.blockCount} groups</span>
            </div>
          </div>

          <WorklogGroupedTable blocks={groupedBlocks} columns={tableColumns} />

          <div className="worklog-visuals">
            <div className="worklog-chart-card">
              <WorklogChart chartType={chartType} data={chartData} groupBy={grouping.primary} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function WorklogGroupedTable({
  blocks,
  columns,
}: {
  blocks: GroupedBlock[];
  columns: JiraWorklogGroupBy[];
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
              <th key={column}>{GROUP_BY_LABELS[column]}</th>
            ))}
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <WorklogGroupedTableBlock
              block={block}
              columns={columns}
              key={block.id}
            />
          ))}
          <tr className="worklog-sheet__grand-total">
            {columns.map((column, columnIndex) => (
              <td key={column}>{columnIndex === Math.max(columns.length - 1, 0) ? "Celkem" : ""}</td>
            ))}
            <td>{formatDuration(totalSeconds)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function WorklogGroupedTableBlock({
  block,
  columns,
}: {
  block: GroupedBlock;
  columns: JiraWorklogGroupBy[];
}) {
  return (
    <>
      {block.rows.map((row, rowIndex) => (
        <tr key={row.id}>
          {columns.map((column, columnIndex) => (
            <td key={`${row.id}-${column}`} title={getRowMeta(row, column)}>
              {shouldRenderColumnValue(block.rows, rowIndex, columnIndex, columns) ? renderRowValue(row, column) : ""}
            </td>
          ))}
          <td className="worklog-sheet__time">{formatDuration(row.secondsSpent)}</td>
        </tr>
      ))}
      <tr className="worklog-sheet__subtotal">
        {columns.map((column, columnIndex) => (
          <td key={`${block.id}-${column}-subtotal`}>{columnIndex === Math.max(columns.length - 1, 0) ? "Celkem" : ""}</td>
        ))}
        <td className="worklog-sheet__time">{formatDuration(block.totalSeconds)}</td>
      </tr>
    </>
  );
}

function buildGroupedBlocks(rows: JiraWorklogRow[], grouping: WorklogGrouping, columns: JiraWorklogGroupBy[]): GroupedBlock[] {
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
      rows: [...block.rows].sort((left, right) => compareRows(left, right, columns)),
    }))
    .sort((left, right) => left.primaryLabel.localeCompare(right.primaryLabel));
}

function buildChartData(rows: JiraWorklogRow[], groupBy: JiraWorklogGroupBy) {
  const groups = new Map<string, number>();

  for (const row of rows) {
    const label = getWorklogRowGroupValue(row, groupBy);
    groups.set(label, (groups.get(label) || 0) + row.secondsSpent);
  }

  return [...groups.entries()]
    .map(([label, secondsSpent], index) => ({
      label,
      secondsSpent,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }))
    .sort((left, right) => right.secondsSpent - left.secondsSpent);
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
  return ["epic", "issue", "user", "group"];
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

function getTableColumns(grouping: WorklogGrouping, hasEpicData: boolean, hasGroupData: boolean): JiraWorklogGroupBy[] {
  const leadingEpic = hasEpicData && grouping.primary !== "epic" && grouping.secondary !== "epic" ? (["epic"] as JiraWorklogGroupBy[]) : [];
  const availableDimensions: JiraWorklogGroupBy[] = [
    ...(hasEpicData ? (["epic"] as JiraWorklogGroupBy[]) : []),
    "issue",
    "user",
    ...(hasGroupData ? (["group"] as JiraWorklogGroupBy[]) : []),
  ];
  return [...new Set([...leadingEpic, grouping.primary, ...(grouping.secondary ? [grouping.secondary] : []), ...availableDimensions])];
}

function aggregateRows(rows: JiraWorklogRow[]): GroupedRow[] {
  const aggregated = new Map<string, GroupedRow>();

  for (const row of rows) {
    const epic = row.epicKey || "Without epic";
    const groupNames = getWorklogGroupNames(row);
    const group = groupNames.join(", ") || "Without group";
    const key = [epic, row.issueKey, row.author, group].join("|");
    const existing = aggregated.get(key);

    if (existing) {
      existing.secondsSpent += row.secondsSpent;
      continue;
    }

    aggregated.set(key, {
      id: key,
      epic,
      epicMeta: row.epicKey || "",
      issue: row.issueKey,
      issueMeta: row.issueTitle,
      issueUrl: row.issueUrl,
      group,
      groupMeta: groupNames.join(", "),
      user: row.author,
      userMeta: row.accountId,
      secondsSpent: row.secondsSpent,
    });
  }

  return [...aggregated.values()];
}

function compareRows(left: GroupedRow, right: GroupedRow, columns: JiraWorklogGroupBy[]) {
  for (const column of columns) {
    const value = getRowLabel(left, column).localeCompare(getRowLabel(right, column));
    if (value !== 0) {
      return value;
    }
  }
  return right.secondsSpent - left.secondsSpent;
}

function getRowLabel(row: GroupedRow, column: JiraWorklogGroupBy) {
  if (column === "epic") {
    return row.epic;
  }
  if (column === "group") {
    return row.group;
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
  if (column === "group") {
    return row.groupMeta;
  }
  if (column === "user") {
    return row.userMeta;
  }
  return row.issueMeta;
}

function renderRowValue(row: GroupedRow, column: JiraWorklogGroupBy) {
  const label = getRowLabel(row, column);
  if (column === "issue" && row.issueUrl) {
    return (
      <a className="worklog-sheet__link" href={row.issueUrl} rel="noreferrer" target="_blank">
        {label}
      </a>
    );
  }
  return label;
}

function getWorklogRowGroupValue(row: JiraWorklogRow, groupBy: JiraWorklogGroupBy) {
  if (groupBy === "epic") {
    return row.epicKey || "Without epic";
  }
  if (groupBy === "group") {
    return getWorklogGroupNames(row).join(", ") || "Without group";
  }
  if (groupBy === "user") {
    return row.author;
  }
  return row.issueKey;
}

function getWorklogGroupNames(row: JiraWorklogRow) {
  return Array.isArray(row.groupNames)
    ? row.groupNames.map((groupName) => String(groupName || "").trim()).filter(Boolean)
    : [];
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
}: {
  chartType: WorklogChartType;
  data: Array<{ label: string; secondsSpent: number; color: string }>;
  groupBy: JiraWorklogGroupBy;
}) {
  const [activeLabel, setActiveLabel] = useState("");

  if (data.length === 0) {
    return <div className="worklog-chart-empty">No chart data</div>;
  }

  const totalSeconds = data.reduce((sum, item) => sum + item.secondsSpent, 0);
  const activeItem = data.find((item) => item.label === activeLabel) || null;

  return (
    <div className={`worklog-chart worklog-chart--${chartType}`}>
      <div className="worklog-chart__visual">
        <div className={`worklog-chart__info ${activeItem ? "is-active" : ""}`}>
          <strong>{activeItem ? activeItem.label : `${GROUP_BY_LABELS[groupBy]} split`}</strong>
          <span>{activeItem ? `${formatDuration(activeItem.secondsSpent)} • ${formatShare(activeItem.secondsSpent, totalSeconds)}` : `${formatDuration(totalSeconds)} total`}</span>
        </div>
        {chartType === "bar" ? (
          <WorklogBarChart activeLabel={activeLabel} data={data} />
        ) : (
          <WorklogPieChart
            activeItem={activeItem}
            activeLabel={activeLabel}
            cutout={chartType === "donut" ? 56 : 0}
            data={data}
            totalSeconds={totalSeconds}
          />
        )}
      </div>
      <div className="worklog-chart-legend">
        {data.map((item) => (
          <button
            className={`worklog-chart-legend__item ${activeLabel === item.label ? "is-active" : ""} ${activeLabel && activeLabel !== item.label ? "is-muted" : ""}`}
            key={item.label}
            onClick={() => setActiveLabel((current) => (current === item.label ? "" : item.label))}
            type="button"
          >
            <span className="worklog-chart-legend__swatch" style={{ backgroundColor: item.color }} />
            <div>
              <strong>{item.label}</strong>
              <span>{formatDuration(item.secondsSpent)} • {formatShare(item.secondsSpent, totalSeconds)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorklogPieChart({
  activeItem,
  activeLabel,
  cutout,
  data,
  totalSeconds,
}: {
  activeItem: { label: string; secondsSpent: number; color: string } | null;
  activeLabel: string;
  cutout: number;
  data: Array<{ label: string; secondsSpent: number; color: string }>;
  totalSeconds: number;
}) {
  const total = data.reduce((sum, item) => sum + item.secondsSpent, 0);
  let currentAngle = -90;

  const segments = data.length === 1
    ? [
      cutout > 0 ? (
        <circle
          className={activeLabel === data[0].label ? "is-active" : activeLabel ? "is-muted" : ""}
          cx="100"
          cy="100"
          fill="none"
          key={data[0].label}
          r="84"
          stroke={data[0].color}
          strokeWidth="28"
        />
      ) : (
        <circle
          className={activeLabel === data[0].label ? "is-active" : activeLabel ? "is-muted" : ""}
          cx="100"
          cy="100"
          fill={data[0].color}
          key={data[0].label}
          r="84"
        />
      ),
    ]
    : data.map((item) => {
      const sweep = (item.secondsSpent / total) * 360;
      const path = cutout > 0
        ? describeArc(100, 100, 84, currentAngle, currentAngle + sweep)
        : describeWedge(100, 100, 84, currentAngle, currentAngle + sweep);
      const segment = (
        <path
          className={activeLabel === item.label ? "is-active" : activeLabel ? "is-muted" : ""}
          d={path}
          fill={cutout > 0 ? "none" : item.color}
          key={item.label}
          stroke={item.color}
          strokeWidth={cutout > 0 ? 28 : 0}
        />
      );
      currentAngle += sweep;
      return segment;
    });

  return (
    <svg aria-label="Worklog chart" className="worklog-pie-chart" viewBox="0 0 200 200">
      {cutout === 0 ? <circle cx="100" cy="100" fill="rgba(249, 243, 223, 0.04)" r="84" /> : null}
      {segments}
      {cutout > 0 ? (
        <>
          <circle className="worklog-pie-chart__center" cx="100" cy="100" r={cutout} />
          <text className="worklog-pie-chart__total" textAnchor="middle" x="100" y="96">
            {activeItem ? formatDuration(activeItem.secondsSpent) : formatDuration(total)}
          </text>
          <text className="worklog-pie-chart__caption" textAnchor="middle" x="100" y="116">
            {activeItem ? `${activeItem.label} • ${formatShare(activeItem.secondsSpent, totalSeconds)}` : totalSeconds ? "Share of time" : ""}
          </text>
        </>
      ) : null}
    </svg>
  );
}

function WorklogBarChart({
  activeLabel,
  data,
}: {
  activeLabel: string;
  data: Array<{ label: string; secondsSpent: number; color: string }>;
}) {
  const max = Math.max(...data.map((item) => item.secondsSpent), 1);

  return (
    <div className="worklog-bar-chart">
      {data.map((item) => (
        <div className={`worklog-bar-chart__row ${activeLabel === item.label ? "is-active" : activeLabel && activeLabel !== item.label ? "is-muted" : ""}`} key={item.label}>
          <div className="worklog-bar-chart__label">
            <strong>{item.label}</strong>
            <span>{formatDuration(item.secondsSpent)}</span>
          </div>
          <div className="worklog-bar-chart__track">
            <div className="worklog-bar-chart__fill" style={{ backgroundColor: item.color, width: `${(item.secondsSpent / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
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

function describeWedge(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M", centerX, centerY,
    "L", start.x, start.y,
    "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
    "Z",
  ].join(" ");
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
