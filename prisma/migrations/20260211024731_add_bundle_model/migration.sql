-- CreateTable
CREATE TABLE "Bundle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "buyType" TEXT NOT NULL,
    "buyReference" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "getProductId" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "maxReward" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shopId" TEXT NOT NULL,
    "discountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
