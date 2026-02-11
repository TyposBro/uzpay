// =============================================================================
// TRANSACTION
// =============================================================================

export type TransactionStatus = "PENDING" | "PREPARED" | "COMPLETED" | "FAILED";

export interface Transaction {
  id: string;
  userId: string;
  planId: string;
  provider: string;
  amount: number; // Always stored in TIYIN (1 UZS = 100 tiyin)
  status: TransactionStatus;
  providerTransactionId: string | null;
  providerCreateTime: number | null; // ms timestamp
  providerPerformTime: number | null; // ms timestamp
  providerCancelTime: number | null; // ms timestamp
  cancelReason: number | null;
  shortId: string | null; // 5-digit code for Click/Paynet
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface CreateTransactionInput {
  userId: string;
  planId: string;
  provider: string;
  amount: number; // in tiyin
  status: TransactionStatus;
  shortId?: string;
}

export interface UpdateTransactionFields {
  status?: TransactionStatus;
  providerTransactionId?: string;
  providerCreateTime?: number;
  providerPerformTime?: number;
  providerCancelTime?: number;
  cancelReason?: number;
  provider?: string;
  amount?: number;
  shortId?: string;
}

// =============================================================================
// STORAGE ADAPTER (user implements for their DB)
// =============================================================================

export interface PaymentStore {
  createTransaction(data: CreateTransactionInput): Promise<Transaction>;
  getTransactionById(id: string): Promise<Transaction | null>;
  getTransactionByShortId(shortId: string): Promise<Transaction | null>;
  getTransactionByProviderId(
    provider: string,
    providerTransactionId: string
  ): Promise<Transaction | null>;
  updateTransaction(id: string, fields: UpdateTransactionFields): Promise<void>;
  findPendingTransaction(
    userId: string,
    planId: string
  ): Promise<Transaction | null>;
  getTransactionsByDateRange(
    provider: string,
    from: number | string,
    to: number | string
  ): Promise<Transaction[]>;
}

// =============================================================================
// CALLBACKS (user provides business logic)
// =============================================================================

export interface PaymentCallbacks {
  /** Called when payment completes (grant access, activate subscription, etc.) */
  onPaymentCompleted(transaction: Transaction): Promise<void>;
  /** Called when a completed payment is cancelled/refunded (revoke access) */
  onPaymentCancelled(transaction: Transaction): Promise<void>;
  /** Paynet GetInformation: return user info to display at terminal/app */
  getUserInfo?(userId: string): Promise<UserInfo | null>;
  /** Payme CheckPerformTransaction: return fiscal data for tax receipt */
  getFiscalData?(transaction: Transaction): Promise<FiscalDetail | null>;
  /** Paynet ChangePassword: handle credential rotation */
  onPasswordChangeRequested?(newPassword: string): Promise<void>;
}

export interface UserInfo {
  name: string;
  [key: string]: unknown;
}

export interface FiscalDetail {
  receipt_type: number; // 0 = sale, 1 = refund
  items: FiscalItem[];
}

export interface FiscalItem {
  title: string;
  price: number; // tiyin
  count: number;
  code: string; // MXIK code
  package_code: string;
  vat_percent: number;
  discount?: number;
}

// =============================================================================
// PROVIDER CONFIGS
// =============================================================================

export interface PaymeConfig {
  merchantId: string;
  secretKey: string;
  testMode?: boolean;
}

export interface ClickConfig {
  serviceId: string;
  merchantId: string;
  merchantUserId: string;
  secretKey: string;
}

export interface PaynetConfig {
  serviceId: string;
  username: string;
  password: string;
}

// =============================================================================
// LOGGER
// =============================================================================

export interface Logger {
  error?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  info?(...args: unknown[]): void;
}

// =============================================================================
// UZPAY OPTIONS & RESULT TYPES
// =============================================================================

export interface UzPayOptions {
  payme?: PaymeConfig;
  click?: ClickConfig;
  paynet?: PaynetConfig;
  store: PaymentStore;
  callbacks: PaymentCallbacks;
  /** Optional logger. If not provided, errors are silently swallowed. */
  logger?: Logger;
}

export interface CreatePaymentParams {
  provider: "payme" | "click" | "paynet";
  userId: string;
  planId: string;
  amount: number; // in UZS (So'm) - library converts to tiyin internally
  returnUrl?: string;
}

export interface CreatePaymentResult {
  transactionId: string;
  paymentUrl: string;
  shortId?: string;
}

export interface WebhookHeaders {
  authorization?: string | null;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

// =============================================================================
// PAYME WEBHOOK TYPES
// =============================================================================

export interface PaymeWebhookRequest {
  method: string;
  params: {
    id?: string;
    time?: number;
    amount?: number;
    account?: { order_id: string };
    reason?: number;
    from?: number;
    to?: number;
  };
  id: number;
}

export interface PaymeLocalizedMessage {
  ru: string;
  uz: string;
  en: string;
}

export interface PaymeErrorResponse {
  error: {
    code: number;
    message: PaymeLocalizedMessage;
    data?: string;
  };
  id: number;
}

export interface PaymeSuccessResponse {
  result: Record<string, unknown>;
  id: number;
}

export type PaymeWebhookResponse = PaymeSuccessResponse | PaymeErrorResponse;

// =============================================================================
// CLICK WEBHOOK TYPES
// =============================================================================

export interface ClickWebhookData {
  click_trans_id: number;
  service_id: number;
  click_paydoc_id: number;
  merchant_trans_id: string;
  merchant_prepare_id?: string;
  amount: number;
  action: 0 | 1;
  error: number;
  error_note: string;
  sign_time: string;
  sign_string: string;
}

// =============================================================================
// PAYNET WEBHOOK TYPES
// =============================================================================

export interface PaynetWebhookRequest {
  jsonrpc: "2.0";
  method: string;
  id: number;
  params: {
    serviceId?: number;
    transactionId?: number;
    amount?: number;
    timestamp?: string;
    dateFrom?: string;
    dateTo?: string;
    newPassword?: string;
    fields?: {
      order_id?: string;
      client_id?: string;
      [key: string]: unknown;
    };
  };
}

export interface PaynetSuccessResponse {
  jsonrpc: "2.0";
  id: number;
  result: Record<string, unknown>;
}

export interface PaynetErrorResponse {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string };
}

export type PaynetWebhookResponse = PaynetSuccessResponse | PaynetErrorResponse;
