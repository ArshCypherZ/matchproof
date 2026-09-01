"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const ACTION_NOUN = {
  approve: "The approval",
  escalate: "The escalation",
} as const;

// Map the route's status codes to the operator's next actions.
async function actionError(
  action: "approve" | "escalate",
  response: Response | null,
): Promise<string> {
  const noun = ACTION_NOUN[action];
  if (!response)
    return `${noun} did not go through. Check the connection and try again.`;
  if (response.status === 404)
    return `${noun} failed: this exception is no longer available. Reload the page to see its current state.`;
  if (response.status === 429)
    return `${noun} was rate limited. Wait a moment and try again.`;
  const payload = (await response.json().catch(() => ({}))) as {
    reason?: string;
  };
  if (response.status === 422 && payload.reason)
    return `${noun} did not complete the repair: ${humanizeReason(payload.reason)}. No merchant state was changed. Fix the cause and approve again to retry the repair.`;
  if (response.status === 409 && payload.reason)
    return `${noun} was blocked: ${humanizeReason(payload.reason)}. Reload the page to see the current evidence.`;
  return `${noun} did not go through. No merchant state was changed. Try again.`;
}

function humanizeReason(reason: string) {
  return reason.replaceAll("_", " ");
}

const ESCALATE_REASON_MAX = 500;

// Both dialogs share one shape: the approval gate is a modal by design, and
// its chrome is defined once.
const dialogClass =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto overscroll-contain rounded-xl bg-surface p-0 text-foreground shadow-xl backdrop:bg-scrim";
const dialogFooterClass =
  "flex flex-col-reverse justify-end gap-2 border-t border-border px-5 py-4 sm:flex-row";

function DialogAlert({ error }: { error: string }) {
  return (
    <div
      role="alert"
      className="flex gap-3 border-t border-border bg-warning-soft px-5 py-3"
    >
      <ShieldAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning"
      />
      <p className="text-sm text-muted-foreground">{error}</p>
    </div>
  );
}

