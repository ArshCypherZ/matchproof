import { GlideClient, Script } from "@valkey/valkey-glide";
import { requestContext } from "./incidents";

type Bucket = { tokens: number; lastRefill: number };

type Options = { limit: number; windowSeconds: number };

// Fallback for when Redis is unreachable (local dev without Redis). Each
// process then counts alone, so the configured limit is per worker.
const buckets = new Map<string, Bucket>();

function memoryRateLimit(key: string, options: Options) {
  const current = Date.now();
  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, {
      tokens: options.limit - 1,
      lastRefill: current,
    });
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

// One atomic round trip: INCR the fixed-window counter and arm its TTL on the
// first hit. A separate INCR then EXPIRE would leave a counter with no TTL if
// the process died between the two calls, 429-ing that key forever.
const windowScript = new Script(
  "local n = redis.call('INCR', KEYS[1]) " +
    "if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end " +
    "return n",
);

let clientPromise: Promise<GlideClient> | null = null;

// When Redis is unreachable, stop reconnecting for a while so only one
// request per cooldown pays the connect timeout; the rest go straight to
// the in-memory fallback.
let unavailableUntil = 0;

function redisClient() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (Date.now() < unavailableUntil) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:")
    return null;
  clientPromise ??= GlideClient.createClient({
    addresses: [{ host: parsed.hostname, port: Number(parsed.port) || 6379 }],
    useTLS: parsed.protocol === "rediss:",
  });
  return clientPromise;
}

/**
 * Fixed-window limiter keyed by tenant and route. Counters live in the shared
 * Redis instance so every worker of every instance counts against the same
 * window; only when Redis is unreachable does each process fall back to
 * counting alone.
 */
export async function rateLimit(key: string, options: Options) {
  const connecting = redisClient();
  if (!connecting) return memoryRateLimit(key, options);
  try {
    const client = await connecting;
    const count = Number(
      await client.invokeScript(windowScript, {
        keys: [`matchproof:ratelimit:${key}`],
        args: [String(options.windowSeconds)],
      }),
    );
    return {
      allowed: count <= options.limit,
      remaining: Math.max(0, options.limit - count),
    };
  } catch {
    clientPromise = null;
    unavailableUntil = Date.now() + 30_000;
    return memoryRateLimit(key, options);
  }
}

export async function enforceRateLimit(
  request: Request,
  route: string,
  options: Options,
) {
  const { tenantId } = requestContext(request);
  const result = await rateLimit(`${tenantId}:${route}`, options);
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
