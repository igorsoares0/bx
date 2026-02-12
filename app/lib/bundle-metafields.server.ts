/**
 * Writes bundle promo metafield to the "buy" product so the theme extension can display it.
 */
export async function setBundleMetafield(
  admin: any,
  {
    buyProductId,
    bundleName,
    minQuantity,
    rewardProductId,
    discountType,
    discountValue,
    maxReward,
  }: {
    buyProductId: string;
    bundleName: string;
    minQuantity: number;
    rewardProductId: string;
    discountType: string;
    discountValue: number;
    maxReward: number;
  },
) {
  // Fetch reward product title, handle, first variant (id + price), and image
  const productResponse = await admin.graphql(
    `#graphql
      query getProduct($id: ID!) {
        product(id: $id) {
          title
          handle
          featuredImage {
            url
          }
          variants(first: 1) {
            edges {
              node {
                id
                price
              }
            }
          }
        }
      }`,
    { variables: { id: rewardProductId } },
  );
  const productJson = await productResponse.json();
  const rewardProduct = productJson.data?.product;

  // Extract numeric variant ID for the Cart AJAX API
  const rewardVariantGid =
    rewardProduct?.variants?.edges?.[0]?.node?.id || "";
  const rewardVariantNumericId = rewardVariantGid.replace(
    "gid://shopify/ProductVariant/",
    "",
  );
  const rewardPriceCents = rewardProduct?.variants?.edges?.[0]?.node?.price
    ? Math.round(parseFloat(rewardProduct.variants.edges[0].node.price) * 100)
    : 0;
  const rewardImageUrl = rewardProduct?.featuredImage?.url || "";

  const metafieldValue = JSON.stringify({
    bundleName,
    minQuantity,
    discountType,
    discountValue,
    maxReward,
    rewardProductTitle: rewardProduct?.title || "reward product",
    rewardProductHandle: rewardProduct?.handle || "",
    rewardVariantId: rewardVariantNumericId,
    rewardProductPrice: rewardPriceCents,
    rewardProductImage: rewardImageUrl,
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
            ownerId: buyProductId,
            namespace: "bxgy_bundle",
            key: "config",
            type: "json",
            value: metafieldValue,
          },
        ],
      },
    },
  );
}

/**
 * Syncs all active bundles to a shop-level metafield so the storefront JS can auto-add reward products.
 */
export async function syncShopBundlesMetafield(
  admin: any,
  shopId: string,
  db: any,
) {
  const bundles = await db.bundle.findMany({
    where: { shopId, active: true },
  });

  // Fetch variant IDs for all reward products and buy products
  const bundleConfigs = [];
  for (const bundle of bundles) {
    const [rewardRes, buyRes] = await Promise.all([
      admin.graphql(
        `#graphql
          query getProductVariants($id: ID!) {
            product(id: $id) {
              variants(first: 1) {
                edges { node { id } }
              }
            }
          }`,
        { variables: { id: bundle.getProductId } },
      ),
      bundle.buyType === "product"
        ? admin.graphql(
            `#graphql
              query getProductVariants($id: ID!) {
                product(id: $id) {
                  variants(first: 100) {
                    edges { node { id } }
                  }
                }
              }`,
            { variables: { id: bundle.buyReference } },
          )
        : Promise.resolve(null),
    ]);

    const rewardJson = await rewardRes.json();
    const rewardVariantId =
      rewardJson.data?.product?.variants?.edges?.[0]?.node?.id || "";

    let buyVariantIds: string[] = [];
    if (buyRes) {
      const buyJson = await buyRes.json();
      buyVariantIds = (buyJson.data?.product?.variants?.edges || []).map(
        (e: any) => e.node.id,
      );
    }

    // Extract numeric IDs for the Cart AJAX API
    const numericVariantId = rewardVariantId.replace(
      "gid://shopify/ProductVariant/",
      "",
    );
    const numericBuyVariantIds = buyVariantIds.map((id: string) =>
      id.replace("gid://shopify/ProductVariant/", ""),
    );
    const numericBuyProductId = bundle.buyReference.replace(
      "gid://shopify/Product/",
      "",
    );

    bundleConfigs.push({
      buyType: bundle.buyType,
      buyProductId: numericBuyProductId,
      buyVariantIds: numericBuyVariantIds,
      minQuantity: bundle.minQuantity,
      rewardVariantId: numericVariantId,
      maxReward: bundle.maxReward,
    });
  }

  // Get the shop GID
  const shopRes = await admin.graphql(`#graphql query { shop { id } }`);
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
            key: "active_bundles",
            type: "json",
            value: JSON.stringify(bundleConfigs),
          },
        ],
      },
    },
  );
}

/**
 * Removes the bundle promo metafield from the "buy" product.
 */
export async function removeBundleMetafield(
  admin: any,
  buyProductId: string,
) {
  // First find the metafield ID
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
        ownerId: buyProductId,
        namespace: "bxgy_bundle",
        key: "config",
      },
    },
  );
  const json = await response.json();
  const metafieldId = json.data?.product?.metafield?.id;

  if (metafieldId) {
    await admin.graphql(
      `#graphql
        mutation deleteMetafield($input: MetafieldDeleteInput!) {
          metafieldDelete(input: $input) {
            deletedId
            userErrors { field message }
          }
        }`,
      {
        variables: {
          input: { id: metafieldId },
        },
      },
    );
  }
}
