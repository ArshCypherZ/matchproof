import {
  ReconciliationResultSchema,
  type Evidence,
  type IncidentBundle,
  type PaymentState,
  type ReconciliationIncidentClass,
  type ReconciliationDiscrepancy,
  type ReconciliationMerchantState,
  type ReconciliationResult,
} from "../domain/schemas";
import type { MerchantOrderRecord } from "../db/merchant-platform-adapter";

type MerchantInput =
  MerchantOrderRecord | readonly MerchantOrderRecord[] | null | undefined;

type ReconciliationOptions = {
  bundle: IncidentBundle;
  merchant?: MerchantInput;
  maxProviderFreshnessMs?: number;
  maxMerchantFreshnessMs?: number;
};

type ProviderObservation = {
  state: PaymentState;
  amount: number | null;
  currency: string | null;
  orderId: string | null;
  evidenceIds: string[];
  occurredAt: number;
  freshness: boolean;
  terminalStates: Set<string>;
  contradictory: boolean;
  chronology: boolean;
  authenticity: boolean;
  identity: boolean;
};

type MerchantObservation = {
  orderId: string;
  paymentId: string | null;
  state: "pending" | "paid" | "fulfilled" | "missing";
  amount: number;
  currency: string;
  occurredAt: number;
  observedAt: number;
  evidenceId?: string;
};

const paymentState = (state: string): PaymentState => {
  const normalized =
    state === "captured"
      ? "captured_verified"
      : state === "authorized"
        ? "authorized_verified"
        : state === "failed"
          ? "failed_verified"
          : state === "refunded"
            ? "refunded_verified"
            : state === "paid"
              ? "paid_verified"
              : state;
  return normalized as PaymentState;
};

const logicalState = (state: PaymentState) => {
  if (
    state === "captured" ||
    state === "captured_verified" ||
    state === "paid" ||
    state === "paid_verified"
  )
    return "paid";
  if (state === "authorized" || state === "authorized_verified")
    return "authorized";
  if (state === "failed" || state === "failed_verified") return "failed";
  if (state === "refunded" || state === "refunded_verified") return "refunded";
  return state;
};

const isPaid = (state: PaymentState) => logicalState(state) === "paid";

