import type {
  PaynetConfig,
  PaynetSuccessResponse,
  PaynetErrorResponse,
  Transaction,
} from "../types";
import { base64Decode, timingSafeEqual } from "../utils/crypto";
import {
  getTashkentTimestamp,
  getTashkentCheckTimestamp,
} from "../utils/time";

// =============================================================================
// PAYNET CONSTANTS
// =============================================================================

export const PAYNET_STATE = {
  SUCCESS: 1,
  CANCELLED: 2,
  NOT_FOUND: 3,
} as const;

export const PAYNET_ERROR = {
  INVALID_HTTP_METHOD: -32300,
  JSON_PARSE_ERROR: -32700,
  INVALID_RPC_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  MISSING_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SUCCESS: 0,
  INSUFFICIENT_FUNDS_FOR_CANCEL: 77,
  SERVICE_UNAVAILABLE: 100,
  SYSTEM_ERROR: 102,
  UNKNOWN_ERROR: 103,
  WALLET_NOT_IDENTIFIED: 113,
  TRANSACTION_EXISTS: 201,
  TRANSACTION_CANCELLED: 202,
  TRANSACTION_NOT_FOUND: 203,
  CLIENT_NOT_FOUND: 302,
  PRODUCT_NOT_FOUND: 304,
  SERVICE_NOT_FOUND: 305,
  PARAM_1_VALIDATION: 401,
  MISSING_REQUIRED_PARAMS: 411,
  INVALID_AMOUNT: 413,
  INVALID_DATE_FORMAT: 414,
  ACCESS_DENIED: 601,
} as const;

// =============================================================================
// AUTH
// =============================================================================

/** Verify HTTP Basic Auth header from Paynet. */
export function verifyPaynetAuth(
  username: string,
  password: string,
  authHeader: string | null | undefined
): boolean {
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;

  try {
    const credentials = base64Decode(authHeader.slice(6));
    const [u, p] = credentials.split(":");
    return timingSafeEqual(u, username) && timingSafeEqual(p, password);
  } catch {
    return false;
  }
}

// =============================================================================
// URL GENERATION
// =============================================================================

/**
 * Generate Paynet deep link / QR code URL.
 * @param amountUzs - Amount in UZS (So'm), not tiyin.
 */
export function generatePaynetUrl(
  serviceId: string,
  clientId: string,
  amountUzs: number
): string {
  const params = new URLSearchParams();
  params.append("m", serviceId);
  params.append("client_id", clientId);
  params.append("amount", amountUzs.toString());
  return `https://app.paynet.uz/?${params.toString()}`;
}

// =============================================================================
// RESPONSE BUILDERS
// =============================================================================

export function createPaynetSuccess(
  requestId: number,
  result: Record<string, unknown>
): PaynetSuccessResponse {
  return { jsonrpc: "2.0", id: requestId, result };
}

export function createPaynetError(
  requestId: number,
  code: number,
  message: string
): PaynetErrorResponse {
  return { jsonrpc: "2.0", id: requestId, error: { code, message } };
}

// =============================================================================
// PRE-DEFINED ERRORS
// =============================================================================

export const PaynetErrors = {
  accessDenied: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.ACCESS_DENIED, "Доступ запрещен"),

  clientNotFound: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.CLIENT_NOT_FOUND, "Клиент не найден"),

  transactionNotFound: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.TRANSACTION_NOT_FOUND, "Транзакция не найдена"),

  transactionExists: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.TRANSACTION_EXISTS, "Транзакция уже существует"),

  transactionCancelled: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.TRANSACTION_CANCELLED, "Транзакция уже отменена"),

  invalidAmount: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.INVALID_AMOUNT, "Неверная сумма"),

  methodNotFound: (id: number, method: string) =>
    createPaynetError(id, PAYNET_ERROR.METHOD_NOT_FOUND, `Метод ${method} не найден`),

  missingParams: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.MISSING_PARAMS, "Отсутствуют обязательные параметры"),

  internalError: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.INTERNAL_ERROR, "Внутренняя ошибка системы"),

  invalidRpcRequest: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.INVALID_RPC_REQUEST, "Неверный RPC-запрос"),

  invalidDateFormat: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.INVALID_DATE_FORMAT, "Неверный формат даты и времени"),

  serviceNotFound: (id: number) =>
    createPaynetError(id, PAYNET_ERROR.SERVICE_NOT_FOUND, "Услуга не найдена"),
};

// =============================================================================
// STATE MAPPING
// =============================================================================

/** Map internal transaction status to Paynet state integer */
export function mapToPaynetState(status: Transaction["status"]): number {
  switch (status) {
    case "COMPLETED":
      return PAYNET_STATE.SUCCESS;
    case "FAILED":
      return PAYNET_STATE.CANCELLED;
    case "PENDING":
    case "PREPARED":
      return PAYNET_STATE.SUCCESS;
    default:
      return PAYNET_STATE.NOT_FOUND;
  }
}

// Re-export time utils for convenience
export { getTashkentTimestamp, getTashkentCheckTimestamp };
