import type {
  PaymeConfig,
  PaymentStore,
  PaymentCallbacks,
  WebhookHeaders,
  WebhookResult,
  PaymeWebhookRequest,
  PaymeWebhookResponse,
  Transaction,
  Logger,
} from "../types";
import {
  verifyPaymeAuth,
  createPaymeSuccess,
  PaymeErrors,
  PAYME_STATE,
  mapToPaymeState,
} from "../providers/payme";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Handle a Payme Merchant API webhook.
 * Payme sends JSON-RPC requests to this endpoint.
 *
 * Returns { status, body } - always status 200 for Payme.
 */
export async function handlePaymeWebhook(
  config: PaymeConfig,
  store: PaymentStore,
  callbacks: PaymentCallbacks,
  headers: WebhookHeaders,
  body: unknown,
  logger?: Logger,
): Promise<WebhookResult> {
  // 1. Verify Basic Auth
  if (!verifyPaymeAuth(config.secretKey, headers.authorization)) {
    return ok(PaymeErrors.insufficientPrivileges(0));
  }

  // 2. Validate JSON-RPC structure
  if (!isPaymeRequest(body)) {
    const id = (body as any)?.id;
    return ok(PaymeErrors.invalidJsonRpc(typeof id === "number" ? id : 0));
  }

  const { method, params, id: requestId } = body;

  // 3. Route to method handler — all wrapped in try/catch
  try {
    switch (method) {
      case "CheckPerformTransaction":
        return ok(await handleCheckPerform(store, callbacks, requestId, params));
      case "CreateTransaction":
        return ok(await handleCreate(store, requestId, params));
      case "PerformTransaction":
        return ok(await handlePerform(store, callbacks, requestId, params, logger));
      case "CancelTransaction":
        return ok(await handleCancel(store, callbacks, requestId, params, logger));
      case "CheckTransaction":
        return ok(await handleCheck(store, requestId, params));
      case "GetStatement":
        return ok(await handleGetStatement(store, requestId, params));
      default:
        return ok(PaymeErrors.methodNotFound(requestId, method));
    }
  } catch (e) {
    logger?.error?.(`Payme ${method} error:`, e);
    return ok(PaymeErrors.internalError(requestId));
  }
}

function ok(body: PaymeWebhookResponse): WebhookResult {
  return { status: 200, body: body as unknown as Record<string, unknown> };
}

/** Runtime validation for the webhook body. */
function isPaymeRequest(body: unknown): body is PaymeWebhookRequest {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return typeof b.method === "string" && typeof b.id === "number" && b.params != null && typeof b.params === "object";
}

// =============================================================================
// Shared helper: format a transaction for Payme response
// Eliminates duplication between CheckTransaction and GetStatement
// =============================================================================

function formatPaymeTransaction(tx: Transaction) {
  const createTime =
    tx.providerCreateTime || new Date(tx.createdAt).getTime();

  const performTime =
    tx.providerPerformTime ||
    (tx.status === "COMPLETED"
      ? new Date(tx.updatedAt || tx.createdAt).getTime()
      : 0);

  const cancelTime =
    tx.providerCancelTime ||
    (tx.status === "FAILED"
      ? new Date(tx.updatedAt || tx.createdAt).getTime()
      : 0);

  let state = mapToPaymeState(tx.status, !!tx.providerPerformTime);
  if (tx.status === "FAILED") {
    state = tx.providerPerformTime
      ? PAYME_STATE.CANCELLED_AFTER_COMPLETE
      : PAYME_STATE.CANCELLED_BEFORE_COMPLETE;
  }

  let reason: number | null = null;
  if (state === PAYME_STATE.CANCELLED_AFTER_COMPLETE) reason = 5;
  else if (state === PAYME_STATE.CANCELLED_BEFORE_COMPLETE)
    reason = tx.cancelReason || 3;

  return { createTime, performTime, cancelTime, state, reason };
}

// =============================================================================
// CheckPerformTransaction
// =============================================================================

