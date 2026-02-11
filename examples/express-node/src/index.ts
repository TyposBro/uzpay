/**
 * Example: uzpay with Express on Node.js
 *
 * npm install express uzpay
 * Set environment variables for your payment provider credentials.
 */

import express from "express";
import { createUzPay } from "uzpay";

const app = express();
app.use(express.json());

// Create uzpay instance once (or per-request if config changes)
const pay = createUzPay({
  payme: {
    merchantId: process.env.PAYME_MERCHANT_ID!,
    secretKey: process.env.PAYME_SECRET_KEY!,
    testMode: process.env.NODE_ENV !== "production",
  },
  click: {
    serviceId: process.env.CLICK_SERVICE_ID!,
    merchantId: process.env.CLICK_MERCHANT_ID!,
    merchantUserId: process.env.CLICK_MERCHANT_USER_ID!,
    secretKey: process.env.CLICK_SECRET_KEY!,
  },
  paynet: {
    serviceId: process.env.PAYNET_SERVICE_ID!,
    username: process.env.PAYNET_USERNAME!,
    password: process.env.PAYNET_PASSWORD!,
  },
  store: {
    // Implement with your database (Prisma, Drizzle, Knex, etc.)
    // See examples/store-adapters/prisma.store.ts for reference
    async createTransaction(data) {
      throw new Error("Implement with your database");
    },
    async getTransactionById(id) {
      throw new Error("Implement with your database");
    },
    async getTransactionByShortId(shortId) {
      throw new Error("Implement with your database");
    },
    async getTransactionByProviderId(provider, providerTransactionId) {
      throw new Error("Implement with your database");
    },
    async updateTransaction(id, fields) {
      throw new Error("Implement with your database");
    },
    async findPendingTransaction(userId, planId) {
      throw new Error("Implement with your database");
    },
    async getTransactionsByDateRange(provider, from, to) {
      throw new Error("Implement with your database");
    },
  },
  callbacks: {
    onPaymentCompleted: async (tx) => {
      console.log(`Payment completed: ${tx.id} for user ${tx.userId}`);
      // TODO: Grant access in your database
    },
    onPaymentCancelled: async (tx) => {
      console.log(`Payment cancelled: ${tx.id} for user ${tx.userId}`);
      // TODO: Revoke access in your database
    },
  },
});

// --- Create Payment ---

app.post("/api/payment/create", async (req, res) => {
  try {
    const result = await pay.createPayment(req.body);
    res.status(201).json({ success: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Payment creation failed";
    res.status(400).json({ success: false, message });
  }
});

// --- Webhooks ---

app.post("/api/payment/payme/webhook", async (req, res) => {
  const result = await pay.handlePaymeWebhook(
    { authorization: req.headers.authorization },
    req.body
  );
  res.status(result.status).json(result.body);
});

app.post("/api/payment/click/prepare", async (req, res) => {
  const result = await pay.handleClickWebhook(req.body);
  res.status(result.status).json(result.body);
});

app.post("/api/payment/click/complete", async (req, res) => {
  const result = await pay.handleClickWebhook(req.body);
  res.status(result.status).json(result.body);
});

app.post("/api/payment/paynet/webhook", async (req, res) => {
  const result = await pay.handlePaynetWebhook(
    { authorization: req.headers.authorization },
    req.body
  );
  res.status(result.status).json(result.body);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Payment server running on port ${PORT}`);
});
