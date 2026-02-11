import { describe, it, expect, vi } from "vitest";
import { handlePaymeWebhook } from "./payme.handler";
import { createMockStore, createTestTransaction } from "../test-utils";
import type { PaymeConfig, PaymentCallbacks } from "../types";
import { PAYME_STATE, PAYME_ERROR } from "../providers/payme";

const config: PaymeConfig = {
  merchantId: "test-merchant",
  secretKey: "test-secret",
  testMode: true,
};

const validAuth = { authorization: `Basic ${btoa("Paycom:test-secret")}` };
const invalidAuth = { authorization: `Basic ${btoa("Paycom:wrong")}` };

function createCallbacks(overrides: Partial<PaymentCallbacks> = {}): PaymentCallbacks {
  return {
    onPaymentCompleted: vi.fn().mockResolvedValue(undefined),
    onPaymentCancelled: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("Payme Webhook Handler", () => {
  describe("Authentication", () => {
    it("rejects missing auth", async () => {
      const store = createMockStore();
      const result = await handlePaymeWebhook(config, store, createCallbacks(), {}, {});
      expect(result.status).toBe(200);
      expect((result.body as any).error.code).toBe(PAYME_ERROR.INSUFFICIENT_PRIVILEGES);
    });

    it("rejects invalid auth", async () => {
      const store = createMockStore();
      const result = await handlePaymeWebhook(config, store, createCallbacks(), invalidAuth, {
        method: "CheckPerformTransaction",
        id: 1,
        params: {},
      });
      expect((result.body as any).error.code).toBe(PAYME_ERROR.INSUFFICIENT_PRIVILEGES);
    });
  });

  describe("CheckPerformTransaction", () => {
    it("returns allow:true for valid order", async () => {
      const tx = createTestTransaction();
      const store = createMockStore([tx]);
      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "CheckPerformTransaction",
        id: 1,
        params: { account: { order_id: tx.id }, amount: tx.amount },
      });
      expect(result.status).toBe(200);
      expect((result.body as any).result.allow).toBe(true);
    });

    it("returns error for missing order", async () => {
      const store = createMockStore();
      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "CheckPerformTransaction",
        id: 1,
        params: { account: { order_id: "nonexistent" }, amount: 100 },
      });
      expect((result.body as any).error.code).toBe(PAYME_ERROR.ORDER_NOT_FOUND);
    });

    it("returns error for amount mismatch", async () => {
      const tx = createTestTransaction({ amount: 5000000 });
      const store = createMockStore([tx]);
      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "CheckPerformTransaction",
        id: 1,
        params: { account: { order_id: tx.id }, amount: 999 },
      });
      expect((result.body as any).error.code).toBe(PAYME_ERROR.INVALID_AMOUNT);
    });

    it("calls getFiscalData callback when provided", async () => {
      const tx = createTestTransaction();
      const store = createMockStore([tx]);
      const getFiscalData = vi.fn().mockResolvedValue({
        receipt_type: 0,
        items: [{ title: "Test", price: 5000000, count: 1, code: "123", package_code: "456", vat_percent: 12 }],
      });
      const result = await handlePaymeWebhook(config, store, createCallbacks({ getFiscalData }), validAuth, {
        method: "CheckPerformTransaction",
        id: 1,
        params: { account: { order_id: tx.id }, amount: tx.amount },
      });
      expect(getFiscalData).toHaveBeenCalledWith(tx);
      expect((result.body as any).result.detail).toBeDefined();
    });
  });

  describe("CreateTransaction", () => {
    it("creates transaction (PENDING -> PREPARED)", async () => {
      const tx = createTestTransaction();
      const store = createMockStore([tx]);
      const paymeTransId = "payme-tx-001";
      const paymeTime = Date.now();

      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "CreateTransaction",
        id: 1,
        params: {
          id: paymeTransId,
          time: paymeTime,
          amount: tx.amount,
          account: { order_id: tx.id },
        },
      });

      expect((result.body as any).result.state).toBe(PAYME_STATE.CREATED);
      expect((result.body as any).result.transaction).toBe(tx.id);

      // Verify store was updated
      const updated = await store.getTransactionById(tx.id);
      expect(updated!.status).toBe("PREPARED");
      expect(updated!.providerTransactionId).toBe(paymeTransId);
    });

    it("is idempotent for same Payme transaction", async () => {
      const tx = createTestTransaction({
        status: "PREPARED",
        providerTransactionId: "payme-tx-001",
      });
      const store = createMockStore([tx]);

      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "CreateTransaction",
        id: 1,
        params: {
          id: "payme-tx-001",
          time: Date.now(),
          amount: tx.amount,
          account: { order_id: tx.id },
        },
      });

      expect((result.body as any).result.transaction).toBe(tx.id);
    });

    it("rejects different Payme transaction for same order", async () => {
      const tx = createTestTransaction({
        status: "PREPARED",
        providerTransactionId: "payme-tx-001",
      });
      const store = createMockStore([tx]);

      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "CreateTransaction",
        id: 1,
        params: {
          id: "payme-tx-DIFFERENT",
          time: Date.now(),
          amount: tx.amount,
          account: { order_id: tx.id },
        },
      });

      expect((result.body as any).error.code).toBe(PAYME_ERROR.ORDER_ALREADY_PAID);
    });
  });

  describe("PerformTransaction", () => {
    it("completes transaction and calls onPaymentCompleted", async () => {
      const tx = createTestTransaction({
        status: "PREPARED",
        providerTransactionId: "payme-tx-001",
      });
      const store = createMockStore([tx]);
      const callbacks = createCallbacks();

      const result = await handlePaymeWebhook(config, store, callbacks, validAuth, {
        method: "PerformTransaction",
        id: 1,
        params: { id: "payme-tx-001" },
      });

      expect((result.body as any).result.state).toBe(PAYME_STATE.COMPLETED);
      expect(callbacks.onPaymentCompleted).toHaveBeenCalledTimes(1);

      const updated = await store.getTransactionById(tx.id);
      expect(updated!.status).toBe("COMPLETED");
    });

    it("is idempotent when already completed", async () => {
      const tx = createTestTransaction({
        status: "COMPLETED",
        providerTransactionId: "payme-tx-001",
        providerPerformTime: Date.now(),
      });
      const store = createMockStore([tx]);
      const callbacks = createCallbacks();

      const result = await handlePaymeWebhook(config, store, callbacks, validAuth, {
        method: "PerformTransaction",
        id: 1,
        params: { id: "payme-tx-001" },
      });

      expect((result.body as any).result.state).toBe(PAYME_STATE.COMPLETED);
      expect(callbacks.onPaymentCompleted).not.toHaveBeenCalled();
    });

    it("rejects FAILED transaction", async () => {
      const tx = createTestTransaction({
        status: "FAILED",
        providerTransactionId: "payme-tx-001",
      });
      const store = createMockStore([tx]);

      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "PerformTransaction",
        id: 1,
        params: { id: "payme-tx-001" },
      });

      expect((result.body as any).error.code).toBe(PAYME_ERROR.CANNOT_PERFORM_OPERATION);
    });
  });

  describe("CancelTransaction", () => {
    it("cancels before completion (state = -1)", async () => {
      const tx = createTestTransaction({
        status: "PREPARED",
        providerTransactionId: "payme-tx-001",
      });
      const store = createMockStore([tx]);
      const callbacks = createCallbacks();

      const result = await handlePaymeWebhook(config, store, callbacks, validAuth, {
        method: "CancelTransaction",
        id: 1,
        params: { id: "payme-tx-001", reason: 3 },
      });

      expect((result.body as any).result.state).toBe(PAYME_STATE.CANCELLED_BEFORE_COMPLETE);
      expect(callbacks.onPaymentCancelled).not.toHaveBeenCalled();
    });

    it("cancels after completion (state = -2) and calls onPaymentCancelled", async () => {
      const tx = createTestTransaction({
        status: "COMPLETED",
        providerTransactionId: "payme-tx-001",
        providerPerformTime: Date.now(),
      });
      const store = createMockStore([tx]);
      const callbacks = createCallbacks();

      const result = await handlePaymeWebhook(config, store, callbacks, validAuth, {
        method: "CancelTransaction",
        id: 1,
        params: { id: "payme-tx-001", reason: 5 },
      });

      expect((result.body as any).result.state).toBe(PAYME_STATE.CANCELLED_AFTER_COMPLETE);
      expect(callbacks.onPaymentCancelled).toHaveBeenCalledTimes(1);
    });

    it("is idempotent when already cancelled", async () => {
      const tx = createTestTransaction({
        status: "FAILED",
        providerTransactionId: "payme-tx-001",
        providerCancelTime: Date.now(),
      });
      const store = createMockStore([tx]);

      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "CancelTransaction",
        id: 1,
        params: { id: "payme-tx-001" },
      });

      expect((result.body as any).result.cancel_time).toBeDefined();
    });
  });

  describe("CheckTransaction", () => {
    it("returns correct state for completed transaction", async () => {
      const tx = createTestTransaction({
        status: "COMPLETED",
        providerTransactionId: "payme-tx-001",
        providerCreateTime: 1700000000000,
        providerPerformTime: 1700001000000,
      });
      const store = createMockStore([tx]);

      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "CheckTransaction",
        id: 1,
        params: { id: "payme-tx-001" },
      });

      expect((result.body as any).result.state).toBe(PAYME_STATE.COMPLETED);
      expect((result.body as any).result.create_time).toBe(1700000000000);
      expect((result.body as any).result.perform_time).toBe(1700001000000);
    });
  });

  describe("GetStatement", () => {
    it("returns transactions in date range", async () => {
      const tx1 = createTestTransaction({ status: "COMPLETED", providerTransactionId: "p1" });
      const tx2 = createTestTransaction({ status: "PREPARED", providerTransactionId: "p2" });
      const store = createMockStore([tx1, tx2]);

      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "GetStatement",
        id: 1,
        params: { from: 0, to: Date.now() + 100000 },
      });

      expect((result.body as any).result.transactions).toBeDefined();
      expect((result.body as any).result.transactions.length).toBe(2);
    });
  });

  describe("Unknown method", () => {
    it("returns METHOD_NOT_FOUND", async () => {
      const store = createMockStore();
      const result = await handlePaymeWebhook(config, store, createCallbacks(), validAuth, {
        method: "DoSomethingWeird",
        id: 1,
        params: {},
      });
      expect((result.body as any).error.code).toBe(PAYME_ERROR.METHOD_NOT_FOUND);
    });
  });
});
