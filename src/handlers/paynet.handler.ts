import type {
  PaynetConfig,
  PaymentStore,
  PaymentCallbacks,
  WebhookHeaders,
  WebhookResult,
  PaynetWebhookRequest,
  PaynetWebhookResponse,
  Transaction,
  Logger,
} from "../types";
import {
  verifyPaynetAuth,
  createPaynetSuccess,
  PaynetErrors,
  PAYNET_STATE,
  mapToPaynetState,
  getTashkentTimestamp,
  getTashkentCheckTimestamp,
} from "../providers/paynet";
import { tiyinToUzs } from "../utils/currency";

/**
 * Handle a Paynet JSON-RPC 2.0 webhook.
 */
export async function handlePaynetWebhook(
  config: PaynetConfig,
  store: PaymentStore,
  callbacks: PaymentCallbacks,
  headers: WebhookHeaders,
  body: unknown,
  logger?: Logger,
): Promise<WebhookResult> {
  // 1. Verify Basic Auth
  if (!verifyPaynetAuth(config.username, config.password, headers.authorization)) {
    return {
      status: 401,
      body: PaynetErrors.accessDenied(0) as unknown as Record<string, unknown>,
    };
  }

  // 2. Validate JSON-RPC structure
  if (!isPaynetRequest(body)) {
    const id = (body as any)?.id;
    return ok(PaynetErrors.invalidRpcRequest(typeof id === "number" ? id : 0));
  }

  const { method, params, id: requestId } = body;

  // 3. Validate serviceId if provided
  if (params.serviceId && String(params.serviceId) !== config.serviceId) {
    return ok(PaynetErrors.serviceNotFound(requestId));
  }

  // 4. Route to method handler — all wrapped in try/catch
  try {
    switch (method) {
      case "GetInformation":
        return ok(await handleGetInformation(config, store, callbacks, requestId, params));
      case "PerformTransaction":
        return ok(await handlePerformTransaction(config, store, callbacks, requestId, params));
      case "CheckTransaction":
        return ok(await handleCheckTransaction(store, requestId, params));
      case "CancelTransaction":
        return ok(await handleCancelTransaction(store, callbacks, requestId, params));
      case "GetStatement":
        return ok(await handleGetStatement(store, requestId, params));
      case "ChangePassword":
        return ok(await handleChangePassword(callbacks, requestId, params));
      default:
        return ok(PaynetErrors.methodNotFound(requestId, method));
    }
  } catch (e) {
    logger?.error?.(`Paynet ${method} error:`, e);
    return ok(PaynetErrors.internalError(requestId));
  }
}

function ok(body: PaynetWebhookResponse): WebhookResult {
  return { status: 200, body: body as unknown as Record<string, unknown> };
}

/** Runtime validation for the webhook body. */
function isPaynetRequest(body: unknown): body is PaynetWebhookRequest {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return typeof b.method === "string" && b.id !== undefined && b.params != null && typeof b.params === "object";
}

// =============================================================================
// GetInformation
// =============================================================================

async function handleGetInformation(
  config: PaynetConfig,
  store: PaymentStore,
  callbacks: PaymentCallbacks,
  requestId: number,
  params: PaynetWebhookRequest["params"]
): Promise<PaynetWebhookResponse> {
  const rawClientId = params.fields?.order_id || params.fields?.client_id;
  if (!rawClientId) return PaynetErrors.missingParams(requestId);

  const clientId = String(rawClientId);

  const transaction = await store.getTransactionByShortId(clientId);
  if (!transaction) return PaynetErrors.clientNotFound(requestId);

  if (transaction.status !== "PENDING") {
    return PaynetErrors.clientNotFound(requestId);
  }

  if (transaction.provider !== "paynet") {
    await store.updateTransaction(transaction.id, { provider: "paynet" });
  }

  const userInfo = callbacks.getUserInfo
    ? await callbacks.getUserInfo(transaction.userId)
    : null;

  // Amount in UZS for display — use Math.round to avoid floor truncation
  const amountInUzs = Math.round(tiyinToUzs(transaction.amount));

  return createPaynetSuccess(requestId, {
    status: "0",
    timestamp: getTashkentTimestamp(),
    fields: {
      name: userInfo?.name || "User",
      ...(userInfo || {}),
      amount: amountInUzs,
    },
  });
}

// =============================================================================
// PerformTransaction
// =============================================================================

