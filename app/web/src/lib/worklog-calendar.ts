import type { JiraWorklogRow } from "./types";

export type WorklogCalendarOptions = {
  dateFrom: string;
  dateTo: string;
  timeZone: string;
  /** Empty or omitted means every person in the report. */
  accountIds?: string[];
};

export type WorklogCalendarEntry = {
  id: string;
  issueKey: string;
  issueTitle: string;
  issueUrl: string;
  accountId: string;
  author: string;
  startedAt: string;
  startMinutes: number;
  endMinutes: number;
  secondsSpent: number;
  continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean;
  lane: number;
  overlapping: boolean;
};

export type WorklogCalendarGap = {
  startMinutes: number;
  endMinutes: number;
  seconds: number;
};

export type WorklogCalendarAuthor = {
  accountId: string;
  name: string;
  totalSeconds: number;
};

/** One person's slice of a day — lanes, gaps and overlaps are always measured per person. */
export type WorklogCalendarGroup = {
  accountId: string;
  name: string;
  entries: WorklogCalendarEntry[];
  gaps: WorklogCalendarGap[];
  laneCount: number;
  totalSeconds: number;
  gapSeconds: number;
  overlapCount: number;
  overlapSeconds: number;
};

export type WorklogCalendarDay = {
  date: string;
  dayMinutes: number;
  groups: WorklogCalendarGroup[];
};

export type WorklogCalendarWindow = {
  startMinutes: number;
  endMinutes: number;
};

export type WorklogCalendar = {
  days: WorklogCalendarDay[];
  window: WorklogCalendarWindow;
  authors: WorklogCalendarAuthor[];
  timeZone: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Breathing room drawn on each side of the logged time. */
const AXIS_PADDING_MINUTES = 60;
/** Axis used when there is nothing to derive one from. */
const FALLBACK_WINDOW: WorklogCalendarWindow = { startMinutes: 8 * 60, endMinutes: 18 * 60 };

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string) {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedPartsAsUtc(ms: number, timeZone: string) {
  const parts = getPartsFormatter(timeZone).formatToParts(new Date(ms));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour") % 24, read("minute"), read("second"));
}

function zoneOffsetMs(ms: number, timeZone: string) {
  return zonedPartsAsUtc(ms, timeZone) - ms;
}

/** Timestamp of local midnight for a `YYYY-MM-DD` date in the given zone. */
export function zonedDayStartMs(date: string, timeZone: string) {
  const wallClock = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(wallClock)) {
    return Number.NaN;
  }
  const firstGuess = wallClock - zoneOffsetMs(wallClock, timeZone);
  return wallClock - zoneOffsetMs(firstGuess, timeZone);
}

function nextDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