function providerObservation(
  bundle: IncidentBundle,
  maxProviderFreshnessMs: number,
): ProviderObservation {
  const entries = bundle.evidence.filter(
    (
      entry,
    ): entry is Extract<
      Evidence,
      {
        kind:
          | "processor_webhook"
          | "provider_payment_fetch"
          | "provider_order_fetch";
      }
    > =>
      entry.kind === "processor_webhook" ||
      entry.kind === "provider_payment_fetch" ||
      entry.kind === "provider_order_fetch",
  );
  const successful = entries.filter(
    (
      entry,
    ): entry is
      | Extract<Evidence, { kind: "processor_webhook" }>
      | (Extract<Evidence, { kind: "provider_payment_fetch" }> & {
          payload: Extract<
            Extract<Evidence, { kind: "provider_payment_fetch" }>["payload"],
            { result: "success" }
          >;
        })
      | (Extract<Evidence, { kind: "provider_order_fetch" }> & {
          payload: Extract<
            Extract<Evidence, { kind: "provider_order_fetch" }>["payload"],
            { result: "success" }
          >;
        }) =>
      entry.kind === "processor_webhook" || entry.payload.result === "success",
  );
  const terminalStates = new Set<string>();
  let chronology = true;
  let freshness = true;
  let authenticity = true;
  let identity = true;
  const observations = successful.map((entry) => {
    const occurredAt = Date.parse(entry.occurred_at);
    const receivedAt = Date.parse(entry.received_at);
    chronology &&= Number.isFinite(occurredAt) && receivedAt >= occurredAt;
    let state: PaymentState;
    let amount: number | null;
    let currency: string | null;
    let orderId: string | null = null;
    if (entry.kind === "processor_webhook") {
      state = paymentState(entry.payload.payment_state);
      amount = entry.payload.amount_minor;
      currency = entry.payload.currency;
      identity &&= entry.payload.payment_id === bundle.payment_id;
      authenticity &&= entry.payload.signature_verified === true;
    } else if (entry.kind === "provider_payment_fetch") {
      state = paymentState(entry.payload.status);
      amount = entry.payload.amount_minor;
      currency = entry.payload.currency;
      orderId = entry.payload.order_id;
      identity &&= entry.payload.payment_id === bundle.payment_id;
      freshness &&= entry.payload.freshness_ms <= maxProviderFreshnessMs;
      if (entry.payload.captured !== (entry.payload.status === "captured"))
        terminalStates.add("provider_status_capture_conflict");
    } else {
      state = paymentState(
        entry.payload.status === "paid"
          ? "paid"
          : entry.payload.status === "attempted"
            ? "pending"
            : entry.payload.status,
      );
      amount = entry.payload.amount_minor;
      currency = entry.payload.currency;
      orderId = entry.payload.order_id;
      freshness &&= entry.payload.freshness_ms <= maxProviderFreshnessMs;
    }
    const logical = logicalState(state);
    if (["paid", "authorized", "failed", "refunded"].includes(logical))
      terminalStates.add(logical);
    return { entry, state, amount, currency, orderId, occurredAt };
  });
  const contradictory =
    terminalStates.has("provider_status_capture_conflict") ||
    (terminalStates.has("paid") && terminalStates.has("failed"));
  observations.sort(
    (a, b) =>
      a.occurredAt - b.occurredAt ||
      (a.entry.kind === "processor_webhook" ? 0 : 1) -
        (b.entry.kind === "processor_webhook" ? 0 : 1) ||
      a.entry.evidence_id.localeCompare(b.entry.evidence_id),
  );
  const latest = observations.at(-1);
  if (!latest) {
    const hasReadError = entries.some(
      (entry) =>
        entry.kind !== "processor_webhook" && entry.payload.result === "error",
    );
    return {
      state: "unknown",
      amount: null,
      currency: null,
      orderId: null,
      evidenceIds: entries.map((entry) => entry.evidence_id),
      occurredAt: 0,
      freshness: !hasReadError,
      terminalStates,
      contradictory,
      chronology,
      authenticity,
      identity,
    };
  }
  return {
    state: latest.state,
    amount: latest.amount,
    currency: latest.currency,
    orderId: latest.orderId,
    evidenceIds: entries.map((entry) => entry.evidence_id),
    occurredAt: latest.occurredAt,
    freshness,
    terminalStates,
    contradictory,
    chronology,
    authenticity,
    identity,
  };
}

function merchantObservations(
  bundle: IncidentBundle,
  merchant: MerchantInput,
): MerchantObservation[] {
  const fromBundle = bundle.evidence.flatMap((entry) => {
    if (entry.kind !== "merchant_order_state") return [];
    return [
      {
        orderId: entry.payload.order_id,
        paymentId: entry.payload.payment_id,
        state: entry.payload.order_state,
        amount: entry.payload.amount_minor,
        currency: entry.payload.currency,
        occurredAt: Date.parse(entry.occurred_at),
        observedAt: Date.parse(entry.received_at),
        evidenceId: entry.evidence_id,
      } satisfies MerchantObservation,
    ];
  });
  const supplied = merchant
    ? (Array.isArray(merchant) ? merchant : [merchant]).map((order) => ({
        orderId: order.order_id,
        paymentId: order.payment_id,
        state: order.state,
        amount: order.amount_minor,
        currency: order.currency,
        occurredAt: Date.parse(order.updated_at),
        observedAt: Date.parse(order.observed_at),
      }))
    : [];
  const byOrderPayment = new Map<string, MerchantObservation>();
  for (const observation of [...fromBundle, ...supplied]) {
    const key = `${observation.orderId}:${observation.paymentId ?? "none"}`;
    const existing = byOrderPayment.get(key);
    if (
      !existing ||
      observation.occurredAt > existing.occurredAt ||
      (observation.occurredAt === existing.occurredAt &&
        observation.observedAt >= existing.observedAt)
    )
      byOrderPayment.set(key, observation);
  }
  return [...byOrderPayment.values()].sort(
    (a, b) =>
      a.orderId.localeCompare(b.orderId) ||
      (a.paymentId ?? "").localeCompare(b.paymentId ?? ""),
  );
}

