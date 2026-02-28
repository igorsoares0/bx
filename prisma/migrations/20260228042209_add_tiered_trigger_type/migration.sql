/*
  Warnings:

  - You are about to drop the `Bundle` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Bundle";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "TieredBundle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'product',
    "productId" TEXT NOT NULL,
    "triggerReference" TEXT,
    "tiersConfig" TEXT NOT NULL DEFAULT '[{"buyQty":1,"freeQty":1,"discountPct":100},{"buyQty":2,"freeQty":3,"discountPct":100},{"buyQty":3,"freeQty":6,"discountPct":100}]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shopId" TEXT NOT NULL,
    "discountId" TEXT,
    "designConfig" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VolumeBundle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "volumeTiers" TEXT NOT NULL DEFAULT '[{"label":"Single","qty":1,"discountPct":0,"popular":false},{"label":"Duo","qty":2,"discountPct":15,"popular":true},{"label":"Trio","qty":3,"discountPct":25,"popular":false}]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shopId" TEXT NOT NULL,
    "discountId" TEXT,
    "designConfig" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ComplementBundle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
