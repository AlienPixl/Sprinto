import { useEffect, useMemo, useRef, useState } from "react";
import { buildWorklogCalendar, zonedDayStartMs } from "../lib/worklog-calendar";
import { formatDuration } from "../lib/worklog-format";
import type {
  WorklogCalendarEntry,
  WorklogCalendarGap,
  WorklogCalendarGroup,
  WorklogCalendarWindow,
} from "../lib/worklog-calendar";
import type { JiraWorklogRow } from "../lib/types";

type WorklogCalendarProps = {
  dateFrom: string;
  dateTo: string;
  rows: JiraWorklogRow[];
  timeZone?: string;
};

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6];
const TICK_STEPS = [15, 30, 60, 120, 180, 360];
const MAX_TICKS = 12;

/** Coarsest grid that still keeps the visible stretch readable at the current zoom. */
function chooseTickStep(visibleMinutes: number) {
  return TICK_STEPS.find((step) => visibleMinutes / step <= MAX_TICKS) || 720;
}

function buildTicks(axis: WorklogCalendarWindow, zoom: number) {
  const step = chooseTickStep((axis.endMinutes - axis.startMinutes) / zoom);
  const ticks: number[] = [];
  for (let minute = Math.ceil(axis.startMinutes / step) * step; minute <= axis.endMinutes; minute += step) {
    ticks.push(minute);
  }
  return ticks;
}

