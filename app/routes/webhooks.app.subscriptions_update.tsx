import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { PAID_PLANS, FREE_PLAN } from "../lib/plans";
import { deactivateAllBundles, enforceRevenueLimits } from "../lib/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const subscription = (payload as any)?.app_subscription;
  if (!subscription) {
    console.log("No app_subscription in payload, skipping");
    return new Response();
  }

  const name = subscription.name || null;
  const status = (subscription.status || "").toUpperCase();
  const subscriptionGid = subscription.admin_graphql_api_id || null;

  console.log(`Subscription update: ${name} → ${status} (${subscriptionGid})`);

  // Determine plan name
  const currentPlan = name && PAID_PLANS.includes(name as any) ? name : FREE_PLAN;

  // Upsert billing record
  try {
    await db.shopBilling.upsert({
      where: { shopId: shop },
      create: {
        shopId: shop,
        currentPlan,
        subscriptionId: subscriptionGid,
        subscriptionStatus: status,
        isTrialing: status === "ACTIVE" && (subscription.trial_days > 0 || false),
        lastSyncedAt: new Date(),
      },
      update: {
        currentPlan,
        subscriptionId: subscriptionGid,
        subscriptionStatus: status,
        isTrialing: status === "ACTIVE" && (subscription.trial_days > 0 || false),
        lastSyncedAt: new Date(),
      },
    });
  } catch (e) {
    console.error("Failed to upsert ShopBilling:", e);
  }

  // Handle subscription status changes that require bundle deactivation
  const cancelledStatuses = ["CANCELLED", "EXPIRED", "FROZEN", "DECLINED"];
  if (cancelledStatuses.includes(status)) {
    try {
      const { admin } = await unauthenticated.admin(shop);

      // Before deactivating, check if there's still an active subscription via GraphQL.
      // When a merchant changes plans, Shopify sends CANCELLED for the old and ACTIVE
      // for the new simultaneously — we must not deactivate bundles during a plan switch.
      let hasActiveSubscription = false;
      try {
        const response = await admin.graphql(
          `#graphql
            query {
              currentAppInstallation {
                activeSubscriptions {
                  id
                  name
                  status
                }
              }
            }`,
        );
        const data = await response.json();
        const subs = data?.data?.currentAppInstallation?.activeSubscriptions || [];
        hasActiveSubscription = subs.some(
          (s: any) => s.id !== subscriptionGid && PAID_PLANS.includes(s.name),
        );
      } catch (e) {
        console.error(`Failed to check active subscriptions for ${shop}:`, e);
      }

      if (hasActiveSubscription) {
        console.log(`Subscription ${status} for ${shop} but another active subscription exists — skipping deactivation (plan switch)`);
      } else {
        console.log(`Subscription ${status} for ${shop} — deactivating all bundles`);
        await deactivateAllBundles(admin, shop);
      }
    } catch (e) {
      console.error(`Failed to handle ${status} for ${shop}:`, e);
    }
  }

  // Handle plan change (e.g. downgrade) — enforce revenue limits
  if (status === "ACTIVE") {
    try {
      const { admin } = await unauthenticated.admin(shop);
      await enforceRevenueLimits(admin, shop);
    } catch (e) {
      console.error(`Failed to enforce revenue limits for ${shop}:`, e);
    }
  }

  return new Response();
};
