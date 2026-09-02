import type { Metadata } from "next";
import { notFound } from "next/navigation";

// The proxy rewrites an unknown exception id here before the record page
// streams, and this segment's own not-found (next file) renders the
// exceptions copy in the workspace rail — not the app-wide record page. The
// tab names what the page is; the thrown notFound() keeps the page out of
// indexes wherever it streams as a 200.
export const metadata: Metadata = { title: "Exception not found" };

export default function UnknownIncidentPage() {
  notFound();
}
