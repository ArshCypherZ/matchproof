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
async function recordIsUnknown(request: NextRequest) {
  const match = /^\/(incidents|batches)\/([^/]+)$/.exec(
    request.nextUrl.pathname,
  );
  if (!match) return false;
  const [, section, id] = match;
  const { tenantId } = requestContext(request);
  const record =
    section === "incidents"
      ? await getIncidentDto(tenantId, id)
      : await getBatchDto(tenantId, id);
  return !record;
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
  if (await recordIsUnknown(request))
    return NextResponse.rewrite(new URL("/_record-not-found", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/incidents/:id", "/batches/:id"],
};
