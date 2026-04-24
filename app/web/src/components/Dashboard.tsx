import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Deck, RoomSummary } from "../lib/types";

const FILTERS = ["open", "voting", "revealed", "closed", "all"] as const;
type Filter = (typeof FILTERS)[number];
const DEFAULT_ACTIVE_FILTERS: Filter[] = ["open", "voting", "revealed"];

type DashboardProps = {
  rooms: RoomSummary[];
  decks: Deck[];
  defaultDeckName?: string;
  onOpenRoom: (roomId: string) => void;
  onCreateRoom: (name: string, deckName: string) => Promise<void>;
  canCreateRoom: boolean;
};

export function Dashboard({ rooms, decks, defaultDeckName = "", onOpenRoom, onCreateRoom, canCreateRoom }: DashboardProps) {
  const [name, setName] = useState("");
  const [deckName, setDeckName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Filter[]>(DEFAULT_ACTIVE_FILTERS);
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
          if (activeFilters.includes("all")) {
            return true;
          }

          return activeFilters.includes(room.status as Filter);
        })
        .sort((left, right) => statusOrder(left.status) - statusOrder(right.status)),
    [activeFilters, rooms]
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

    setSubmitting(true);
    try {
      await onCreateRoom(name, selectedDeckName);
      setName("");
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
            <span className="pill">{visibleRooms.length}</span>
          </div>

          <div className="filter-row">
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
                      ? current.filter((filter) => filter !== option && filter !== "all")
                      : [...current.filter((filter) => filter !== "all"), option];

                    return next;
                  })
                }
                type="button"
              >
                {option}
              </button>
            ))}
          </div>

          <div className="rooms-grid">
            {visibleRooms.map((room) => (
              <button className="card room-card room-card--animated" key={room.id} onClick={() => onOpenRoom(room.id)} type="button">
                <div className="room-card__header">
                  <h3>{room.name}</h3>
                  <span className={`pill pill--${room.status}`}>{room.status}</span>
                </div>
                <p>{room.activeIssueTitle === "-" ? "No issue selected yet" : room.activeIssueTitle}</p>
                <div className="room-meta">
                  <span>{room.participantCount} participants</span>
                  <span>{room.completedCount} issues completed</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </section>
    </div>
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
