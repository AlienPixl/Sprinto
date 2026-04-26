import fs from "node:fs";
import {
  PDFDocument,
  rgb,
  StandardFonts,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
} from "pdf-lib";
import * as fontkit from "fontkit";
import sharp from "sharp";

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function buildAuthHeader(settings) {
  const email = String(settings?.serviceAccountEmail || "").trim();
  const token = String(settings?.apiToken || "").trim();
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

function ensureJiraConfigured(settings) {
  const jira = settings?.integrations?.jira || settings?.jira || settings || {};
  const baseUrl = normalizeBaseUrl(jira.baseUrl);
  const serviceAccountEmail = String(jira.serviceAccountEmail || "").trim();
  const apiToken = String(jira.apiToken || "").trim();

  if (!jira.enabled) {
    throw new Error("Jira integration is disabled.");
  }
  if (!baseUrl || !serviceAccountEmail || !apiToken) {
    throw new Error("Jira integration is not fully configured.");
  }

  return {
    ...jira,
    baseUrl,
    serviceAccountEmail,
    apiToken,
  };
}

async function jiraRequest(settings, pathname, options = {}) {
  const jira = ensureJiraConfigured(settings);
  const response = await fetch(`${jira.baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      Authorization: buildAuthHeader(jira),
      ...options.headers,
    },
    body: options.body,
  });

  if (!response.ok) {
    let message = `Jira request failed with status ${response.status}.`;
    try {
      const payload = await response.json();
      message = payload?.errorMessages?.join(" ") || payload?.errors
        ? `${message} ${JSON.stringify(payload.errors || {})}`.trim()
        : message;
    } catch {
    }
    throw new Error(message);
  }

  if (options.expectEmpty) {
    return null;
  }

  return response.json();
}

export async function testJiraConnection(settings) {
  const jira = ensureJiraConfigured(settings);
  const myself = await jiraRequest(jira, "/rest/api/3/myself");
  return {
    ok: true,
    site: jira.baseUrl,
    accountId: String(myself?.accountId || ""),
    displayName: String(myself?.displayName || ""),
  };
}

export async function resolveStoryPointsFieldId(settings) {
  const jira = ensureJiraConfigured(settings);
  const fields = await jiraRequest(jira, "/rest/api/3/field");
  const match = Array.isArray(fields)
    ? fields.find((field) => String(field?.name || "").trim().toLowerCase() === "story points")
    : null;
  if (!match?.id) {
    throw new Error("The Jira field 'Story Points' was not found.");
  }
  return String(match.id);
}

function normalizeBoardType(type) {
  return String(type || "").trim().toLowerCase();
}

function mapJiraBoard(board) {
  return {
    id: String(board?.id || ""),
    name: String(board?.name || ""),
    type: normalizeBoardType(board?.type),
  };
}

function mapJiraUser(user) {
  return {
    accountId: String(user?.accountId || ""),
    displayName: String(user?.displayName || user?.emailAddress || ""),
    emailAddress: String(user?.emailAddress || ""),
    avatarUrl: String(user?.avatarUrls?.["24x24"] || user?.avatarUrls?.["16x16"] || ""),
    active: user?.active !== false,
    scopeType: "user",
  };
}

function mapJiraWorklogGroup(group) {
  const groupId = String(group?.groupId || "").trim();
  const name = String(group?.name || "").trim();
  return {
    accountId: groupId ? `group:${groupId}` : "",
    displayName: name,
    emailAddress: "",
    avatarUrl: "",
    active: true,
    scopeType: "group",
    groupId,
  };
}

function mapJiraWorklogIssueOption(issue) {
  return {
    key: String(issue?.key || ""),
    title: String(issue?.fields?.summary || issue?.key || ""),
    issueType: normalizeJiraIssueTypeName(issue?.fields?.issuetype),
    scopeType: "issue",
  };
}

function mapJiraWorklogProjectOption(project) {
  return {
    key: String(project?.key || ""),
    title: String(project?.name || project?.key || ""),
    issueType: "Project",
    scopeType: "project",
  };
}

function rankWorklogMatch(query, value) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedValue = String(value || "").trim().toLowerCase();

  if (!normalizedQuery || !normalizedValue) {
    return 999;
  }
  if (normalizedValue === normalizedQuery) {
    return 0;
  }
  if (normalizedValue.startsWith(normalizedQuery)) {
    return 1;
  }
  if (normalizedValue.includes(normalizedQuery)) {
    return 2;
  }
  return 3;
}

function dedupeWorklogScopeOptions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${String(item?.scopeType || "issue")}:${String(item?.key || "").trim()}`;
    if (!String(item?.key || "").trim() || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeJiraIssueTypeName(issueType) {
  const rawLabel = String(issueType?.untranslatedName || issueType?.name || issueType || "").trim();
  const normalizedLabel = rawLabel.toLowerCase();
  const knownLabels = {
    "bug": "Bug",
    "chyba": "Bug",
    "epic": "Epic",
    "epos": "Epic",
    "issue": "Issue",
    "projekt": "Project",
    "project": "Project",
    "scénář": "Story",
    "scenario": "Story",
    "story": "Story",
    "sub-task": "Sub-task",
    "subtask": "Sub-task",
    "podúkol": "Sub-task",
    "pod-úkol": "Sub-task",
    "task": "Task",
    "úkol": "Task",
  };

  return knownLabels[normalizedLabel] || rawLabel;
}

function isJiraEpicIssueType(issueType) {
  return normalizeJiraIssueTypeName(issueType).trim().toLowerCase() === "epic";
}

function isHumanJiraUser(user) {
  const accountType = String(user?.accountType || "").trim().toLowerCase();
  const displayName = String(user?.displayName || "").trim().toLowerCase();
  const emailAddress = String(user?.emailAddress || "").trim().toLowerCase();

  if (accountType && accountType !== "atlassian") {
    return false;
  }

  const searchableText = `${displayName} ${emailAddress}`;
  const blockedMarkers = [
    "app",
    "addon",
    "add-on",
    "bot",
    "service account",
    "service-account",
    "technical user",
    "automation",
    "script runner",
  ];

  return blockedMarkers.every((marker) => !searchableText.includes(marker));
}

export async function getJiraBoard(settings, boardId) {
  const jira = ensureJiraConfigured(settings);
  const board = await jiraRequest(jira, `/rest/agile/1.0/board/${encodeURIComponent(boardId)}`);
  return mapJiraBoard(board);
}

export async function listJiraBoards(settings) {
  const jira = ensureJiraConfigured(settings);
  const boards = [];
  let startAt = 0;

  while (true) {
    const page = await jiraRequest(jira, `/rest/agile/1.0/board?startAt=${startAt}&maxResults=50`);
    const values = Array.isArray(page?.values) ? page.values : [];
    boards.push(...values.map(mapJiraBoard));
    if (page?.isLast || values.length === 0) {
      break;
    }
    startAt += values.length;
  }

  return boards
    .filter((board) => jira.offerKanbanBoards || board.type !== "kanban")
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listJiraSprints(settings, boardId) {
  const jira = ensureJiraConfigured(settings);
  const sprints = [];
  let startAt = 0;

  while (true) {
    const page = await jiraRequest(jira, `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?state=active,future&startAt=${startAt}&maxResults=50`);
    const values = Array.isArray(page?.values) ? page.values : [];
    sprints.push(...values.map((sprint) => ({
      id: String(sprint.id),
      name: String(sprint.name || ""),
      state: String(sprint.state || ""),
      startDate: sprint.startDate || null,
      endDate: sprint.endDate || null,
    })));
    if (page?.isLast || values.length === 0) {
      break;
    }
    startAt += values.length;
  }

  return sprints.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listJiraAssignableUsers(settings, issueKey, search = "") {
  const jira = ensureJiraConfigured(settings);
  const users = [];
  const normalizedIssueKey = String(issueKey || "").trim();
  const normalizedSearch = String(search || "").trim();
  let startAt = 0;

  if (!normalizedIssueKey) {
    throw new Error("Issue key is required to load Jira assignees.");
  }

  while (startAt < 1000) {
    const params = new URLSearchParams({
      issueKey: normalizedIssueKey,
      startAt: String(startAt),
      maxResults: "50",
    });
    if (normalizedSearch) {
      params.set("query", normalizedSearch);
    }

    const page = await jiraRequest(jira, `/rest/api/3/user/assignable/search?${params.toString()}`);
    const values = Array.isArray(page) ? page : [];
    users.push(...values.map(mapJiraUser).filter((user) => user.accountId));
    if (values.length < 50) {
      break;
    }
    startAt += values.length;
  }

  return [...new Map(users.map((user) => [user.accountId, user])).values()]
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function listJiraWorklogUsers(settings, search = "") {
  const jira = ensureJiraConfigured(settings);
  const users = [];
  const normalizedSearch = String(search || "").trim();
  let startAt = 0;

  while (startAt < 200) {
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: "50",
      query: normalizedSearch || ".",
    });
    const page = await jiraRequest(jira, `/rest/api/3/user/search?${params.toString()}`);
    const values = Array.isArray(page) ? page : [];
    users.push(...values.filter(isHumanJiraUser).map(mapJiraUser).filter((user) => user.accountId && user.active));
    if (values.length < 50) {
      break;
    }
    startAt += values.length;
  }

  let groups = [];
  if (normalizedSearch) {
    const params = new URLSearchParams({
      query: normalizedSearch,
      maxResults: "20",
      caseInsensitive: "true",
    });
    const groupMatches = await jiraRequest(jira, `/rest/api/3/groups/picker?${params.toString()}`);
    const values = Array.isArray(groupMatches?.groups) ? groupMatches.groups : [];
    groups = values.map(mapJiraWorklogGroup).filter((group) => group.groupId && group.displayName);
  }

  const uniqueGroups = [...new Map(groups.map((group) => [group.groupId, group])).values()]
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const uniqueUsers = [...new Map(users.map((user) => [user.accountId, user])).values()]
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  return [...uniqueGroups, ...uniqueUsers];
}

export async function listJiraIssueLinkTypes(settings) {
  const jira = ensureJiraConfigured(settings);
  const payload = await jiraRequest(jira, "/rest/api/3/issueLinkType");
  const values = Array.isArray(payload?.issueLinkTypes) ? payload.issueLinkTypes : [];
  return values
    .map((type) => ({
      id: String(type?.id || type?.name || ""),
      name: String(type?.name || ""),
      inward: String(type?.inward || ""),
      outward: String(type?.outward || ""),
    }))
    .filter((type) => type.id && (type.name || type.inward || type.outward))
    .sort((left, right) => (left.name || left.outward || left.inward).localeCompare(right.name || right.outward || right.inward));
}

async function listJiraGroupMembers(settings, groupId) {
  const jira = ensureJiraConfigured(settings);
  const normalizedGroupId = String(groupId || "").trim();
  if (!normalizedGroupId) {
    return [];
  }

  const users = [];
  let startAt = 0;
  while (startAt < 5000) {
    const params = new URLSearchParams({
      groupId: normalizedGroupId,
      includeInactiveUsers: "false",
      startAt: String(startAt),
      maxResults: "50",
    });
    const page = await jiraRequest(jira, `/rest/api/3/group/member?${params.toString()}`);
    const values = Array.isArray(page?.values) ? page.values : [];
    users.push(...values.filter(isHumanJiraUser).map(mapJiraUser).filter((user) => user.accountId && user.active));
    if (page?.isLast === true || values.length < 50) {
      break;
    }
    startAt += values.length;
  }

  return [...new Map(users.map((user) => [user.accountId, user])).values()];
}

function normalizeImportOrder(value) {
  return value === "priority" ? "priority" : "issue-key";
}

function extractIssueKeyParts(key) {
  const value = String(key || "").trim().toUpperCase();
  const match = value.match(/^([A-Z][A-Z0-9_]*)-(\d+)$/);
  if (!match) {
    return { prefix: value, number: Number.POSITIVE_INFINITY };
  }
  return { prefix: match[1], number: Number(match[2]) };
}

function compareIssueKeys(left, right) {
  const leftParts = extractIssueKeyParts(left?.key);
  const rightParts = extractIssueKeyParts(right?.key);
  const prefixComparison = leftParts.prefix.localeCompare(rightParts.prefix);
  if (prefixComparison !== 0) {
    return prefixComparison;
  }
  if (leftParts.number !== rightParts.number) {
    return leftParts.number - rightParts.number;
  }
  return String(left?.title || "").localeCompare(String(right?.title || ""));
}

function priorityWeight(priority) {
  const name = String(priority?.name || "").trim().toLowerCase();
  const idNumber = Number(priority?.id);
  const namedWeights = {
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

function sortImportedIssues(issues, importOrder) {
  const normalizedOrder = normalizeImportOrder(importOrder);
  const sorted = [...issues];

  if (normalizedOrder === "priority") {
    sorted.sort((left, right) => {
      const priorityComparison = priorityWeight(left.priority) - priorityWeight(right.priority);
      if (priorityComparison !== 0) {
        return priorityComparison;
      }
      return compareIssueKeys(left, right);
    });
    return sorted;
  }

  sorted.sort(compareIssueKeys);
  return sorted;
}

function buildJiraIssuePath({ boardId, sprintId, storyPointsFieldId, startAt }) {
  const fields = `summary,priority,reporter,timetracking,issuetype,status,${encodeURIComponent(storyPointsFieldId)}`;
  if (sprintId) {
    return `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint/${encodeURIComponent(sprintId)}/issue?startAt=${startAt}&maxResults=50&fields=${fields}`;
  }
  return `/rest/agile/1.0/board/${encodeURIComponent(boardId)}/issue?startAt=${startAt}&maxResults=50&fields=${fields}`;
}

function matchesIssueImportFilters(issue, storyPointsFieldId, filters) {
  const storyPointsValue = issue?.fields?.[storyPointsFieldId];
  const originalEstimateSeconds = issue?.fields?.timetracking?.originalEstimateSeconds ?? null;

  if (filters.storyPointsEmpty && storyPointsValue !== null && storyPointsValue !== undefined && storyPointsValue !== "") {
    return false;
  }
  if (filters.originalEstimateEmpty && originalEstimateSeconds !== null && originalEstimateSeconds !== undefined) {
    return false;
  }
  return true;
}

function mapImportedJiraIssue(issue, jira, storyPointsFieldId) {
  return {
    id: String(issue.id),
    key: String(issue.key),
    title: String(issue.fields?.summary || issue.key || ""),
    issueUrl: `${jira.baseUrl}/browse/${encodeURIComponent(issue.key)}`,
    reporter: String(issue.fields?.reporter?.displayName || issue.fields?.reporter?.emailAddress || ""),
    priority: issue.fields?.priority
      ? {
          id: String(issue.fields.priority.id || ""),
          name: String(issue.fields.priority.name || ""),
        }
      : null,
    storyPoints: issue.fields?.[storyPointsFieldId] ?? null,
    originalEstimateSeconds: issue.fields?.timetracking?.originalEstimateSeconds ?? null,
    status: String(issue.fields?.status?.name || ""),
    issueType: String(issue.fields?.issuetype?.name || ""),
    jiraFieldsSnapshot: {
      priority: issue.fields?.priority || null,
      reporter: issue.fields?.reporter || null,
      status: issue.fields?.status || null,
      issueType: issue.fields?.issuetype || null,
      storyPoints: issue.fields?.[storyPointsFieldId] ?? null,
      timetracking: issue.fields?.timetracking || {},
    },
  };
}

export async function listJiraIssues(settings, { boardId, sprintId, filters = {} }) {
  const jira = ensureJiraConfigured(settings);
  const storyPointsFieldId = await resolveStoryPointsFieldId(jira);
  const issues = [];
  let startAt = 0;

  while (true) {
    const page = await jiraRequest(
      jira,
      buildJiraIssuePath({ boardId, sprintId, storyPointsFieldId, startAt })
    );
    const values = Array.isArray(page?.issues) ? page.issues : [];
    issues.push(...values);
    if (startAt + values.length >= Number(page?.total || 0) || values.length === 0) {
      break;
    }
    startAt += values.length;
  }

  return sortImportedIssues(
    issues
    .filter((issue) => matchesIssueImportFilters(issue, storyPointsFieldId, filters))
    .map((issue) => mapImportedJiraIssue(issue, jira, storyPointsFieldId)),
    filters.importOrder
  );
}

export async function listJiraSprintIssues(settings, options) {
  return listJiraIssues(settings, options);
}

function formatOriginalEstimate(minutes) {
  const totalMinutes = Math.max(1, Number(minutes) || 0);
  const hours = Math.floor(totalMinutes / 60);
  const restMinutes = totalMinutes % 60;
  if (hours > 0 && restMinutes > 0) {
    return `${hours}h ${restMinutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${restMinutes}m`;
}

export async function applyJiraEstimate(settings, issueKey, payload) {
  const jira = ensureJiraConfigured(settings);
  const updateFields = {};
  const storyPointsValue = Number(payload?.storyPointsValue);
  const originalEstimate = String(payload?.originalEstimate || "").trim();

  if (payload.mode === "story-points" || payload.mode === "both") {
    if (!Number.isFinite(storyPointsValue)) {
      throw new Error("Story Points value must be numeric to write estimates to Jira.");
    }
    const storyPointsFieldId = await resolveStoryPointsFieldId(jira);
    updateFields[storyPointsFieldId] = storyPointsValue;
  }

  if (payload.mode === "original-estimate" || payload.mode === "both") {
    const minutesPerStoryPoint = Math.max(1, Number(payload?.minutesPerStoryPoint) || 30);
    const resolvedOriginalEstimate = originalEstimate || (Number.isFinite(storyPointsValue) ? formatOriginalEstimate(storyPointsValue * minutesPerStoryPoint) : "");
    if (!resolvedOriginalEstimate) {
      throw new Error("Original Estimate must be provided.");
    }
    updateFields.timetracking = {
      originalEstimate: resolvedOriginalEstimate,
    };
  }

  await jiraRequest(jira, `/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: updateFields }),
    expectEmpty: true,
  });

  return {
    issueKey,
    updatedFields: Object.keys(updateFields),
  };
}

export async function assignJiraIssue(settings, issueKey, accountId) {
  const jira = ensureJiraConfigured(settings);
  const normalizedIssueKey = String(issueKey || "").trim();
  const normalizedAccountId = String(accountId || "").trim();

  if (!normalizedIssueKey) {
    throw new Error("Issue key is required to update Jira assignee.");
  }

  await jiraRequest(jira, `/rest/api/3/issue/${encodeURIComponent(normalizedIssueKey)}/assignee`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountId: normalizedAccountId || null,
    }),
    expectEmpty: true,
  });

  return {
    issueKey: normalizedIssueKey,
    accountId: normalizedAccountId,
  };
}

function escapeCommentValue(value) {
  return String(value || "").replace(/[{}]/g, "");
}

function buildCommentDocument(payload) {
  if (payload.commentDocument) {
    return payload.commentDocument;
  }
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: escapeCommentValue(payload.comment || "") }],
      },
    ],
  };
}

export async function postJiraIssueReport(settings, issueKey, payload) {
  const jira = ensureJiraConfigured(settings);
  let uploadedAttachment = null;

  if (payload.pdfBuffer) {
    uploadedAttachment = await fetch(`${jira.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`, {
      method: "POST",
      headers: {
        Authorization: buildAuthHeader(jira),
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
      },
      body: (() => {
        const form = new FormData();
        const blob = new Blob([payload.pdfBuffer], { type: "application/pdf" });
        form.append("file", blob, payload.filename || `${issueKey}-sprinto-report.pdf`);
        return form;
      })(),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Jira attachment upload failed with status ${response.status}.`);
      }
      const attachments = await response.json();
      if (Array.isArray(attachments)) {
        return attachments[0] || null;
      }
      if (attachments && typeof attachments === "object") {
        return attachments;
      }
      return null;
    });
  }

  if (payload.comment || payload.commentDocument) {
    await jiraRequest(jira, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: buildCommentDocument({
          ...payload,
          attachment: uploadedAttachment,
        }),
      }),
    });
  }

  return {
    issueKey,
    commentPosted: Boolean(payload.comment || payload.commentDocument),
    pdfUploaded: Boolean(payload.pdfBuffer),
    attachment: uploadedAttachment,
  };
}

export function createIssueReportComment(report, options = {}) {
  const sentAt = options.sentAt || new Date().toISOString();
  const attachmentUrl = options.attachment?.content || options.attachment?.self || "";
  const attachmentLabel = options.attachment?.filename || options.filename || "";
  const content = [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Sprinto voting report" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: formatReportTimestamp(sentAt) }],
    },
  ];
  if (attachmentLabel && attachmentUrl) {
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: attachmentLabel,
          marks: [
            {
              type: "link",
              attrs: {
                href: attachmentUrl,
                title: attachmentLabel,
              },
            },
          ],
        },
      ],
    });
  }
  return {
    type: "doc",
    version: 1,
    content,
  };
}

function formatReportTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "");
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export async function createSimplePdfBuffer(report) {
  try {
    return await createRichPdfBuffer(report);
  } catch (error) {
    console.warn("Failed to build rich Sprinto PDF report, falling back to simple PDF.", error);
    return await createFallbackPdfBuffer(report);
  }
}

async function createRichPdfBuffer(report) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fonts = await loadPdfFonts(pdfDoc);
  const pageSize = { width: 595, height: 842 };
  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  const margin = 34;
  let cursorY = pageSize.height - margin;

  cursorY = await drawReportHeader(pdfDoc, page, fonts, report, margin, cursorY, pageSize.width - margin * 2);
  cursorY -= 8;
  cursorY = drawSummaryCards(page, fonts, report, margin, cursorY, pageSize.width - margin * 2);
  cursorY -= 16;

  const tableResult = await drawVoteTable(pdfDoc, page, fonts, report, {
    margin,
    cursorY,
    contentWidth: pageSize.width - margin * 2,
    pageSize,
  });
  page = tableResult.page;
  cursorY = tableResult.cursorY - 16;

  if (cursorY < 170) {
    page = pdfDoc.addPage([pageSize.width, pageSize.height]);
    cursorY = pageSize.height - margin;
  }

  cursorY = drawTimelineBlock(page, fonts, report, margin, cursorY, pageSize.width - margin * 2);
  drawFooter(page, fonts, report, margin, 28, pageSize.width - margin * 2);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function createFallbackPdfBuffer(report) {
  const lines = [
    "Sprinto Voting Report",
    `Room: ${report.roomName || "-"}`,
    `Issue: ${report.issueKey || "-"} - ${report.issueTitle || "-"}`,
    `Voting started: ${formatReportTimestamp(report.startedAt)}`,
    `Revealed at: ${formatReportTimestamp(report.revealedAt)}`,
    `Generated: ${formatReportTimestamp(report.sentAt)}`,
    `Final value: ${report.finalValue || "-"}`,
    `Average: ${report.average || "-"}`,
    `Median: ${report.median || "-"}`,
    `Most frequent: ${report.mostFrequent || "-"}`,
    `Highest: ${report.highest || "-"}`,
    `Total voters: ${report.totalVoters || 0}`,
    `Duration: ${report.durationLabel || "-"}`,
    `Participants: ${(report.participants || []).join(", ") || "-"}`,
    `Votes: ${(report.votes || []).join(", ") || "-"}`,
  ];
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let y = 780;

  page.drawText("Sprinto Voting Report", {
    x: 50,
    y,
    font: bold,
    size: 16,
    color: rgb(0.12, 0.19, 0.16),
  });
  y -= 28;

  for (const line of lines.slice(1)) {
    page.drawText(String(line || "").replace(/[^\x20-\x7E]/g, ""), {
      x: 50,
      y,
      font: regular,
      size: 11,
      color: rgb(0.18, 0.2, 0.18),
    });
    y -= 16;
  }

  return Buffer.from(await pdfDoc.save());
}

