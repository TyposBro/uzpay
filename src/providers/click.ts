import type { ClickConfig, ClickWebhookData } from "../types";
import { md5 } from "../utils/crypto";

// =============================================================================
// URL GENERATION
// =============================================================================

const CHECKOUT_URL = "https://my.click.uz/services/pay";

/**
 * Generate Click checkout URL.
 * @param amount - Amount in UZS (So'm), not tiyin.
 */
export function generateClickUrl(
  config: ClickConfig,
  transactionParam: string,
  amount: number,
  returnUrl?: string
): string {
  const url = new URL(CHECKOUT_URL);
  url.searchParams.append("service_id", config.serviceId);
  url.searchParams.append("merchant_id", config.merchantId);
  url.searchParams.append("merchant_user_id", config.merchantUserId);
  url.searchParams.append("amount", amount.toFixed(2));
  url.searchParams.append("transaction_param", transactionParam);
  if (returnUrl) {
    url.searchParams.append("return_url", returnUrl);
  }
  return url.toString();
}

// =============================================================================
// SIGNATURE VERIFICATION
// =============================================================================

/**
 * Verify Click webhook signature using MD5.
 *
 * Formula: md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id
 *   + (merchant_prepare_id if complete) + amount + action + sign_time)
 */
export async function verifyClickSignature(
  secretKey: string,
  data: ClickWebhookData
): Promise<boolean> {
  const {
    click_trans_id,
    service_id,
    merchant_trans_id,
    merchant_prepare_id,
    amount,
    action,
    sign_time,
    sign_string,
  } = data;

  const actionNum = Number(action);
  const prepareIdPart = actionNum === 1 ? merchant_prepare_id || "" : "";
  const rawAmount = String(amount);

  const source = `${click_trans_id}${service_id}${secretKey}${merchant_trans_id}${prepareIdPart}${rawAmount}${action}${sign_time}`;
  const generated = await md5(source);

  return generated === sign_string;
}
