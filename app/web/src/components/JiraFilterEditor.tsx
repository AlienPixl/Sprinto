import { useEffect, useRef, useState } from "react";
import {
  isJiraFilterGroup,
  JiraFilterCondition,
  JiraFilterConnector,
  JiraFilterField,
  JiraFilterGroup,
  JiraFilterNode,
  JiraFilterOperator,
  JiraImportFilters,
  JiraStatus,
} from "../lib/types";

/** Groups may nest this deep; the backend drops anything below it. */
const MAX_GROUP_DEPTH = 5;

/** Root filters and group nodes share the same children/connectors shape. */
type GroupLike = { conditions: JiraFilterNode[]; connectors: JiraFilterConnector[] };

/** Index chain from the root down to a node. */
type NodePath = number[];

function defaultCondition(): JiraFilterCondition {
  return { field: "storyPoints", operator: "IS EMPTY", value: null };
}

function defaultGroup(): JiraFilterGroup {
  return { type: "group", conditions: [defaultCondition()], connectors: [] };
}

function editGroup(root: GroupLike, path: NodePath, edit: (group: GroupLike) => GroupLike): GroupLike {
  if (path.length === 0) {
    return edit(root);
  }
  const [index, ...rest] = path;
  const child = root.conditions[index];
  if (!child || !isJiraFilterGroup(child)) {
    return root;
  }
  const conditions = [...root.conditions];
  conditions[index] = editGroup(child, rest, edit) as JiraFilterGroup;
  return { ...root, conditions };
}

function replaceNode(root: GroupLike, path: NodePath, next: JiraFilterNode): GroupLike {
  const index = path[path.length - 1];
  return editGroup(root, path.slice(0, -1), (group) => {
    const conditions = [...group.conditions];
    conditions[index] = next;
    return { ...group, conditions };
  });
}

function removeNode(root: GroupLike, path: NodePath): GroupLike {
  const index = path[path.length - 1];
  const removed = editGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.filter((_, i) => i !== index),
    // The connector that joined this node to its neighbour goes with it.
    connectors: group.connectors.filter((_, i) => i !== (index === 0 ? 0 : index - 1)),
  }));
  return pruneEmptyGroups(removed);
}

/** A group left without children is no longer a parenthesis — drop it. */
function pruneEmptyGroups(group: GroupLike): GroupLike {
  const kept: JiraFilterNode[] = [];
  const connectors: JiraFilterConnector[] = [];
  group.conditions.forEach((node, index) => {
    let next = node;
    if (isJiraFilterGroup(node)) {
      const pruned = pruneEmptyGroups(node) as JiraFilterGroup;
      if (pruned.conditions.length === 0) {
        return;
      }
      next = pruned;
    }
    if (kept.length > 0) {
      connectors.push(group.connectors[index - 1] ?? "AND");
    }
    kept.push(next);
  });
  return { ...group, conditions: kept, connectors };
}

function appendNode(root: GroupLike, groupPath: NodePath, node: JiraFilterNode): GroupLike {
  return editGroup(root, groupPath, (group) => ({
    ...group,
    conditions: [...group.conditions, node],
    connectors: group.conditions.length > 0 ? [...group.connectors, "AND"] : [...group.connectors],
  }));
}

function setConnector(root: GroupLike, groupPath: NodePath, index: number, connector: JiraFilterConnector): GroupLike {
  return editGroup(root, groupPath, (group) => {
    const connectors = [...group.connectors];
    connectors[index] = connector;
    return { ...group, connectors };
  });
}

const FIELD_LABELS: Record<JiraFilterField, string> = {
  storyPoints: "Story Points",
  originalEstimate: "Original Estimate",
  status: "Status",
  labels: "Labels",
};

function describeCondition(condition: JiraFilterCondition, statuses: JiraStatus[]): string {
  const field = FIELD_LABELS[condition.field] ?? condition.field;
  if (condition.field === "status" || condition.field === "labels") {
    const values = Array.isArray(condition.value) ? condition.value : [];
    const names = condition.field === "status"
      ? values.map((id) => statuses.find((status) => status.id === id)?.name ?? id)
      : values;
    return `${field} ${condition.operator} (${names.join(", ") || "—"})`;
  }
  if (condition.operator === "IS EMPTY" || condition.operator === "IS NOT EMPTY") {
    return `${field} ${condition.operator}`;
  }
  return `${field} ${condition.operator} ${condition.value ?? "—"}`;
}

