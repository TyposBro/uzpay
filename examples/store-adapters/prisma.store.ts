/**
 * Prisma store adapter skeleton for uzpay.
 *
 * Prerequisite: Add this model to your schema.prisma:
 *
 *   model PaymentTransaction {
 *     id                    String   @id @default(uuid())
 *     userId                String
 *     planId                String
 *     provider              String
 *     amount                Int      // tiyin
 *     status                String   @default("PENDING")
 *     providerTransactionId String?
 *     providerCreateTime    BigInt?
 *     providerPerformTime   BigInt?
 *     providerCancelTime    BigInt?
 *     cancelReason          Int?
 *     shortId               String?
 *     createdAt             DateTime @default(now())
 *     updatedAt             DateTime @updatedAt
 *
 *     @@index([userId, planId])
 *     @@index([shortId])
 *     @@index([provider, providerTransactionId])
 *   }
 */

import type {
  PaymentStore,
  Transaction,
  CreateTransactionInput,
  UpdateTransactionFields,
} from "uzpay";

// Replace with your actual Prisma client type
type PrismaClient = any;

export function createPrismaStore(prisma: PrismaClient): PaymentStore {
  return {
    async createTransaction(data: CreateTransactionInput): Promise<Transaction> {
      const tx = await prisma.paymentTransaction.create({ data });
      return mapToTransaction(tx);
    },

    async getTransactionById(id: string): Promise<Transaction | null> {
      const tx = await prisma.paymentTransaction.findUnique({ where: { id } });
      return tx ? mapToTransaction(tx) : null;
    },

    async getTransactionByShortId(shortId: string): Promise<Transaction | null> {
      const tx = await prisma.paymentTransaction.findFirst({
        where: { shortId },
      });
      return tx ? mapToTransaction(tx) : null;
    },

    async getTransactionByProviderId(
      provider: string,
      providerTransactionId: string
    ): Promise<Transaction | null> {
      const tx = await prisma.paymentTransaction.findFirst({
        where: { provider, providerTransactionId },
      });
      return tx ? mapToTransaction(tx) : null;
    },

    async updateTransaction(
      id: string,
      fields: UpdateTransactionFields
    ): Promise<void> {
      await prisma.paymentTransaction.update({
        where: { id },
        data: fields,
      });
    },

    async findPendingTransaction(
      userId: string,
      planId: string
    ): Promise<Transaction | null> {
      const tx = await prisma.paymentTransaction.findFirst({
        where: { userId, planId, status: "PENDING" },
      });
      return tx ? mapToTransaction(tx) : null;
    },

    async getTransactionsByDateRange(
      provider: string,
      from: number | string,
      to: number | string
    ): Promise<Transaction[]> {
      const txs = await prisma.paymentTransaction.findMany({
        where: {
          provider,
          createdAt: {
            gte: typeof from === "number" ? new Date(from) : new Date(from),
            lte: typeof to === "number" ? new Date(to) : new Date(to),
          },
        },
        orderBy: { createdAt: "asc" },
      });
      return txs.map(mapToTransaction);
    },
  };
}

function mapToTransaction(tx: any): Transaction {
  return {
    ...tx,
    providerCreateTime: tx.providerCreateTime
      ? Number(tx.providerCreateTime)
      : null,
    providerPerformTime: tx.providerPerformTime
      ? Number(tx.providerPerformTime)
      : null,
    providerCancelTime: tx.providerCancelTime
      ? Number(tx.providerCancelTime)
      : null,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  };
}
