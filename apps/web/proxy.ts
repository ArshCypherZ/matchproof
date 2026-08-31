import { NextResponse, type NextRequest } from "next/server";

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1)
    difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export function proxy(request: NextRequest) {
  const token = process.env.API_TOKEN;
  if (!token) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/") || pathname === "/api/health")
    return NextResponse.next();
  const expected = `Bearer ${token}`;
  const authorization = request.headers.get("authorization");
  if (!authorization || !constantTimeEqual(authorization, expected))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
