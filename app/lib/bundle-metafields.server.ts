// ─── Shared metafield helpers ───

async function readProductMetafieldValue(
  admin: any,
  productId: string,
  namespace: string,
  key: string,
): Promise<any | null> {
  const response = await admin.graphql(
    `#graphql
      query getMetafield($ownerId: ID!, $namespace: String!, $key: String!) {
        product(id: $ownerId) {
          metafield(namespace: $namespace, key: $key) {
            value
          }
        }
      }`,
    { variables: { ownerId: productId, namespace, key } },
  );
  const json = await response.json();
  const raw = json.data?.product?.metafield?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ensureArray(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") return [val];
  return [];
}

async function upsertMetafieldArrayEntry(
  admin: any,
  ownerId: string,
  namespace: string,
  key: string,
  bundleId: number,
  entry: Record<string, unknown>,
): Promise<void> {
  const existing = await readProductMetafieldValue(admin, ownerId, namespace, key);
  const arr = ensureArray(existing).filter((e: any) => e.bundleId !== bundleId);
  arr.push({ ...entry, bundleId });
  await admin.graphql(
    `#graphql
      mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [{
          ownerId,
          namespace,
          key,
          type: "json",
          value: JSON.stringify(arr),
        }],
      },
    },
  );
}

async function removeMetafieldArrayEntry(
  admin: any,
  ownerId: string,
  namespace: string,
  key: string,
  bundleId: number,
): Promise<void> {
  const existing = await readProductMetafieldValue(admin, ownerId, namespace, key);
  const arr = ensureArray(existing).filter((e: any) => e.bundleId !== bundleId);
  if (arr.length === 0) {
    await admin.graphql(
      `#graphql
        mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { ownerId }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [{ ownerId, namespace, key }],
        },
      },
    );
  } else {
    await admin.graphql(
      `#graphql
        mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [{
            ownerId,
            namespace,
            key,
            type: "json",
            value: JSON.stringify(arr),
          }],
        },
      },
    );
  }
}

async function getShopGid(admin: any): Promise<string | null> {
  const res = await admin.graphql(
    `#graphql
      query {
        shop {
          id
        }
      }`,
  );
  const json = await res.json();
  return json.data?.shop?.id || null;
}

// ─── Tiered Bundle ───

function buildTieredEntry(
  bundleId: number,
  bundleName: string,
  tiers: Array<{ buyQty: number; freeQty: number; discountPct: number }>,
  designConfig?: Record<string, unknown>,
) {
  return {
    bundleId,
    bundleName,
    tiers,
    designAccentColor: designConfig?.accentColor ?? null,
    designBackgroundColor: designConfig?.backgroundColor ?? null,
    designTextColor: designConfig?.textColor ?? null,
    designButtonColor: designConfig?.buttonColor ?? null,
    designButtonTextColor: designConfig?.buttonTextColor ?? null,
    designBorderRadius: designConfig?.borderRadius ?? null,
    designHeaderText: designConfig?.headerText ?? null,
    designGiftText: designConfig?.giftText ?? null,
    designCardLayout: designConfig?.cardLayout ?? "vertical",
    showVariants: designConfig?.showVariants ?? true,
    designHeaderFontSize: designConfig?.headerFontSize ?? 18,
    designHeaderAlignment: designConfig?.headerAlignment ?? "center",
    designButtonText: designConfig?.buttonText ?? "Add Bundle to Cart",
    designTierStyle: designConfig?.tierStyle ?? "card",
    designPadding: designConfig?.padding ?? 20,
    designShowBadge: designConfig?.showBadge ?? true,
    designBadgeStyle: designConfig?.badgeStyle ?? "square",
    designShowProductImage: designConfig?.showProductImage ?? true,
    designImageSize: designConfig?.imageSize ?? 64,
    designBorderStyle: designConfig?.borderStyle ?? "solid",
    designBorderColor: designConfig?.borderColor ?? "#e5e5e5",
    designSelectedTierBg: designConfig?.selectedTierBg ?? "",
    designButtonBorderRadius: designConfig?.buttonBorderRadius ?? 8,
    designShadowIntensity: designConfig?.shadowIntensity ?? "none",
  };
}

/**
 * Writes tiered bundle config metafield to one or more products (array-safe).
 */
export async function setTieredBundleMetafield(
  admin: any,
  {
    bundleId,
    productIds,
    bundleName,
    tiers,
    designConfig,
  }: {
    bundleId: number;
    productIds: string[];
    bundleName: string;
    tiers: Array<{ buyQty: number; freeQty: number; discountPct: number }>;
    designConfig?: Record<string, unknown>;
  },
) {
  const entry = buildTieredEntry(bundleId, bundleName, tiers, designConfig);
  for (const productId of productIds) {
    await upsertMetafieldArrayEntry(admin, productId, "bxgy_bundle", "tiered_config", bundleId, entry);
  }
}

/**
 * Writes tiered bundle configs to a shop-level metafield (for collection/all triggers).
 */
export async function setShopTieredBundleMetafield(
  admin: any,
  shopId: string,
  db: any,
) {
  const bundles = await db.tieredBundle.findMany({
    where: { shopId, active: true, triggerType: { not: "product" } },
    orderBy: { id: "asc" },
  });

  const configs = [];
  for (const bundle of bundles) {
    let tiers: Array<{ buyQty: number; freeQty: number; discountPct: number }> = [];
    try {
      tiers = JSON.parse(bundle.tiersConfig || "[]");
    } catch {}

    const designConfig = bundle.designConfig ? JSON.parse(bundle.designConfig) : {};

    configs.push({
      id: bundle.id,
      name: bundle.name,
      triggerType: bundle.triggerType,
      triggerReference: bundle.triggerReference,
      bundleName: bundle.name,
      tiers,
      designAccentColor: designConfig?.accentColor ?? null,
      designBackgroundColor: designConfig?.backgroundColor ?? null,
      designTextColor: designConfig?.textColor ?? null,
      designButtonColor: designConfig?.buttonColor ?? null,
      designButtonTextColor: designConfig?.buttonTextColor ?? null,
      designBorderRadius: designConfig?.borderRadius ?? null,
      designHeaderText: designConfig?.headerText ?? null,
      designGiftText: designConfig?.giftText ?? null,
      designCardLayout: designConfig?.cardLayout ?? "vertical",
      showVariants: designConfig?.showVariants ?? true,
      designHeaderFontSize: designConfig?.headerFontSize ?? 18,
      designHeaderAlignment: designConfig?.headerAlignment ?? "center",
      designButtonText: designConfig?.buttonText ?? "Add Bundle to Cart",
      designTierStyle: designConfig?.tierStyle ?? "card",
      designPadding: designConfig?.padding ?? 20,
      designShowBadge: designConfig?.showBadge ?? true,
      designBadgeStyle: designConfig?.badgeStyle ?? "square",
      designShowProductImage: designConfig?.showProductImage ?? true,
      designImageSize: designConfig?.imageSize ?? 64,
      designBorderStyle: designConfig?.borderStyle ?? "solid",
      designBorderColor: designConfig?.borderColor ?? "#e5e5e5",
      designSelectedTierBg: designConfig?.selectedTierBg ?? "",
      designButtonBorderRadius: designConfig?.buttonBorderRadius ?? 8,
      designShadowIntensity: designConfig?.shadowIntensity ?? "none",
    });
  }

  const shopGid = await getShopGid(admin);
  if (!shopGid) return;

  await admin.graphql(
    `#graphql
      mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopGid,
            namespace: "bxgy_bundle",
            key: "tiered_bundles",
            type: "json",
            value: JSON.stringify(configs),
          },
        ],
      },
    },
  );
}

