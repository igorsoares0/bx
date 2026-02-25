/**
 * Writes tiered bundle config metafield to the product so the theme extension can display tiers.
 */
export async function setTieredBundleMetafield(
  admin: any,
  {
    productId,
    bundleName,
    tiers,
    designConfig,
  }: {
    productId: string;
    bundleName: string;
    tiers: Array<{ buyQty: number; freeQty: number; discountPct: number }>;
    designConfig?: Record<string, unknown>;
  },
) {
  const metafieldValue = JSON.stringify({
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
  });

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
            ownerId: productId,
            namespace: "bxgy_bundle",
            key: "tiered_config",
            type: "json",
            value: metafieldValue,
          },
        ],
      },
    },
  );
}

/**
 * Removes the tiered bundle metafield from the product.
 */
export async function removeTieredBundleMetafield(
  admin: any,
  productId: string,
) {
  const response = await admin.graphql(
    `#graphql
      query getMetafield($ownerId: ID!, $namespace: String!, $key: String!) {
        product(id: $ownerId) {
          metafield(namespace: $namespace, key: $key) {
            id
          }
        }
      }`,
    {
      variables: {
        ownerId: productId,
        namespace: "bxgy_bundle",
        key: "tiered_config",
      },
    },
  );
  const json = await response.json();
  const metafieldId = json.data?.product?.metafield?.id;

  if (metafieldId) {
    await admin.graphql(
      `#graphql
        mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { ownerId namespace key }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              ownerId: productId,
              namespace: "bxgy_bundle",
              key: "tiered_config",
            },
          ],
        },
      },
    );
  }
}

/**
 * Writes volume bundle config metafield to the product so the theme extension can display volume tiers.
 */
export async function setVolumeBundleMetafield(
  admin: any,
  {
    productId,
    bundleName,
    volumeTiers,
    designConfig,
  }: {
    productId: string;
    bundleName: string;
    volumeTiers: Array<{ label: string; qty: number; discountPct: number; popular: boolean }>;
    designConfig?: Record<string, unknown>;
  },
) {
  const metafieldValue = JSON.stringify({
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
  });

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
            ownerId: productId,
            namespace: "bxgy_bundle",
            key: "volume_config",
            type: "json",
            value: metafieldValue,
          },
        ],
      },
    },
  );
}

/**
 * Removes the volume bundle metafield from the product.
 */
export async function removeVolumeBundleMetafield(
  admin: any,
  productId: string,
) {
  const response = await admin.graphql(
    `#graphql
      query getMetafield($ownerId: ID!, $namespace: String!, $key: String!) {
        product(id: $ownerId) {
          metafield(namespace: $namespace, key: $key) {
            id
          }
        }
      }`,
    {
      variables: {
        ownerId: productId,
        namespace: "bxgy_bundle",
        key: "volume_config",
      },
    },
  );
  const json = await response.json();
  const metafieldId = json.data?.product?.metafield?.id;

  if (metafieldId) {
    await admin.graphql(
      `#graphql
        mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { ownerId namespace key }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              ownerId: productId,
              namespace: "bxgy_bundle",
              key: "volume_config",
            },
          ],
        },
      },
    );
  }
}

/**
 * Writes complement/FBT bundle config metafield to the trigger product.
 * Fetches fresh variant IDs from the Shopify API to ensure correctness.
 */
export async function setComplementBundleMetafield(
  admin: any,
  {
    productId,
    bundleName,
    complements,
    designConfig,
    mode,
    triggerDiscountPct,
  }: {
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
      });
    } catch {
      // Fallback to original data
      enrichedComplements.push(comp);
    }
  }

  const metafieldValue = JSON.stringify({
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
  });

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
            ownerId: productId,
            namespace: "bxgy_bundle",
            key: "complement_config",
            type: "json",
            value: metafieldValue,
          },
        ],
      },
    },
  );
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
    });
  }

  const shopRes = await admin.graphql(
    `#graphql
      query { shop { id } }`,
  );
  const shopJson = await shopRes.json();
  const shopGid = shopJson.data?.shop?.id;
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
 * Removes the complement bundle metafield from the trigger product.
 */
export async function removeComplementBundleMetafield(
  admin: any,
  productId: string,
) {
  const response = await admin.graphql(
    `#graphql
      query getMetafield($ownerId: ID!, $namespace: String!, $key: String!) {
        product(id: $ownerId) {
          metafield(namespace: $namespace, key: $key) {
            id
          }
        }
      }`,
    {
      variables: {
        ownerId: productId,
        namespace: "bxgy_bundle",
        key: "complement_config",
      },
    },
  );
  const json = await response.json();
  const metafieldId = json.data?.product?.metafield?.id;

  if (metafieldId) {
    await admin.graphql(
      `#graphql
        mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { ownerId namespace key }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              ownerId: productId,
              namespace: "bxgy_bundle",
              key: "complement_config",
            },
          ],
        },
      },
    );
  }
}