async function loadPdfFonts(pdfDoc) {
  const regularBytes = readFirstExistingFile([
    process.env.SPRINTO_PDF_FONT_REGULAR,
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ].filter(Boolean));
  const boldBytes = readFirstExistingFile([
    process.env.SPRINTO_PDF_FONT_BOLD,
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
  ].filter(Boolean));

  if (regularBytes && boldBytes) {
    try {
      return {
        regular: await pdfDoc.embedFont(regularBytes),
        bold: await pdfDoc.embedFont(boldBytes),
        unicode: true,
      };
    } catch {
    }
  }

  return {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    unicode: false,
  };
}

function readFirstExistingFile(paths) {
  for (const candidate of paths) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return fs.readFileSync(candidate);
      }
    } catch {
      continue;
    }
  }
  return null;
}

function pdfText(value, unicode) {
  const text = String(value || "");
  return unicode ? text : normalizePdfTextForAnsi(text);
}

function normalizePdfTextForAnsi(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, "\"")
    .replace(/\u2026/g, "...")
    .replace(/\u00B7/g, "*")
    .replace(/[^\x20-\x7E]/g, "");
}

async function drawReportHeader(pdfDoc, page, fonts, report, x, topY, width) {
  const innerPad = 16;
  const logoHeight = 46;
  const logoBox = { x: x + innerPad, y: topY - innerPad - logoHeight, width: 152, height: logoHeight };
  const textX = logoBox.x + logoBox.width + 16;
  const textWidth = width - (textX - x) - innerPad;
  const titleColor = rgb(0.12, 0.19, 0.16);
  const accentColor = rgb(0.89, 0.48, 0.23);
  const muted = rgb(0.35, 0.38, 0.35);
  const contentLineHeight = 10;
  const titleY = logoBox.y + logoBox.height - 14;
  const issueY = titleY - 18;
  const issueLines = wrapTextLines(
    pdfText(`Issue: ${report.issueKey || "-"} - ${report.issueTitle || "-"}`, fonts.unicode),
    fonts.bold,
    9,
    textWidth,
    2,
  );
  const roomY = issueY - issueLines.length * contentLineHeight - 4;
  const roomLines = wrapTextLines(
    pdfText(`Room: ${report.roomName || "-"}`, fonts.unicode),
    fonts.bold,
    9,
    textWidth,
    2,
  );
  const roomBottomY = roomY - (roomLines.length - 1) * contentLineHeight;
  const separatorY = Math.min(logoBox.y, roomBottomY) - 12;
  const metaWidth = width - 32;
  const metaColWidth = metaWidth / 3;
  const metaCellHeight = 24;
  const metaRowGap = 6;
  const metaTopPadding = 10;
  const metaBottomPadding = 12;
  const topRowY = separatorY - metaTopPadding - metaCellHeight;
  const bottomRowY = topRowY - metaRowGap - metaCellHeight;
  const bottomY = bottomRowY - metaBottomPadding;
  const headerHeight = topY - bottomY;

  page.drawRectangle({
    x,
    y: bottomY,
    width,
    height: headerHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.12, 0.19, 0.16),
    borderWidth: 1,
    borderRadius: 14,
  });

  const logoDrawn = await drawLogo(pdfDoc, page, report.logoDataUrl, logoBox)
    || (
      report.fallbackLogoDataUrl
      && report.fallbackLogoDataUrl !== report.logoDataUrl
      && await drawLogo(pdfDoc, page, report.fallbackLogoDataUrl, logoBox)
    );
  if (!logoDrawn) {
    page.drawRectangle({
      x: logoBox.x,
      y: logoBox.y,
      width: logoBox.width,
      height: logoBox.height,
      color: rgb(0.89, 0.48, 0.23),
      borderRadius: 12,
    });
    drawCenteredText(page, pdfText("SPRINTO", fonts.unicode), fonts.bold, 18, logoBox.x, logoBox.y + 13, logoBox.width, rgb(1, 0.97, 0.9));
  }

  page.drawText(pdfText("Sprinto voting report", fonts.unicode), {
    x: textX,
    y: titleY,
    font: fonts.bold,
    size: 10.5,
    color: titleColor,
  });
  drawTextLines(page, issueLines, fonts.bold, 9, textX, issueY, contentLineHeight, accentColor);
  drawTextLines(page, roomLines, fonts.bold, 9, textX, roomY, contentLineHeight, accentColor);

  page.drawLine({
    start: { x: x + innerPad, y: separatorY },
    end: { x: x + width - innerPad, y: separatorY },
    thickness: 0.8,
    color: rgb(0.88, 0.84, 0.76),
  });

  drawLabelValueCell(page, fonts, "Voting started", formatPdfDateTime(report.startedAt), x + 16, topRowY, metaColWidth, metaCellHeight, muted, titleColor);
  drawLabelValueCell(page, fonts, "Revealed at", formatPdfDateTime(report.revealedAt), x + 16 + metaColWidth, topRowY, metaColWidth, metaCellHeight, muted, titleColor);
  drawLabelValueCell(page, fonts, "Generated", formatPdfDateTime(report.sentAt), x + 16 + metaColWidth * 2, topRowY, metaColWidth, metaCellHeight, muted, titleColor);
  drawLabelValueCell(page, fonts, "Total voters", String(report.totalVoters ?? "-"), x + 16, bottomRowY, metaColWidth, metaCellHeight, muted, titleColor);
  drawLabelValueCell(page, fonts, "Duration", String(report.durationLabel || "-"), x + 16 + metaColWidth, bottomRowY, metaColWidth, metaCellHeight, muted, titleColor);
  drawLabelValueCell(page, fonts, "Final value", String(report.finalValue || "-"), x + 16 + metaColWidth * 2, bottomRowY, metaColWidth, metaCellHeight, muted, titleColor);
  return bottomY;
}

