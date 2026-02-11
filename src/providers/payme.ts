import type {
  PaymeConfig,
  PaymeLocalizedMessage,
  PaymeErrorResponse,
  PaymeSuccessResponse,
  FiscalDetail,
  Transaction,
} from "../types";
import { base64Encode, base64Decode, timingSafeEqual } from "../utils/crypto";

// =============================================================================
// PAYME CONSTANTS
// =============================================================================

export const PAYME_STATE = {
  CREATED: 1,
  COMPLETED: 2,
  CANCELLED_BEFORE_COMPLETE: -1,
  CANCELLED_AFTER_COMPLETE: -2,
} as const;

export const PAYME_CANCEL_REASON = {
  RECEIVERS_NOT_FOUND: 1,
  DEBIT_ERROR: 2,
  TRANSACTION_ERROR: 3,
  TIMEOUT: 4,
  REFUND: 5,
  UNKNOWN: 10,
} as const;

export const PAYME_ERROR = {
  INVALID_HTTP_METHOD: -32300,
  JSON_PARSE_ERROR: -32700,
  INVALID_RPC_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INSUFFICIENT_PRIVILEGES: -32504,
  INTERNAL_ERROR: -32400,
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  CANNOT_CANCEL_COMPLETED: -31007,
  CANNOT_PERFORM_OPERATION: -31008,
  ORDER_NOT_FOUND: -31050,
  ORDER_ALREADY_PAID: -31051,
} as const;

const CHECKOUT_URL = {
  live: "https://checkout.paycom.uz",
  test: "https://checkout.test.paycom.uz",
};

// =============================================================================
// URL GENERATION
// =============================================================================

/**
 * Generate Payme checkout URL.
 * Format: https://checkout.paycom.uz/{base64(m={merchantId};ac.order_id={orderId};a={amountTiyin})}
 */
export function generatePaymeUrl(
  config: PaymeConfig,
  orderId: string,
  amountTiyin: number
): string {
  const baseUrl = config.testMode ? CHECKOUT_URL.test : CHECKOUT_URL.live;
  const params = `m=${config.merchantId};ac.order_id=${orderId};a=${amountTiyin}`;
  return `${baseUrl}/${base64Encode(params)}`;
}

// =============================================================================
// AUTH
// =============================================================================

/**
 * Verify HTTP Basic Auth header from Payme.
 * Payme sends: Basic base64(Paycom:{secretKey})
 */
export function verifyPaymeAuth(
  secretKey: string,
  authHeader: string | null | undefined
): boolean {
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;

  try {
    const credentials = base64Decode(authHeader.slice(6));
    const [login, password] = credentials.split(":");
    return login === "Paycom" && timingSafeEqual(password, secretKey);
  } catch {
    return false;
  }
}

// =============================================================================
// RESPONSE BUILDERS
// =============================================================================

export function createPaymeError(
  requestId: number,
  code: number,
  message: PaymeLocalizedMessage,
  data?: string
): PaymeErrorResponse {
  return {
    error: { code, message, ...(data && { data }) },
    id: requestId,
  };
}

export function createPaymeSuccess(
  requestId: number,
  result: Record<string, unknown>
): PaymeSuccessResponse {
  return { result, id: requestId };
}

// =============================================================================
// PRE-DEFINED ERRORS
// =============================================================================

export const PaymeErrors = {
  invalidAmount: (id: number) =>
    createPaymeError(id, PAYME_ERROR.INVALID_AMOUNT, {
      ru: "Неверная сумма",
      uz: "Noto'g'ri summa",
      en: "Invalid amount",
    }, "amount"),

  transactionNotFound: (id: number) =>
    createPaymeError(id, PAYME_ERROR.TRANSACTION_NOT_FOUND, {
      ru: "Транзакция не найдена",
      uz: "Tranzaksiya topilmadi",
      en: "Transaction not found",
    }),

  orderNotFound: (id: number) =>
    createPaymeError(id, PAYME_ERROR.ORDER_NOT_FOUND, {
      ru: "Заказ не найден",
      uz: "Buyurtma topilmadi",
      en: "Order not found",
    }, "order_id"),

  orderAlreadyPaid: (id: number) =>
    createPaymeError(id, PAYME_ERROR.ORDER_ALREADY_PAID, {
      ru: "По данному заказу уже создана транзакция",
      uz: "Bu buyurtma uchun tranzaksiya allaqachon yaratilgan",
      en: "Transaction already exists for this order",
    }, "order_id"),

  cannotCancelCompleted: (id: number) =>
    createPaymeError(id, PAYME_ERROR.CANNOT_CANCEL_COMPLETED, {
      ru: "Невозможно отменить транзакцию. Заказ выполнен",
      uz: "Tranzaksiyani bekor qilib bo'lmaydi. Buyurtma bajarilgan",
      en: "Cannot cancel transaction. Order is fulfilled",
    }),

  cannotPerformOperation: (id: number) =>
    createPaymeError(id, PAYME_ERROR.CANNOT_PERFORM_OPERATION, {
      ru: "Невозможно выполнить операцию",
      uz: "Operatsiyani bajarib bo'lmaydi",
      en: "Cannot perform operation",
    }),

  insufficientPrivileges: (id: number) =>
    createPaymeError(id, PAYME_ERROR.INSUFFICIENT_PRIVILEGES, {
      ru: "Недостаточно привилегий",
      uz: "Imtiyozlar yetarli emas",
      en: "Insufficient privileges",
    }),

  methodNotFound: (id: number, method: string) =>
    createPaymeError(id, PAYME_ERROR.METHOD_NOT_FOUND, {
      ru: "Метод не найден",
      uz: "Metod topilmadi",
      en: "Method not found",
    }, method),

  internalError: (id: number) =>
    createPaymeError(id, PAYME_ERROR.INTERNAL_ERROR, {
      ru: "Внутренняя ошибка",
      uz: "Ichki xatolik",
      en: "Internal error",
    }),

  invalidJsonRpc: (id: number) =>
    createPaymeError(id, PAYME_ERROR.INVALID_RPC_REQUEST, {
      ru: "Неверный RPC-запрос",
      uz: "Noto'g'ri RPC so'rov",
      en: "Invalid RPC request",
    }),
};

// =============================================================================
// STATE MAPPING
// =============================================================================

/** Map internal transaction status to Payme state integer */
export function mapToPaymeState(
  status: Transaction["status"],
  hasPerformTime?: boolean
): number {
  switch (status) {
    case "PENDING":
      return PAYME_STATE.CREATED;
    case "PREPARED":
      return PAYME_STATE.CREATED;
    case "COMPLETED":
      return PAYME_STATE.COMPLETED;
    case "FAILED":
      return hasPerformTime
        ? PAYME_STATE.CANCELLED_AFTER_COMPLETE
        : PAYME_STATE.CANCELLED_BEFORE_COMPLETE;
    default:
      return PAYME_STATE.CREATED;
  }
}