async function handleCheckPerform(
  store: PaymentStore,
  callbacks: PaymentCallbacks,
  requestId: number,
  params: PaymeWebhookRequest["params"]
): Promise<PaymeWebhookResponse> {
  const orderId = params.account?.order_id;
  const amount = params.amount;

  if (!orderId) return PaymeErrors.orderNotFound(requestId);

  const transaction = await store.getTransactionById(orderId);
  if (!transaction) return PaymeErrors.orderNotFound(requestId);

  if (amount !== transaction.amount) return PaymeErrors.invalidAmount(requestId);

  if (transaction.status === "FAILED") {
    return PaymeErrors.cannotPerformOperation(requestId);
  }

  const detail = callbacks.getFiscalData
    ? await callbacks.getFiscalData(transaction)
    : null;

  return createPaymeSuccess(requestId, {
    allow: true,
    ...(detail && { detail }),
  });
}

// =============================================================================
// CreateTransaction
// =============================================================================

async function handleCreate(
  store: PaymentStore,
  requestId: number,
  params: PaymeWebhookRequest["params"]
): Promise<PaymeWebhookResponse> {
  const { id: paymeTransId, time: paymeTime, amount, account } = params;
  const orderId = account?.order_id;

  if (!orderId || !paymeTransId || !paymeTime || !amount) {
    return PaymeErrors.orderNotFound(requestId);
  }

  const transaction = await store.getTransactionById(orderId);
  if (!transaction) return PaymeErrors.orderNotFound(requestId);

  if (amount !== transaction.amount) return PaymeErrors.invalidAmount(requestId);

  // Idempotency: same Payme transaction
  if (transaction.providerTransactionId === paymeTransId) {
    return createPaymeSuccess(requestId, {
      create_time: paymeTime,
      transaction: transaction.id,
      state: mapToPaymeState(transaction.status, !!transaction.providerPerformTime) || PAYME_STATE.CREATED,
    });
  }

  // Different Payme transaction for same order
  if (transaction.providerTransactionId && transaction.providerTransactionId !== paymeTransId) {
    // 12-hour timeout rule: if the existing preparation expired, allow replacement
    const isExpired =
      transaction.status === "PREPARED" &&
      transaction.providerCreateTime &&
      Date.now() - transaction.providerCreateTime > TWELVE_HOURS_MS;

    if (isExpired) {
      // Cancel the expired transaction and re-prepare with the new Payme ID
      await store.updateTransaction(transaction.id, {
        providerTransactionId: paymeTransId,
        providerCreateTime: paymeTime,
        status: "PREPARED",
      });
      return createPaymeSuccess(requestId, {
        create_time: paymeTime,
        transaction: transaction.id,
        state: PAYME_STATE.CREATED,
      });
    }

    return PaymeErrors.orderAlreadyPaid(requestId);
  }

  if (transaction.status === "COMPLETED" || transaction.status === "FAILED") {
    return PaymeErrors.cannotPerformOperation(requestId);
  }

  // Create: mark as PREPARED with Payme's transaction ID
  await store.updateTransaction(transaction.id, {
    status: "PREPARED",
    providerTransactionId: paymeTransId,
    providerCreateTime: paymeTime,
  });

  return createPaymeSuccess(requestId, {
    create_time: paymeTime,
    transaction: transaction.id,
    state: PAYME_STATE.CREATED,
  });
}

// =============================================================================
// PerformTransaction
// =============================================================================

async function handlePerform(
  store: PaymentStore,
  callbacks: PaymentCallbacks,
  requestId: number,
  params: PaymeWebhookRequest["params"],
  logger?: Logger,
): Promise<PaymeWebhookResponse> {
  const paymeTransId = params.id;
  if (!paymeTransId) return PaymeErrors.transactionNotFound(requestId);

  const transaction = await store.getTransactionByProviderId("payme", paymeTransId);
  if (!transaction) return PaymeErrors.transactionNotFound(requestId);

  // Idempotency: already completed
  if (transaction.status === "COMPLETED") {
    const performTime =
      transaction.providerPerformTime ||
      new Date(transaction.updatedAt || transaction.createdAt).getTime();
    return createPaymeSuccess(requestId, {
      transaction: transaction.id,
      perform_time: performTime,
      state: PAYME_STATE.COMPLETED,
    });
  }

  if (transaction.status === "FAILED") {
    return PaymeErrors.cannotPerformOperation(requestId);
  }

  if (transaction.status !== "PREPARED") {
    return PaymeErrors.cannotPerformOperation(requestId);
  }

  const performTime = Date.now();

  // Build the updated transaction object for the callback
  const updatedTx: Transaction = {
    ...transaction,
    status: "COMPLETED",
    providerTransactionId: paymeTransId,
    providerPerformTime: performTime,
  };

  // Grant access FIRST, then persist — if callback fails, provider retries
  await callbacks.onPaymentCompleted(updatedTx);

  await store.updateTransaction(transaction.id, {
    status: "COMPLETED",
    providerTransactionId: paymeTransId,
    providerPerformTime: performTime,
  });

  return createPaymeSuccess(requestId, {
    transaction: transaction.id,
    perform_time: performTime,
    state: PAYME_STATE.COMPLETED,
  });
}

