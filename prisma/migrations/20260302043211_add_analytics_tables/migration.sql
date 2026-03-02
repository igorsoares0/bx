-- CreateTable
CREATE TABLE "BundleEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "bundleType" TEXT NOT NULL,
    "bundleId" INTEGER,
    "productId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BundleOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "bundleType" TEXT NOT NULL,
    "bundleId" INTEGER,
    "totalPrice" INTEGER NOT NULL DEFAULT 0,
    "bundleRevenue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VolumeBundle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'product',
    "productId" TEXT NOT NULL,
    "triggerReference" TEXT,
    "volumeTiers" TEXT NOT NULL DEFAULT '[{"label":"Single","qty":1,"discountPct":0,"popular":false},{"label":"Duo","qty":2,"discountPct":15,"popular":true},{"label":"Trio","qty":3,"discountPct":25,"popular":false}]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shopId" TEXT NOT NULL,
    "discountId" TEXT,
    "designConfig" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VolumeBundle" ("active", "createdAt", "designConfig", "discountId", "id", "name", "productId", "shopId", "updatedAt", "volumeTiers") SELECT "active", "createdAt", "designConfig", "discountId", "id", "name", "productId", "shopId", "updatedAt", "volumeTiers" FROM "VolumeBundle";
DROP TABLE "VolumeBundle";
ALTER TABLE "new_VolumeBundle" RENAME TO "VolumeBundle";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BundleEvent_shopId_eventType_createdAt_idx" ON "BundleEvent"("shopId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "BundleEvent_shopId_createdAt_idx" ON "BundleEvent"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BundleOrder_orderId_key" ON "BundleOrder"("orderId");

-- CreateIndex
CREATE INDEX "BundleOrder_shopId_createdAt_idx" ON "BundleOrder"("shopId", "createdAt");
