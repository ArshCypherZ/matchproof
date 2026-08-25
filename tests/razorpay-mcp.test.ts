import { describe, expect, it } from "vitest";
import { RazorpayMcpReadGateway } from "../src/incident_commander/razorpay-mcp";

describe("RazorpayMcpReadGateway", () => {
  it("allows reads and records provenance", async () => {
    const result = await new RazorpayMcpReadGateway(async () => ({
      id: "pay_test_1",
    })).call("fetch_payment", { payment_id: "pay_test_1" });
    expect(result).toMatchObject({
      result: "success",
      tool: "fetch_payment",
      output_summary: "object(1 keys)",
    });
  });
  it("denies mutation tools without invoking transport", async () => {
    let invoked = false;
    const result = await new RazorpayMcpReadGateway(async () => {
      invoked = true;
      return {};
    }).call("capture_payment", {});
    expect(result.result).toBe("denied");
    expect(invoked).toBe(false);
  });
  it("classifies timeout and rate limiting", async () => {
    const timeout = await new RazorpayMcpReadGateway(
      () => new Promise(() => undefined),
      1,
    ).call("fetch_order", {});
    const limited = await new RazorpayMcpReadGateway(async () => {
      throw new Error("429 rate limit");
    }).call("search_events", {});
    expect(timeout.result).toBe("timeout");
    expect(limited.result).toBe("rate_limited");
  });
});