/**
 * Removes the tiered bundle metafield entry from one or more products (array-safe).
 */
export async function removeTieredBundleMetafield(
  admin: any,
  productIds: string | string[],
  bundleId: number,
) {
  const ids = Array.isArray(productIds) ? productIds : [productIds];
  for (const productId of ids) {
    await removeMetafieldArrayEntry(admin, productId, "bxgy_bundle", "tiered_config", bundleId);
  }
}

// ─── Volume Bundle ───

function buildVolumeEntry(
  bundleId: number,
  bundleName: string,
  volumeTiers: Array<{ label: string; qty: number; discountPct: number; popular: boolean }>,
  designConfig?: Record<string, unknown>,
) {
  return {
    bundleId,
    bundleName,
    volumeTiers,
    designAccentColor: designConfig?.accentColor ?? null,
    designBackgroundColor: designConfig?.backgroundColor ?? null,
    designTextColor: designConfig?.textColor ?? null,
    designButtonColor: designConfig?.buttonColor ?? null,
    designButtonTextColor: designConfig?.buttonTextColor ?? null,
    designBorderRadius: designConfig?.borderRadius ?? null,
    designHeaderText: designConfig?.headerText ?? null,
    designBadgeText: designConfig?.badgeText ?? null,
    designCardLayout: designConfig?.cardLayout ?? "vertical",
    showVariants: designConfig?.showVariants ?? true,
  };
}

