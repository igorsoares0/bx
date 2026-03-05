-- CreateTable
CREATE TABLE "ShopBilling" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" TEXT NOT NULL,
    "currentPlan" TEXT NOT NULL DEFAULT 'Free',
    "subscriptionId" TEXT,
    "subscriptionStatus" TEXT,
    "isTrialing" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopBilling_shopId_key" ON "ShopBilling"("shopId");