async function drawLogo(pdfDoc, page, logoDataUrl, box) {
  const image = await embedDataUrlImage(pdfDoc, logoDataUrl);
  if (!image) {
    return false;
  }
  const dims = image.scale(1);
  const fit = Math.min(box.width / dims.width, box.height / dims.height);
  const width = dims.width * fit;
  const height = dims.height * fit;
  page.drawImage(image, {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  });
  return true;
}

export function parseImageDataUrl(dataUrl) {
  const value = String(dataUrl || "");
  if (!value.startsWith("data:")) {
    return null;
  }
  const separatorIndex = value.indexOf(",");
  if (separatorIndex < 0) {
    return null;
  }
  const metadata = value.slice(5, separatorIndex);
  const payload = value.slice(separatorIndex + 1);
  const [mimeType = "", ...params] = metadata.split(";");
  const mime = mimeType.toLowerCase();
  if (!/^image\/[a-zA-Z0-9.+-]+$/i.test(mime)) {
    return null;
  }
  const isBase64 = params.some((param) => param.trim().toLowerCase() === "base64");
  const bytes = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { mime, bytes };
}

async function embedDataUrlImage(pdfDoc, dataUrl) {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    return null;
  }
  const { mime } = parsed;
  let { bytes } = parsed;
  if (mime === "image/svg+xml" || mime === "image/webp" || mime === "image/gif") {
    return embedImageBufferAsPng(pdfDoc, bytes);
  }
  if (mime === "image/png") {
    try {
      return await pdfDoc.embedPng(bytes);
    } catch {
      return embedImageBufferWithFallback(pdfDoc, bytes, "png");
    }
  }
  if (mime === "image/jpeg" || mime === "image/jpg") {
    try {
      return await pdfDoc.embedJpg(bytes);
    } catch {
      return embedImageBufferWithFallback(pdfDoc, bytes, "jpg");
    }
  }
  return embedImageBufferWithFallback(pdfDoc, bytes);
}

async function embedImageBufferWithFallback(pdfDoc, bytes, preferredFormat = "") {
  if (preferredFormat !== "png") {
    try {
      return await pdfDoc.embedPng(bytes);
    } catch {
    }
  }

  if (preferredFormat !== "jpg") {
    try {
      return await pdfDoc.embedJpg(bytes);
    } catch {
    }
  }

  return embedImageBufferAsPng(pdfDoc, bytes);
}

async function embedImageBufferAsPng(pdfDoc, bytes) {
  try {
    const pngBytes = await sharp(bytes, { density: 300 }).png().toBuffer();
    return await pdfDoc.embedPng(pngBytes);
  } catch {
    return null;
  }
}

function drawSummaryCards(page, fonts, report, x, topY, width) {
  const cards = [
    ["Average", report.average || "-"],
    ["Median", report.median || "-"],
    ["Most frequent", report.mostFrequent || "-"],
    ["Highest", report.highest || "-"],
  ];
  const gap = 8;
  const cardWidth = (width - gap * 3) / 4;
  const cardHeight = 28;
  cards.forEach(([label, value], index) => {
    const cardX = x + index * (cardWidth + gap);
    page.drawRectangle({
      x: cardX,
      y: topY - cardHeight,
      width: cardWidth,
      height: cardHeight,
      color: rgb(0.995, 0.992, 0.984),
      borderColor: rgb(0.87, 0.83, 0.74),
      borderWidth: 0.95,
      borderRadius: 8,
    });
    page.drawLine({
      start: { x: cardX + 1.5, y: topY - 1.5 },
      end: { x: cardX + cardWidth - 1.5, y: topY - 1.5 },
      thickness: 1.1,
      color: rgb(0.89, 0.48, 0.23),
    });
    page.drawText(pdfText(label, fonts.unicode), {
      x: cardX + 8,
      y: topY - 8.5,
      font: fonts.regular,
      size: 5.9,
      color: rgb(0.36, 0.38, 0.35),
    });
    const valueText = pdfText(value, fonts.unicode);
    const valueSize = resolveFittedFontSize(valueText, fonts.bold, 9.8, cardWidth - 16, 8.2);
    drawCenteredText(
      page,
      valueText,
      fonts.bold,
      valueSize,
      cardX + 8,
      topY - 19.5,
      cardWidth - 16,
      rgb(0.12, 0.19, 0.16),
    );
  });
  return topY - cardHeight;
}

