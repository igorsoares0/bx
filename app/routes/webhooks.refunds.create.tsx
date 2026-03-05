import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import {
  buildTrustedDiscountCatalog,
  getTrustedOrderLineItemIds,
} from "../lib/billing-attribution.server";
import {
  registerRefundProcessing,
  registerWebhookDelivery,
} from "../lib/webhook-idempotency.server";

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
    const refund = payload as any;
    const orderId = `gid://shopify/Order/${refund.order_id}`;
    const refundId =
      (typeof refund?.admin_graphql_api_id === "string" && refund.admin_graphql_api_id) ||
      (refund?.id ? String(refund.id) : null);

    const shouldProcessRefund = await registerRefundProcessing(shop, refundId, orderId);
    if (!shouldProcessRefund) {
      console.log(`Skipping duplicate refund ${refundId} for ${shop}`);
      return new Response();
    }

    // Check if we have a BundleOrder record for this order
    const bundleOrder = await db.bundleOrder.findUnique({ where: { orderId } });
    if (!bundleOrder) {
      console.log(`No BundleOrder found for refund on order ${orderId}, skipping`);
      return new Response();
    }

    const { admin } = await unauthenticated.admin(shop);
    const trustedCatalog = await buildTrustedDiscountCatalog(admin, shop);
    const trustedLineItemIds = await getTrustedOrderLineItemIds(admin, orderId, trustedCatalog);

    if (trustedLineItemIds.size === 0) {
      console.log(`No trusted bundle lines found for order ${orderId}, skipping refund adjustment`);
      return new Response();
    }

    // Calculate refunded amount from trusted bundle line items only
    const refundLineItems = refund.refund_line_items || [];
    let refundedBundleAmount = 0;

    for (const refundItem of refundLineItems) {
      const lineItemId =
        (typeof refundItem?.line_item?.admin_graphql_api_id === "string" &&
          refundItem.line_item.admin_graphql_api_id) ||
        (refundItem?.line_item_id ? `gid://shopify/LineItem/${refundItem.line_item_id}` : null);
      if (!lineItemId || !trustedLineItemIds.has(lineItemId)) continue;

      // Calculate the refunded amount for this bundle line item
      const subtotal = Math.round(parseFloat(refundItem.subtotal || "0") * 100);
      refundedBundleAmount += subtotal;
    }

    if (refundedBundleAmount > 0) {
      const newRevenue = Math.max(0, bundleOrder.bundleRevenue - refundedBundleAmount);
      await db.bundleOrder.update({
        where: { orderId },
        data: { bundleRevenue: newRevenue },
      });
      console.log(`Reduced bundleRevenue for order ${orderId} by ${refundedBundleAmount} (${bundleOrder.bundleRevenue} → ${newRevenue})`);
    }
  } catch (e) {
    console.error("refunds/create webhook error:", e);
  }

  return new Response();
};
