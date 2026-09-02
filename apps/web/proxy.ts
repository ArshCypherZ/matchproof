import { NextResponse, type NextRequest } from "next/server";
import { getBatchDto, getIncidentDto, requestContext } from "./lib/incidents";

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1)
    difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

// Record pages stream their loading shell before the record is fetched, so a
// notFound() from the page can no longer change the already-committed 200.
// The existence check has to run here, before anything streams: an unknown
// record is rewritten to a path no route can match (a leading underscore is a
// private folder), which the router answers with a real 404.
async function unknownRecordSection(
  request: NextRequest,
): Promise<"incidents" | "batches" | null> {
  const match = /^\/(incidents|batches)\/([^/]+)$/.exec(
    request.nextUrl.pathname,
  );
  if (!match) return null;
  const [, section, id] = match;
  const { tenantId } = requestContext(request);
  const record =
    section === "incidents"
      ? await getIncidentDto(tenantId, id)
      : await getBatchDto(tenantId, id);
  return record ? null : (section as "incidents" | "batches");
}

export async function proxy(request: NextRequest) {
  const token = process.env.API_TOKEN;
  if (token) {
    const { pathname } = request.nextUrl;
    const expected = `Bearer ${token}`;
    const authorization = request.headers.get("authorization");
    if (
      pathname.startsWith("/api/") &&
      pathname !== "/api/health" &&
      (!authorization || !constantTimeEqual(authorization, expected))
    )
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const section = await unknownRecordSection(request);
  if (section === "incidents")
    // A dedicated segment, not the unmatched path: the exceptions' own
    // "Exception not found" copy in the workspace rail (the app-wide record
    // page is the wrong words for a bad exception id). Trade-off: dev
    // responses stream, so this answers HTTP 200 with a noindex render
    // rather than the hard 404 the unmatched batch path returns — the page
    // component's own comment records the same.
    return NextResponse.rewrite(new URL("/incident-not-found", request.url));
  if (section === "batches")
    return NextResponse.rewrite(new URL("/_record-not-found", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/incidents/:id", "/batches/:id"],
};
