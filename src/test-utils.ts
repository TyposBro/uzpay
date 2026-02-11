import type {
  PaymentStore,
  Transaction,
  CreateTransactionInput,
  UpdateTransactionFields,
} from "./types";

/**
 * In-memory mock store for testing. Can also be used as a reference implementation.
 */
export function createMockStore(
  initialTransactions: Transaction[] = []
): PaymentStore & { _transactions: Map<string, Transaction> } {
  const txMap = new Map<string, Transaction>(
    initialTransactions.map((tx) => [tx.id, { ...tx }])
  );

  return {
    _transactions: txMap,

    async createTransaction(data: CreateTransactionInput): Promise<Transaction> {
      const tx: Transaction = {
        id: crypto.randomUUID(),
        userId: data.userId,
        planId: data.planId,
        provider: data.provider,
        amount: data.amount,
        status: data.status,
        providerTransactionId: null,
        providerCreateTime: null,
        providerPerformTime: null,
        providerCancelTime: null,
        cancelReason: null,
        shortId: data.shortId ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      txMap.set(tx.id, tx);
      return tx;
    },

    async getTransactionById(id: string): Promise<Transaction | null> {
      return txMap.get(id) ?? null;
    },

    async getTransactionByShortId(shortId: string): Promise<Transaction | null> {
      for (const tx of txMap.values()) {
        if (tx.shortId === shortId) return tx;
      }
      return null;
    },

    async getTransactionByProviderId(
      provider: string,
      providerTransactionId: string
    ): Promise<Transaction | null> {
      for (const tx of txMap.values()) {
        if (
          tx.provider === provider &&
          tx.providerTransactionId === providerTransactionId
        )
          return tx;
      }
      return null;
    },

    async updateTransaction(
      id: string,
      fields: UpdateTransactionFields
    ): Promise<void> {
      const tx = txMap.get(id);
      if (tx) {
        Object.assign(tx, fields, { updatedAt: new Date().toISOString() });
      }
    },

    async findPendingTransaction(
      userId: string,
      planId: string
    ): Promise<Transaction | null> {
      for (const tx of txMap.values()) {
        if (
          tx.userId === userId &&
          tx.planId === planId &&
          tx.status === "PENDING"
        )
          return tx;
      }
      return null;
    },

    async getTransactionsByDateRange(
      provider: string,
      _from: number | string,
      _to: number | string
    ): Promise<Transaction[]> {
      return [...txMap.values()].filter((tx) => tx.provider === provider);
    },
  };
}

/** Helper to create a test transaction */
export function createTestTransaction(
  overrides: Partial<Transaction> = {}
): Transaction {
  return {
    id: crypto.randomUUID(),
    userId: "user-1",
    planId: "premium_monthly",
    provider: "payme",
    amount: 5000000, // 50,000 UZS in tiyin
    status: "PENDING",
    providerTransactionId: null,
    providerCreateTime: null,
    providerPerformTime: null,
    providerCancelTime: null,
    cancelReason: null,
    shortId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