function listDates(dateFrom: string, dateTo: string) {
  const start = Date.parse(`${dateFrom}T00:00:00Z`);
  const end = Date.parse(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return [] as string[];
  }
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

export function buildWorklogCalendar(rows: JiraWorklogRow[], options: WorklogCalendarOptions): WorklogCalendar {
  const { timeZone } = options;
  const days: WorklogCalendarDay[] = listDates(options.dateFrom, options.dateTo).map((date) => ({
    date,
    dayMinutes: Math.round((zonedDayStartMs(nextDate(date), timeZone) - zonedDayStartMs(date, timeZone)) / 60000),
    groups: [],
  }));
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const authorsByAccount = new Map<string, WorklogCalendarAuthor>();
  const selected = new Set((options.accountIds || []).filter(Boolean));

  rows.forEach((row, index) => {
    const startMs = Date.parse(row.startedAt || "");
    if (Number.isNaN(startMs)) {
      return;
    }
    const seconds = Math.max(0, Number(row.secondsSpent) || 0);
    const accountId = String(row.accountId || "");

    const author = authorsByAccount.get(accountId);
    if (author) {
      author.totalSeconds += seconds;
    } else {
      authorsByAccount.set(accountId, { accountId, name: row.author || "Unknown", totalSeconds: seconds });
    }

    if (selected.size > 0 && !selected.has(accountId)) {
      return;
    }

    const endMs = startMs + seconds * 1000;
    let date = new Date(zonedPartsAsUtc(startMs, timeZone)).toISOString().slice(0, 10);
    let segmentStartMs = startMs;

    for (let guard = 0; guard < 400; guard += 1) {
      const dayStartMs = zonedDayStartMs(date, timeZone);
      const dayEndMs = zonedDayStartMs(nextDate(date), timeZone);
      const segmentEndMs = Math.min(endMs, dayEndMs);
      const day = dayByDate.get(date);
      if (day) {
        const group = findOrCreateGroup(day, accountId, row.author || "Unknown");
        const segmentSeconds = Math.max(0, Math.round((segmentEndMs - segmentStartMs) / 1000));
        group.entries.push({
          id: `${index}-${date}`,
          issueKey: row.issueKey,
          issueTitle: row.issueTitle,
          issueUrl: row.issueUrl,
          accountId,
          author: row.author,
          startedAt: row.startedAt,
          startMinutes: Math.round((segmentStartMs - dayStartMs) / 60000),
          endMinutes: Math.round((segmentEndMs - dayStartMs) / 60000),
          secondsSpent: segmentSeconds,
          continuesFromPreviousDay: segmentStartMs > startMs,
          continuesIntoNextDay: segmentEndMs < endMs,
          lane: 0,
          overlapping: false,
        });
        group.totalSeconds += segmentSeconds;
      }
      if (endMs <= dayEndMs) {
        break;
      }
      segmentStartMs = dayEndMs;
      date = nextDate(date);
    }
  });

  const authors = [...authorsByAccount.values()].sort(
    (left, right) => right.totalSeconds - left.totalSeconds || left.name.localeCompare(right.name)
  );
  const authorOrder = new Map(authors.map((entry, index) => [entry.accountId, index]));

  days.forEach((day) => {
    day.groups.sort(
      (left, right) =>
        (authorOrder.get(left.accountId) ?? 0) - (authorOrder.get(right.accountId) ?? 0) ||
        left.name.localeCompare(right.name)
    );
    day.groups.forEach(layOutGroup);
  });

  return { days, authors, timeZone, window: findWindow(days) };
}

function findOrCreateGroup(day: WorklogCalendarDay, accountId: string, name: string) {
  const existing = day.groups.find((group) => group.accountId === accountId);
  if (existing) {
    return existing;
  }
  const created: WorklogCalendarGroup = {
    accountId,
    name,
    entries: [],
    gaps: [],
    laneCount: 0,
    totalSeconds: 0,
    gapSeconds: 0,
    overlapCount: 0,
    overlapSeconds: 0,
  };
  day.groups.push(created);
  return created;
}

/** The axis every day row shares: an hour either side of the logged time, clamped to the day. */
function findWindow(days: WorklogCalendarDay[]): WorklogCalendarWindow {
  const entries = days.flatMap((day) => day.groups.flatMap((group) => group.entries));
  if (entries.length === 0) {
    return { ...FALLBACK_WINDOW };
  }
  const dayMinutes = Math.max(...days.map((day) => day.dayMinutes));
  const first = Math.min(...entries.map((entry) => entry.startMinutes));
  const last = Math.max(...entries.map((entry) => entry.endMinutes));
  return {
    startMinutes: Math.max(0, first - AXIS_PADDING_MINUTES),
    endMinutes: Math.min(dayMinutes, last + AXIS_PADDING_MINUTES),
  };
}

/** Sorts one person's entries, stacks colliding ones into lanes, and measures overlaps and gaps. */
function layOutGroup(day: WorklogCalendarGroup) {
  day.entries.sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes);

  const laneEnds: number[] = [];
  day.entries.forEach((entry) => {
    let lane = laneEnds.findIndex((end) => end <= entry.startMinutes);
    if (lane === -1) {
      lane = laneEnds.length;
    }
    laneEnds[lane] = entry.endMinutes;
    entry.lane = lane;
    entry.overlapping = day.entries.some(
      (other) => other !== entry && other.startMinutes < entry.endMinutes && entry.startMinutes < other.endMinutes
    );
  });
  day.laneCount = laneEnds.length;

  day.gaps = findGaps(day.entries);
  day.gapSeconds = day.gaps.reduce((total, gap) => total + gap.seconds, 0);

  const overlaps = findOverlaps(day.entries);
  day.overlapCount = overlaps.length;
  day.overlapSeconds = overlaps.reduce((total, span) => total + (span.endMinutes - span.startMinutes) * 60, 0);
}

/** Empty stretches between entries — never before the first or after the last one. */
function findGaps(entries: WorklogCalendarEntry[]): WorklogCalendarGap[] {
  const gaps: WorklogCalendarGap[] = [];
  let coveredUntil = entries.length > 0 ? entries[0].endMinutes : 0;
  entries.slice(1).forEach((entry) => {
    if (entry.startMinutes > coveredUntil) {
      gaps.push({
        startMinutes: coveredUntil,
        endMinutes: entry.startMinutes,
        seconds: (entry.startMinutes - coveredUntil) * 60,
      });
    }
    coveredUntil = Math.max(coveredUntil, entry.endMinutes);
  });
  return gaps;
}

/** Maximal stretches covered by two or more entries at once. */
function findOverlaps(entries: WorklogCalendarEntry[]) {
  const edges = entries
    .flatMap((entry) => [
      { minute: entry.startMinutes, delta: 1 },
      { minute: entry.endMinutes, delta: -1 },
    ])
    .sort((left, right) => left.minute - right.minute || left.delta - right.delta);

  const spans: { startMinutes: number; endMinutes: number }[] = [];
  let depth = 0;
  let openedAt = 0;
  edges.forEach((edge) => {
    const wasStacked = depth >= 2;
    depth += edge.delta;
    const isStacked = depth >= 2;
    if (!wasStacked && isStacked) {
      openedAt = edge.minute;
    } else if (wasStacked && !isStacked && edge.minute > openedAt) {
      spans.push({ startMinutes: openedAt, endMinutes: edge.minute });
    }
  });
  return spans;
}
