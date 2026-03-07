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
import {
  removeTieredBundleMetafield,
  removeVolumeBundleMetafield,
  removeComplementBundleMetafield,
  setTieredBundleMetafield,
  setVolumeBundleMetafield,
  setComplementBundleMetafield,
  setShopTieredBundleMetafield,
  setShopVolumeBundleMetafield,
  setShopComplementBundleMetafield,
} from "./bundle-metafields.server";

export { ALL_PLANS, PAID_PLANS, PLAN_LIMITS, PLAN_PRICES, PLAN_DESCRIPTIONS };

/**
 * Parse productId field that can be a JSON array of GIDs or a single GID string.
 */
export function parseProductIds(field: string): string[] {
  try {
    const parsed = JSON.parse(field);
    return Array.isArray(parsed) ? parsed : [field];
  } catch {
    return field ? [field] : [];
  }
}

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
 * Sync billing status from Shopify GraphQL to the ShopBilling table.
 */
export async function syncShopBilling(admin: any, shopId: string) {
  let currentPlan = FREE_PLAN;
  let subscriptionId: string | null = null;
  let subscriptionStatus: string | null = null;
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
              createdAt
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
        subscriptionStatus = sub.status;
        if (sub.trialDays > 0 && sub.createdAt) {
          const trialEndsAt = new Date(sub.createdAt);
          trialEndsAt.setDate(trialEndsAt.getDate() + sub.trialDays);
          isTrialing = sub.status === "ACTIVE" && new Date() < trialEndsAt;
        }
      }
    }
  } catch (e) {
    console.error("Failed to sync billing status:", e);
    return null;
  }

  return db.shopBilling.upsert({
    where: { shopId },
    create: {
      shopId,
      currentPlan,
      subscriptionId,
      subscriptionStatus,
      isTrialing,
      lastSyncedAt: new Date(),
    },
    update: {
      currentPlan,
      subscriptionId,
      subscriptionStatus,
      isTrialing,
      lastSyncedAt: new Date(),
    },
  });
}

/**
 * Deactivate all active bundles for a shop: set active=false, pause discounts,
 * remove product metafields, refresh shop-level metafields.
 */
export async function deactivateAllBundles(admin: any, shopId: string) {
  const [tieredBundles, volumeBundles, complementBundles] = await Promise.all([
    db.tieredBundle.findMany({ where: { shopId, active: true } }),
    db.volumeBundle.findMany({ where: { shopId, active: true } }),
    db.complementBundle.findMany({ where: { shopId, active: true } }),
  ]);

  // Batch-deactivate all bundles in DB (3 queries instead of N)
  await Promise.all([
    db.tieredBundle.updateMany({ where: { shopId, active: true }, data: { active: false } }),
    db.volumeBundle.updateMany({ where: { shopId, active: true }, data: { active: false } }),
    db.complementBundle.updateMany({ where: { shopId, active: true }, data: { active: false } }),
  ]);

  const now = new Date().toISOString();
  const pauseDiscountMutation = `#graphql
    mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
      discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
        userErrors { field message }
      }
    }`;

  // Collect all GraphQL operations to run in parallel
  const ops: Promise<any>[] = [];

  for (const bundle of tieredBundles) {
    if (bundle.discountId) {
      ops.push(
        admin.graphql(pauseDiscountMutation, {
          variables: { id: bundle.discountId, automaticAppDiscount: { endsAt: now } },
        }).catch((e: any) => console.error(`Failed to pause tiered discount ${bundle.discountId}:`, e)),
      );
    }
    const productIds = parseProductIds(bundle.productId);
    if (productIds.length > 0) {
      ops.push(
        removeTieredBundleMetafield(admin, productIds, bundle.id)
          .catch((e: any) => console.error(`Failed to remove tiered metafield for bundle ${bundle.id}:`, e)),
      );
    }
  }

  for (const bundle of volumeBundles) {
    if (bundle.discountId) {
      ops.push(
        admin.graphql(pauseDiscountMutation, {
          variables: { id: bundle.discountId, automaticAppDiscount: { endsAt: now } },
        }).catch((e: any) => console.error(`Failed to pause volume discount ${bundle.discountId}:`, e)),
      );
    }
    const productIds = parseProductIds(bundle.productId);
    if (productIds.length > 0) {
      ops.push(
        removeVolumeBundleMetafield(admin, productIds, bundle.id)
          .catch((e: any) => console.error(`Failed to remove volume metafield for bundle ${bundle.id}:`, e)),
      );
    }
  }

  for (const bundle of complementBundles) {
    if (bundle.discountId) {
      ops.push(
        admin.graphql(pauseDiscountMutation, {
          variables: { id: bundle.discountId, automaticAppDiscount: { endsAt: now } },
        }).catch((e: any) => console.error(`Failed to pause complement discount ${bundle.discountId}:`, e)),
      );
    }
    if (bundle.triggerType === "product" && bundle.triggerReference) {
      ops.push(
        removeComplementBundleMetafield(admin, bundle.triggerReference, bundle.id)
          .catch((e: any) => console.error(`Failed to remove complement metafield for bundle ${bundle.id}:`, e)),
      );
    }
  }

  // Run all GraphQL operations in parallel
  await Promise.allSettled(ops);

  // Refresh shop-level metafields
  await Promise.all([
    setShopTieredBundleMetafield(admin, shopId, db),
    setShopVolumeBundleMetafield(admin, shopId, db),
    setShopComplementBundleMetafield(admin, shopId, db),
  ]).catch((e) => console.error("Failed to refresh shop-level metafields:", e));

  console.log(`Deactivated all bundles for shop ${shopId}: ${tieredBundles.length} tiered, ${volumeBundles.length} volume, ${complementBundles.length} complement`);
}