async function drawVoteTable(pdfDoc, page, fonts, report, options) {
  const { margin, cursorY, contentWidth, pageSize } = options;
  const headerHeight = 18;
  const rowHeight = 24;
  const titleY = cursorY;
  page.drawText(pdfText("Voting details", fonts.unicode), {
    x: margin,
    y: titleY,
    font: fonts.bold,
    size: 11,
    color: rgb(0.14, 0.19, 0.16),
  });
  page.drawText(pdfText(`${report.totalVoters || 0} voters`, fonts.unicode), {
    x: margin + 78,
    y: titleY + 1,
    font: fonts.regular,
    size: 7.5,
    color: rgb(0.39, 0.41, 0.37),
  });
  let y = titleY - 10;
  const columns = [
    { key: "voter", label: "Voter", width: 250 },
    { key: "estimate", label: "Estimate", width: 72 },
    { key: "votedAt", label: "Voted at", width: 92 },
    { key: "duration", label: "Offset", width: 72 },
  ];

  const drawTableHeader = (targetPage, headerY) => {
    targetPage.drawRectangle({
      x: margin,
      y: headerY - headerHeight,
      width: contentWidth,
      height: headerHeight,
      color: rgb(0.12, 0.19, 0.16),
      borderRadius: 10,
    });
    let colX = margin + 12;
    for (const column of columns) {
      if (column.key === "voter") {
        targetPage.drawText(pdfText(column.label, fonts.unicode), {
          x: colX,
          y: headerY - 12,
          font: fonts.bold,
          size: 7,
          color: rgb(0.95, 0.93, 0.88),
        });
      } else {
        drawCenteredText(
          targetPage,
          pdfText(column.label, fonts.unicode),
          fonts.bold,
          7,
          colX,
          headerY - 12,
          column.width,
          rgb(0.95, 0.93, 0.88),
        );
      }
      colX += column.width;
    }
  };

  drawTableHeader(page, y);
  y -= headerHeight;

  const rows = report.voterRows || [];
  for (const [index, row] of rows.entries()) {
    if (y - rowHeight < 140) {
      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = pageSize.height - margin;
      drawTableHeader(page, y);
      y -= headerHeight;
    }
    const bg = index % 2 === 0 ? rgb(0.985, 0.975, 0.95) : rgb(0.96, 0.95, 0.93);
    page.drawRectangle({
      x: margin,
      y: y - rowHeight,
      width: contentWidth,
      height: rowHeight,
      color: bg,
      borderColor: rgb(0.9, 0.86, 0.8),
      borderWidth: 0.5,
    });
    await drawVoterCell(pdfDoc, page, fonts, row, margin + 12, y - 20);
    const estimateX = margin + 12 + columns[0].width;
    const votedAtX = estimateX + columns[1].width;
    const offsetX = votedAtX + columns[2].width;
    drawCenteredText(page, pdfText(row.value || "-", fonts.unicode), fonts.bold, 9, estimateX, y - 16, columns[1].width, rgb(0.12, 0.19, 0.16));
    drawCenteredText(page, pdfText(formatTimeOnly(row.votedAt), fonts.unicode), fonts.regular, 8, votedAtX, y - 16, columns[2].width, rgb(0.22, 0.25, 0.22));
    drawCenteredText(page, pdfText(formatOffset(row.votedAt, report.startedAt), fonts.unicode), fonts.regular, 8, offsetX, y - 16, columns[3].width, rgb(0.22, 0.25, 0.22));
    y -= rowHeight;
  }

  return { page, cursorY: y };
}

async function drawVoterCell(pdfDoc, page, fonts, row, x, baselineY) {
  const avatarSize = 15;
  const avatar = await embedDataUrlImage(pdfDoc, row.avatarDataUrl);
  if (avatar) {
    drawCircularImage(page, avatar, x, baselineY - 1, avatarSize);
  } else {
    page.drawCircle({
      x: x + avatarSize / 2,
      y: baselineY + avatarSize / 2 - 1,
      size: avatarSize / 2,
      color: rgb(0.89, 0.48, 0.23),
    });
    drawCenteredText(page, pdfText(row.initials || "?", fonts.unicode), fonts.bold, 6.8, x, baselineY + 3.3, avatarSize, rgb(1, 0.98, 0.94));
  }
  page.drawText(pdfText(row.name || "-", fonts.unicode), {
    x: x + avatarSize + 10,
    y: baselineY + 2,
    font: fonts.regular,
    size: 8.5,
    color: rgb(0.12, 0.19, 0.16),
  });
}

function drawCircularImage(page, image, x, y, size) {
  const radius = size / 2;
  const centerX = x + radius;
  const centerY = y + radius;
  const kappa = 0.5522847498;
  const controlOffset = radius * kappa;

  page.pushOperators(pushGraphicsState());
  page.pushOperators(
    moveTo(centerX, centerY + radius),
    appendBezierCurve(centerX + controlOffset, centerY + radius, centerX + radius, centerY + controlOffset, centerX + radius, centerY),
    appendBezierCurve(centerX + radius, centerY - controlOffset, centerX + controlOffset, centerY - radius, centerX, centerY - radius),
    appendBezierCurve(centerX - controlOffset, centerY - radius, centerX - radius, centerY - controlOffset, centerX - radius, centerY),
    appendBezierCurve(centerX - radius, centerY + controlOffset, centerX - controlOffset, centerY + radius, centerX, centerY + radius),
    closePath(),
    clip(),
    endPath(),
  );
  page.drawImage(image, { x, y, width: size, height: size });
  page.pushOperators(popGraphicsState());
  page.drawCircle({
    x: centerX,
    y: centerY,
    size: radius,
    borderColor: rgb(0.9, 0.86, 0.8),
    borderWidth: 0.5,
  });
}

function drawTimelineBlock(page, fonts, report, x, topY, width) {
  const titleY = topY - 2;
  page.drawText(pdfText("Timeline", fonts.unicode), {
    x,
    y: titleY,
    font: fonts.bold,
    size: 11,
    color: rgb(0.14, 0.19, 0.16),
  });
  const startedAt = new Date(report.startedAt || report.sentAt || Date.now()).getTime();
  const endAt = new Date(report.revealedAt || report.sentAt || Date.now()).getTime();
  const range = Math.max(1, endAt - startedAt);
  const events = resolveTimelineDisplayEvents(report.timelineEvents || [], report.sentAt)
    .filter((event) => event.type !== "reveal")
    .slice(0, 10);
  const layout = buildPdfTimelineLayout(events, report, fonts, x, width, startedAt, range);
  const labelHeight = 24;
  const connectorBase = 18;
  const laneStep = 28;
  const topPadding = 10;
  const bottomPadding = 10;
  const allItems = [layout.start, layout.reveal, ...layout.events];
  const maxAboveLane = Math.max(0, ...allItems.filter((item) => item.side === "above").map((item) => item.lane));
  const maxBelowLane = Math.max(0, ...allItems.filter((item) => item.side === "below").map((item) => item.lane));
  const axisOffsetFromBottom = bottomPadding + labelHeight + connectorBase + maxBelowLane * laneStep;
  const blockHeight = axisOffsetFromBottom + connectorBase + labelHeight + maxAboveLane * laneStep + topPadding;
  const blockY = titleY - (blockHeight + 10);
  const lineY = blockY + axisOffsetFromBottom;

  page.drawRectangle({
    x,
    y: blockY,
    width,
    height: blockHeight,
    color: rgb(0.96, 0.95, 0.91),
    borderColor: rgb(0.88, 0.84, 0.76),
    borderWidth: 1,
    borderRadius: 16,
  });
  page.drawLine({
    start: { x: x + 24, y: lineY },
    end: { x: x + width - 24, y: lineY },
    thickness: 2,
    color: rgb(0.74, 0.74, 0.7),
  });
  allItems.forEach((item) => {
    drawPdfTimelineItem(page, fonts, item, lineY, {
      connectorBase,
      labelHeight,
      laneStep,
    });
  });
  return blockY;
}

function buildPdfTimelineLayout(events, report, fonts, x, width, startedAt, range) {
  const trackStartX = x + 24;
  const trackEndX = x + width - 24;
  const occupiedBySide = {
    above: [],
    below: [],
  };
  const start = createPdfTimelineAnchorLayout("Start", formatTimeOnly(report.startedAt), trackStartX, fonts, x, width, occupiedBySide, rgb(0.23, 0.36, 0.31));
  const reveal = createPdfTimelineAnchorLayout("Reveal", formatTimeOnly(report.revealedAt), trackEndX, fonts, x, width, occupiedBySide, timelineColor("reveal"));
  const startInterval = pdfTimelineInterval(start.markerX, start.labelWidth, x, width);
  const revealInterval = pdfTimelineInterval(reveal.markerX, reveal.labelWidth, x, width);
  const eventLayouts = events.map((event, index) => {
    const eventAt = new Date(event.occurredAt || report.sentAt || Date.now()).getTime();
    const ratio = Math.max(0, Math.min(1, (eventAt - startedAt) / range));
    const markerX = trackStartX + ratio * (trackEndX - trackStartX);
    const title = timelineEventTitle(event);
    const time = formatTimeOnly(event.occurredAt);
    const labelWidth = estimatePdfTimelineLabelWidth(title, time, fonts);
    const interval = pdfTimelineInterval(markerX, labelWidth, x, width);
    const defaultSide = index % 2 === 0 ? "below" : "above";
    const overlapsAnchor = pdfTimelineIntervalOverlaps(interval, startInterval, 6) || pdfTimelineIntervalOverlaps(interval, revealInterval, 6);
    const side = overlapsAnchor && defaultSide === "above" ? "below" : defaultSide;
    const lane = allocatePdfTimelineLane(occupiedBySide[side], interval, 6);
    return {
      color: timelineColor(event.type),
      isAnchor: false,
      labelWidth,
      lane,
      markerX,
      side,
      time,
      title,
      x: interval.start,
    };
  });
  return {
    events: eventLayouts,
    reveal,
    start,
  };
}

function createPdfTimelineAnchorLayout(title, time, markerX, fonts, x, width, occupiedBySide, color) {
  const labelWidth = estimatePdfTimelineLabelWidth(title, time, fonts);
  const interval = pdfTimelineInterval(markerX, labelWidth, x, width);
  const side = "above";
  const lane = allocatePdfTimelineLane(occupiedBySide[side], interval, 6);
  return {
    color,
    isAnchor: true,
    labelWidth,
    lane,
    markerX,
    side,
    time,
    title,
    x: interval.start,
  };
}

