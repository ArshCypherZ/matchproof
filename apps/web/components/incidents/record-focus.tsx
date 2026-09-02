"use client";

import { useEffect } from "react";
import { consumeRecordFocusStep } from "./queue-shortcuts";

// A pager step (p / n, or a click on Previous / Next) swaps the whole record
// under the operator. Focus otherwise falls off the unmounted control to
// <body>, and a screen reader hears nothing about the record it landed on.
// The pager marks the step before navigating; this component ships with the
// new record and moves focus to its heading, so the new record is announced.
export function RecordFocus() {
  useEffect(() => {
    if (!consumeRecordFocusStep()) return;
    const heading = document.getElementById("record-heading");
    if (heading instanceof HTMLElement) heading.focus();
  }, []);
  return null;
}
