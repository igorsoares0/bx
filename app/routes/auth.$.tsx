import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Set app_url metafield once during auth (install/re-auth)
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  if (appUrl) {
    try {
      const shopRes = await admin.graphql(
        `#graphql
          query { shop { id } }`,
      );
      const shopData = await shopRes.json();
      const shopGid = shopData?.data?.shop?.id;
      if (shopGid) {
        await admin.graphql(
          `#graphql
            mutation setAppUrl($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                userErrors { field message }
              }
            }`,
          {
            variables: {
              metafields: [{
                namespace: "bxgy_bundle",
                key: "app_url",
                type: "single_line_text_field",
                value: appUrl,
                ownerId: shopGid,
              }],
            },
          },
        );
      }
    } catch (e) {
      console.error("Failed to set app_url metafield during auth:", e);
    }
  }

  return null;
};
