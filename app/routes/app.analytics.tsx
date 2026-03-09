import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
  ButtonGroup,
  Button,
  Divider,
  Box,
  Icon,
  Badge,
} from "@shopify/polaris";
import {
  ViewIcon,
  OrderIcon,
  CashDollarIcon,
  ChartVerticalIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [views, orders, revenueAgg] = await Promise.all([
    db.bundleEvent.count({
      where: { shopId: session.shop, eventType: "view", createdAt: { gte: since } },
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
  const [viewsByType, ordersByType] = await Promise.all([
    db.bundleEvent.groupBy({
      by: ["bundleType"],
      where: { shopId: session.shop, eventType: "view", createdAt: { gte: since } },
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
    orders,
    revenue,
    viewsByType: Object.fromEntries(viewsByType.map((v) => [v.bundleType, v._count])),
    ordersByType: Object.fromEntries(ordersByType.map((v) => [v.bundleType, v._count])),
  });
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function calcRate(numerator: number, denominator: number): string {
  if (denominator === 0) return "0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

const TYPE_LABELS: Record<string, string> = {
  tiered: "Tiered",
  volume: "Volume",
  complement: "FBT/Combo",
};
const TYPE_TONES: Record<string, "info" | "warning" | "success"> = {
  tiered: "info",
  volume: "warning",
  complement: "success",
};

function TypeBreakdown({ data }: { data: Record<string, number> }) {
  const types = ["tiered", "volume", "complement"] as const;
  return (
    <InlineStack gap="200" wrap>
      {types.map((t) => (
        <Badge key={t} tone={TYPE_TONES[t]} size="small">
          {TYPE_LABELS[t]}: {data[t] || 0}
        </Badge>
      ))}
    </InlineStack>
  );
}

function MetricCard({
  title,
  value,
  icon,
  breakdown,
  rate,
  rateLabel,
}: {
  title: string;
  value: string;
  icon: typeof ViewIcon;
  breakdown?: Record<string, number>;
  rate?: string;
  rateLabel?: string;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--p-color-bg-fill-secondary)",
              }}
            >
              <Icon source={icon} tone="subdued" />
            </div>
            <Text as="h3" variant="headingSm" tone="subdued">
              {title}
            </Text>
          </InlineStack>
          {rate && (
            <Text as="span" variant="bodySm" tone="subdued">
              {rateLabel}: {rate}
            </Text>
          )}
        </InlineStack>
        <Text as="p" variant="headingXl">
          {value}
        </Text>
        {breakdown && <TypeBreakdown data={breakdown} />}
      </BlockStack>
    </Card>
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

  const hasData = data.views > 0 || data.orders > 0;

  const conversionRate = calcRate(data.orders, data.views);

  return (
    <Page title="Analytics">
      <BlockStack gap="400">
        {/* Period selector */}
        <InlineStack align="end">
          <ButtonGroup variant="segmented">
            <Button pressed={currentDays === 7} onClick={() => setDays(7)}>
              7 days
            </Button>
            <Button pressed={currentDays === 30} onClick={() => setDays(30)}>
              30 days
            </Button>
            <Button pressed={currentDays === 90} onClick={() => setDays(90)}>
              90 days
            </Button>
          </ButtonGroup>
        </InlineStack>

        {!hasData ? (
          <Card>
            <Box paddingBlock="1000">
              <BlockStack gap="300" inlineAlign="center">
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--p-color-bg-fill-secondary)",
                  }}
                >
                  <Icon source={ChartVerticalIcon} tone="subdued" />
                </div>
                <Text variant="headingMd" as="h2" alignment="center">
                  No analytics data yet
                </Text>
                <Text variant="bodySm" as="p" tone="subdued" alignment="center">
                  Data will appear here once customers start viewing your
                  bundle widgets on the storefront.
                </Text>
              </BlockStack>
            </Box>
          </Card>
        ) : (
          <>
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
              <MetricCard
                title="Views"
                value={data.views.toLocaleString()}
                icon={ViewIcon}
                breakdown={data.viewsByType}
              />
              <MetricCard
                title="Orders"
                value={data.orders.toLocaleString()}
                icon={OrderIcon}
                breakdown={data.ordersByType}
                rate={conversionRate}
                rateLabel="Conv. rate"
              />
              <MetricCard
                title="Revenue"
                value={formatCurrency(data.revenue)}
                icon={CashDollarIcon}
              />
            </InlineGrid>

            {/* Footer note */}
            <Divider />
            <Text as="p" variant="bodySm" tone="subdued">
              Showing data for the last {currentDays} days. Views are tracked
              from storefront widgets. Orders and revenue are tracked via
              Shopify webhooks.
            </Text>
          </>
        )}
      </BlockStack>
    </Page>
  );
}