function allocatePdfTimelineLane(lanes, nextInterval, gap) {
  let lane = 0;
  while (lane < lanes.length) {
    const hasCollision = lanes[lane].some((interval) => (
      nextInterval.start < interval.end + gap && nextInterval.end > interval.start - gap
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

function pdfTimelineInterval(markerX, labelWidth, x, width) {
  const start = Math.max(x + 8, Math.min(markerX - labelWidth / 2, x + width - labelWidth - 8));
  return {
    end: start + labelWidth,
    start,
  };
}

function pdfTimelineIntervalOverlaps(left, right, gap) {
  return left.start < right.end + gap && left.end > right.start - gap;
}

function estimatePdfTimelineLabelWidth(title, time, fonts) {
  const titleWidth = fonts.bold.widthOfTextAtSize(pdfText(title, fonts.unicode), 6.6);
  const timeWidth = fonts.regular.widthOfTextAtSize(pdfText(time, fonts.unicode), 6.1);
  return Math.max(58, Math.min(92, Math.max(titleWidth, timeWidth) + 16));
}

function drawPdfTimelineItem(page, fonts, item, lineY, options) {
  const { connectorBase, labelHeight, laneStep } = options;
  const connectorHeight = connectorBase + item.lane * laneStep;
  const cardY = item.side === "above"
    ? lineY + connectorHeight
    : lineY - connectorHeight - labelHeight;
  const connectorStartY = item.side === "above" ? lineY + 5 : lineY - 5;
  const connectorEndY = item.side === "above" ? cardY : cardY + labelHeight;
  const markerRadius = item.isAnchor ? 5 : 4.5;
  const titleText = truncateTextWithEllipsis(pdfText(item.title, fonts.unicode), fonts.bold, 6.6, item.labelWidth - 12);
  const timeText = truncateTextWithEllipsis(pdfText(item.time, fonts.unicode), fonts.regular, 6.1, item.labelWidth - 12);

  page.drawLine({
    start: { x: item.markerX, y: connectorStartY },
    end: { x: item.markerX, y: connectorEndY },
    thickness: 1,
    color: rgb(0.68, 0.67, 0.63),
    dashArray: [2, 2],
  });
  page.drawCircle({
    x: item.markerX,
    y: lineY,
    size: markerRadius,
    color: item.color,
    borderColor: rgb(1, 1, 1),
    borderWidth: 0.8,
  });
  page.drawRectangle({
    x: item.x,
    y: cardY,
    width: item.labelWidth,
    height: labelHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.87, 0.84, 0.78),
    borderWidth: 0.7,
    borderRadius: 10,
  });
  drawCenteredText(page, titleText, fonts.bold, 6.6, item.x, cardY + 14, item.labelWidth, rgb(0.18, 0.22, 0.2));
  drawCenteredText(page, timeText, fonts.regular, 6.1, item.x, cardY + 6, item.labelWidth, rgb(0.45, 0.46, 0.42));
}

function drawFooter(page, fonts, report, x, y, width) {
  page.drawLine({
    start: { x, y: y + 18 },
    end: { x: x + width, y: y + 18 },
    thickness: 1,
    color: rgb(0.86, 0.84, 0.8),
  });
  const leftText = pdfText("Generated by Sprinto", fonts.unicode);
  const rightText = pdfText(" | Created by Martin Janecek", fonts.unicode);
  const leftWidth = fonts.bold.widthOfTextAtSize(leftText, 8);
  const rightWidth = fonts.regular.widthOfTextAtSize(rightText, 8);
  const startX = x + (width - (leftWidth + rightWidth)) / 2;
  page.drawText(leftText, {
    x: startX,
    y,
    font: fonts.bold,
    size: 8,
    color: rgb(0.18, 0.2, 0.18),
  });
  page.drawText(rightText, {
    x: startX + leftWidth,
    y,
    font: fonts.regular,
    size: 8,
    color: rgb(0.34, 0.36, 0.34),
  });
}

function drawLabelValueCell(page, fonts, label, value, x, y, width, height, labelColor, valueColor) {
  const valueText = pdfText(value || "-", fonts.unicode);
  const valueSize = resolveFittedFontSize(valueText, fonts.bold, 9.2, width - 2, 7.2);
  page.drawText(pdfText(label, fonts.unicode), {
    x,
    y: y + height - 7,
    font: fonts.regular,
    size: 6.8,
    color: labelColor,
  });
  page.drawText(valueText, {
    x,
    y: y + 5,
    font: fonts.bold,
    size: valueSize,
    color: valueColor,
  });
}

function drawWrappedText(page, text, font, size, x, y, maxWidth, lineHeight, color, maxLines = 3) {
  const lines = wrapTextLines(text, font, size, maxWidth, maxLines);
  drawTextLines(page, lines, font, size, x, y, lineHeight, color);
  return lines.length;
}

function resolveTimelineDisplayEvents(events, sentAt) {
  const normalized = Array.isArray(events) ? events : [];
  const prioritized = normalized.filter((event) => event.type === "vote" || event.type === "reveal");
  return prioritized.length > 0 ? prioritized : normalized.filter(Boolean).slice(0, 10).map((event) => ({
    ...event,
    occurredAt: event.occurredAt || sentAt,
  }));
}

function timelineEventTitle(event) {
  const participant = shortTimelineName(event.participantName || event.userId);
  if (event.type === "vote") {
    return event.value ? `${participant} (${event.value})` : `${participant} vote`;
  }
  if (event.type === "join") {
    return `${participant} joined`;
  }
  if (event.type === "leave") {
    return `${participant} left`;
  }
  return capitalizeWord(event.type || "event");
}

function shortTimelineName(value) {
  const parts = String(value || "").split(" ").filter(Boolean);
  if (parts.length === 0) {
    return "User";
  }
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
}

function drawCenteredText(page, text, font, size, x, y, width, color) {
  const textWidth = font.widthOfTextAtSize(String(text || ""), size);
  page.drawText(String(text || ""), {
    x: x + Math.max(0, (width - textWidth) / 2),
    y,
    font,
    size,
    color,
  });
}

function drawTextLines(page, lines, font, size, x, y, lineHeight, color) {
  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      font,
      size,
      color,
    });
  });
}

function wrapTextLines(text, font, size, maxWidth, maxLines = Number.POSITIVE_INFINITY) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  });
  if (current) {
    lines.push(current);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const visibleLines = lines.slice(0, maxLines);
  visibleLines[visibleLines.length - 1] = truncateTextWithEllipsis(
    [...lines.slice(maxLines - 1)].join(" "),
    font,
    size,
    maxWidth,
  );
  return visibleLines;
}

function truncateTextWithEllipsis(text, font, size, maxWidth) {
  const ellipsis = "...";
  let visibleText = String(text || "").trim();
  if (!visibleText) {
    return ellipsis;
  }
  if (font.widthOfTextAtSize(visibleText, size) <= maxWidth) {
    return visibleText;
  }

  while (visibleText && font.widthOfTextAtSize(`${visibleText}${ellipsis}`, size) > maxWidth) {
    visibleText = visibleText.slice(0, -1).trimEnd();
  }

  return visibleText ? `${visibleText}${ellipsis}` : ellipsis;
}

function resolveFittedFontSize(text, font, initialSize, maxWidth, minSize = 6.5) {
  let size = initialSize;
  while (size > minSize && font.widthOfTextAtSize(String(text || ""), size) > maxWidth) {
    size -= 0.2;
  }
  return size;
}

function formatPdfDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatTimeOnly(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatOffset(value, startedAt) {
  const target = new Date(value || "").getTime();
  const start = new Date(startedAt || "").getTime();
  if (Number.isNaN(target) || Number.isNaN(start)) return "-";
  const seconds = Math.max(0, Math.round((target - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `+${minutes}:${String(remaining).padStart(2, "0")}`;
}

function timelineColor(type) {
  if (type === "reveal") return rgb(0.77, 0.23, 0.19);
  if (type === "vote") return rgb(0.12, 0.55, 0.36);
  if (type === "join") return rgb(0.22, 0.47, 0.78);
  if (type === "leave") return rgb(0.62, 0.46, 0.21);
  return rgb(0.45, 0.45, 0.45);
}

function capitalizeWord(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

async function fetchIssueDetails(settings, issueKey, fields = ["summary", "issuetype", "status", "issuelinks"]) {
  const jira = ensureJiraConfigured(settings);
  const joinedFields = fields.join(",");
  return jiraRequest(jira, `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent(joinedFields)}`);
}

async function searchIssues(settings, jql, fields = ["summary", "issuetype", "status", "assignee"]) {
  const jira = ensureJiraConfigured(settings);
  const issues = [];
  let startAtOrToken = 0;
  let nextPageToken = null;

  while (true) {
    let page;
    try {
      page = await jiraRequest(jira, "/rest/api/3/search/jql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jql,
          fields,
          maxResults: 50,
          ...(nextPageToken ? { nextPageToken } : {}),
        }),
      });
    } catch (error) {
      page = await jiraRequest(jira, "/rest/api/3/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jql,
          fields,
          startAt: Number(startAtOrToken) || 0,
          maxResults: 50,
        }),
      });
    }

    const values = Array.isArray(page?.issues) ? page.issues : [];
    issues.push(...values);

    if (typeof page?.nextPageToken === "string" && page.nextPageToken) {
      nextPageToken = page.nextPageToken;
      continue;
    }

    if (page?.isLast === true || startAtOrToken + values.length >= Number(page?.total || 0) || values.length === 0) {
      break;
    }

    startAtOrToken += values.length;
  }
  return issues;
}

