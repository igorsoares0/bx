import db from "../db.server";

export async function registerWebhookDelivery(
  webhookId: string | null,
  shopId: string,
  topic: string,
): Promise<boolean> {
  if (!webhookId) return true;

  const inserted = await db.$executeRaw`
    INSERT OR IGNORE INTO "ProcessedWebhookDelivery" ("webhookId", "shopId", "topic", "createdAt")
    VALUES (${webhookId}, ${shopId}, ${topic}, CURRENT_TIMESTAMP)
  `;

  return Number(inserted) > 0;
}

export async function registerRefundProcessing(
  shopId: string,
  refundId: string | null,
  orderId: string | null,
): Promise<boolean> {
  if (!refundId) return true;

  const inserted = await db.$executeRaw`
    INSERT OR IGNORE INTO "ProcessedRefund" ("shopId", "refundId", "orderId", "createdAt")
    VALUES (${shopId}, ${refundId}, ${orderId}, CURRENT_TIMESTAMP)
  `;

  return Number(inserted) > 0;
}