export function IncidentActions({
  incidentId,
  canApprove,
  canEscalate,
  targetOrderId,
  targetState,
  idempotencyKey,
}: {
  incidentId: string;
  canApprove: boolean;
  canEscalate: boolean;
  targetOrderId: string | null;
  targetState: string | null;
  idempotencyKey: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const escalateDialog = useRef<HTMLDialogElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [showDock, setShowDock] = useState(false);
  const [pending, setPending] = useState<"approve" | "escalate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  useEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowDock(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const mutate = async (action: "approve" | "escalate") => {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/incidents/${incidentId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason:
            action === "approve"
              ? "merchant order update approval"
              : reason.trim(),
        }),
      });
      if (!response.ok) throw new Error(await actionError(action, response));
      if (action === "approve") dialog.current?.close();
      else escalateDialog.current?.close();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `${ACTION_NOUN[action]} did not go through. Check the connection and try again.`,
      );
    } finally {
      setPending(null);
    }
  };

  const submitEscalation = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError(
        "Write the stopping reason. It is shown on the exception after escalation.",
      );
      return;
    }
    setReasonError(null);
    void mutate("escalate");
  };

  // A terminal record offers no actions: re-escalating a finished exception
  // or approving a closed one is never the operator's next move.
  if (!canEscalate && !canApprove) return null;

  const actions = (compact = false) => (
    <>
      {canEscalate ? (
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          onClick={() => {
            setReason("");
            setReasonError(null);
            setError(null);
            escalateDialog.current?.showModal();
          }}
          disabled={pending !== null}
          data-icon="inline-start"
        >
          {pending === "escalate" ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <ShieldAlert aria-hidden="true" />
          )}
          Escalate
        </Button>
      ) : null}
      {canApprove ? (
        <Button
          size={compact ? "sm" : "default"}
          onClick={() => {
            setError(null);
            dialog.current?.showModal();
          }}
          disabled={pending !== null}
        >
          Approve order update
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <div ref={anchor} className="flex flex-wrap justify-end gap-2">
        {actions()}
      </div>
      {showDock ? (
        <div
          role="region"
          aria-label="Exception actions"
          className="animate-capsule-pop fixed bottom-4 left-2 right-2 z-40 flex flex-wrap items-center justify-end gap-1.5 rounded-xl bg-surface-raised px-2 py-2 shadow-xl motion-reduce:animate-none [margin-bottom:max(1rem,env(safe-area-inset-bottom))] sm:left-auto sm:px-3"
        >
          {actions(true)}
        </div>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="approval-title"
        // Esc cannot dismiss the gate mid-flight: a request already sent can
        // still change merchant state, so the operator must see its result.
        onCancel={(event) => {
          if (pending !== null) event.preventDefault();
        }}
        className={dialogClass}
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="approval-title" className="text-base font-semibold">
            Approve order update
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This approval permits one merchant order status change. It does not
            capture, refund, transfer, or pay out funds.
          </p>
        </div>
        <dl className="grid gap-4 px-5 py-5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Transition</dt>
            <dd className="mt-1 font-data text-xs">
              {targetOrderId ?? "No unique order"} to {targetState ?? "unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Scope</dt>
            <dd className="mt-1">Merchant order state</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              One-time approval key
            </dt>
            <dd translate="no" className="mt-1 break-all font-data text-xs">
              {idempotencyKey}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Required result</dt>
            <dd className="mt-1">
              A fresh check must confirm the same payment, order, amount,
              currency, and paid state in both systems.
            </dd>
          </div>
        </dl>
        {error ? <DialogAlert error={error} /> : null}
        <div className={dialogFooterClass}>
          <Button
            variant="outline"
            onClick={() => dialog.current?.close()}
            disabled={pending !== null}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutate("approve")}
            disabled={pending !== null}
            data-icon="inline-start"
          >
            {pending === "approve" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : null}
            Confirm approval
          </Button>
        </div>
      </dialog>
      <dialog
        ref={escalateDialog}
        aria-labelledby="escalate-title"
        onCancel={(event) => {
          if (pending !== null) event.preventDefault();
        }}
        className={dialogClass}
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="escalate-title" className="text-base font-semibold">
            Escalate to the exception list
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The exception stays on the exception list with its evidence, and no
            merchant state changes. Write the stopping reason so the next reader
            knows where you stopped.
          </p>
        </div>
        <div className="px-5 py-5">
          <label
            htmlFor="escalate-reason"
            className="text-xs text-muted-foreground"
          >
            Stopping reason
          </label>
          <textarea
            id="escalate-reason"
            name="stopping-reason"
            autoComplete="off"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value.slice(0, ESCALATE_REASON_MAX));
              if (reasonError) setReasonError(null);
            }}
            required
            rows={3}
            maxLength={ESCALATE_REASON_MAX}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={
              reasonError
                ? "escalate-reason-count escalate-reason-error"
                : "escalate-reason-count"
            }
            placeholder="What evidence stopped the automated repair?"
            className="mt-1 w-full resize-y rounded-md border border-input bg-surface px-2.5 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40 md:text-sm"
          />
          <p
            id="escalate-reason-count"
            className="mt-1 text-right font-data text-2xs text-muted-foreground"
          >
            {reason.length}/{ESCALATE_REASON_MAX}
          </p>
          {reasonError ? (
            <p
              id="escalate-reason-error"
              role="alert"
              className="mt-1 text-xs text-destructive"
            >
              {reasonError}
            </p>
          ) : null}
        </div>
        {error ? <DialogAlert error={error} /> : null}
        <div className={dialogFooterClass}>
          <Button
            variant="outline"
            onClick={() => escalateDialog.current?.close()}
            disabled={pending !== null}
          >
            Cancel
          </Button>
          <Button
            onClick={submitEscalation}
            disabled={pending !== null}
            data-icon="inline-start"
          >
            {pending === "escalate" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <ShieldAlert aria-hidden="true" />
            )}
            Escalate with reason
          </Button>
        </div>
      </dialog>
    </>
  );
}
