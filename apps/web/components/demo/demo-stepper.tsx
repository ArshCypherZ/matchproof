"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Script from "next/script";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  LoaderCircle,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CLASS_LABELS } from "@/components/incidents/queue-facets";

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
  post_repair_state_verification: string;
  payment_state: string;
  order_state: string | null;
  gate_decisions: {
    action: string;
    allowed: boolean;
    reason: string;
  }[];
};

type Staged = { incident_id: string; payment_id: string; order_id: string };

type StepState = "waiting" | "active" | "done";

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

/* A failure the demo actions never shape themselves: the route threw
   before it could answer with JSON, so there is no reason to quote. Name
   the class of failure — the operator's recovery does not depend on the
   status number. */
function httpMessage(status: number) {
  return status >= 500
    ? "The server hit an error. Nothing was changed. Try again."
    : "The request was rejected. Nothing was changed. Try again.";
}

/* The run result is cast, not validated, on its way in from the API; one
   missing field must not blank the walkthrough with a render crash. */
function formatValue(value: unknown) {
  return value == null || value === ""
    ? "unknown"
    : String(value).replaceAll("_", " ");
}

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

/* The step marker carries the state: a quiet outline for what is coming, a
   filled accent dot for the step the operator is on, a spinner while that
   step is working, and a check when it is done. Color is paired with a
   shape change so the state reads without relying on color alone. */
function StepMarker({ state, busy }: { state: StepState; busy?: boolean }) {
  if (state === "done")
    return <CheckCircle2 aria-hidden="true" className="size-4 text-success" />;
  if (state === "active" && busy)
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-4 animate-spin text-ring-strong"
      />
    );
  if (state === "active")
    return (
      <Circle
        aria-hidden="true"
        className="size-4 fill-ring-strong text-ring-strong"
      />
    );
  return <Circle aria-hidden="true" className="size-4 text-muted-foreground" />;
}

/* One surface in the whole walkthrough: the card sits on the step being
   worked on and moves down as the operator advances. Completed steps rest
   on the canvas — the check marker and the record line carry completion;
   a filled block per finished step would stack into a wall. Upcoming steps
   dim to secondary ink. A step only renders its action when it is the one
   being worked on; completed steps show the record they produced. */
