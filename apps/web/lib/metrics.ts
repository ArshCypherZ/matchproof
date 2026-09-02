import { withStore } from "./incidents";
import {
  tenantMetrics,
  type TenantMetrics,
} from "../../../src/incident_commander/tenant-metrics";

/** Measured outcomes from the tenant's live incident store. The static
    offline benchmark lives in lib/benchmark, which (unlike this module)
    carries no store dependency and can render inside a client boundary. */
export function liveTenantMetrics(tenantId: string): Promise<TenantMetrics> {
  return withStore(tenantId, (store) => tenantMetrics(store, tenantId));
}