/**
 * Reactivate all inactive bundles for a shop: set active=true, resume discounts,
 * restore product metafields, refresh shop-level metafields.
 */
export async function reactivateAllBundles(admin: any, shopId: string) {
  const [tieredBundles, volumeBundles, complementBundles] = await Promise.all([
    db.tieredBundle.findMany({ where: { shopId, active: false } }),
    db.volumeBundle.findMany({ where: { shopId, active: false } }),
    db.complementBundle.findMany({ where: { shopId, active: false } }),
  ]);

  if (tieredBundles.length === 0 && volumeBundles.length === 0 && complementBundles.length === 0) {
    return;
  }

  // Batch-activate all bundles in DB
  await Promise.all([
    db.tieredBundle.updateMany({ where: { shopId, active: false }, data: { active: true } }),
    db.volumeBundle.updateMany({ where: { shopId, active: false }, data: { active: true } }),
    db.complementBundle.updateMany({ where: { shopId, active: false }, data: { active: true } }),
  ]);

  const resumeDiscountMutation = `#graphql
    mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
      discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
        userErrors { field message }
      }
    }`;

  const ops: Promise<any>[] = [];
  const now = new Date().toISOString();

  for (const bundle of tieredBundles) {
    if (bundle.discountId) {
      ops.push(
        admin.graphql(resumeDiscountMutation, {
          variables: { id: bundle.discountId, automaticAppDiscount: { startsAt: now, endsAt: null } },
        }).catch((e: any) => console.error(`Failed to resume tiered discount ${bundle.discountId}:`, e)),
      );
    }
    if (bundle.triggerType === "product" || !bundle.triggerType) {
      const productIds = parseProductIds(bundle.productId);
      if (productIds.length > 0) {
        let tiers: Array<{ buyQty: number; freeQty: number; discountPct: number }> = [];
        try { tiers = JSON.parse(bundle.tiersConfig || "[]"); } catch {}
        const designConfig = bundle.designConfig ? JSON.parse(bundle.designConfig) : null;
        ops.push(
          setTieredBundleMetafield(admin, { bundleId: bundle.id, productIds, bundleName: bundle.name, tiers, designConfig })
            .catch((e: any) => console.error(`Failed to restore tiered metafield for bundle ${bundle.id}:`, e)),
        );
      }
    }
  }

  for (const bundle of volumeBundles) {
    if (bundle.discountId) {
      ops.push(
        admin.graphql(resumeDiscountMutation, {
          variables: { id: bundle.discountId, automaticAppDiscount: { startsAt: now, endsAt: null } },
        }).catch((e: any) => console.error(`Failed to resume volume discount ${bundle.discountId}:`, e)),
      );
    }
    if (bundle.triggerType === "product" || !bundle.triggerType) {
      const productIds = parseProductIds(bundle.productId);
      if (productIds.length > 0) {
        let volumeTiers: Array<{ label: string; qty: number; discountPct: number; popular: boolean }> = [];
        try { volumeTiers = JSON.parse(bundle.volumeTiers || "[]"); } catch {}
        const designConfig = bundle.designConfig ? JSON.parse(bundle.designConfig) : null;
        ops.push(
          setVolumeBundleMetafield(admin, { bundleId: bundle.id, productIds, bundleName: bundle.name, volumeTiers, designConfig })
            .catch((e: any) => console.error(`Failed to restore volume metafield for bundle ${bundle.id}:`, e)),
        );
      }
    }
  }

  for (const bundle of complementBundles) {
    if (bundle.discountId) {
      ops.push(
        admin.graphql(resumeDiscountMutation, {
          variables: { id: bundle.discountId, automaticAppDiscount: { startsAt: now, endsAt: null } },
        }).catch((e: any) => console.error(`Failed to resume complement discount ${bundle.discountId}:`, e)),
      );
    }
    if (bundle.triggerType === "product" && bundle.triggerReference) {
      let complements: Array<any> = [];
      try { complements = JSON.parse(bundle.complements || "[]"); } catch {}
      const designConfig = bundle.designConfig ? JSON.parse(bundle.designConfig) : null;
      ops.push(
        setComplementBundleMetafield(admin, {
          bundleId: bundle.id,
          productId: bundle.triggerReference,
          bundleName: bundle.name,
          complements,
          designConfig,
          mode: bundle.mode || "fbt",
          triggerDiscountPct: bundle.triggerDiscountPct || 0,
        }).catch((e: any) => console.error(`Failed to restore complement metafield for bundle ${bundle.id}:`, e)),
      );
    }
  }

  await Promise.allSettled(ops);

  // Refresh shop-level metafields
  await Promise.all([
    setShopTieredBundleMetafield(admin, shopId, db),
    setShopVolumeBundleMetafield(admin, shopId, db),
    setShopComplementBundleMetafield(admin, shopId, db),
  ]).catch((e) => console.error("Failed to refresh shop-level metafields:", e));

  console.log(`Reactivated all bundles for shop ${shopId}: ${tieredBundles.length} tiered, ${volumeBundles.length} volume, ${complementBundles.length} complement`);
}

/**
 * Check revenue vs plan limit and deactivate all bundles if over limit.
 * Uses ShopBilling DB record for plan info.
 */
export async function enforceRevenueLimits(admin: any, shopId: string) {
  const billing = await syncShopBilling(admin, shopId);
  if (!billing) return;

  const monthlyRevenue = await getMonthlyBundleRevenue(shopId);
  const revenueLimit = getPlanRevenueLimit(billing.currentPlan);

  if (revenueLimit !== Infinity && monthlyRevenue >= revenueLimit) {
    console.log(`Shop ${shopId} over limit: ${monthlyRevenue} >= ${revenueLimit} (plan: ${billing.currentPlan})`);
    await deactivateAllBundles(admin, shopId);
  }
}

/**
 * Get comprehensive billing status for a shop.
 * Delegates to syncShopBilling for the GraphQL query and DB sync,
 * then computes revenue metrics on top.
 */
export async function getShopBillingStatus(
  admin: any,
  shopId: string,
): Promise<BillingStatus> {
  const billing = await syncShopBilling(admin, shopId);

  const currentPlan = billing?.currentPlan ?? FREE_PLAN;
  const subscriptionId = billing?.subscriptionId ?? null;
  const isTrialing = billing?.isTrialing ?? false;

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
