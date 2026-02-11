import { describe, it, expect, vi } from "vitest";
import { handleClickWebhook } from "./click.handler";
import { createMockStore, createTestTransaction } from "../test-utils";
import { md5 } from "../utils/crypto";
import type { ClickConfig, PaymentCallbacks, ClickWebhookData } from "../types";

const config: ClickConfig = {
  serviceId: "80012",
  merchantId: "44439",
  merchantUserId: "61733",
  secretKey: "test-secret",
};

function createCallbacks(): PaymentCallbacks {
  return {
    onPaymentCompleted: vi.fn().mockResolvedValue(undefined),
    onPaymentCancelled: vi.fn().mockResolvedValue(undefined),
  };
}

async function signClickData(
  secretKey: string,
  data: Partial<ClickWebhookData>
): Promise<string> {
  const action = Number(data.action);
  const prepareIdPart = action === 1 ? data.merchant_prepare_id || "" : "";
  const source = `${data.click_trans_id}${data.service_id}${secretKey}${data.merchant_trans_id}${prepareIdPart}${data.amount}${data.action}${data.sign_time}`;
  return md5(source);
}

describe("Click Webhook Handler", () => {
  describe("Validation", () => {
    it("rejects empty body", async () => {
      const store = createMockStore();
      const result = await handleClickWebhook(config, store, createCallbacks(), {});
      expect(result.body.error).toBe(-8);
    });

    it("rejects invalid signature", async () => {
      const tx = createTestTransaction({ provider: "click" });
      const store = createMockStore([tx]);

      const result = await handleClickWebhook(config, store, createCallbacks(), {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: tx.id,
        amount: 50000,
        action: 0,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "invalid-hash",
      });

      expect(result.body.error).toBe(-1);
    });
  });

  describe("Prepare (action=0)", () => {
    it("prepares a PENDING transaction", async () => {
      const tx = createTestTransaction({ provider: "click" });
      const store = createMockStore([tx]);

      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: tx.id,
        amount: 50000, // 5,000,000 tiyin / 100 = 50000 UZS
        action: 0,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };
      data.sign_string = await signClickData(config.secretKey, data);

      const result = await handleClickWebhook(config, store, createCallbacks(), data);

      expect(result.body.error).toBe(0);
      expect(result.body.merchant_prepare_id).toBe(tx.id);

      const updated = await store.getTransactionById(tx.id);
      expect(updated!.status).toBe("PREPARED");
    });

    it("rejects already paid transaction", async () => {
      const tx = createTestTransaction({ provider: "click", status: "COMPLETED" });
      const store = createMockStore([tx]);

      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: tx.id,
        amount: 50000,
        action: 0,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };
      data.sign_string = await signClickData(config.secretKey, data);

      const result = await handleClickWebhook(config, store, createCallbacks(), data);
      expect(result.body.error).toBe(-4);
    });

    it("falls back to shortId lookup", async () => {
      const tx = createTestTransaction({ provider: "click", shortId: "12345" });
      const store = createMockStore([tx]);

      const data: ClickWebhookData = {
        click_trans_id: 99,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: "12345", // Using shortId instead of UUID
        amount: 50000,
        action: 0,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };
      data.sign_string = await signClickData(config.secretKey, data);

      const result = await handleClickWebhook(config, store, createCallbacks(), data);
      expect(result.body.error).toBe(0);
    });

    it("rejects transaction not found", async () => {
      const store = createMockStore();

      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: "nonexistent",
        amount: 50000,
        action: 0,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };
      data.sign_string = await signClickData(config.secretKey, data);

      const result = await handleClickWebhook(config, store, createCallbacks(), data);
      expect(result.body.error).toBe(-5);
    });

    it("rejects amount mismatch", async () => {
      const tx = createTestTransaction({ provider: "click", amount: 5000000 });
      const store = createMockStore([tx]);

      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: tx.id,
        amount: 99999, // Wrong amount
        action: 0,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };
      data.sign_string = await signClickData(config.secretKey, data);

      const result = await handleClickWebhook(config, store, createCallbacks(), data);
      expect(result.body.error).toBe(-2);
    });
  });

  describe("Complete (action=1)", () => {
    it("completes transaction and calls onPaymentCompleted", async () => {
      const tx = createTestTransaction({
        provider: "click",
        status: "PREPARED",
        providerTransactionId: "12345",
      });
      const store = createMockStore([tx]);
      const callbacks = createCallbacks();

      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: tx.id,
        merchant_prepare_id: tx.id,
        amount: 50000,
        action: 1,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };
      data.sign_string = await signClickData(config.secretKey, data);

      const result = await handleClickWebhook(config, store, callbacks, data);

      expect(result.body.error).toBe(0);
      expect(callbacks.onPaymentCompleted).toHaveBeenCalledTimes(1);

      const updated = await store.getTransactionById(tx.id);
      expect(updated!.status).toBe("COMPLETED");
    });

    it("rejects ID mismatch", async () => {
      const tx = createTestTransaction({
        provider: "click",
        status: "PREPARED",
        providerTransactionId: "12345",
      });
      const store = createMockStore([tx]);

      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: tx.id,
        merchant_prepare_id: "wrong-id", // Mismatch
        amount: 50000,
        action: 1,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };
      data.sign_string = await signClickData(config.secretKey, data);

      const result = await handleClickWebhook(config, store, createCallbacks(), data);
      expect(result.body.error).toBe(-6);
    });

    it("is idempotent when already completed", async () => {
      const tx = createTestTransaction({
        provider: "click",
        status: "COMPLETED",
        providerTransactionId: "12345",
      });
      const store = createMockStore([tx]);

      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: tx.id,
        merchant_prepare_id: tx.id,
        amount: 50000,
        action: 1,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };
      data.sign_string = await signClickData(config.secretKey, data);

      const result = await handleClickWebhook(config, store, createCallbacks(), data);
      expect(result.body.error).toBe(0);
    });
  });

  describe("External cancellation", () => {
    it("marks transaction as FAILED when error < 0", async () => {
      const tx = createTestTransaction({ provider: "click" });
      const store = createMockStore([tx]);

      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: tx.id,
        amount: 50000,
        action: 0,
        error: -1,
        error_note: "User cancelled",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };
      data.sign_string = await signClickData(config.secretKey, data);

      const result = await handleClickWebhook(config, store, createCallbacks(), data);
      expect(result.body.error).toBe(-9);

      const updated = await store.getTransactionById(tx.id);
      expect(updated!.status).toBe("FAILED");
    });
  });
});
