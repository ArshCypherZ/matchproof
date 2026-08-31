export type RazorpayMcpReadTool =
  "fetch_payment" | "fetch_order" | "search_events";
export type RazorpayMcpCall = {
  tool: RazorpayMcpReadTool;
  input: Record<string, unknown>;
};
export type RazorpayMcpProvenance = {
  tool: string;
  input: Record<string, unknown>;
  started_at: string;
  completed_at: string;
  result: "success" | "denied" | "timeout" | "rate_limited" | "error";
  output?: unknown;
  output_summary?: string | undefined;
  error?: string | undefined;
};
export type RazorpayMcpTransport = (call: RazorpayMcpCall) => Promise<unknown>;
const READ_TOOLS = ["fetch_payment", "fetch_order", "search_events"] as const;
const MUTATION_PATTERN =
  /capture|refund|payout|transfer|create|update|delete|cancel/i;
const summary = (value: unknown) =>
  value !== null && typeof value === "object"
    ? `${Array.isArray(value) ? "array" : "object"}(${Array.isArray(value) ? value.length : Object.keys(value).length}${Array.isArray(value) ? "" : " keys"})`
    : typeof value;
const classify = (error: unknown): RazorpayMcpProvenance["result"] =>
  /timeout|timed out|deadline/i.test(String(error))
    ? "timeout"
    : /rate|429|too many/i.test(String(error))
      ? "rate_limited"
      : "error";
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
/**
 * Every read carries the exact input its tool consumes. The payload itself is
 * part of the trust boundary: a tool name on the allowlist with a malformed or
 * oversized input is denied before the transport sees it.
 */
const readInputError = (
  tool: RazorpayMcpReadTool,
  input: Record<string, unknown>,
): string | undefined => {
  if (tool === "fetch_payment")
    return typeof input.payment_id === "string" &&
      ENTITY_ID.test(input.payment_id)
      ? undefined
      : "fetch_payment requires a payment_id entity identifier";
  if (tool === "fetch_order")
    return typeof input.order_id === "string" && ENTITY_ID.test(input.order_id)
      ? undefined
      : "fetch_order requires an order_id entity identifier";
  const count = input.count;
  return count === undefined ||
    (typeof count === "number" &&
      Number.isInteger(count) &&
      count >= 1 &&
      count <= 100)
    ? undefined
    : "search_events count must be an integer from 1 to 100";
};
export class RazorpayMcpReadGateway {
  readonly tools = READ_TOOLS;
  constructor(
    private readonly transport: RazorpayMcpTransport,
    private readonly timeoutMs = 5_000,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
      throw new RangeError("timeoutMs must be a positive integer");
  }
  async call(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<RazorpayMcpProvenance> {
    const started_at = this.now().toISOString();
    const base = { tool, input, started_at };
    if (
      !READ_TOOLS.includes(tool as RazorpayMcpReadTool) ||
      MUTATION_PATTERN.test(tool)
    )
      return {
        ...base,
        completed_at: this.now().toISOString(),
        result: "denied",
        error: "MCP tool is outside the read-only allowlist",
      };
    const inputError = readInputError(tool as RazorpayMcpReadTool, input);
    if (inputError)
      return {
        ...base,
        completed_at: this.now().toISOString(),
        result: "denied",
        error: inputError,
      };
    let handle: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        handle = setTimeout(
          () => reject(new Error("MCP read timed out")),
          this.timeoutMs,
        );
      });
      const output = await Promise.race([
        this.transport({ tool: tool as RazorpayMcpReadTool, input }),
        timeout,
      ]);
      return {
        ...base,
        completed_at: this.now().toISOString(),
        result: "success",
        output,
        output_summary: summary(output),
      };
    } catch (error) {
      return {
        ...base,
        completed_at: this.now().toISOString(),
        result: classify(error),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (handle) clearTimeout(handle);
    }
  }
}