function incidentClass(
  bundle: IncidentBundle,
  provider: ProviderObservation,
  orders: MerchantObservation[],
): ReconciliationIncidentClass {
  const deliveryFailure = bundle.evidence.some(
    (entry) =>
      entry.kind === "webhook_delivery" &&
      entry.payload.delivery_status !== "received",
  );
  const callbackMissing = bundle.evidence.some(
    (entry) =>
      entry.kind === "callback_observation" &&
      entry.payload.callback_status === "missing",
  );
  const captureTimeout = bundle.evidence.some(
    (entry) =>
      entry.kind === "processor_timeout" &&
      entry.payload.operation === "capture",
  );
  const settlementFailure = bundle.evidence.some(
    (entry) =>
      entry.kind === "settlement_observation" &&
      entry.payload.settlement_status !== "settled",
  );
  const orderIds = new Set(orders.map((order) => order.orderId));
  const matchingPaidOrder = orders.some(
    (order) =>
      ["paid", "fulfilled"].includes(order.state) &&
      order.amount === provider.amount &&
      order.currency === provider.currency,
  );
  if (orderIds.size > 1) return "one_payment_two_orders";
  if (settlementFailure && isPaid(provider.state) && matchingPaidOrder)
    return "settlement_exception";
  if (deliveryFailure) return "webhook_delivery_failure";
  if (captureTimeout) return "capture_timeout";
  if (callbackMissing && isPaid(provider.state))
    return "callback_missing_webhook_recovers";
  if (
    isPaid(provider.state) &&
    orders.some((order) => order.state === "pending")
  )
    return "paid_pending";
  if (logicalState(provider.state) === "authorized") return "late_authorized";
  if (
    isPaid(provider.state) &&
    (orders.length === 0 || orders.every((order) => order.state === "missing"))
  )
    return "paid_missing";
  return "none";
}

function resolveInput(
  input: IncidentBundle | ReconciliationOptions,
  merchant?: MerchantInput,
) {
  if ("bundle" in input)
    return {
      bundle: input.bundle,
      merchant: input.merchant,
      maxProviderFreshnessMs: input.maxProviderFreshnessMs ?? 300_000,
      maxMerchantFreshnessMs: input.maxMerchantFreshnessMs ?? 300_000,
    };
  return {
    bundle: input,
    merchant,
    maxProviderFreshnessMs: 300_000,
    maxMerchantFreshnessMs: 300_000,
  };
}

