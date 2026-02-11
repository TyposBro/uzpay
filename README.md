# uzpay

Payment integration for Uzbekistan providers — **Payme**, **Click**, and **Paynet**.

Zero dependencies. Works on Cloudflare Workers, Node.js, Deno, and Bun.

```
npm install uzpay
```

## Quick Start

```typescript
import { createUzPay } from 'uzpay';

const pay = createUzPay({
  payme: { merchantId: '...', secretKey: '...' },
  click: { serviceId: '...', merchantId: '...', merchantUserId: '...', secretKey: '...' },
  paynet: { serviceId: '...', username: '...', password: '...' },
  store: myDatabaseAdapter,  // you implement this (see below)
  callbacks: {
    onPaymentCompleted: async (tx) => {
      // Grant access to your user
    },
    onPaymentCancelled: async (tx) => {
      // Revoke access
    },
  },
});
```

### Create a payment

```typescript
const result = await pay.createPayment({
  provider: 'payme',        // or 'click' or 'paynet'
  userId: 'user-123',
  planId: 'premium_monthly',
  amount: 50000,             // UZS (So'm)
});

// result.paymentUrl  → redirect user here
// result.transactionId
// result.shortId     → 5-digit code (Click/Paynet only)
```

### Handle webhooks

Wire up your routes — the library handles all the protocol logic and returns what to send back:

```typescript
// Payme (JSON-RPC Merchant API)
app.post('/payme/webhook', async (req, res) => {
  const result = await pay.handlePaymeWebhook(
    { authorization: req.headers.authorization },
    req.body
  );
  res.status(result.status).json(result.body);
});

// Click (Prepare/Complete)
app.post('/click/prepare', async (req, res) => {
  const result = await pay.handleClickWebhook(req.body);
  res.status(result.status).json(result.body);
});

app.post('/click/complete', async (req, res) => {
  const result = await pay.handleClickWebhook(req.body);
  res.status(result.status).json(result.body);
});

// Paynet (JSON-RPC 2.0)
app.post('/paynet/webhook', async (req, res) => {
  const result = await pay.handlePaynetWebhook(
    { authorization: req.headers.authorization },
    req.body
  );
  res.status(result.status).json(result.body);
});
```

## Store Adapter

You need to implement the `PaymentStore` interface for your database. This is the only thing you need to write — 7 methods:

```typescript
import type { PaymentStore } from 'uzpay';

const store: PaymentStore = {
  createTransaction(data)                           // → Promise<Transaction>
  getTransactionById(id)                            // → Promise<Transaction | null>
  getTransactionByShortId(shortId)                  // → Promise<Transaction | null>
  getTransactionByProviderId(provider, providerId)  // → Promise<Transaction | null>
  updateTransaction(id, fields)                     // → Promise<void>
  findPendingTransaction(userId, planId)            // → Promise<Transaction | null>
  getTransactionsByDateRange(provider, from, to)    // → Promise<Transaction[]>
};
```

Reference implementations are in `examples/store-adapters/`:
- `d1.store.ts` — Cloudflare D1
- `prisma.store.ts` — Prisma ORM

## Database Schema

Create this table in your database:

```sql
CREATE TABLE payment_transactions (
  id                    TEXT PRIMARY KEY,
  userId                TEXT NOT NULL,
  planId                TEXT NOT NULL,
  provider              TEXT NOT NULL,       -- 'payme', 'click', 'paynet'
  amount                INTEGER NOT NULL,    -- Always in tiyin (1 UZS = 100 tiyin)
  status                TEXT NOT NULL DEFAULT 'PENDING',
  providerTransactionId TEXT,
  providerCreateTime    INTEGER,             -- ms timestamp
  providerPerformTime   INTEGER,             -- ms timestamp
  providerCancelTime    INTEGER,             -- ms timestamp
  cancelReason          INTEGER,
  shortId               TEXT,                -- 5-digit code for Click/Paynet
  createdAt             TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tx_userId_planId ON payment_transactions(userId, planId);
CREATE INDEX idx_tx_shortId ON payment_transactions(shortId);
CREATE INDEX idx_tx_provider_providerId ON payment_transactions(provider, providerTransactionId);
```

## Callbacks

