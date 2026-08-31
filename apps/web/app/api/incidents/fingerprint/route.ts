import {
  incidentListFingerprint,
  requestContext,
} from "../../../../lib/incidents";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { tenantId } = requestContext(request);
  return Response.json({
    fingerprint: await incidentListFingerprint(tenantId),
  });
}
