import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Deck, RoomCategory, RoomSummary } from "../lib/types";

const FILTERS = ["all", "open", "voting", "revealed", "closed"] as const;
type Filter = (typeof FILTERS)[number];
const DEFAULT_ACTIVE_FILTERS: Filter[] = ["open", "voting", "revealed"];
const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  open: "Open",
  voting: "Voting",
  revealed: "Revealed",
  closed: "Closed",
};

type DashboardProps = {
  rooms: RoomSummary[];
  decks: Deck[];
  defaultDeckName?: string;
  roomCategories?: RoomCategory[];
  roomCategoriesEnabled?: boolean;
  roomCategoryRequired?: boolean;
  onOpenRoom: (roomId: string) => void;
  onCreateRoom: (name: string, deckName: string, categoryId: string) => Promise<void>;
  canCreateRoom: boolean;
};

export function Dashboard({ rooms, decks, defaultDeckName = "", roomCategories = [], roomCategoriesEnabled = false, roomCategoryRequired = false, onOpenRoom, onCreateRoom, canCreateRoom }: DashboardProps) {
  const [name, setName] = useState("");
  const [deckName, setDeckName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Filter[]>(DEFAULT_ACTIVE_FILTERS);
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [deckMenuOpen, setDeckMenuOpen] = useState(false);
  const deckMenuRef = useRef<HTMLDivElement | null>(null);

  const availableDecks = decks.length > 0 ? decks : [{ id: "fallback", name: "Fibonacci", values: ["1", "2", "3", "5", "8", "13", "21", "?"], isDefault: true, createdAt: new Date().toISOString() }];
  const configuredDefaultDeckName =
    availableDecks.find((deck) => deck.name === defaultDeckName)?.name ||
    availableDecks.find((deck) => deck.isDefault)?.name ||
    availableDecks[0].name;
  const selectedDeckName = availableDecks.some((deck) => deck.name === deckName) ? deckName : configuredDefaultDeckName;
  const selectedDeck = availableDecks.find((deck) => deck.name === selectedDeckName) ?? availableDecks[0];

  const visibleRooms = useMemo(
    () =>
      rooms
        .filter((room) => {
          const statusMatch = activeFilters.includes("all") || activeFilters.includes(room.status as Filter);
          const categoryMatch = categoryFilters.length === 0 || categoryFilters.includes(room.categoryId ?? "");
          return statusMatch && categoryMatch;
        })
        .sort((left, right) => statusOrder(left.status) - statusOrder(right.status)),
    [activeFilters, categoryFilters, rooms]
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!deckMenuRef.current?.contains(event.target as Node)) {
        setDeckMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDeckMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    if (roomCategoriesEnabled && roomCategoryRequired && !categoryId) {
      return;
    }

    setSubmitting(true);
    try {
      await onCreateRoom(name, selectedDeckName, categoryId);
      setName("");
      setCategoryId("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-shell">
      <section className={`dashboard-shell ${canCreateRoom ? "" : "dashboard-shell--rooms-only"}`.trim()}>
        {canCreateRoom ? (
          <form className="card create-form dashboard-create" onSubmit={handleSubmit}>
            <p className="eyebrow">Create</p>
            <label>
              Room name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 24" />
            </label>
            {roomCategoriesEnabled ? (
              <label>
                <span>Category{roomCategoryRequired ? <span className="settings-field-required"> (required)</span> : null}</span>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  required={roomCategoryRequired}
                >
                  <option value="">— unspecified —</option>
                  {roomCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="dashboard-deck-field">
              <span className="dashboard-deck-field__label">Deck</span>
              <div className={`dashboard-deck-picker ${deckMenuOpen ? "is-open" : ""}`} ref={deckMenuRef}>
                <button
                  aria-expanded={deckMenuOpen}
                  aria-haspopup="listbox"
                  className="dashboard-deck-picker__trigger"
                  onClick={() => setDeckMenuOpen((current) => !current)}
                  type="button"
                >
                  <div className="dashboard-deck-preview" aria-live="polite">
                    <div className="dashboard-deck-preview__header">
                      <strong>{selectedDeck.name}</strong>
                      <span>{selectedDeck.values.length} cards</span>
                    </div>
                    <div className="dashboard-deck-preview__values">
                      {selectedDeck.values.map((value) => (
                        <span className="dashboard-deck-preview__chip" key={value}>
                          {value}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
                {deckMenuOpen ? (
                  <div className="dashboard-deck-picker__menu" role="listbox">
                    {availableDecks.map((deck) => (
                      <button
                        aria-selected={deck.name === selectedDeckName}
                        className={`dashboard-deck-picker__option ${deck.name === selectedDeckName ? "is-selected" : ""}`}
                        key={deck.id}
                        onClick={() => {
                          setDeckName(deck.name);
                          setDeckMenuOpen(false);
                        }}
                        role="option"
                        type="button"
                      >
                        <div className="dashboard-deck-picker__option-header">
                          <strong>{deck.name}</strong>
                          <span>{deck.values.length} cards</span>
                        </div>
                        <div className="dashboard-deck-picker__option-values">
                          {deck.values.map((value) => (
                            <span className="dashboard-deck-picker__option-chip" key={`${deck.id}-${value}`}>
                              {value}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <button disabled={submitting} type="submit">
              {submitting ? "Creating..." : "Create room"}
            </button>
          </form>
        ) : null}

        <section className="card dashboard-rooms">
          <div className="dashboard-rooms__header">
            <div>
              <p className="eyebrow">Rooms</p>
            </div>
            <div className="dashboard-rooms__filters">
              <div className="filter-dropdown">
                <button
                  className={`filter-chip ${statusFilterOpen ? "is-active" : ""}`}
                  onClick={() => { setStatusFilterOpen((o) => !o); setCategoryFilterOpen(false); }}
                  type="button"
                >
                  <span aria-hidden="true" className="dashboard-rooms__filter-icon">
                    <StatusIcon />
                  </span>
                  Status {statusFilterOpen ? "▾" : "▸"}
                </button>
                {statusFilterOpen ? (
                  <div className="filter-dropdown__panel">
                    {FILTERS.map((option) => (
                      <button
                        key={option}
                        className={`filter-chip ${activeFilters.includes(option) ? "is-active" : ""}`}
                        onClick={() =>
                          setActiveFilters((current) => {
                            if (option === "all") {
                              return current.includes("all") ? [] : ["all"];
                            }
                            const next = current.includes(option)
                              ? current.filter((f) => f !== option && f !== "all")
                              : [...current.filter((f) => f !== "all"), option];
                            return next;
                          })
                        }
                        type="button"
                      >
                        {FILTER_LABELS[option]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {roomCategoriesEnabled ? (
                <div className="filter-dropdown">
                  <button
                    className={`filter-chip ${categoryFilterOpen ? "is-active" : ""}`}
                    onClick={() => { setCategoryFilterOpen((o) => !o); setStatusFilterOpen(false); }}
                    type="button"
                  >
                    <span aria-hidden="true" className="dashboard-rooms__filter-icon">
                      <CategoryIcon />
                    </span>
                    Category {categoryFilterOpen ? "▾" : "▸"}
                  </button>
                  {categoryFilterOpen ? (
                    <div className="filter-dropdown__panel filter-dropdown__panel--right">
                      <button
                        className={`filter-chip ${categoryFilters.length === 0 ? "is-active" : ""}`}
                        onClick={() => setCategoryFilters([])}
                        type="button"
                      >
                        All
                      </button>
                      {roomCategories.map((cat) => (
                        <button
                          key={cat.id}
                          className={`filter-chip ${categoryFilters.includes(cat.id) ? "is-active" : ""}`}
                          onClick={() =>
                            setCategoryFilters((current) =>
                              current.includes(cat.id) ? current.filter((id) => id !== cat.id) : [...current, cat.id]
                            )
                          }
                          type="button"
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <span className="pill">{visibleRooms.length}</span>
            </div>
          </div>

          <div className="rooms-grid">
            {visibleRooms.map((room) => {
              const categoryName = roomCategoriesEnabled && room.categoryId
                ? roomCategories.find((c) => c.id === room.categoryId)?.name
                : null;
              return (
                <button className="card room-card room-card--animated" key={room.id} onClick={() => onOpenRoom(room.id)} type="button">
                  <div className="room-card__body">
                    <div className="room-card__left">
                      <h3>{room.name}</h3>
                      {room.status !== "closed" ? (
                        <p>{room.activeIssueTitle === "-" ? "No issue selected yet" : room.activeIssueTitle}</p>
                      ) : null}
                      <span className="room-card__participants">
                        {room.participantCount} participants
                        {room.participantCount > 0 ? (
                          <span className="room-card__participants-breakdown">
                            ({room.voterCount} voters, {room.viewerCount} viewers)
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="room-card__right">
                      <span className={`pill pill--${room.status}`}>{room.status}</span>
                      {categoryName ? <span className="room-card__category">{categoryName}</span> : null}
                      <span className="room-card__completed">{room.completedCount} issues completed</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </section>
    </div>
  );
}

function StatusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7.5h14" />
      <path d="M5 12h8" />
      <path d="M5 16.5h11" />
      <circle cx="17.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CategoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 4.5H6a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 .44 1.06l7 7a1.5 1.5 0 0 0 2.12 0l5.5-5.5a1.5 1.5 0 0 0 0-2.12l-7-7a1.5 1.5 0 0 0-1.06-.44Z" />
      <circle cx="8.75" cy="8.75" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function statusOrder(status: string) {
  switch (status) {
    case "open":
      return 0;
    case "voting":
      return 1;
    case "revealed":
      return 2;
    case "closed":
      return 3;
    default:
      return 4;
  }
}
