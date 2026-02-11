/**
 * Currency conversion utilities for Uzbek Som (UZS)
 * UZS: 1 So'm = 100 Tiyin
 */

export const TIYIN_PER_UZS = 100;

/** Convert UZS (So'm) to Tiyin. Used for Payme, Paynet (both expect tiyin). */
export function uzsToTiyin(uzs: number): number {
  return Math.round(uzs * TIYIN_PER_UZS);
}

/** Convert Tiyin to UZS (So'm). Used for Click webhooks, Paynet display. */
export function tiyinToUzs(tiyin: number): number {
  return tiyin / TIYIN_PER_UZS;
}
