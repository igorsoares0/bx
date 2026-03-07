import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { PAID_PLANS, FREE_PLAN, FREE_TIER_LIMIT } from "../lib/plans";
import {
  deactivateAllBundles,
  enforceRevenueLimits,
  getMonthlyBundleRevenue,
  syncShopBilling,
} from "../lib/billing.server";
import { registerWebhookDelivery } from "../lib/webhook-idempotency.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const webhookId = request.headers.get("X-Shopify-Webhook-Id");
  const shouldProcess = await registerWebhookDelivery(webhookId, shop, topic);
  if (!shouldProcess) {
    console.log(`Skipping duplicate webhook ${topic} for ${shop} (${webhookId})`);
    return new Response();
  }

  const subscription = (payload as any)?.app_subscription;
  if (!subscription) {
    console.log("No app_subscription in payload, skipping");
    return new Response();
  }

  const name = subscription.name || null;
  const status = (subscription.status || "").toUpperCase();
  const subscriptionGid = subscription.admin_graphql_api_id || null;

  console.log(`Subscription update: ${name} → ${status} (${subscriptionGid})`);

  let admin: any;
  let syncedBilling: Awaited<ReturnType<typeof syncShopBilling>> | null = null;
  try {
    ({ admin } = await unauthenticated.admin(shop));
    // Source of truth for downgrade/upgrade decisions comes from current active subscriptions.
    syncedBilling = await syncShopBilling(admin, shop);
  } catch (e) {
    console.error(`Failed to sync billing before processing subscription update for ${shop}:`, e);
    return new Response();
  }

  if (!syncedBilling) {
    console.error(`Billing sync returned null for ${shop}, skipping`);
    return new Response();
  }

  const hasActivePaidSubscription =
    syncedBilling.currentPlan !== FREE_PLAN &&
    syncedBilling.subscriptionStatus === "ACTIVE" &&
    PAID_PLANS.includes(syncedBilling.currentPlan as any);

  // Handle subscription status changes that require bundle deactivation
  const cancelledStatuses = ["CANCELLED", "EXPIRED", "FROZEN", "DECLINED"];
  if (cancelledStatuses.includes(status)) {
    if (hasActivePaidSubscription) {
      console.log(`Subscription ${status} for ${shop} but active paid plan exists — skipping deactivation (plan switch)`);
    } else {
      // Only deactivate if revenue exceeds Free tier — shop falls back to Free plan
      try {
        const monthlyRevenue = await getMonthlyBundleRevenue(shop);
        if (monthlyRevenue >= FREE_TIER_LIMIT) {
          console.log(`Subscription ${status} for ${shop} — revenue ${monthlyRevenue} >= Free limit ${FREE_TIER_LIMIT}, deactivating bundles`);
          await deactivateAllBundles(admin, shop);
        } else {
          console.log(`Subscription ${status} for ${shop} — revenue ${monthlyRevenue} within Free tier, keeping bundles active`);
        }
      } catch (e) {
        console.error(`Failed to handle ${status} for ${shop}:`, e);
      }
    }
  }

  // Always enforce limits after syncing active subscriptions to keep downgrade state consistent.
  try {
    await enforceRevenueLimits(admin, shop);
  } catch (e) {
    console.error(`Failed to enforce revenue limits for ${shop}:`, e);
  }

  return new Response();
};
