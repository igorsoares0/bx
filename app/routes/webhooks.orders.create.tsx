import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import { enforceRevenueLimits } from "../lib/billing.server";
import {
  buildTrustedDiscountCatalog,
  calculateBundleRevenueFromOrderPayload,
} from "../lib/billing-attribution.server";
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

  try {
    const order = payload as any;
    const orderId = `gid://shopify/Order/${order.id}`;
    const orderName = order.name || `#${order.order_number}`;
    const totalPrice = Math.round(parseFloat(order.total_price || "0") * 100);

    const { admin } = await unauthenticated.admin(shop);
    const trustedCatalog = await buildTrustedDiscountCatalog(admin, shop);
    const {
      bundleRevenue,
      bundleType,
      bundleId,
    } = calculateBundleRevenueFromOrderPayload(order, trustedCatalog);

    // Only record if trusted Shopify discount data identifies bundle revenue
    if (bundleRevenue > 0) {
      await db.bundleOrder.upsert({
        where: { orderId },
        create: {
          shopId: shop,
          orderId,
          orderName,
          bundleType: bundleType || "unknown",
          bundleId,
          totalPrice,
          bundleRevenue,
        },
        update: {
          bundleType: bundleType || "unknown",
          bundleId,
          totalPrice,
          bundleRevenue,
        },
      });

      // Enforce revenue limits after recording the order
      try {
        await enforceRevenueLimits(admin, shop);
      } catch (e) {
        console.error(`Failed to enforce revenue limits for ${shop}:`, e);
      }
    }
  } catch (e) {
    console.error("Analytics orders/create webhook error:", e);
  }

  return new Response();
};