function StepSection({
  title,
  state,
  busy,
  alert,
  headingRef,
  children,
}: {
  title: string;
  state: StepState;
  busy?: boolean;
  alert?: ReactNode;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  const surface =
    state === "active"
      ? "bg-surface text-foreground"
      : state === "done"
        ? "text-foreground"
        : "text-ink-secondary";
  return (
    <section
      aria-current={state === "active" ? "step" : undefined}
      data-state={state}
      className={`rounded-xl p-5 transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] motion-reduce:transition-none ${surface}`}
    >
      <div className="flex items-center gap-2">
        <StepMarker state={state} busy={busy} />
        {/* Focus target, not a tab stop: advancing a step unmounts the
            control the operator just used, and focus would fall to the page
            body. The effect below moves it here instead. scroll-mt keeps the
            focus jump clear of the sticky header (two rows on phones, one on
            sm+), which the main-element margin in globals.css does not cover. */}
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="scroll-mt-28 text-base font-semibold sm:scroll-mt-20"
        >
          {title}
        </h2>
      </div>
      {/* Feedback renders beside the action that failed, inside the step the
         operator is working on, not at the top of the page. */}
      {state === "active" && alert ? (
        <div className="mt-4 sm:pl-6">{alert}</div>
      ) : null}
      <div className="mt-4 sm:pl-6">{children}</div>
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
  const [checkoutFailed, setCheckoutFailed] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Mirrors `polling` for guards that must read the truth synchronously,
  // before React has flushed the state update.
  const pollingRef = useRef(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const post = useCallback(async (body: Record<string, unknown>) => {
    let response: Response;
    try {
      response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // The request never reached the server, so no step ran and nothing
      // was changed. The browser's own message ("Failed to fetch") tells
      // the operator nothing about either fact.
      throw new Error(
        "This step could not reach the server. Check the connection and try again.",
      );
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error(httpMessage(response.status));
    }
    if (!response.ok) {
      // The rate limit carries no prose reason, only the code and the wait;
      // translate it here so the operator learns why and how long to wait.
      if (payload.error === "rate_limited")
        throw new Error(
          `Too many demo requests. Wait ${String(payload.retry_after_seconds ?? 60)}\u00A0seconds, then try again.`,
        );
      throw new Error(
        typeof payload.reason === "string"
          ? payload.reason
          : typeof payload.error === "string"
            ? payload.error
            : httpMessage(response.status),
      );
    }
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
      if (payload.captured && typeof payload.payment_id === "string") {
        setPaymentId(payload.payment_id);
        // The wait is over, so any error it raised (a dismissed Checkout, a
        // slow capture) is resolved; leaving it set would show a stale
        // message on the step that just became active.
        setError("");
        return true;
      }
      return false;
    },
    [post],
  );

  const pollPayment = async (orderId: string, attempt = 1) => {
    // One chain per order: paying a second time (Checkout reopened) must
    // not start a second chain checking the same order.
    if (attempt === 1 && pollingRef.current) return;
    pollingRef.current = true;
    // Polling stays "on" across the whole wait, including the gaps between
    // retries, so the step does not flicker back to its resting state.
    setPolling(true);
    const stop = () => {
      pollingRef.current = false;
      setPolling(false);
    };
    try {
      if (await checkPayment(orderId)) {
        stop();
        return;
      }
      if (attempt >= MAX_POLL_ATTEMPTS) {
        stop();
        setError(
          "No captured payment was found after a minute of checking. If you paid, paste the payment id below to verify it manually.",
        );
        return;
      }
      pollTimer.current = setTimeout(
        () => void pollPayment(orderId, attempt + 1),
        POLL_INTERVAL_MS,
      );
    } catch (cause) {
      stop();
      setError(
        cause instanceof Error
          ? cause.message
          : "The payment check failed. If you paid, paste the payment id below to verify it manually.",
      );
    }
  };

  const createOrder = async () => {
    const amountMinor = parseAmountMinor(amount);
    if (amountMinor == null) {
      setAmountError(
        `Enter a whole number of paise between ₹${(MIN_AMOUNT_MINOR / 100).toLocaleString("en-IN")}\u00A0(${MIN_AMOUNT_MINOR.toLocaleString("en-IN")}) and ₹${(MAX_AMOUNT_MINOR / 100).toLocaleString("en-IN")}\u00A0(${MAX_AMOUNT_MINOR.toLocaleString("en-IN")}).`,
      );
      // The error is announced, but the fix lives in the field: land focus
      // there so a keyboard operator is not left on the submit button.
      amountInputRef.current?.focus();
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
      const orderAmount = Number(payload.amount_minor);
      if (
        typeof payload.order_id !== "string" ||
        typeof payload.key_id !== "string" ||
        !Number.isInteger(orderAmount)
      )
        throw new Error(
          "The server returned an incomplete order record. No order was created on this page. Try again.",
        );
      setOrder({
        order_id: payload.order_id,
        key_id: payload.key_id,
        amount_minor: orderAmount,
        currency:
          typeof payload.currency === "string" ? payload.currency : "INR",
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
    if (!order) return;
    if (!window.Razorpay) {
      setError(
        "Razorpay Checkout has not loaded yet. Wait a moment and try again.",
      );
      return;
    }
    if (checkoutOpen) return;
    const checkout = new window.Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount_minor,
      currency: order.currency,
      name: "Matchproof",
      description: "Test payment",
      handler: () => {
        setCheckoutOpen(false);
        void pollPayment(order.order_id);
      },
      modal: {
        ondismiss: () => {
          setCheckoutOpen(false);
          setError(
            "Checkout was closed before the payment. Reopen Checkout to pay, or paste a payment id below to verify a payment you already made.",
          );
        },
      },
    });
    checkout.open();
    // One Checkout at a time: the modal covers the page, so a second open
    // can only come from a double activation before the modal paints.
    setCheckoutOpen(true);
  };

  const stageDiscrepancy = async () => {
    if (!order) return;
    setBusy(true);
    setError("");
    try {
      const payload = await post({
        action: "stage_discrepancy",
        order_id: order.order_id,
      });
      if (typeof payload.incident_id !== "string")
        throw new Error(
          "The exception was created but its record came back incomplete. Find it in the queue to continue.",
        );
      setStaged({
        incident_id: payload.incident_id,
        payment_id:
          typeof payload.payment_id === "string" ? payload.payment_id : "",
        order_id:
          typeof payload.order_id === "string"
            ? payload.order_id
            : order.order_id,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The exception could not be created. No records were changed. Try again.",
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
          : "The controller run failed. The exception was not changed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyManualPayment = async () => {
    if (!order) return;
    const manualId = manualPaymentId.trim();
    // The server rejects short ids with a body-schema message that has
    // nothing to do with what the operator typed; answer that here instead.
    if (manualId.length < 3) {
      setManualError(
        "A Test-mode payment id looks like pay_ followed by letters and digits.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setManualError("");
    try {
      const payload = await post({
        action: "await_payment",
        order_id: order.order_id,
        payment_id: manualId,
      });
      if (payload.captured && typeof payload.payment_id === "string")
        setPaymentId(payload.payment_id);
      else
        setManualError(
          `That payment is ${formatValue(payload.payment_status)}, not captured. Only a captured payment can continue this walkthrough.`,
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

  const createHeadingRef = useRef<HTMLHeadingElement>(null);
  const payHeadingRef = useRef<HTMLHeadingElement>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const runHeadingRef = useRef<HTMLHeadingElement>(null);
  const activeStepIndex = [createStep, payStep, stageStep, runStep].findIndex(
    (step) => step === "active",
  );
  const hasResult = result !== null;
  /* Completing a step unmounts the button the operator just pressed, which
     drops focus to the page body; the run result does the same inside the
     last step. Whenever the walkthrough advances, move focus to the active
     step's heading so keyboard and screen-reader operators land on what
     changed. Seeded with the arrival state so the first render — and the
     StrictMode double-invoke of it — never steals focus from the page. */
  const focusKey = `${activeStepIndex}:${hasResult}`;
  const lastFocusKeyRef = useRef(focusKey);
  useEffect(() => {
    if (lastFocusKeyRef.current === focusKey) return;
    lastFocusKeyRef.current = focusKey;
    const headings = [
      createHeadingRef,
      payHeadingRef,
      stageHeadingRef,
      runHeadingRef,
    ];
    headings[Math.max(activeStepIndex, 0)]?.current?.focus();
  }, [focusKey, activeStepIndex]);

  /* Rendered by whichever step is active, right above its controls. */
  const errorAlert = error ? (
    <div
      role="alert"
      className="flex gap-3 rounded-md bg-warning-soft px-4 py-3"
    >
      <ShieldAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning"
      />
      <p className="text-sm text-muted-foreground">{error}</p>
    </div>
  ) : null;

  return (
    <div className="mt-8 space-y-4">
      {/* Hoisted to <head>: the Checkout script loads lazily, but its
          connection handshake should not be paid at the first "Open
          Checkout" press. */}
      <link rel="preconnect" href="https://checkout.razorpay.com" />
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
        onError={() => setCheckoutFailed(true)}
      />
      <StepSection
        title="Create a Test-mode order"
        state={createStep}
        busy={createBusy}
        alert={errorAlert}
        headingRef={createHeadingRef}
      >
        {order ? (
          <p className="font-data text-xs text-muted-foreground">
            Created order {order.order_id}
          </p>
        ) : (
          /* A form, not a div: on a soft keyboard the operator confirms the
             amount with the keyboard's own action key, and the button beside
             the input is type="button" (Base UI default), so Enter submits
             once and never double-creates the order. */
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) void createOrder();
            }}
          >
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
                ref={amountInputRef}
                className="w-full sm:w-32"
                value={amount}
                inputMode="numeric"
                type="text"
                autoComplete="off"
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
                disabled={busy}
                className="max-sm:w-full"
              >
                Create order
              </Button>
            </div>
            <p
              id="demo-amount-hint"
              className="mt-1.5 text-xs text-muted-foreground"
            >
              {`Whole number of paise, ₹${(MIN_AMOUNT_MINOR / 100).toLocaleString("en-IN")}\u00A0(${MIN_AMOUNT_MINOR.toLocaleString("en-IN")}) to ₹${(MAX_AMOUNT_MINOR / 100).toLocaleString("en-IN")}\u00A0(${MAX_AMOUNT_MINOR.toLocaleString("en-IN")})`}
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
          </form>
        )}
      </StepSection>

      <StepSection
        title="Pay with the test card"
        state={payStep}
        busy={payBusy}
        alert={errorAlert}
        headingRef={payHeadingRef}
      >
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Card <span className="font-data">{TEST_CARD}</span>, any future
          expiry, any CVV. After you pay, this page checks Razorpay until the
          payment shows as captured.
        </p>
        {paymentId ? (
          <p className="mt-4 font-data text-xs text-muted-foreground">
            Captured payment {paymentId}
          </p>
        ) : order ? (
          <>
            <Button
              onClick={pay}
              disabled={busy || polling || checkoutOpen || checkoutFailed}
              className="mt-4 max-sm:w-full"
            >
              Open Checkout
            </Button>
            {checkoutFailed ? (
              <p
                role="alert"
                className="mt-3 max-w-prose text-xs text-destructive"
              >
                Checkout could not be loaded. Check the connection and reload
                the page, or paste a payment id below to verify a payment you
                already made.
              </p>
            ) : null}
            {/* The wait status stays with the action it reports on. */}
            {polling ? (
              <p role="status" className="mt-3 text-xs text-muted-foreground">
                Checking Razorpay for the captured payment. This can take up to
                a minute.
              </p>
            ) : null}
            {/* Primary path first, fallback second: the paste fallback is its
                own labeled group, separated by a clearly larger gap. */}
            <form
              className="mt-6 max-w-md"
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || !manualPaymentId.trim()) return;
                void verifyManualPayment();
              }}
            >
              <label
                htmlFor="demo-manual-payment"
                className="block text-xs text-muted-foreground"
              >
                Or paste a Test-mode payment id
              </label>
              <div className="mt-1 flex flex-wrap items-end gap-3">
                <Input
                  id="demo-manual-payment"
                  className="w-full font-data sm:w-64"
                  placeholder="pay_…"
                  value={manualPaymentId}
                  /* Payment ids are lowercase and machine-read: the soft
                     keyboard must not capitalize or autocorrect a typed
                     one into a mismatch. */
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
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
                  onClick={verifyManualPayment}
                  disabled={busy || !manualPaymentId.trim()}
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
            </form>
          </>
        ) : null}
      </StepSection>

      <StepSection
        title="Create the exception"
        state={stageStep}
        busy={stageBusy}
        alert={errorAlert}
        headingRef={stageHeadingRef}
      >
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Record the merchant order as pending while Razorpay shows the payment
          as captured. That mismatch is the exception the controller resolves.
        </p>
        {staged ? (
          <p className="mt-4 font-data text-xs text-muted-foreground">
            Created exception {staged.incident_id}
          </p>
        ) : paymentId ? (
          <Button
            className="mt-4 max-sm:w-full"
            onClick={stageDiscrepancy}
            disabled={busy}
          >
            Create exception
          </Button>
        ) : null}
      </StepSection>

      <StepSection
        title="Resolve the exception"
        state={runStep}
        busy={runBusy}
        alert={errorAlert}
        headingRef={runHeadingRef}
      >
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          The controller compares the payment with the merchant order and
          repairs the record when the policy allows it.
        </p>
        {result ? (
          <div className="mt-4 space-y-5">
            {/* Two columns is the ceiling: the walkthrough column is capped
               at max-w-2xl on every screen, so a viewport-keyed third column
               would only narrow the cells ("Callback missing, webhook
               recovers" would wrap mid-thought) without gaining width. */}
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                [
                  "Exception type",
                  // The queue and the workbench read the same label map, so
                  // the class says the same thing on every surface.
                  CLASS_LABELS[String(result.incident_class ?? "")] ??
                    formatValue(result.incident_class),
                ],
                ["Outcome", formatValue(result.outcome)],
                [
                  "Post-action check",
                  formatValue(result.post_repair_state_verification),
                ],
                ["Payment state", formatValue(result.payment_state)],
                ["Merchant order state", formatValue(result.order_state)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 font-data text-sm break-words">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {/* The run always reports its gate decisions, but a run that
               reported none must not leave the label standing over an empty
               list. */}
            {(result.gate_decisions ?? []).length > 0 ? (
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Gate decisions
                </p>
                <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {(result.gate_decisions ?? []).map((decision, index) => (
                    <li
                      key={index}
                      className="flex min-w-0 flex-wrap items-baseline gap-2"
                    >
                      <Badge variant={decision.allowed ? "success" : "danger"}>
                        {formatValue(decision.action)} ·{" "}
                        {decision.allowed ? "allowed" : "blocked"}
                      </Badge>
                      {/* A decision without a reason shows the badge alone;
                          an empty annotation span would be the one value on
                          this page not handled for absence. */}
                      {decision.reason ? (
                        <span className="min-w-0 text-xs text-muted-foreground">
                          {String(decision.reason)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {typeof result.incident_id === "string" ? (
              <Button
                render={<Link href={`/incidents/${result.incident_id}`} />}
                data-icon="inline-end"
                className="max-sm:w-full"
              >
                Open the exception <ArrowRight aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ) : staged ? (
          <Button
            onClick={runController}
            disabled={busy}
            className="max-sm:w-full"
          >
            Resolve exception
          </Button>
        ) : null}
      </StepSection>
    </div>
  );
}