```typescript
callbacks: {
  // Required: called when payment succeeds
  onPaymentCompleted: async (transaction) => {
    await db.grantAccess(transaction.userId, transaction.planId);
  },

  // Required: called when a completed payment is refunded
  onPaymentCancelled: async (transaction) => {
    await db.revokeAccess(transaction.userId);
  },

  // Optional: Paynet GetInformation — show user info at terminal
  getUserInfo: async (userId) => {
    const user = await db.getUser(userId);
    return { name: user.name };
  },

  // Optional: Payme CheckPerformTransaction — tax receipts
  getFiscalData: async (transaction) => ({
    receipt_type: 0,
    items: [{
      title: 'Premium Subscription',
      price: transaction.amount,
      count: 1,
      code: '10304008004000000',     // MXIK code
      package_code: '1500592',
      vat_percent: 12,
    }],
  }),
}
```

## Provider Configs

### Payme

```typescript
payme: {
  merchantId: 'your-merchant-id',
  secretKey: 'your-secret-key',
  testMode: true,  // uses test.paycom.uz (default: false)
}
```

Webhook endpoint: `POST /payme/webhook`
Protocol: JSON-RPC (Merchant API)
Methods handled: `CheckPerformTransaction`, `CreateTransaction`, `PerformTransaction`, `CancelTransaction`, `CheckTransaction`, `GetStatement`

### Click

```typescript
click: {
  serviceId: '80012',
  merchantId: '44439',
  merchantUserId: '61733',
  secretKey: 'your-secret-key',
}
```

Webhook endpoints: `POST /click/prepare` + `POST /click/complete`
Both endpoints use the same `handleClickWebhook()` — it detects the action automatically.

### Paynet

```typescript
paynet: {
  serviceId: '123456',
  username: 'your-username',
  password: 'your-password',
}
```

Webhook endpoint: `POST /paynet/webhook`
Protocol: JSON-RPC 2.0
Methods handled: `GetInformation`, `PerformTransaction`, `CheckTransaction`, `CancelTransaction`, `GetStatement`, `ChangePassword`

## Tree-Shakeable Imports

Import only what you need:

```typescript
// Just Payme provider utilities
import { generatePaymeUrl, verifyPaymeAuth, PAYME_ERROR } from 'uzpay/payme';

// Just Click
import { generateClickUrl, verifyClickSignature } from 'uzpay/click';

// Just Paynet
import { generatePaynetUrl, verifyPaynetAuth, PAYNET_STATE } from 'uzpay/paynet';

// Currency helpers
import { uzsToTiyin, tiyinToUzs } from 'uzpay';
```

## How It Works

```
┌──────────┐    createPayment()    ┌──────────┐
│  Client   │ ───────────────────→ │  Your    │
│  (App)    │ ←─── paymentUrl ──── │  Server  │
└──────────┘                       └────┬─────┘
     │                                  │
     │  User pays via Payme/Click/      │ handleXxxWebhook()
     │  Paynet app or terminal          │
     │                                  │
┌──────────┐   webhook callback    ┌────┴─────┐
│  Payment  │ ───────────────────→ │  uzpay   │ → onPaymentCompleted()
│  Provider │ ←── JSON response ── │  library │ → updates your store
└──────────┘                       └──────────┘
```

1. Your app calls `createPayment()` → gets a URL to redirect the user to
2. User pays through the provider's interface
3. Provider calls your webhook endpoint
4. `uzpay` verifies the request, updates the transaction, and calls your callbacks
5. You return the response `uzpay` gives you back to the provider

## Payment Flow States

```
PENDING → PREPARED → COMPLETED
   │         │
   └─────────┴──→ FAILED (cancelled/refunded)
```

- **PENDING**: Transaction created, waiting for provider
- **PREPARED**: Provider has locked the transaction (Payme CreateTransaction / Click Prepare)
- **COMPLETED**: Payment received, access granted
- **FAILED**: Cancelled or refunded

## Examples

- [`examples/hono-cloudflare/`](examples/hono-cloudflare/) — Cloudflare Workers + Hono + D1
- [`examples/express-node/`](examples/express-node/) — Node.js + Express
- [`examples/store-adapters/`](examples/store-adapters/) — Reference store implementations

## License

MIT
