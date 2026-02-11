import type {
  UzPayOptions,
  CreatePaymentParams,
  CreatePaymentResult,
  WebhookHeaders,
  WebhookResult,
  PaymentStore,
} from "./types";
import { uzsToTiyin, tiyinToUzs } from "./utils/currency";
import { generatePaymeUrl } from "./providers/payme";
import { generateClickUrl } from "./providers/click";
import { generatePaynetUrl } from "./providers/paynet";
import { handlePaymeWebhook as _handlePaymeWebhook } from "./handlers/payme.handler";
import { handleClickWebhook as _handleClickWebhook } from "./handlers/click.handler";
import { handlePaynetWebhook as _handlePaynetWebhook } from "./handlers/paynet.handler";

export interface UzPay {
  /** Create a payment and get a redirect URL */
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  /** Handle Payme Merchant API webhook (JSON-RPC) */
  handlePaymeWebhook(headers: WebhookHeaders, body: unknown): Promise<WebhookResult>;
  /** Handle Click webhook (prepare/complete) */
  handleClickWebhook(body: unknown): Promise<WebhookResult>;
  /** Handle Paynet webhook (JSON-RPC 2.0) */
  handlePaynetWebhook(headers: WebhookHeaders, body: unknown): Promise<WebhookResult>;
}

/** Generate a unique 5-digit shortId with collision check. */
async function generateUniqueShortId(store: PaymentStore, maxRetries = 10): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const shortId = Math.floor(10000 + Math.random() * 90000).toString();
    const existing = await store.getTransactionByShortId(shortId);
    if (!existing || existing.status === "COMPLETED" || existing.status === "FAILED") {
      return shortId;
    }
  }
  throw new Error("Failed to generate unique shortId after maximum retries");
}

/**
 * Create a uzpay instance with your provider configs, store adapter, and callbacks.
 *
 * ```typescript
 * const pay = createUzPay({
 *   payme: { merchantId: '...', secretKey: '...' },
 *   click: { serviceId: '...', merchantId: '...', merchantUserId: '...', secretKey: '...' },
 *   paynet: { serviceId: '...', username: '...', password: '...' },
 *   store: myDatabaseAdapter,
 *   callbacks: {
 *     onPaymentCompleted: async (tx) => { ... },
 *     onPaymentCancelled: async (tx) => { ... },
 *   },
 * });
 * ```
 */
export function createUzPay(options: UzPayOptions): UzPay {
  const { store, callbacks, logger } = options;

  return {
    async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
      const { provider, userId, planId, amount, returnUrl } = params;

      // Input validation
      if (!userId || typeof userId !== "string") {
        throw new Error("userId is required and must be a string");
      }
      if (!planId || typeof planId !== "string") {
        throw new Error("planId is required and must be a string");
      }
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        throw new Error("amount must be a positive finite number (in UZS)");
      }

      const amountTiyin = uzsToTiyin(amount);

      // Reuse existing pending transaction if one exists
      let transaction = await store.findPendingTransaction(userId, planId);

      if (!transaction) {
        let shortId: string | undefined;
        if (provider === "click" || provider === "paynet") {
          shortId = await generateUniqueShortId(store);
        }

        transaction = await store.createTransaction({
          userId,
          planId,
          provider,
          amount: amountTiyin,
          status: "PENDING",
          shortId,
        });
      } else {
        // Reusing a pending transaction — update provider, amount, and shortId as needed
        const updates: Record<string, unknown> = {};

        if (transaction.provider !== provider) {
          updates.provider = provider;
        }
        if (transaction.amount !== amountTiyin) {
          updates.amount = amountTiyin;
        }
        if ((provider === "click" || provider === "paynet") && !transaction.shortId) {
          updates.shortId = await generateUniqueShortId(store);
        }

        if (Object.keys(updates).length > 0) {
          await store.updateTransaction(transaction.id, updates);
          // Reflect updates locally
          if (updates.provider) transaction.provider = updates.provider as string;
          if (updates.amount) transaction.amount = updates.amount as number;
          if (updates.shortId) transaction.shortId = updates.shortId as string;
        }
      }

      // Generate provider-specific payment URL
      if (provider === "payme") {
        if (!options.payme) throw new Error("Payme config not provided");
        const url = generatePaymeUrl(options.payme, transaction.id, amountTiyin);
        return { transactionId: transaction.id, paymentUrl: url };
      }

      if (provider === "click") {
        if (!options.click) throw new Error("Click config not provided");
        const transParam = transaction.shortId || transaction.id;
        const url = generateClickUrl(
          options.click,
          transParam,
          amount, // Click expects UZS
          returnUrl
        );
        return {
          transactionId: transaction.id,
          paymentUrl: url,
          shortId: transaction.shortId || undefined,
        };
      }

      if (provider === "paynet") {
        if (!options.paynet) throw new Error("Paynet config not provided");
        const clientId = transaction.shortId || transaction.id;
        const amountUzs = Math.round(tiyinToUzs(amountTiyin));
        const url = generatePaynetUrl(options.paynet.serviceId, clientId, amountUzs);
        return {
          transactionId: transaction.id,
          paymentUrl: url,
          shortId: transaction.shortId || undefined,
        };
      }

      throw new Error(`Provider "${provider}" not supported`);
    },

    async handlePaymeWebhook(
      headers: WebhookHeaders,
      body: unknown
    ): Promise<WebhookResult> {
      if (!options.payme) throw new Error("Payme config not provided");
      return _handlePaymeWebhook(options.payme, store, callbacks, headers, body, logger);
    },

    async handleClickWebhook(body: unknown): Promise<WebhookResult> {
      if (!options.click) throw new Error("Click config not provided");
      return _handleClickWebhook(options.click, store, callbacks, body, logger);
    },

    async handlePaynetWebhook(
      headers: WebhookHeaders,
      body: unknown
    ): Promise<WebhookResult> {
      if (!options.paynet) throw new Error("Paynet config not provided");
      return _handlePaynetWebhook(options.paynet, store, callbacks, headers, body, logger);
    },
  };
}

// Re-export everything for tree-shaking and direct imports
export * from "./types";
export * from "./providers/payme";
export * from "./providers/click";
export * from "./providers/paynet";
export * from "./utils/currency";
export * from "./utils/crypto";
export * from "./utils/time";