async function handlePerformTransaction(
  config: PaynetConfig,
  store: PaymentStore,
  callbacks: PaymentCallbacks,
  requestId: number,
  params: PaynetWebhookRequest["params"]
): Promise<PaynetWebhookResponse> {
  const { transactionId: paynetTrnId, amount, fields } = params;
  const rawClientId = fields?.order_id || fields?.client_id;

  if (!paynetTrnId || !amount || !rawClientId) {
    return PaynetErrors.missingParams(requestId);
  }

  const clientId = String(rawClientId);

  const transaction = await store.getTransactionByShortId(clientId);
  if (!transaction) return PaynetErrors.clientNotFound(requestId);

  if (transaction.provider !== "paynet") {
    await store.updateTransaction(transaction.id, { provider: "paynet" });
  }

  // Validate amount (Paynet sends tiyin in PerformTransaction)
  if (amount !== transaction.amount) {
    return PaynetErrors.invalidAmount(requestId);
  }

  // Idempotency
  if (transaction.status === "COMPLETED") {
    return PaynetErrors.transactionExists(requestId);
  }
  if (transaction.status === "FAILED") {
    return PaynetErrors.transactionCancelled(requestId);
  }

  // Build updated transaction for callback
  const updatedTx: Transaction = {
    ...transaction,
    status: "COMPLETED",
    providerTransactionId: String(paynetTrnId),
  };

  // Grant access FIRST, then persist — if callback fails, provider retries
  await callbacks.onPaymentCompleted(updatedTx);

  await store.updateTransaction(transaction.id, {
    status: "COMPLETED",
    providerTransactionId: String(paynetTrnId),
  });

  return createPaynetSuccess(requestId, {
    providerTrnId: transaction.id,
    timestamp: getTashkentTimestamp(),
    fields: { client_id: clientId },
  });
}

// =============================================================================
// CheckTransaction
// =============================================================================

async function handleCheckTransaction(
  store: PaymentStore,
  requestId: number,
  params: PaynetWebhookRequest["params"]
): Promise<PaynetWebhookResponse> {
  const paynetTrnId = params.transactionId;
  if (!paynetTrnId) return PaynetErrors.missingParams(requestId);

  const transaction = await store.getTransactionByProviderId(
    "paynet",
    String(paynetTrnId)
  );

  if (!transaction) {
    return createPaynetSuccess(requestId, {
      transactionState: PAYNET_STATE.NOT_FOUND,
      timestamp: getTashkentCheckTimestamp(),
      providerTrnId: 0,
    });
  }

  return createPaynetSuccess(requestId, {
    transactionState: mapToPaynetState(transaction.status),
    timestamp: getTashkentCheckTimestamp(),
    providerTrnId: transaction.id,
  });
}

// =============================================================================
// CancelTransaction
// =============================================================================

async function handleCancelTransaction(
  store: PaymentStore,
  callbacks: PaymentCallbacks,
  requestId: number,
  params: PaynetWebhookRequest["params"]
): Promise<PaynetWebhookResponse> {
  const paynetTrnId = params.transactionId;
  if (!paynetTrnId) return PaynetErrors.missingParams(requestId);

  const transaction = await store.getTransactionByProviderId(
    "paynet",
    String(paynetTrnId)
  );
  if (!transaction) return PaynetErrors.transactionNotFound(requestId);

  // Already cancelled
  if (transaction.status === "FAILED") {
    return PaynetErrors.transactionCancelled(requestId);
  }

  // If completed, revoke access FIRST, then persist
  if (transaction.status === "COMPLETED") {
    const updatedTx: Transaction = {
      ...transaction,
      status: "FAILED",
      providerTransactionId: String(paynetTrnId),
    };
    await callbacks.onPaymentCancelled(updatedTx);
  }

  await store.updateTransaction(transaction.id, {
    status: "FAILED",
    providerTransactionId: String(paynetTrnId),
  });

  return createPaynetSuccess(requestId, {
    providerTrnId: transaction.id,
    timestamp: getTashkentTimestamp(),
    transactionState: PAYNET_STATE.CANCELLED,
  });
}

// =============================================================================
// GetStatement
// =============================================================================

async function handleGetStatement(
  store: PaymentStore,
  requestId: number,
  params: PaynetWebhookRequest["params"]
): Promise<PaynetWebhookResponse> {
  const { dateFrom, dateTo } = params;
  if (!dateFrom || !dateTo) return PaynetErrors.invalidDateFormat(requestId);

  const transactions = await store.getTransactionsByDateRange(
    "paynet",
    dateFrom,
    dateTo
  );

  const statements = transactions.map((tx: Transaction) => {
    const amountInUzs = Math.round(tiyinToUzs(tx.amount));

    const date = new Date(tx.updatedAt || tx.createdAt);
    const formattedTimestamp = getTashkentTimestamp(date);

    return {
      amount: amountInUzs,
      providerTrnId: tx.id,
      transactionId: Number(tx.providerTransactionId) || 0,
      timestamp: formattedTimestamp,
    };
  });

  return createPaynetSuccess(requestId, { statements });
}

// =============================================================================
// ChangePassword
// =============================================================================

async function handleChangePassword(
  callbacks: PaymentCallbacks,
  requestId: number,
  params: PaynetWebhookRequest["params"]
): Promise<PaynetWebhookResponse> {
  const { newPassword } = params;
  if (!newPassword) return PaynetErrors.missingParams(requestId);

  if (callbacks.onPasswordChangeRequested) {
    await callbacks.onPasswordChangeRequested(newPassword);
  }

  return createPaynetSuccess(requestId, { result: "success" });
}