function resolveTimeZone(timeZone?: string) {
  return timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatClock(minutes: number) {
  const normalized = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalized / 60);
  return `${String(hours).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function formatDayLabel(date: string, timeZone: string) {
  const dayStartMs = zonedDayStartMs(date, timeZone);
  if (Number.isNaN(dayStartMs)) {
    return date;
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(dayStartMs + 12 * 60 * 60 * 1000));
}

function percent(minutes: number, axis: WorklogCalendarWindow) {
  const span = axis.endMinutes - axis.startMinutes;
  if (span <= 0) {
    return "0%";
  }
  const share = Math.min(Math.max((minutes - axis.startMinutes) / span, 0), 1);
  return `${Math.round(share * 1000000) / 10000}%`;
}

function widthPercent(minutes: number, axis: WorklogCalendarWindow) {
  const span = axis.endMinutes - axis.startMinutes;
  if (span <= 0) {
    return "0%";
  }
  const share = Math.min(Math.max(minutes / span, 0), 1);
  return `${Math.round(share * 1000000) / 10000}%`;
}

export function WorklogCalendar({ dateFrom, dateTo, rows, timeZone }: WorklogCalendarProps) {
  const zone = resolveTimeZone(timeZone);
  const [excludedAccountIds, setExcludedAccountIds] = useState<string[]>([]);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const peopleRef = useRef<HTMLDivElement>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomIndexRef = useRef(zoomIndex);
  zoomIndexRef.current = zoomIndex;

  const authors = useMemo(
    () => buildWorklogCalendar(rows, { dateFrom, dateTo, timeZone: zone }).authors,
    [rows, dateFrom, dateTo, zone]
  );
  const selectedAccountIds = useMemo(() => {
    const kept = authors.filter((author) => !excludedAccountIds.includes(author.accountId));
    return (kept.length > 0 ? kept : authors).map((author) => author.accountId);
  }, [authors, excludedAccountIds]);
  const calendar = useMemo(
    () => buildWorklogCalendar(rows, { dateFrom, dateTo, timeZone: zone, accountIds: selectedAccountIds }),
    [rows, dateFrom, dateTo, zone, selectedAccountIds]
  );

  /** Pinch on a touchpad arrives as a ctrl-held wheel; a plain wheel keeps scrolling the day list. */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      const step = event.deltaY < 0 ? 1 : -1;
      const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, zoomIndexRef.current + step));
      if (next === zoomIndexRef.current) {
        return;
      }
      event.preventDefault();
      setZoomIndex(next);
    }
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    if (!peopleOpen) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (!peopleRef.current?.contains(event.target as Node)) {
        setPeopleOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [peopleOpen]);

  function togglePerson(accountId: string) {
    setExcludedAccountIds((current) => {
      const next = current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId];
      return next.length >= authors.length ? current : next;
    });
  }

  const zoom = ZOOM_LEVELS[zoomIndex];
  const axis = calendar.window;
  const ticks = buildTicks(axis, zoom);
  const showPeople = selectedAccountIds.length > 1;

  return (
    <div className="worklog-calendar">
      <div className="worklog-calendar__toolbar">
        {authors.length > 1 ? (
          <div className="filter-dropdown worklog-calendar__people" ref={peopleRef}>
            <button
              aria-expanded={peopleOpen}
              aria-haspopup="true"
              className="worklog-calendar__people-button"
              onClick={() => setPeopleOpen((current) => !current)}
              type="button"
            >
              People · {selectedAccountIds.length} of {authors.length}
            </button>
            {peopleOpen ? (
              <div className="filter-dropdown__panel worklog-calendar__people-panel">
                {authors.map((author) => (
                  <label className="worklog-calendar__people-option" key={author.accountId}>
                    <input
                      checked={selectedAccountIds.includes(author.accountId)}
                      onChange={() => togglePerson(author.accountId)}
                      type="checkbox"
                    />
                    <strong>{author.name}</strong>
                    <span>{formatDuration(author.totalSeconds)}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="worklog-calendar__toolbar-right">
          <div aria-label="Timeline zoom" className="worklog-calendar__zoom" role="group">
            <button
              aria-label="Zoom out"
              disabled={zoomIndex === 0}
              onClick={() => setZoomIndex((current) => Math.max(0, current - 1))}
              type="button"
            >
              −
            </button>
            <button aria-label="Reset zoom" disabled={zoomIndex === 0} onClick={() => setZoomIndex(0)} type="button">
              {Math.round(zoom * 100)}%
            </button>
            <button
              aria-label="Zoom in"
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              onClick={() => setZoomIndex((current) => Math.min(ZOOM_LEVELS.length - 1, current + 1))}
              type="button"
            >
              +
            </button>
          </div>
          <span className="worklog-calendar__zone">Times in {zone}</span>
        </div>
      </div>

      <div className="worklog-calendar__viewport" ref={viewportRef}>
        <div className="worklog-calendar__grid" style={{ width: `${zoom * 100}%` }}>
          <div className="worklog-calendar__scale">
            <span className="worklog-calendar__day-label" />
            <div className="worklog-calendar__scale-track">
              {ticks.map((minute) => (
                <span className="worklog-calendar__scale-tick" key={minute} style={{ left: percent(minute, axis) }}>
                  {formatClock(minute)}
                </span>
              ))}
            </div>
            <span className="worklog-calendar__day-summary" />
          </div>

          <ol className="worklog-calendar__days">
            {calendar.days.map((day) => {
              const label = formatDayLabel(day.date, zone);
              if (day.groups.length === 0) {
                return <CalendarRow axis={axis} key={day.date} label={label} ticks={ticks} />;
              }
              return day.groups.map((group, index) => (
                <CalendarRow
                  axis={axis}
                  group={group}
                  key={`${day.date}-${group.accountId}`}
                  label={index === 0 ? label : ""}
                  person={showPeople ? group.name : ""}
                  ticks={ticks}
                />
              ));
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

function CalendarRow({
  axis,
  group,
  label,
  person = "",
  ticks,
}: {
  axis: WorklogCalendarWindow;
  group?: WorklogCalendarGroup;
  label: string;
  person?: string;
  ticks: number[];
}) {
  const laneCount = Math.max(1, group?.laneCount || 1);

  return (
    <li className={`worklog-calendar__day ${group ? "" : "is-empty"}`}>
      <span className="worklog-calendar__day-label">
        <strong>{label}</strong>
        {person ? <em>{person}</em> : null}
      </span>
      <div className="worklog-calendar__track" style={{ ["--worklog-lane-count" as string]: String(laneCount) }}>
        {ticks.map((minute) => (
          <span
            aria-hidden="true"
            className="worklog-calendar__grid-line"
            key={minute}
            style={{ left: percent(minute, axis) }}
          />
        ))}
        {group?.gaps.map((gap) => (
          <GapBlock axis={axis} gap={gap} key={`gap-${gap.startMinutes}`} />
        ))}
        {group?.entries.map((entry) => (
          <EntryBlock axis={axis} entry={entry} key={entry.id} laneCount={laneCount} />
        ))}
      </div>
      <span className="worklog-calendar__day-summary">{formatRowSummary(group)}</span>
    </li>
  );
}

function EntryBlock({
  axis,
  entry,
  laneCount,
}: {
  axis: WorklogCalendarWindow;
  entry: WorklogCalendarEntry;
  laneCount: number;
}) {
  const range = `${formatClock(entry.startMinutes)}–${formatClock(entry.endMinutes)}`;
  const continuation = [
    entry.continuesFromPreviousDay ? "continues from the previous day" : "",
    entry.continuesIntoNextDay ? "continues into the next day" : "",
    entry.overlapping ? "overlaps another entry" : "",
  ].filter(Boolean);
  const title = [`${entry.issueKey} · ${range} · ${formatDuration(entry.secondsSpent)} · ${entry.issueTitle}`, ...continuation].join(" · ");

  return (
    <a
      className={`worklog-calendar__entry ${entry.overlapping ? "is-overlapping" : ""}`}
      href={entry.issueUrl}
      rel="noreferrer"
      style={{
        left: percent(entry.startMinutes, axis),
        width: widthPercent(Math.max(entry.endMinutes - entry.startMinutes, 1), axis),
        top: `${(entry.lane / laneCount) * 100}%`,
        height: `calc(${100 / laneCount}% - 3px)`,
      }}
      target="_blank"
      title={title}
    >
      <strong>{entry.issueKey}</strong>
      <span>{range}</span>
    </a>
  );
}

function GapBlock({ axis, gap }: { axis: WorklogCalendarWindow; gap: WorklogCalendarGap }) {
  return (
    <span
      className="worklog-calendar__gap"
      style={{
        left: percent(gap.startMinutes, axis),
        width: widthPercent(Math.max(gap.endMinutes - gap.startMinutes, 1), axis),
      }}
      title={`Unlogged · ${formatClock(gap.startMinutes)}–${formatClock(gap.endMinutes)} · ${formatDuration(gap.seconds)}`}
    />
  );
}

function formatRowSummary(group?: WorklogCalendarGroup) {
  if (!group || group.entries.length === 0) {
    return "Nothing logged";
  }
  const parts = [`${formatDuration(group.totalSeconds)} logged`];
  if (group.overlapCount > 0) {
    parts.push(`${group.overlapCount} ${group.overlapCount === 1 ? "overlap" : "overlaps"}`);
  }
  return parts.join(" · ");
}
