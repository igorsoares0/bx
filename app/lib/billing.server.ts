import db from "../db.server";
import {
  FREE_PLAN,
  PAID_PLANS,
  ALL_PLANS,
  PLAN_LIMITS,
  PLAN_PRICES,
  PLAN_DESCRIPTIONS,
  FREE_TIER_LIMIT,
} from "./plans";

export { ALL_PLANS, PAID_PLANS, PLAN_LIMITS, PLAN_PRICES, PLAN_DESCRIPTIONS };

/**
 * Calculate total bundle revenue for a shop in the current 30-day billing window.
 * Uses the BundleOrder table (bundleRevenue field, stored in cents).
 */
export async function getMonthlyBundleRevenue(shopId: string): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const result = await db.bundleOrder.aggregate({
    where: {
      shopId,
      createdAt: { gte: since },
    },
    _sum: { bundleRevenue: true },
  });

  return result._sum.bundleRevenue || 0;
}

/**
 * Get the revenue limit (in cents) for a given plan name.
 */
export function getPlanRevenueLimit(planName: string): number {
  return PLAN_LIMITS[planName] ?? 0;
}

export type BillingStatus = {
  currentPlan: string | null;
  subscriptionId: string | null;
  isTrialing: boolean;
  monthlyRevenue: number;    // cents
  revenueLimit: number;      // cents
  usagePercent: number;      // 0–100+
  isOverLimit: boolean;
  isNearLimit: boolean;      // ≥80%
};

/**
 * Get comprehensive billing status for a shop.
 * Uses GraphQL to query active subscriptions (safe for embedded apps — no redirects).
 */
export async function getShopBillingStatus(
  admin: any,
  shopId: string,
): Promise<BillingStatus> {
  let currentPlan: string | null = null;
  let subscriptionId: string | null = null;
  let isTrialing = false;

  try {
    const response = await admin.graphql(
      `#graphql
        query {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
              test
              trialDays
            }
          }
        }`,
    );
    const data = await response.json();
    const subs = data?.data?.currentAppInstallation?.activeSubscriptions || [];

    if (subs.length > 0) {
      const sub = subs[0];
      if (PAID_PLANS.includes(sub.name as any)) {
        currentPlan = sub.name;
        subscriptionId = sub.id;
        isTrialing = sub.status === "ACTIVE" && sub.trialDays > 0;
      }
    }
  } catch (e) {
    console.error("Failed to fetch billing status:", e);
  }

  // Shops without a paid plan get the Free tier
  if (!currentPlan) {
    currentPlan = FREE_PLAN;
  }

  const monthlyRevenue = await getMonthlyBundleRevenue(shopId);
  const revenueLimit = getPlanRevenueLimit(currentPlan);
  const usagePercent = revenueLimit === Infinity ? 0 : revenueLimit > 0
    ? Math.round((monthlyRevenue / revenueLimit) * 100)
    : 100;

  return {
    currentPlan,
    subscriptionId,
    isTrialing,
    monthlyRevenue,
    revenueLimit,
    usagePercent,
    isOverLimit: revenueLimit !== Infinity && monthlyRevenue >= revenueLimit,
    isNearLimit: revenueLimit !== Infinity && usagePercent >= 80 && monthlyRevenue < revenueLimit,
  };
}
