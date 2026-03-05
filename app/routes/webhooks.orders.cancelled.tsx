import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
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

    // Zero out the bundleRevenue for the cancelled order
    const existing = await db.bundleOrder.findUnique({ where: { orderId } });
    if (existing) {
      await db.bundleOrder.update({
        where: { orderId },
        data: { bundleRevenue: 0 },
      });
      console.log(`Zeroed bundleRevenue for cancelled order ${orderId} (was ${existing.bundleRevenue})`);
    }
  } catch (e) {
    console.error("orders/cancelled webhook error:", e);
  }

  return new Response();
};
