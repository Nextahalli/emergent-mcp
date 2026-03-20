/**
 * tools/credits.js — Credit balance and usage tracking
 *
 * Uses the Emergent REST API directly (no browser required).
 */

import { getCreditsBalance, getCreditsSummary } from '../api-client.js';

/**
 * emergent_get_credits
 * Get the current credit balance for the Emergent account.
 *
 * Returns full balance details including:
 * - Total ECU (Emergent Credit Units) remaining
 * - Monthly credit balance and refresh date
 * - Daily credit allocation
 * - Subscription plan details
 *
 * @returns {object} {
 *   totalEcu,
 *   monthlyBalance,
 *   dailyCredits,
 *   refreshDate,
 *   plan,
 *   summary  // human-readable string
 * }
 */
export async function getCredits() {
  const b = await getCreditsBalance();
  const summary = await getCreditsSummary();

  return {
    totalEcu: b.ecu_balance,
    monthlyBalance: b.monthly_credits_balance,
    dailyCredits: b.daily_credits,
    refreshDate: b.monthly_credits_refresh_date?.split('T')[0],
    plan: b.subscription?.name,
    planStatus: b.subscription?.status,
    monthlyLimit: b.subscription?.monthly_credit_limit,
    planExpiresAt: b.subscription?.expires_at,
    summary,
    raw: b,
  };
}

/**
 * emergent_get_credit_summary
 * Get a short human-readable credit balance summary.
 *
 * Example: "17.80 ECU (7.80 monthly + 10.00 daily) | Plan: Emergent Standard | Refresh: 2026-03-24"
 *
 * @returns {string}
 */
export async function getCreditSummary() {
  return getCreditsSummary();
}
