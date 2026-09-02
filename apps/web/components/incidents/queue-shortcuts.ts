// The queue's keyboard flow lives in the table, but the search field it must
// focus lives in the filters. A module-scoped handle is the cheapest way for
// two sibling client components to share one focusable element without
// threading props through the page.
let searchField: HTMLInputElement | null = null;

export function registerQueueSearch(input: HTMLInputElement | null) {
  searchField = input;
}

export function focusQueueSearch() {
  searchField?.focus();
}

// A pager step to another record must carry focus to the new record's
// heading (see RecordFocus). router.push cannot pass state across the
// navigation, so the pager marks the step in sessionStorage and the new
// record consumes the mark on mount.
const RECORD_FOCUS_KEY = "matchproof:record-focus";

export function markRecordFocusStep() {
  try {
    sessionStorage.setItem(RECORD_FOCUS_KEY, "1");
  } catch {
    // Storage can be unavailable (private mode); the step just lands unfocused.
  }
}

export function consumeRecordFocusStep(): boolean {
  try {
    if (sessionStorage.getItem(RECORD_FOCUS_KEY) !== "1") return false;
    sessionStorage.removeItem(RECORD_FOCUS_KEY);
    return true;
  } catch {
    return false;
  }
}

// Queue shortcuts are for reading and row movement, not typing or picking.
// They stay quiet while the operator is in a text field, a menu item, or an
// open dialog, and while any modifier key is held.
export function shortcutsInert(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
    return true;
  const target = event.target as HTMLElement | null;
  if (!target) return true;
  const tag = target.tagName;
  // Text entry owns the keyboard: search fields, filter selects, note boxes.
  // Checkboxes and buttons stay open to the queue shortcuts so row movement
  // keeps working right after a selection.
  const inputType =
    tag === "INPUT" && target instanceof HTMLInputElement ? target.type : "";
  const textEntry =
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    (tag === "INPUT" &&
      ![
        "checkbox",
        "radio",
        "button",
        "submit",
        "reset",
        "range",
        "color",
      ].includes(inputType));
  if (textEntry) return true;
  if (target.closest('[data-slot="select-content"]')) return true;
  if (target.closest("[role='dialog'], dialog")) return true;
  // A dialog or picker can own the keyboard even when focus sits elsewhere.
  return Boolean(
    document.querySelector(
      'dialog[open], [role="dialog"], [data-slot="select-content"][data-open]',
    ),
  );
}