// =============================================================================
// CancelTransaction
// =============================================================================

async function handleCancel(
  store: PaymentStore,
  callbacks: PaymentCallbacks,
  requestId: number,
  params: PaymeWebhookRequest["params"],
  logger?: Logger,
): Promise<PaymeWebhookResponse> {
  const paymeTransId = params.id;
  const reason = params.reason;
  if (!paymeTransId) return PaymeErrors.transactionNotFound(requestId);

  const transaction = await store.getTransactionByProviderId("payme", paymeTransId);
  if (!transaction) return PaymeErrors.transactionNotFound(requestId);

  // Idempotency: already cancelled
  if (transaction.status === "FAILED") {
    const cancelTime =
      transaction.providerCancelTime ||
      new Date(transaction.updatedAt || transaction.createdAt).getTime();
    const state = transaction.providerPerformTime
      ? PAYME_STATE.CANCELLED_AFTER_COMPLETE
      : PAYME_STATE.CANCELLED_BEFORE_COMPLETE;

    return createPaymeSuccess(requestId, {
      transaction: transaction.id,
      cancel_time: cancelTime,
      state,
    });
  }

  const cancelTime = Date.now();

  let cancelState: number;
  if (transaction.status === "COMPLETED") {
    cancelState = PAYME_STATE.CANCELLED_AFTER_COMPLETE;
    const updatedTx: Transaction = {
      ...transaction,
      status: "FAILED",
      providerCancelTime: cancelTime,
      cancelReason: reason ?? null,
    };
    // Revoke access FIRST, then persist
    await callbacks.onPaymentCancelled(updatedTx);
  } else {
    cancelState = PAYME_STATE.CANCELLED_BEFORE_COMPLETE;
  }

  await store.updateTransaction(transaction.id, {
    status: "FAILED",
    providerTransactionId: paymeTransId,
    providerCancelTime: cancelTime,
    cancelReason: reason,
  });

  return createPaymeSuccess(requestId, {
    transaction: transaction.id,
    cancel_time: cancelTime,
    state: cancelState,
  });
}

// =============================================================================
// CheckTransaction
// =============================================================================

async function handleCheck(
  store: PaymentStore,
  requestId: number,
  params: PaymeWebhookRequest["params"]
): Promise<PaymeWebhookResponse> {
  const paymeTransId = params.id;
  if (!paymeTransId) return PaymeErrors.transactionNotFound(requestId);

  const transaction = await store.getTransactionByProviderId("payme", paymeTransId);
  if (!transaction) return PaymeErrors.transactionNotFound(requestId);

  const { createTime, performTime, cancelTime, state, reason } =
    formatPaymeTransaction(transaction);

  return createPaymeSuccess(requestId, {
    create_time: createTime,
    perform_time: performTime,
    cancel_time: cancelTime,
    transaction: transaction.id,
    state,
    reason,
  });
}

// =============================================================================
// GetStatement
// =============================================================================

async function handleGetStatement(
  store: PaymentStore,
  requestId: number,
  params: PaymeWebhookRequest["params"]
): Promise<PaymeWebhookResponse> {
  const { from, to } = params;
  if (from == null || to == null) return PaymeErrors.invalidJsonRpc(requestId);

  const transactions = await store.getTransactionsByDateRange("payme", from, to);

  const formatted = transactions.map((tx: Transaction) => {
    const { createTime, performTime, cancelTime, state, reason } =
      formatPaymeTransaction(tx);

    return {
      id: tx.providerTransactionId,
      time: createTime,
      amount: tx.amount,
      account: { order_id: tx.id },
      create_time: createTime,
      perform_time: performTime,
      cancel_time: cancelTime,
      transaction: tx.id,
      state,
      reason,
    };
  });

  return createPaymeSuccess(requestId, { transactions: formatted });
}
