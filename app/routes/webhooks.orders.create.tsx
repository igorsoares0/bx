import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const order = payload as any;
    const orderId = `gid://shopify/Order/${order.id}`;
    const orderName = order.name || `#${order.order_number}`;
    const totalPrice = Math.round(parseFloat(order.total_price || "0") * 100);

    // Check line items for bundle cart attributes (_bxapp_bundle_type)
    const lineItems = order.line_items || [];
    let bundleType: string | null = null;
    let bundleId: number | null = null;
    let bundleRevenue = 0;

    for (const item of lineItems) {
      const props = item.properties || [];
      const btProp = props.find((p: any) => p.name === "_bxapp_bundle_type");
      if (btProp) {
        bundleType = btProp.value;
        const biProp = props.find((p: any) => p.name === "_bxapp_bundle_id");
        if (biProp) bundleId = Number(biProp.value) || null;
        const lineTotal = Math.round(parseFloat(item.price || "0") * 100 * (item.quantity || 1));
        bundleRevenue += lineTotal;
      }
    }

    // Only record if the order contains bundle items
    if (bundleType) {
      await db.bundleOrder.upsert({
        where: { orderId },
        create: {
          shopId: shop,
          orderId,
          orderName,
          bundleType,
          bundleId,
          totalPrice,
          bundleRevenue,
        },
        update: {
          bundleType,
          bundleId,
          totalPrice,
          bundleRevenue,
        },
      });
    }
  } catch (e) {
    console.error("Analytics orders/create webhook error:", e);
  }

  return new Response();
};
