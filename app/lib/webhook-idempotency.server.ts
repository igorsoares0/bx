import db from "../db.server";

export async function registerWebhookDelivery(
  webhookId: string | null,
  shopId: string,
  topic: string,
): Promise<boolean> {
  if (!webhookId) return true;

  try {
    await db.processedWebhookDelivery.create({
      data: { webhookId, shopId, topic },
    });
    return true;
  } catch (e: any) {
    // Unique constraint violation = already processed
    if (e?.code === "P2002") return false;
    throw e;
  }
}

export async function registerRefundProcessing(
  shopId: string,
  refundId: string | null,
  orderId: string | null,
): Promise<boolean> {
  if (!refundId) return true;

  try {
    await db.processedRefund.create({
      data: { shopId, refundId, orderId },
    });
    return true;
  } catch (e: any) {
    // Unique constraint violation = already processed
    if (e?.code === "P2002") return false;
    throw e;
  }
}
