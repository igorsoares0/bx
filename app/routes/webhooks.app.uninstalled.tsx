import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    // Clean up all shop data to prevent stale state on reinstall
    await Promise.all([
      db.session.deleteMany({ where: { shop } }),
      db.shopBilling.deleteMany({ where: { shopId: shop } }),
      db.tieredBundle.deleteMany({ where: { shopId: shop } }),
      db.volumeBundle.deleteMany({ where: { shopId: shop } }),
      db.complementBundle.deleteMany({ where: { shopId: shop } }),
      db.bundleOrder.deleteMany({ where: { shopId: shop } }),
      db.bundleEvent.deleteMany({ where: { shopId: shop } }),
      db.processedWebhookDelivery.deleteMany({ where: { shopId: shop } }),
      db.processedRefund.deleteMany({ where: { shopId: shop } }),
    ]);
  }

  return new Response();
};
