-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TieredBundle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'product',
    "productId" TEXT NOT NULL,
    "triggerReference" TEXT,
    "tiersConfig" TEXT NOT NULL DEFAULT '[{"buyQty":1,"freeQty":1,"discountPct":100},{"buyQty":2,"freeQty":3,"discountPct":100},{"buyQty":3,"freeQty":6,"discountPct":100}]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shopId" TEXT NOT NULL,
    "discountId" TEXT,
    "designConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TieredBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumeBundle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'product',
    "productId" TEXT NOT NULL,
    "triggerReference" TEXT,
    "volumeTiers" TEXT NOT NULL DEFAULT '[{"label":"Single","qty":1,"discountPct":0,"popular":false},{"label":"Duo","qty":2,"discountPct":15,"popular":true},{"label":"Trio","qty":3,"discountPct":25,"popular":false}]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shopId" TEXT NOT NULL,
    "discountId" TEXT,
    "designConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolumeBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplementBundle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerReference" TEXT,
    "complements" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'fbt',
    "triggerDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shopId" TEXT NOT NULL,
    "discountId" TEXT,
    "designConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplementBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopBilling" (
    "id" SERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "currentPlan" TEXT NOT NULL DEFAULT 'Free',
    "subscriptionId" TEXT,
    "subscriptionStatus" TEXT,
    "isTrialing" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhookDelivery" (
    "id" SERIAL NOT NULL,
    "webhookId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedRefund" (
    "id" SERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleEvent" (
    "id" SERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "bundleType" TEXT NOT NULL,
    "bundleId" INTEGER,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleOrder" (
    "id" SERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "bundleType" TEXT NOT NULL,
    "bundleId" INTEGER,
    "totalPrice" INTEGER NOT NULL DEFAULT 0,
    "bundleRevenue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopBilling_shopId_key" ON "ShopBilling"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhookDelivery_webhookId_key" ON "ProcessedWebhookDelivery"("webhookId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedRefund_shopId_refundId_key" ON "ProcessedRefund"("shopId", "refundId");

-- CreateIndex
CREATE INDEX "BundleEvent_shopId_eventType_createdAt_idx" ON "BundleEvent"("shopId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "BundleEvent_shopId_createdAt_idx" ON "BundleEvent"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BundleOrder_orderId_key" ON "BundleOrder"("orderId");

-- CreateIndex
CREATE INDEX "BundleOrder_shopId_createdAt_idx" ON "BundleOrder"("shopId", "createdAt");
