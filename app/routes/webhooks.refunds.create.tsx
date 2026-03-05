import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const refund = payload as any;
    const orderId = `gid://shopify/Order/${refund.order_id}`;

    // Check if we have a BundleOrder record for this order
    const bundleOrder = await db.bundleOrder.findUnique({ where: { orderId } });
    if (!bundleOrder) {
      console.log(`No BundleOrder found for refund on order ${orderId}, skipping`);
      return new Response();
    }

    // Calculate refunded amount from bundle items only
    const refundLineItems = refund.refund_line_items || [];
    let refundedBundleAmount = 0;

    for (const refundItem of refundLineItems) {
      const lineItem = refundItem.line_item;
      if (!lineItem) continue;

      // Check if this line item belongs to a bundle
      const props = lineItem.properties || [];
      const isBundleItem = props.some((p: any) => p.name === "_bxapp_bundle_type");
      if (!isBundleItem) continue;

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
