import { describe, it, expect } from "vitest";
import {
  generatePaymeUrl,
  verifyPaymeAuth,
  createPaymeError,
  createPaymeSuccess,
  PaymeErrors,
  PAYME_STATE,
  PAYME_ERROR,
  mapToPaymeState,
} from "./payme";

describe("Payme Provider", () => {
  describe("generatePaymeUrl", () => {
    it("generates correct checkout URL for live mode", () => {
      const url = generatePaymeUrl(
        { merchantId: "abc123", secretKey: "secret" },
        "order-001",
        5000000
      );
      expect(url).toContain("https://checkout.paycom.uz/");
      // Decode the base64 part
      const encoded = url.split("/").pop()!;
      const decoded = atob(encoded);
      expect(decoded).toBe("m=abc123;ac.order_id=order-001;a=5000000");
    });

    it("uses test URL when testMode is true", () => {
      const url = generatePaymeUrl(
        { merchantId: "test123", secretKey: "secret", testMode: true },
        "order-002",
        100000
      );
      expect(url).toContain("https://checkout.test.paycom.uz/");
    });
  });

  describe("verifyPaymeAuth", () => {
    const secretKey = "my-secret-key";

    it("returns true for valid auth header", () => {
      const header = `Basic ${btoa(`Paycom:${secretKey}`)}`;
      expect(verifyPaymeAuth(secretKey, header)).toBe(true);
    });

    it("returns false for wrong password", () => {
      const header = `Basic ${btoa("Paycom:wrong-key")}`;
      expect(verifyPaymeAuth(secretKey, header)).toBe(false);
    });

    it("returns false for wrong login", () => {
      const header = `Basic ${btoa(`WrongLogin:${secretKey}`)}`;
      expect(verifyPaymeAuth(secretKey, header)).toBe(false);
    });

    it("returns false for missing header", () => {
      expect(verifyPaymeAuth(secretKey, null)).toBe(false);
      expect(verifyPaymeAuth(secretKey, undefined)).toBe(false);
    });

    it("returns false for non-Basic auth", () => {
      expect(verifyPaymeAuth(secretKey, "Bearer token123")).toBe(false);
    });

    it("returns false for malformed base64", () => {
      expect(verifyPaymeAuth(secretKey, "Basic !!!not-base64!!!")).toBe(false);
    });
  });

  describe("response builders", () => {
    it("creates error response", () => {
      const err = createPaymeError(
        1,
        PAYME_ERROR.ORDER_NOT_FOUND,
        { ru: "test", uz: "test", en: "test" },
        "order_id"
      );
      expect(err.error.code).toBe(-31050);
      expect(err.error.data).toBe("order_id");
      expect(err.id).toBe(1);
    });

    it("creates success response", () => {
      const res = createPaymeSuccess(5, { allow: true });
      expect(res.result.allow).toBe(true);
      expect(res.id).toBe(5);
    });
  });

  describe("PaymeErrors", () => {
    it("generates all error types", () => {
      expect(PaymeErrors.invalidAmount(1).error.code).toBe(PAYME_ERROR.INVALID_AMOUNT);
      expect(PaymeErrors.transactionNotFound(1).error.code).toBe(PAYME_ERROR.TRANSACTION_NOT_FOUND);
      expect(PaymeErrors.orderNotFound(1).error.code).toBe(PAYME_ERROR.ORDER_NOT_FOUND);
      expect(PaymeErrors.orderAlreadyPaid(1).error.code).toBe(PAYME_ERROR.ORDER_ALREADY_PAID);
      expect(PaymeErrors.cannotCancelCompleted(1).error.code).toBe(PAYME_ERROR.CANNOT_CANCEL_COMPLETED);
      expect(PaymeErrors.cannotPerformOperation(1).error.code).toBe(PAYME_ERROR.CANNOT_PERFORM_OPERATION);
      expect(PaymeErrors.insufficientPrivileges(1).error.code).toBe(PAYME_ERROR.INSUFFICIENT_PRIVILEGES);
      expect(PaymeErrors.methodNotFound(1, "Unknown").error.data).toBe("Unknown");
      expect(PaymeErrors.internalError(1).error.code).toBe(PAYME_ERROR.INTERNAL_ERROR);
      expect(PaymeErrors.invalidJsonRpc(1).error.code).toBe(PAYME_ERROR.INVALID_RPC_REQUEST);
    });
  });

  describe("mapToPaymeState", () => {
    it("maps PENDING to CREATED", () => {
      expect(mapToPaymeState("PENDING")).toBe(PAYME_STATE.CREATED);
    });
    it("maps PREPARED to CREATED", () => {
      expect(mapToPaymeState("PREPARED")).toBe(PAYME_STATE.CREATED);
    });
    it("maps COMPLETED to COMPLETED", () => {
      expect(mapToPaymeState("COMPLETED")).toBe(PAYME_STATE.COMPLETED);
    });
    it("maps FAILED without performTime to CANCELLED_BEFORE", () => {
      expect(mapToPaymeState("FAILED", false)).toBe(PAYME_STATE.CANCELLED_BEFORE_COMPLETE);
    });
    it("maps FAILED with performTime to CANCELLED_AFTER", () => {
      expect(mapToPaymeState("FAILED", true)).toBe(PAYME_STATE.CANCELLED_AFTER_COMPLETE);
    });
  });
});
