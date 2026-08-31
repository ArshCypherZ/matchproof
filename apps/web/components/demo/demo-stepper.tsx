"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Script from "next/script";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  LoaderCircle,
  Play,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type OrderStep = {
  order_id: string;
  key_id: string;
  amount_minor: number;
  currency: string;
};

type RunResult = {
  incident_id: string;
  incident_class: string;
  outcome: string;
  afterstate_verification: string;
  payment_state: string;
  order_state: string | null;
  gate_decisions: {
    action: string;
    allowed: boolean;
    reason: string;
  }[];
};

type Staged = { incident_id: string; payment_id: string; order_id: string };

type StepState = "waiting" | "active" | "done" | "failed";

declare global {
  interface Window {
    Razorpay?: new (options: {
      key: string;
      order_id: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      handler: () => void;
      modal?: { ondismiss?: () => void };
    }) => { open: () => void };
  }
}

const TEST_CARD = "4111 1111 1111 1111";
const MIN_AMOUNT_MINOR = 100;
const MAX_AMOUNT_MINOR = 100_000_000;
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 15;

function parseAmountMinor(raw: string): number | null {
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < MIN_AMOUNT_MINOR ||
    value > MAX_AMOUNT_MINOR
  )
    return null;
  return value;
}

function StepMarker({ state, busy }: { state: StepState; busy?: boolean }) {
  if (state === "done")
    return <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />;
  if (state === "active" && busy)
    return <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />;
  if (state === "active")
    return (
      <Circle
        aria-hidden="true"
        className="size-4 fill-provider text-provider"
      />
    );
  if (state === "failed")
    return <ShieldAlert aria-hidden="true" className="size-4 text-warning" />;
  return <Circle aria-hidden="true" className="size-4 text-muted-foreground" />;
}

function StepSection({
  index,
  title,
  state,
  busy,
  children,
}: {
  index: string;
  title: string;
  state: StepState;
  busy?: boolean;
  children: ReactNode;
}) {
  /* De-emphasis is ink weight and paper tone, never opacity: the step
     text stays at readable contrast in every state. */
  const emphasis =
    state === "active"
      ? "bg-card text-foreground"
      : state === "done"
        ? "bg-surface-subtle text-foreground"
        : "bg-transparent text-ink-secondary hover:bg-surface hover:text-foreground focus-within:bg-surface focus-within:text-foreground";
  return (
    <section
      aria-current={state === "active" ? "step" : undefined}
      data-state={state}
      className={`border border-border p-5 transition-colors duration-150 ease-[var(--ease-out-expo)] motion-reduce:transition-none ${emphasis}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid size-7 shrink-0 place-items-center font-data text-2xs ${
            state === "done"
              ? "bg-foreground text-background"
              : "border border-border bg-background text-muted-foreground"
          }`}
        >
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-data text-2xs uppercase tracking-[0.12em] text-muted-foreground">
            Step
          </p>
          <div className="mt-1 flex items-center gap-2">
            <StepMarker state={state} busy={busy} />
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
        </div>
      </div>
      <div className="mt-5 pl-0 sm:pl-10">{children}</div>
    </section>
  );
}

