import { describe, it, expect } from "vitest";
import {
  verifyPaynetAuth,
  generatePaynetUrl,
  createPaynetSuccess,
  createPaynetError,
  PaynetErrors,
  PAYNET_STATE,
  PAYNET_ERROR,
  mapToPaynetState,
  getTashkentTimestamp,
  getTashkentCheckTimestamp,
} from "./paynet";

describe("Paynet Provider", () => {
  describe("verifyPaynetAuth", () => {
    it("returns true for valid credentials", () => {
      const header = `Basic ${btoa("admin:password123")}`;
      expect(verifyPaynetAuth("admin", "password123", header)).toBe(true);
    });

    it("returns false for wrong username", () => {
      const header = `Basic ${btoa("wrong:password123")}`;
      expect(verifyPaynetAuth("admin", "password123", header)).toBe(false);
    });

    it("returns false for wrong password", () => {
      const header = `Basic ${btoa("admin:wrong")}`;
      expect(verifyPaynetAuth("admin", "password123", header)).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(verifyPaynetAuth("a", "b", null)).toBe(false);
      expect(verifyPaynetAuth("a", "b", undefined)).toBe(false);
    });

    it("returns false for non-Basic auth", () => {
      expect(verifyPaynetAuth("a", "b", "Bearer token")).toBe(false);
    });
  });

  describe("generatePaynetUrl", () => {
    it("generates correct deep link URL", () => {
      const url = generatePaynetUrl("123456", "12345", 50000);
      expect(url).toContain("https://app.paynet.uz/");
      expect(url).toContain("m=123456");
      expect(url).toContain("client_id=12345");
      expect(url).toContain("amount=50000");
    });
  });

  describe("response builders", () => {
    it("creates success response with JSON-RPC 2.0", () => {
      const res = createPaynetSuccess(1, { status: "0" });
      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(1);
      expect(res.result.status).toBe("0");
    });

    it("creates error response with JSON-RPC 2.0", () => {
      const res = createPaynetError(2, 302, "Not found");
      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(2);
      expect(res.error.code).toBe(302);
      expect(res.error.message).toBe("Not found");
    });
  });

  describe("PaynetErrors", () => {
    it("generates all error types with correct codes", () => {
      expect(PaynetErrors.accessDenied(1).error.code).toBe(PAYNET_ERROR.ACCESS_DENIED);
      expect(PaynetErrors.clientNotFound(1).error.code).toBe(PAYNET_ERROR.CLIENT_NOT_FOUND);
      expect(PaynetErrors.transactionNotFound(1).error.code).toBe(
        PAYNET_ERROR.TRANSACTION_NOT_FOUND,
      );
      expect(PaynetErrors.transactionExists(1).error.code).toBe(PAYNET_ERROR.TRANSACTION_EXISTS);
      expect(PaynetErrors.transactionCancelled(1).error.code).toBe(
        PAYNET_ERROR.TRANSACTION_CANCELLED,
      );
      expect(PaynetErrors.invalidAmount(1).error.code).toBe(PAYNET_ERROR.INVALID_AMOUNT);
      expect(PaynetErrors.missingParams(1).error.code).toBe(PAYNET_ERROR.MISSING_PARAMS);
      expect(PaynetErrors.internalError(1).error.code).toBe(PAYNET_ERROR.INTERNAL_ERROR);
      expect(PaynetErrors.invalidDateFormat(1).error.code).toBe(PAYNET_ERROR.INVALID_DATE_FORMAT);
      expect(PaynetErrors.serviceNotFound(1).error.code).toBe(PAYNET_ERROR.SERVICE_NOT_FOUND);
    });
  });

  describe("mapToPaynetState", () => {
    it("maps COMPLETED to SUCCESS", () => {
      expect(mapToPaynetState("COMPLETED")).toBe(PAYNET_STATE.SUCCESS);
    });
    it("maps FAILED to CANCELLED", () => {
      expect(mapToPaynetState("FAILED")).toBe(PAYNET_STATE.CANCELLED);
    });
    it("maps PENDING to SUCCESS (in-progress)", () => {
      expect(mapToPaynetState("PENDING")).toBe(PAYNET_STATE.SUCCESS);
    });
    it("maps PREPARED to SUCCESS (in-progress)", () => {
      expect(mapToPaynetState("PREPARED")).toBe(PAYNET_STATE.SUCCESS);
    });
  });

  describe("timestamp formatters", () => {
    it("getTashkentTimestamp returns YYYY-MM-DD HH:mm:ss format", () => {
      const ts = getTashkentTimestamp(new Date("2025-06-15T10:30:00Z"));
      // GMT+5: 10:30 UTC = 15:30 UZT
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(ts).toBe("2025-06-15 15:30:00");
    });

    it("getTashkentCheckTimestamp returns EEE MMM dd format", () => {
      const ts = getTashkentCheckTimestamp(new Date("2025-12-30T05:29:03Z"));
      // GMT+5: 05:29 UTC = 10:29 UZT
      expect(ts).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} UZT \d{4}$/);
      expect(ts).toBe("Tue Dec 30 10:29:03 UZT 2025");
    });
  });
});