/**
 * Writes volume bundle config metafield to one or more products (array-safe).
 */
export async function setVolumeBundleMetafield(
  admin: any,
  {
    bundleId,
    productIds,
    bundleName,
    volumeTiers,
    designConfig,
  }: {
    bundleId: number;
    productIds: string[];
    bundleName: string;
    volumeTiers: Array<{ label: string; qty: number; discountPct: number; popular: boolean }>;
    designConfig?: Record<string, unknown>;
  },
) {
  const entry = buildVolumeEntry(bundleId, bundleName, volumeTiers, designConfig);
  for (const productId of productIds) {
    await upsertMetafieldArrayEntry(admin, productId, "bxgy_bundle", "volume_config", bundleId, entry);
  }
}

/**
 * Writes volume bundle configs to a shop-level metafield (for collection/all triggers).
 */
export async function setShopVolumeBundleMetafield(
  admin: any,
  shopId: string,
  db: any,
) {
  const bundles = await db.volumeBundle.findMany({
    where: { shopId, active: true, triggerType: { not: "product" } },
    orderBy: { id: "asc" },
  });

  const configs = [];
  for (const bundle of bundles) {
    let volumeTiers: Array<{ label: string; qty: number; discountPct: number; popular: boolean }> = [];
    try {
      volumeTiers = JSON.parse(bundle.volumeTiers || "[]");
    } catch {}

    const designConfig = bundle.designConfig ? JSON.parse(bundle.designConfig) : {};

    configs.push({
      id: bundle.id,
      name: bundle.name,
      triggerType: bundle.triggerType,
      triggerReference: bundle.triggerReference,
      bundleName: bundle.name,
      volumeTiers,
      designAccentColor: designConfig?.accentColor ?? null,
      designBackgroundColor: designConfig?.backgroundColor ?? null,
      designTextColor: designConfig?.textColor ?? null,
      designButtonColor: designConfig?.buttonColor ?? null,
      designButtonTextColor: designConfig?.buttonTextColor ?? null,
      designBorderRadius: designConfig?.borderRadius ?? null,
      designHeaderText: designConfig?.headerText ?? null,
      designBadgeText: designConfig?.badgeText ?? null,
      designCardLayout: designConfig?.cardLayout ?? "vertical",
      showVariants: designConfig?.showVariants ?? true,
    });
  }

  const shopGid = await getShopGid(admin);
  if (!shopGid) return;

  await admin.graphql(
    `#graphql
      mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopGid,
            namespace: "bxgy_bundle",
            key: "volume_bundles",
            type: "json",
            value: JSON.stringify(configs),
          },
        ],
      },
    },
  );
}

/**
 * Removes the volume bundle metafield entry from one or more products (array-safe).
 */
export async function removeVolumeBundleMetafield(
  admin: any,
  productIds: string | string[],
  bundleId: number,
) {
  const ids = Array.isArray(productIds) ? productIds : [productIds];
  for (const productId of ids) {
    await removeMetafieldArrayEntry(admin, productId, "bxgy_bundle", "volume_config", bundleId);
  }
}

/**
 * Writes complement/FBT bundle config metafield to the trigger product (array-safe).
 * Fetches fresh variant IDs from the Shopify API to ensure correctness.
 */
export async function setComplementBundleMetafield(
  admin: any,
  {
    bundleId,
    productId,
    bundleName,
    complements,
    designConfig,
    mode,
    triggerDiscountPct,
  }: {
    bundleId: number;
    productId: string;
    bundleName: string;
    complements: Array<{
      productId: string;
      title: string;
      handle: string;
      image: string;
      price: number;
      variantId: string;
      discountPct: number;
      quantity?: number;
      group?: number;
    }>;
    designConfig?: Record<string, unknown>;
    mode?: string;
    triggerDiscountPct?: number;
  },
) {
  // Fetch fresh product data (variant ID, price, image, handle) for each complement
  const enrichedComplements = [];
  for (const comp of complements) {
    try {
      const res = await admin.graphql(
        `#graphql
          query getProduct($id: ID!) {
            product(id: $id) {
              title
              handle
              featuredImage { url }
              variants(first: 1) {
                edges { node { id price } }
              }
            }
          }`,
        { variables: { id: comp.productId } },
      );
      const json = await res.json();
      const product = json.data?.product;
      const variantGid = product?.variants?.edges?.[0]?.node?.id || "";
      const numericVariantId = variantGid.replace("gid://shopify/ProductVariant/", "");
      const priceCents = product?.variants?.edges?.[0]?.node?.price
        ? Math.round(parseFloat(product.variants.edges[0].node.price) * 100)
        : comp.price;

      enrichedComplements.push({
        productId: comp.productId,
        title: product?.title || comp.title,
        handle: product?.handle || comp.handle,
        image: product?.featuredImage?.url || comp.image,
        price: priceCents,
        variantId: numericVariantId,
        discountPct: comp.discountPct,
        quantity: comp.quantity || 1,
        group: comp.group ?? 0,
      });
    } catch {
      // Fallback to original data
      enrichedComplements.push(comp);
    }
  }

  const entry: Record<string, unknown> = {
    bundleId,
    bundleName,
    complements: enrichedComplements,
    mode: mode || "fbt",
    triggerDiscountPct: triggerDiscountPct || 0,
    designAccentColor: designConfig?.accentColor ?? null,
    designBackgroundColor: designConfig?.backgroundColor ?? null,
    designTextColor: designConfig?.textColor ?? null,
    designButtonColor: designConfig?.buttonColor ?? null,
    designButtonTextColor: designConfig?.buttonTextColor ?? null,
    designBorderRadius: designConfig?.borderRadius ?? null,
    designHeaderText: designConfig?.headerText ?? null,
    designCardLayout: designConfig?.cardLayout ?? "vertical",
    showVariants: designConfig?.showVariants ?? true,
  };

  await upsertMetafieldArrayEntry(admin, productId, "bxgy_bundle", "complement_config", bundleId, entry);
}

/**
 * Writes complement/FBT bundle config to a shop-level metafield (for collection/all triggers).
 */
export async function setShopComplementBundleMetafield(
  admin: any,
  shopId: string,
  db: any,
) {
  const bundles = await db.complementBundle.findMany({
    where: { shopId, active: true, triggerType: { not: "product" } },
    orderBy: { id: "asc" },
  });

  const configs = [];
  for (const bundle of bundles) {
    let complements: Array<{
      productId: string;
      title: string;
      handle: string;
      image: string;
      price: number;
      variantId: string;
      discountPct: number;
      quantity?: number;
    }> = [];
    try {
      complements = JSON.parse(bundle.complements || "[]");
    } catch {}

    const designConfig = bundle.designConfig ? JSON.parse(bundle.designConfig) : {};

    configs.push({
      id: bundle.id,
      name: bundle.name,
      triggerType: bundle.triggerType,
      triggerReference: bundle.triggerReference,
      complements,
      mode: bundle.mode || "fbt",
      triggerDiscountPct: bundle.triggerDiscountPct || 0,
      designAccentColor: designConfig?.accentColor ?? null,
      designBackgroundColor: designConfig?.backgroundColor ?? null,
      designTextColor: designConfig?.textColor ?? null,
      designButtonColor: designConfig?.buttonColor ?? null,
      designButtonTextColor: designConfig?.buttonTextColor ?? null,
      designBorderRadius: designConfig?.borderRadius ?? null,
      designHeaderText: designConfig?.headerText ?? null,
      designCardLayout: designConfig?.cardLayout ?? "vertical",
      showVariants: designConfig?.showVariants ?? true,
    });
  }

  const shopGid = await getShopGid(admin);
  if (!shopGid) return;

  await admin.graphql(
    `#graphql
      mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopGid,
            namespace: "bxgy_bundle",
            key: "complement_bundles",
            type: "json",
            value: JSON.stringify(configs),
          },
        ],
      },
    },
  );
}

/**
 * Removes the complement bundle metafield entry from the trigger product (array-safe).
 */
export async function removeComplementBundleMetafield(
  admin: any,
  productId: string,
  bundleId: number,
) {
  await removeMetafieldArrayEntry(admin, productId, "bxgy_bundle", "complement_config", bundleId);
}

