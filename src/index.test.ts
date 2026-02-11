import { describe, it, expect, vi } from "vitest";
import { createUzPay } from "./index";
import { createMockStore } from "./test-utils";
import type { PaymentCallbacks } from "./types";

const callbacks: PaymentCallbacks = {
  onPaymentCompleted: vi.fn().mockResolvedValue(undefined),
  onPaymentCancelled: vi.fn().mockResolvedValue(undefined),
};

describe("createUzPay", () => {
  describe("createPayment", () => {
    it("creates Payme payment with checkout URL", async () => {
      const store = createMockStore();
      const pay = createUzPay({
        payme: { merchantId: "test-id", secretKey: "secret", testMode: true },
        store,
        callbacks,
      });

      const result = await pay.createPayment({
        provider: "payme",
        userId: "user-1",
        planId: "premium",
        amount: 50000, // 50,000 UZS
      });

      expect(result.transactionId).toBeDefined();
      expect(result.paymentUrl).toContain("https://checkout.test.paycom.uz/");
      expect(result.shortId).toBeUndefined();
    });

    it("creates Click payment with checkout URL and shortId", async () => {
      const store = createMockStore();
      const pay = createUzPay({
        click: {
          serviceId: "80012",
          merchantId: "44439",
          merchantUserId: "61733",
          secretKey: "secret",
        },
        store,
        callbacks,
      });

      const result = await pay.createPayment({
        provider: "click",
        userId: "user-1",
        planId: "premium",
        amount: 50000,
      });

      expect(result.transactionId).toBeDefined();
      expect(result.paymentUrl).toContain("https://my.click.uz/services/pay");
      expect(result.shortId).toBeDefined();
      expect(result.shortId!.length).toBe(5);
    });

    it("creates Paynet payment with deep link and shortId", async () => {
      const store = createMockStore();
      const pay = createUzPay({
        paynet: { serviceId: "123456", username: "admin", password: "pass" },
        store,
        callbacks,
      });

      const result = await pay.createPayment({
        provider: "paynet",
        userId: "user-1",
        planId: "premium",
        amount: 50000,
      });

      expect(result.transactionId).toBeDefined();
      expect(result.paymentUrl).toContain("https://app.paynet.uz/");
      expect(result.paymentUrl).toContain("m=123456");
      expect(result.shortId).toBeDefined();
    });

    it("reuses existing pending transaction", async () => {
      const store = createMockStore();
      const pay = createUzPay({
        payme: { merchantId: "test-id", secretKey: "secret" },
        store,
        callbacks,
      });

      const first = await pay.createPayment({
        provider: "payme",
        userId: "user-1",
        planId: "premium",
        amount: 50000,
      });

      const second = await pay.createPayment({
        provider: "payme",
        userId: "user-1",
        planId: "premium",
        amount: 50000,
      });

      expect(first.transactionId).toBe(second.transactionId);
    });

    it("throws when provider config is missing", async () => {
      const store = createMockStore();
      const pay = createUzPay({ store, callbacks });

      await expect(
        pay.createPayment({
          provider: "payme",
          userId: "user-1",
          planId: "premium",
          amount: 50000,
        }),
      ).rejects.toThrow("Payme config not provided");
    });

    it("throws for unsupported provider", async () => {
      const store = createMockStore();
      const pay = createUzPay({ store, callbacks });

      await expect(
        pay.createPayment({
          provider: "stripe" as any,
          userId: "user-1",
          planId: "premium",
          amount: 50000,
        }),
      ).rejects.toThrow('Provider "stripe" not supported');
    });

    it("throws for invalid amount (zero)", async () => {
      const store = createMockStore();
      const pay = createUzPay({
        payme: { merchantId: "test-id", secretKey: "secret" },
        store,
        callbacks,
      });

      await expect(
        pay.createPayment({
          provider: "payme",
          userId: "user-1",
          planId: "premium",
          amount: 0,
        }),
      ).rejects.toThrow("amount must be a positive finite number");
    });

    it("throws for negative amount", async () => {
      const store = createMockStore();
      const pay = createUzPay({
        payme: { merchantId: "test-id", secretKey: "secret" },
        store,
        callbacks,
      });

      await expect(
        pay.createPayment({
          provider: "payme",
          userId: "user-1",
          planId: "premium",
          amount: -100,
        }),
      ).rejects.toThrow("amount must be a positive finite number");
    });

    it("throws for empty userId", async () => {
      const store = createMockStore();
      const pay = createUzPay({
        payme: { merchantId: "test-id", secretKey: "secret" },
        store,
        callbacks,
      });

      await expect(
        pay.createPayment({
          provider: "payme",
          userId: "",
          planId: "premium",
          amount: 50000,
        }),
      ).rejects.toThrow("userId is required");
    });

    it("updates amount when reusing pending transaction with different amount", async () => {
      const store = createMockStore();
      const pay = createUzPay({
        payme: { merchantId: "test-id", secretKey: "secret" },
        store,
        callbacks,
      });

      const first = await pay.createPayment({
        provider: "payme",
        userId: "user-1",
        planId: "premium",
        amount: 50000,
      });

      const second = await pay.createPayment({
        provider: "payme",
        userId: "user-1",
        planId: "premium",
        amount: 75000,
      });

      expect(first.transactionId).toBe(second.transactionId);
      // Payme URL base64-encodes the params; decode and verify the amount
      const encoded = second.paymentUrl.split("/").pop()!;
      const decoded = atob(encoded);
      expect(decoded).toContain("a=7500000"); // 75000 UZS = 7500000 tiyin
    });
  });

  describe("webhook handler delegation", () => {
    it("throws when calling handlePaymeWebhook without config", async () => {
      const store = createMockStore();
      const pay = createUzPay({ store, callbacks });
      await expect(pay.handlePaymeWebhook({}, {})).rejects.toThrow("Payme config not provided");
    });

    it("throws when calling handleClickWebhook without config", async () => {
      const store = createMockStore();
      const pay = createUzPay({ store, callbacks });
      await expect(pay.handleClickWebhook({})).rejects.toThrow("Click config not provided");
    });

    it("throws when calling handlePaynetWebhook without config", async () => {
      const store = createMockStore();
      const pay = createUzPay({ store, callbacks });
      await expect(pay.handlePaynetWebhook({}, {})).rejects.toThrow("Paynet config not provided");
    });
  });
});
