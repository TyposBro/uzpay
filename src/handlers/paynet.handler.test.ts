import { describe, it, expect, vi } from "vitest";
import { handlePaynetWebhook } from "./paynet.handler";
import { createMockStore, createTestTransaction } from "../test-utils";
import type { PaynetConfig, PaymentCallbacks } from "../types";
import { PAYNET_STATE, PAYNET_ERROR } from "../providers/paynet";

const config: PaynetConfig = {
  serviceId: "123456",
  username: "admin",
  password: "secret123",
};

const validAuth = { authorization: `Basic ${btoa("admin:secret123")}` };
const invalidAuth = { authorization: `Basic ${btoa("admin:wrong")}` };

function createCallbacks(overrides: Partial<PaymentCallbacks> = {}): PaymentCallbacks {
  return {
    onPaymentCompleted: vi.fn().mockResolvedValue(undefined),
    onPaymentCancelled: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("Paynet Webhook Handler", () => {
  describe("Authentication", () => {
    it("rejects missing auth with 401", async () => {
      const store = createMockStore();
      const result = await handlePaynetWebhook(config, store, createCallbacks(), {}, {});
      expect(result.status).toBe(401);
      expect((result.body as any).error.code).toBe(PAYNET_ERROR.ACCESS_DENIED);
    });

    it("rejects invalid auth with 401", async () => {
      const store = createMockStore();
      const result = await handlePaynetWebhook(config, store, createCallbacks(), invalidAuth, {
        jsonrpc: "2.0",
        method: "GetInformation",
        id: 1,
        params: {},
      });
      expect(result.status).toBe(401);
    });
  });

  describe("Service ID validation", () => {
    it("rejects wrong serviceId", async () => {
      const store = createMockStore();
      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "GetInformation",
        id: 1,
        params: { serviceId: 999999 },
      });
      expect((result.body as any).error.code).toBe(PAYNET_ERROR.SERVICE_NOT_FOUND);
    });
  });

  describe("GetInformation", () => {
    it("returns user info for valid shortId", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        shortId: "12345",
        status: "PENDING",
      });
      const store = createMockStore([tx]);
      const getUserInfo = vi.fn().mockResolvedValue({ name: "Test User" });

      const result = await handlePaynetWebhook(
        config,
        store,
        createCallbacks({ getUserInfo }),
        validAuth,
        {
          jsonrpc: "2.0",
          method: "GetInformation",
          id: 1,
          params: { fields: { order_id: "12345" } },
        },
      );

      expect(result.status).toBe(200);
      expect((result.body as any).result.status).toBe("0");
      expect((result.body as any).result.fields.name).toBe("Test User");
      expect(getUserInfo).toHaveBeenCalledWith(tx.userId);
    });

    it("supports client_id field name", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        shortId: "12345",
        status: "PENDING",
      });
      const store = createMockStore([tx]);

      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "GetInformation",
        id: 1,
        params: { fields: { client_id: "12345" } },
      });

      expect((result.body as any).result.status).toBe("0");
    });

    it("rejects non-PENDING transaction", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        shortId: "12345",
        status: "COMPLETED",
      });
      const store = createMockStore([tx]);

      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "GetInformation",
        id: 1,
        params: { fields: { order_id: "12345" } },
      });

      expect((result.body as any).error.code).toBe(PAYNET_ERROR.CLIENT_NOT_FOUND);
    });

    it("rejects unknown client", async () => {
      const store = createMockStore();
      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "GetInformation",
        id: 1,
        params: { fields: { order_id: "99999" } },
      });

      expect((result.body as any).error.code).toBe(PAYNET_ERROR.CLIENT_NOT_FOUND);
    });
  });

  describe("PerformTransaction", () => {
    it("completes transaction and calls onPaymentCompleted", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        shortId: "12345",
        status: "PENDING",
      });
      const store = createMockStore([tx]);
      const callbacks = createCallbacks();

      const result = await handlePaynetWebhook(config, store, callbacks, validAuth, {
        jsonrpc: "2.0",
        method: "PerformTransaction",
        id: 1,
        params: {
          transactionId: 777,
          amount: tx.amount,
          fields: { order_id: "12345" },
        },
      });

      expect((result.body as any).result.providerTrnId).toBe(tx.id);
      expect(callbacks.onPaymentCompleted).toHaveBeenCalledTimes(1);

      const updated = await store.getTransactionById(tx.id);
      expect(updated!.status).toBe("COMPLETED");
      expect(updated!.providerTransactionId).toBe("777");
    });

    it("returns TRANSACTION_EXISTS for duplicate", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        shortId: "12345",
        status: "COMPLETED",
      });
      const store = createMockStore([tx]);

      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "PerformTransaction",
        id: 1,
        params: {
          transactionId: 777,
          amount: tx.amount,
          fields: { order_id: "12345" },
        },
      });

      expect((result.body as any).error.code).toBe(PAYNET_ERROR.TRANSACTION_EXISTS);
    });

    it("rejects amount mismatch", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        shortId: "12345",
        status: "PENDING",
      });
      const store = createMockStore([tx]);

      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "PerformTransaction",
        id: 1,
        params: {
          transactionId: 777,
          amount: 999,
          fields: { order_id: "12345" },
        },
      });

      expect((result.body as any).error.code).toBe(PAYNET_ERROR.INVALID_AMOUNT);
    });
  });

  describe("CheckTransaction", () => {
    it("returns correct state for completed transaction", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        status: "COMPLETED",
        providerTransactionId: "777",
      });
      const store = createMockStore([tx]);

      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "CheckTransaction",
        id: 1,
        params: { transactionId: 777 },
      });

      expect((result.body as any).result.transactionState).toBe(PAYNET_STATE.SUCCESS);
    });

    it("returns NOT_FOUND for unknown transaction", async () => {
      const store = createMockStore();
      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "CheckTransaction",
        id: 1,
        params: { transactionId: 999 },
      });

      expect((result.body as any).result.transactionState).toBe(PAYNET_STATE.NOT_FOUND);
    });
  });

  describe("CancelTransaction", () => {
    it("cancels completed transaction and calls onPaymentCancelled", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        status: "COMPLETED",
        providerTransactionId: "777",
      });
      const store = createMockStore([tx]);
      const callbacks = createCallbacks();

      const result = await handlePaynetWebhook(config, store, callbacks, validAuth, {
        jsonrpc: "2.0",
        method: "CancelTransaction",
        id: 1,
        params: { transactionId: 777 },
      });

      expect((result.body as any).result.transactionState).toBe(PAYNET_STATE.CANCELLED);
      expect(callbacks.onPaymentCancelled).toHaveBeenCalledTimes(1);
    });

    it("returns TRANSACTION_CANCELLED for already cancelled", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        status: "FAILED",
        providerTransactionId: "777",
      });
      const store = createMockStore([tx]);

      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "CancelTransaction",
        id: 1,
        params: { transactionId: 777 },
      });

      expect((result.body as any).error.code).toBe(PAYNET_ERROR.TRANSACTION_CANCELLED);
    });
  });

  describe("GetStatement", () => {
    it("returns completed transactions in range", async () => {
      const tx = createTestTransaction({
        provider: "paynet",
        status: "COMPLETED",
        providerTransactionId: "777",
      });
      const store = createMockStore([tx]);

      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "GetStatement",
        id: 1,
        params: { dateFrom: "2025-01-01 00:00:00", dateTo: "2026-12-31 23:59:59" },
      });

      expect((result.body as any).result.statements).toBeDefined();
      expect((result.body as any).result.statements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ChangePassword", () => {
    it("calls onPasswordChangeRequested callback", async () => {
      const store = createMockStore();
      const onPasswordChangeRequested = vi.fn().mockResolvedValue(undefined);

      const result = await handlePaynetWebhook(
        config,
        store,
        createCallbacks({ onPasswordChangeRequested }),
        validAuth,
        {
          jsonrpc: "2.0",
          method: "ChangePassword",
          id: 1,
          params: { newPassword: "new-pass-123" },
        },
      );

      expect((result.body as any).result.result).toBe("success");
      expect(onPasswordChangeRequested).toHaveBeenCalledWith("new-pass-123");
    });
  });

  describe("Unknown method", () => {
    it("returns METHOD_NOT_FOUND", async () => {
      const store = createMockStore();
      const result = await handlePaynetWebhook(config, store, createCallbacks(), validAuth, {
        jsonrpc: "2.0",
        method: "DoSomethingWeird",
        id: 1,
        params: {},
      });
      expect((result.body as any).error.code).toBe(PAYNET_ERROR.METHOD_NOT_FOUND);
    });
  });
});
