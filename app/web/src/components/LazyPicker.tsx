import { useEffect, useMemo, useRef, useState } from "react";

export type LazyPickerOption = {
  id: string;
  name: string;
  hint?: string;
};

type LazyPickerProps = {
  value: string;
  options: LazyPickerOption[];
  onSelect: (id: string) => void;
  /** Fired every time the dropdown opens. The caller decides whether a fetch is needed. */
  onOpen: () => void;
  loading: boolean;
  error?: string;
  placeholder: string;
  searchPlaceholder?: string;
  loadingText?: string;
  emptyText: string;
  disabled?: boolean;
  disabledText?: string;
  onRetry?: () => void;
  /** False when the failure cannot change on a retry, e.g. rejected credentials. */
  canRetry?: boolean;
  id?: string;
  ariaLabel?: string;
};

/**
 * Single-select dropdown that loads its options only when the user opens it.
 * While the fetch is in flight the spinner sits inside the open list, so the
 * user sees where the data is going to appear.
 */
export function LazyPicker({
  value,
  options,
  onSelect,
  onOpen,
  loading,
  error,
  placeholder,
  searchPlaceholder,
  loadingText = "Loading…",
  emptyText,
  disabled = false,
  disabledText,
  onRetry,
  canRetry = true,
  id,
  ariaLabel,
}: LazyPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectedLabel = useMemo(
    () => options.find((option) => option.id === value)?.name ?? "",
    [options, value]
  );

  const term = search.trim().toLowerCase();
  const visible = term
    ? options.filter((option) => `${option.name} ${option.hint || ""}`.toLowerCase().includes(term))
    : options;

  function toggle() {
    if (disabled) {
      return;
    }
    const next = !open;
    setOpen(next);
    if (next) {
      onOpen();
    }
  }

  return (
    <div className="jira-filter-status-picker lazy-picker" ref={rootRef} data-picker-root="true">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`jira-filter-status-trigger${open ? " is-open" : ""}`}
        disabled={disabled}
        id={id}
        onClick={toggle}
        type="button"
      >
        <span className="jira-filter-status-trigger__label">
          {disabled ? (disabledText || placeholder) : (selectedLabel || placeholder)}
        </span>
        <span className="jira-filter-status-trigger__caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="jira-filter-status-dropdown" role="listbox">
          {searchPlaceholder && !loading && !error && options.length > 0 ? (
            <input
              className="jira-filter-status-search"
              type="text"
              autoFocus
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          ) : null}
          {loading ? (
            <div className="lazy-picker__loading" role="status">
              <span className="lazy-picker__spinner" aria-hidden="true" />
              <span>{loadingText}</span>
            </div>
          ) : error ? (
            <div className="jira-filter-status-empty jira-filter-status-empty--error">
              <span>{error}</span>
              {onRetry && canRetry ? (
                <button className="lazy-picker__retry" onClick={onRetry} type="button">Try again</button>
              ) : null}
            </div>
          ) : options.length === 0 ? (
            <span className="jira-filter-status-empty">{emptyText}</span>
          ) : visible.length === 0 ? (
            <span className="jira-filter-status-empty">No matching results</span>
          ) : (
            visible.map((option) => (
              <button
                aria-selected={option.id === value}
                className={`jira-filter-status-option${option.id === value ? " is-selected" : ""}`}
                key={option.id}
                onClick={() => {
                  onSelect(option.id);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span className="jira-filter-status-option__check" aria-hidden="true">{option.id === value ? "✓" : ""}</span>
                <span className="lazy-picker__option-label">
                  {option.name}
                  {option.hint ? <span className="lazy-picker__option-hint">{option.hint}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
