/**
 * Cloudflare D1 store adapter for uzpay.
 *
 * Usage:
 *   import { createD1Store } from './d1.store';
 *   const store = createD1Store(env.DB);
 */

import type {
  PaymentStore,
  Transaction,
  CreateTransactionInput,
  UpdateTransactionFields,
} from "uzpay";

export function createD1Store(db: D1Database): PaymentStore {
  return {
    async createTransaction(data: CreateTransactionInput): Promise<Transaction> {
      const id = crypto.randomUUID();
      const result = await db
        .prepare(
          `INSERT INTO payment_transactions
           (id, userId, planId, provider, amount, status, shortId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
           RETURNING *`
        )
        .bind(
          id,
          data.userId,
          data.planId,
          data.provider,
          data.amount,
          data.status,
          data.shortId ?? null
        )
        .first();
      return result as unknown as Transaction;
    },

    async getTransactionById(id: string): Promise<Transaction | null> {
      const result = await db
        .prepare("SELECT * FROM payment_transactions WHERE id = ?")
        .bind(id)
        .first();
      return (result as unknown as Transaction) ?? null;
    },

    async getTransactionByShortId(shortId: string): Promise<Transaction | null> {
      const result = await db
        .prepare("SELECT * FROM payment_transactions WHERE shortId = ?")
        .bind(shortId)
        .first();
      return (result as unknown as Transaction) ?? null;
    },

    async getTransactionByProviderId(
      provider: string,
      providerTransactionId: string
    ): Promise<Transaction | null> {
      const result = await db
        .prepare(
          "SELECT * FROM payment_transactions WHERE provider = ? AND providerTransactionId = ?"
        )
        .bind(provider, providerTransactionId)
        .first();
      return (result as unknown as Transaction) ?? null;
    },

    async updateTransaction(
      id: string,
      fields: UpdateTransactionFields
    ): Promise<void> {
      const sets: string[] = [];
      const values: unknown[] = [];

      const fieldMap: Record<string, string> = {
        status: "status",
        providerTransactionId: "providerTransactionId",
        providerCreateTime: "providerCreateTime",
        providerPerformTime: "providerPerformTime",
        providerCancelTime: "providerCancelTime",
        cancelReason: "cancelReason",
        provider: "provider",
        amount: "amount",
        shortId: "shortId",
      };

      for (const [key, column] of Object.entries(fieldMap)) {
        const value = (fields as Record<string, unknown>)[key];
        if (value !== undefined) {
          sets.push(`${column} = ?`);
          values.push(value);
        }
      }

      if (sets.length === 0) return;

      sets.push("updatedAt = datetime('now')");
      values.push(id);

      await db
        .prepare(
          `UPDATE payment_transactions SET ${sets.join(", ")} WHERE id = ?`
        )
        .bind(...values)
        .run();
    },

    async findPendingTransaction(
      userId: string,
      planId: string
    ): Promise<Transaction | null> {
      const result = await db
        .prepare(
          "SELECT * FROM payment_transactions WHERE userId = ? AND planId = ? AND status = 'PENDING' LIMIT 1"
        )
        .bind(userId, planId)
        .first();
      return (result as unknown as Transaction) ?? null;
    },

    async getTransactionsByDateRange(
      provider: string,
      from: number | string,
      to: number | string
    ): Promise<Transaction[]> {
      // For Payme: from/to are ms timestamps, match against providerCreateTime or createdAt
      // For Paynet: from/to are date strings, match against createdAt
      if (typeof from === "number") {
        // Payme style: timestamps in milliseconds
        const result = await db
          .prepare(
            `SELECT * FROM payment_transactions
             WHERE provider = ?
             AND status IN ('PREPARED', 'COMPLETED', 'FAILED')
             AND COALESCE(providerCreateTime, strftime('%s', createdAt) * 1000) >= ?
             AND COALESCE(providerCreateTime, strftime('%s', createdAt) * 1000) <= ?
             ORDER BY COALESCE(providerCreateTime, strftime('%s', createdAt) * 1000) ASC`
          )
          .bind(provider, from, to)
          .all();
        return ((result.results as unknown as Transaction[]) ?? []);
      }

      // Paynet style: date strings
      const result = await db
        .prepare(
          `SELECT * FROM payment_transactions
           WHERE provider = ?
           AND status = 'COMPLETED'
           AND createdAt >= ?
           AND createdAt <= ?
           ORDER BY createdAt ASC`
        )
        .bind(provider, from, to)
        .all();
      return ((result.results as unknown as Transaction[]) ?? []);
    },
  };
}
