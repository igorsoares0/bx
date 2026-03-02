import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  ButtonGroup,
  Button,
  EmptyState,
  Divider,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [views, clicks, addToCarts, orders, revenueAgg] = await Promise.all([
    db.bundleEvent.count({
      where: { shopId: session.shop, eventType: "view", createdAt: { gte: since } },
    }),
    db.bundleEvent.count({
      where: { shopId: session.shop, eventType: "click", createdAt: { gte: since } },
    }),
    db.bundleEvent.count({
      where: { shopId: session.shop, eventType: "add_to_cart", createdAt: { gte: since } },
    }),
    db.bundleOrder.count({
      where: { shopId: session.shop, createdAt: { gte: since } },
    }),
    db.bundleOrder.aggregate({
      where: { shopId: session.shop, createdAt: { gte: since } },
      _sum: { bundleRevenue: true },
    }),
  ]);

  const revenue = revenueAgg._sum.bundleRevenue || 0;

  // Breakdown by bundle type
  const [viewsByType, clicksByType, addsByType, ordersByType] = await Promise.all([
    db.bundleEvent.groupBy({
      by: ["bundleType"],
      where: { shopId: session.shop, eventType: "view", createdAt: { gte: since } },
      _count: true,
    }),
    db.bundleEvent.groupBy({
      by: ["bundleType"],
      where: { shopId: session.shop, eventType: "click", createdAt: { gte: since } },
      _count: true,
    }),
    db.bundleEvent.groupBy({
      by: ["bundleType"],
      where: { shopId: session.shop, eventType: "add_to_cart", createdAt: { gte: since } },
      _count: true,
    }),
    db.bundleOrder.groupBy({
      by: ["bundleType"],
      where: { shopId: session.shop, createdAt: { gte: since } },
      _count: true,
    }),
  ]);

  return json({
    days,
    views,
    clicks,
    addToCarts,
    orders,
    revenue,
    viewsByType: Object.fromEntries(viewsByType.map((v) => [v.bundleType, v._count])),
    clicksByType: Object.fromEntries(clicksByType.map((v) => [v.bundleType, v._count])),
    addsByType: Object.fromEntries(addsByType.map((v) => [v.bundleType, v._count])),
    ordersByType: Object.fromEntries(ordersByType.map((v) => [v.bundleType, v._count])),
  });
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function TypeBreakdown({ data }: { data: Record<string, number> }) {
  const types = ["tiered", "volume", "complement"];
  const labels: Record<string, string> = {
    tiered: "Tiered",
    volume: "Volume",
    complement: "FBT/Combo",
  };

  return (
    <InlineStack gap="400">
      {types.map((t) => (
        <Text key={t} as="span" variant="bodySm" tone="subdued">
          {labels[t]}: {data[t] || 0}
        </Text>
      ))}
    </InlineStack>
  );
}

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentDays = data.days;

  const setDays = (d: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("days", String(d));
    navigate(`/app/analytics?${params.toString()}`);
  };

  const hasData = data.views > 0 || data.clicks > 0 || data.addToCarts > 0 || data.orders > 0;

  return (
    <Page title="Analytics">
      <Layout>
        <Layout.Section>
          <InlineStack align="end">
            <ButtonGroup>
              <Button
                pressed={currentDays === 7}
                onClick={() => setDays(7)}
              >
                7 days
              </Button>
              <Button
                pressed={currentDays === 30}
                onClick={() => setDays(30)}
              >
                30 days
              </Button>
              <Button
                pressed={currentDays === 90}
                onClick={() => setDays(90)}
              >
                90 days
              </Button>
            </ButtonGroup>
          </InlineStack>
        </Layout.Section>

        {!hasData ? (
          <Layout.Section>
            <EmptyState
              heading="No analytics data yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Analytics data will appear here once customers start
                viewing and interacting with your bundle widgets.
              </p>
            </EmptyState>
          </Layout.Section>
        ) : (
          <>
            <Layout.Section>
              <InlineStack gap="400" wrap>
                {/* 1. Views */}
                <Box minWidth="180px" padding="0">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Bundle Views
                      </Text>
                      <Text as="p" variant="headingXl">
                        {data.views.toLocaleString()}
                      </Text>
                      <TypeBreakdown data={data.viewsByType} />
                    </BlockStack>
                  </Card>
                </Box>

                {/* 2. Clicks */}
                <Box minWidth="180px" padding="0">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Bundle Clicks
                      </Text>
                      <Text as="p" variant="headingXl">
                        {data.clicks.toLocaleString()}
                      </Text>
                      <TypeBreakdown data={data.clicksByType} />
                    </BlockStack>
                  </Card>
                </Box>

                {/* 3. Add to Cart */}
                <Box minWidth="180px" padding="0">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Bundles Added to Cart
                      </Text>
                      <Text as="p" variant="headingXl">
                        {data.addToCarts.toLocaleString()}
                      </Text>
                      <TypeBreakdown data={data.addsByType} />
                    </BlockStack>
                  </Card>
                </Box>

                {/* 4. Orders with Bundle */}
                <Box minWidth="180px" padding="0">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Orders with Bundle
                      </Text>
                      <Text as="p" variant="headingXl">
                        {data.orders.toLocaleString()}
                      </Text>
                      <TypeBreakdown data={data.ordersByType} />
                    </BlockStack>
                  </Card>
                </Box>

                {/* 5. Revenue */}
                <Box minWidth="180px" padding="0">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm" tone="subdued">
                        Bundle Revenue
                      </Text>
                      <Text as="p" variant="headingXl">
                        {formatCurrency(data.revenue)}
                      </Text>
                    </BlockStack>
                  </Card>
                </Box>
              </InlineStack>
            </Layout.Section>

            <Layout.Section>
              <Divider />
              <Box paddingBlockStart="400">
                <Text as="p" variant="bodySm" tone="subdued">
                  Showing data for the last {currentDays} days. Views, clicks,
                  and add-to-cart events are tracked from storefront widgets.
                  Orders and revenue are tracked via Shopify webhooks.
                </Text>
              </Box>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