async function fetchIssueWorklogsInRange(settings, issueKey, dateFrom, dateTo) {
  const jira = ensureJiraConfigured(settings);
  const worklogs = [];
  let startAt = 0;
  const startedAfter = Math.max(0, Number(dateFrom?.getTime?.() || 0));
  const startedBefore = Math.max(startedAfter, Number(dateTo?.getTime?.() || 0) + 1);

  while (true) {
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: "100",
      startedAfter: String(startedAfter),
      startedBefore: String(startedBefore),
    });
    const page = await jiraRequest(jira, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?${params.toString()}`);
    const values = Array.isArray(page?.worklogs) ? page.worklogs : [];
    worklogs.push(...values);

    if (startAt + values.length >= Number(page?.total || 0) || values.length === 0) {
      break;
    }

    startAt += values.length;
  }

  return worklogs;
}

function escapeJqlString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function formatJqlDate(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return parsed.toISOString().slice(0, 10);
}

function buildJqlList(field, values) {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  if (normalizedValues.length === 0) {
    return "";
  }

  if (normalizedValues.length === 1) {
    return `${field} = "${escapeJqlString(normalizedValues[0])}"`;
  }

  return `${field} in (${normalizedValues.map((value) => `"${escapeJqlString(value)}"`).join(", ")})`;
}

function buildWorklogDateJql(filters) {
  const from = formatJqlDate(filters?.dateFrom);
  const to = formatJqlDate(filters?.dateTo);
  return `worklogDate >= "${escapeJqlString(from)}" AND worklogDate <= "${escapeJqlString(to)}"`;
}

function mergeIssueMap(target, issues) {
  issues.forEach((issue) => {
    const issueKey = String(issue?.key || "").trim();
    if (!issueKey) {
      return;
    }
    target.set(issueKey, issue);
  });
}

function getJiraIssueEpic(issue) {
  const issueKey = String(issue?.key || "").trim();
  if (issueKey && isJiraEpicIssueType(issue?.fields?.issuetype)) {
    return {
      key: issueKey,
      title: String(issue?.fields?.summary || issueKey),
    };
  }

  const parent = issue?.fields?.parent;
  const parentKey = String(parent?.key || "").trim();
  if (parentKey && isJiraEpicIssueType(parent?.fields?.issuetype)) {
    return {
      key: parentKey,
      title: String(parent?.fields?.summary || parentKey),
    };
  }

  return null;
}

function mergeEpicMapsFromIssues(epicByIssueKey, epicDetailsByKey, issues) {
  issues.forEach((issue) => {
    const issueKey = String(issue?.key || "").trim();
    if (!issueKey || epicByIssueKey.has(issueKey)) {
      return;
    }
    const epic = getJiraIssueEpic(issue);
    if (epic?.key) {
      epicByIssueKey.set(issueKey, epic.key);
      if (!epicDetailsByKey.has(epic.key)) {
        epicDetailsByKey.set(epic.key, epic);
      }
    }
  });
}

function getJiraLinkedIssueRecords(issue, allowedTypeIds) {
  const sourceIssueKey = String(issue?.key || "").trim();
  if (!sourceIssueKey) {
    return [];
  }

  const links = Array.isArray(issue?.fields?.issuelinks) ? issue.fields.issuelinks : [];
  return links.flatMap((link) => {
    const typeId = String(link?.type?.id || link?.type?.name || "").trim();
    if (allowedTypeIds.size > 0 && !allowedTypeIds.has(typeId)) {
      return [];
    }

    const outwardIssue = link?.outwardIssue;
    const inwardIssue = link?.inwardIssue;
    const linkedIssue = outwardIssue || inwardIssue || null;
    const linkedIssueKey = String(linkedIssue?.key || "").trim();
    if (!linkedIssueKey) {
      return [];
    }

    const direction = outwardIssue ? "outward" : "inward";
    const linkTypeName = String(link?.type?.name || typeId || "").trim();
    const directionalLabel = direction === "outward" ? link?.type?.outward : link?.type?.inward;
    const linkLabel = String(directionalLabel || linkTypeName).trim() || linkTypeName;
    return [{
      issueKey: linkedIssueKey,
      issue: linkedIssue,
      source: {
        sourceIssueKey,
        sourceIssueTitle: String(issue?.fields?.summary || sourceIssueKey),
        linkTypeId: typeId,
        linkTypeName,
        linkLabel,
        linkDirection: direction,
      },
    }];
  });
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const values = Array.isArray(items) ? items : [];
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iteratee(values[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, values.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function searchJiraProjects(settings, query) {
  const jira = ensureJiraConfigured(settings);
  const page = await jiraRequest(
    jira,
    `/rest/api/3/project/search?query=${encodeURIComponent(String(query || "").trim())}&maxResults=10`
  );
  const projects = Array.isArray(page?.values) ? page.values : [];

  return projects
    .map(mapJiraWorklogProjectOption)
    .sort((left, right) => {
      const leftRank = Math.min(rankWorklogMatch(query, left.key), rankWorklogMatch(query, left.title));
      const rightRank = Math.min(rankWorklogMatch(query, right.key), rankWorklogMatch(query, right.title));
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.title.localeCompare(right.title);
    });
}

export async function searchJiraWorklogIssues(settings, query = "") {
  const jira = ensureJiraConfigured(settings);
  const normalizedQuery = String(query || "").trim();

  if (!normalizedQuery) {
    return [];
  }

  let projectMatches = [];
  try {
    projectMatches = await searchJiraProjects(jira, normalizedQuery);
  } catch {
    projectMatches = [];
  }

  let exactIssue = null;
  const exactIssueKeyMatch = normalizedQuery.toUpperCase().match(/^[A-Z][A-Z0-9_]*-\d+$/);
  if (exactIssueKeyMatch) {
    try {
      exactIssue = await getJiraWorklogIssue(jira, exactIssueKeyMatch[0]);
    } catch {
    }
  }

  const picker = await jiraRequest(
    jira,
    `/rest/api/3/issue/picker?query=${encodeURIComponent(normalizedQuery)}&maxResults=20`
  );
  const sectionIssues = Array.isArray(picker?.sections)
    ? picker.sections.flatMap((section) => (Array.isArray(section?.issues) ? section.issues : []))
    : [];
  const uniqueKeys = [...new Set(sectionIssues.map((issue) => String(issue?.key || "")).filter(Boolean))].slice(0, 20);

  if (uniqueKeys.length === 0) {
    const fallbackIssues = await searchIssues(
      jira,
      `summary ~ "${normalizedQuery.replace(/"/g, '\\"')}" order by updated desc`,
      ["summary", "issuetype"]
    );
    const issueMatches = fallbackIssues.slice(0, 20).map(mapJiraWorklogIssueOption);
    return dedupeWorklogScopeOptions(
      exactIssueKeyMatch
        ? [exactIssue, ...projectMatches, ...issueMatches]
        : [...projectMatches, ...issueMatches]
    ).slice(0, 20);
  }

  const detailedIssues = await searchIssues(
    jira,
    `key in (${uniqueKeys.map((key) => `"${String(key).replace(/"/g, '\\"')}"`).join(", ")}) order by updated desc`,
    ["summary", "issuetype"]
  );

  const issueMatches = detailedIssues.map(mapJiraWorklogIssueOption);
  return dedupeWorklogScopeOptions(
    exactIssueKeyMatch
      ? [exactIssue, ...projectMatches, ...issueMatches]
      : [...projectMatches, ...issueMatches]
  ).slice(0, 20);
}

export async function getJiraWorklogIssue(settings, issueKey) {
  const normalizedIssueKey = String(issueKey || "").trim().toUpperCase();
  if (!normalizedIssueKey) {
    return null;
  }
  const issue = await fetchIssueDetails(settings, normalizedIssueKey, ["summary", "issuetype"]);
  return {
    key: String(issue?.key || normalizedIssueKey),
    title: String(issue?.fields?.summary || normalizedIssueKey),
    issueType: normalizeJiraIssueTypeName(issue?.fields?.issuetype),
    scopeType: "issue",
  };
}