export function reconcile(
  input: IncidentBundle | ReconciliationOptions,
  merchant?: MerchantInput,
): ReconciliationResult {
  const resolved = resolveInput(input, merchant);
  const bundle = resolved.bundle;
  const provider = providerObservation(bundle, resolved.maxProviderFreshnessMs);
  const orders = merchantObservations(bundle, resolved.merchant);
  const latestInternal = bundle.evidence
    .filter(
      (entry): entry is Extract<Evidence, { kind: "internal_state" }> =>
        entry.kind === "internal_state",
    )
    .sort(
      (a, b) =>
        Date.parse(a.occurred_at) - Date.parse(b.occurred_at) ||
        a.evidence_id.localeCompare(b.evidence_id),
    )
    .at(-1);
  const internalAmount = latestInternal?.payload.amount_minor ?? null;
  const internalCurrency = latestInternal?.payload.currency ?? null;
  const internalIdentity =
    latestInternal === undefined ||
    latestInternal.payload.payment_id === bundle.payment_id;
  const orderIds = [...new Set(orders.map((order) => order.orderId))];
  const paymentIds = [
    ...new Set(
      orders
        .map((order) => order.paymentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const matchingOrders = orders.filter(
    (order) =>
      order.paymentId === bundle.payment_id || order.paymentId === null,
  );
  const wrongIdentity = orders.some(
    (order) =>
      order.paymentId !== null && order.paymentId !== bundle.payment_id,
  );
  const merchantAmounts = [
    ...orders.map((order) => order.amount),
    ...(internalAmount === null ? [] : [internalAmount]),
  ];
  const merchantCurrencies = [
    ...orders.map((order) => order.currency),
    ...(internalCurrency === null ? [] : [internalCurrency]),
  ];
  const amount =
    provider.amount === null || merchantAmounts.length === 0
      ? true
      : merchantAmounts.every((value) => value === provider.amount);
  const currency =
    provider.currency === null || merchantCurrencies.length === 0
      ? true
      : merchantCurrencies.every((value) => value === provider.currency);
  const order =
    !provider.orderId || orderIds.length === 0
      ? true
      : orderIds.length === 1 && orderIds[0] === provider.orderId;
  const paymentsByOrder = new Map<string, Set<string>>();
  for (const entry of orders) {
    const ids = paymentsByOrder.get(entry.orderId) ?? new Set<string>();
    if (entry.paymentId) ids.add(entry.paymentId);
    paymentsByOrder.set(entry.orderId, ids);
  }
  const multiplePaymentsForOrder = [...paymentsByOrder.values()].some(
    (ids) => ids.size > 1,
  );
  const referenceTime = Math.max(
    ...bundle.evidence.map((entry) => Date.parse(entry.received_at)),
    ...orders.map((entry) => entry.observedAt),
  );
  const chronology =
    provider.chronology &&
    orders.every(
      (entry) =>
        Number.isFinite(entry.occurredAt) &&
        Number.isFinite(entry.observedAt) &&
        entry.observedAt >= entry.occurredAt,
    );
  const freshness =
    provider.freshness &&
    orders.every(
      (entry) =>
        entry.observedAt >= entry.occurredAt &&
        referenceTime - entry.observedAt <= resolved.maxMerchantFreshnessMs,
    );
  const identity = !wrongIdentity && matchingOrders.length === orders.length;
  const combinedIdentity = identity && internalIdentity && provider.identity;
  const uniqueness = !multiplePaymentsForOrder && orderIds.length <= 1;
  const idempotency = bundle.evidence.every((entry) => {
    const payload = entry.payload;
    return !(
      "idempotency_key" in payload &&
      payload.idempotency_key !== bundle.idempotency_key
    );
  });
  const authenticity = provider.authenticity;
  const providerLogical = logicalState(provider.state);
  const merchantState: ReconciliationMerchantState =
    orderIds.length > 1
      ? "multiple"
      : (orders[0]?.state ??
        (latestInternal
          ? ["captured", "captured_verified", "paid", "paid_verified"].includes(
              latestInternal.payload.payment_state,
            )
            ? "paid"
            : "pending"
          : "missing"));
  const status =
    providerLogical === "paid" &&
    (merchantState === "paid" || merchantState === "fulfilled") &&
    amount &&
    currency &&
    identity
      ? "agreed"
      : provider.state === "unknown" || provider.contradictory
        ? "ambiguous"
        : "discrepancy";
  const incident = incidentClass(bundle, provider, orders);
  const discrepancies: ReconciliationDiscrepancy[] = [];
  const ambiguityReasons: string[] = [];
  if (provider.state === "unknown") {
    discrepancies.push("capture_outcome_unknown");
    ambiguityReasons.push("provider outcome is unknown");
  }
  if (provider.contradictory) {
    discrepancies.push("contradictory_provider_state");
    ambiguityReasons.push("provider evidence contains contradictory outcomes");
  }
  if (!amount) discrepancies.push("amount_mismatch");
  if (!currency) discrepancies.push("currency_mismatch");
  if (!combinedIdentity) discrepancies.push("payment_identity_mismatch");
  if (!order) discrepancies.push("order_mapping_mismatch");
  if (orderIds.length > 1) discrepancies.push("one_payment_two_orders");
  if (multiplePaymentsForOrder)
    discrepancies.push("multiple_payments_one_order");
  if (!uniqueness) {
    ambiguityReasons.push("payment/order mapping is not unique");
  }
  if (!chronology) {
    discrepancies.push("invalid_chronology");
    ambiguityReasons.push("evidence chronology is invalid or ambiguous");
  }
  if (!freshness) {
    discrepancies.push("stale_evidence");
    ambiguityReasons.push(
      "merchant or provider observation freshness is invalid",
    );
  }
  if (!idempotency) {
    discrepancies.push("idempotency_mismatch");
    ambiguityReasons.push("evidence idempotency identity conflicts");
  }
  if (!authenticity) {
    discrepancies.push("unverified_provider");
    ambiguityReasons.push("provider authenticity is not verified");
  }
  if (
    providerLogical === "failed" &&
    ["paid", "fulfilled"].includes(merchantState)
  ) {
    discrepancies.push("provider_failed_merchant_fulfilled");
    ambiguityReasons.push(
      "merchant order is paid or fulfilled while provider failed",
    );
  }
  if (incident === "settlement_exception") {
    discrepancies.push("settlement_mismatch");
    ambiguityReasons.push(
      "settlement reconciliation is outside this resolution scope",
    );
  }
  if (incident === "callback_missing_webhook_recovers")
    discrepancies.push("callback_missing");
  if (incident === "webhook_delivery_failure")
    discrepancies.push("webhook_delivery_failure");
  if (incident === "late_authorized") discrepancies.push("late_authorized");
  if (isPaid(provider.state) && merchantState === "pending")
    discrepancies.push("provider_paid_merchant_pending");
  if (isPaid(provider.state) && merchantState === "missing")
    discrepancies.push("provider_paid_merchant_missing");
  const safeInvariants =
    amount &&
    currency &&
    combinedIdentity &&
    order &&
    chronology &&
    freshness &&
    uniqueness &&
    idempotency &&
    authenticity &&
    !provider.contradictory;
  let resolution: ReconciliationResult["resolution"] = "escalate";
  let targetOrderId: string | null = null;
  let targetState: "paid" | null = null;
  if (incident === "settlement_exception") {
    resolution = "escalate";
  } else if (status === "agreed" && safeInvariants) {
    resolution = "no_action_required";
  } else if (
    safeInvariants &&
    isPaid(provider.state) &&
    orders.length === 1 &&
    orders[0]?.state === "pending" &&
    orders[0].amount === provider.amount &&
    orders[0].currency === provider.currency
  ) {
    resolution = "reconcile_internal_state";
    targetOrderId = orders[0].orderId;
    targetState = "paid";
  } else if (
    safeInvariants &&
    isPaid(provider.state) &&
    orders.length === 0 &&
    latestInternal !== undefined &&
    merchantState === "pending"
  ) {
    resolution = "reconcile_internal_state";
  } else if (
    safeInvariants &&
    logicalState(provider.state) === "authorized" &&
    (latestInternal !== undefined || orders.length === 0)
  ) {
    resolution = "reconcile_internal_state";
  } else if (providerLogical === "authorized") {
    ambiguityReasons.push(
      "authorization does not authorize capture or fulfilment",
    );
  } else if (incident === "paid_missing") {
    ambiguityReasons.push("no unique merchant order context exists");
  }
  const allEvidenceIds = [
    ...new Set([
      ...bundle.evidence.map((entry) => entry.evidence_id),
      ...provider.evidenceIds,
    ]),
  ];
  return ReconciliationResultSchema.parse({
    incident_class: incident,
    status,
    provider_state: provider.state,
    provider_amount_minor: provider.amount,
    provider_currency: provider.currency,
    provider_order_id: provider.orderId,
    provider_evidence_ids: provider.evidenceIds,
    merchant_state: merchantState,
    merchant_order_ids: orderIds,
    merchant_payment_ids: paymentIds,
    discrepancy: discrepancies[0] ?? null,
    discrepancies,
    invariant_results: {
      identity: combinedIdentity,
      amount,
      currency,
      order,
      status: status === "agreed",
      chronology,
      freshness,
      uniqueness,
      idempotency,
      authenticity,
    },
    ambiguity_reasons: [...new Set(ambiguityReasons)],
    rule_based_resolution: resolution !== "escalate",
    resolution,
    target_order_id: targetOrderId,
    target_state: targetState,
    evidence_ids: allEvidenceIds,
  });
}

export type { MerchantInput, ReconciliationOptions };
