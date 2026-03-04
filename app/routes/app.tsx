import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { getShopBillingStatus } from "../lib/billing.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Get billing status via GraphQL (no redirects — safe for embedded apps)
  const billingStatus = await getShopBillingStatus(admin, session.shop);

  // Ensure shop has the app_url metafield for storefront analytics
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
      console.error("Failed to set app_url metafield:", e);
    }
  }

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    billingStatus,
  });
};

export default function App() {
  const { apiKey, billingStatus } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/bundles">Bundles</Link>
        <Link to="/app/analytics">Analytics</Link>
        <Link to="/app/billing">Billing</Link>
      </NavMenu>
      <Outlet context={{ billingStatus }} />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
