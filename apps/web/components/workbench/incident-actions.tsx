"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const ACTION_NOUN = {
  approve: "The order update approval",
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
  if (response.status === 409 && payload.reason)
    return `${noun} was blocked: ${humanizeReason(payload.reason)}. Reload the page to see the current evidence.`;
  return `${noun} did not go through. No merchant state was changed. Try again.`;
}

function humanizeReason(reason: string) {
  return reason.replaceAll("_", " ");
}

const ESCALATE_REASON_MAX = 500;

export function IncidentActions({
  incidentId,
  canApprove,
  targetOrderId,
  targetState,
  idempotencyKey,
}: {
  incidentId: string;
  canApprove: boolean;
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
        "Write the stopping reason. It becomes the exception list entry.",
      );
      return;
    }
    setReasonError(null);
    void mutate("escalate");
  };

  const actions = (compact = false) => (
    <>
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
          className="animate-capsule-pop fixed bottom-4 left-2 right-2 z-40 flex items-center justify-end gap-1.5 rounded-full border border-border bg-surface-raised px-2 py-2 motion-reduce:animate-none [margin-bottom:max(1rem,env(safe-area-inset-bottom))] sm:left-auto sm:px-3"
        >
          {actions(true)}
        </div>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="approval-title"
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface-raised p-0 text-foreground backdrop:bg-scrim"
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
            <dd className="mt-1 break-all font-data text-xs">
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
        {error ? (
          <div
            role="alert"
            className="flex gap-3 border-t border-border border-l-2 border-l-warning bg-warning-soft px-5 py-3"
          >
            <ShieldAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : null}
        <div className="flex flex-col-reverse justify-end gap-2 border-t border-border px-5 py-4 sm:flex-row">
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
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface-raised p-0 text-foreground backdrop:bg-scrim"
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
            className="mt-1 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-base outline-none md:text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
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
        {error ? (
          <div
            role="alert"
            className="flex gap-3 border-t border-border border-l-2 border-l-warning bg-warning-soft px-5 py-3"
          >
            <ShieldAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : null}
        <div className="flex flex-col-reverse justify-end gap-2 border-t border-border px-5 py-4 sm:flex-row">
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
