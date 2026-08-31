import { requestContext } from "./incidents";

type Bucket = { tokens: number; lastRefill: number };

const buckets = new Map<string, Bucket>();

/**
 * In-memory token bucket keyed by tenant and route. Adequate for a local demo
 * deployment; a multi-instance deployment needs a shared store.
 */
export function rateLimit(
  key: string,
  options: { limit: number; windowSeconds: number },
  now: () => number = () => Date.now(),
) {
  const bucket = buckets.get(key);
  const current = now();
  if (!bucket) {
    buckets.set(key, { tokens: options.limit - 1, lastRefill: current });
    return { allowed: true, remaining: options.limit - 1 };
  }
  const refill =
    ((current - bucket.lastRefill) / 1000 / options.windowSeconds) *
    options.limit;
  bucket.tokens = Math.min(options.limit, bucket.tokens + refill);
  bucket.lastRefill = current;
  if (bucket.tokens < 1) return { allowed: false, remaining: 0 };
  bucket.tokens -= 1;
  return { allowed: true, remaining: Math.floor(bucket.tokens) };
}

export function enforceRateLimit(
  request: Request,
  route: string,
  options: { limit: number; windowSeconds: number },
) {
  const { tenantId } = requestContext(request);
  const result = rateLimit(`${tenantId}:${route}`, options);
  return result.allowed
    ? null
    : Response.json(
        { error: "rate_limited", retry_after_seconds: options.windowSeconds },
        {
          status: 429,
          headers: { "retry-after": String(options.windowSeconds) },
        },
      );
}
