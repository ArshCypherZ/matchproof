import { PUT as escalate } from "../route";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return escalate(request, context);
}
