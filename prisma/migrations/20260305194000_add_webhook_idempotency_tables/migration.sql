-- CreateTable
CREATE TABLE "ProcessedWebhookDelivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "webhookId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ProcessedRefund" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookDelivery_webhookId_key" ON "ProcessedWebhookDelivery"("webhookId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedRefund_shopId_refundId_key" ON "ProcessedRefund"("shopId", "refundId");
