import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { getShopBillingStatus, deactivateAllBundles, reactivateAllBundles } from "../lib/billing.server";
import db from "../db.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Get billing status via GraphQL (no redirects — safe for embedded apps)
  const billingStatus = await getShopBillingStatus(admin, session.shop);

  // Enforce revenue limits on page load — catches downgrades and missed webhooks
  if (billingStatus.isOverLimit) {
    const counts = await Promise.all([
      db.tieredBundle.count({ where: { shopId: session.shop, active: true } }),
      db.volumeBundle.count({ where: { shopId: session.shop, active: true } }),
      db.complementBundle.count({ where: { shopId: session.shop, active: true } }),
    ]);
    if (counts.some((c) => c > 0)) {
      try {
        await deactivateAllBundles(admin, session.shop);
      } catch (e) {
        console.error("Failed to deactivate bundles on page load:", e);
      }
    }
  } else if (!billingStatus.isOverLimit && billingStatus.currentPlan !== "Free") {
    // Reactivate bundles if user has a paid plan and is within limits (catches missed upgrade webhooks)
    const inactiveCounts = await Promise.all([
      db.tieredBundle.count({ where: { shopId: session.shop, active: false } }),
      db.volumeBundle.count({ where: { shopId: session.shop, active: false } }),
      db.complementBundle.count({ where: { shopId: session.shop, active: false } }),
    ]);
    if (inactiveCounts.some((c) => c > 0)) {
      try {
        await reactivateAllBundles(admin, session.shop);
      } catch (e) {
        console.error("Failed to reactivate bundles on page load:", e);
      }
    }
  }

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
