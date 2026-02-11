/**
 * Example: uzpay with Hono on Cloudflare Workers + D1
 *
 * wrangler.toml:
 *   [[d1_databases]]
 *   binding = "DB"
 *   database_name = "payments"
 *   database_id = "your-database-id"
 */

import { Hono } from "hono";
import { createUzPay } from "uzpay";
import { createD1Store } from "../../store-adapters/d1.store";

type Env = {
  DB: D1Database;
  PAYME_MERCHANT_ID: string;
  PAYME_SECRET_KEY: string;
  CLICK_SERVICE_ID: string;
  CLICK_MERCHANT_ID: string;
  CLICK_MERCHANT_USER_ID: string;
  CLICK_SECRET_KEY: string;
  PAYNET_SERVICE_ID: string;
  PAYNET_USERNAME: string;
  PAYNET_PASSWORD: string;
};

const app = new Hono<{ Bindings: Env }>();

function getPay(env: Env) {
  return createUzPay({
    payme: {
      merchantId: env.PAYME_MERCHANT_ID,
      secretKey: env.PAYME_SECRET_KEY,
    },
    click: {
      serviceId: env.CLICK_SERVICE_ID,
      merchantId: env.CLICK_MERCHANT_ID,
      merchantUserId: env.CLICK_MERCHANT_USER_ID,
      secretKey: env.CLICK_SECRET_KEY,
    },
    paynet: {
      serviceId: env.PAYNET_SERVICE_ID,
      username: env.PAYNET_USERNAME,
      password: env.PAYNET_PASSWORD,
    },
    store: createD1Store(env.DB),
    callbacks: {
      onPaymentCompleted: async (tx) => {
        // Grant access - implement your business logic here
        await env.DB.prepare(
          "UPDATE users SET tier = 'premium', expiresAt = ? WHERE id = ?"
        )
          .bind(
            new Date(Date.now() + 30 * 86400000).toISOString(),
            tx.userId
          )
          .run();
        console.log(`Payment completed for user ${tx.userId}`);
      },
      onPaymentCancelled: async (tx) => {
        // Revoke access
        await env.DB.prepare(
          "UPDATE users SET tier = 'free', expiresAt = NULL WHERE id = ?"
        )
          .bind(tx.userId)
          .run();
        console.log(`Payment cancelled for user ${tx.userId}`);
      },
      getUserInfo: async (userId) => {
        const user = await env.DB.prepare(
          "SELECT * FROM users WHERE id = ?"
        )
          .bind(userId)
          .first<{ username: string }>();
        return user ? { name: user.username || "User" } : null;
      },
    },
  });
}

// --- Create Payment (authenticated endpoint) ---

app.post("/api/payment/create", async (c) => {
  // TODO: Add your auth middleware here
  const pay = getPay(c.env);
  const body = await c.req.json();

  try {
    const result = await pay.createPayment(body);
    return c.json({ success: true, ...result }, 201);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Payment creation failed";
    return c.json({ success: false, message }, 400);
  }
});

// --- Webhooks (public, called by payment providers) ---

app.post("/api/payment/payme/webhook", async (c) => {
  const pay = getPay(c.env);
  const result = await pay.handlePaymeWebhook(
    { authorization: c.req.header("Authorization") },
    await c.req.json()
  );
  return c.json(result.body, result.status as 200);
});

app.post("/api/payment/click/prepare", async (c) => {
  const pay = getPay(c.env);
  const result = await pay.handleClickWebhook(await c.req.json());
  return c.json(result.body);
});

app.post("/api/payment/click/complete", async (c) => {
  const pay = getPay(c.env);
  const result = await pay.handleClickWebhook(await c.req.json());
  return c.json(result.body);
});

app.post("/api/payment/paynet/webhook", async (c) => {
  const pay = getPay(c.env);
  const result = await pay.handlePaynetWebhook(
    { authorization: c.req.header("Authorization") },
    await c.req.json()
  );
  return c.json(result.body, result.status as 200);
});

export default app;
