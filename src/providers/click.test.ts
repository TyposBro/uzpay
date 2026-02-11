import { describe, it, expect } from "vitest";
import { generateClickUrl, verifyClickSignature } from "./click";
import { md5 } from "../utils/crypto";
import type { ClickWebhookData } from "../types";

describe("Click Provider", () => {
  describe("generateClickUrl", () => {
    it("generates correct checkout URL", () => {
      const url = generateClickUrl(
        {
          serviceId: "80012",
          merchantId: "44439",
          merchantUserId: "61733",
          secretKey: "secret",
        },
        "12345",
        50000
      );
      expect(url).toContain("https://my.click.uz/services/pay");
      expect(url).toContain("service_id=80012");
      expect(url).toContain("merchant_id=44439");
      expect(url).toContain("merchant_user_id=61733");
      expect(url).toContain("amount=50000.00");
      expect(url).toContain("transaction_param=12345");
    });

    it("includes return_url when provided", () => {
      const url = generateClickUrl(
        {
          serviceId: "1",
          merchantId: "2",
          merchantUserId: "3",
          secretKey: "s",
        },
        "tx-1",
        1000,
        "https://myapp.com/success"
      );
      expect(url).toContain("return_url=");
      expect(url).toContain("myapp.com");
    });
  });

  describe("verifyClickSignature", () => {
    const secretKey = "test-secret";

    it("returns true for valid signature (prepare)", () => {
      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: "order-001",
        amount: 50000,
        action: 0,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };

      const source = `${data.click_trans_id}${data.service_id}${secretKey}${data.merchant_trans_id}${data.amount}${data.action}${data.sign_time}`;
      data.sign_string = md5(source);

      const result = verifyClickSignature(secretKey, data);
      expect(result).toBe(true);
    });

    it("returns true for valid signature (complete with prepare_id)", () => {
      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: "order-001",
        merchant_prepare_id: "uuid-123",
        amount: 50000,
        action: 1,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "",
      };

      const source = `${data.click_trans_id}${data.service_id}${secretKey}${data.merchant_trans_id}${data.merchant_prepare_id}${data.amount}${data.action}${data.sign_time}`;
      data.sign_string = md5(source);

      const result = verifyClickSignature(secretKey, data);
      expect(result).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const data: ClickWebhookData = {
        click_trans_id: 12345,
        service_id: 80012,
        click_paydoc_id: 1,
        merchant_trans_id: "order-001",
        amount: 50000,
        action: 0,
        error: 0,
        error_note: "",
        sign_time: "2025-01-01 12:00:00",
        sign_string: "invalid-hash",
      };

      const result = verifyClickSignature(secretKey, data);
      expect(result).toBe(false);
    });
  });
});