/** Renders the rule tree the way it is actually evaluated, parentheses included. */
export function describeFilters(group: GroupLike, statuses: JiraStatus[], isRoot = true): string {
  const parts = group.conditions.map((node) =>
    isJiraFilterGroup(node) ? describeFilters(node, statuses, false) : describeCondition(node, statuses)
  );
  if (parts.length === 0) {
    return "";
  }
  let text = parts[0];
  for (let i = 1; i < parts.length; i++) {
    text += ` ${group.connectors[i - 1] ?? "AND"} ${parts[i]}`;
  }
  return isRoot || parts.length === 1 ? text : `(${text})`;
}

type MultiPickerProps = {
  open: boolean;
  onToggle: () => void;
  options: { id: string; name: string }[];
  selected: string[];
  onSelect: (id: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  unit: string;
  emptyText: string;
  errorText?: string | null;
  loading?: boolean;
  loadingText?: string;
};

function MultiPicker({
  open,
  onToggle,
  options,
  selected,
  onSelect,
  placeholder,
  searchPlaceholder,
  unit,
  emptyText,
  errorText,
  loading = false,
  loadingText = "Loading…",
}: MultiPickerProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (options.find((option) => option.id === selected[0])?.name ?? selected[0])
      : `${selected.length} ${unit}`;

  const term = search.trim().toLowerCase();
  const visible = term ? options.filter((option) => option.name.toLowerCase().includes(term)) : options;

  return (
    <div className="jira-filter-status-picker" data-picker-root="true">
      <button
        className={`jira-filter-status-trigger${open ? " is-open" : ""}`}
        type="button"
        onClick={onToggle}
      >
        <span className="jira-filter-status-trigger__label">{label}</span>
        <span className="jira-filter-status-trigger__caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="jira-filter-status-dropdown">
          {!loading && !errorText && options.length > 0 ? (
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
          ) : errorText ? (
            <span className="jira-filter-status-empty jira-filter-status-empty--error">{errorText}</span>
          ) : options.length === 0 ? (
            <span className="jira-filter-status-empty">{emptyText}</span>
          ) : visible.length === 0 ? (
            <span className="jira-filter-status-empty">No matching {unit}</span>
          ) : null}
          {!loading && visible.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <button
                key={option.id}
                className={`jira-filter-status-option${checked ? " is-selected" : ""}`}
                type="button"
                onClick={() => onSelect(option.id)}
              >
                <span className="jira-filter-status-option__check" aria-hidden="true">{checked ? "✓" : ""}</span>
                {option.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type JiraFilterEditorProps = {
  filters: JiraImportFilters;
  onChange: (filters: JiraImportFilters) => void;
  statuses: JiraStatus[];
  statusesLoading?: boolean;
  statusesError?: string | null;
  onRequestStatuses?: () => void;
  labels: string[];
  labelsLoading?: boolean;
  labelsError?: string | null;
  onRequestLabels?: () => void;
};

export default function JiraFilterEditor({
  filters,
  onChange,
  statuses,
  statusesLoading = false,
  statusesError,
  onRequestStatuses,
  labels,
  labelsLoading = false,
  labelsError,
  onRequestLabels,
}: JiraFilterEditorProps) {
  const [openPicker, setOpenPicker] = useState("");
  const treeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openPicker) {
      return undefined;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const root = treeRef.current;
      if (!root || !root.contains(target)) {
        setOpenPicker("");
        return;
      }
      const picker = (target as HTMLElement).closest?.("[data-picker-root]");
      if (!picker) {
        setOpenPicker("");
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [openPicker]);

  function apply(next: GroupLike) {
    onChange({ conditions: next.conditions, connectors: next.connectors });
  }

  const statusOptions = statuses.map((status) => ({ id: status.id, name: status.name }));
  const labelOptions = labels.map((label) => ({ id: label, name: label }));

  function renderCondition(condition: JiraFilterCondition, path: NodePath, removable: boolean) {
    const key = path.join("-");
    const selectedValues = Array.isArray(condition.value) ? condition.value as string[] : [];

    function toggleValue(value: string) {
      const next = selectedValues.includes(value)
        ? selectedValues.filter((item) => item !== value)
        : [...selectedValues, value];
      apply(replaceNode(filters, path, { ...condition, value: next }));
    }

    return (
      <div className="jira-filter-row">
        <select
          value={condition.field}
          onChange={(event) => {
            const newField = event.target.value as JiraFilterField;
            const next: JiraFilterCondition = newField === "status" || newField === "labels"
              ? { field: newField, operator: "IN", value: [] }
              : { field: newField, operator: "IS EMPTY", value: null };
            apply(replaceNode(filters, path, next));
          }}
        >
          <option value="storyPoints">Story Points</option>
          <option value="originalEstimate">Original Estimate</option>
          <option value="status">Status</option>
          <option value="labels">Labels</option>
        </select>
        <select
          value={condition.operator}
          onChange={(event) => {
            const operator = event.target.value as JiraFilterOperator;
            const isMulti = condition.field === "status" || condition.field === "labels";
            apply(replaceNode(filters, path, { ...condition, operator, value: isMulti ? selectedValues : null }));
          }}
        >
          {condition.field === "status" || condition.field === "labels" ? (
            <>
              <option value="IN">IN</option>
              <option value="NOT IN">NOT IN</option>
            </>
          ) : (
            <>
              <option value="IS EMPTY">IS EMPTY</option>
              <option value="IS NOT EMPTY">IS NOT EMPTY</option>
              <option value="=">=</option>
              <option value="!=">!=</option>
            </>
          )}
        </select>
        {condition.field === "status" && (
          <MultiPicker
            open={openPicker === `status:${key}`}
            onToggle={() => {
              const isOpen = openPicker === `status:${key}`;
              setOpenPicker(isOpen ? "" : `status:${key}`);
              if (!isOpen) {
                onRequestStatuses?.();
              }
            }}
            options={statusOptions}
            selected={selectedValues}
            onSelect={toggleValue}
            placeholder="— pick statuses —"
            searchPlaceholder="Search statuses…"
            unit="statuses"
            emptyText="No statuses loaded"
            loading={statusesLoading}
            loadingText="Loading statuses…"
            errorText={statusesError ? `Failed to load statuses from Jira: ${statusesError}` : null}
          />
        )}
        {condition.field === "labels" && (
          <MultiPicker
            open={openPicker === `labels:${key}`}
            onToggle={() => {
              const isOpen = openPicker === `labels:${key}`;
              setOpenPicker(isOpen ? "" : `labels:${key}`);
              if (!isOpen) {
                onRequestLabels?.();
              }
            }}
            options={labelOptions}
            selected={selectedValues}
            onSelect={toggleValue}
            placeholder="— pick labels —"
            searchPlaceholder="Search labels…"
            unit="labels"
            emptyText="No labels found in Jira"
            loading={labelsLoading}
            loadingText="Loading labels…"
            errorText={labelsError ? `Failed to load labels from Jira: ${labelsError}` : null}
          />
        )}
        {(condition.operator === "=" || condition.operator === "!=") && (
          <input
            className="jira-filter-value-input"
            type="number"
            min="0"
            value={typeof condition.value === "number" ? condition.value : ""}
            onChange={(event) => {
              const value = event.target.value === "" ? null : Number(event.target.value);
              apply(replaceNode(filters, path, { ...condition, value }));
            }}
          />
        )}
        {removable && (
          <button
            className="jira-filter-remove"
            type="button"
            aria-label="Remove condition"
            onClick={() => apply(removeNode(filters, path))}
          >
            ×
          </button>
        )}
      </div>
    );
  }

  function renderGroup(group: GroupLike, path: NodePath, depth: number) {
    // The tree must keep at least one node at the root; inside a group anything may go.
    const removable = path.length > 0 || group.conditions.length > 1;

    return (
      <div className="jira-filter-conditions">
        {group.conditions.map((node, index) => {
          const childPath = [...path, index];
          return (
            <div key={childPath.join("-")}>
              {index > 0 && (
                <div className="jira-filter-connector">
                  <select
                    value={group.connectors[index - 1] ?? "AND"}
                    onChange={(event) =>
                      apply(setConnector(filters, path, index - 1, event.target.value as JiraFilterConnector))
                    }
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                </div>
              )}
              {isJiraFilterGroup(node) ? (
                <div className="jira-filter-group">
                  <div className="jira-filter-group__header">
                    <span className="jira-filter-group__label">Group</span>
                    <button
                      className="jira-filter-remove"
                      type="button"
                      aria-label="Remove group"
                      onClick={() => apply(removeNode(filters, childPath))}
                    >
                      ×
                    </button>
                  </div>
                  {renderGroup(node, childPath, depth + 1)}
                </div>
              ) : (
                renderCondition(node, childPath, removable)
              )}
            </div>
          );
        })}
        <div className="jira-filter-actions">
          <button
            className="jira-filter-add"
            type="button"
            onClick={() => apply(appendNode(filters, path, defaultCondition()))}
          >
            + Add condition
          </button>
          {depth < MAX_GROUP_DEPTH && (
            <button
              className="jira-filter-add jira-filter-add--group"
              type="button"
              onClick={() => apply(appendNode(filters, path, defaultGroup()))}
            >
              + Add group ( )
            </button>
          )}
        </div>
      </div>
    );
  }

  const summary = describeFilters(filters, statuses);

  return (
    <div ref={treeRef}>
      {renderGroup(filters, [], 0)}
      {summary && (
        <p className="jira-filter-summary">
          <span className="jira-filter-summary__label">Evaluates as</span>
          <code>{summary}</code>
        </p>
      )}
    </div>
  );
}
