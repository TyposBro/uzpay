import type {
  ClickConfig,
  PaymentStore,
  PaymentCallbacks,
  WebhookResult,
  ClickWebhookData,
  Transaction,
  Logger,
} from "../types";
import { verifyClickSignature } from "../providers/click";

/**
 * Handle a Click webhook (both Prepare and Complete).
 * Click uses action=0 for prepare, action=1 for complete.
 */
export async function handleClickWebhook(
  config: ClickConfig,
  store: PaymentStore,
  callbacks: PaymentCallbacks,
  body: unknown,
  logger?: Logger,
): Promise<WebhookResult> {
  // Runtime validation
  if (!isClickRequest(body)) {
    return ok({ error: -8, error_note: "Invalid Request" });
  }

  const data = body as ClickWebhookData;

  // 1. Verify signature
  const isValid = verifyClickSignature(config.secretKey, data);
  if (!isValid) {
    return ok({ error: -1, error_note: "SIGN CHECK FAILED" });
  }

  const {
    action: rawAction,
    merchant_trans_id,
    amount,
    click_trans_id,
    merchant_prepare_id,
    error,
  } = data;
  const action = Number(rawAction);

  try {
    // 2. Find transaction: try by UUID first, then by shortId
    let transaction = await store.getTransactionById(merchant_trans_id);
    if (!transaction) {
      transaction = await store.getTransactionByShortId(merchant_trans_id);
    }
    if (!transaction) {
      return ok({ error: -5, error_note: "User/Transaction does not exist" });
    }

    // 3. External cancellation (Click sent error < 0)
    if (error && error < 0) {
      await store.updateTransaction(transaction.id, {
        status: "FAILED",
        providerTransactionId: click_trans_id.toString(),
      });
      return ok({ error: -9, error_note: "Transaction cancelled" });
    }

    // 4. Amount validation
    // DB stores tiyin (integer), Click sends UZS (float/string)
    const clickAmountTiyin = Math.round(Number(amount) * 100);
    if (Math.abs(clickAmountTiyin - transaction.amount) > 1) {
      return ok({ error: -2, error_note: "Incorrect parameter amount" });
    }

    // 5. PREPARE (action=0)
    if (action === 0) {
      if (transaction.status !== "PENDING") {
        if (transaction.status === "COMPLETED")
          return ok({ error: -4, error_note: "Already paid" });
        if (transaction.status === "FAILED")
          return ok({ error: -9, error_note: "Transaction cancelled" });
      }

      await store.updateTransaction(transaction.id, {
        status: "PREPARED",
        providerTransactionId: click_trans_id.toString(),
      });

      return ok({
        click_trans_id,
        merchant_trans_id,
        merchant_prepare_id: transaction.id,
        error: 0,
        error_note: "Success",
      });
    }

    // 6. COMPLETE (action=1)
    if (action === 1) {
      // Validate prepare ID matches our UUID
      if (merchant_prepare_id !== transaction.id) {
        return ok({
          error: -6,
          error_note: "Transaction does not exist (ID Mismatch)",
        });
      }

      // Idempotency: already completed
      if (transaction.status === "COMPLETED") {
        return ok({
          click_trans_id,
          merchant_trans_id,
          merchant_confirm_id: transaction.id,
          error: 0,
          error_note: "Success",
        });
      }

      if (transaction.status === "FAILED") {
        return ok({ error: -9, error_note: "Transaction cancelled" });
      }

      // Build updated transaction for callback
      const updatedTx: Transaction = {
        ...transaction,
        status: "COMPLETED",
        providerTransactionId: click_trans_id.toString(),
      };

      // Grant access FIRST, then persist — if callback fails, provider retries
      await callbacks.onPaymentCompleted(updatedTx);

      await store.updateTransaction(transaction.id, {
        status: "COMPLETED",
        providerTransactionId: click_trans_id.toString(),
      });

      return ok({
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: transaction.id,
        error: 0,
        error_note: "Success",
      });
    }

    return ok({ error: -3, error_note: "Action not found" });
  } catch (e) {
    logger?.error?.("Click webhook error:", e);
    return ok({ error: -7, error_note: "Internal system error" });
  }
}

function ok(body: Record<string, unknown>): WebhookResult {
  return { status: 200, body };
}

/** Runtime validation for Click webhook body. */
function isClickRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.click_trans_id != null;
}