export function DemoStepper() {
  const [amount, setAmount] = useState("29900");
  const [order, setOrder] = useState<OrderStep | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [manualPaymentId, setManualPaymentId] = useState("");
  const [staged, setStaged] = useState<Staged | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [amountError, setAmountError] = useState("");
  const [manualError, setManualError] = useState("");
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(
        typeof payload.reason === "string"
          ? payload.reason
          : typeof payload.error === "string"
            ? payload.error
            : "This step could not be completed — try again.",
      );
    return payload;
  }, []);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const checkPayment = useCallback(
    async (orderId: string): Promise<boolean> => {
      const payload = await post({
        action: "await_payment",
        order_id: orderId,
      });
      if (payload.captured) {
        setPaymentId(String(payload.payment_id));
        return true;
      }
      return false;
    },
    [post],
  );

  const pollPayment = async (orderId: string, attempt = 1) => {
    // Polling stays "on" across the whole wait, including the gaps between
    // retries, so the step does not flicker back to its resting state.
    setPolling(true);
    try {
      if (await checkPayment(orderId)) {
        setPolling(false);
        return;
      }
      if (attempt >= MAX_POLL_ATTEMPTS) {
        setPolling(false);
        setError(
          "The payment was not captured in time. Paste the payment id below to verify it manually.",
        );
        return;
      }
      pollTimer.current = setTimeout(
        () => void pollPayment(orderId, attempt + 1),
        POLL_INTERVAL_MS,
      );
    } catch (cause) {
      setPolling(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "The payment check failed. Paste the payment id below to verify it manually.",
      );
    }
  };

  const createOrder = async () => {
    const amountMinor = parseAmountMinor(amount);
    if (amountMinor == null) {
      setAmountError(
        `Enter a whole number of paise between ${MIN_AMOUNT_MINOR.toLocaleString("en-IN")} and ${MAX_AMOUNT_MINOR.toLocaleString("en-IN")}.`,
      );
      return;
    }
    setBusy(true);
    setError("");
    setAmountError("");
    try {
      const payload = await post({
        action: "create_order",
        amount_minor: amountMinor,
        currency: "INR",
      });
      setOrder({
        order_id: String(payload.order_id),
        key_id: String(payload.key_id),
        amount_minor: Number(payload.amount_minor),
        currency: String(payload.currency),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The order could not be created. Check the connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const pay = () => {
    if (!order || !window.Razorpay) {
      setError(
        "Razorpay Checkout has not loaded yet. Wait a moment and try again.",
      );
      return;
    }
    const checkout = new window.Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount_minor,
      currency: order.currency,
      name: "Payment Operations Controller",
      description: "Test payment",
      handler: () => void pollPayment(order.order_id),
      modal: {
        ondismiss: () =>
          setError(
            "Checkout was closed before the payment. Reopen Checkout, or paste the payment id below to verify it manually.",
          ),
      },
    });
    checkout.open();
  };

  const stageDiscrepancy = async () => {
    if (!order) return;
    setBusy(true);
    setError("");
    try {
      setStaged(
        (await post({
          action: "stage_discrepancy",
          order_id: order.order_id,
        })) as unknown as Staged,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The exception could not be created. No records were changed — try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const runController = async () => {
    if (!order) return;
    setBusy(true);
    setError("");
    try {
      setResult(
        (await post({
          action: "run",
          order_id: order.order_id,
        })) as unknown as RunResult,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The controller run failed. The exception was not changed — try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const useManualPayment = async () => {
    if (!order || !manualPaymentId.trim()) return;
    setBusy(true);
    setError("");
    setManualError("");
    try {
      const payload = await post({
        action: "await_payment",
        order_id: order.order_id,
        payment_id: manualPaymentId.trim(),
      });
      if (payload.captured) setPaymentId(String(payload.payment_id));
      else
        setManualError(
          `That payment is ${String(payload.payment_status)}. Check the id and try again.`,
        );
    } catch (cause) {
      setManualError(
        cause instanceof Error
          ? cause.message
          : "The payment check failed. Check the id and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const createStep: StepState = order ? "done" : "active";
  const payStep: StepState = paymentId ? "done" : order ? "active" : "waiting";
  const stageStep: StepState = staged
    ? "done"
    : paymentId
      ? "active"
      : "waiting";
  const runStep: StepState = result ? "done" : staged ? "active" : "waiting";
  const createBusy = busy && !order;
  const payBusy = (busy || polling) && Boolean(order) && !paymentId;
  const stageBusy = busy && Boolean(paymentId) && !staged;
  const runBusy = busy && Boolean(staged) && !result;

  return (
    <div className="mt-8 space-y-4">
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
      />
      {error ? (
        <div
          role="alert"
          className="flex gap-3 border-l-2 border-warning bg-warning-soft px-4 py-3"
        >
          <ShieldAlert
            aria-hidden="true"
            className="mt-0.5 size-4 text-warning"
          />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : null}

      <StepSection
        index="01"
        title="Create a Test-mode order"
        state={createStep}
        busy={createBusy}
      >
        <div className="mt-4">
          <label
            htmlFor="demo-amount"
            className="block text-xs text-muted-foreground"
          >
            Amount (paise)
          </label>
          {/* The action sits beside the input it acts on, so the two
              controls share a baseline; the range hint spans beneath. */}
          <div className="mt-1 flex flex-wrap items-end gap-3">
            <Input
              id="demo-amount"
              className="w-full sm:w-32"
              value={amount}
              inputMode="numeric"
              type="text"
              aria-describedby={
                amountError
                  ? "demo-amount-hint demo-amount-error"
                  : "demo-amount-hint"
              }
              aria-invalid={amountError ? true : undefined}
              onChange={(event) => {
                setAmount(event.target.value.replace(/[^0-9]/g, ""));
                if (amountError) setAmountError("");
              }}
            />
            <Button
              onClick={createOrder}
              disabled={busy || createStep === "done"}
              data-icon="inline-start"
              className="max-sm:w-full"
            >
              <Play aria-hidden="true" />
              Create order
            </Button>
          </div>
          <p
            id="demo-amount-hint"
            className="mt-1.5 text-xs text-muted-foreground"
          >
            {`Whole number, ${MIN_AMOUNT_MINOR.toLocaleString("en-IN")} to ${MAX_AMOUNT_MINOR.toLocaleString("en-IN")}`}
          </p>
          {amountError ? (
            <p
              id="demo-amount-error"
              role="alert"
              className="mt-1 text-xs text-destructive"
            >
              {amountError}
            </p>
          ) : null}
        </div>
        {order ? (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-data text-xs text-muted-foreground">
            <span>{order.order_id}</span>
            <span>{order.amount_minor} minor units</span>
            <span>{order.currency}</span>
          </div>
        ) : null}
      </StepSection>

      <StepSection
        index="02"
        title="Pay with the test card"
        state={payStep}
        busy={payBusy}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          Card <span className="font-data text-xs">{TEST_CARD}</span>, any
          future expiry, any CVV. The payment is confirmed from Razorpay before
          the next step.
        </p>
        {/* Primary path first, fallback second: the manual paste is its
            own labeled group so the controls align within it. */}
        <Button
          onClick={pay}
          disabled={!order || Boolean(paymentId) || busy || polling}
          data-icon="inline-start"
          className="mt-4 max-sm:w-full"
        >
          <Play aria-hidden="true" />
          Open Checkout
        </Button>
        <div className="mt-5 max-w-md">
          <label
            htmlFor="demo-manual-payment"
            className="block text-xs text-muted-foreground"
          >
            Or paste a Test-mode payment id
          </label>
          <div className="mt-1 flex flex-wrap items-end gap-3">
            <Input
              id="demo-manual-payment"
              className="w-full font-data text-xs sm:w-64"
              placeholder="pay_..."
              value={manualPaymentId}
              aria-describedby={
                manualError ? "demo-manual-payment-error" : undefined
              }
              aria-invalid={manualError ? true : undefined}
              onChange={(event) => {
                setManualPaymentId(event.target.value);
                if (manualError) setManualError("");
              }}
            />
            <Button
              variant="outline"
              onClick={useManualPayment}
              disabled={!order || Boolean(paymentId) || !manualPaymentId.trim()}
              className="max-sm:w-full"
            >
              Verify payment
            </Button>
          </div>
          {manualError ? (
            <p
              id="demo-manual-payment-error"
              role="alert"
              className="mt-1 text-xs text-destructive"
            >
              {manualError}
            </p>
          ) : null}
        </div>
        {paymentId ? (
          <p className="mt-3 font-data text-xs text-muted-foreground">
            Captured payment {paymentId}
          </p>
        ) : order && polling ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Waiting for the payment to be captured.
          </p>
        ) : null}
      </StepSection>

      <StepSection
        index="03"
        title="Create the exception"
        state={stageStep}
        busy={stageBusy}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          Record the merchant order as pending while Razorpay shows the payment
          as captured.
        </p>
        <Button
          className="mt-4"
          onClick={stageDiscrepancy}
          disabled={!paymentId || Boolean(staged) || busy}
          data-icon="inline-start"
        >
          <Play aria-hidden="true" />
          Create exception
        </Button>
        {staged ? (
          <p className="mt-3 font-data text-xs text-muted-foreground">
            {staged.incident_id}
          </p>
        ) : null}
      </StepSection>

      <StepSection
        index="04"
        title="Resolve the exception"
        state={runStep}
        busy={runBusy}
      >
        <Button
          onClick={runController}
          disabled={!staged || Boolean(result) || busy}
          data-icon="inline-start"
        >
          <Play aria-hidden="true" />
          Resolve exception
        </Button>
        {result ? (
          <div className="mt-4 space-y-3">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Exception type", result.incident_class],
                ["Outcome", result.outcome],
                ["Post-action check", result.afterstate_verification],
                ["Payment state", result.payment_state],
                ["Merchant order", result.order_state ?? "unknown"],
              ].map(([label, value]) => (
                <div key={label} className="border-l-2 border-border pl-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-data text-sm">
                    {value.replaceAll("_", " ")}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-border pt-4">
              <p className="font-data text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                Allowed actions
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {(result.gate_decisions ?? []).map((decision, index) => (
                  <li
                    key={index}
                    className="inline-flex max-w-full flex-col items-start gap-1 rounded-sm bg-foreground px-2.5 py-2 font-data text-2xs font-medium uppercase leading-4 tracking-[0.12em] text-background"
                  >
                    <span>
                      {decision.action.replaceAll("_", " ")} ·{" "}
                      {decision.allowed ? "allowed" : "blocked"}
                    </span>
                    <span className="normal-case tracking-normal">
                      {decision.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              render={<Link href={`/incidents/${result.incident_id}`} />}
              data-icon="inline-end"
            >
              Open the exception
            </Button>
          </div>
        ) : null}
      </StepSection>
    </div>
  );
}