async function collectIssueKeysForWorklog(settings, filters) {
  const issueMap = new Map();
  const epicByIssueKey = new Map();
  const epicDetailsByKey = new Map();
  const linkedSourceByIssueKey = new Map();
  const worklogDateClause = buildWorklogDateJql(filters);
  const selectedIssueKeys = Array.isArray(filters.issueKeys)
    ? filters.issueKeys.map((value) => String(value || "").trim()).filter(Boolean)
    : (filters.epicKey ? [String(filters.epicKey || "").trim()] : []);
  const selectedProjectKeys = Array.isArray(filters.projectKeys)
    ? filters.projectKeys.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const worklogIssueFields = ["summary", "issuetype", "status", "parent", "issuelinks"];
  const selectedIssueDetails = await Promise.all(selectedIssueKeys.map((issueKey) => fetchIssueDetails(settings, issueKey, worklogIssueFields)));

  if (selectedIssueKeys.length > 0) {
    const selectedIssues = await searchIssues(
      settings,
      `${buildJqlList("issuekey", selectedIssueKeys)} AND ${worklogDateClause} order by updated desc`,
      worklogIssueFields
    );
    mergeIssueMap(issueMap, selectedIssues);
    mergeEpicMapsFromIssues(epicByIssueKey, epicDetailsByKey, selectedIssues);

    selectedIssueDetails.forEach((issue, index) => {
      const issueKey = String(issue?.key || selectedIssueKeys[index] || "").trim();
      if (issueKey && !issueMap.has(issueKey)) {
        issueMap.set(issueKey, issue);
      }
      if (issueKey && !epicByIssueKey.has(issueKey)) {
        const epic = getJiraIssueEpic(issue);
        if (epic?.key) {
          epicByIssueKey.set(issueKey, epic.key);
          if (!epicDetailsByKey.has(epic.key)) {
            epicDetailsByKey.set(epic.key, epic);
          }
        }
      }
    });

    if (filters.includeEpicChildren) {
      const selectedEpicKeys = selectedIssueKeys.filter((issueKey, index) => isJiraEpicIssueType(selectedIssueDetails[index]?.fields?.issuetype));
      for (const epicKey of selectedEpicKeys) {
        const children = await searchIssues(
          settings,
          `"Epic Link" = "${escapeJqlString(epicKey)}" AND ${worklogDateClause} order by updated desc`,
          [...worklogIssueFields, "issuelinks"]
        );
        children.forEach((issue) => {
          const childKey = String(issue?.key || "").trim();
          if (!childKey) {
            return;
          }
          issueMap.set(childKey, issue);
          if (!epicByIssueKey.has(childKey)) {
            epicByIssueKey.set(childKey, epicKey);
          }
          if (!epicDetailsByKey.has(epicKey)) {
            const selectedEpic = selectedIssueDetails.find((selectedIssue) => String(selectedIssue?.key || "").trim() === epicKey);
            epicDetailsByKey.set(epicKey, {
              key: epicKey,
              title: String(selectedEpic?.fields?.summary || epicKey),
            });
          }
        });
      }
    }
  }

  if (selectedProjectKeys.length > 0) {
    const projectIssues = await searchIssues(
      settings,
      `${buildJqlList("project", selectedProjectKeys)} AND ${worklogDateClause} order by updated desc`,
      worklogIssueFields
    );
    mergeIssueMap(issueMap, projectIssues);
    mergeEpicMapsFromIssues(epicByIssueKey, epicDetailsByKey, projectIssues);
  }

  if (issueMap.size === 0 && selectedIssueKeys.length === 0 && selectedProjectKeys.length === 0) {
    const fallback = await searchIssues(
      settings,
      `${worklogDateClause} order by updated desc`,
      worklogIssueFields
    );
    mergeIssueMap(issueMap, fallback);
    mergeEpicMapsFromIssues(epicByIssueKey, epicDetailsByKey, fallback);
  }

  const linkedIssueTypeIds = Array.isArray(filters.linkedIssueTypeIds)
    ? filters.linkedIssueTypeIds.map((value) => String(value || "").trim()).filter(Boolean)
    : (Array.isArray(filters.linkedIssueTypes) ? filters.linkedIssueTypes.map((value) => String(value || "").trim()).filter(Boolean) : []);

  if (filters.includeLinkedIssues && linkedIssueTypeIds.length > 0 && issueMap.size > 0) {
    const allowedTypeIds = new Set(linkedIssueTypeIds);
    const linkedIssueKeys = new Set();
    const seedIssues = [...issueMap.values()];
    for (const issue of seedIssues) {
      for (const linkedRecord of getJiraLinkedIssueRecords(issue, allowedTypeIds)) {
        const linkedIssueKey = linkedRecord.issueKey;
        if (!linkedIssueKey || linkedIssueKey === String(linkedRecord.source.sourceIssueKey || "").trim() || issueMap.has(linkedIssueKey)) {
          continue;
        }
        linkedIssueKeys.add(linkedIssueKey);
        if (!linkedSourceByIssueKey.has(linkedIssueKey)) {
          linkedSourceByIssueKey.set(linkedIssueKey, linkedRecord.source);
        }
      }
    }

    if (linkedIssueKeys.size > 0) {
      const linkedIssues = await searchIssues(
        settings,
        `${buildJqlList("issuekey", [...linkedIssueKeys])} AND ${worklogDateClause} order by updated desc`,
        worklogIssueFields
      );
      mergeIssueMap(issueMap, linkedIssues);
      mergeEpicMapsFromIssues(epicByIssueKey, epicDetailsByKey, linkedIssues);
    }
  }

  return {
    issues: [...issueMap.values()],
    epicByIssueKey,
    epicDetailsByKey,
    linkedSourceByIssueKey,
  };
}

export async function buildJiraWorklogReport(settings, filters) {
  const jira = ensureJiraConfigured(settings);
  const { issues, epicByIssueKey, epicDetailsByKey, linkedSourceByIssueKey } = await collectIssueKeysForWorklog(jira, filters);
  const rows = [];
  const dateFrom = createDayStart(filters.dateFrom);
  const dateTo = createDayEnd(filters.dateTo);
  const selectedAssigneeIds = Array.isArray(filters.assigneeAccountIds)
    ? filters.assigneeAccountIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const selectedGroupIds = Array.isArray(filters.groupIds)
    ? filters.groupIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const assigneeIds = new Set(selectedAssigneeIds);
  const hasAssigneeFilter = selectedAssigneeIds.length > 0 || selectedGroupIds.length > 0;

  if (selectedGroupIds.length > 0) {
    const groupedMembers = await Promise.all(selectedGroupIds.map((groupId) => listJiraGroupMembers(jira, groupId)));
    groupedMembers.forEach((members) => {
      members.forEach((member) => {
        if (member.accountId) {
          assigneeIds.add(String(member.accountId));
        }
      });
    });
  }

  await mapWithConcurrency(issues, 6, async (issue) => {
    const issueKey = String(issue?.key || "").trim();
    if (!issueKey) {
      return;
    }
    const worklogs = await fetchIssueWorklogsInRange(jira, issueKey, dateFrom, dateTo);
    for (const worklog of worklogs) {
      const startedAt = new Date(worklog.started || worklog.created);
      if (Number.isNaN(startedAt.getTime()) || startedAt < dateFrom || startedAt > dateTo) {
        continue;
      }
      const accountId = String(worklog?.author?.accountId || "");
      if (hasAssigneeFilter && !assigneeIds.has(accountId)) {
        continue;
      }
      const epicKey = String(epicByIssueKey.get(issueKey) || "");
      const epic = epicKey ? epicDetailsByKey.get(epicKey) : null;
      const linkedSource = linkedSourceByIssueKey.get(issueKey) || null;
      rows.push({
        epicKey,
        epicTitle: epicKey ? String(epic?.title || epicKey) : "",
        epicUrl: epicKey ? `${jira.baseUrl}/browse/${encodeURIComponent(epicKey)}` : "",
        issueKey,
        issueTitle: String(issue?.fields?.summary || issueKey),
        issueUrl: `${jira.baseUrl}/browse/${encodeURIComponent(issueKey)}`,
        linkSourceIssueKey: String(linkedSource?.sourceIssueKey || ""),
        linkSourceIssueTitle: String(linkedSource?.sourceIssueTitle || ""),
        linkSourceIssueUrl: linkedSource?.sourceIssueKey ? `${jira.baseUrl}/browse/${encodeURIComponent(String(linkedSource.sourceIssueKey))}` : "",
        linkTypeId: String(linkedSource?.linkTypeId || ""),
        linkTypeName: String(linkedSource?.linkTypeName || ""),
        linkLabel: String(linkedSource?.linkLabel || ""),
        linkDirection: String(linkedSource?.linkDirection || ""),
        accountId,
        author: String(worklog?.author?.displayName || "Unknown"),
        startedAt: startedAt.toISOString(),
        secondsSpent: Number(worklog.timeSpentSeconds || 0),
      });
    }
  });

  return rows.sort((left, right) => {
    const issueComparison = String(left.issueKey || "").localeCompare(String(right.issueKey || ""));
    if (issueComparison !== 0) {
      return issueComparison;
    }
    const startedComparison = String(left.startedAt || "").localeCompare(String(right.startedAt || ""));
    if (startedComparison !== 0) {
      return startedComparison;
    }
    return String(left.author || "").localeCompare(String(right.author || ""));
  });
}

function createDayStart(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function createDayEnd(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  parsed.setHours(23, 59, 59, 999);
  return parsed;
}
